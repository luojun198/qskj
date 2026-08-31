import { describe, expect, it } from 'vitest'
import { buildSalesOrderAvailabilityLines, hasBatchDispatchRemaining, type SalesOrderAvailabilitySourceRow } from '../services/scmSalesOrderAvailability.js'

function row(overrides: Partial<SalesOrderAvailabilitySourceRow> = {}): SalesOrderAvailabilitySourceRow {
  return {
    id: 'SO-L1',
    item_code: '9005',
    warehouse_code: 'W1',
    qty: 10,
    pushed_qty: 0,
    on_hand: 0,
    other_reserved: 0,
    source_type: 'self',
    ...overrides,
  }
}

describe('销售订单成品层库存处理', () => {
  it('库存充足时全部可发且无成品缺口', () => {
    const [line] = buildSalesOrderAvailabilityLines([row({ on_hand: 10 })], [])
    expect(line).toMatchObject({ remain: 10, available: 10, ship_qty: 10, gross_short: 0, short_qty: 0 })
  })

  it('超发比例只放宽手工上限，不增加默认发货和缺料需求', () => {
    const [line] = buildSalesOrderAvailabilityLines([row({ on_hand: 20 })], [], { overrunRate: 10 })
    expect(line).toMatchObject({
      remain: 10,
      base_remaining: 10,
      max_allowed_qty: 11,
      overrun_remaining: 11,
      ship_qty: 10,
      gross_short: 0,
    })

    const [completed] = buildSalesOrderAvailabilityLines([
      row({ pushed_qty: 10, on_hand: 5 }),
    ], [], { overrunRate: 10 })
    expect(completed).toMatchObject({
      remain: 0,
      base_remaining: 0,
      max_allowed_qty: 11,
      overrun_remaining: 1,
      ship_qty: 0,
      gross_short: 0,
    })
  })

  it('部分库存只将剩余成品数量作为缺口', () => {
    const [line] = buildSalesOrderAvailabilityLines([row({ on_hand: 6, other_reserved: 2 })], [])
    expect(line).toMatchObject({ available: 4, ship_qty: 4, gross_short: 6, short_qty: 6 })
  })

  it('相同物料多行共用库存池，库存不重复占用', () => {
    const lines = buildSalesOrderAvailabilityLines([
      row({ id: 'SO-L1', qty: 6, on_hand: 8 }),
      row({ id: 'SO-L2', qty: 6, on_hand: 8 }),
    ], [])
    expect(lines.map(line => [line.ship_qty, line.short_qty])).toEqual([[6, 0], [2, 4]])
  })

  it('只扣减同物料同仓库的已生成成品缺料量', () => {
    const [covered] = buildSalesOrderAvailabilityLines([row()], [{ item_code: '9005', wh: 'W1', qty: 7 }])
    const [restored] = buildSalesOrderAvailabilityLines([row()], [])
    const [legacyMaterial] = buildSalesOrderAvailabilityLines([row()], [{ item_code: 'RAW-1', wh: 'W1', qty: 10 }])
    expect(covered.short_qty).toBe(3)
    expect(restored.short_qty).toBe(10)
    expect(legacyMaterial.short_qty).toBe(10)
  })

  it('保留销售订单行的含税单价与税率，供直接生成销售出库单使用', () => {
    const [line] = buildSalesOrderAvailabilityLines([row({ price: 100, price_with_tax: 113, tax_rate: 13 })], [])
    expect(line).toMatchObject({ price: 100, price_with_tax: 113, tax_rate: 13 })
  })

  it('批量计算时保留来源订单、来源行和排序信息', () => {
    const [line] = buildSalesOrderAvailabilityLines([
      row({ source_doc_id: 'SO-1', source_doc_no: 'SO-001', source_doc_date: '2026-07-19', seq: 2, on_hand: 10 }),
    ], [])
    expect(line).toMatchObject({
      source_doc_id: 'SO-1',
      source_doc_no: 'SO-001',
      source_doc_date: '2026-07-19',
      line_id: 'SO-L1',
      seq: 2,
    })
  })

  it('库存为零但订单仍有剩余时允许进入出库草稿页', () => {
    const [line] = buildSalesOrderAvailabilityLines([row({ on_hand: 0 })], [])
    expect(line.max_ship_qty).toBe(0)
    expect(hasBatchDispatchRemaining([line])).toBe(true)
  })
})
