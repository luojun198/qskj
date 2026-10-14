/**
 * 供应链单据列表（GET /scm/docs、/scm/docs/ids）的多级排序白名单。
 * key 与前端 config/scmColumns.ts 的 LIST_ALL_COLS 列 key 一致；表达式统一只依赖别名 d(scm_doc)，
 * 关联取值（往来单位名、仓库名、源单号、凭证号）用相关子查询，这样列表主查询与「翻页 ids」查询都能复用，无需额外 JOIN。
 * 「下推数量 push」由 JS 聚合得到，无法服务端排序，不在白名单内。
 */
import { buildMultiOrderBy, type BuiltOrderBy } from '../utils/multiSort.js'

const sub = (table: string, col: string, own: string, key = 'code') =>
  `(SELECT x.${col} FROM ${table} x WHERE x.account_set_id=d.account_set_id AND x.${key}=d.${own} LIMIT 1)`

const DIRECT_COLS = [
  'doc_no', 'doc_date', 'doc_type', 'biz_person', 'dept_code', 'contract_no', 'payment_type', 'settle_account', 'io_category',
  'transport_method', 'expect_date', 'credit_days', 'due_date', 'invoice_type', 'invoice_no', 'invoice_date', 'currency',
  'exchange_rate', 'discount_rate', 'tax_rate', 'total_qty', 'total_amount', 'total_tax', 'operator', 'maker', 'created_at',
  'auditor', 'audited_at', 'updated_at', 'print_count', 'status', 'remark',
]

export const DOC_LIST_SORT_WHITELIST: Record<string, string> = {
  ...Object.fromEntries(DIRECT_COLS.map(c => [c, `d.${c}`])),
  partner: sub('scm_partner', 'name', 'partner_code'),
  warehouse: sub('scm_warehouse', 'name', 'warehouse_code'),
  dest_warehouse: sub('scm_warehouse', 'name', 'dest_warehouse_code'),
  total_with_tax: '(COALESCE(d.total_amount,0)+COALESCE(d.total_tax,0))',
  source_doc_no: sub('scm_doc', 'doc_no', 'source_doc_id', 'id'),
  voucher_no: sub('vouchers', 'voucher_no', 'voucher_id', 'id'),
}

export const DOC_LIST_NUMERIC_SORT_KEYS: ReadonlySet<string> = new Set([
  'credit_days', 'exchange_rate', 'discount_rate', 'tax_rate', 'total_qty', 'total_amount', 'total_tax', 'total_with_tax', 'print_count',
])

/** 自定义字段列 cf:<字段键>：取 scm_doc.field_values JSON 中的值；字段键只允许字母数字下划线 */
function resolveCustomField(key: string): string | null {
  const m = /^cf:([A-Za-z0-9_]+)$/.exec(key)
  if (!m) return null
  return `(CASE WHEN json_valid(d.field_values) THEN json_extract(d.field_values,'$.${m[1]}') END)`
}

/** 返回完整 `ORDER BY ...`（不含 LIMIT）。未传/无有效排序 → 日期降序、单据号降序（旧行为）。 */
export function buildDocListOrderBy(sort: unknown): BuiltOrderBy {
  return buildMultiOrderBy(sort, {
    whitelist: DOC_LIST_SORT_WHITELIST,
    resolve: resolveCustomField,
    numericKeys: DOC_LIST_NUMERIC_SORT_KEYS,
    defaultOrderBy: 'd.doc_date DESC',
    tieBreakers: ['d.doc_no DESC', 'd.id ASC'],
  })
}
