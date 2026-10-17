import { describe, it, expect } from 'vitest'
import { shouldShowCurrencyHeader, SCM_FX_DOC_TYPES } from '../scmCurrencyHeader'

describe('shouldShowCurrencyHeader', () => {
  it('采购 / 销售类单据即使字段配置为空也显示币别', () => {
    for (const t of SCM_FX_DOC_TYPES) expect(shouldShowCurrencyHeader(t, new Set(), new Set())).toBe(true)
    expect(SCM_FX_DOC_TYPES).toEqual(expect.arrayContaining(['PQ', 'PO', 'PI', 'PR', 'RP', 'SQ', 'SOa', 'SO', 'SR', 'RS']))
  })
  it('配置里带 currency 的类型（收付款单）显示', () => {
    expect(shouldShowCurrencyHeader('PAY', new Set(['currency']), new Set())).toBe(true)
  })
  it('库存类单据默认不显示', () => {
    expect(shouldShowCurrencyHeader('OI', new Set(['partner', 'warehouse']), new Set())).toBe(false)
    expect(shouldShowCurrencyHeader('TR', new Set(), new Set())).toBe(false)
  })
  it('用户隐藏了 currency 则一律不显示', () => {
    expect(shouldShowCurrencyHeader('PO', new Set(), new Set(['currency']))).toBe(false)
    expect(shouldShowCurrencyHeader('PAY', new Set(['currency']), new Set(['currency']))).toBe(false)
  })
})
