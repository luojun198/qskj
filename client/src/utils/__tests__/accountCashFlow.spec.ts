import { describe, expect, it } from 'vitest'
import {
  accountNeedsCashFlowItem,
  isAuxCategoryExcludedFromAccount,
  isAuxCategoryExcludedFromProjectList,
  filterAuxCategoriesForProjectList,
} from '../accountCashFlow'

describe('accountCashFlow', () => {
  it('accountNeedsCashFlowItem 仅 is_cash 或 is_bank', () => {
    expect(accountNeedsCashFlowItem({ is_cash: 1, is_bank: 0, require_cash_flow: 0 })).toBe(true)
    expect(accountNeedsCashFlowItem({ is_cash: 0, is_bank: 1, require_cash_flow: 0 })).toBe(true)
    expect(accountNeedsCashFlowItem({ is_cash: 0, is_bank: 0, require_cash_flow: 1 })).toBe(false)
    expect(accountNeedsCashFlowItem(null)).toBe(false)
  })

  it('isAuxCategoryExcludedFromAccount 排除 cash_flow、fund_source', () => {
    expect(isAuxCategoryExcludedFromAccount('cash_flow')).toBe(true)
    expect(isAuxCategoryExcludedFromAccount('fund_source')).toBe(true)
    expect(isAuxCategoryExcludedFromAccount('dept')).toBe(false)
    expect(isAuxCategoryExcludedFromAccount(undefined)).toBe(false)
  })

  it('核算项目列表排除现金流量与资金来源', () => {
    expect(isAuxCategoryExcludedFromProjectList('cash_flow')).toBe(true)
    expect(isAuxCategoryExcludedFromProjectList('fund_source')).toBe(true)
    const filtered = filterAuxCategoriesForProjectList([
      { code: 'dept', name: '部门' },
      { code: 'cash_flow', name: '现金流量' },
      { code: 'fund_source', name: '资金来源' },
    ])
    expect(filtered).toHaveLength(1)
    expect(filtered[0].code).toBe('dept')
  })
})
