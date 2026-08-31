export type PurchaseOrderPushLine = {
  id: string
  supplier_code?: string | null
  currency?: string | null
  qty: number
  pushed_qty: number
  [key: string]: unknown
}

export type PurchaseReceiptDraftGroup = {
  partner_code: string | null
  currency: string
  lines: Array<PurchaseOrderPushLine & { source_line_id: string; qty: number }>
}

const round6 = (value: number) => Math.round(value * 1_000_000) / 1_000_000

/** scm_doc 不存 push_progress；该值只能由来源行实时汇总得出。 */
export function purchaseOrderPushSourceSql(): string {
  return 'SELECT id,doc_no,doc_type,status,partner_code,currency FROM scm_doc'
}

/** 以每条订单行的实时剩余量构建采购入库草稿分组。 */
export function buildPurchaseReceiptDraftGroups(lines: PurchaseOrderPushLine[]): PurchaseReceiptDraftGroup[] {
  const groups = new Map<string, PurchaseReceiptDraftGroup>()
  for (const line of lines) {
    const remain = round6(Math.max(0, Number(line.qty || 0) - Number(line.pushed_qty || 0)))
    if (remain <= 0) continue
    const partnerCode = line.supplier_code ? String(line.supplier_code) : null
    const currency = String(line.currency || 'CNY')
    const key = `${partnerCode || ''}\u0000${currency}`
    const group = groups.get(key) || { partner_code: partnerCode, currency, lines: [] }
    group.lines.push({ ...line, source_line_id: line.id, qty: remain })
    groups.set(key, group)
  }
  return [...groups.values()]
}
