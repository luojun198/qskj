import { describe, expect, it } from 'vitest'
import {
  formatAccountDisplayLabel,
  formatRowLabel,
  formatVoucherDisplayLabel,
  isUuidLike,
} from '../utils/displayLabel.js'

describe('displayLabel', () => {
  it('formatAccountDisplayLabel 优先展示名称（编码）', () => {
    expect(formatAccountDisplayLabel({ code: '1002', name: '银行存款' })).toBe('银行存款（1002）')
    expect(formatAccountDisplayLabel(null, 3)).toBe('第 3 行')
  })

  it('formatVoucherDisplayLabel 展示凭证号与日期', () => {
    expect(formatVoucherDisplayLabel({ voucher_no: '记-001', voucher_date: '2026-05-01' })).toBe(
      '记-001（2026-05-01）'
    )
    expect(formatVoucherDisplayLabel({ voucher_no: '记-002' })).toBe('记-002')
  })

  it('formatRowLabel 与 isUuidLike', () => {
    expect(formatRowLabel(5)).toBe('第 5 行')
    expect(isUuidLike('694dff76-9b72-4963-9f62-d1c8fc3f3ed8')).toBe(true)
    expect(isUuidLike('1002')).toBe(false)
  })
})
