/**
 * 供应链序列号追溯引擎（收尾2）
 *
 * 仅对「启用序列号管理」(scm_item.serial_flag=1) 的物料生效，按单据方向维护：
 *  - 入库类：每行 serial_nos 个数须等于数量，逐个登记为在库（重复在库则报错）。
 *  - 出库类：每行 serial_nos 个数须等于数量，逐个核销（须在库且在本仓）。
 * 与批次/成本台账并行，仅做单品追溯。调拨(TR) 作「出库原仓 + 入库目标仓」处理；
 * 盘点(CK) 按本单实际产生的库存移动方向调整台账（盘盈登记、盘亏核销），
 * 差异数与录入的序列号对不上时只告警不拦截——盘点本身就是纠偏场景，
 * 硬拦会让用户无法完成盘点。其它 direction=none 单据不处理。
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

/**
 * 按单据维护序列号台账（审核同事务，置于库存移动之后），异常 throw 触发整单回滚。
 * 返回非阻断性告警（目前仅盘点单会产生），由审核接口透传给前端。
 */
export function maintainDocSerials(db: Database.Database, aid: string, docId: string): string[] {
  const warnings: string[] = []
  const doc = db.prepare('SELECT * FROM scm_doc WHERE id=? AND account_set_id=?').get(docId, aid) as any
  if (!doc) return warnings
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
    return warnings
  }

  // 盘点(CK)：依据本单实际产生的库存移动方向调整——盘盈登记新序列号、盘亏核销缺失的序列号。
  // 与批次模块（scmBatch 的 CK 分支）取同一套数据源，保证两个台账口径一致。
  if (doc.doc_type === 'CK') {
    for (const l of lines) {
      if (!isSerialItem(db, aid, l.item_code)) continue
      const wh = l.warehouse_code || doc.warehouse_code
      if (!wh) continue
      const mv = db.prepare(
        `SELECT direction, qty FROM scm_stock_move
          WHERE account_set_id=? AND doc_type=? AND doc_no=? AND line_seq=? AND item_code=? LIMIT 1`
      ).get(aid, doc.doc_type, doc.doc_no, l.seq, l.item_code) as any
      if (!mv) continue  // 账实相符，序列号台账不动
      const adj = Number(mv.qty) || 0
      if (adj <= 0) continue

      const counted = parseSerials(l.serial_nos)
      const onBook = db.prepare(
        `SELECT serial_no FROM scm_serial
          WHERE account_set_id=? AND item_code=? AND warehouse_code=? AND status='in_stock'`
      ).all(aid, l.item_code, wh) as Array<{ serial_no: string }>
      const onBookSet = new Set(onBook.map(r => r.serial_no))

      if (mv.direction === 'in') {
        // 盘盈：实盘清单里账上没有的那些，就是要补登记的
        const toRegister = counted.filter(sn => !onBookSet.has(sn)).slice(0, adj)
        for (const sn of toRegister) serialIn(db, aid, ref, wh, l.item_code, sn, l.seq)
        if (toRegister.length < adj) {
          warnings.push(
            `物料 ${l.item_code} 盘盈 ${adj}，但只提供了 ${toRegister.length} 个可登记的序列号，其余未登记`
          )
        }
      } else {
        // 盘亏：账上在库、实盘清单里却没有的那些，就是丢失的
        const missing = [...onBookSet].filter(sn => !counted.includes(sn)).slice(0, adj)
        for (const sn of missing) serialOut(db, aid, ref, wh, l.item_code, sn, l.seq)
        if (missing.length < adj) {
          warnings.push(
            `物料 ${l.item_code} 盘亏 ${adj}，但只能定位到 ${missing.length} 个缺失序列号，其余未核销`
          )
        }
      }
    }
    return warnings
  }

  const dt = db.prepare('SELECT direction FROM scm_doc_type WHERE account_set_id=? AND code=?').get(aid, doc.doc_type) as any
  const dir = dt?.direction
  if (dir !== 'in' && dir !== 'out') return warnings  // 调拨/盘点以外的 none 方向单据不处理

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
  return warnings
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
