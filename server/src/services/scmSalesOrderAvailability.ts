export interface SalesOrderAvailabilitySourceRow {
  id: string
  source_doc_id?: string
  source_doc_no?: string
  source_doc_date?: string
  seq?: number
  item_code: string
  item_name?: string
  spec?: string
  unit?: string
  warehouse_code?: string
  warehouse_name?: string
  qty: number
  pushed_qty?: number
  on_hand?: number
  other_reserved?: number
  price?: number
  price_with_tax?: number
  tax_rate?: number | null
  unit_cost?: number
  supplier_code?: string
  purchase_price?: number
  source_type?: string
}

export interface SalesOrderMrCoverageRow {
  item_code: string
  wh?: string
  qty: number
}

export interface SalesOrderAvailabilityOptions {
  overrunRate?: number
}

const r6 = (n: number) => Math.round(n * 1000000) / 1000000

/** 合并出库允许先生成草稿：只要订单仍有剩余量即应进入预览页，库存仅作展示。 */
export function hasBatchDispatchRemaining(lines: Array<{ base_remaining?: number; remain?: number }>) {
  return lines.some(line => (Number(line.base_remaining ?? line.remain) || 0) > 0)
}

/**
 * 销售订单只计算成品层的可发量和净缺口。
 * 多行相同物料共用同一库存池；同销售订单已生成的成品缺料量共用同一扣减池。
 */
export function buildSalesOrderAvailabilityLines(
  rows: SalesOrderAvailabilitySourceRow[],
  mrRows: SalesOrderMrCoverageRow[],
  options: SalesOrderAvailabilityOptions = {},
) {
  const overrunRate = Math.min(1000, Math.max(0, Number(options.overrunRate) || 0))
  const mrPool = new Map<string, number>()
  for (const row of mrRows) {
    const key = `${row.item_code}|${row.wh || ''}`
    mrPool.set(key, r6((mrPool.get(key) || 0) + (Number(row.qty) || 0)))
  }

  const availPool = new Map<string, number>()
  const maxAvailPool = new Map<string, number>()
  for (const row of rows) {
    const key = `${row.item_code}|${row.warehouse_code || ''}`
    if (!availPool.has(key)) {
      availPool.set(key, r6((Number(row.on_hand) || 0) - (Number(row.other_reserved) || 0)))
      maxAvailPool.set(key, r6((Number(row.on_hand) || 0) - (Number(row.other_reserved) || 0)))
    }
  }

  return rows.map(row => {
    const key = `${row.item_code}|${row.warehouse_code || ''}`
    const order_qty = Number(row.qty) || 0
    const pushed_qty = Number(row.pushed_qty) || 0
    const base_remaining = Math.max(0, r6(order_qty - pushed_qty))
    const max_allowed_qty = r6(order_qty * (1 + overrunRate / 100))
    const overrun_remaining = Math.max(0, r6(max_allowed_qty - pushed_qty))
    const remain = base_remaining
    const on_hand = Number(row.on_hand) || 0
    const other_reserved = Number(row.other_reserved) || 0
    const available = r6(on_hand - other_reserved)
    const poolLeft = availPool.get(key) || 0
    const ship_qty = Math.max(0, r6(Math.min(remain, poolLeft)))
    availPool.set(key, r6(poolLeft - ship_qty))
    const maxPoolLeft = maxAvailPool.get(key) || 0
    const max_ship_qty = Math.max(0, r6(Math.min(overrun_remaining, maxPoolLeft)))
    maxAvailPool.set(key, r6(maxPoolLeft - max_ship_qty))

    const gross_short = Math.max(0, r6(remain - ship_qty))
    const mrLeft = mrPool.get(key) || 0
    const deduct = Math.min(gross_short, mrLeft)
    const short_qty = r6(gross_short - deduct)
    mrPool.set(key, r6(mrLeft - deduct))

    return {
      source_doc_id: row.source_doc_id,
      source_doc_no: row.source_doc_no,
      source_doc_date: row.source_doc_date,
      line_id: row.id,
      seq: row.seq,
      item_code: row.item_code,
      item_name: row.item_name,
      spec: row.spec,
      unit: row.unit,
      warehouse_code: row.warehouse_code,
      warehouse_name: row.warehouse_name,
      order_qty,
      pushed_qty,
      remain,
      base_remaining,
      max_allowed_qty,
      overrun_remaining,
      on_hand,
      other_reserved,
      available,
      ship_qty,
      max_ship_qty,
      short_qty,
      gross_short,
      price: Number(row.price) || 0,
      price_with_tax: Number(row.price_with_tax) || 0,
      tax_rate: row.tax_rate === null || row.tax_rate === undefined ? null : Number(row.tax_rate),
      unit_cost: Number(row.unit_cost) || 0,
      supplier_code: row.supplier_code || '',
      purchase_price: Number(row.purchase_price) || 0,
      source_type: row.source_type || 'purchase',
    }
  })
}
