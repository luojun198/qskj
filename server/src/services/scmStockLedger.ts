import type Database from 'better-sqlite3'

export interface StockLedgerFilters {
  item_code?: string
  category_code?: string
  warehouse_code?: string
  doc_type?: string
  partner_code?: string
  start_date?: string
  end_date?: string
  page?: number
  page_size?: number
  sort_order?: 'asc' | 'desc'
}

const r2 = (value: number) => Math.round((Number(value) || 0) * 100) / 100
const r6 = (value: number) => Math.round((Number(value) || 0) * 1000000) / 1000000

function itemWarehouseConditions(filters: StockLedgerFilters, alias = 'm') {
  const conds: string[] = []
  const params: any[] = []
  if (filters.item_code) { conds.push(`${alias}.item_code=?`); params.push(filters.item_code) }
  if (filters.warehouse_code) { conds.push(`${alias}.warehouse_code=?`); params.push(filters.warehouse_code) }
  if (filters.category_code) { conds.push('i.category_code=?'); params.push(filters.category_code) }
  return { conds, params }
}

export function queryStockLedger(db: Database.Database, accountSetId: string, filters: StockLedgerFilters = {}, exportAll = false) {
  const base = itemWarehouseConditions(filters)
  const conds = ['m.account_set_id=?', ...base.conds]
  const params: any[] = [accountSetId, ...base.params]
  // P2-10：单据类型 / 往来单位只作用于展示行，逐笔结存必须按全部流水推进，否则筛选后「期末」≠ 实际结存
  if (filters.start_date) { conds.push('m.move_date>=?'); params.push(filters.start_date) }
  if (filters.end_date) { conds.push('m.move_date<=?'); params.push(filters.end_date) }
  const direction = filters.sort_order === 'desc' ? 'DESC' : 'ASC'
  const rows = db.prepare(`SELECT m.id,m.move_date,m.doc_type,m.doc_no,m.line_seq,m.warehouse_code,m.item_code,
      m.direction,m.qty,m.unit_cost,m.amount,m.batch_no,m.created_at,
      i.name AS item_name,i.spec,i.unit,i.category_code,c.name AS category_name,w.name AS warehouse_name,
      d.id AS doc_id,d.partner_code,p.name AS partner_name,dt.name AS doc_type_name
    FROM scm_stock_move m
    LEFT JOIN scm_item i ON i.account_set_id=m.account_set_id AND i.code=m.item_code
    LEFT JOIN scm_item_category c ON c.account_set_id=i.account_set_id AND c.code=i.category_code
    LEFT JOIN scm_warehouse w ON w.account_set_id=m.account_set_id AND w.code=m.warehouse_code
    LEFT JOIN scm_doc d ON d.account_set_id=m.account_set_id AND d.doc_type=m.doc_type AND d.doc_no=m.doc_no
    LEFT JOIN scm_partner p ON p.account_set_id=d.account_set_id AND p.code=d.partner_code
    LEFT JOIN scm_doc_type dt ON dt.account_set_id=m.account_set_id AND dt.code=m.doc_type
    WHERE ${conds.join(' AND ')}
    ORDER BY m.move_date ${direction},m.created_at ${direction},m.id ${direction}`).all(...params) as any[]

  // 期初基数 = 当前库存 - 全部历史库存移动净额。
  // 这样可还原直接初始化/导入到 scm_stock、但没有生成 IS 流水的期初库存。
  const openingMap = new Map<string, { qty: number; amount: number }>()
  const stockBase = itemWarehouseConditions(filters, 's')
  const currentRows = db.prepare(`SELECT s.item_code,s.warehouse_code,s.qty,s.amount
      FROM scm_stock s LEFT JOIN scm_item i ON i.account_set_id=s.account_set_id AND i.code=s.item_code
      WHERE s.account_set_id=?${stockBase.conds.length ? ` AND ${stockBase.conds.join(' AND ')}` : ''}`)
    .all(accountSetId, ...stockBase.params) as any[]
  for (const row of currentRows) {
    openingMap.set(`${row.item_code}|${row.warehouse_code}`, { qty: Number(row.qty) || 0, amount: Number(row.amount) || 0 })
  }
  const lifetimeBase = itemWarehouseConditions(filters)
  const lifetimeMoves = db.prepare(`SELECT m.item_code,m.warehouse_code,
      COALESCE(SUM(CASE WHEN m.direction='in' THEN m.qty ELSE -m.qty END),0) qty,
      COALESCE(SUM(CASE WHEN m.direction='in' THEN m.amount ELSE -m.amount END),0) amount
    FROM scm_stock_move m LEFT JOIN scm_item i ON i.account_set_id=m.account_set_id AND i.code=m.item_code
    WHERE m.account_set_id=?${lifetimeBase.conds.length ? ` AND ${lifetimeBase.conds.join(' AND ')}` : ''}
    GROUP BY m.item_code,m.warehouse_code`).all(accountSetId, ...lifetimeBase.params) as any[]
  for (const row of lifetimeMoves) {
    const key = `${row.item_code}|${row.warehouse_code}`
    const current = openingMap.get(key) || { qty: 0, amount: 0 }
    openingMap.set(key, { qty: r6(current.qty - (Number(row.qty) || 0)), amount: r2(current.amount - (Number(row.amount) || 0)) })
  }
  if (filters.start_date) {
    const openingBase = itemWarehouseConditions(filters)
    const opening = db.prepare(`SELECT m.item_code,m.warehouse_code,
        COALESCE(SUM(CASE WHEN m.direction='in' THEN m.qty ELSE -m.qty END),0) qty,
        COALESCE(SUM(CASE WHEN m.direction='in' THEN m.amount ELSE -m.amount END),0) amount
      FROM scm_stock_move m LEFT JOIN scm_item i ON i.account_set_id=m.account_set_id AND i.code=m.item_code
      WHERE m.account_set_id=? AND m.move_date<?${openingBase.conds.length ? ` AND ${openingBase.conds.join(' AND ')}` : ''}
      GROUP BY m.item_code,m.warehouse_code`).all(accountSetId, filters.start_date, ...openingBase.params) as any[]
    for (const row of opening) {
      const key = `${row.item_code}|${row.warehouse_code}`
      const baseOpening = openingMap.get(key) || { qty: 0, amount: 0 }
      openingMap.set(key, { qty: r6(baseOpening.qty + (Number(row.qty) || 0)), amount: r2(baseOpening.amount + (Number(row.amount) || 0)) })
    }
  }
  const running = new Map<string, { qty: number; amount: number }>()
  let inQty = 0, outQty = 0, inAmount = 0, outAmount = 0          // 全部流水（决定实际期末）
  let shownInQty = 0, shownOutQty = 0, shownInAmount = 0, shownOutAmount = 0   // 展示行（受类型/往来筛选）
  const matchesDisplay = (row: any) =>
    (!filters.doc_type || row.doc_type === filters.doc_type) && (!filters.partner_code || row.partner_code === filters.partner_code)
  const enriched: any[] = []
  for (const row of rows) {
    const key = `${row.item_code}|${row.warehouse_code}`
    const current = running.get(key) || { ...(openingMap.get(key) || { qty: 0, amount: 0 }) }
    const sign = row.direction === 'in' ? 1 : -1
    current.qty = r6(current.qty + sign * (Number(row.qty) || 0))
    current.amount = r2(current.amount + sign * (Number(row.amount) || 0))
    running.set(key, current)
    if (sign > 0) { inQty += Number(row.qty) || 0; inAmount += Number(row.amount) || 0 }
    else { outQty += Number(row.qty) || 0; outAmount += Number(row.amount) || 0 }
    if (!matchesDisplay(row)) continue
    if (sign > 0) { shownInQty += Number(row.qty) || 0; shownInAmount += Number(row.amount) || 0 }
    else { shownOutQty += Number(row.qty) || 0; shownOutAmount += Number(row.amount) || 0 }
    enriched.push({ ...row, in_qty: sign > 0 ? Number(row.qty) || 0 : 0, out_qty: sign < 0 ? Number(row.qty) || 0 : 0,
      in_amount: sign > 0 ? Number(row.amount) || 0 : 0, out_amount: sign < 0 ? Number(row.amount) || 0 : 0,
      running_qty: current.qty, running_amount: current.amount })
  }
  const openingQty = [...openingMap.values()].reduce((sum, row) => sum + row.qty, 0)
  const openingAmount = [...openingMap.values()].reduce((sum, row) => sum + row.amount, 0)
  // 收发合计按展示行；期末按全部流水（筛选只改变看到哪些行，不改变结存事实）
  const summary = { opening_qty: r6(openingQty), opening_amount: r2(openingAmount), in_qty: r6(shownInQty), in_amount: r2(shownInAmount),
    out_qty: r6(shownOutQty), out_amount: r2(shownOutAmount), closing_qty: r6(openingQty + inQty - outQty),
    closing_amount: r2(openingAmount + inAmount - outAmount) }
  const page = Math.max(1, Number(filters.page) || 1)
  const pageSize = Math.min(500, Math.max(10, Number(filters.page_size) || 50))
  return { rows: exportAll ? enriched : enriched.slice((page - 1) * pageSize, page * pageSize), total: enriched.length, page, page_size: pageSize, summary }
}
