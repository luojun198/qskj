/** 期初数量规范化：与本位币金额相同的借贷净额口径（见 initBalanceForeign.ts） */
export function calcQuantityInitBalance(
  direction: string,
  qtyOpeningDebit: number,
  qtyOpeningCredit: number,
  qtyPreBookDebit: number,
  qtyPreBookCredit: number
): number {
  const totalDebit = (qtyOpeningDebit || 0) + (qtyPreBookDebit || 0)
  const totalCredit = (qtyOpeningCredit || 0) + (qtyPreBookCredit || 0)
  return direction === 'credit' ? totalCredit - totalDebit : totalDebit - totalCredit
}

export function normalizeQuantityOpeningDebitCredit(
  qtyOpeningDebit?: number | null,
  qtyOpeningCredit?: number | null
): { qty_opening_debit: number; qty_opening_credit: number } {
  const od = Number(qtyOpeningDebit) || 0
  const oc = Number(qtyOpeningCredit) || 0
  if (od !== 0 && oc !== 0) {
    // 与本位币一致：同时有借贷时净额化到单侧
    const net = od - oc
    return {
      qty_opening_debit: net > 0 ? net : 0,
      qty_opening_credit: net < 0 ? -net : 0,
    }
  }
  return { qty_opening_debit: od, qty_opening_credit: oc }
}
