/** 年初借方/贷方互斥：仅允许一方有金额；双方同时有值时保留较大一方 */
export function normalizeOpeningDebitCredit(
  opening_debit: number,
  opening_credit: number
): { opening_debit: number; opening_credit: number } {
  const od = opening_debit || 0
  const oc = opening_credit || 0
  if (od > 0.005 && oc > 0.005) {
    if (od >= oc) return { opening_debit: od, opening_credit: 0 }
    return { opening_debit: 0, opening_credit: oc }
  }
  return { opening_debit: od, opening_credit: oc }
}

export function applyOpeningDebitChange(
  row: { opening_debit: number; opening_credit: number },
  val: number | null | undefined
) {
  const n = val ?? 0
  row.opening_debit = n
  if (n > 0.005) row.opening_credit = 0
}

export function applyOpeningCreditChange(
  row: { opening_debit: number; opening_credit: number },
  val: number | null | undefined
) {
  const n = val ?? 0
  row.opening_credit = n
  if (n > 0.005) row.opening_debit = 0
}

/** 与 server calcInitBalanceFromAmounts 一致 */
export function calcInitBalanceFromAmounts(
  direction: string,
  openingDebit: number,
  openingCredit: number,
  preBookDebit: number,
  preBookCredit: number
) {
  const initDebit = (openingDebit || 0) + (preBookDebit || 0)
  const initCredit = (openingCredit || 0) + (preBookCredit || 0)
  const initBalance =
    direction === 'credit' ? initCredit - initDebit : initDebit - initCredit
  return { initDebit, initCredit, initBalance }
}
