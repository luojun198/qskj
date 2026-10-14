/** 对账单「单据类型」分组与排序：屏幕、打印页共用，保证三端口径一致 */
export const STATEMENT_DOC_GROUPS = [
  { value: 'stock', label: '出入库单', types: ['SO', 'PI', 'WI', 'OP'] },
  { value: 'return', label: '退货单', types: ['SR', 'PR'] },
  { value: 'invoice', label: '发票', types: ['RS', 'RP'] },
  { value: 'process', label: '加工费', types: ['AS'] },
  { value: 'payment', label: '收付款单', types: ['RCV', 'PAY'] },
]

const PAYMENT_TYPES = new Set(['RCV', 'PAY'])

/** 按单据类型分组过滤（空=全部）；paymentTop=true 时收付款单稳定地排到最前，其余保持原顺序 */
export function filterStatementDetail<T extends { doc_type?: string }>(
  detail: T[],
  groups: string[],
  paymentTop = false,
): T[] {
  let rows = detail
  if (groups.length) {
    const allowed = new Set(STATEMENT_DOC_GROUPS.filter(g => groups.includes(g.value)).flatMap(g => g.types))
    rows = rows.filter(r => allowed.has(String(r.doc_type)))
  }
  if (paymentTop) {
    const pay = rows.filter(r => PAYMENT_TYPES.has(String(r.doc_type)))
    const rest = rows.filter(r => !PAYMENT_TYPES.has(String(r.doc_type)))
    rows = [...pay, ...rest]
  }
  return rows
}

const PREF_KEY = 'scm_arap_stmt_pref_v1'
export interface StatementPref { groups: string[]; paymentTop: boolean }

/** 按往来单位记住过滤偏好（有的客户不需要显示付款信息）；storage 不可用时静默忽略 */
export function loadStatementPref(partnerCode: string): StatementPref | null {
  if (!partnerCode) return null
  try {
    const all = JSON.parse(localStorage.getItem(PREF_KEY) || '{}')
    const p = all[partnerCode]
    if (!p) return null
    return { groups: Array.isArray(p.groups) ? p.groups.map(String) : [], paymentTop: !!p.paymentTop }
  } catch { return null }
}
export function saveStatementPref(partnerCode: string, pref: StatementPref): void {
  if (!partnerCode) return
  try {
    const all = JSON.parse(localStorage.getItem(PREF_KEY) || '{}')
    all[partnerCode] = pref
    localStorage.setItem(PREF_KEY, JSON.stringify(all))
  } catch { /* ignore */ }
}
