export function assertOpeningDebitCreditExclusive(
  openingDebit: number,
  openingCredit: number,
  context?: string
) {
  const normalized = normalizeOpeningDebitCredit(openingDebit, openingCredit)
  const od = Number(openingDebit) || 0
  const oc = Number(openingCredit) || 0
  if (od > 0 && oc > 0) {
    const zeroedSide = normalized.opening_debit === 0 ? '贷方' : '借方'
    const msg = `年初借方与年初贷方不能同时填写（${zeroedSide}已自动清零，借方 ${od}，贷方 ${oc}）`
    throw new Error(context ? `${context}：${msg}` : msg)
  }
}

export function normalizeOpeningDebitCredit(openingDebit: number, openingCredit: number) {
  const od = Number(openingDebit) || 0
  const oc = Number(openingCredit) || 0
  if (od > 0 && oc > 0) {
    if (od >= oc) return { opening_debit: od, opening_credit: 0 }
    return { opening_debit: 0, opening_credit: oc }
  }
  return { opening_debit: od, opening_credit: oc }
}
