import { describe, expect, it } from 'vitest'
import { validateStaticCashFlowReport } from '../services/cashFlowReconciliation.js'

describe('validateStaticCashFlowReport', () => {
  it('三大活动净额与现金净增加额一致时通过', () => {
    const result = validateStaticCashFlowReport({
      operatingActivities: { 净额: 100 },
      investingActivities: { 净额: -20 },
      financingActivities: { 净额: 30 },
      netCashChange: 110,
      beginCash: 1000,
      endCash: 1110,
      cashBalanceCheck: true,
    })
    expect(result.isValid).toBe(true)
    expect(result.warnings.filter(w => w.severity === 'error')).toHaveLength(0)
  })

  it('三大活动合计与净增加额不一致时报错', () => {
    const result = validateStaticCashFlowReport({
      operatingActivities: { 净额: 100 },
      investingActivities: { 净额: 0 },
      financingActivities: { 净额: 0 },
      netCashChange: 50,
      beginCash: 0,
      endCash: 50,
      cashBalanceCheck: true,
    })
    expect(result.isValid).toBe(false)
    expect(result.warnings.some(w => w.type === 'cashflow_sum_mismatch')).toBe(true)
  })

  it('期初+净额≠期末时报错', () => {
    const result = validateStaticCashFlowReport({
      operatingActivities: { 净额: 10 },
      investingActivities: { 净额: 0 },
      financingActivities: { 净额: 0 },
      netCashChange: 10,
      beginCash: 100,
      endCash: 200,
      cashBalanceCheck: false,
    })
    expect(result.isValid).toBe(false)
    expect(result.warnings.some(w => w.type === 'cash_balance_mismatch')).toBe(true)
  })
})

// getDirectMethodActivityTotals 改为按科目现金流量项目自动取数，用例见 cashFlowAutoEngine.test.ts
