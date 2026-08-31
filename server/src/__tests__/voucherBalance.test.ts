import { describe, it, expect } from 'vitest'
import {
  calculateVoucherTotals,
  calculateVoucherTotalsCents,
  getVoucherBalanceError,
  isVoucherBalanced,
  type VoucherEntryInput,
} from '../services/voucherEntry.js'

const entry = (
  direction: 'debit' | 'credit',
  amount: number,
  amount_cents?: number
): VoucherEntryInput =>
  ({
    account_id: 'a',
    account_code: '1001',
    account_name: 'X',
    direction,
    amount,
    ...(amount_cents !== undefined ? { amount_cents } : {}),
  }) as any

describe('凭证借贷平衡（FIX-001 / P0-6）', () => {
  it('简单 100 元借 / 100 元贷应平衡', () => {
    const entries = [entry('debit', 100), entry('credit', 100)]
    expect(getVoucherBalanceError(entries)).toBeNull()
    expect(isVoucherBalanced(entries)).toBe(true)
  })

  it('多笔小数累加（旧浮点实现会失败）：0.1 × 10 vs 1.00', () => {
    // 旧实现：0.1+0.1+...+0.1 = 0.9999999999999999，与 1.0 比较时 abs=1.11e-16 < 0.005 通过
    // 但当总额放大到几百笔分录，累积误差可能超过 MONEY_EPSILON
    const entries: VoucherEntryInput[] = []
    for (let i = 0; i < 10; i++) entries.push(entry('debit', 0.1))
    entries.push(entry('credit', 1.0))
    expect(getVoucherBalanceError(entries)).toBeNull()
    expect(isVoucherBalanced(entries)).toBe(true)
  })

  it('300 笔 0.01 元借 vs 3.00 元贷应严格平衡', () => {
    const entries: VoucherEntryInput[] = []
    for (let i = 0; i < 300; i++) entries.push(entry('debit', 0.01))
    entries.push(entry('credit', 3.0))
    expect(isVoucherBalanced(entries)).toBe(true)
  })

  it('1 分差错必须被识别', () => {
    const entries = [entry('debit', 100.0), entry('credit', 99.99)]
    expect(isVoucherBalanced(entries)).toBe(false)
    expect(getVoucherBalanceError(entries)).toContain('借贷不平衡')
  })

  it('优先使用 amount_cents（amount 字段被故意写错也仍按 cents 判平衡）', () => {
    // amount_cents 是权威，amount 显示用
    const entries = [
      entry('debit', 9999, 10000), // 实际 100.00 元
      entry('credit', 0, 10000),
    ]
    expect(isVoucherBalanced(entries)).toBe(true)
  })

  it('amount_cents 缺失时回退到 yuanToCents(amount)', () => {
    const entries = [entry('debit', 33.33), entry('credit', 33.33)]
    expect(isVoucherBalanced(entries)).toBe(true)
  })

  it('calculateVoucherTotals 返回元单位且基于 cents（不会出现 .999999）', () => {
    const entries: VoucherEntryInput[] = []
    for (let i = 0; i < 10; i++) entries.push(entry('debit', 0.1))
    for (let i = 0; i < 10; i++) entries.push(entry('credit', 0.1))
    const { debitTotal, creditTotal } = calculateVoucherTotals(entries)
    expect(debitTotal).toBe(1)
    expect(creditTotal).toBe(1)
  })

  it('calculateVoucherTotalsCents 返回整数', () => {
    const entries = [entry('debit', 12.34), entry('credit', 12.34)]
    const { debitCents, creditCents } = calculateVoucherTotalsCents(entries)
    expect(debitCents).toBe(1234)
    expect(creditCents).toBe(1234)
  })

  it('错误金额（NaN/字符串）转换为 0 cents，不影响其他分录', () => {
    const entries: VoucherEntryInput[] = [
      entry('debit', NaN as any),
      entry('debit', 50),
      entry('credit', 50),
    ]
    expect(isVoucherBalanced(entries)).toBe(true)
  })
})
