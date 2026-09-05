import { describe, expect, it } from 'vitest'
import {
  validateVoucherEntryAmounts,
  MAX_ENTRY_AMOUNT,
  type VoucherEntryInput,
} from '../services/voucherEntry.js'

const entry = (amount: number, account_name = 'X'): VoucherEntryInput =>
  ({
    account_id: 'a',
    account_code: '1001',
    account_name,
    direction: 'debit',
    amount,
  }) as any

describe('FIX-010 / P1-14 分录金额合法性校验（已放开负数，见凭证冲红功能）', () => {
  it('合法金额（小数、整数、接近上限）通过', () => {
    expect(
      validateVoucherEntryAmounts([entry(0.01), entry(100), entry(1234.56), entry(1e11)])
    ).toBeNull()
  })

  it('0 元分录被拒绝', () => {
    const err = validateVoucherEntryAmounts([entry(100), entry(0, '银行存款')])
    expect(err).toContain('第2行')
    expect(err).toContain('银行存款')
    expect(err).toContain('不能为 0')
  })

  it('不足半分的金额按 0 处理被拒绝', () => {
    const err = validateVoucherEntryAmounts([entry(0.004, '零头')])
    expect(err).toContain('零头')
    expect(err).toContain('不能为 0')
  })

  it('负数金额通过（红字 / 冲红凭证）', () => {
    expect(validateVoucherEntryAmounts([entry(-50, '应付账款')])).toBeNull()
    expect(validateVoucherEntryAmounts([entry(-0.01), entry(-1234.56)])).toBeNull()
  })

  it('负数超过单笔上限（绝对值）被拒绝', () => {
    const err = validateVoucherEntryAmounts([entry(-(MAX_ENTRY_AMOUNT + 1), '大红字')])
    expect(err).toContain('大红字')
    expect(err).toContain('超过单笔上限')
  })

  it('NaN 金额被拒绝', () => {
    const err = validateVoucherEntryAmounts([entry(NaN, '坏数据')])
    expect(err).toContain('坏数据')
    expect(err).toContain('无效')
  })

  it('Infinity 金额被拒绝', () => {
    const err = validateVoucherEntryAmounts([entry(Infinity)])
    expect(err).toContain('无效')
  })

  it('超过单笔上限被拒绝', () => {
    const err = validateVoucherEntryAmounts([entry(MAX_ENTRY_AMOUNT + 1, '大金额')])
    expect(err).toContain('大金额')
    expect(err).toContain('超过单笔上限')
  })

  it('恰好等于上限的金额通过（边界）', () => {
    expect(validateVoucherEntryAmounts([entry(MAX_ENTRY_AMOUNT)])).toBeNull()
    expect(validateVoucherEntryAmounts([entry(-MAX_ENTRY_AMOUNT)])).toBeNull()
  })

  it('空数组直接通过（其他校验函数处理空分录）', () => {
    expect(validateVoucherEntryAmounts([])).toBeNull()
  })

  it('错误位置（行号）准确指向首个非法分录', () => {
    const err = validateVoucherEntryAmounts([entry(100), entry(200), entry(0), entry(50)])
    expect(err).toContain('第3行')
  })

  it('用 account_code 兜底显示（无 account_name 时）', () => {
    const e = entry(0)
    e.account_name = ''
    const err = validateVoucherEntryAmounts([e])
    expect(err).toContain('1001')
  })
})
