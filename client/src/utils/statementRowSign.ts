/**
 * 对账单明细行的金额/数量方向（FIX-214）。
 *
 * 台账行的 increase / settlement / adjustment 是后端 enrichStatementRows 已按业务性质拆开的口径：
 *  - 发货/入库/发票（增加项）      → +1
 *  - 收款/付款（结算项）           → −1
 *  - 退货等调整项（direction=out）→ −1
 * 页面与打印页共用，保证「期末 = 期初 + Σ明细金额」成立；原实现有明细行的单据一律按正数计入，
 * 收付款、退货被当成增加项，合计与期初/期末不勾稽。
 */
export function statementRowSign(r: { doc_type?: string; direction?: string; settlement_amount?: number; adjustment_amount?: number }): 1 | -1 {
  if (Number(r.settlement_amount) > 0) return -1
  if (Number(r.adjustment_amount) > 0) return -1
  if (r.doc_type === 'RCV' || r.doc_type === 'PAY' || r.doc_type === 'SR' || r.doc_type === 'PR') return -1
  if (r.direction === 'out') return -1
  return 1
}
