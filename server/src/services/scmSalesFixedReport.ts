import type Database from 'better-sqlite3'
import {
  getSalesReportMeta,
  runSalesReportQuery,
  type SalesFilterCondition,
  type SalesFilterGroup,
  type SalesReportColumn,
  type SalesReportQuery,
  type SalesReportResult,
} from './scmSalesCustomReport.js'

export type SalesFixedReportCode = 'summary' | 'detail' | 'return' | 'ranking' | 'profit' | 'trend'
export type SalesTrendPeriod = 'day' | 'week' | 'month' | 'quarter' | 'year'

export interface SalesFixedFilters {
  start_date?: string
  end_date?: string
  partner_codes?: string[]
  item_codes?: string[]
  category_codes?: string[]
  warehouse_codes?: string[]
  batch_nos?: string[]
  biz_persons?: string[]
  dept_codes?: string[]
  source_types?: Array<'SO' | 'SR'>
  currency?: string
  profit_min?: number
  profit_max?: number
  profit_rate_min?: number
  profit_rate_max?: number
  empty_fields?: Array<'partner_code' | 'item_code' | 'category_code' | 'warehouse_code' | 'batch_no' | 'biz_person' | 'dept_code'>
}

export interface SalesFixedReportRequest {
  report_code?: SalesFixedReportCode
  filters?: SalesFixedFilters
  grouping?: string
  rank_metric?: 'sales_amount' | 'qty' | 'cost_amount' | 'profit' | 'profit_rate'
  top_n?: 10 | 20 | 50 | 100
  period?: SalesTrendPeriod
  chart_metric?: 'sales_amount' | 'qty' | 'cost_amount' | 'profit' | 'profit_rate'
  sort?: Array<{ key: string; direction?: 'asc' | 'desc' }>
  page?: number
  page_size?: number
}

export interface SalesFixedReportResult extends SalesReportResult {
  report_code: SalesFixedReportCode
  chart_metric?: string
  displayed?: number
}

const REPORTS = [
  { code: 'summary', title: '销售汇总表', path: '/scm/report/sales/summary' },
  { code: 'detail', title: '销售明细表', path: '/scm/report/sales/detail' },
  { code: 'return', title: '销售退货统计表', path: '/scm/report/sales/return' },
  { code: 'ranking', title: '销售排行榜', path: '/scm/report/sales/ranking' },
  { code: 'profit', title: '销售毛利分析', path: '/scm/report/sales/profit' },
  { code: 'trend', title: '销售趋势分析', path: '/scm/report/sales/trend' },
] as const

const SUMMARY_GROUPINGS: Record<string, string[]> = {
  customer: ['partner_code', 'partner_name'],
  product: ['item_code', 'item_name', 'spec', 'unit'],
  customer_product: ['partner_code', 'partner_name', 'item_code', 'item_name'],
  product_customer: ['item_code', 'item_name', 'partner_code', 'partner_name'],
  warehouse_product: ['warehouse_code', 'warehouse_name', 'item_code', 'item_name'],
  batch_product: ['batch_no', 'item_code', 'item_name'],
  department_customer: ['dept_code', 'partner_code', 'partner_name'],
  salesperson_customer_product: ['biz_person', 'partner_code', 'partner_name', 'item_code', 'item_name'],
}

/** 退货统计表可用的统计方式（SUMMARY_GROUPINGS 的子集：退货关心客户、产品、仓库、业务员维度） */
const RETURN_GROUPINGS: Record<string, string[]> = {
  customer: SUMMARY_GROUPINGS.customer,
  product: SUMMARY_GROUPINGS.product,
  customer_product: SUMMARY_GROUPINGS.customer_product,
  product_customer: SUMMARY_GROUPINGS.product_customer,
  warehouse_product: SUMMARY_GROUPINGS.warehouse_product,
  salesperson_customer_product: SUMMARY_GROUPINGS.salesperson_customer_product,
}
const RETURN_METRICS = ['qty', 'sales_amount', 'tax_amount', 'cost_amount', 'document_count']
/** 现有汇总把退货按负数冲减；退货统计表按正数展示退货量/额 */
const RETURN_FLIP_KEYS = ['qty', 'sales_amount', 'tax_amount', 'discount_amount', 'cost_amount']
const RETURN_LABELS: Record<string, string> = { qty: '退货数量', sales_amount: '退货金额', tax_amount: '退货税额', cost_amount: '退货成本', document_count: '退货单数' }

const PROFIT_GROUPINGS: Record<string, string[]> = {
  customer: ['partner_code', 'partner_name'],
  product: ['item_code', 'item_name', 'spec'],
  customer_product: ['partner_code', 'partner_name', 'item_code', 'item_name'],
  salesperson: ['biz_person'],
  department: ['dept_code'],
  warehouse: ['warehouse_code', 'warehouse_name'],
  batch: ['batch_no'],
}

const RANKING_DIMENSIONS: Record<string, string[]> = {
  customer: ['partner_code', 'partner_name'],
  product: ['item_code', 'item_name', 'spec', 'unit'],
  category: ['category_code', 'category_name'],
  salesperson: ['biz_person'],
  department: ['dept_code'],
  warehouse: ['warehouse_code', 'warehouse_name'],
  batch: ['batch_no'],
}

const GROUPING_LABELS: Record<string, string> = {
  customer: '客户', product: '产品', customer_product: '客户 + 产品', product_customer: '产品 + 客户',
  warehouse_product: '仓库 + 产品', batch_product: '批次 + 产品', department_customer: '部门 + 客户',
  salesperson_customer_product: '业务员 + 客户 + 产品', salesperson: '业务员', department: '部门',
  warehouse: '仓库', batch: '批次', category: '产品分类',
}

const SUMMARY_METRICS = ['qty', 'sales_amount', 'tax_amount', 'discount_amount', 'cost_amount', 'profit', 'profit_rate', 'avg_price', 'document_count']
const PROFIT_METRICS = ['sales_amount', 'cost_amount', 'profit', 'profit_rate', 'qty', 'avg_price']
const RANKING_METRICS = ['qty', 'sales_amount', 'cost_amount', 'profit', 'profit_rate', 'avg_price', 'document_count']
const TREND_METRICS = ['sales_amount', 'qty', 'cost_amount', 'profit', 'profit_rate']
const RANK_METRICS = ['sales_amount', 'qty', 'cost_amount', 'profit', 'profit_rate']
const DETAIL_FIELDS = [
  'doc_date', 'source_type', 'doc_no', 'partner_code', 'partner_name', 'biz_person', 'dept_code',
  'warehouse_code', 'warehouse_name', 'item_code', 'item_name', 'spec', 'unit', 'batch_no',
  'qty', 'price', 'sales_amount', 'tax_amount', 'discount_amount', 'cost_amount', 'profit', 'currency', 'remark',
]
const DETAIL_SORT_FIELDS = new Set(['doc_date', 'source_type', 'doc_no', 'partner_code', 'partner_name', 'biz_person', 'dept_code', 'warehouse_code', 'item_code', 'item_name', 'batch_no', 'qty', 'price', 'sales_amount', 'cost_amount', 'profit'])
const TOP_N_VALUES = new Set([10, 20, 50, 100])
const REPORT_CODES = new Set<string>(REPORTS.map(item => item.code))
const PERIODS = new Set<SalesTrendPeriod>(['day', 'week', 'month', 'quarter', 'year'])
const EMPTY_FILTER_FIELDS = new Set(['partner_code', 'item_code', 'category_code', 'warehouse_code', 'batch_no', 'biz_person', 'dept_code'])

function todayText() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

function defaultDates(code: SalesFixedReportCode) {
  const end = todayText()
  return code === 'trend'
    ? { start_date: `${end.slice(0, 4)}-01-01`, end_date: end }
    : { start_date: `${end.slice(0, 7)}-01`, end_date: end }
}

function normalizeReportCode(value: unknown): SalesFixedReportCode {
  const code = String(value || '')
  if (!REPORT_CODES.has(code)) throw new Error('固定销售报表编码无效')
  return code as SalesFixedReportCode
}

function normalizeStringArray(value: unknown, label: string, max = 200) {
  if (value == null) return []
  if (!Array.isArray(value)) throw new Error(`${label}必须是数组`)
  const result = [...new Set(value.map(item => String(item).trim()).filter(Boolean))]
  if (result.length > max) throw new Error(`${label}最多选择 ${max} 项`)
  return result
}

function addIn(children: SalesFilterCondition[], field: string, value: unknown, label: string) {
  const values = normalizeStringArray(value, label)
  if (values.length) children.push({ field, operator: 'in', value: values })
}

function buildBaseFilters(code: SalesFixedReportCode, raw: SalesFixedFilters | undefined): { filters: SalesFixedFilters; group: SalesFilterGroup } {
  const defaults = defaultDates(code)
  const filters = { ...defaults, ...(raw || {}) }
  const startDate = String(filters.start_date || '').trim()
  const endDate = String(filters.end_date || '').trim()
  if ((startDate && !endDate) || (!startDate && endDate)) throw new Error('开始日期和结束日期必须同时填写')
  if (startDate && endDate && startDate > endDate) throw new Error('开始日期不能晚于结束日期')
  const currency = String(Object.prototype.hasOwnProperty.call(raw || {}, 'currency') ? filters.currency ?? '' : 'CNY').trim()
  if (!currency) throw new Error('请选择币种')
  filters.currency = currency
  const children: SalesFilterCondition[] = []
  if (startDate && endDate) children.push({ field: 'doc_date', operator: 'between', value: startDate, value2: endDate })
  // 多币种：ALL = 全部币种折本位币汇总（不加币种过滤，查询时 to_base）；否则按单一原币过滤
  if (currency !== 'ALL') children.push({ field: 'currency', operator: 'eq', value: currency })
  addIn(children, 'partner_code', filters.partner_codes, '客户')
  addIn(children, 'item_code', filters.item_codes, '产品')
  addIn(children, 'category_code', filters.category_codes, '产品分类')
  addIn(children, 'warehouse_code', filters.warehouse_codes, '仓库')
  addIn(children, 'batch_no', filters.batch_nos, '批次')
  addIn(children, 'biz_person', filters.biz_persons, '业务员')
  addIn(children, 'dept_code', filters.dept_codes, '部门')
  const emptyFields = normalizeStringArray(filters.empty_fields, '空值字段', EMPTY_FILTER_FIELDS.size)
  if (emptyFields.some(field => !EMPTY_FILTER_FIELDS.has(field))) throw new Error('空值筛选字段无效')
  for (const field of emptyFields) children.push({ field, operator: 'is_empty' })
  const sourceTypes = normalizeStringArray(filters.source_types, '业务类型')
  if (sourceTypes.some(value => value !== 'SO' && value !== 'SR')) throw new Error('业务类型无效')
  if (sourceTypes.length) children.push({ field: 'source_type', operator: 'in', value: sourceTypes })
  return { filters, group: { logic: 'and', children } }
}

function resultFilters(filters: SalesFixedFilters): SalesFilterGroup {
  const children: SalesFilterCondition[] = []
  const add = (field: string, operator: string, value: unknown) => {
    if (value !== undefined && value !== null && value !== '') children.push({ field, operator, value })
  }
  add('profit', 'gte', filters.profit_min)
  add('profit', 'lte', filters.profit_max)
  add('profit_rate', 'gte', filters.profit_rate_min)
  add('profit_rate', 'lte', filters.profit_rate_max)
  return { logic: 'and', children }
}

function normalizeSort(raw: SalesFixedReportRequest['sort'], allowed: Set<string>, fallback: SalesReportQuery['sort']) {
  if (!Array.isArray(raw) || !raw.length) return fallback
  return raw.slice(0, 3).map(item => {
    const key = String(item?.key || '')
    if (!allowed.has(key)) throw new Error(`排序字段无效：${key}`)
    return { key, direction: item.direction === 'asc' ? 'asc' as const : 'desc' as const }
  })
}

function displayLabel(column: SalesReportColumn): SalesReportColumn {
  const labels: Record<string, string> = {
    item_code: '产品编号', item_name: '产品名称', category_code: '产品分类编号', category_name: '产品分类',
    qty: '销售数量', sales_amount: '销售收入', cost_amount: '销售成本', avg_price: '平均售价',
  }
  return { ...column, label: labels[column.key] || column.label }
}

function normalizeEmptyDimensions(result: SalesReportResult) {
  const dimensions = new Set(result.columns
    .filter(column => column.role === 'dimension' || ['text', 'enum'].includes(column.type))
    .map(column => column.key))
  result.rows = result.rows.map(row => {
    const next = { ...row }
    for (const key of dimensions) if (next[key] == null || next[key] === '') next[key] = '未指定'
    return next
  })
  result.columns = result.columns.map(displayLabel)
  return result
}

function addDetailProfitRate(result: SalesReportResult) {
  const profitIndex = result.columns.findIndex(column => column.key === 'profit')
  const column: SalesReportColumn = { key: 'profit_rate', label: '毛利率', type: 'percent', role: 'field' }
  result.columns.splice(profitIndex >= 0 ? profitIndex + 1 : result.columns.length, 0, column)
  result.rows = result.rows.map(row => ({
    ...row,
    profit_rate: Math.abs(Number(row.sales_amount) || 0) < 0.005 ? null : Math.round((Number(row.profit) || 0) * 10000 / Number(row.sales_amount)) / 100,
  }))
  return result
}

function parseDate(value: string) {
  const parts = value.split('-').map(Number)
  const date = new Date(parts[0], parts[1] - 1, parts[2])
  if (!parts[0] || !parts[1] || !parts[2] || Number.isNaN(date.getTime())) throw new Error('日期格式无效')
  return date
}

function sqliteWeekLabel(date: Date) {
  const year = date.getFullYear()
  const jan1 = new Date(year, 0, 1)
  const dayIndex = Math.floor((date.getTime() - jan1.getTime()) / 86_400_000)
  const firstMonday = (8 - jan1.getDay()) % 7
  const week = dayIndex < firstMonday ? 0 : Math.floor((dayIndex - firstMonday) / 7) + 1
  return `${year}-W${String(week).padStart(2, '0')}`
}

function periodLabel(date: Date, period: SalesTrendPeriod) {
  const year = date.getFullYear()
  const month = date.getMonth() + 1
  if (period === 'day') return `${year}-${String(month).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  if (period === 'week') return sqliteWeekLabel(date)
  if (period === 'month') return `${year}-${String(month).padStart(2, '0')}`
  if (period === 'quarter') return `${year}-Q${Math.floor((month - 1) / 3) + 1}`
  return String(year)
}

function fillTrendRows(result: SalesReportResult, startText: string, endText: string, period: SalesTrendPeriod) {
  const start = parseDate(startText)
  const end = parseDate(endText)
  const days = Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1
  if (period === 'day' && days > 366) throw new Error('按日统计最多查询 366 天，请改用周或月')
  const labels: string[] = []
  const seen = new Set<string>()
  const cursor = new Date(start)
  while (cursor <= end) {
    const label = periodLabel(cursor, period)
    if (!seen.has(label)) { seen.add(label); labels.push(label) }
    cursor.setDate(cursor.getDate() + 1)
  }
  const rowsByLabel = new Map(result.rows.map(row => [String(row[period]), row]))
  result.rows = labels.map(label => rowsByLabel.get(label) || {
    [period]: label, sales_amount: 0, qty: 0, cost_amount: 0, profit: 0, profit_rate: null,
  })
  result.total = result.rows.length
  result.page = 1
  result.page_size = result.rows.length
  return result
}

function toReturnResult(result: SalesReportResult) {
  const flip = (row: Record<string, any>) => {
    for (const key of RETURN_FLIP_KEYS) if (typeof row[key] === 'number' && row[key] !== 0) row[key] = -row[key]
    return row
  }
  result.rows = result.rows.map(row => flip({ ...row }))
  result.summary = flip({ ...result.summary })
  return result
}
function relabelReturnColumns<T extends { columns: SalesReportColumn[] }>(result: T): T {
  result.columns = result.columns.map(column => RETURN_LABELS[column.key] ? { ...column, label: RETURN_LABELS[column.key] } : column)
  return result
}

function baseResult(code: SalesFixedReportCode, result: SalesReportResult, extra: Partial<SalesFixedReportResult> = {}): SalesFixedReportResult {
  normalizeEmptyDimensions(result)
  return { ...result, report_code: code, ...extra }
}

export function getSalesFixedReportMeta(db: Database.Database, accountSetId: string) {
  const customMeta = getSalesReportMeta(db, accountSetId)
  const field = (key: string) => customMeta.fields.find(item => item.key === key)
  const distinct = (expression: string, join = '') => (db.prepare(`SELECT DISTINCT ${expression} value
    FROM scm_doc d ${join}
    WHERE d.account_set_id=? AND d.doc_type IN ('SO','SR') AND d.status='audited' AND COALESCE(d.cancel_flag,0)=0
      AND COALESCE(${expression},'')<>'' ORDER BY value LIMIT 2000`).all(accountSetId) as any[])
    .map(row => ({ label: String(row.value), value: String(row.value) }))
  return {
    reports: REPORTS,
    groupings: {
      summary: Object.keys(SUMMARY_GROUPINGS).map(value => ({ value, label: GROUPING_LABELS[value] })),
      return: Object.keys(RETURN_GROUPINGS).map(value => ({ value, label: GROUPING_LABELS[value] })),
      profit: Object.keys(PROFIT_GROUPINGS).map(value => ({ value, label: GROUPING_LABELS[value] })),
      ranking: Object.keys(RANKING_DIMENSIONS).map(value => ({ value, label: GROUPING_LABELS[value] })),
    },
    rank_metrics: [
      { value: 'sales_amount', label: '销售收入' }, { value: 'qty', label: '销售数量' },
      { value: 'cost_amount', label: '销售成本' }, { value: 'profit', label: '毛利' }, { value: 'profit_rate', label: '毛利率' },
    ],
    periods: [
      { value: 'day', label: '日' }, { value: 'week', label: '周' }, { value: 'month', label: '月' },
      { value: 'quarter', label: '季度' }, { value: 'year', label: '年' },
    ],
    options: {
      partners: field('partner_code')?.options || [],
      items: field('item_code')?.options || [],
      categories: field('category_code')?.options || [],
      warehouses: field('warehouse_code')?.options || [],
      biz_people: distinct('d.biz_person'),
      departments: distinct('d.dept_code'),
      batches: distinct('l.batch_no', 'JOIN scm_doc_line l ON l.doc_id=d.id AND l.account_set_id=d.account_set_id'),
      currencies: distinct("COALESCE(d.currency,'CNY')"),
      source_types: [{ label: '销售出库', value: 'SO' }, { label: '销售退货', value: 'SR' }],
    },
    defaults: {
      ...defaultDates('summary'), currency: 'CNY', summary_grouping: 'customer', profit_grouping: 'customer',
      ranking_grouping: 'customer', rank_metric: 'sales_amount', top_n: 20, trend_period: 'month', chart_metric: 'sales_amount',
      trend_dates: defaultDates('trend'),
    },
    limits: { page_size: 500, export_rows: 100000, trend_day_range: 366 },
  }
}

export function runSalesFixedReport(
  db: Database.Database,
  accountSetId: string,
  request: SalesFixedReportRequest,
  options: { exportAll?: boolean } = {},
): SalesFixedReportResult {
  const code = normalizeReportCode(request?.report_code)
  // 退货统计表只统计销售退货单，忽略前端传入的业务类型
  const built = buildBaseFilters(code, code === 'return' ? { ...request.filters, source_types: ['SR'] } : request.filters)
  const page = Math.max(1, Math.floor(Number(request.page) || 1))
  const pageSize = Math.min(500, Math.max(1, Math.floor(Number(request.page_size) || 100)))

  if (code === 'detail') {
    const query: SalesReportQuery = {
      mode: 'detail', filters: built.group, fields: DETAIL_FIELDS, to_base: built.filters.currency === 'ALL',
      sort: normalizeSort(request.sort, DETAIL_SORT_FIELDS, [{ key: 'doc_date', direction: 'desc' }, { key: 'doc_no', direction: 'desc' }]),
      page, page_size: pageSize,
    }
    const result = runSalesReportQuery(db, accountSetId, query, options)
    addDetailProfitRate(result)
    return baseResult(code, result)
  }

  if (code === 'return') {
    const grouping = String(request.grouping || 'customer')
    const dimensions = RETURN_GROUPINGS[grouping]
    if (!dimensions) throw new Error('统计方式无效')
    // 数据库里退货为负数，退货量大的在前 = 升序
    const sort = normalizeSort(request.sort, new Set([...dimensions, ...RETURN_METRICS]), [{ key: 'sales_amount', direction: 'asc' }])
    const query: SalesReportQuery = {
      mode: 'summary', filters: built.group, dimensions, metrics: RETURN_METRICS, to_base: built.filters.currency === 'ALL',
      sort, page, page_size: pageSize,
    }
    return relabelReturnColumns(baseResult(code, toReturnResult(runSalesReportQuery(db, accountSetId, query, options))))
  }

  if (code === 'summary' || code === 'profit') {
    const groupingMap = code === 'summary' ? SUMMARY_GROUPINGS : PROFIT_GROUPINGS
    const grouping = String(request.grouping || 'customer')
    const dimensions = groupingMap[grouping]
    if (!dimensions) throw new Error('统计方式无效')
    const metrics = code === 'summary' ? SUMMARY_METRICS : PROFIT_METRICS
    const allowedSort = new Set([...dimensions, ...metrics])
    const query: SalesReportQuery = {
      mode: 'summary', filters: built.group, dimensions, metrics, to_base: built.filters.currency === 'ALL',
      result_filters: code === 'profit' ? resultFilters(built.filters) : undefined,
      sort: normalizeSort(request.sort, allowedSort, [{ key: code === 'profit' ? 'profit' : 'sales_amount', direction: 'desc' }]),
      page, page_size: pageSize,
    }
    return baseResult(code, runSalesReportQuery(db, accountSetId, query, options))
  }

  if (code === 'ranking') {
    const grouping = String(request.grouping || 'customer')
    const dimensions = RANKING_DIMENSIONS[grouping]
    if (!dimensions) throw new Error('排名对象无效')
    const rankMetric = String(request.rank_metric || 'sales_amount')
    if (!RANK_METRICS.includes(rankMetric)) throw new Error('排名指标无效')
    const topN = Number(request.top_n || 20)
    if (!TOP_N_VALUES.has(topN)) throw new Error('排行榜条数无效')
    const query: SalesReportQuery = {
      mode: 'summary', filters: built.group, dimensions, metrics: RANKING_METRICS, to_base: built.filters.currency === 'ALL',
      sort: [{ key: rankMetric, direction: 'desc' }, { key: dimensions[0], direction: 'asc' }],
      page: 1, page_size: topN,
    }
    const result = runSalesReportQuery(db, accountSetId, query)
    const totalMetric = Number(result.summary[rankMetric]) || 0
    result.columns.unshift({ key: 'rank', label: '排名', type: 'integer', role: 'dimension' })
    if (rankMetric !== 'profit_rate') result.columns.push({ key: 'share_rate', label: '指标占比', type: 'percent', role: 'metric' })
    result.rows = result.rows.map((row, index) => ({
      rank: index + 1,
      ...row,
      ...(rankMetric === 'profit_rate' ? {} : { share_rate: Math.abs(totalMetric) < 0.000001 ? null : Math.round((Number(row[rankMetric]) || 0) * 10000 / totalMetric) / 100 }),
    }))
    return baseResult(code, result, { displayed: result.rows.length, chart_metric: rankMetric })
  }

  const period = String(request.period || 'month') as SalesTrendPeriod
  if (!PERIODS.has(period)) throw new Error('趋势时间粒度无效')
  const chartMetric = String(request.chart_metric || 'sales_amount')
  if (!TREND_METRICS.includes(chartMetric)) throw new Error('趋势指标无效')
  const startDate = String(built.filters.start_date || '')
  const endDate = String(built.filters.end_date || '')
  if (!startDate || !endDate) throw new Error('趋势分析必须选择日期范围')
  const query: SalesReportQuery = {
    mode: 'summary', filters: built.group, dimensions: [period], metrics: TREND_METRICS, to_base: built.filters.currency === 'ALL',
    sort: [{ key: period, direction: 'asc' }], page: 1, page_size: 500,
  }
  const result = runSalesReportQuery(db, accountSetId, query, { exportAll: true })
  fillTrendRows(result, startDate, endDate, period)
  return baseResult(code, result, { chart_metric: chartMetric })
}

export function salesFixedReportTitle(code: SalesFixedReportCode) {
  return REPORTS.find(item => item.code === code)?.title || '销售报表'
}
