import { describe, expect, it } from 'vitest'
import { allocateArapAmount, autoMatchArap, partnerMatchesArapSide, sumArapOpenAmount } from '../scmArapVerify'

const rows = [
  { id: 'A', open_amount: 100 },
  { id: 'B', open_amount: 80 },
]

describe('往来核销金额自动找平', () => {
  it('按顺序分配并让最后一笔自动取部分金额', () => {
    expect(allocateArapAmount(rows, 130)).toEqual({ A: 100, B: 30 })
  })

  it('目标金额超过可核销余额时自动限制为余额合计', () => {
    expect(allocateArapAmount(rows, 999)).toEqual({ A: 100, B: 80 })
  })

  it('忽略负数余额并按分取整', () => {
    const values = [{ id: 'A', open_amount: 10.126 }, { id: 'B', open_amount: -3 }]
    expect(sumArapOpenAmount(values)).toBe(10.13)
    expect(allocateArapAmount(values, 8.238)).toEqual({ A: 8.24, B: 0 })
  })

  it('应收只匹配客户，应付只匹配供应商，双向单位两边均匹配', () => {
    expect(partnerMatchesArapSide({ partner_type: 'customer' }, 'ar')).toBe(true)
    expect(partnerMatchesArapSide({ partner_type: 'customer' }, 'ap')).toBe(false)
    expect(partnerMatchesArapSide({ partner_type: 'supplier' }, 'ar')).toBe(false)
    expect(partnerMatchesArapSide({ partner_type: 'supplier' }, 'ap')).toBe(true)
    expect(partnerMatchesArapSide({ partner_type: 'both' }, 'ar')).toBe(true)
    expect(partnerMatchesArapSide({ partner_type: 'both' }, 'ap')).toBe(true)
  })
})

describe('autoMatchArap 自动勾稽', () => {
  it('金额相等优先一对一配对，不被先进先出打乱', () => {
    const r = autoMatchArap(
      [{ id: 'I1', open_amount: 100, doc_date: '2026-01-01' }, { id: 'I2', open_amount: 300, doc_date: '2026-01-02' }],
      [{ id: 'O1', open_amount: 50, doc_date: '2026-01-01' }, { id: 'O2', open_amount: 300, doc_date: '2026-01-03' }],
    )
    expect(r.matches).toContainEqual({ in_log_id: 'I2', out_log_id: 'O2', amount: 300 })
    expect(r.matches).toContainEqual({ in_log_id: 'I1', out_log_id: 'O1', amount: 50 })
    expect(r.total).toBe(350)
  })

  it('先进先出部分核销，两侧合计找平', () => {
    const r = autoMatchArap(
      [{ id: 'S9', open_amount: 6450, doc_date: '2026-10-10', created_at: '1' }, { id: 'S10', open_amount: 4360, doc_date: '2026-10-10', created_at: '2' }],
      [{ id: 'R', open_amount: 15000, doc_date: '2026-10-10' }],
    )
    expect(r.outAmounts.R).toBe(10810)
    expect(r.inAmounts).toEqual({ S9: 6450, S10: 4360 })
    const r2 = autoMatchArap([{ id: 'S', open_amount: 3870 }], [{ id: 'R', open_amount: 3000 }])
    expect(r2.matches).toEqual([{ in_log_id: 'S', out_log_id: 'R', amount: 3000 }])
  })

  it('不同币别不配对；单侧为空返回空', () => {
    expect(autoMatchArap([{ id: 'I', open_amount: 100, currency: 'USD' }], [{ id: 'O', open_amount: 100, currency: 'CNY' }]).matches).toEqual([])
    expect(autoMatchArap([{ id: 'I', open_amount: 100 }], []).matches).toEqual([])
  })
})
