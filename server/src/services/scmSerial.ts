/**
 * 供应链序列号追溯引擎（收尾2）
 *
 * 仅对「启用序列号管理」(scm_item.serial_flag=1) 的物料生效，按单据方向维护：
 *  - 入库类：每行 serial_nos 个数须等于数量，逐个登记为在库（重复在库则报错）。
 *  - 出库类：每行 serial_nos 个数须等于数量，逐个核销（须在库且在本仓）。
 * 与批次/成本台账并行，仅做单品追溯。调拨(TR) 作「出库原仓 + 入库目标仓」处理；
 * 盘点(CK)/direction=none 其它单据暂不处理（注明）。
 */
import type Database from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'

export function isSerialItem(db: Database.Database, aid: string, itemCode: string): boolean {
  const r = db.prepare('SELECT serial_flag FROM scm_item WHERE account_set_id=? AND code=?').get(aid, itemCode) as any
  return !!(r && Number(r.serial_flag))
}

function parseSerials(raw: any): string[] {
  if (!raw) return []
  let arr: any = raw
  if (typeof raw === 'string') {
    try { arr = JSON.parse(raw) } catch { arr = raw.split(/[\s,;]+/) }
  }
  if (!Array.isArray(arr)) return []
  return arr.map((s: any) => String(s).trim()).filter(Boolean)
}

function serialIn(db: Database.Database, aid: string, doc: { id: string; type: string; no: string }, wh: string, item: string, sn: string, seq: number) {
  const ex = db.prepare('SELECT id, status FROM scm_serial WHERE account_set_id=? AND item_code=? AND serial_no=?').get(aid, item, sn) as any
  if (ex && ex.status === 'in_stock') throw new Error(`序列号 ${sn}（${item}）已在库，不能重复入库`)
  if (ex) {
    db.prepare("UPDATE scm_serial SET warehouse_code=?, status='in_stock', in_doc_no=?, out_doc_no=NULL, updated_at=datetime('now') WHERE id=?")
      .run(wh, doc.no, ex.id)
  } else {
    db.prepare("INSERT INTO scm_serial (id,account_set_id,item_code,serial_no,warehouse_code,status,in_doc_no) VALUES (?,?,?,?,?,'in_stock',?)")
      .run(uuidv4(), aid, item, sn, wh, doc.no)
  }
  db.prepare('INSERT INTO scm_serial_move (id,account_set_id,doc_id,doc_type,doc_no,line_seq,warehouse_code,item_code,serial_no,direction) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .run(uuidv4(), aid, doc.id, doc.type, doc.no, seq, wh, item, sn, 'in')
}

function serialOut(db: Database.Database, aid: string, doc: { id: string; type: string; no: string }, wh: string, item: string, sn: string, seq: number) {
  const ex = db.prepare('SELECT id, status, warehouse_code FROM scm_serial WHERE account_set_id=? AND item_code=? AND serial_no=?').get(aid, item, sn) as any
  if (!ex || ex.status !== 'in_stock') throw new Error(`序列号 ${sn}（${item}）不在库，无法出库`)
  if (wh && ex.warehouse_code && ex.warehouse_code !== wh) throw new Error(`序列号 ${sn} 在仓库 ${ex.warehouse_code}，与出库仓 ${wh} 不符`)
  db.prepare("UPDATE scm_serial SET status='out', out_doc_no=?, updated_at=datetime('now') WHERE id=?").run(doc.no, ex.id)
  db.prepare('INSERT INTO scm_serial_move (id,account_set_id,doc_id,doc_type,doc_no,line_seq,warehouse_code,item_code,serial_no,direction) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .run(uuidv4(), aid, doc.id, doc.type, doc.no, seq, wh, item, sn, 'out')
}

/** 按单据维护序列号台账（审核同事务，置于库存移动之后），异常 throw 触发整单回滚。 */
export function maintainDocSerials(db: Database.Database, aid: string, docId: string) {
  const doc = db.prepare('SELECT * FROM scm_doc WHERE id=? AND account_set_id=?').get(docId, aid) as any
  if (!doc) return
  const ref = { id: docId, type: doc.doc_type, no: doc.doc_no }
  const lines = db.prepare('SELECT * FROM scm_doc_line WHERE doc_id=? ORDER BY seq').all(docId) as any[]

  // 调拨：原仓出 + 目标仓入（同序列号）
  if (doc.doc_type === 'TR') {
    for (const l of lines) {
      if (!isSerialItem(db, aid, l.item_code)) continue
      const sns = parseSerials(l.serial_nos)
      const qty = Number(l.qty) || 0
      if (sns.length !== qty) throw new Error(`序列号物料 ${l.item_code} 调拨须录入 ${qty} 个序列号，实际 ${sns.length} 个`)
      for (const sn of sns) { serialOut(db, aid, ref, doc.warehouse_code, l.item_code, sn, l.seq); serialIn(db, aid, ref, l.warehouse_code, l.item_code, sn, l.seq) }
    }
    return
  }

  const dt = db.prepare('SELECT direction FROM scm_doc_type WHERE account_set_id=? AND code=?').get(aid, doc.doc_type) as any
  const dir = dt?.direction
  if (dir !== 'in' && dir !== 'out') return  // 盘点等暂不处理

  for (const l of lines) {
    if (!isSerialItem(db, aid, l.item_code)) continue
    const qty = Number(l.qty) || 0
    if (qty <= 0) continue
    const wh = l.warehouse_code || doc.warehouse_code
    if (!wh) throw new Error(`序列号物料 ${l.item_code} 缺少仓库`)
    const sns = parseSerials(l.serial_nos)
    if (sns.length !== qty) throw new Error(`序列号物料 ${l.item_code} 须录入 ${qty} 个序列号，实际 ${sns.length} 个`)
    const dup = new Set<string>()
    for (const sn of sns) { if (dup.has(sn)) throw new Error(`序列号 ${sn} 在同一单据内重复`); dup.add(sn) }
    for (const sn of sns) {
      if (dir === 'in') serialIn(db, aid, ref, wh, l.item_code, sn, l.seq)
      else serialOut(db, aid, ref, wh, l.item_code, sn, l.seq)
    }
  }
}

/** 反审核/删单回退序列号台账（按流水还原状态后删除流水）。 */
export function reverseDocSerials(db: Database.Database, aid: string, docId: string) {
  const moves = db.prepare('SELECT * FROM scm_serial_move WHERE account_set_id=? AND doc_id=? ORDER BY rowid DESC').all(aid, docId) as any[]
  for (const m of moves) {
    const ex = db.prepare('SELECT id, in_doc_no FROM scm_serial WHERE account_set_id=? AND item_code=? AND serial_no=?').get(aid, m.item_code, m.serial_no) as any
    if (!ex) continue
    if (m.direction === 'in') {
      // 入库回退：若本单是其当前入库来源则删除登记（撤销建档）；否则保守标记为已出库
      if (ex.in_doc_no === m.doc_no) db.prepare('DELETE FROM scm_serial WHERE id=?').run(ex.id)
      else db.prepare("UPDATE scm_serial SET status='out', updated_at=datetime('now') WHERE id=?").run(ex.id)
    } else {
      // 出库回退 → 恢复在库（回到原仓）
      db.prepare("UPDATE scm_serial SET status='in_stock', warehouse_code=?, out_doc_no=NULL, updated_at=datetime('now') WHERE id=?").run(m.warehouse_code, ex.id)
    }
  }
  db.prepare('DELETE FROM scm_serial_move WHERE account_set_id=? AND doc_id=?').run(aid, docId)
}
