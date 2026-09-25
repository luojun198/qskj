import { describe, it, expect } from 'vitest'
import { monthEndDate } from '../monthEnd'

describe('monthEndDate（评审 P2：小计行日期）', () => {
  it('按实际天数取月末', () => {
    expect(monthEndDate('2026-02')).toBe('2026-02-28')
    expect(monthEndDate('2024-02')).toBe('2024-02-29')
    expect(monthEndDate('2026-04')).toBe('2026-04-30')
    expect(monthEndDate('2026-12')).toBe('2026-12-31')
  })
})
