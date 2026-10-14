import { describe, expect, it } from 'vitest'
import { createCashFlowTestDb } from './helpers/cashFlowTestDb.js'
import { computeCashFlowByMapping, getMainItemAmount } from '../services/cashFlowAutoEngine.js'
import {
  computeCashEquivalentIds,
  copyCashFlowMappingToAccountSets,
  getEffectiveCashFlowMapping,
  listCashFlowMapRows,
  loadCashFlowAccounts,
  presetCashFlowMapping,
  resolveMainSlot,
  updateCashFlowMapRow,
  type CashFlowItemLite,
} from '../services/cashFlowAccountMap.js'
import { getCashFlowAmount, getDirectMethodActivityTotals } from '../services/cashFlowAmount.js'

/** 标准项目编码（ensureMainItems 补建的布局） */
const SALES_IN = '1101'
const PURCHASE_OUT = '1201'
const STAFF_OUT = '1202'
const INV_DISPOSE_IN = '2103'
const BORROW_IN = '3102'

function setup() {
  const t = createCashFlowTestDb()
  presetCashFlowMapping(t.db, t.setId)
  return t
}

function run(t: ReturnType<typeof setup>, from = 5, to = 5, includeUnposted = false) {
  return computeCashFlowByMapping(t.db, t.setId, 2026, from, to, undefined, { includeUnposted, collectDetail: true })
}

describe('默认映射', () => {
  it('现金等价物：现金 / 银行勾选科目与其他货币资金（含下级）', () => {
    const t = setup()
    const cash = computeCashEquivalentIds(loadCashFlowAccounts(t.db, t.setId))
    for (const code of ['1001', '1002', '100201', '1012', '101201']) expect(cash.has(t.accountId(code))).toBe(true)
    expect(cash.has(t.accountId('1122'))).toBe(false)
  })

  it('按科目名称预设 4 个项目，下级继承，个税下级单独判', () => {
    const t = setup()
    const m = getEffectiveCashFlowMapping(t.db, t.setId).codes
    expect(m.get(t.accountId('1122'))).toMatchObject({ main_credit_code: SALES_IN, main_debit_code: SALES_IN, supp_credit_code: 'F14', supp_debit_code: 'F14' })
    // 累计折旧只设附表贷方（借方是处置转销，不是折旧）
    expect(m.get(t.accountId('1602'))).toMatchObject({ supp_credit_code: 'F03', supp_debit_code: null })
    expect(m.get(t.accountId('222101'))?.main_debit_code).toBe(m.get(t.accountId('2221'))?.main_debit_code)
    expect(m.get(t.accountId('222112'))?.main_debit_code).toBe(STAFF_OUT)
    expect(m.get(t.accountId('2001'))).toMatchObject({ main_credit_code: BORROW_IN, supp_credit_code: null })
    // 现金类科目不设
    expect(m.has(t.accountId('1002'))).toBe(false)
  })

  it('设置页按类别列出，现金科目标记为现金及现金等价物', () => {
    const t = setup()
    const assets = listCashFlowMapRows(t.db, t.setId, 'asset')
    expect(assets.find(r => r.code === '1002')?.is_cash_equivalent).toBe(true)
    expect(assets.find(r => r.code === '1601')?.category_label).toBe('非流动资产')
    expect(listCashFlowMapRows(t.db, t.setId, 'pl').map(r => r.code)).toContain('6603')
    expect(listCashFlowMapRows(t.db, t.setId, 'cost').map(r => r.code)).toEqual(['5001'])
  })

  it('语义槽位能匹配 ACD 模板里的简称项目', () => {
    const items: CashFlowItemLite[] = [
      ['1101', '销售劳务收现', 'inflow'], ['1102', '其他经营收现', 'inflow'], ['1201', '购货劳务付现', 'outflow'],
      ['1202', '付支职工付现', 'outflow'], ['1203', '各项税费付现', 'outflow'], ['1204', '其他经营活动付现', 'outflow'],
      ['2202', '购建资产付现', 'outflow'], ['3101', '借款收现', 'inflow'], ['3102', '吸收投资收现', 'inflow'],
      ['3201', '偿还借款本金付现', 'outflow'], ['3202', '偿还借款利息付现', 'outflow'], ['3203', '分配利润付现', 'outflow'],
    ].map(([code, name, direction]) => ({ code, name, direction, kind: 'main', is_leaf: 1, parent_code: null }))
    expect(resolveMainSlot('op_in_sales', items)).toBe('1101')
    expect(resolveMainSlot('op_in_tax_refund', items)).toBe('1102')
    expect(resolveMainSlot('op_out_purchase', items)).toBe('1201')
    expect(resolveMainSlot('op_out_staff', items)).toBe('1202')
    expect(resolveMainSlot('inv_out_build', items)).toBe('2202')
    expect(resolveMainSlot('fin_in_borrow', items)).toBe('3101')
    expect(resolveMainSlot('fin_in_invest', items)).toBe('3102')
    expect(resolveMainSlot('fin_out_repay', items)).toBe('3201')
    expect(resolveMainSlot('fin_out_dividend', items)).toBe('3203')
  })
})

describe('主表自动取数', () => {
  it('收款记到对方科目的贷方项目，付款记到借方项目', () => {
    const t = setup()
    t.voucher([['100201', 'debit', 1000], ['1122', 'credit', 1000]])
    t.voucher([['2202', 'debit', 300], ['1002', 'credit', 300]])
    const r = run(t)
    expect(getMainItemAmount(r, SALES_IN)).toBe(1000)
    expect(getMainItemAmount(r, PURCHASE_OUT)).toBe(300)
    expect(r.activities.operating).toBe(700)
    expect(r.cashChange).toBe(700)
    expect(r.unmapped).toHaveLength(0)
  })

  it('现金科目之间互转（含其他货币资金）不产生现金流量', () => {
    const t = setup()
    t.voucher([['1001', 'debit', 50], ['100201', 'credit', 50]])
    t.voucher([['101201', 'debit', 80], ['100201', 'credit', 80]])
    const r = run(t)
    expect(r.main.size).toBe(0)
    expect(r.activities.net).toBe(0)
  })

  it('收款同时扣手续费：流入按实收金额摊给应收，手续费不再记流出', () => {
    const t = setup()
    t.voucher([['100201', 'debit', 98], ['6603', 'debit', 2], ['1122', 'credit', 100]])
    const r = run(t)
    expect(getMainItemAmount(r, SALES_IN)).toBe(98)
    expect(r.activities.net).toBe(98)
  })

  it('发工资代扣个税：付现 900 全部记支付给职工', () => {
    const t = setup()
    t.voucher([['2211', 'debit', 1000], ['1002', 'credit', 900], ['222112', 'credit', 100]])
    const r = run(t)
    expect(getMainItemAmount(r, STAFF_OUT)).toBe(900)
    expect(r.activities.operating).toBe(-900)
  })

  it('多个对方科目按金额占比分摊', () => {
    const t = setup()
    t.voucher([['1002', 'debit', 1500], ['1122', 'credit', 1000], ['1601', 'credit', 500]])
    const r = run(t)
    expect(getMainItemAmount(r, SALES_IN)).toBe(1000)
    expect(getMainItemAmount(r, INV_DISPOSE_IN)).toBe(500)
    expect(r.activities.investing).toBe(500)
  })

  it('红字凭证冲减', () => {
    const t = setup()
    t.voucher([['100201', 'debit', 1000], ['1122', 'credit', 1000]])
    t.voucher([['100201', 'debit', -1000], ['1122', 'credit', -1000]])
    expect(getMainItemAmount(run(t), SALES_IN)).toBe(0)
  })

  it('对方科目未设置项目时进入未设置清单，不计入任何项目', () => {
    const t = setup()
    updateCashFlowMapRow(t.db, t.setId, t.accountId('1221'), { main_credit_code: null })
    t.voucher([['1002', 'debit', 200], ['1221', 'credit', 200]], { no: '记-9' })
    const r = run(t)
    expect(r.activities.net).toBe(0)
    expect(r.cashChange).toBe(200)
    expect(r.unmapped).toEqual([expect.objectContaining({ account_code: '1221', side: 'credit', amount: 200, voucher_count: 1 })])
    expect(r.issues[0]).toMatchObject({ issue: 'missing', side: 'credit', amount: 200 })
  })

  it('只统计已过账凭证，可选含未记账', () => {
    const t = setup()
    t.voucher([['1002', 'debit', 100], ['1122', 'credit', 100]], { status: 'draft' })
    expect(run(t).activities.net).toBe(0)
    expect(run(t, 5, 5, true).activities.net).toBe(100)
  })

  it('不再读取分录上人工填的现金流量编码', () => {
    const t = setup()
    t.voucher([['1002', 'debit', 100], ['1122', 'credit', 100]])
    t.db.prepare(`UPDATE voucher_entries SET cash_flow_code = '3102'`).run()
    const r = run(t)
    expect(getMainItemAmount(r, SALES_IN)).toBe(100)
    expect(getMainItemAmount(r, BORROW_IN)).toBe(0)
  })

  it('@xj_je 与直接法三大活动合计走同一口径，按区间累计', () => {
    const t = setup()
    t.voucher([['1002', 'debit', 100], ['1122', 'credit', 100]], { period: 4 })
    t.voucher([['1002', 'debit', 200], ['2001', 'credit', 200]], { period: 5 })
    expect(getCashFlowAmount(t.db, t.setId, SALES_IN, 2026, 5, 5)).toBe(0)
    expect(getCashFlowAmount(t.db, t.setId, SALES_IN, 2026, 1, 5)).toBe(100)
    const totals = getDirectMethodActivityTotals(t.db, t.setId, 2026, 1, 5)
    expect(totals).toMatchObject({ operating: 100, financing: 200, net: 300, itemsWithData: 2 })
  })

  it('账套尚未保存映射时按默认规则临时推算', () => {
    const t = createCashFlowTestDb()
    presetCashFlowMapping(t.db, t.setId)
    t.db.prepare('DELETE FROM account_cash_flow_map').run()
    t.voucher([['1002', 'debit', 100], ['1122', 'credit', 100]])
    const r = run(t)
    expect(r.persisted).toBe(false)
    expect(getMainItemAmount(r, SALES_IN)).toBe(100)
  })
})

describe('附表（补充资料·间接法）', () => {
  it('净利润 + 调节项 = 主表经营活动净额', () => {
    const t = setup()
    t.voucher([['1122', 'debit', 1000], ['6001', 'credit', 1000]]) // 赊销
    t.voucher([['6401', 'debit', 600], ['1405', 'credit', 600]]) // 结转成本
    t.voucher([['6602', 'debit', 100], ['1602', 'credit', 100]]) // 折旧
    t.voucher([['6702', 'debit', 50], ['1231', 'credit', 50]]) // 计提坏账
    t.voucher([['100201', 'debit', 800], ['1122', 'credit', 800]]) // 收款
    t.voucher([['1403', 'debit', 400], ['2202', 'credit', 400]]) // 赊购
    t.voucher([['2202', 'debit', 300], ['1002', 'credit', 300]]) // 付款
    t.voucher([['6001', 'debit', 1000], ['4103', 'credit', 1000]], { closing: true }) // 结转损益（排除）
    const r = run(t)
    expect(r.netProfit).toBe(250)
    expect(r.supplement.get('F01')).toBe(250)
    expect(r.supplement.get('F17')).toBe(50) // 坏账准备 → 信用减值损失
    expect(r.supplement.get('F03')).toBe(100)
    expect(r.supplement.get('F13')).toBe(200) // 存货：600 减少 − 400 增加
    expect(r.supplement.get('F14')).toBe(-200) // 应收：增加 1000 − 收回 800
    expect(r.supplement.get('F15')).toBe(100) // 应付：增加 400 − 付 300
    expect(r.activities.operating).toBe(500)
    expect(r.indirectOperating).toBe(500)
  })
})

describe('编辑与复制', () => {
  it('附表项目不能填到主表列；可同步到下级', () => {
    const t = setup()
    const bad = updateCashFlowMapRow(t.db, t.setId, t.accountId('2221'), { main_debit_code: 'F15' })
    expect(bad.error).toContain('不是主表项目')
    const ok = updateCashFlowMapRow(t.db, t.setId, t.accountId('2221'), { main_debit_code: PURCHASE_OUT }, true)
    expect(ok.updated).toBe(3)
    const m = getEffectiveCashFlowMapping(t.db, t.setId).codes
    expect(m.get(t.accountId('222112'))?.main_debit_code).toBe(PURCHASE_OUT)
  })

  it('现金科目不能设置', () => {
    const t = setup()
    expect(updateCashFlowMapRow(t.db, t.setId, t.accountId('1002'), { main_credit_code: SALES_IN }).error).toContain('现金')
  })

  it('复制到其他账套：按科目编码对应，缺的科目跳过', () => {
    const t = setup()
    updateCashFlowMapRow(t.db, t.setId, t.accountId('1122'), { main_debit_code: PURCHASE_OUT })
    t.db.exec(`
      INSERT INTO accounts (id, account_set_id, code, name, direction, level) VALUES
        ('b-1122', 'set2', '1122', '应收账款', 'debit', 1),
        ('b-1002', 'set2', '1002', '银行存款', 'debit', 1);
      UPDATE accounts SET is_bank = 1 WHERE id = 'b-1002';
    `)
    const [res] = copyCashFlowMappingToAccountSets(t.db, t.setId, ['set2'])
    expect(res.copied).toBe(1)
    expect(res.skippedAccounts).toBeGreaterThan(10)
    const m = getEffectiveCashFlowMapping(t.db, 'set2').codes
    expect(m.get('b-1122')?.main_debit_code).toBe(PURCHASE_OUT)
  })
})
