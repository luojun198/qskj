import { describe, it, expect } from 'vitest'
import { compareVoucherTypeCode, getVoucherTypeSortKey } from '../voucherTypeSort'

describe('voucherTypeSort', () => {
  it('纯数字编码按数值升序', () => {
    expect(compareVoucherTypeCode('1', '2')).toBeLessThan(0)
    expect(compareVoucherTypeCode('10', '2')).toBeGreaterThan(0)
  })

  it('纯数字编码优先于非数字编码', () => {
    expect(compareVoucherTypeCode('2', 'A')).toBeLessThan(0)
    expect(getVoucherTypeSortKey('1')[0]).toBeLessThan(getVoucherTypeSortKey('A')[0])
  })

  it('空编码排在有编码之后', () => {
    expect(compareVoucherTypeCode('1', '')).toBeLessThan(0)
    expect(compareVoucherTypeCode('', 'A')).toBeGreaterThan(0)
  })
})
