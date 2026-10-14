export type PurchaseOrderPushLine = {
  id: string
  supplier_code?: string | null
  currency?: string | null
  qty: number
  pushed_qty: number
  /** 来源订单表头仓库 / 税率：行上为空时兜底，组内一致时写入入库单表头 */
  source_header_wh?: string | null
  source_header_tax?: number | null
  [key: string]: unknown
}

export type PurchaseReceiptDraftGroup = {
  partner_code: string | null
  currency: string
  /** 组内所有行（兜底后）仓库一致时的公共仓库，否则 null */
  warehouse_code: string | null
  /** 组内所有来源订单表头税率一致时的公共税率，否则 null */
  tax_rate: number | null
  lines: Array<PurchaseOrderPushLine & { source_line_id: string; qty: number }>
}

const round6 = (value: number) => Math.round(value * 1_000_000) / 1_000_000

/** scm_doc 不存 push_progress；该值只能由来源行实时汇总得出。 */
export function purchaseOrderPushSourceSql(): string {
  return 'SELECT id,doc_no,doc_type,status,partner_code,currency,warehouse_code,tax_rate FROM scm_doc'
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
    const group = groups.get(key) || { partner_code: partnerCode, currency, warehouse_code: null, tax_rate: null, lines: [] }
    const headerWh = line.source_header_wh ? String(line.source_header_wh) : null
    const headerTax = line.source_header_tax == null || (line.source_header_tax as unknown) === '' ? null : Number(line.source_header_tax)
    const lineTax = line.tax_rate == null || line.tax_rate === '' ? headerTax : Number(line.tax_rate)
    group.lines.push({ ...line, source_line_id: line.id, qty: remain, warehouse_code: (line.warehouse_code as string) || headerWh, tax_rate: lineTax })
    groups.set(key, group)
  }
  for (const group of groups.values()) {
    group.warehouse_code = commonValue(group.lines.map(l => (l.warehouse_code as string) || null))
    const taxes = group.lines.map(l => l.source_header_tax == null || (l.source_header_tax as unknown) === '' ? null : Number(l.source_header_tax))
    group.tax_rate = commonValue(taxes) as number | null
  }
  return [...groups.values()]
}

function commonValue<T>(values: Array<T | null>): T | null {
  if (!values.length || values[0] == null) return null
  return values.every(v => v === values[0]) ? values[0] : null
}
