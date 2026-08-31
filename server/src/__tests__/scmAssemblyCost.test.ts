import { describe, it, expect } from 'vitest'
import { allocateAsProductCost } from '../routes/scmDoc.js'

/**
 * 组装单（AS 成品行模式）多成品成本分摊：
 *  - 分组模式：每条子件带 product_group，各成品单价 = 本组子件成本 / 成品数量（互不混）。
 *  - 旧单：子件无分组 → byGroup=false，调用方走「全池 / 成品总数」摊。
 */
describe('allocateAsProductCost · 组装单按成品归集', () => {
  it('2 成品各带不同子件 → 各成品单价按各自子件精确计算，互不混', () => {
    // 成品A（组1，10台）子件：M1 20×单价10 = 200 → A 单价 20
    // 成品B（组2，5台）子件：M2 15×单价20 = 300 → B 单价 60
    const products = [
      { product_group: 1, qty: 10 },
      { product_group: 2, qty: 5 },
    ]
    const comps = [
      { product_group: 1, qty: 20, unitCost: 10 },
      { product_group: 2, qty: 15, unitCost: 20 },
    ]
    const { byGroup, unitCostByGroup } = allocateAsProductCost(products, comps)
    expect(byGroup).toBe(true)
    expect(unitCostByGroup.get(1)).toBe(20)   // 200 / 10
    expect(unitCostByGroup.get(2)).toBe(60)   // 300 / 5
  })

  it('同一成品多条子件累加；小数四舍五入到 4 位', () => {
    // 成品A（组1，3台）：M1 2×10=20 + M2 1×15=15 → 35/3 = 11.6667
    const { byGroup, unitCostByGroup } = allocateAsProductCost(
      [{ product_group: 1, qty: 3 }],
      [
        { product_group: 1, qty: 2, unitCost: 10 },
        { product_group: 1, qty: 1, unitCost: 15 },
      ],
    )
    expect(byGroup).toBe(true)
    expect(unitCostByGroup.get(1)).toBe(11.6667)
  })

  it('子件无分组（旧单）→ byGroup=false，交由调用方全池摊', () => {
    const { byGroup, unitCostByGroup } = allocateAsProductCost(
      [{ product_group: null, qty: 10 }],
      [{ product_group: null, qty: 20, unitCost: 10 }],
    )
    expect(byGroup).toBe(false)
    expect(unitCostByGroup.size).toBe(0)
  })

  it('部分子件无分组（不完整）→ byGroup=false（不做半吊子归集）', () => {
    const { byGroup } = allocateAsProductCost(
      [{ product_group: 1, qty: 10 }, { product_group: 2, qty: 5 }],
      [
        { product_group: 1, qty: 20, unitCost: 10 },
        { product_group: null, qty: 15, unitCost: 20 },
      ],
    )
    expect(byGroup).toBe(false)
  })

  it('子件组号匹配不到任何成品 → byGroup=false', () => {
    const { byGroup } = allocateAsProductCost(
      [{ product_group: 1, qty: 10 }],
      [{ product_group: 9, qty: 20, unitCost: 10 }],
    )
    expect(byGroup).toBe(false)
  })
})
