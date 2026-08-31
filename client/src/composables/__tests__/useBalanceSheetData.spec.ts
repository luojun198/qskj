import { describe, it, expect } from 'vitest'
import { formatAmount } from '@/composables/useBalanceSheetData'

describe('useBalanceSheetData', () => {
  it('should format amount correctly', () => {
    expect(formatAmount(1000)).toBe('1,000.00')
    expect(formatAmount(0)).toBe('—')
    expect(formatAmount(null)).toBe('—')
    expect(formatAmount(undefined)).toBe('—')
    expect(formatAmount(1234567.89)).toBe('1,234,567.89')
  })

  it('should format negative amounts', () => {
    expect(formatAmount(-1000)).toBe('-1,000.00')
  })

  it('should handle decimal precision', () => {
    expect(formatAmount(100.5)).toBe('100.50')
    expect(formatAmount(100.123)).toBe('100.12')
  })
})
