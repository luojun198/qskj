import { describe, expect, it } from 'vitest'
import {
  applyEntryToSignedBalance,
  calcInitBalanceFromDebitCredit,
  calcSignedBalance,
  resolveBalanceDisplayDirection,
} from '../utils/accountBalance.js'

describe('accountBalance', () => {
  it('借方科目：期初 + 借 - 贷', () => {
    expect(calcSignedBalance('debit', 100, 50, 20)).toBe(130)
    expect(calcSignedBalance('debit', 100, 20, 50)).toBe(70)
  })

  it('贷方科目：期初 + 贷 - 借', () => {
    expect(calcSignedBalance('credit', 200, 30, 80)).toBe(250)
    expect(calcSignedBalance('credit', 200, 100, 30)).toBe(130)
  })

  it('分录增量应区分科目方向', () => {
    expect(applyEntryToSignedBalance(100, 40, 'debit', 'debit')).toBe(140)
    expect(applyEntryToSignedBalance(100, 40, 'credit', 'debit')).toBe(60)
    expect(applyEntryToSignedBalance(200, 40, 'credit', 'credit')).toBe(240)
    expect(applyEntryToSignedBalance(200, 40, 'debit', 'credit')).toBe(160)
  })

  it('期初借贷应结合科目方向', () => {
    expect(calcInitBalanceFromDebitCredit('debit', 100, 0)).toBe(100)
    expect(calcInitBalanceFromDebitCredit('credit', 0, 200)).toBe(200)
    expect(calcInitBalanceFromDebitCredit('credit', 100, 0)).toBe(-100)
    expect(calcInitBalanceFromDebitCredit('debit', 0, 0, 88)).toBe(88)
  })

  it('展示方向应反映有符号余额', () => {
    expect(resolveBalanceDisplayDirection(50, 'debit')).toBe('debit')
    expect(resolveBalanceDisplayDirection(-50, 'debit')).toBe('credit')
    expect(resolveBalanceDisplayDirection(50, 'credit')).toBe('credit')
    expect(resolveBalanceDisplayDirection(-50, 'credit')).toBe('debit')
  })
})
