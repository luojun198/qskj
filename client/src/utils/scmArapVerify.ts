export interface ArapVerifyRow {
  id: string
  open_amount: number
}

export interface ArapPartnerLike {
  partner_type?: string
}

export const roundArapAmount = (value: number) => Math.round((Number(value) || 0) * 100) / 100

export function sumArapOpenAmount(rows: ArapVerifyRow[]) {
  return roundArapAmount(rows.reduce((total, row) => total + Math.max(0, Number(row.open_amount) || 0), 0))
}

/** 按列表顺序分配目标核销额，最后一笔自动取部分金额，使合计精确找平。 */
export function allocateArapAmount(rows: ArapVerifyRow[], targetAmount: number) {
  const result: Record<string, number> = {}
  let remaining = Math.min(Math.max(0, roundArapAmount(targetAmount)), sumArapOpenAmount(rows))

  for (const row of rows) {
    const amount = Math.min(Math.max(0, Number(row.open_amount) || 0), remaining)
    result[row.id] = roundArapAmount(amount)
    remaining = roundArapAmount(remaining - amount)
  }

  return result
}

export function arapPartnerRole(partner: ArapPartnerLike): 'customer' | 'supplier' | 'both' {
  const type = String(partner?.partner_type || '').trim().toLowerCase()
  if (!type || type === 'both' || type === '双向' || type === '3') return 'both'
  if (/customer|客户|^1$/.test(type)) return 'customer'
  if (/supplier|供应|^2$/.test(type)) return 'supplier'
  return 'both'
}

export function partnerMatchesArapSide(partner: ArapPartnerLike, side: 'ar' | 'ap') {
  const role = arapPartnerRole(partner)
  return role === 'both' || role === (side === 'ar' ? 'customer' : 'supplier')
}
