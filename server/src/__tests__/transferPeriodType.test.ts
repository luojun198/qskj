import { describe, expect, it } from 'vitest'
import {
  isYearlyTransferDue,
  isYearlyTransferTypeName,
  resolveTransferPeriodType,
} from '../utils/transferPeriodType.js'

describe('transferPeriodType', () => {
  it('识别年末/年度类名称', () => {
    expect(isYearlyTransferTypeName('结转盈余(年末)')).toBe(true)
    expect(isYearlyTransferTypeName('年度结转')).toBe(true)
    expect(isYearlyTransferTypeName('收入结转')).toBe(false)
  })

  it('名称含年度时兜底为 yearly', () => {
    expect(
      resolveTransferPeriodType({ period_type: 'monthly', name: '年度结转' })
    ).toBe('yearly')
    expect(
      resolveTransferPeriodType({ period_type: 'yearly', name: '收入结转' })
    ).toBe('yearly')
  })

  it('非 12 月年度结转视为未到期', () => {
    expect(isYearlyTransferDue(5, { period_type: 'monthly', name: '年度结转' })).toBe(true)
    expect(isYearlyTransferDue(12, { period_type: 'monthly', name: '年度结转' })).toBe(false)
    expect(isYearlyTransferDue(5, { period_type: 'yearly', name: '收入结转' })).toBe(true)
    expect(isYearlyTransferDue(5, { period_type: 'monthly', name: '收入结转' })).toBe(false)
  })
})
