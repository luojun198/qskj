import type Database from 'better-sqlite3'
import {
  getPurchaseReportMeta,
  runPurchaseReportQuery,
  type SalesFilterCondition,
  type SalesFilterGroup,
  type SalesReportColumn,
  type SalesReportQuery,
  type SalesReportResult,
} from './scmSalesCustomReport.js'

export type PurchaseFixedReportCode = 'summary' | 'detail' | 'order_tracking' | 'ranking' | 'cost' | 'trend'
export type PurchaseTrendPeriod = 'day' | 'week' | 'month' | 'quarter' | 'year'
export type PurchaseOrderExecutionStatus = 'not_received' | 'pending' | 'partial' | 'completed' | 'over_received' | 'overdue'

export interface PurchaseFixedFilters {
  start_date?: string
  end_date?: string
  expect_start_date?: string
  expect_end_date?: string
  partner_codes?: string[]
  item_codes?: string[]
  category_codes?: string[]
  warehouse_codes?: string[]
  batch_nos?: string[]
  biz_persons?: string[]
  dept_codes?: string[]
  source_types?: Array<'PI' | 'PR'>
  order_statuses?: PurchaseOrderExecutionStatus[]
  currency?: string
  variance_min?: number
  variance_max?: number
  variance_rate_min?: number
  variance_rate_max?: number
  empty_fields?: Array<'partner_code' | 'item_code' | 'category_code' | 'warehouse_code' | 'batch_no' | 'biz_person' | 'dept_code'>
}

export interface PurchaseFixedReportRequest {
  report_code?: PurchaseFixedReportCode
  filters?: PurchaseFixedFilters
  grouping?: string
  rank_metric?: 'purchase_amount' | 'qty' | 'purchase_cost' | 'cost_variance' | 'variance_rate'
  top_n?: 10 | 20 | 50 | 100
  period?: PurchaseTrendPeriod
  chart_metric?: 'purchase_amount' | 'qty' | 'purchase_cost' | 'cost_variance' | 'variance_rate'
  sort?: Array<{ key: string; direction?: 'asc' | 'desc' }>
  page?: number
  page_size?: number
}

export interface PurchaseFixedReportResult extends SalesReportResult {
  report_code: PurchaseFixedReportCode
  chart_metric?: string
  displayed?: number
}

const REPORTS = [
  { code: 'summary', title: '采购汇总表', path: '/scm/report/purchase/summary' },
  { code: 'detail', title: '采购明细表', path: '/scm/report/purchase/detail' },
  { code: 'order_tracking', title: '采购订单执行表', path: '/scm/report/purchase/order-tracking' },
  { code: 'ranking', title: '采购排行榜', path: '/scm/report/purchase/ranking' },
  { code: 'cost', title: '采购成本分析', path: '/scm/report/purchase/cost' },
  { code: 'trend', title: '采购趋势分析', path: '/scm/report/purchase/trend' },
] as const

const SUMMARY_GROUPINGS: Record<string, string[]> = {
  supplier: ['partner_code', 'partner_name'],
  product: ['item_code', 'item_name', 'spec', 'unit'],
  supplier_product: ['partner_code', 'partner_name', 'item_code', 'item_name'],
  product_supplier: ['item_code', 'item_name', 'partner_code', 'partner_name'],
  warehouse_product: ['warehouse_code', 'warehouse_name', 'item_code', 'item_name'],
  batch_product: ['batch_no', 'item_code', 'item_name'],
  department_supplier: ['dept_code', 'partner_code', 'partner_name'],
  buyer_supplier_product: ['biz_person', 'partner_code', 'partner_name', 'item_code', 'item_name'],
}

const COST_GROUPINGS: Record<string, string[]> = {
  supplier: ['partner_code', 'partner_name'],
  product: ['item_code', 'item_name', 'spec'],
  supplier_product: ['partner_code', 'partner_name', 'item_code', 'item_name'],
  buyer: ['biz_person'], department: ['dept_code'],
  warehouse: ['warehouse_code', 'warehouse_name'], batch: ['batch_no'],
}

const RANKING_DIMENSIONS: Record<string, string[]> = {
  supplier: ['partner_code', 'partner_name'],
  product: ['item_code', 'item_name', 'spec', 'unit'],
  category: ['category_code', 'category_name'],
  buyer: ['biz_person'], department: ['dept_code'],
  warehouse: ['warehouse_code', 'warehouse_name'], batch: ['batch_no'],
}

const GROUPING_LABELS: Record<string, string> = {
  supplier: '供应商', product: '产品', supplier_product: '供应商 + 产品', product_supplier: '产品 + 供应商',
  warehouse_product: '仓库 + 产品', batch_product: '批次 + 产品', department_supplier: '部门 + 供应商',
  buyer_supplier_product: '采购员 + 供应商 + 产品', buyer: '采购员', department: '部门', warehouse: '仓库', batch: '批次', category: '产品分类',
}

const SUMMARY_METRICS = ['qty', 'purchase_amount', 'tax_amount', 'discount_amount', 'purchase_cost', 'cost_variance', 'variance_rate', 'avg_price', 'document_count']
const COST_METRICS = ['purchase_amount', 'purchase_cost', 'cost_variance', 'variance_rate', 'qty', 'avg_price']
const RANKING_METRICS = ['qty', 'purchase_amount', 'purchase_cost', 'cost_variance', 'variance_rate', 'avg_price', 'document_count']
const TREND_METRICS = ['purchase_amount', 'qty', 'purchase_cost', 'cost_variance', 'variance_rate']
const RANK_METRICS = ['purchase_amount', 'qty', 'purchase_cost', 'cost_variance', 'variance_rate']
const DETAIL_FIELDS = [
  'doc_date', 'source_type', 'doc_no', 'partner_code', 'partner_name', 'biz_person', 'dept_code',
  'warehouse_code', 'warehouse_name', 'item_code', 'item_name', 'spec', 'unit', 'batch_no',
  'qty', 'price', 'purchase_amount', 'tax_amount', 'discount_amount', 'purchase_cost', 'cost_variance', 'currency', 'remark',
]
const DETAIL_SORT_FIELDS = new Set([...DETAIL_FIELDS])
const SOURCE_TYPE_LABELS: Record<string, string> = { PI: '采购入库', PR: '采购退货' }
const TOP_N_VALUES = new Set([10, 20, 50, 100])
const REPORT_CODES = new Set<string>(REPORTS.map(item => item.code))
const PERIODS = new Set<PurchaseTrendPeriod>(['day', 'week', 'month', 'quarter', 'year'])
const EMPTY_FILTER_FIELDS = new Set(['partner_code', 'item_code', 'category_code', 'warehouse_code', 'batch_no', 'biz_person', 'dept_code'])
const ORDER_EXECUTION_STATUSES = new Set<PurchaseOrderExecutionStatus>(['not_received', 'pending', 'partial', 'completed', 'over_received', 'overdue'])
const DEFAULT_ORDER_EXECUTION_STATUSES: PurchaseOrderExecutionStatus[] = ['not_received', 'pending', 'partial', 'over_received', 'overdue']
const ORDER_TRACKING_SORT_FIELDS: Record<string, string> = {
  order_date: 'order_date', expect_date: 'expect_date', order_no: 'order_no', partner_name: 'partner_name',
  biz_person: 'biz_person', item_code: 'item_code', item_name: 'item_name', warehouse_name: 'warehouse_name',
  order_qty: 'order_qty', pending_receipt_qty: 'pending_receipt_qty', received_qty: 'received_qty',
  returned_qty: 'returned_qty', net_received_qty: 'net_received_qty', unreceived_qty: 'unreceived_qty',
  over_received_qty: 'over_received_qty', completion_rate: 'completion_rate', order_amount: 'order_amount',
  net_received_amount: 'net_received_amount', last_receipt_date: 'last_receipt_date', execution_status: 'status_rank',
}

const ORDER_TRACKING_COLUMNS: SalesReportColumn[] = [
  { key: 'order_date', label: '订单日期', type: 'date', role: 'field' },
  { key: 'expect_date', label: '预计到货日期', type: 'date', role: 'field' },
  { key: 'order_no', label: '采购订单号', type: 'text', role: 'dimension' },
  { key: 'partner_name', label: '供应商', type: 'text', role: 'dimension' },
  { key: 'biz_person', label: '采购员', type: 'text', role: 'dimension' },
  { key: 'item_code', label: '产品编号', type: 'text', role: 'dimension' },
  { key: 'item_name', label: '产品名称', type: 'text', role: 'dimension' },
  { key: 'spec', label: '规格', type: 'text', role: 'field' },
  { key: 'unit', label: '单位', type: 'text', role: 'field' },
  { key: 'warehouse_name', label: '仓库', type: 'text', role: 'dimension' },
  { key: 'order_qty', label: '订单数量', type: 'number', role: 'metric' },
  { key: 'pending_receipt_qty', label: '待审核入库', type: 'number', role: 'metric' },
  { key: 'received_qty', label: '已入库', type: 'number', role: 'metric' },
  { key: 'returned_qty', label: '已退货', type: 'number', role: 'metric' },
  { key: 'net_received_qty', label: '净入库', type: 'number', role: 'metric' },
  { key: 'unreceived_qty', label: '未入库', type: 'number', role: 'metric' },
  { key: 'over_received_qty', label: '超量', type: 'number', role: 'metric' },
  { key: 'completion_rate', label: '完成率', type: 'percent', role: 'metric' },
  { key: 'order_amount', label: '订单金额', type: 'amount', role: 'metric' },
  { key: 'net_received_amount', label: '净入库金额', type: 'amount', role: 'metric' },
  { key: 'last_receipt_date', label: '最后入库日期', type: 'date', role: 'field' },
  { key: 'receipt_doc_nos', label: '入库单号', type: 'text', role: 'field' },
  { key: 'execution_status', label: '执行状态', type: 'enum', role: 'dimension' },
]

function todayText() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

function defaultDates(code: PurchaseFixedReportCode) {
  const end = todayText()
  if (code === 'order_tracking') return { start_date: '', end_date: '' }
  return code === 'trend' ? { start_date: `${end.slice(0, 4)}-01-01`, end_date: end } : { start_date: `${end.slice(0, 7)}-01`, end_date: end }
}

function normalizeCode(value: unknown): PurchaseFixedReportCode {
  const code = String(value || '')
  if (!REPORT_CODES.has(code)) throw new Error('固定采购报表编码无效')
  return code as PurchaseFixedReportCode
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

function buildFilters(code: PurchaseFixedReportCode, raw?: PurchaseFixedFilters) {
  const filters: PurchaseFixedFilters = { ...defaultDates(code), ...(raw || {}) }
  const startDate = String(filters.start_date || '').trim()
  const endDate = String(filters.end_date || '').trim()
  if ((startDate && !endDate) || (!startDate && endDate)) throw new Error('开始日期和结束日期必须同时填写')
  if (startDate && endDate && startDate > endDate) throw new Error('开始日期不能晚于结束日期')
  const currency = String(Object.prototype.hasOwnProperty.call(raw || {}, 'currency') ? filters.currency ?? '' : 'CNY').trim()
  if (!currency) throw new Error('请选择币种')
  filters.currency = currency
  const children: SalesFilterCondition[] = []
  if (startDate && endDate) children.push({ field: 'doc_date', operator: 'between', value: startDate, value2: endDate })
  if (currency !== 'ALL') children.push({ field: 'currency', operator: 'eq', value: currency })   // 多币种：ALL = 折本位币汇总
  addIn(children, 'partner_code', filters.partner_codes, '供应商')
  addIn(children, 'item_code', filters.item_codes, '产品')
  addIn(children, 'category_code', filters.category_codes, '产品分类')
  addIn(children, 'warehouse_code', filters.warehouse_codes, '仓库')
  addIn(children, 'batch_no', filters.batch_nos, '批次')
  addIn(children, 'biz_person', filters.biz_persons, '采购员')
  addIn(children, 'dept_code', filters.dept_codes, '部门')
  const emptyFields = normalizeStringArray(filters.empty_fields, '空值字段', EMPTY_FILTER_FIELDS.size)
  if (emptyFields.some(field => !EMPTY_FILTER_FIELDS.has(field))) throw new Error('空值筛选字段无效')
  for (const field of emptyFields) children.push({ field, operator: 'is_empty' })
  const sourceTypes = normalizeStringArray(filters.source_types, '业务类型')
  if (sourceTypes.some(value => value !== 'PI' && value !== 'PR')) throw new Error('业务类型无效')
  if (sourceTypes.length) children.push({ field: 'source_type', operator: 'in', value: sourceTypes })
  return { filters, group: { logic: 'and', children } as SalesFilterGroup }
}

function resultFilters(filters: PurchaseFixedFilters): SalesFilterGroup {
  const children: SalesFilterCondition[] = []
  const add = (field: string, operator: string, value: unknown) => {
    if (value !== undefined && value !== null && value !== '') children.push({ field, operator, value })
  }
  add('cost_variance', 'gte', filters.variance_min); add('cost_variance', 'lte', filters.variance_max)
  add('variance_rate', 'gte', filters.variance_rate_min); add('variance_rate', 'lte', filters.variance_rate_max)
  return { logic: 'and', children }
}

function normalizeSort(raw: PurchaseFixedReportRequest['sort'], allowed: Set<string>, fallback: SalesReportQuery['sort']) {
  if (!Array.isArray(raw) || !raw.length) return fallback
  return raw.slice(0, 3).map(item => {
    const key = String(item?.key || '')
    if (!allowed.has(key)) throw new Error(`排序字段无效：${key}`)
    return { key, direction: item.direction === 'asc' ? 'asc' as const : 'desc' as const }
  })
}

function normalizeResult(result: SalesReportResult) {
  const dimensions = new Set(result.columns.filter(column => column.role === 'dimension' || ['text', 'enum'].includes(column.type)).map(column => column.key))
  result.rows = result.rows.map(row => {
    const next = { ...row }
    for (const key of dimensions) if (next[key] == null || next[key] === '') next[key] = '未指定'
    if (typeof next.source_type === 'string') next.source_type = SOURCE_TYPE_LABELS[next.source_type] || next.source_type
    return next
  })
  result.columns = result.columns.map(column => ({ ...column, label: ({ item_code: '产品编号', item_name: '产品名称', category_code: '产品分类编号', category_name: '产品分类' } as Record<string, string>)[column.key] || column.label }))
  return result
}

function addDetailVarianceRate(result: SalesReportResult) {
  const index = result.columns.findIndex(column => column.key === 'cost_variance')
  result.columns.splice(index >= 0 ? index + 1 : result.columns.length, 0, { key: 'variance_rate', label: '差额率', type: 'percent', role: 'field' })
  result.rows = result.rows.map(row => ({ ...row, variance_rate: Math.abs(Number(row.purchase_amount) || 0) < 0.005 ? null : Math.round((Number(row.cost_variance) || 0) * 10000 / Number(row.purchase_amount)) / 100 }))
  return result
}

function parseDate(value: string) {
  const parts = value.split('-').map(Number)
  const date = new Date(parts[0], parts[1] - 1, parts[2])
  if (!parts[0] || !parts[1] || !parts[2] || Number.isNaN(date.getTime())) throw new Error('日期格式无效')
  return date
}

function weekLabel(date: Date) {
  const year = date.getFullYear(), jan1 = new Date(year, 0, 1)
  const dayIndex = Math.floor((date.getTime() - jan1.getTime()) / 86_400_000), firstMonday = (8 - jan1.getDay()) % 7
  const week = dayIndex < firstMonday ? 0 : Math.floor((dayIndex - firstMonday) / 7) + 1
  return `${year}-W${String(week).padStart(2, '0')}`
}

function periodLabel(date: Date, period: PurchaseTrendPeriod) {
  const year = date.getFullYear(), month = date.getMonth() + 1
  if (period === 'day') return `${year}-${String(month).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  if (period === 'week') return weekLabel(date)
  if (period === 'month') return `${year}-${String(month).padStart(2, '0')}`
  if (period === 'quarter') return `${year}-Q${Math.floor((month - 1) / 3) + 1}`
  return String(year)
}

function fillTrendRows(result: SalesReportResult, startText: string, endText: string, period: PurchaseTrendPeriod) {
  const start = parseDate(startText), end = parseDate(endText)
  const days = Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1
  if (period === 'day' && days > 366) throw new Error('按日统计最多查询 366 天，请改用周或月')
  const labels: string[] = [], seen = new Set<string>(), cursor = new Date(start)
  while (cursor <= end) {
    const label = periodLabel(cursor, period)
    if (!seen.has(label)) { seen.add(label); labels.push(label) }
    cursor.setDate(cursor.getDate() + 1)
  }
  const rows = new Map(result.rows.map(row => [String(row[period]), row]))
  result.rows = labels.map(label => rows.get(label) || { [period]: label, purchase_amount: 0, qty: 0, purchase_cost: 0, cost_variance: 0, variance_rate: null })
  result.total = result.rows.length; result.page = 1; result.page_size = result.rows.length
  return result
}

function baseResult(code: PurchaseFixedReportCode, result: SalesReportResult, extra: Partial<PurchaseFixedReportResult> = {}): PurchaseFixedReportResult {
  normalizeResult(result)
  return { ...result, report_code: code, ...extra }
}

function validateOptionalDateRange(startValue: unknown, endValue: unknown, label: string) {
  const start = String(startValue || '').trim()
  const end = String(endValue || '').trim()
  if ((start && !end) || (!start && end)) throw new Error(`${label}开始和结束日期必须同时填写`)
  if (start) parseDate(start)
  if (end) parseDate(end)
  if (start && end && start > end) throw new Error(`${label}开始日期不能晚于结束日期`)
  return { start, end }
}

function runPurchaseOrderTracking(
  db: Database.Database,
  accountSetId: string,
  request: PurchaseFixedReportRequest,
  options: { exportAll?: boolean },
): PurchaseFixedReportResult {
  const filters: PurchaseFixedFilters = { currency: 'CNY', ...(request.filters || {}) }
  const orderDates = validateOptionalDateRange(filters.start_date, filters.end_date, '订单日期')
  const expectDates = validateOptionalDateRange(filters.expect_start_date, filters.expect_end_date, '预计到货日期')
  const currency = String(filters.currency ?? '').trim()
  if (!currency) throw new Error('请选择币种')

  // 多币种：ALL = 不按币种过滤（订单跟踪金额仍为原币，按币种分列显示）
  const where: string[] = currency === 'ALL' ? ['1=1'] : ['currency=?']
  const whereParams: unknown[] = currency === 'ALL' ? [] : [currency]
  const addRange = (field: string, range: { start: string; end: string }) => {
    if (!range.start) return
    where.push(`${field} BETWEEN ? AND ?`)
    whereParams.push(range.start, range.end)
  }
  const addValues = (field: string, raw: unknown, label: string) => {
    const values = normalizeStringArray(raw, label)
    if (!values.length) return
    where.push(`${field} IN (${values.map(() => '?').join(',')})`)
    whereParams.push(...values)
  }
  addRange('order_date', orderDates)
  addRange('expect_date', expectDates)
  addValues('partner_code', filters.partner_codes, '供应商')
  addValues('item_code', filters.item_codes, '产品')
  addValues('category_code', filters.category_codes, '产品分类')
  addValues('warehouse_code', filters.warehouse_codes, '仓库')
  addValues('biz_person', filters.biz_persons, '采购员')
  addValues('dept_code', filters.dept_codes, '部门')
  const statuses = normalizeStringArray(filters.order_statuses, '执行状态', ORDER_EXECUTION_STATUSES.size)
  if (statuses.some(value => !ORDER_EXECUTION_STATUSES.has(value as PurchaseOrderExecutionStatus))) throw new Error('执行状态无效')
  if (statuses.length) {
    where.push(`execution_status_code IN (${statuses.map(() => '?').join(',')})`)
    whereParams.push(...statuses)
  }

  const withSql = `WITH pending_receipt AS (
      SELECT pil.source_line_id AS po_line_id, ROUND(SUM(COALESCE(pil.qty,0)),6) AS pending_receipt_qty
      FROM scm_doc_line pil
      JOIN scm_doc pid ON pid.id=pil.doc_id AND pid.account_set_id=pil.account_set_id
      WHERE pid.account_set_id=? AND pid.doc_type='PI' AND pid.status='draft'
        AND COALESCE(pid.cancel_flag,0)=0 AND pil.source_line_id IS NOT NULL
      GROUP BY pil.source_line_id
    ), audited_receipt AS (
      SELECT pil.source_line_id AS po_line_id,
        ROUND(SUM(COALESCE(pil.qty,0)),6) AS received_qty,
        ROUND(SUM(COALESCE(pil.amount,0)),2) AS received_amount,
        MAX(pid.doc_date) AS last_receipt_date,
        GROUP_CONCAT(DISTINCT pid.doc_no) AS receipt_doc_nos,
        json_group_array(DISTINCT json_object('id',pid.id,'doc_no',pid.doc_no)) AS receipt_docs_json
      FROM scm_doc_line pil
      JOIN scm_doc pid ON pid.id=pil.doc_id AND pid.account_set_id=pil.account_set_id
      WHERE pid.account_set_id=? AND pid.doc_type='PI' AND pid.status='audited'
        AND COALESCE(pid.cancel_flag,0)=0 AND pil.source_line_id IS NOT NULL
      GROUP BY pil.source_line_id
    ), audited_return AS (
      SELECT pil.source_line_id AS po_line_id,
        ROUND(SUM(COALESCE(prl.qty,0)),6) AS returned_qty,
        ROUND(SUM(COALESCE(prl.amount,0)),2) AS returned_amount
      FROM scm_doc_line prl
      JOIN scm_doc prd ON prd.id=prl.doc_id AND prd.account_set_id=prl.account_set_id
      JOIN scm_doc_line pil ON pil.id=prl.source_line_id AND pil.account_set_id=prl.account_set_id
      JOIN scm_doc pid ON pid.id=pil.doc_id AND pid.account_set_id=pil.account_set_id AND pid.doc_type='PI'
        AND pid.status='audited' AND COALESCE(pid.cancel_flag,0)=0
      WHERE prd.account_set_id=? AND prd.doc_type='PR' AND prd.status='audited'
        AND COALESCE(prd.cancel_flag,0)=0 AND pil.source_line_id IS NOT NULL
      GROUP BY pil.source_line_id
    ), order_base AS (
      SELECT pol.id AS _row_id, pod.id AS _doc_id, pod.doc_date AS order_date,
        pod.expect_date, pod.doc_no AS order_no, pod.partner_code, COALESCE(NULLIF(p.name,''),pod.partner_code) AS partner_name,
        pod.biz_person, pod.dept_code, pol.item_code, COALESCE(NULLIF(i.name,''),pol.item_code) AS item_name,
        COALESCE(NULLIF(pol.spec,''),i.spec) AS spec, COALESCE(NULLIF(pol.unit,''),i.unit) AS unit,
        i.category_code, COALESCE(pol.warehouse_code,pod.warehouse_code) AS warehouse_code,
        COALESCE(NULLIF(w.name,''),COALESCE(pol.warehouse_code,pod.warehouse_code)) AS warehouse_name,
        COALESCE(pod.currency,'CNY') AS currency, ROUND(COALESCE(pol.qty,0),6) AS order_qty,
        ROUND(COALESCE(pol.amount,0),2) AS order_amount,
        COALESCE(pending.pending_receipt_qty,0) AS pending_receipt_qty,
        COALESCE(receipt.received_qty,0) AS received_qty,
        COALESCE(ret.returned_qty,0) AS returned_qty,
        ROUND(COALESCE(receipt.received_amount,0)-COALESCE(ret.returned_amount,0),2) AS net_received_amount,
        receipt.last_receipt_date, COALESCE(receipt.receipt_doc_nos,'') AS receipt_doc_nos,
        COALESCE(receipt.receipt_docs_json,'[]') AS _receipt_docs_json
      FROM scm_doc_line pol
      JOIN scm_doc pod ON pod.id=pol.doc_id AND pod.account_set_id=pol.account_set_id
      LEFT JOIN scm_partner p ON p.account_set_id=pod.account_set_id AND p.code=pod.partner_code
      LEFT JOIN scm_item i ON i.account_set_id=pol.account_set_id AND i.code=pol.item_code
      LEFT JOIN scm_warehouse w ON w.account_set_id=pol.account_set_id AND w.code=COALESCE(pol.warehouse_code,pod.warehouse_code)
      LEFT JOIN pending_receipt pending ON pending.po_line_id=pol.id
      LEFT JOIN audited_receipt receipt ON receipt.po_line_id=pol.id
      LEFT JOIN audited_return ret ON ret.po_line_id=pol.id
      WHERE pod.account_set_id=? AND pod.doc_type='PO' AND pod.status='audited' AND COALESCE(pod.cancel_flag,0)=0
    ), calculated AS (
      SELECT *, ROUND(received_qty-returned_qty,6) AS net_received_qty,
        ROUND(MAX(order_qty-(received_qty-returned_qty),0),6) AS unreceived_qty,
        ROUND(MAX((received_qty-returned_qty)-order_qty,0),6) AS over_received_qty,
        CASE WHEN ABS(order_qty)<0.000001 THEN CASE WHEN received_qty-returned_qty>0.000001 THEN 100 ELSE 0 END
          ELSE ROUND((received_qty-returned_qty)*100.0/order_qty,2) END AS completion_rate
      FROM order_base
    ), statused AS (
      SELECT *, CASE
          WHEN net_received_qty>order_qty+0.000001 THEN 'over_received'
          WHEN net_received_qty>=order_qty-0.000001 THEN 'completed'
          WHEN COALESCE(expect_date,'')<>'' AND expect_date<? THEN 'overdue'
          WHEN net_received_qty>0.000001 THEN 'partial'
          WHEN pending_receipt_qty>0.000001 THEN 'pending'
          ELSE 'not_received' END AS execution_status_code
      FROM calculated
    ), report_rows AS (
      SELECT *, CASE execution_status_code
          WHEN 'not_received' THEN '未入库' WHEN 'pending' THEN '待审核' WHEN 'partial' THEN '部分入库'
          WHEN 'completed' THEN '已完成' WHEN 'over_received' THEN '超量入库' WHEN 'overdue' THEN '逾期未完成' END AS execution_status,
        CASE execution_status_code WHEN 'overdue' THEN 1 WHEN 'over_received' THEN 2 WHEN 'pending' THEN 3
          WHEN 'partial' THEN 4 WHEN 'not_received' THEN 5 ELSE 6 END AS status_rank
      FROM statused
    )`
  const baseParams: unknown[] = [accountSetId, accountSetId, accountSetId, accountSetId, todayText()]
  const filteredSql = `${withSql} SELECT * FROM report_rows WHERE ${where.join(' AND ')}`
  const total = Number((db.prepare(`${withSql} SELECT COUNT(*) AS count FROM report_rows WHERE ${where.join(' AND ')}`)
    .get(...baseParams, ...whereParams) as any)?.count || 0)
  const summaryRow = db.prepare(`${withSql} SELECT COUNT(DISTINCT _doc_id) AS order_count,
      ROUND(COALESCE(SUM(order_qty),0),6) AS order_qty,
      ROUND(COALESCE(SUM(pending_receipt_qty),0),6) AS pending_receipt_qty,
      ROUND(COALESCE(SUM(received_qty),0),6) AS received_qty,
      ROUND(COALESCE(SUM(returned_qty),0),6) AS returned_qty,
      ROUND(COALESCE(SUM(net_received_qty),0),6) AS net_received_qty,
      ROUND(COALESCE(SUM(unreceived_qty),0),6) AS unreceived_qty,
      ROUND(COALESCE(SUM(over_received_qty),0),6) AS over_received_qty,
      CASE WHEN ABS(COALESCE(SUM(order_qty),0))<0.000001 THEN 0
        ELSE ROUND(SUM(net_received_qty)*100.0/SUM(order_qty),2) END AS overall_completion_rate,
      CASE WHEN ABS(COALESCE(SUM(order_qty),0))<0.000001 THEN 0
        ELSE ROUND(SUM(net_received_qty)*100.0/SUM(order_qty),2) END AS completion_rate,
      SUM(CASE WHEN execution_status_code='overdue' THEN 1 ELSE 0 END) AS overdue_line_count,
      ROUND(COALESCE(SUM(order_amount),0),2) AS order_amount,
      ROUND(COALESCE(SUM(net_received_amount),0),2) AS net_received_amount
    FROM report_rows WHERE ${where.join(' AND ')}`).get(...baseParams, ...whereParams) as Record<string, number | null>

  const rawSort = Array.isArray(request.sort) ? request.sort.slice(0, 3) : []
  const sortParts = rawSort.map(item => {
    const expression = ORDER_TRACKING_SORT_FIELDS[String(item?.key || '')]
    if (!expression) throw new Error(`排序字段无效：${String(item?.key || '')}`)
    return `${expression} ${item.direction === 'asc' ? 'ASC' : 'DESC'}`
  })
  if (!sortParts.length) sortParts.push('status_rank ASC', "COALESCE(expect_date,'9999-12-31') ASC", 'order_date DESC', 'order_no DESC')
  const requestedPage = Math.max(1, Math.floor(Number(request.page) || 1))
  const requestedPageSize = Math.min(500, Math.max(1, Math.floor(Number(request.page_size) || 100)))
  const page = options.exportAll ? 1 : requestedPage
  const pageSize = options.exportAll ? 100000 : requestedPageSize
  const rows = db.prepare(`${filteredSql} ORDER BY ${sortParts.join(', ')} LIMIT ? OFFSET ?`)
    .all(...baseParams, ...whereParams, pageSize, (page - 1) * pageSize) as Record<string, unknown>[]
  return {
    mode: 'detail', report_code: 'order_tracking', columns: ORDER_TRACKING_COLUMNS,
    rows, summary: summaryRow || {}, total, page, page_size: pageSize, ignored_fields: [],
  }
}

export function getPurchaseFixedReportMeta(db: Database.Database, accountSetId: string) {
  const customMeta = getPurchaseReportMeta(db, accountSetId)
  const field = (key: string) => customMeta.fields.find(item => item.key === key)
  const distinct = (expression: string, join = '') => (db.prepare(`SELECT DISTINCT ${expression} value FROM scm_doc d ${join}
    WHERE d.account_set_id=? AND d.doc_type IN ('PO','PI','PR') AND COALESCE(d.cancel_flag,0)=0
      AND COALESCE(${expression},'')<>'' ORDER BY value LIMIT 2000`).all(accountSetId) as any[]).map(row => ({ label: String(row.value), value: String(row.value) }))
  return {
    reports: REPORTS,
    groupings: {
      summary: Object.keys(SUMMARY_GROUPINGS).map(value => ({ value, label: GROUPING_LABELS[value] })),
      cost: Object.keys(COST_GROUPINGS).map(value => ({ value, label: GROUPING_LABELS[value] })),
      ranking: Object.keys(RANKING_DIMENSIONS).map(value => ({ value, label: GROUPING_LABELS[value] })),
    },
    rank_metrics: [
      { value: 'purchase_amount', label: '采购金额' }, { value: 'qty', label: '采购数量' }, { value: 'purchase_cost', label: '入库成本' },
      { value: 'cost_variance', label: '采购差额' }, { value: 'variance_rate', label: '差额率' },
    ],
    periods: [{ value: 'day', label: '日' }, { value: 'week', label: '周' }, { value: 'month', label: '月' }, { value: 'quarter', label: '季度' }, { value: 'year', label: '年' }],
    options: {
      partners: field('partner_code')?.options || [], items: field('item_code')?.options || [], categories: field('category_code')?.options || [], warehouses: field('warehouse_code')?.options || [],
      biz_people: distinct('d.biz_person'), departments: distinct('d.dept_code'),
      batches: distinct('l.batch_no', 'JOIN scm_doc_line l ON l.doc_id=d.id AND l.account_set_id=d.account_set_id'),
      currencies: distinct("COALESCE(d.currency,'CNY')"), source_types: [{ label: '采购入库', value: 'PI' }, { label: '采购退货', value: 'PR' }],
      order_statuses: [
        { label: '未入库', value: 'not_received' }, { label: '待审核', value: 'pending' },
        { label: '部分入库', value: 'partial' }, { label: '已完成', value: 'completed' },
        { label: '超量入库', value: 'over_received' }, { label: '逾期未完成', value: 'overdue' },
      ],
    },
    defaults: {
      ...defaultDates('summary'), currency: 'CNY', summary_grouping: 'supplier', cost_grouping: 'supplier', ranking_grouping: 'supplier',
      rank_metric: 'purchase_amount', top_n: 20, trend_period: 'month', chart_metric: 'purchase_amount', trend_dates: defaultDates('trend'),
      order_tracking_dates: defaultDates('order_tracking'), order_tracking_statuses: DEFAULT_ORDER_EXECUTION_STATUSES,
    },
    limits: { page_size: 500, export_rows: 100000, trend_day_range: 366 },
  }
}

export function runPurchaseFixedReport(db: Database.Database, accountSetId: string, request: PurchaseFixedReportRequest, options: { exportAll?: boolean } = {}): PurchaseFixedReportResult {
  const code = normalizeCode(request?.report_code)
  if (code === 'order_tracking') return runPurchaseOrderTracking(db, accountSetId, request, options)
  const built = buildFilters(code, request.filters)
  const page = Math.max(1, Math.floor(Number(request.page) || 1)), pageSize = Math.min(500, Math.max(1, Math.floor(Number(request.page_size) || 100)))
  if (code === 'detail') {
    const query: SalesReportQuery = { mode: 'detail', filters: built.group, fields: DETAIL_FIELDS, to_base: built.filters.currency === 'ALL', sort: normalizeSort(request.sort, DETAIL_SORT_FIELDS, [{ key: 'doc_date', direction: 'desc' }, { key: 'doc_no', direction: 'desc' }]), page, page_size: pageSize }
    const result = runPurchaseReportQuery(db, accountSetId, query, options)
    addDetailVarianceRate(result)
    return baseResult(code, result)
  }
  if (code === 'summary' || code === 'cost') {
    const groupingMap = code === 'summary' ? SUMMARY_GROUPINGS : COST_GROUPINGS
    const grouping = String(request.grouping || 'supplier'), dimensions = groupingMap[grouping]
    if (!dimensions) throw new Error('统计方式无效')
    const metrics = code === 'summary' ? SUMMARY_METRICS : COST_METRICS
    const query: SalesReportQuery = {
      mode: 'summary', filters: built.group, dimensions, metrics, to_base: built.filters.currency === 'ALL',
      result_filters: code === 'cost' ? resultFilters(built.filters) : undefined,
      sort: normalizeSort(request.sort, new Set([...dimensions, ...metrics]), [{ key: code === 'cost' ? 'cost_variance' : 'purchase_amount', direction: 'desc' }]), page, page_size: pageSize,
    }
    return baseResult(code, runPurchaseReportQuery(db, accountSetId, query, options))
  }
  if (code === 'ranking') {
    const grouping = String(request.grouping || 'supplier'), dimensions = RANKING_DIMENSIONS[grouping]
    if (!dimensions) throw new Error('排名对象无效')
    const rankMetric = String(request.rank_metric || 'purchase_amount')
    if (!RANK_METRICS.includes(rankMetric)) throw new Error('排名指标无效')
    const topN = Number(request.top_n || 20)
    if (!TOP_N_VALUES.has(topN)) throw new Error('排行榜条数无效')
    const result = runPurchaseReportQuery(db, accountSetId, { mode: 'summary', filters: built.group, dimensions, metrics: RANKING_METRICS, to_base: built.filters.currency === 'ALL', sort: [{ key: rankMetric, direction: 'desc' }, { key: dimensions[0], direction: 'asc' }], page: 1, page_size: topN })
    const totalMetric = Number(result.summary[rankMetric]) || 0
    result.columns.unshift({ key: 'rank', label: '排名', type: 'integer', role: 'dimension' })
    if (rankMetric !== 'variance_rate') result.columns.push({ key: 'share_rate', label: '指标占比', type: 'percent', role: 'metric' })
    result.rows = result.rows.map((row, index) => ({ rank: index + 1, ...row, ...(rankMetric === 'variance_rate' ? {} : { share_rate: Math.abs(totalMetric) < 0.000001 ? null : Math.round((Number(row[rankMetric]) || 0) * 10000 / totalMetric) / 100 }) }))
    return baseResult(code, result, { displayed: result.rows.length, chart_metric: rankMetric })
  }
  const period = String(request.period || 'month') as PurchaseTrendPeriod
  if (!PERIODS.has(period)) throw new Error('趋势时间粒度无效')
  const chartMetric = String(request.chart_metric || 'purchase_amount')
  if (!TREND_METRICS.includes(chartMetric)) throw new Error('趋势指标无效')
  const startDate = String(built.filters.start_date || ''), endDate = String(built.filters.end_date || '')
  if (!startDate || !endDate) throw new Error('趋势分析必须选择日期范围')
  const result = runPurchaseReportQuery(db, accountSetId, { mode: 'summary', filters: built.group, dimensions: [period], metrics: TREND_METRICS, to_base: built.filters.currency === 'ALL', sort: [{ key: period, direction: 'asc' }], page: 1, page_size: 500 }, { exportAll: true })
  fillTrendRows(result, startDate, endDate, period)
  return baseResult(code, result, { chart_metric: chartMetric })
}

export function purchaseFixedReportTitle(code: PurchaseFixedReportCode) {
  return REPORTS.find(item => item.code === code)?.title || '采购报表'
}
