import { describe, it, expect } from 'vitest'
import { parseLooseDate, quickDateRange } from '../looseDate'

const REF = new Date(2026, 9, 9) // 2026-10-09

describe('parseLooseDate 宽松日期解析', () => {
  it.each([
    ['2026-10-01', '2026-10-01'],
    ['2026/1/5', '2026-01-05'],
    ['2026.1.5', '2026-01-05'],
    ['2026年1月5日', '2026-01-05'],
    ['20260105', '2026-01-05'],
    ['1-5', '2026-01-05'],
    ['12/31', '2026-12-31'],
    ['0105', '2026-01-05'],
    ['5', '2026-10-05'],
    ['31', '2026-10-31'],
    ['', ''],
  ])('%s → %s', (input, expected) => {
    expect(parseLooseDate(input, REF)).toBe(expected)
  })

  it.each(['2026-02-30', '13-01', '32', 'abc', '2026-1'])('非法日期 %s 返回 null', input => {
    expect(parseLooseDate(input, REF)).toBeNull()
  })
})

describe('quickDateRange 快捷日期', () => {
  it('本月 / 上月 / 本季 / 本年 取整区间', () => {
    expect(quickDateRange('month', REF)).toEqual(['2026-10-01', '2026-10-31'])
    expect(quickDateRange('lastMonth', REF)).toEqual(['2026-09-01', '2026-09-30'])
    expect(quickDateRange('quarter', REF)).toEqual(['2026-10-01', '2026-12-31'])
    expect(quickDateRange('year', REF)).toEqual(['2026-01-01', '2026-12-31'])
  })

  it('本周为周一到周日', () => {
    expect(quickDateRange('week', REF)).toEqual(['2026-10-05', '2026-10-11'])
  })

  it('上月跨年', () => {
    expect(quickDateRange('lastMonth', new Date(2026, 0, 15))).toEqual(['2025-12-01', '2025-12-31'])
  })
})
