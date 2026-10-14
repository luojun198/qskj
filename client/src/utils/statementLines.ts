/**
 * 对账单逐笔明细：决定一条台账行要不要按单据明细展开（第四份反馈 Q1）。
 *
 * 收付款单（PAY / RCV）按明细逐条写台账（applyPayment），每条台账行已带自身金额，
 * 不能再展开整单明细，否则变成「台账行数 × 明细数」重复，合计与期末对不上。
 * 其余单据一张单只写一条台账，按明细展开。
 *
 * 返回 null 表示不展开（调用方按台账行金额出一行）。
 */
export function statementLinesToExpand(
  r: { doc?: { doc_type?: string; lines?: any[] } | null; doc_type?: string },
): any[] | null {
  const doc = r.doc
  if (!doc) return null
  const type = doc.doc_type || r.doc_type
  if (type === 'PAY' || type === 'RCV') return null
  // 组装单：台账只挂加工费，明细是成品/子件的库存数量，展开会把材料当成往来金额
  if (type === 'AS') return null
  return doc.lines && doc.lines.length ? doc.lines : null
}
