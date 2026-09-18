/**
 * 供应链库存计价引擎
 * 按系统参数 scm:costing_method 计算出入库单位成本，写入 scm_stock_move 并更新 scm_stock。
 *
 * 已实现：moving_avg（移动加权平均）、fifo / lifo（成本层，见 scm_stock_layer）；month_avg / specified 预留。
 * 三种方式共用 scm_stock（qty / amount / avg_cost）与 scm_stock_move；差别只在出库单价的取法：
 *  - moving_avg：出库取当前均价
 *  - fifo / lifo：出库逐层扣减成本层（最早层 / 最新层先耗），单价 = Σ(层耗用量×层单价) / 出库量；avg_cost 仅作展示
 */
import type Database from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'

export const IMPLEMENTED_COSTING_METHODS = ['moving_avg', 'fifo', 'lifo'] as const
export const COSTING_METHOD_LABELS: Record<string, string> = { moving_avg: '移动加权平均', month_avg: '全月平均', fifo: '先进先出', lifo: '后进先出', specified: '指定成本' }

export function getCostingMethod(db: Database.Database, accountSetId: string): string {
  const row = db.prepare(
    "SELECT param_value FROM system_params WHERE account_set_id=? AND param_key='scm:costing_method'"
  ).get(accountSetId) as any
  return (row?.param_value as string) || 'moving_avg'
}

type LayerMode = 'fifo' | 'lifo'

/** 成本层表是否存在（单元测试的内存库 / 未迁移的库不写层） */
const layerTableCache = new WeakMap<Database.Database, boolean>()
function hasLayerTable(db: Database.Database): boolean {
  let v = layerTableCache.get(db)
  if (v === undefined) {
    v = !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='scm_stock_layer'").get()
    layerTableCache.set(db, v)
  }
  return v
}

/** 当前账套是否按成本层计价（fifo / lifo），否则返回 null */
function layerMode(db: Database.Database, accountSetId: string): LayerMode | null {
  if (!hasLayerTable(db)) return null
  const m = getCostingMethod(db, accountSetId)
  return m === 'fifo' || m === 'lifo' ? m : null
}

interface LayerRow { id: string; qty_in: number; qty_left: number; unit_cost: number; layer_date: string; seq: number; doc_type: string | null }

function insertLayer(
  db: Database.Database, accountSetId: string, warehouse: string, itemCode: string,
  qty: number, unitCost: number, doc: { type: string; no: string; seq: number; date: string }, moveId: string | null,
): string {
  const next = db.prepare('SELECT COALESCE(MAX(seq),0)+1 s FROM scm_stock_layer WHERE account_set_id=? AND warehouse_code=? AND item_code=?')
    .get(accountSetId, warehouse, itemCode) as { s: number }
  const id = uuidv4()
  db.prepare(`INSERT INTO scm_stock_layer (id,account_set_id,warehouse_code,item_code,layer_date,seq,doc_type,doc_no,line_seq,move_id,qty_in,qty_left,unit_cost)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, accountSetId, warehouse, itemCode, doc.date, next.s, doc.type, doc.no, doc.seq, moveId, qty, qty, unitCost)
  return id
}

/**
 * 成本层与结存对齐：切换到 FIFO/LIFO 前已有的结存没有层记录（或层合计少于结存）时，
 * 按差额补一层「期初层」（doc_type='INIT'，日期取空串排在所有层之前：FIFO 最先耗、LIFO 最后耗），
 * 单价取 (结存金额 − 现有层金额) / 差额，异常时退回均价。
 */
function ensureLayersCoverStock(db: Database.Database, accountSetId: string, warehouse: string, itemCode: string, stock: StockRow | undefined): void {
  const qty = Number(stock?.qty || 0)
  if (qty <= 0) return
  const agg = db.prepare('SELECT COALESCE(SUM(qty_left),0) q, COALESCE(SUM(qty_left*unit_cost),0) a FROM scm_stock_layer WHERE account_set_id=? AND warehouse_code=? AND item_code=? AND qty_left>0')
    .get(accountSetId, warehouse, itemCode) as { q: number; a: number }
  const diff = Math.round((qty - agg.q) * 10000) / 10000
  if (diff <= 0.000001) return
  let cost = (Number(stock?.amount || 0) - agg.a) / diff
  if (!(cost > 0)) cost = Number(stock?.avg_cost || 0)
  cost = Math.round(cost * 10000) / 10000
  insertLayer(db, accountSetId, warehouse, itemCode, diff, cost, { type: 'INIT', no: '', seq: 0, date: '' }, null)
}

/** 逐层扣减：返回耗用明细与未被层覆盖的数量（负库存出库） */
function consumeLayers(
  db: Database.Database, accountSetId: string, warehouse: string, itemCode: string, outQty: number, mode: LayerMode,
): { uses: { layer_id: string; qty: number; unit_cost: number; amount: number }[]; short: number; lastCost: number } {
  const order = mode === 'fifo' ? 'ASC' : 'DESC'
  const layers = db.prepare(`SELECT id, qty_in, qty_left, unit_cost, layer_date, seq, doc_type FROM scm_stock_layer
    WHERE account_set_id=? AND warehouse_code=? AND item_code=? AND qty_left>0.000001 ORDER BY layer_date ${order}, seq ${order}`)
    .all(accountSetId, warehouse, itemCode) as LayerRow[]
  const uses: { layer_id: string; qty: number; unit_cost: number; amount: number }[] = []
  let remain = outQty
  let lastCost = 0
  const upd = db.prepare('UPDATE scm_stock_layer SET qty_left=? WHERE id=?')
  for (const l of layers) {
    if (remain <= 0.000001) break
    const take = Math.min(remain, Number(l.qty_left))
    const left = Math.round((Number(l.qty_left) - take) * 10000) / 10000
    upd.run(Math.abs(left) < 0.000001 ? 0 : left, l.id)
    uses.push({ layer_id: l.id, qty: take, unit_cost: Number(l.unit_cost), amount: Math.round(take * Number(l.unit_cost) * 100) / 100 })
    lastCost = Number(l.unit_cost)
    remain = Math.round((remain - take) * 10000) / 10000
  }
  return { uses, short: remain > 0.000001 ? remain : 0, lastCost }
}

/** 允许负库存的仓库集合（系统参数 scm:negative_stock_warehouses，JSON 数组）。P2-7：该参数此前写入后无任何读取方。 */
export function getNegativeStockWarehouses(db: Database.Database, accountSetId: string): Set<string> {
  const row = db.prepare(
    "SELECT param_value FROM system_params WHERE account_set_id=? AND param_key='scm:negative_stock_warehouses'"
  ).get(accountSetId) as any
  try {
    const arr = JSON.parse(String(row?.param_value || '[]'))
    return new Set(Array.isArray(arr) ? arr.map((x: any) => String(x)).filter(Boolean) : [])
  } catch { return new Set() }
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
  // P2-2：入库金额按分舍入后累计，库存金额与流水金额同为 2 位口径，Σ(流水) 恒等于结存，不再以 4 位/2 位持续漂移
  const inAmt = Math.round(inCost * inQty * 100) / 100
  const newAmt = Math.round((oldAmt + inAmt) * 100) / 100
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
    warehouse, itemCode, 'in', inQty, inCost, inAmt, null,
    newQty, newAmt, avg
  )
  // FIFO/LIFO：每笔入库形成一层；先把切换前的存量结存补成期初层，保证层合计 = 结存
  if (inQty > 0 && layerMode(db, accountSetId)) {
    ensureLayersCoverStock(db, accountSetId, warehouse, itemCode, stock)
    insertLayer(db, accountSetId, warehouse, itemCode, inQty, inCost, doc, moveId)
  }
  return { id: moveId, account_set_id: accountSetId, move_date: doc.date, doc_type: doc.type, doc_no: doc.no, line_seq: doc.seq, warehouse_code: warehouse, item_code: itemCode, direction: 'in', qty: inQty, unit_cost: inCost, amount: inAmt, balance_qty: newQty, balance_amount: newAmt, balance_avg_cost: avg }
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
  const newQtyRaw = Math.round((oldQty - outQty) * 10000) / 10000
  if (!options.allowNegative && newQtyRaw < -0.000001) {
    throw new Error(`库存不足，物料 ${itemCode} 在仓库 ${warehouse} 当前库存 ${oldQty}，本次出库 ${outQty}`)
  }
  const newQty = Math.abs(newQtyRaw) < 0.000001 ? 0 : newQtyRaw
  // 负库存出库时该仓可能根本没有库存记录（或均价为 0），直接取 0 会把销售成本、
  // 库存金额一起记成 0，成本被低估且事后难以察觉。此处按该物料最近一次入库单价兜底。
  let unitCost = stock?.avg_cost || lastInboundUnitCost(db, accountSetId, itemCode) || 0
  let outAmt = Math.round(unitCost * outQty * 100) / 100
  // FIFO/LIFO：逐层扣减成本层得到出库金额；层不够（负库存）的部分按最后耗用层单价 / 最近入库价兜底
  const mode = layerMode(db, accountSetId)
  let layerUses: { layer_id: string; qty: number; unit_cost: number; amount: number }[] = []
  if (mode && outQty > 0) {
    ensureLayersCoverStock(db, accountSetId, warehouse, itemCode, stock)
    const c = consumeLayers(db, accountSetId, warehouse, itemCode, outQty, mode)
    layerUses = c.uses
    let amt = c.uses.reduce((s, u) => s + u.amount, 0)
    if (c.short > 0) {
      const fallback = c.lastCost || lastInboundUnitCost(db, accountSetId, itemCode) || unitCost
      amt += Math.round(c.short * fallback * 100) / 100
    }
    outAmt = Math.round(amt * 100) / 100
    unitCost = Math.round((outAmt / outQty) * 10000) / 10000
  }
  const newAmtRaw = Math.round((oldAmt - outAmt) * 100) / 100
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
  if (layerUses.length) {
    const ins = db.prepare('INSERT INTO scm_stock_layer_use (id,account_set_id,move_id,layer_id,qty,unit_cost,amount) VALUES (?,?,?,?,?,?,?)')
    for (const u of layerUses) ins.run(uuidv4(), accountSetId, moveId, u.layer_id, u.qty, u.unit_cost, u.amount)
  }
  return { move: { id: moveId, account_set_id: accountSetId, move_date: doc.date, doc_type: doc.type, doc_no: doc.no, line_seq: doc.seq, warehouse_code: warehouse, item_code: itemCode, direction: 'out', qty: outQty, unit_cost: unitCost, amount: outAmt, balance_qty: newQty, balance_amount: newAmt, balance_avg_cost: avg }, unitCost }
}

/**
 * 成本调整（P2-17 工单结案结转）：不动数量，只把金额差额记入某仓某物料的库存结存并重算均价。
 * delta>0 记 in 流水、<0 记 out 流水（qty=0）；反审核走 reverseDocMoves 按金额回退。
 */
export function applyCostAdjustment(
  db: Database.Database, accountSetId: string,
  warehouse: string, itemCode: string, delta: number,
  doc: { type: string; no: string; seq: number; date: string },
): void {
  const amt = Math.round((Number(delta) || 0) * 100) / 100
  if (!amt) return
  const stock = db.prepare('SELECT qty, amount FROM scm_stock WHERE account_set_id=? AND warehouse_code=? AND item_code=?')
    .get(accountSetId, warehouse, itemCode) as StockRow | undefined
  const qty = stock?.qty || 0
  const newAmt = Math.round(((stock?.amount || 0) + amt) * 100) / 100
  const avg = qty > 0 ? Math.round((newAmt / qty) * 10000) / 10000 : 0
  if (stock) {
    db.prepare('UPDATE scm_stock SET amount=?,avg_cost=?,updated_at=datetime(\'now\') WHERE account_set_id=? AND warehouse_code=? AND item_code=?')
      .run(newAmt, avg, accountSetId, warehouse, itemCode)
  } else {
    db.prepare('INSERT INTO scm_stock (id,account_set_id,warehouse_code,item_code,qty,amount,avg_cost) VALUES (?,?,?,?,?,?,?)')
      .run(uuidv4(), accountSetId, warehouse, itemCode, 0, newAmt, 0)
  }
  const moveId = uuidv4()
  db.prepare(`INSERT INTO scm_stock_move (id,account_set_id,move_date,doc_type,doc_no,line_seq,warehouse_code,item_code,direction,qty,unit_cost,amount,batch_no,balance_qty,balance_amount,balance_avg_cost)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    moveId, accountSetId, doc.date, doc.type, doc.no, doc.seq, warehouse, itemCode,
    amt > 0 ? 'in' : 'out', 0, 0, Math.abs(amt), null, qty, newAmt, avg,
  )
  // FIFO/LIFO：金额差额按剩余数量分摊到在库各层的单价上（记 qty=0 的层耗用，反审核按 unit_cost 回调）
  if (qty > 0 && layerMode(db, accountSetId)) {
    ensureLayersCoverStock(db, accountSetId, warehouse, itemCode, stock)
    const layers = db.prepare('SELECT id, qty_left, unit_cost FROM scm_stock_layer WHERE account_set_id=? AND warehouse_code=? AND item_code=? AND qty_left>0.000001')
      .all(accountSetId, warehouse, itemCode) as LayerRow[]
    const total = layers.reduce((s, l) => s + Number(l.qty_left), 0)
    if (total > 0) {
      const delta = Math.round((amt / total) * 10000) / 10000
      const upd = db.prepare('UPDATE scm_stock_layer SET unit_cost=? WHERE id=?')
      const ins = db.prepare('INSERT INTO scm_stock_layer_use (id,account_set_id,move_id,layer_id,qty,unit_cost,amount) VALUES (?,?,?,?,?,?,?)')
      for (const l of layers) {
        upd.run(Math.round((Number(l.unit_cost) + delta) * 10000) / 10000, l.id)
        ins.run(uuidv4(), accountSetId, moveId, l.id, 0, delta, Math.round(delta * Number(l.qty_left) * 100) / 100)
      }
    }
  }
}

/**
 * 反审核时回退成本层：出库流水按耗用明细恢复各层剩余量（qty=0 的成本调整则回调层单价）；
 * 入库流水删除其形成的层——若该层已被后续出库消耗则拒绝，需先反审核后续出库单。
 */
function reverseLayerMoves(db: Database.Database, accountSetId: string, moves: StockMoveRow[]): void {
  if (!hasLayerTable(db)) return
  const useRows = db.prepare('SELECT id, layer_id, qty, unit_cost FROM scm_stock_layer_use WHERE move_id=?')
  const delUses = db.prepare('DELETE FROM scm_stock_layer_use WHERE move_id=?')
  const addLeft = db.prepare('UPDATE scm_stock_layer SET qty_left=ROUND(qty_left+?,4) WHERE id=?')
  const subCost = db.prepare('UPDATE scm_stock_layer SET unit_cost=ROUND(unit_cost-?,4) WHERE id=?')
  // 先恢复出库耗用，再删入库层（同单同仓同料先入后出时，删层前其消耗已被恢复）
  for (const m of moves) {
    const uses = useRows.all(m.id) as { id: string; layer_id: string; qty: number; unit_cost: number }[]
    for (const u of uses) {
      if (Number(u.qty) > 0) addLeft.run(Number(u.qty), u.layer_id)
      else subCost.run(Number(u.unit_cost), u.layer_id)
    }
    delUses.run(m.id)
  }
  const layerByMove = db.prepare('SELECT id, qty_in, qty_left FROM scm_stock_layer WHERE move_id=?')
  for (const m of moves) {
    if (m.direction !== 'in') continue
    const layer = layerByMove.get(m.id) as { id: string; qty_in: number; qty_left: number } | undefined
    if (!layer) continue
    if (Number(layer.qty_left) < Number(layer.qty_in) - 0.000001) {
      throw new Error(`反审核失败：物料 ${m.item_code} 在仓库 ${m.warehouse_code} 本单入库形成的成本层已被后续出库消耗（先进先出/后进先出），请先反审核相关出库单`)
    }
    db.prepare('DELETE FROM scm_stock_layer WHERE id=?').run(layer.id)
  }
}

/** 成本层查询（库存成本层报表） */
export function listStockLayers(db: Database.Database, accountSetId: string, filter: { warehouse_code?: string; item_code?: string; only_left?: boolean }) {
  if (!hasLayerTable(db)) return []
  const conds = ['l.account_set_id=?']
  const params: any[] = [accountSetId]
  if (filter.warehouse_code) { conds.push('l.warehouse_code=?'); params.push(filter.warehouse_code) }
  if (filter.item_code) { conds.push('l.item_code=?'); params.push(filter.item_code) }
  if (filter.only_left !== false) conds.push('l.qty_left>0.000001')
  return db.prepare(`SELECT l.id, l.warehouse_code, w.name warehouse_name, l.item_code, i.name item_name, i.unit,
      l.layer_date, l.seq, l.doc_type, l.doc_no, l.line_seq, l.qty_in, l.qty_left, l.unit_cost, ROUND(l.qty_left*l.unit_cost,2) amount_left
    FROM scm_stock_layer l
    LEFT JOIN scm_warehouse w ON w.account_set_id=l.account_set_id AND w.code=l.warehouse_code
    LEFT JOIN scm_item i ON i.account_set_id=l.account_set_id AND i.code=l.item_code
    WHERE ${conds.join(' AND ')} ORDER BY l.warehouse_code, l.item_code, l.layer_date, l.seq`).all(...params) as any[]
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
  reverseLayerMoves(db, accountSetId, moves)

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
    const newAmtRaw = Math.round((oldAmt + rollback.amountDelta) * 100) / 100
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
