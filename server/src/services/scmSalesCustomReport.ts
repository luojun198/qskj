import type Database from 'better-sqlite3'

export type SalesReportMode = 'detail' | 'summary'
export type SalesFieldType = 'text' | 'number' | 'amount' | 'date' | 'enum' | 'percent' | 'integer'

export interface SalesReportFieldMeta {
  key: string
  label: string
  type: SalesFieldType
  category: string
  operators: string[]
  detail?: boolean
  dimension?: boolean
  option_source?: string
  options?: Array<{ label: string; value: string }>
}

export interface SalesReportMetricMeta {
  key: string
  label: string
  type: SalesFieldType
}

export interface SalesFilterCondition {
  field: string
  operator: string
  value?: unknown
  value2?: unknown
}

export interface SalesFilterGroup {
  logic?: 'and' | 'or'
  children?: Array<SalesFilterGroup | SalesFilterCondition>
}

export interface SalesReportQuery {
  mode?: SalesReportMode
  filters?: SalesFilterGroup
  result_filters?: SalesFilterGroup
  fields?: string[]
  dimensions?: string[]
  metrics?: string[]
  sort?: Array<{ key: string; direction?: 'asc' | 'desc' }>
  page?: number
  page_size?: number
  /** 多币种：true 时金额按单据记账汇率折成本位币（币种列显示为「本位币」），可跨币种汇总 */
  to_base?: boolean
}

export interface SalesReportColumn {
  key: string
  label: string
  type: SalesFieldType
  role: 'field' | 'dimension' | 'metric'
}

export interface SalesReportResult {
  mode: SalesReportMode
  columns: SalesReportColumn[]
  rows: Record<string, unknown>[]
  summary: Record<string, number | null>
  total: number
  page: number
  page_size: number
  ignored_fields: string[]
}

type InternalField = SalesReportFieldMeta & { baseAlias: string }
type InternalMetric = SalesReportMetricMeta & { aggregateSql: string }
type TradeReportKey = 'sales' | 'purchase'

interface TradeReportProfile {
  key: TradeReportKey
  docTypes: [string, string]
  negativeDocType: string
  partnerType: 'customer' | 'supplier'
  defaultDetailFields: string[]
  defaultDimensions: string[]
  defaultMetrics: string[]
}

const TEXT_OPERATORS = ['eq', 'neq', 'contains', 'not_contains', 'starts_with', 'in', 'not_in', 'is_empty', 'not_empty']
const ENUM_OPERATORS = ['eq', 'neq', 'in', 'not_in', 'is_empty', 'not_empty']
const NUMBER_OPERATORS = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'between', 'is_empty', 'not_empty']
const DATE_OPERATORS = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'between', 'is_empty', 'not_empty']
const MAX_FILTERS = 50
const MAX_FILTER_DEPTH = 3
const MAX_DIMENSIONS = 6
const MAX_FIELDS = 30
const MAX_PAGE_SIZE = 500
export const MAX_SALES_EXPORT_ROWS = 100000
export const MAX_PURCHASE_EXPORT_ROWS = MAX_SALES_EXPORT_ROWS

function standardFields(reportKey: TradeReportKey): InternalField[] {
  const purchase = reportKey === 'purchase'
  return [
  { key: 'doc_date', label: '单据日期', type: 'date', category: '单据', operators: DATE_OPERATORS, detail: true, baseAlias: 'doc_date' },
  { key: 'doc_no', label: '单据编号', type: 'text', category: '单据', operators: TEXT_OPERATORS, detail: true, dimension: true, baseAlias: 'doc_no' },
  { key: 'source_type', label: '业务类型', type: 'enum', category: '单据', operators: ENUM_OPERATORS, detail: true, dimension: true, baseAlias: 'source_type', options: purchase ? [{ label: '采购入库', value: 'PI' }, { label: '采购退货', value: 'PR' }] : [{ label: '销售出库', value: 'SO' }, { label: '销售退货', value: 'SR' }] },
  { key: 'partner_code', label: purchase ? '供应商编号' : '客户编号', type: 'enum', category: purchase ? '供应商' : '客户', operators: ENUM_OPERATORS, detail: true, dimension: true, option_source: 'partner', baseAlias: 'partner_code' },
  { key: 'partner_name', label: purchase ? '供应商名称' : '客户名称', type: 'text', category: purchase ? '供应商' : '客户', operators: TEXT_OPERATORS, detail: true, dimension: true, baseAlias: 'partner_name' },
  { key: 'region_code', label: purchase ? '供应商地区' : '客户地区', type: 'text', category: purchase ? '供应商' : '客户', operators: TEXT_OPERATORS, detail: true, dimension: true, baseAlias: 'region_code' },
  { key: 'province', label: '省', type: 'text', category: purchase ? '供应商' : '客户', operators: TEXT_OPERATORS, detail: true, dimension: true, baseAlias: 'province' },
  { key: 'city', label: '市', type: 'text', category: purchase ? '供应商' : '客户', operators: TEXT_OPERATORS, detail: true, dimension: true, baseAlias: 'city' },
  { key: 'county', label: '区县', type: 'text', category: purchase ? '供应商' : '客户', operators: TEXT_OPERATORS, detail: true, dimension: true, baseAlias: 'county' },
  { key: 'biz_person', label: purchase ? '采购员' : '业务员', type: 'text', category: '组织', operators: TEXT_OPERATORS, detail: true, dimension: true, baseAlias: 'biz_person' },
  { key: 'dept_code', label: '部门', type: 'text', category: '组织', operators: TEXT_OPERATORS, detail: true, dimension: true, baseAlias: 'dept_code' },
  { key: 'warehouse_code', label: '仓库编号', type: 'enum', category: '仓库', operators: ENUM_OPERATORS, detail: true, dimension: true, option_source: 'warehouse', baseAlias: 'warehouse_code' },
  { key: 'warehouse_name', label: '仓库名称', type: 'text', category: '仓库', operators: TEXT_OPERATORS, detail: true, dimension: true, baseAlias: 'warehouse_name' },
  { key: 'item_code', label: '物料编号', type: 'enum', category: '物料', operators: ENUM_OPERATORS, detail: true, dimension: true, option_source: 'item', baseAlias: 'item_code' },
  { key: 'item_name', label: '物料名称', type: 'text', category: '物料', operators: TEXT_OPERATORS, detail: true, dimension: true, baseAlias: 'item_name' },
  { key: 'spec', label: '规格', type: 'text', category: '物料', operators: TEXT_OPERATORS, detail: true, dimension: true, baseAlias: 'spec' },
  { key: 'unit', label: '单位', type: 'text', category: '物料', operators: TEXT_OPERATORS, detail: true, dimension: true, baseAlias: 'unit' },
  { key: 'category_code', label: '物料大类编号', type: 'enum', category: '物料', operators: ENUM_OPERATORS, detail: true, dimension: true, option_source: 'category', baseAlias: 'category_code' },
  { key: 'category_name', label: '物料大类', type: 'text', category: '物料', operators: TEXT_OPERATORS, detail: true, dimension: true, baseAlias: 'category_name' },
  { key: 'subcategory_code', label: '物料小类编号', type: 'enum', category: '物料', operators: ENUM_OPERATORS, detail: true, dimension: true, option_source: 'category', baseAlias: 'subcategory_code' },
  { key: 'subcategory_name', label: '物料小类', type: 'text', category: '物料', operators: TEXT_OPERATORS, detail: true, dimension: true, baseAlias: 'subcategory_name' },
  { key: 'item_type', label: '物料属性', type: 'enum', category: '物料', operators: ENUM_OPERATORS, detail: true, dimension: true, baseAlias: 'item_type', options: [{ label: '原辅材料', value: '0' }, { label: '半成品', value: '6' }, { label: '成品', value: '9' }] },
  { key: 'batch_no', label: '批次号', type: 'text', category: '明细', operators: TEXT_OPERATORS, detail: true, dimension: true, baseAlias: 'batch_no' },
  { key: 'currency', label: '币种', type: 'text', category: '单据', operators: TEXT_OPERATORS, detail: true, dimension: true, baseAlias: 'currency' },
  { key: 'contract_no', label: '合同号', type: 'text', category: '单据', operators: TEXT_OPERATORS, detail: true, dimension: true, baseAlias: 'contract_no' },
  { key: 'invoice_no', label: '发票号', type: 'text', category: '单据', operators: TEXT_OPERATORS, detail: true, dimension: true, baseAlias: 'invoice_no' },
  { key: 'remark', label: '行备注', type: 'text', category: '明细', operators: TEXT_OPERATORS, detail: true, baseAlias: 'remark' },
  { key: 'qty', label: '数量', type: 'number', category: '金额数量', operators: NUMBER_OPERATORS, detail: true, baseAlias: 'qty' },
  { key: 'price', label: '单价', type: 'amount', category: '金额数量', operators: NUMBER_OPERATORS, detail: true, baseAlias: 'price' },
  { key: purchase ? 'purchase_amount' : 'sales_amount', label: purchase ? '采购金额' : '销售收入', type: 'amount', category: '金额数量', operators: NUMBER_OPERATORS, detail: true, baseAlias: purchase ? 'purchase_amount' : 'sales_amount' },
  { key: 'tax_amount', label: '税额', type: 'amount', category: '金额数量', operators: NUMBER_OPERATORS, detail: true, baseAlias: 'tax_amount' },
  { key: 'discount_amount', label: '折扣额', type: 'amount', category: '金额数量', operators: NUMBER_OPERATORS, detail: true, baseAlias: 'discount_amount' },
  { key: purchase ? 'purchase_cost' : 'cost_amount', label: purchase ? '入库成本' : '销售成本', type: 'amount', category: '金额数量', operators: NUMBER_OPERATORS, detail: true, baseAlias: purchase ? 'purchase_cost' : 'cost_amount' },
  ...(purchase ? [
    { key: 'cost_variance', label: '采购差额', type: 'amount' as const, category: '金额数量', operators: NUMBER_OPERATORS, detail: true, baseAlias: 'profit' },
  ] : []),
  ...(!purchase ? [{ key: 'profit', label: '毛利', type: 'amount' as const, category: '金额数量', operators: NUMBER_OPERATORS, detail: true, baseAlias: 'profit' }] : []),
  ]
}

const dateDimensions: InternalField[] = [
  { key: 'day', label: '日', type: 'date', category: '日期维度', operators: DATE_OPERATORS, dimension: true, baseAlias: "strftime('%Y-%m-%d', doc_date)" },
  { key: 'week', label: '周', type: 'text', category: '日期维度', operators: TEXT_OPERATORS, dimension: true, baseAlias: "strftime('%Y-W%W', doc_date)" },
  { key: 'month', label: '月', type: 'text', category: '日期维度', operators: TEXT_OPERATORS, dimension: true, baseAlias: "strftime('%Y-%m', doc_date)" },
  { key: 'quarter', label: '季度', type: 'text', category: '日期维度', operators: TEXT_OPERATORS, dimension: true, baseAlias: "strftime('%Y', doc_date) || '-Q' || (CAST((CAST(strftime('%m', doc_date) AS INTEGER)-1)/3 AS INTEGER)+1)" },
  { key: 'year', label: '年', type: 'text', category: '日期维度', operators: TEXT_OPERATORS, dimension: true, baseAlias: "strftime('%Y', doc_date)" },
]

function metricsFor(reportKey: TradeReportKey): InternalMetric[] {
  const purchase = reportKey === 'purchase'
  return [
  { key: 'qty', label: purchase ? '采购量' : '销量', type: 'number', aggregateSql: 'ROUND(SUM(qty), 6)' },
  { key: purchase ? 'purchase_amount' : 'sales_amount', label: purchase ? '采购金额' : '销售收入', type: 'amount', aggregateSql: `ROUND(SUM(${purchase ? 'purchase_amount' : 'sales_amount'}), 2)` },
  { key: 'tax_amount', label: '税额', type: 'amount', aggregateSql: 'ROUND(SUM(tax_amount), 2)' },
  { key: 'discount_amount', label: '折扣额', type: 'amount', aggregateSql: 'ROUND(SUM(discount_amount), 2)' },
  { key: purchase ? 'purchase_cost' : 'cost_amount', label: purchase ? '入库成本' : '销售成本', type: 'amount', aggregateSql: `ROUND(SUM(${purchase ? 'purchase_cost' : 'cost_amount'}), 2)` },
  ...(purchase ? [
    { key: 'cost_variance', label: '采购差额', type: 'amount' as const, aggregateSql: 'ROUND(SUM(profit), 2)' },
    { key: 'variance_rate', label: '差额率', type: 'percent' as const, aggregateSql: 'CASE WHEN ABS(SUM(purchase_amount))<0.005 THEN NULL ELSE ROUND(SUM(profit)*100.0/SUM(purchase_amount), 2) END' },
  ] : []),
  ...(!purchase ? [
    { key: 'profit', label: '毛利', type: 'amount' as const, aggregateSql: 'ROUND(SUM(profit), 2)' },
    { key: 'profit_rate', label: '毛利率', type: 'percent' as const, aggregateSql: "CASE WHEN ABS(SUM(sales_amount))<0.005 THEN NULL ELSE ROUND(SUM(profit)*100.0/SUM(sales_amount), 2) END" },
  ] : []),
  { key: 'avg_price', label: purchase ? '平均采购价' : '平均售价', type: 'amount', aggregateSql: `CASE WHEN ABS(SUM(qty))<0.000001 THEN NULL ELSE ROUND(SUM(${purchase ? 'purchase_amount' : 'sales_amount'})/SUM(qty), 2) END` },
  { key: 'document_count', label: '单据数', type: 'integer', aggregateSql: 'COUNT(DISTINCT doc_id)' },
  { key: purchase ? 'supplier_count' : 'customer_count', label: purchase ? '供应商数' : '客户数', type: 'integer', aggregateSql: "COUNT(DISTINCT CASE WHEN COALESCE(partner_code,'')<>'' THEN partner_code END)" },
  { key: 'item_count', label: '物料数', type: 'integer', aggregateSql: "COUNT(DISTINCT CASE WHEN COALESCE(item_code,'')<>'' THEN item_code END)" },
  ]
}

const DEFAULT_DETAIL_FIELDS = ['doc_date', 'doc_no', 'source_type', 'partner_name', 'item_code', 'item_name', 'spec', 'warehouse_name', 'qty', 'price', 'sales_amount', 'cost_amount', 'profit']
const DEFAULT_DIMENSIONS = ['month', 'partner_name']
const DEFAULT_METRICS = ['qty', 'sales_amount', 'cost_amount', 'profit', 'profit_rate']
const PURCHASE_DEFAULT_DETAIL_FIELDS = ['doc_date', 'doc_no', 'source_type', 'partner_name', 'item_code', 'item_name', 'spec', 'warehouse_name', 'qty', 'price', 'purchase_amount', 'purchase_cost', 'cost_variance']
const PURCHASE_DEFAULT_METRICS = ['qty', 'purchase_amount', 'tax_amount', 'purchase_cost', 'avg_price']

const SALES_PROFILE: TradeReportProfile = {
  key: 'sales', docTypes: ['SO', 'SR'], negativeDocType: 'SR', partnerType: 'customer',
  defaultDetailFields: DEFAULT_DETAIL_FIELDS, defaultDimensions: DEFAULT_DIMENSIONS, defaultMetrics: DEFAULT_METRICS,
}
const PURCHASE_PROFILE: TradeReportProfile = {
  key: 'purchase', docTypes: ['PI', 'PR'], negativeDocType: 'PR', partnerType: 'supplier',
  defaultDetailFields: PURCHASE_DEFAULT_DETAIL_FIELDS, defaultDimensions: DEFAULT_DIMENSIONS, defaultMetrics: PURCHASE_DEFAULT_METRICS,
}

function sqlLiteral(value: string) {
  return `'${value.replace(/'/g, "''")}'`
}

function jsonExpression(alias: string, key: string, type: SalesFieldType) {
  const safeKey = key.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  const expr = `json_extract(COALESCE(${alias}.field_values,'{}'), ${sqlLiteral(`$."${safeKey}"`)})`
  return type === 'number' || type === 'amount' ? `CAST(${expr} AS REAL)` : expr
}

function fieldType(raw: string): SalesFieldType {
  if (raw === 'number') return 'number'
  if (raw === 'date') return 'date'
  if (raw === 'select') return 'enum'
  return 'text'
}

function operatorsFor(type: SalesFieldType) {
  if (type === 'number' || type === 'amount' || type === 'integer' || type === 'percent') return NUMBER_OPERATORS
  if (type === 'date') return DATE_OPERATORS
  if (type === 'enum') return ENUM_OPERATORS
  return TEXT_OPERATORS
}

function loadCustomFields(db: Database.Database, accountSetId: string, docTypes: [string, string]) {
  const customSelects: string[] = []
  const customFields: InternalField[] = []
  let index = 0
  const add = (prefix: string, alias: string, row: any, category: string) => {
    const type = fieldType(String(row.field_type || 'text'))
    const baseAlias = `custom_${index++}`
    customSelects.push(`${jsonExpression(alias, String(row.field_key), type)} AS ${baseAlias}`)
    customFields.push({
      key: `${prefix}:${row.field_key}`,
      label: String(row.field_name || row.field_key),
      type,
      category,
      operators: operatorsFor(type),
      detail: true,
      dimension: true,
      baseAlias,
      options: type === 'enum' ? parseOptions(row.options_json) : undefined,
    })
  }

  const docRows = db.prepare(`SELECT position, field_key, MAX(field_name) field_name, MAX(field_type) field_type,
      MAX(options_json) options_json
    FROM scm_doc_field_defs
    WHERE account_set_id=? AND doc_type IN (${docTypes.map(sqlLiteral).join(',')}) AND is_enabled=1 AND COALESCE(is_visible,1)=1
    GROUP BY position, field_key ORDER BY MIN(sort_order), field_key`).all(accountSetId) as any[]
  for (const row of docRows) {
    if (row.position === 'body') add('line_custom', 'l', row, '明细自定义')
    else add('doc_custom', 'd', row, '单据自定义')
  }

  const itemRows = db.prepare(`SELECT field_key, field_name, field_type, options_json
    FROM scm_item_field_defs WHERE account_set_id=? AND is_enabled=1 ORDER BY sort_order, field_key`).all(accountSetId) as any[]
  for (const row of itemRows) add('item_custom', 'i', row, '物料自定义')
  return { customSelects, customFields }
}

function parseOptions(raw: unknown): Array<{ label: string; value: string }> | undefined {
  try {
    const values = Array.isArray(raw) ? raw : JSON.parse(String(raw || '[]'))
    if (!Array.isArray(values)) return undefined
    return values.map(value => typeof value === 'object' && value
      ? { label: String((value as any).label ?? (value as any).value ?? ''), value: String((value as any).value ?? (value as any).label ?? '') }
      : { label: String(value), value: String(value) }).filter(item => item.value)
  } catch { return undefined }
}

function buildContext(db: Database.Database, accountSetId: string, profile: TradeReportProfile, toBase = false) {
  const { customSelects, customFields } = loadCustomFields(db, accountSetId, profile.docTypes)
  // 多币种：折本位币时行金额 × 单据记账汇率（成本本来就是本位币，不再折算）
  const fx = toBase ? '*COALESCE(NULLIF(d.exchange_rate,0),1)' : ''
  const currencySql = toBase ? "'本位币'" : "COALESCE(d.currency,'CNY')"
  const fields = [...standardFields(profile.key), ...customFields]
  const metrics = metricsFor(profile.key)
  const fieldMap = new Map(fields.map(field => [field.key, field]))
  const dimensionMap = new Map([...dateDimensions, ...fields.filter(field => field.dimension)].map(field => [field.key, field]))
  const metricMap = new Map(metrics.map(metric => [metric.key, metric]))
  const customSql = customSelects.length ? `,\n        ${customSelects.join(',\n        ')}` : ''
  const baseSql = `WITH base AS (
      SELECT d.id AS doc_id, l.id AS line_id, d.doc_type AS source_type, d.doc_date, d.doc_no,
        d.partner_code, p.name AS partner_name, p.region_code, p.province, p.city, p.county,
        d.biz_person, d.dept_code,
        COALESCE(l.warehouse_code,d.warehouse_code) AS warehouse_code, w.name AS warehouse_name,
        l.item_code, i.name AS item_name, COALESCE(l.spec,i.spec) AS spec, COALESCE(l.unit,i.unit) AS unit,
        i.category_code, c1.name AS category_name, i.subcategory_code, c2.name AS subcategory_name,
        i.item_type, l.batch_no, ${currencySql} AS currency, d.contract_no, d.invoice_no,
        l.remark, ROUND(COALESCE(l.price,0)${fx},4) AS price,
        (CASE WHEN d.doc_type=${sqlLiteral(profile.negativeDocType)} THEN -1 ELSE 1 END)*COALESCE(l.qty,0) AS qty,
        (CASE WHEN d.doc_type=${sqlLiteral(profile.negativeDocType)} THEN -1 ELSE 1 END)*ROUND(COALESCE(l.amount,0)${fx},2) AS sales_amount,
        (CASE WHEN d.doc_type=${sqlLiteral(profile.negativeDocType)} THEN -1 ELSE 1 END)*ROUND(COALESCE(l.amount,0)${fx},2) AS purchase_amount,
        (CASE WHEN d.doc_type=${sqlLiteral(profile.negativeDocType)} THEN -1 ELSE 1 END)*ROUND(COALESCE(l.tax_amount,0)${fx},2) AS tax_amount,
        (CASE WHEN d.doc_type=${sqlLiteral(profile.negativeDocType)} THEN -1 ELSE 1 END)*ROUND(COALESCE(l.discount_amount,0)${fx},2) AS discount_amount,
        (CASE WHEN d.doc_type=${sqlLiteral(profile.negativeDocType)} THEN -1 ELSE 1 END)*ROUND(COALESCE(l.unit_cost,0)*COALESCE(l.qty,0),2) AS cost_amount,
        (CASE WHEN d.doc_type=${sqlLiteral(profile.negativeDocType)} THEN -1 ELSE 1 END)*ROUND(COALESCE(NULLIF(l.unit_cost,0)*COALESCE(l.qty,0),ROUND(COALESCE(l.amount,0)${fx},2),0),2) AS purchase_cost,
        (CASE WHEN d.doc_type=${sqlLiteral(profile.negativeDocType)} THEN -1 ELSE 1 END)*ROUND(ROUND(COALESCE(l.amount,0)${fx},2)-COALESCE(l.unit_cost,0)*COALESCE(l.qty,0),2) AS profit
        ${customSql}
      FROM scm_doc_line l
      JOIN scm_doc d ON d.id=l.doc_id AND d.account_set_id=l.account_set_id
      LEFT JOIN scm_partner p ON p.account_set_id=d.account_set_id AND p.code=d.partner_code
      LEFT JOIN scm_item i ON i.account_set_id=l.account_set_id AND i.code=l.item_code
      LEFT JOIN scm_warehouse w ON w.account_set_id=l.account_set_id AND w.code=COALESCE(l.warehouse_code,d.warehouse_code)
      LEFT JOIN scm_item_category c1 ON c1.account_set_id=i.account_set_id AND c1.code=i.category_code
      LEFT JOIN scm_item_category c2 ON c2.account_set_id=i.account_set_id AND c2.code=i.subcategory_code
      WHERE d.account_set_id=? AND d.doc_type IN (${profile.docTypes.map(sqlLiteral).join(',')}) AND d.status='audited' AND COALESCE(d.cancel_flag,0)=0
    )`
  return { fields, fieldMap, dimensionMap, metricMap, baseSql }
}

function isCondition(node: any): node is SalesFilterCondition {
  return node && typeof node === 'object' && typeof node.field === 'string' && typeof node.operator === 'string'
}

function escapeLike(value: string) {
  return value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')
}

function compileFilters(
  root: SalesFilterGroup | undefined,
  allowed: Map<string, { baseAlias?: string; key: string; operators?: string[] }>,
  params: unknown[],
) {
  let count = 0
  const visit = (node: SalesFilterGroup | SalesFilterCondition | undefined, depth: number): string => {
    if (!node) return '1=1'
    if (depth > MAX_FILTER_DEPTH) throw new Error(`筛选条件组最多嵌套 ${MAX_FILTER_DEPTH} 层`)
    if (isCondition(node)) {
      count += 1
      if (count > MAX_FILTERS) throw new Error(`筛选条件最多 ${MAX_FILTERS} 条`)
      const field = allowed.get(node.field)
      if (!field) throw new Error(`筛选字段无效：${node.field}`)
      const operator = node.operator
      if (field.operators && !field.operators.includes(operator)) throw new Error(`字段「${node.field}」不支持运算符 ${operator}`)
      const col = field.baseAlias || field.key
      if (operator === 'is_empty') return `(${col} IS NULL OR TRIM(CAST(${col} AS TEXT))='')`
      if (operator === 'not_empty') return `(${col} IS NOT NULL AND TRIM(CAST(${col} AS TEXT))<>'')`
      if (operator === 'between') {
        params.push(node.value ?? '', node.value2 ?? '')
        return `${col} BETWEEN ? AND ?`
      }
      if (operator === 'in' || operator === 'not_in') {
        const values = Array.isArray(node.value) ? node.value : String(node.value ?? '').split(',').map(value => value.trim()).filter(Boolean)
        if (!values.length) return operator === 'in' ? '0=1' : '1=1'
        if (values.length > 100) throw new Error('单个多选条件最多 100 项')
        params.push(...values)
        return `${col} ${operator === 'in' ? 'IN' : 'NOT IN'} (${values.map(() => '?').join(',')})`
      }
      if (operator === 'contains' || operator === 'not_contains' || operator === 'starts_with') {
        const raw = escapeLike(String(node.value ?? ''))
        params.push(operator === 'starts_with' ? `${raw}%` : `%${raw}%`)
        return `${col} ${operator === 'not_contains' ? 'NOT LIKE' : 'LIKE'} ? ESCAPE '\\'`
      }
      const opSql: Record<string, string> = { eq: '=', neq: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=' }
      if (!opSql[operator]) throw new Error(`筛选运算符无效：${operator}`)
      params.push(node.value ?? '')
      return `${col} ${opSql[operator]} ?`
    }
    const children = Array.isArray(node.children) ? node.children : []
    const sqls = children.map(child => visit(child, depth + 1)).filter(Boolean)
    if (!sqls.length) return '1=1'
    return `(${sqls.join(node.logic === 'or' ? ' OR ' : ' AND ')})`
  }
  return visit(root, 0)
}

function normalizeKeys(
  keys: unknown,
  allowed: Map<string, unknown>,
  fallback: string[],
  max: number,
  fallbackOnEmpty = false,
) {
  const input = Array.isArray(keys) ? keys.map(String) : fallback
  const source = fallbackOnEmpty && input.length === 0 ? fallback : input
  const seen = new Set<string>()
  const valid: string[] = []
  const ignored: string[] = []
  for (const key of source) {
    if (seen.has(key)) continue
    seen.add(key)
    if (!allowed.has(key)) ignored.push(key)
    else if (valid.length < max) valid.push(key)
    else ignored.push(key)
  }
  return { valid, ignored }
}

function numericRows(rows: any[], columns: SalesReportColumn[]) {
  const numeric = new Set(columns.filter(column => ['number', 'amount', 'percent', 'integer'].includes(column.type)).map(column => column.key))
  return rows.map(row => {
    const item = { ...row }
    for (const key of numeric) item[key] = item[key] == null ? null : Number(item[key])
    return item
  })
}

function metricSummarySql(selectedMetrics: InternalMetric[], reportKey: TradeReportKey) {
  const amountKey = reportKey === 'purchase' ? 'purchase_amount' : 'sales_amount'
  return selectedMetrics.map(metric => {
    if (metric.key === 'profit_rate') return `CASE WHEN ABS(SUM(${amountKey}))<0.005 THEN NULL ELSE ROUND(SUM(profit)*100.0/SUM(${amountKey}),2) END AS profit_rate`
    if (metric.key === 'cost_variance') return 'ROUND(SUM(profit),2) AS cost_variance'
    if (metric.key === 'variance_rate') return 'CASE WHEN ABS(SUM(purchase_amount))<0.005 THEN NULL ELSE ROUND(SUM(profit)*100.0/SUM(purchase_amount),2) END AS variance_rate'
    if (metric.key === 'avg_price') return `CASE WHEN ABS(SUM(qty))<0.000001 THEN NULL ELSE ROUND(SUM(${amountKey})/SUM(qty),2) END AS avg_price`
    if (metric.key === 'document_count') return 'COUNT(DISTINCT doc_id) AS document_count'
    if (metric.key === 'customer_count' || metric.key === 'supplier_count') return `COUNT(DISTINCT CASE WHEN COALESCE(partner_code,'')<>'' THEN partner_code END) AS ${metric.key}`
    if (metric.key === 'item_count') return "COUNT(DISTINCT CASE WHEN COALESCE(item_code,'')<>'' THEN item_code END) AS item_count"
    return `ROUND(SUM(${metric.key}), ${metric.key === 'qty' ? 6 : 2}) AS ${metric.key}`
  }).join(', ')
}

function groupedSummarySql(selectedMetrics: InternalMetric[]) {
  return selectedMetrics.map(metric => {
    if (metric.key === 'profit_rate') return 'CASE WHEN ABS(SUM(__base_amount))<0.005 THEN NULL ELSE ROUND(SUM(__base_profit)*100.0/SUM(__base_amount),2) END AS profit_rate'
    if (metric.key === 'cost_variance') return 'ROUND(SUM(__base_profit),2) AS cost_variance'
    if (metric.key === 'variance_rate') return 'CASE WHEN ABS(SUM(__base_amount))<0.005 THEN NULL ELSE ROUND(SUM(__base_profit)*100.0/SUM(__base_amount),2) END AS variance_rate'
    if (metric.key === 'avg_price') return 'CASE WHEN ABS(SUM(__base_qty))<0.000001 THEN NULL ELSE ROUND(SUM(__base_amount)/SUM(__base_qty),2) END AS avg_price'
    return `ROUND(SUM(${metric.key}), ${metric.type === 'integer' ? 0 : metric.key === 'qty' ? 6 : 2}) AS ${metric.key}`
  }).join(', ')
}

function getTradeReportMeta(db: Database.Database, accountSetId: string, profile: TradeReportProfile) {
  const ctx = buildContext(db, accountSetId, profile)
  const metrics = metricsFor(profile.key)
  const lookupOptions = new Map<string, Array<{ label: string; value: string }>>([
    ['partner', (db.prepare(`SELECT code value, COALESCE(NULLIF(name,''),code) label FROM scm_partner
      WHERE account_set_id=? AND COALESCE(enabled,1)=1 AND (partner_type=? OR partner_type='both' OR partner_type LIKE ?)
      ORDER BY code LIMIT 2000`).all(accountSetId, profile.partnerType, `%${profile.partnerType}%`) as any[]).map(row => ({ label: `${row.value} ${row.label}`, value: String(row.value) }))],
    ['warehouse', (db.prepare(`SELECT code value, COALESCE(NULLIF(name,''),code) label FROM scm_warehouse
      WHERE account_set_id=? AND COALESCE(enabled,1)=1 ORDER BY code LIMIT 2000`).all(accountSetId) as any[]).map(row => ({ label: `${row.value} ${row.label}`, value: String(row.value) }))],
    ['item', (db.prepare(`SELECT code value, COALESCE(NULLIF(name,''),code) label FROM scm_item
      WHERE account_set_id=? AND COALESCE(enabled,1)=1 ORDER BY code LIMIT 5000`).all(accountSetId) as any[]).map(row => ({ label: `${row.value} ${row.label}`, value: String(row.value) }))],
    ['category', (db.prepare(`SELECT code value, COALESCE(NULLIF(name,''),code) label FROM scm_item_category
      WHERE account_set_id=? ORDER BY code LIMIT 2000`).all(accountSetId) as any[]).map(row => ({ label: `${row.value} ${row.label}`, value: String(row.value) }))],
  ])
  const publicField = ({ baseAlias: _baseAlias, ...field }: InternalField) => ({
    ...field,
    options: field.options || (field.option_source ? lookupOptions.get(field.option_source) : undefined),
  })
  return {
    fields: ctx.fields.map(publicField),
    dimensions: [...dateDimensions, ...ctx.fields.filter(field => field.dimension)].map(publicField),
    metrics: metrics.map(({ aggregateSql: _aggregateSql, ...metric }) => ({ ...metric, operators: NUMBER_OPERATORS })),
    operators: {
      eq: '等于', neq: '不等于', contains: '包含', not_contains: '不包含', starts_with: '开头是',
      gt: '大于', gte: '大于等于', lt: '小于', lte: '小于等于', between: '区间',
      in: '属于', not_in: '不属于', is_empty: '为空', not_empty: '不为空',
    },
    defaults: { detail_fields: profile.defaultDetailFields, dimensions: profile.defaultDimensions, metrics: profile.defaultMetrics },
    limits: { filters: MAX_FILTERS, filter_depth: MAX_FILTER_DEPTH, dimensions: MAX_DIMENSIONS, page_size: MAX_PAGE_SIZE },
  }
}

function runTradeReportQuery(
  db: Database.Database,
  accountSetId: string,
  profile: TradeReportProfile,
  query: SalesReportQuery = {},
  options: { exportAll?: boolean } = {},
): SalesReportResult {
  const ctx = buildContext(db, accountSetId, profile, query.to_base === true)
  const metrics = metricsFor(profile.key)
  const mode: SalesReportMode = query.mode === 'summary' ? 'summary' : 'detail'
  const page = Math.max(1, Math.floor(Number(query.page) || 1))
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(Number(query.page_size) || 100)))
  const baseParams: unknown[] = [accountSetId]
  const filterSql = compileFilters(query.filters, ctx.fieldMap, baseParams)
  const ignored: string[] = []

  if (mode === 'detail') {
    const selected = normalizeKeys(query.fields, ctx.fieldMap, profile.defaultDetailFields, MAX_FIELDS, true)
    ignored.push(...selected.ignored)
    const fields = selected.valid.map(key => ctx.fieldMap.get(key)!)
    const columns: SalesReportColumn[] = fields.map(field => ({ key: field.key, label: field.label, type: field.type, role: 'field' }))
    const selectedSql = [
      ...fields.map(field => `${field.baseAlias} AS "${field.key}"`),
      ...(fields.some(field => field.key === 'doc_no') ? ['doc_id AS _doc_id'] : []),
    ].join(', ')
    const countRow = db.prepare(`${ctx.baseSql} SELECT COUNT(*) total FROM base WHERE ${filterSql}`).get(...baseParams) as any
    const total = Number(countRow?.total || 0)
    if (options.exportAll && total > MAX_SALES_EXPORT_ROWS) throw new Error(`导出行数超过上限（${MAX_SALES_EXPORT_ROWS}），请缩小筛选范围`)
    const allowedSort = new Set(fields.map(field => field.key))
    const sort = buildSort(query.sort, allowedSort, ['doc_date DESC', 'doc_no DESC'])
    const limitSql = options.exportAll ? '' : ' LIMIT ? OFFSET ?'
    const rowsParams = options.exportAll ? baseParams : [...baseParams, pageSize, (page - 1) * pageSize]
    const rows = db.prepare(`${ctx.baseSql} SELECT ${selectedSql} FROM base WHERE ${filterSql} ORDER BY ${sort}${limitSql}`).all(...rowsParams) as any[]
    const summaryMetrics = metrics.filter(metric => profile.defaultMetrics.includes(metric.key) || ['tax_amount', 'discount_amount', 'document_count', 'customer_count', 'supplier_count', 'item_count'].includes(metric.key))
    const summary = db.prepare(`${ctx.baseSql} SELECT ${metricSummarySql(summaryMetrics, profile.key)} FROM base WHERE ${filterSql}`).get(...baseParams) as any
    return { mode, columns, rows: numericRows(rows, columns), summary: normalizeSummary(summary), total, page: options.exportAll ? 1 : page, page_size: options.exportAll ? total : pageSize, ignored_fields: ignored }
  }

  const selectedDims = normalizeKeys(query.dimensions, ctx.dimensionMap, profile.defaultDimensions, MAX_DIMENSIONS)
  const selectedMetrics = normalizeKeys(query.metrics, ctx.metricMap, profile.defaultMetrics, metrics.length, true)
  ignored.push(...selectedDims.ignored, ...selectedMetrics.ignored)
  const dims = selectedDims.valid.map(key => ctx.dimensionMap.get(key)!)
  const metricDefs = selectedMetrics.valid.map(key => ctx.metricMap.get(key)!)
  const dimSql = dims.map(field => `${field.baseAlias} AS "${field.key}"`)
  const metricSql = metricDefs.map(metric => `${metric.aggregateSql} AS "${metric.key}"`)
  const amountKey = profile.key === 'purchase' ? 'purchase_amount' : 'sales_amount'
  const hiddenSummarySql = [
    'ROUND(SUM(qty),6) AS __base_qty',
    `ROUND(SUM(${amountKey}),2) AS __base_amount`,
    'ROUND(SUM(profit),2) AS __base_profit',
  ]
  const selectSql = [...dimSql, ...metricSql, ...hiddenSummarySql].join(', ')
  const groupSql = dims.length ? ` GROUP BY ${dims.map(field => field.baseAlias).join(', ')}` : ''
  const groupedSql = `${ctx.baseSql}, grouped AS (SELECT ${selectSql} FROM base WHERE ${filterSql}${groupSql})`
  const resultMetricMap = new Map(metricDefs.map(metric => [metric.key, { ...metric, operators: NUMBER_OPERATORS }]))
  const resultParams = [...baseParams]
  const resultFilterSql = compileFilters(query.result_filters, resultMetricMap, resultParams)
  const countRow = db.prepare(`${groupedSql} SELECT COUNT(*) total FROM grouped WHERE ${resultFilterSql}`).get(...resultParams) as any
  const total = Number(countRow?.total || 0)
  if (options.exportAll && total > MAX_SALES_EXPORT_ROWS) throw new Error(`导出行数超过上限（${MAX_SALES_EXPORT_ROWS}），请缩小筛选范围`)
  const columns: SalesReportColumn[] = [
    ...dims.map(field => ({ key: field.key, label: field.label, type: field.type, role: 'dimension' as const })),
    ...metricDefs.map(metric => ({ key: metric.key, label: metric.label, type: metric.type, role: 'metric' as const })),
  ]
  const allowedSort = new Set(columns.map(column => column.key))
  const defaultSort = metricDefs.length ? [`${metricDefs[0].key} DESC`] : dims.length ? [`${dims[0].key} ASC`] : ['1 ASC']
  const sort = buildSort(query.sort, allowedSort, defaultSort)
  const limitSql = options.exportAll ? '' : ' LIMIT ? OFFSET ?'
  const rowsParams = options.exportAll ? resultParams : [...resultParams, pageSize, (page - 1) * pageSize]
  const visibleSelectSql = columns.map(column => `"${column.key}"`).join(', ')
  const rows = db.prepare(`${groupedSql} SELECT ${visibleSelectSql} FROM grouped WHERE ${resultFilterSql} ORDER BY ${sort}${limitSql}`).all(...rowsParams) as any[]
  const summary = metricDefs.length
    ? db.prepare(`${groupedSql} SELECT ${groupedSummarySql(metricDefs)} FROM grouped WHERE ${resultFilterSql}`).get(...resultParams) as any
    : {}
  return { mode, columns, rows: numericRows(rows, columns), summary: normalizeSummary(summary), total, page: options.exportAll ? 1 : page, page_size: options.exportAll ? total : pageSize, ignored_fields: ignored }
}

export function getSalesReportMeta(db: Database.Database, accountSetId: string) {
  return getTradeReportMeta(db, accountSetId, SALES_PROFILE)
}

export function getPurchaseReportMeta(db: Database.Database, accountSetId: string) {
  return getTradeReportMeta(db, accountSetId, PURCHASE_PROFILE)
}

export function runSalesReportQuery(db: Database.Database, accountSetId: string, query: SalesReportQuery = {}, options: { exportAll?: boolean } = {}) {
  return runTradeReportQuery(db, accountSetId, SALES_PROFILE, query, options)
}

export function runPurchaseReportQuery(db: Database.Database, accountSetId: string, query: SalesReportQuery = {}, options: { exportAll?: boolean } = {}) {
  return runTradeReportQuery(db, accountSetId, PURCHASE_PROFILE, query, options)
}

function buildSort(sort: SalesReportQuery['sort'], allowed: Set<string>, fallback: string[]) {
  const parts = (Array.isArray(sort) ? sort : []).slice(0, 3).flatMap(item => {
    if (!item || !allowed.has(String(item.key))) return []
    return [`"${String(item.key)}" ${item.direction === 'asc' ? 'ASC' : 'DESC'}`]
  })
  return (parts.length ? parts : fallback).join(', ')
}

function normalizeSummary(row: any) {
  const result: Record<string, number | null> = {}
  for (const [key, value] of Object.entries(row || {})) result[key] = value == null ? null : Number(value)
  return result
}
