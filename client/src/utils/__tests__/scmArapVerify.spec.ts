import { describe, expect, it } from 'vitest'
import { allocateArapAmount, partnerMatchesArapSide, sumArapOpenAmount } from '../scmArapVerify'

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
