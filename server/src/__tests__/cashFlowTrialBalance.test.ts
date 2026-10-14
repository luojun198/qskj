import { describe, it, expect } from 'vitest'
import { getCashFlowTrialBalance } from '../services/cashFlowTrialBalance.js'
import { presetCashFlowMapping, updateCashFlowMapRow } from '../services/cashFlowAccountMap.js'
import { createCashFlowTestDb } from './helpers/cashFlowTestDb.js'

function setup(standard?: 'enterprise' | 'government') {
  const t = createCashFlowTestDb(
    standard === 'government'
      ? {
          standard,
          accounts: [
            ['1001', '库存现金', 'debit', 1, 0],
            ['4001', '财政拨款收入', 'credit'],
            ['5001', '业务活动费用', 'debit'],
          ],
        }
      : {}
  )
  presetCashFlowMapping(t.db, t.setId)
  return t
}

describe('cashFlowTrialBalance（按科目现金流量项目自动取数）', () => {
  it('政府制度活动标签为日常活动', () => {
    const t = setup('government')
    const result = getCashFlowTrialBalance(t.db, t.setId, 2026, 5)
    expect(result.meta.activityLabels.operating).toBe('日常活动')
    expect(result.meta.accountingStandardName).toContain('政府')
  })

  it('平衡：现金流量项目净额等于现金科目净变动', () => {
    const t = setup()
    t.voucher([['1001', 'debit', 1000], ['1122', 'credit', 1000]])
    const result = getCashFlowTrialBalance(t.db, t.setId, 2026, 5)
    expect(result.summary.totalNet).toBe(1000)
    expect(result.summary.cashAccountNetChange).toBe(1000)
    expect(result.summary.balanced).toBe(true)
    expect(result.summary.unmatchedCount).toBe(0)
    expect(result.items[0]).toMatchObject({ debitTotal: 1000, creditTotal: 0, signedNet: 1000, voucherCount: 1 })
  })

  it('不平衡：对方科目未设置现金流量项目', () => {
    const t = setup()
    updateCashFlowMapRow(t.db, t.setId, t.accountId('1221'), { main_credit_code: null })
    t.voucher([['1001', 'debit', 500], ['1221', 'credit', 500]], { no: '记-2' })
    const result = getCashFlowTrialBalance(t.db, t.setId, 2026, 5)
    expect(result.summary.balanced).toBe(false)
    expect(result.summary.diff).toBe(-500)
    expect(result.unmatchedCashEntries).toHaveLength(1)
    expect(result.unmatchedCashEntries[0]).toMatchObject({ voucherNo: '记-2', accountCode: '1221' })
  })

  it('include_unposted 统计未记账凭证', () => {
    const t = setup()
    t.voucher([['1001', 'debit', 200], ['1122', 'credit', 200]], { status: 'draft' })
    expect(getCashFlowTrialBalance(t.db, t.setId, 2026, 5, 'month', false).summary.totalNet).toBe(0)
    expect(getCashFlowTrialBalance(t.db, t.setId, 2026, 5, 'month', true).summary.totalNet).toBe(200)
  })
})
