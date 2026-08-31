import { describe, it, expect } from 'vitest'
import {
  formatMoney,
  getVoucherSeq,
  getTypeAbbr,
  statusType,
  statusText,
} from '@/composables/useVoucherAuditData'

describe('useVoucherAuditData', () => {
  it('should format money correctly', () => {
    expect(formatMoney(1000)).toBe('¥1,000.00')
    expect(formatMoney(0)).toBe('¥0.00')
    expect(formatMoney(1234567.89)).toBe('¥1,234,567.89')
  })

  it('should get voucher sequence number', () => {
    expect(getVoucherSeq('记-001')).toBe('1')
    expect(getVoucherSeq('收-123')).toBe('123')
    expect(getVoucherSeq('001')).toBe('1')
  })

  it('should get type abbreviation', () => {
    expect(getTypeAbbr('记账凭证')).toBe('记')
    expect(getTypeAbbr('收款凭证')).toBe('收')
    expect(getTypeAbbr('付款凭证')).toBe('付')
    expect(getTypeAbbr('转账凭证')).toBe('转')
    expect(getTypeAbbr('其他凭证')).toBe('其')
  })

  it('should have correct status mappings', () => {
    expect(statusType.draft).toBe('info')
    expect(statusType.audited).toBe('success')
    expect(statusType.posted).toBe('warning')

    expect(statusText.draft).toBe('草稿')
    expect(statusText.audited).toBe('已审核')
    expect(statusText.posted).toBe('已记账')
  })
})
