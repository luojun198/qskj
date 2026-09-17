/**
 * 供应链库存计价引擎
 * 按系统参数 scm:costing_method 计算出入库单位成本，写入 scm_stock_move 并更新 scm_stock。
 *
 * 本期支持 moving_avg；fifo/lifo/month_avg/specified 接口预留。
 */
import type Database from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'

export function getCostingMethod(db: Database.Database, accountSetId: string): string {
  const row = db.prepare(
    "SELECT param_value FROM system_params WHERE account_set_id=? AND param_key='scm:costing_method'"
  ).get(accountSetId) as any
  return (row?.param_value as string) || 'moving_avg'
}

interface StockMoveRow {
  id: string; account_set_id: string; move_date: string
  doc_type: string; doc_no: string; line_seq: number
  warehouse_code: string; item_code: string; direction: 'in' | 'out'
  qty: number; unit_cost: number; amount: number; batch_no?: string | null
  balance_qty: number; balance_amount: number; balance_avg_cost: number
}

interface StockRow { qty: number; amount: number; avg_cost: number }

/** 计算移动加权平均入仓成本并写流水+更新即时库存 */
export function applyMovingAvgIn(
  db: Database.Database, accountSetId: string,
  warehouse: string, itemCode: string,
  inQty: number, inCost: number,
  doc: { type: string; no: string; seq: number; date: string }
): StockMoveRow {
  const stock = db.prepare(
    'SELECT qty, amount FROM scm_stock WHERE account_set_id=? AND warehouse_code=? AND item_code=?'
  ).get(accountSetId, warehouse, itemCode) as StockRow | undefined

  const oldQty = stock?.qty || 0
  const oldAmt = stock?.amount || 0
  const newQty = oldQty + inQty
  const newAmt = Math.round((oldAmt + inCost * inQty) * 10000) / 10000
  const avg = newQty > 0 ? Math.round((newAmt / newQty) * 10000) / 10000 : 0

  if (stock) {
    db.prepare('UPDATE scm_stock SET qty=?,amount=?,avg_cost=?,updated_at=datetime(\'now\') WHERE account_set_id=? AND warehouse_code=? AND item_code=?')
      .run(newQty, newAmt, avg, accountSetId, warehouse, itemCode)
  } else {
    db.prepare('INSERT INTO scm_stock (id,account_set_id,warehouse_code,item_code,qty,amount,avg_cost) VALUES (?,?,?,?,?,?,?)')
      .run(uuidv4(), accountSetId, warehouse, itemCode, newQty, newAmt, avg)
  }

  const moveId = uuidv4()
  db.prepare(`INSERT INTO scm_stock_move (id,account_set_id,move_date,doc_type,doc_no,line_seq,warehouse_code,item_code,direction,qty,unit_cost,amount,batch_no,balance_qty,balance_amount,balance_avg_cost)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    moveId, accountSetId, doc.date, doc.type, doc.no, doc.seq,
    warehouse, itemCode, 'in', inQty, inCost, Math.round(inCost * inQty * 100) / 100, null,
    newQty, newAmt, avg
  )
  return { id: moveId, account_set_id: accountSetId, move_date: doc.date, doc_type: doc.type, doc_no: doc.no, line_seq: doc.seq, warehouse_code: warehouse, item_code: itemCode, direction: 'in', qty: inQty, unit_cost: inCost, amount: Math.round(inCost * inQty * 100) / 100, balance_qty: newQty, balance_amount: newAmt, balance_avg_cost: avg }
}

/**
 * 该物料最近一次入库的单价，作为负库存出库时的成本兜底。
 * 先看本仓/全仓的入库流水，再退回物料档案的参考进价；都没有则返回 0。
 */
function lastInboundUnitCost(db: Database.Database, accountSetId: string, itemCode: string): number {
  const move = db.prepare(
    `SELECT unit_cost FROM scm_stock_move
      WHERE account_set_id=? AND item_code=? AND direction='in' AND unit_cost > 0
      ORDER BY move_date DESC, rowid DESC LIMIT 1`
  ).get(accountSetId, itemCode) as { unit_cost: number } | undefined
  if (move?.unit_cost) return Math.round(move.unit_cost * 10000) / 10000

  const item = db.prepare(
    'SELECT purchase_price, ref_cost FROM scm_item WHERE account_set_id=? AND code=?'
  ).get(accountSetId, itemCode) as { purchase_price?: number; ref_cost?: number } | undefined
  const price = Number(item?.purchase_price || 0) || Number(item?.ref_cost || 0)
  return price > 0 ? Math.round(price * 10000) / 10000 : 0
}

/**
 * 该物料在指定仓库的当前成本单价：有在库均价取均价，否则退回最近入库单价 / 档案进价。
 * 供「无来源成本的入库」（如手工销售退货）取成本，避免拿售价当库存成本（FIX-208）。
 */
export function currentUnitCost(db: Database.Database, accountSetId: string, warehouseCode: string, itemCode: string): number {
  const s = db.prepare('SELECT qty, avg_cost FROM scm_stock WHERE account_set_id=? AND warehouse_code=? AND item_code=?')
    .get(accountSetId, warehouseCode, itemCode) as { qty: number; avg_cost: number } | undefined
  if (s && Number(s.qty) > 0 && Number(s.avg_cost) > 0) return Math.round(Number(s.avg_cost) * 10000) / 10000
  return lastInboundUnitCost(db, accountSetId, itemCode)
}

/** 移动加权平均出仓：取当前均价为 unit_cost，减少库存 */
export function applyMovingAvgOut(
  db: Database.Database, accountSetId: string,
  warehouse: string, itemCode: string,
  outQty: number,
  doc: { type: string; no: string; seq: number; date: string },
  options: { allowNegative?: boolean } = {}
): { move: StockMoveRow; unitCost: number } {
  const stock = db.prepare(
    'SELECT qty, amount, avg_cost FROM scm_stock WHERE account_set_id=? AND warehouse_code=? AND item_code=?'
  ).get(accountSetId, warehouse, itemCode) as StockRow | undefined

  const oldQty = stock?.qty || 0
  const oldAmt = stock?.amount || 0
  // 负库存出库时该仓可能根本没有库存记录（或均价为 0），直接取 0 会把销售成本、
  // 库存金额一起记成 0，成本被低估且事后难以察觉。此处按该物料最近一次入库单价兜底。
  const unitCost = stock?.avg_cost || lastInboundUnitCost(db, accountSetId, itemCode) || 0
  const newQtyRaw = Math.round((oldQty - outQty) * 10000) / 10000
  if (!options.allowNegative && newQtyRaw < -0.000001) {
    throw new Error(`库存不足，物料 ${itemCode} 在仓库 ${warehouse} 当前库存 ${oldQty}，本次出库 ${outQty}`)
  }
  const newQty = Math.abs(newQtyRaw) < 0.000001 ? 0 : newQtyRaw
  const outAmt = Math.round(unitCost * outQty * 100) / 100
  const newAmtRaw = Math.round((oldAmt - outAmt) * 10000) / 10000
  const newAmt = newQty === 0 ? 0 : (options.allowNegative ? newAmtRaw : Math.max(0, newAmtRaw))
  const avg = newQty !== 0 ? Math.round((newAmt / newQty) * 10000) / 10000 : 0

  if (stock) {
    db.prepare('UPDATE scm_stock SET qty=?,amount=?,avg_cost=?,updated_at=datetime(\'now\') WHERE account_set_id=? AND warehouse_code=? AND item_code=?')
      .run(newQty, newAmt, avg, accountSetId, warehouse, itemCode)
  } else if (options.allowNegative) {
    db.prepare('INSERT INTO scm_stock (id,account_set_id,warehouse_code,item_code,qty,amount,avg_cost) VALUES (?,?,?,?,?,?,?)')
      .run(uuidv4(), accountSetId, warehouse, itemCode, newQty, newAmt, avg)
  }

  const moveId = uuidv4()
  db.prepare(`INSERT INTO scm_stock_move (id,account_set_id,move_date,doc_type,doc_no,line_seq,warehouse_code,item_code,direction,qty,unit_cost,amount,batch_no,balance_qty,balance_amount,balance_avg_cost)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    moveId, accountSetId, doc.date, doc.type, doc.no, doc.seq,
    warehouse, itemCode, 'out', outQty, unitCost, outAmt, null,
    newQty, newAmt, avg
  )
  return { move: { id: moveId, account_set_id: accountSetId, move_date: doc.date, doc_type: doc.type, doc_no: doc.no, line_seq: doc.seq, warehouse_code: warehouse, item_code: itemCode, direction: 'out', qty: outQty, unit_cost: unitCost, amount: outAmt, balance_qty: newQty, balance_amount: newAmt, balance_avg_cost: avg }, unitCost }
}

/** 撤销某张单据的全部库存移动（反审核/删单时回退库存） */
export function reverseDocMoves(
  db: Database.Database,
  accountSetId: string,
  docId: string,
  options: { allowNegativeWarehouses?: Set<string> } = {}
) {
  // 反审核是高频操作。原先通过 doc_type||'-'||doc_no 拼接匹配，SQLite 无法使用
  // (account_set_id, doc_type, doc_no, item_code) 索引，库存流水增长后会全表扫描。
  const docRef = db.prepare('SELECT doc_type,doc_no FROM scm_doc WHERE id=? AND account_set_id=?')
    .get(docId, accountSetId) as { doc_type: string; doc_no: string } | undefined
  if (!docRef) return
  const moves = db.prepare(
    'SELECT * FROM scm_stock_move WHERE account_set_id=? AND doc_type=? AND doc_no=?'
  ).all(accountSetId, docRef.doc_type, docRef.doc_no) as StockMoveRow[]
  if (!moves.length) return

  // 同一单据可能包含同仓同料的多行，或调拨/组装产生同仓同料双向移动；
  // 先按仓库+物料汇总净回滚量，再统一校验和更新，避免逐条回退产生中间负数或遗漏数量。
  const rollbackByStock = new Map<string, { warehouse: string; itemCode: string; qtyDelta: number; amountDelta: number }>()
  for (const m of moves) {
    const key = `${m.warehouse_code}|${m.item_code}`
    const rollback = rollbackByStock.get(key) || { warehouse: m.warehouse_code, itemCode: m.item_code, qtyDelta: 0, amountDelta: 0 }
    const sign = m.direction === 'in' ? -1 : 1
    rollback.qtyDelta += sign * Number(m.qty || 0)
    rollback.amountDelta += sign * Number(m.amount || 0)
    rollbackByStock.set(key, rollback)
  }

  // 先完整预检，任一物料会形成负库存时整单拒绝，不能部分回滚后再报错。
  for (const rollback of rollbackByStock.values()) {
    const stock = db.prepare(
      'SELECT qty, amount FROM scm_stock WHERE account_set_id=? AND warehouse_code=? AND item_code=?'
    ).get(accountSetId, rollback.warehouse, rollback.itemCode) as StockRow | undefined
    const oldQty = stock?.qty || 0
    const allowNegative = options.allowNegativeWarehouses?.has(rollback.warehouse) || false
    const newQty = oldQty + rollback.qtyDelta
    if (!allowNegative && newQty < -0.000001) {
      throw new Error(`反审核将导致负库存：物料 ${rollback.itemCode}，仓库 ${rollback.warehouse}，当前库存 ${oldQty}，回滚后 ${Math.round(newQty * 1000000) / 1000000}`)
    }
  }

  for (const rollback of rollbackByStock.values()) {
    const stock = db.prepare(
      'SELECT qty, amount FROM scm_stock WHERE account_set_id=? AND warehouse_code=? AND item_code=?'
    ).get(accountSetId, rollback.warehouse, rollback.itemCode) as StockRow | undefined
    const oldQty = stock?.qty || 0
    const oldAmt = stock?.amount || 0
    const allowNegative = options.allowNegativeWarehouses?.has(rollback.warehouse) || false
    const newQtyRaw = oldQty + rollback.qtyDelta
    const newQty = Math.abs(newQtyRaw) < 0.000001 ? 0 : newQtyRaw
    const newAmtRaw = oldAmt + rollback.amountDelta
    const newAmt = newQty === 0 ? 0 : (allowNegative ? newAmtRaw : Math.max(0, newAmtRaw))
    // 与 applyMovingAvgIn/Out 统一按 4 位舍入，避免回滚后均价出现长尾差
    const avg = newQty !== 0 ? Math.round((newAmt / newQty) * 10000) / 10000 : 0
    if (stock) {
      db.prepare('UPDATE scm_stock SET qty=?,amount=?,avg_cost=?,updated_at=datetime(\'now\') WHERE account_set_id=? AND warehouse_code=? AND item_code=?')
        .run(newQty, newAmt, avg, accountSetId, rollback.warehouse, rollback.itemCode)
    } else if (newQty > 0 || allowNegative) {
      db.prepare('INSERT INTO scm_stock (id,account_set_id,warehouse_code,item_code,qty,amount,avg_cost) VALUES (?,?,?,?,?,?,?)')
        .run(uuidv4(), accountSetId, rollback.warehouse, rollback.itemCode, newQty, newAmt, avg)
    }
  }
  db.prepare('DELETE FROM scm_stock_move WHERE account_set_id=? AND doc_type=? AND doc_no=?')
    .run(accountSetId, docRef.doc_type, docRef.doc_no)
}
