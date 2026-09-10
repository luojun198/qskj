/** 外币期初金额规范化：与本位币相同的借贷净额口径 */
export function calcForeignInitBalance(
  direction: string,
  foreignOpeningDebit: number,
  foreignOpeningCredit: number,
  foreignPreBookDebit: number,
  foreignPreBookCredit: number
): number {
  const totalDebit = (foreignOpeningDebit || 0) + (foreignPreBookDebit || 0)
  const totalCredit = (foreignOpeningCredit || 0) + (foreignPreBookCredit || 0)
  return direction === 'credit' ? totalCredit - totalDebit : totalDebit - totalCredit
}

export function normalizeForeignOpeningDebitCredit(
  foreignOpeningDebit?: number | null,
  foreignOpeningCredit?: number | null
): { foreign_opening_debit: number; foreign_opening_credit: number } {
  const od = Number(foreignOpeningDebit) || 0
  const oc = Number(foreignOpeningCredit) || 0
  if (od !== 0 && oc !== 0) {
    // 与本位币一致：同时有借贷时净额化到单侧
    const net = od - oc
    return {
      foreign_opening_debit: net > 0 ? net : 0,
      foreign_opening_credit: net < 0 ? -net : 0,
    }
  }
  return { foreign_opening_debit: od, foreign_opening_credit: oc }
}
