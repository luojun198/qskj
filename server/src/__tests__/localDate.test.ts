import { describe, it, expect } from 'vitest'
import { todayStr, excelDateToYmd } from '../utils/localDate.js'

describe('localDate 本地日期工具', () => {
  it('todayStr 取本地日期而非 UTC 日期（东八区凌晨不会得到昨天）', () => {
    expect(todayStr(new Date(2026, 8, 30, 0, 30, 0))).toBe('2026-09-30')
    expect(todayStr(new Date(2026, 8, 30, 23, 59, 59))).toBe('2026-09-30')
    expect(todayStr(new Date(2026, 0, 1, 0, 0, 1))).toBe('2026-01-01')
  })

  it('excelDateToYmd 抵消 SheetJS 在东八区读出的「前一天 23:59:17」偏移', () => {
    // 2026-09-30 的 Excel 日期被读成 09-29 23:59:17
    expect(excelDateToYmd(new Date(2026, 8, 29, 23, 59, 17))).toBe('2026-09-30')
    // 无偏移的 0 点日期保持不变
    expect(excelDateToYmd(new Date(2026, 8, 30, 0, 0, 0))).toBe('2026-09-30')
    // 跨月 / 跨年
    expect(excelDateToYmd(new Date(2026, 11, 31, 23, 59, 17))).toBe('2027-01-01')
  })
})
