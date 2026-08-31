import { describe, expect, it } from 'vitest'
import { buildSalesDispatchLines, mergeSalesDispatchLines } from '@/utils/scmSalesDispatch'

describe('销售订单直达销售出库', () => {
  it('新建发货明细带入来源销售订单号', () => {
    const lines = buildSalesDispatchLines([{
      source_doc_id: 'SOA1', source_doc_no: 'SOA-001', line_id: 'L1',
      item_code: 'FG01', warehouse_code: 'W1',
      order_qty: 2, pushed_qty: 0, remain: 2, base_remaining: 2,
      on_hand: 2, other_reserved: 0, available: 2, ship_qty: 2, short_qty: 0,
    }])

    expect(lines[0].sales_order_no).toBe('SOA-001')
  })

  it('库存为零时仍按订单正常剩余量生成草稿行', () => {
    const lines = buildSalesDispatchLines([
      {
        line_id: 'L1', item_code: 'FG01', item_name: '成品一', spec: 'A',
        warehouse_code: 'W1', order_qty: 10, pushed_qty: 0, remain: 10, base_remaining: 10,
        on_hand: 0, other_reserved: 0, available: 0, ship_qty: 0, short_qty: 10,
        price: 20, price_with_tax: 22.6, tax_rate: 13, unit_cost: 8,
      },
    ], 'W0')

    expect(lines).toEqual([{
      item_code: 'FG01', item_name: '成品一', spec: 'A', warehouse_code: 'W1',
      qty: 10, price: 20, amount: 200, price_with_tax: 22.6, unit_cost: 8,
      tax_rate: 13, tax_amount: 26, source_line_id: 'L1',
    }])
  })

  it('部分库存时也按订单正常剩余量生成草稿行', () => {
    const lines = buildSalesDispatchLines([{
      line_id: 'L1', item_code: 'FG01', warehouse_code: 'W1',
      order_qty: 10, pushed_qty: 4, remain: 6, base_remaining: 6,
      on_hand: 3, other_reserved: 0, available: 3, ship_qty: 3, short_qty: 3,
      price: 20, tax_rate: 13,
    }])

    expect(lines[0]).toMatchObject({ item_code: 'FG01', qty: 6, amount: 120, source_line_id: 'L1' })
  })

  it('忽略已无正常剩余量的行，并保留多订单来源行关系', () => {
    const lines = buildSalesDispatchLines([
      {
        source_doc_id: 'SOA1', line_id: 'L1', item_code: 'FG01', warehouse_code: 'W1',
        order_qty: 5, pushed_qty: 5, remain: 0, base_remaining: 0,
        on_hand: 10, other_reserved: 0, available: 10, ship_qty: 0, short_qty: 0,
      },
      {
        source_doc_id: 'SOA2', line_id: 'L2', item_code: 'FG02', warehouse_code: '',
        order_qty: 7, pushed_qty: 2, remain: 5, base_remaining: 5,
        on_hand: 0, other_reserved: 0, available: 0, ship_qty: 0, short_qty: 5,
      },
    ], 'W0')

    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({ item_code: 'FG02', warehouse_code: 'W0', qty: 5, source_line_id: 'L2' })
  })
})

describe('销售订单合并出库（按库存限制）', () => {
  it('useStockLimit: 库存不足时只发可发量，按 min(订单剩余, 可用库存)', () => {
    const lines = buildSalesDispatchLines([{
      line_id: 'L1', item_code: 'FG01', warehouse_code: 'W1',
      order_qty: 10, pushed_qty: 4, remain: 6, base_remaining: 6,
      on_hand: 3, other_reserved: 0, available: 3, ship_qty: 3, short_qty: 3,
      price: 20, tax_rate: 13,
    }], 'W0', { useStockLimit: true })

    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({ item_code: 'FG01', qty: 3, amount: 60, source_line_id: 'L1' })
  })

  it('useStockLimit: 库存为 0 的行整行跳过', () => {
    const lines = buildSalesDispatchLines([
      {
        line_id: 'L1', item_code: 'FG01', warehouse_code: 'W1',
        order_qty: 10, pushed_qty: 0, remain: 10, base_remaining: 10,
        on_hand: 0, other_reserved: 0, available: 0, ship_qty: 0, short_qty: 10,
        price: 20, tax_rate: 13,
      },
      {
        line_id: 'L2', item_code: 'FG02', warehouse_code: 'W1',
        order_qty: 5, pushed_qty: 0, remain: 5, base_remaining: 5,
        on_hand: 8, other_reserved: 0, available: 8, ship_qty: 5, short_qty: 0,
        price: 10, tax_rate: 13,
      },
    ], 'W0', { useStockLimit: true })

    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({ item_code: 'FG02', qty: 5, source_line_id: 'L2' })
  })

  it('useStockLimit: 库存充足时仍不超过订单剩余', () => {
    const lines = buildSalesDispatchLines([{
      line_id: 'L1', item_code: 'FG01', warehouse_code: 'W1',
      order_qty: 10, pushed_qty: 2, remain: 8, base_remaining: 8,
      on_hand: 100, other_reserved: 0, available: 100, ship_qty: 8, short_qty: 0,
      price: 20, tax_rate: 13,
    }], 'W0', { useStockLimit: true })

    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({ item_code: 'FG01', qty: 8, source_line_id: 'L1' })
  })

  it('useStockLimit: 多行共用同一库存池时遵循后端预分配结果', () => {
    // 后端已按订单日期先后分配共享库存池；前端不再二次分配，直接信任 ship_qty
    const lines = buildSalesDispatchLines([
      {
        source_doc_id: 'SOA1', line_id: 'L1', item_code: 'FG01', warehouse_code: 'W1',
        order_qty: 6, pushed_qty: 0, remain: 6, base_remaining: 6,
        on_hand: 4, other_reserved: 0, available: 4, ship_qty: 4, short_qty: 2,
        price: 10, tax_rate: 13,
      },
      {
        source_doc_id: 'SOA2', line_id: 'L2', item_code: 'FG01', warehouse_code: 'W1',
        order_qty: 5, pushed_qty: 0, remain: 5, base_remaining: 5,
        on_hand: 4, other_reserved: 0, available: 0, ship_qty: 0, short_qty: 5,
        price: 10, tax_rate: 13,
      },
    ], 'W0', { useStockLimit: true })

    // 第一行分到 4，第二行分到 0 → 跳过
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({ item_code: 'FG01', qty: 4, source_line_id: 'L1' })
  })
})

describe('销售订单合并出库明细合并', () => {
  it('多来源销售订单号去重排序后用顿号连接', () => {
    const lines = mergeSalesDispatchLines([
      { item_code: 'FG01', warehouse_code: 'W1', qty: 1, price: 10, source_line_id: 'L2', sales_order_no: 'SOA-002' },
      { item_code: 'FG01', warehouse_code: 'W1', qty: 1, price: 10, source_line_id: 'L1', sales_order_no: 'SOA-001' },
      { item_code: 'FG01', warehouse_code: 'W1', qty: 1, price: 10, source_line_id: 'L3', sales_order_no: 'SOA-002' },
    ])

    expect(lines[0].sales_order_no).toBe('SOA-001、SOA-002')
  })

  it('相同物料、仓库和单价可合并，单价不同必须保留独立明细', () => {
    const lines = mergeSalesDispatchLines([
      { item_code: 'FG01', warehouse_code: 'W1', qty: 2, price: 10, amount: 20, source_line_id: 'L1' },
      { item_code: 'FG01', warehouse_code: 'W1', qty: 3, price: 10, amount: 30, source_line_id: 'L2' },
      { item_code: 'FG01', warehouse_code: 'W1', qty: 4, price: 12, amount: 48, source_line_id: 'L3' },
    ])

    expect(lines).toHaveLength(2)
    expect(lines[0]).toMatchObject({ item_code: 'FG01', qty: 5, price: 10, amount: 50, source_line_id: undefined })
    expect(lines[0].field_values).toMatchObject({ source_line_allocations: [
      { source_line_id: 'L1', qty: 2 },
      { source_line_id: 'L2', qty: 3 },
    ] })
    expect(lines[1]).toMatchObject({ item_code: 'FG01', qty: 4, price: 12, amount: 48, source_line_id: 'L3' })
  })
})
