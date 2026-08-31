import { describe, expect, it } from 'vitest'
import {
  getIncomeExpenseTransferAccounts,
  getProfitLossTransferAccounts,
  type AutoTransferAccount,
} from '../services/autoTransfer.js'

const acc = (
  code: string,
  name: string,
  direction: 'debit' | 'credit'
): AutoTransferAccount => ({
  id: `acc-${code}`,
  code,
  name,
  direction,
})

/** 一个跨准则混合的科目表（实际使用中只会出现其中一套） */
const MIXED: AutoTransferAccount[] = [
  // 企业准则
  acc('6001', '主营业务收入', 'credit'),
  acc('6051', '其他业务收入', 'credit'),
  acc('6301', '营业外收入', 'credit'),
  acc('6401', '主营业务成本', 'debit'),
  acc('6601', '销售费用', 'debit'),
  acc('6602', '管理费用', 'debit'),
  acc('6603', '财务费用', 'debit'),
  acc('6711', '营业外支出', 'debit'),
  acc('4103', '本年利润', 'credit'),
  acc('4001', '实收资本', 'credit'),
  // 小企业准则
  acc('5001', '主营业务收入', 'credit'),
  acc('5401', '主营业务成本', 'debit'),
  acc('5501', '营业费用', 'debit'),
  acc('3131', '本年利润', 'credit'),
  // 政府会计制度
  acc('4001-gov', '财政拨款收入', 'credit'),
  acc('3201', '本期盈余', 'credit'),
  // 资产负债类（应不被识别）
  acc('1001', '库存现金', 'debit'),
  acc('1002', '银行存款', 'debit'),
  acc('2001', '应付账款', 'credit'),
]

describe('FIX-005 / P0-7 getProfitLossTransferAccounts', () => {
  it('enterprise：识别 6xxx 科目，按方向区分收入/费用，默认平衡科目 4103', () => {
    const { incomeAccounts, expenseAccounts, balanceAccount } = getProfitLossTransferAccounts(
      MIXED,
      { standard: 'enterprise' }
    )
    const incomeCodes = incomeAccounts.map(a => a.code).sort()
    const expenseCodes = expenseAccounts.map(a => a.code).sort()
    expect(incomeCodes).toEqual(['6001', '6051', '6301'])
    expect(expenseCodes).toEqual(['6401', '6601', '6602', '6603', '6711'])
    expect(balanceAccount?.code).toBe('4103')
  })

  it('enterprise：4103 不存在时回退到 4101', () => {
    const accs = MIXED.filter(a => a.code !== '4103').concat([acc('4101', '本年利润', 'credit')])
    const { balanceAccount } = getProfitLossTransferAccounts(accs, { standard: 'enterprise' })
    expect(balanceAccount?.code).toBe('4101')
  })

  it('small_business：识别 5xxx 科目，默认平衡科目 3131', () => {
    const { incomeAccounts, expenseAccounts, balanceAccount } = getProfitLossTransferAccounts(
      MIXED,
      { standard: 'small_business' }
    )
    expect(incomeAccounts.map(a => a.code).sort()).toEqual(['5001'])
    expect(expenseAccounts.map(a => a.code).sort()).toEqual(['5401', '5501'])
    expect(balanceAccount?.code).toBe('3131')
  })

  it('small_business：3131 不存在时回退到 3103', () => {
    const accs = MIXED.filter(a => a.code !== '3131').concat([acc('3103', '本年利润', 'credit')])
    const { balanceAccount } = getProfitLossTransferAccounts(accs, { standard: 'small_business' })
    expect(balanceAccount?.code).toBe('3103')
  })

  it('government：识别 4xxx + 5xxx，默认平衡科目 3201', () => {
    const govAccs: AutoTransferAccount[] = [
      acc('4001', '财政拨款收入', 'credit'),
      acc('4101', '事业收入', 'credit'),
      acc('5001', '业务活动费用', 'debit'),
      acc('5101', '单位管理费用', 'debit'),
      acc('3201', '本期盈余', 'credit'),
      acc('1001', '库存现金', 'debit'),
    ]
    const { incomeAccounts, expenseAccounts, balanceAccount } = getProfitLossTransferAccounts(
      govAccs,
      { standard: 'government' }
    )
    expect(incomeAccounts.map(a => a.code).sort()).toEqual(['4001', '4101'])
    expect(expenseAccounts.map(a => a.code).sort()).toEqual(['5001', '5101'])
    expect(balanceAccount?.code).toBe('3201')
  })

  it('government：3201 不存在时回退到 3001 累计盈余', () => {
    const govAccs: AutoTransferAccount[] = [
      acc('4001', '财政拨款收入', 'credit'),
      acc('5001', '业务活动费用', 'debit'),
      acc('3001', '累计盈余', 'credit'),
    ]
    const { balanceAccount } = getProfitLossTransferAccounts(govAccs, { standard: 'government' })
    expect(balanceAccount?.code).toBe('3001')
  })

  it('preferredTargetCodes 优先匹配，覆盖默认平衡科目', () => {
    const { balanceAccount } = getProfitLossTransferAccounts(MIXED, {
      standard: 'enterprise',
      preferredTargetCodes: ['4001'], // 强制指向实收资本（仅测试优先级语义）
    })
    expect(balanceAccount?.code).toBe('4001')
  })

  it('preferredTargetCodes 中含不存在的编码时跳过，回退默认', () => {
    const { balanceAccount } = getProfitLossTransferAccounts(MIXED, {
      standard: 'enterprise',
      preferredTargetCodes: ['9999', '4103'],
    })
    expect(balanceAccount?.code).toBe('4103')
  })

  it('全表无任何匹配时返回 null', () => {
    const accs: AutoTransferAccount[] = [acc('1001', '库存现金', 'debit')]
    const { incomeAccounts, expenseAccounts, balanceAccount } = getProfitLossTransferAccounts(accs, {
      standard: 'enterprise',
    })
    expect(incomeAccounts).toEqual([])
    expect(expenseAccounts).toEqual([])
    expect(balanceAccount).toBeNull()
  })

  it('旧 API getIncomeExpenseTransferAccounts 保持政府制度行为（向后兼容）', () => {
    const govAccs: AutoTransferAccount[] = [
      acc('4001', '财政拨款收入', 'credit'),
      acc('5001', '业务活动费用', 'debit'),
      acc('3001', '累计盈余', 'credit'),
    ]
    const { incomeAccounts, expenseAccounts, balanceAccount } =
      getIncomeExpenseTransferAccounts(govAccs)
    expect(incomeAccounts.map(a => a.code)).toEqual(['4001'])
    expect(expenseAccounts.map(a => a.code)).toEqual(['5001'])
    expect(balanceAccount?.code).toBe('3001')
  })
})
