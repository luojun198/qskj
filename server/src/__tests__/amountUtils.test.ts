import { describe, expect, it } from 'vitest'
import { yuanToCents, centsToYuan, MONEY_EPSILON } from '../utils/amountUtils.js'

describe('FIX-019 / P2-30 yuanToCents 异常输入防护', () => {
  it('正常元数值转换为整数分', () => {
    expect(yuanToCents(0)).toBe(0)
    expect(yuanToCents(1)).toBe(100)
    expect(yuanToCents(12.34)).toBe(1234)
    expect(yuanToCents(0.01)).toBe(1)
    expect(yuanToCents(0.005)).toBe(1) // 半分四舍五入
  })

  it('浮点累积误差不影响（Math.round 兜底）', () => {
    expect(yuanToCents(0.1 + 0.2)).toBe(30)
    expect(yuanToCents(99.99)).toBe(9999)
  })

  it('负数照常处理（上层校验拒绝负数分录，此处仍数学正确）', () => {
    expect(yuanToCents(-1.23)).toBe(-123)
  })

  it('NaN → 0（不再返回 NaN 污染整数字段）', () => {
    expect(yuanToCents(NaN)).toBe(0)
  })

  it('Infinity / -Infinity → 0', () => {
    expect(yuanToCents(Infinity)).toBe(0)
    expect(yuanToCents(-Infinity)).toBe(0)
  })

  it('字符串 / 对象 / undefined / null → 0', () => {
    expect(yuanToCents('abc' as any)).toBe(0)
    expect(yuanToCents({} as any)).toBe(0)
    expect(yuanToCents(undefined as any)).toBe(0)
    expect(yuanToCents(null as any)).toBe(0)
  })

  it('数字字符串通过 Number() 转换', () => {
    expect(yuanToCents('12.34' as any)).toBe(1234)
  })

  it('centsToYuan 与 yuanToCents 互为反函数（在精度范围内）', () => {
    for (const yuan of [0, 1, 12.34, 100, 0.01, 1234567.89]) {
      expect(centsToYuan(yuanToCents(yuan))).toBeCloseTo(yuan, 2)
    }
  })

  it('MONEY_EPSILON 仍为 0.005', () => {
    expect(MONEY_EPSILON).toBe(0.005)
  })
})
