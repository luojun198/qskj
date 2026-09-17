import { describe, it, expect } from 'vitest'
import { groupDeprHistoryByPeriod, reverseBlockReason } from '../deprHistory'

const rows = [
  { year: 2026, month: 7, month_depr: 100, voucher_no: '记-1', voucher_status: 'posted' },
  { year: 2026, month: 7, month_depr: 50.005, voucher_no: '记-1', voucher_status: 'posted' },
  { year: 2026, month: 8, month_depr: 120, voucher_no: null, voucher_status: null },
  { year: 2026, month: 9, month_depr: 130, voucher_no: '记-3', voucher_status: 'draft' },
]

describe('groupDeprHistoryByPeriod', () => {
  it('按期间分组、合计四舍五入、最新期在前', () => {
    const groups = groupDeprHistoryByPeriod(rows)
    expect(groups.map(g => g.period)).toEqual(['2026-09', '2026-08', '2026-07'])
    expect(groups[2]).toMatchObject({ count: 2, total: 150.01, voucherNo: '记-1', voucherStatus: 'posted' })
    expect(groups[1]).toMatchObject({ count: 1, total: 120, voucherNo: null, voucherStatus: null })
  })

  it('空数据返回空数组', () => {
    expect(groupDeprHistoryByPeriod([])).toEqual([])
  })
})

describe('reverseBlockReason', () => {
  it('只有最新期可反折旧', () => {
    const groups = groupDeprHistoryByPeriod(rows)
    expect(reverseBlockReason(groups[0], groups)).toBeNull()
    expect(reverseBlockReason(groups[1], groups)).toContain('2026-09')
  })

  it('最新期凭证已记账时拦截', () => {
    const groups = groupDeprHistoryByPeriod(rows.slice(0, 2))
    expect(reverseBlockReason(groups[0], groups)).toContain('已记账')
  })
})
