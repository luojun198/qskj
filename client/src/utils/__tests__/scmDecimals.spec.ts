import { describe, it, expect } from 'vitest'
import { clampSetting, formatDecimal, parseDecimals, resolveDecimals, DEFAULT_DECIMALS } from '../scmDecimals'

describe('进销存小数位设置', () => {
  it('未设置时取默认位数', () => {
    expect(parseDecimals(null)).toBeNull()
    expect(parseDecimals('')).toBeNull()
    expect(resolveDecimals(null, 'SOa')).toEqual(DEFAULT_DECIMALS)
  })

  it('范围设置覆盖统一设置，未单独设置的项跟随统一设置', () => {
    const cfg = parseDecimals(JSON.stringify({ default: { qty: 2, price: 4, amount: 2 }, types: { SOa: { qty: 0 }, stock: { price: 6 } } }))
    expect(resolveDecimals(cfg, 'SOa')).toEqual({ qty: 0, price: 4, amount: 2 })
    expect(resolveDecimals(cfg, 'stock')).toEqual({ qty: 2, price: 6, amount: 2 })
    expect(resolveDecimals(cfg, 'PI')).toEqual({ qty: 2, price: 4, amount: 2 })
  })

  it('越界与非法值收敛到允许范围（金额最多 2 位）', () => {
    expect(clampSetting({ qty: 9, price: -1, amount: 4 })).toEqual({ qty: 6, price: 0, amount: 2 })
    expect(clampSetting({ qty: 'x' as any })).toEqual(DEFAULT_DECIMALS)
  })

  it('格式化：设置后固定位数；未设置时数量 / 单价去掉末尾 0', () => {
    expect(formatDecimal(45000, 2, { fixed: true })).toBe('45,000.00')
    expect(formatDecimal(0.003972, 4, { fixed: true, grouping: false })).toBe('0.0040')
    expect(formatDecimal(120000, 3, { fixed: false, trimWhenAuto: true })).toBe('120,000')
    expect(formatDecimal(0.003972, 4, { fixed: false, trimWhenAuto: true, grouping: false })).toBe('0.003972')
    expect(formatDecimal('abc', 2)).toBe('')
  })
})
