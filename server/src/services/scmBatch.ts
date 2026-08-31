/**
 * 供应链批次/保质期追溯引擎（阶段4-4）
 *
 * 设计：批次台账（scm_stock_batch 数量/金额 + scm_batch_move 流水）与移动加权平均成本台账
 * （scm_stock / scm_stock_move）**并行维护**，仅做数量与保质期追溯，不参与成本计算。
 *
 * 仅对「启用批次管理」(scm_item.batch_flag=1) 的物料生效。按单据方向统一维护：
 *  - 入库类(direction='in')：每行建/累加批次（批次号缺省以单号命名），记生产日期/到期日。
 *  - 出库类(direction='out')：按物料扣批方式——manual 手工指定批次；fifo 按到期日→生产日期→入库序自动拆批。
 * 调拨(TR)/盘点(CK) 等 direction='none' 暂不在此维护（后续完善）。
 */
import type Database from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'

interface ItemBatchCfg { batch_flag: number; batch_out_mode: string; shelf_life_days: number }

export function getItemBatchCfg(db: Database.Database, aid: string, itemCode: string): ItemBatchCfg | null {
  const r = db.prepare('SELECT batch_flag, batch_out_mode, shelf_life_days FROM scm_item WHERE account_set_id=? AND code=?')
    .get(aid, itemCode) as any
  if (!r) return null
  return { batch_flag: Number(r.batch_flag) || 0, batch_out_mode: r.batch_out_mode || 'fifo', shelf_life_days: Number(r.shelf_life_days) || 0 }
}

function addDays(dateStr: string, days: number): string | null {
  if (!dateStr || !days) return null
  const d = new Date(dateStr + 'T00:00:00')
  if (isNaN(d.getTime())) return null
  d.setDate(d.getDate() + days)
  // 用本地年月日格式化，避免 toISOString 的时区回退
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** 批次入库：累加 scm_stock_batch，记 scm_batch_move */
function batchIn(
  db: Database.Database, aid: string,
  doc: { id: string; type: string; no: string },
  wh: string, item: string, batchNo: string, qty: number, unitCost: number,
  produceDate: string | null, expireDate: string | null, lineSeq: number
) {
  const ex = db.prepare('SELECT id, qty, amount FROM scm_stock_batch WHERE account_set_id=? AND warehouse_code=? AND item_code=? AND batch_no=?')
    .get(aid, wh, item, batchNo) as any
  const addAmt = Math.round(unitCost * qty * 100) / 100
  if (ex) {
    db.prepare('UPDATE scm_stock_batch SET qty=?, amount=?, produce_date=COALESCE(produce_date,?), expire_date=COALESCE(expire_date,?) WHERE id=?')
      .run(Math.round((ex.qty + qty) * 1e6) / 1e6, Math.round((ex.amount + addAmt) * 100) / 100, produceDate, expireDate, ex.id)
  } else {
    db.prepare('INSERT INTO scm_stock_batch (id,account_set_id,warehouse_code,item_code,batch_no,qty,amount,produce_date,expire_date) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(uuidv4(), aid, wh, item, batchNo, qty, addAmt, produceDate, expireDate)
  }
  db.prepare('INSERT INTO scm_batch_move (id,account_set_id,doc_id,doc_type,doc_no,line_seq,warehouse_code,item_code,batch_no,direction,qty,produce_date,expire_date) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(uuidv4(), aid, doc.id, doc.type, doc.no, lineSeq, wh, item, batchNo, 'in', qty, produceDate, expireDate)
}

/** 批次出库：扣减一个批次，记 scm_batch_move */
function batchOutOne(
  db: Database.Database, aid: string,
  doc: { id: string; type: string; no: string },
  wh: string, item: string, batchNo: string, qty: number, lineSeq: number
) {
  const ex = db.prepare('SELECT id, qty, amount FROM scm_stock_batch WHERE account_set_id=? AND warehouse_code=? AND item_code=? AND batch_no=?')
    .get(aid, wh, item, batchNo) as any
  const newQty = Math.round(((ex?.qty || 0) - qty) * 1e6) / 1e6
  if (ex) {
    // 金额按比例冲减（仅追溯参考）
    const outAmt = ex.qty > 0 ? Math.round((ex.amount * qty / ex.qty) * 100) / 100 : 0
    db.prepare('UPDATE scm_stock_batch SET qty=?, amount=? WHERE id=?')
      .run(newQty, Math.round((ex.amount - outAmt) * 100) / 100, ex.id)
  } else {
    db.prepare('INSERT INTO scm_stock_batch (id,account_set_id,warehouse_code,item_code,batch_no,qty,amount) VALUES (?,?,?,?,?,?,?)')
      .run(uuidv4(), aid, wh, item, batchNo, newQty, 0)
  }
  db.prepare('INSERT INTO scm_batch_move (id,account_set_id,doc_id,doc_type,doc_no,line_seq,warehouse_code,item_code,batch_no,direction,qty) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
    .run(uuidv4(), aid, doc.id, doc.type, doc.no, lineSeq, wh, item, batchNo, 'out', qty)
}

/** FIFO 取批次顺序：到期日升序(空值最后) → 生产日期升序 → 入库序(rowid) */
function fifoBatches(db: Database.Database, aid: string, wh: string, item: string) {
  return db.prepare(`SELECT batch_no, qty, produce_date, expire_date FROM scm_stock_batch
    WHERE account_set_id=? AND warehouse_code=? AND item_code=? AND qty>0.000001
    ORDER BY (expire_date IS NULL), expire_date ASC, (produce_date IS NULL), produce_date ASC, rowid ASC`)
    .all(aid, wh, item) as Array<{ batch_no: string; qty: number; produce_date: string | null; expire_date: string | null }>
}

interface BatchAlloc { batch_no: string; qty: number; produce_date: string | null; expire_date: string | null }

/** 出库扣批：manual 按指定批、fifo 跨批，返回实际扣减的批次分配（含日期，供调拨同批转入） */
function consumeBatches(
  db: Database.Database, aid: string,
  doc: { id: string; type: string; no: string },
  wh: string, item: string, qty: number, mode: string, batchNo: string | null, lineSeq: number
): BatchAlloc[] {
  const allocs: BatchAlloc[] = []
  if (mode === 'manual') {
    const bn = batchNo && String(batchNo).trim()
    if (!bn) throw new Error(`批次物料 ${item} 为手工选批，出库行须指定批次号`)
    const b = db.prepare('SELECT qty, produce_date, expire_date FROM scm_stock_batch WHERE account_set_id=? AND warehouse_code=? AND item_code=? AND batch_no=?')
      .get(aid, wh, item, bn) as any
    if (!b || Number(b.qty) < qty - 1e-6) throw new Error(`批次 ${bn}（${item}）库存不足，可用 ${b?.qty || 0}，需 ${qty}`)
    batchOutOne(db, aid, doc, wh, item, bn, qty, lineSeq)
    allocs.push({ batch_no: bn, qty, produce_date: b.produce_date, expire_date: b.expire_date })
  } else {
    let remain = qty
    const avail = fifoBatches(db, aid, wh, item)
    const total = avail.reduce((s, b) => s + b.qty, 0)
    if (total < qty - 1e-6) throw new Error(`物料 ${item} 批次可用合计 ${Math.round(total * 1e6) / 1e6}，不足出库 ${qty}`)
    for (const b of avail) {
      if (remain <= 1e-6) break
      const take = Math.round(Math.min(b.qty, remain) * 1e6) / 1e6
      batchOutOne(db, aid, doc, wh, item, b.batch_no, take, lineSeq)
      allocs.push({ batch_no: b.batch_no, qty: take, produce_date: b.produce_date, expire_date: b.expire_date })
      remain = Math.round((remain - take) * 1e6) / 1e6
    }
  }
  return allocs
}

/** 读取本行移动平均成本（仅作批次金额参考） */
function lineUnitCost(db: Database.Database, aid: string, docType: string, docNo: string, seq: number, item: string, dir: 'in' | 'out'): number {
  const mv = db.prepare(`SELECT unit_cost FROM scm_stock_move WHERE account_set_id=? AND doc_type=? AND doc_no=? AND line_seq=? AND item_code=? AND direction=? LIMIT 1`)
    .get(aid, docType, docNo, seq, item, dir) as any
  return mv ? Number(mv.unit_cost) || 0 : 0
}

/**
 * 按单据维护批次台账（审核时同事务调用，置于库存移动之后）。
 * 出库批次不足会 throw，触发整单回滚 → 路由层返回 400。
 */
export function maintainDocBatches(db: Database.Database, aid: string, docId: string) {
  const doc = db.prepare('SELECT * FROM scm_doc WHERE id=? AND account_set_id=?').get(docId, aid) as any
  if (!doc) return
  const ref = { id: docId, type: doc.doc_type, no: doc.doc_no }
  const lines = db.prepare('SELECT * FROM scm_doc_line WHERE doc_id=? ORDER BY seq').all(docId) as any[]

  // 调拨(TR)：源仓(doc.warehouse_code)扣批 → 调入仓(行仓)按同批次/日期转入
  if (doc.doc_type === 'TR') {
    const src = doc.warehouse_code
    for (const l of lines) {
      const qty = Number(l.qty) || 0
      if (qty <= 0) continue
      const cfg = getItemBatchCfg(db, aid, l.item_code)
      if (!cfg || !cfg.batch_flag) continue
      const dest = l.warehouse_code
      if (!src || !dest) throw new Error(`批次物料 ${l.item_code} 调拨缺少调出/调入仓`)
      const allocs = consumeBatches(db, aid, ref, src, l.item_code, qty, cfg.batch_out_mode || 'fifo', l.batch_no, l.seq)
      const unitCost = lineUnitCost(db, aid, doc.doc_type, doc.doc_no, l.seq, l.item_code, 'in')
      for (const a of allocs) batchIn(db, aid, ref, dest, l.item_code, a.batch_no, a.qty, unitCost, a.produce_date, a.expire_date, l.seq)
    }
    return
  }

  // 盘点(CK)：依据本单库存移动方向——盘盈(in)建批、盘亏(out)按 FIFO/手工扣批
  if (doc.doc_type === 'CK') {
    for (const l of lines) {
      const cfg = getItemBatchCfg(db, aid, l.item_code)
      if (!cfg || !cfg.batch_flag) continue
      const wh = l.warehouse_code || doc.warehouse_code
      if (!wh) continue
      const mv = db.prepare(`SELECT direction, qty FROM scm_stock_move WHERE account_set_id=? AND doc_type=? AND doc_no=? AND line_seq=? AND item_code=? LIMIT 1`)
        .get(aid, doc.doc_type, doc.doc_no, l.seq, l.item_code) as any
      if (!mv) continue  // 无差异不动批次
      const adj = Number(mv.qty) || 0
      if (adj <= 0) continue
      if (mv.direction === 'in') {
        const batchNo = (l.batch_no && String(l.batch_no).trim()) || doc.doc_no
        const produce = l.produce_date || null
        const expire = l.expire_date || (produce ? addDays(produce, cfg.shelf_life_days) : null)
        batchIn(db, aid, ref, wh, l.item_code, batchNo, adj, lineUnitCost(db, aid, doc.doc_type, doc.doc_no, l.seq, l.item_code, 'in'), produce, expire, l.seq)
      } else {
        consumeBatches(db, aid, ref, wh, l.item_code, adj, cfg.batch_out_mode || 'fifo', l.batch_no, l.seq)
      }
    }
    return
  }

  // 普通单向出入库：按单据方向维护
  const dt = db.prepare('SELECT direction FROM scm_doc_type WHERE account_set_id=? AND code=?').get(aid, doc.doc_type) as any
  const dir = dt?.direction
  if (dir !== 'in' && dir !== 'out') return  // 其余 direction=none 单据不处理

  for (const l of lines) {
    const qty = Number(l.qty) || 0
    if (qty <= 0) continue
    const cfg = getItemBatchCfg(db, aid, l.item_code)
    if (!cfg || !cfg.batch_flag) continue
    const wh = l.warehouse_code || doc.warehouse_code
    if (!wh) throw new Error(`批次物料 ${l.item_code} 缺少仓库，无法登记批次`)

    if (dir === 'in') {
      const batchNo = (l.batch_no && String(l.batch_no).trim()) || doc.doc_no
      const produce = l.produce_date || null
      const expire = l.expire_date || (produce ? addDays(produce, cfg.shelf_life_days) : null)
      const unitCost = lineUnitCost(db, aid, doc.doc_type, doc.doc_no, l.seq, l.item_code, 'in') || Number(l.price) || 0
      batchIn(db, aid, ref, wh, l.item_code, batchNo, qty, unitCost, produce, expire, l.seq)
    } else {
      consumeBatches(db, aid, ref, wh, l.item_code, qty, cfg.batch_out_mode || 'fifo', l.batch_no, l.seq)
    }
  }
}

/** 反审核/删单时回退批次台账（读 scm_batch_move 还原 scm_stock_batch 后删除流水） */
export function reverseDocBatches(db: Database.Database, aid: string, docId: string) {
  const moves = db.prepare('SELECT * FROM scm_batch_move WHERE account_set_id=? AND doc_id=?').all(aid, docId) as any[]
  for (const m of moves) {
    const ex = db.prepare('SELECT id, qty FROM scm_stock_batch WHERE account_set_id=? AND warehouse_code=? AND item_code=? AND batch_no=?')
      .get(aid, m.warehouse_code, m.item_code, m.batch_no) as any
    // 入库回退=减少；出库回退=增加
    const delta = m.direction === 'in' ? -Number(m.qty) : Number(m.qty)
    if (ex) {
      db.prepare('UPDATE scm_stock_batch SET qty=? WHERE id=?').run(Math.round((ex.qty + delta) * 1e6) / 1e6, ex.id)
    } else if (delta > 0) {
      db.prepare('INSERT INTO scm_stock_batch (id,account_set_id,warehouse_code,item_code,batch_no,qty,amount) VALUES (?,?,?,?,?,?,?)')
        .run(uuidv4(), aid, m.warehouse_code, m.item_code, m.batch_no, delta, 0)
    }
  }
  db.prepare('DELETE FROM scm_batch_move WHERE account_set_id=? AND doc_id=?').run(aid, docId)
}
