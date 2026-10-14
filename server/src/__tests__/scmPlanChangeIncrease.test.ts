/**
 * 客户反馈（润衡云测试）：工单变更加大用量后自动列出追加物料，生成缺料单。
 */
import { describe, it, expect } from 'vitest'
import { computeMaterialIncrease, suggestIncreaseQty, type PlanSnapshot } from '../services/scmPlanChange.js'

const snap = (planQty: number, lines: Array<[string, number, number?]>): PlanSnapshot => ({
  head: {},
  products: [{ id: 'P', item_code: 'FG', plan_qty: planQty, lines: lines.map(([item_code, qty, scrap_rate]) => ({ item_code, qty, scrap_rate: scrap_rate || 0 })) }],
})

describe('工单变更追加物料需求', () => {
  it('计划数 100 → 120：每种用料按单位用量 × 增量追加；损耗率计入', () => {
    const r = computeMaterialIncrease(snap(100, [['0101', 1], ['0102', 3], ['0302', 1, 10]]), snap(120, [['0101', 1], ['0102', 3], ['0302', 1, 10]]))
    expect(r).toEqual([
      { item_code: '0101', before_need: 100, after_need: 120, increase: 20 },
      { item_code: '0102', before_need: 300, after_need: 360, increase: 60 },
      { item_code: '0302', before_need: 110, after_need: 132, increase: 22 },
    ])
  })
  it('新增用料全额追加；减少或删除的用料不出现', () => {
    const r = computeMaterialIncrease(snap(100, [['0101', 2], ['0103', 1]]), snap(100, [['0101', 1], ['0104', 0.5]]))
    expect(r).toEqual([{ item_code: '0104', before_need: 0, after_need: 50, increase: 50 }])
  })

  it('建议追加量：库存先扣其他占用与本计划未发完用量，剩余再抵减增量', () => {
    // 计划 50 → 100，每件 1 个；已发 30，原未发 20；库存 35、其他占用 5 → 可用 10，建议追加 40
    expect(suggestIncreaseQty({ increase: 50, before_need: 50, issued: 30, stock: 35, other_reserved: 5 }))
      .toEqual({ open_need: 20, free_stock: 10, suggest_qty: 40 })
    // 库存不够原未发用量时，增量全额追加
    expect(suggestIncreaseQty({ increase: 50, before_need: 50, issued: 0, stock: 20, other_reserved: 0 }).suggest_qty).toBe(50)
    // 库存充足时无需追加
    expect(suggestIncreaseQty({ increase: 50, before_need: 50, issued: 50, stock: 80, other_reserved: 0 }).suggest_qty).toBe(0)
  })
})
