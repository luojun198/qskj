import { describe, it, expect, vi, afterEach } from 'vitest'
import { todayStr, excelDateToYmd } from '../format'

describe('本地日期工具', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('todayStr 取本地日期而非 UTC 日期（东八区凌晨不会得到昨天）', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 8, 30, 0, 30, 0))
    expect(todayStr()).toBe('2026-09-30')
    vi.setSystemTime(new Date(2026, 8, 30, 23, 59, 59))
    expect(todayStr()).toBe('2026-09-30')
  })

  it('excelDateToYmd 抵消 SheetJS 在东八区读出的「前一天 23:59:17」偏移', () => {
    expect(excelDateToYmd(new Date(2026, 8, 29, 23, 59, 17))).toBe('2026-09-30')
    expect(excelDateToYmd(new Date(2026, 8, 30, 0, 0, 0))).toBe('2026-09-30')
    expect(excelDateToYmd(new Date(2026, 11, 31, 23, 59, 17))).toBe('2027-01-01')
  })
})
