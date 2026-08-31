import { describe, expect, it } from 'vitest'
import {
  accumulateParentBalances,
  rollupSignedBalanceToParent,
} from '../services/ledgerQuery.js'

describe('rollupSignedBalanceToParent', () => {
  it('同方向子科目余额相加', () => {
    expect(rollupSignedBalanceToParent(100, 'credit', 'credit')).toBe(100)
    expect(rollupSignedBalanceToParent(200, 'debit', 'debit')).toBe(200)
  })

  it('反方向子科目余额相减', () => {
    expect(rollupSignedBalanceToParent(2600, 'debit', 'credit')).toBe(-2600)
    expect(rollupSignedBalanceToParent(6500, 'credit', 'credit')).toBe(6500)
  })
})

describe('accumulateParentBalances', () => {
  const codeLengths = [4, 3, 3, 2, 2, 2]

  it('应交税费类异方向子科目应轧差汇总到父科目', () => {
    const list = [
      {
        account_code: '2221001',
        direction: 'credit',
        level: 2,
        init_balance: 999,
        current_debit: 0,
        current_credit: 0,
        year_debit: 0,
        year_credit: 0,
        end_balance: 999,
      },
      {
        account_code: '2221001001',
        direction: 'debit',
        level: 3,
        init_balance: 0,
        current_debit: 2600,
        current_credit: 0,
        year_debit: 2600,
        year_credit: 0,
        end_balance: 2600,
      },
      {
        account_code: '2221001005',
        direction: 'credit',
        level: 3,
        init_balance: 0,
        current_debit: 0,
        current_credit: 6500,
        year_debit: 0,
        year_credit: 6500,
        end_balance: 6500,
      },
    ]

    accumulateParentBalances(list, codeLengths)

    const parent = list.find(row => row.account_code === '2221001')
    expect(parent?.end_balance).toBe(3900)
    expect(parent?.current_debit).toBe(2600)
    expect(parent?.current_credit).toBe(6500)
    expect(parent?.init_balance).toBe(0)
  })
})
