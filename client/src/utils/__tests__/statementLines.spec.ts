import { describe, expect, it } from 'vitest'
import { statementLinesToExpand } from '../statementLines'
import { statementRowSign } from '../statementRowSign'

describe('对账单逐笔明细展开', () => {
  const payLines = [{ amount: 11413 }, { amount: 17063 }, { amount: 30000 }]

  it('付款单多条明细：每条台账行只出一行，合计等于付款总额', () => {
    // 付款单 3 条明细 → 台账 3 行，每行带自身金额（applyPayment 逐条写）
    const ledger = payLines.map(l => ({
      doc_type: 'PAY', settlement_amount: l.amount,
      doc: { id: 'pay-1', doc_type: 'PAY', lines: payLines },
    }))
    let total = 0
    let rows = 0
    for (const r of ledger) {
      const lines = statementLinesToExpand(r)
      expect(lines).toBeNull()
      total += r.settlement_amount * statementRowSign(r)
      rows += 1
    }
    expect(rows).toBe(3)
    expect(total).toBe(-58476)
  })

  it('入库单按明细展开', () => {
    const r = { doc_type: 'PI', doc: { id: 'pi-1', doc_type: 'PI', lines: [{ qty: 50 }, { qty: 50 }] } }
    expect(statementLinesToExpand(r)).toHaveLength(2)
  })

  it('组装单只按台账加工费出一行，不展开成品/子件', () => {
    const r = { doc_type: 'AS', doc: { id: 'as-1', doc_type: 'AS', lines: [{ qty: 10, line_role: 'product' }, { qty: 20 }] } }
    expect(statementLinesToExpand(r)).toBeNull()
  })

  it('没有单据或没有明细时不展开', () => {
    expect(statementLinesToExpand({ doc_type: 'PI', doc: null })).toBeNull()
    expect(statementLinesToExpand({ doc_type: 'PR', doc: { doc_type: 'PR', lines: [] } })).toBeNull()
  })
})
