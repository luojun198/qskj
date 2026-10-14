import { describe, it, expect } from 'vitest'
import { getCashFlowVoucherCheck } from '../services/cashFlowVoucherCheck.js'
import { presetCashFlowMapping, updateCashFlowMapRow } from '../services/cashFlowAccountMap.js'
import { createCashFlowTestDb } from './helpers/cashFlowTestDb.js'

function setup() {
  const t = createCashFlowTestDb()
  presetCashFlowMapping(t.db, t.setId)
  return t
}

describe('cashFlowVoucherCheck（检查对方科目的现金流量项目设置）', () => {
  it('全部设置时 issueCount 为 0', () => {
    const t = setup()
    t.voucher([['1002', 'debit', 100], ['1122', 'credit', 100]])
    const r = getCashFlowVoucherCheck(t.db, t.setId, 2026, 5)
    expect(r.summary).toMatchObject({ totalCashEntries: 1, issueCount: 0, passed: true })
  })

  it('检出对方科目未设置主表项目', () => {
    const t = setup()
    updateCashFlowMapRow(t.db, t.setId, t.accountId('2202'), { main_debit_code: null })
    t.voucher([['2202', 'debit', 300], ['1002', 'credit', 300]], { no: '记-7' })
    const r = getCashFlowVoucherCheck(t.db, t.setId, 2026, 5)
    expect(r.summary.missingCount).toBe(1)
    expect(r.missingEntries[0]).toMatchObject({ voucherNo: '记-7', accountCode: '2202', direction: 'debit', amount: 300 })
    expect(r.missingEntries[0].issueLabel).toContain('借方')
  })

  it('检出设置的项目已停用', () => {
    const t = setup()
    t.voucher([['1002', 'debit', 100], ['1122', 'credit', 100]])
    t.db.prepare(`UPDATE cash_flow_items SET is_active = 0 WHERE code = '1101'`).run()
    const r = getCashFlowVoucherCheck(t.db, t.setId, 2026, 5)
    expect(r.summary.invalidCodeCount).toBe(1)
    expect(r.invalidCodeEntries[0].cashFlowCode).toBe('1101')
  })

  it('未启用现金流时不检查', () => {
    const t = setup()
    t.db.prepare(`UPDATE system_params SET param_value = 'false' WHERE param_key = 'enable_cash_flow'`).run()
    t.voucher([['1002', 'debit', 100], ['1221', 'credit', 100]])
    expect(getCashFlowVoucherCheck(t.db, t.setId, 2026, 5).summary.passed).toBe(true)
  })
})
