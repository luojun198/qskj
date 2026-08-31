import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'
import { maintainDocBatches, reverseDocBatches, getItemBatchCfg } from '../services/scmBatch.js'

const AID = 'BAT-TEST'

function createDb() {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE scm_item (id TEXT, account_set_id TEXT, code TEXT, name TEXT,
      batch_flag INTEGER DEFAULT 0, batch_out_mode TEXT DEFAULT 'fifo', shelf_life_days INTEGER DEFAULT 0, price REAL DEFAULT 0);
    CREATE TABLE scm_doc (id TEXT, account_set_id TEXT, doc_type TEXT, doc_no TEXT, warehouse_code TEXT);
    CREATE TABLE scm_doc_type (id TEXT, account_set_id TEXT, code TEXT, direction TEXT);
    CREATE TABLE scm_doc_line (id TEXT, doc_id TEXT, account_set_id TEXT, seq INTEGER, item_code TEXT,
      warehouse_code TEXT, qty REAL, price REAL, batch_no TEXT, produce_date TEXT, expire_date TEXT);
    CREATE TABLE scm_stock_batch (id TEXT, account_set_id TEXT, warehouse_code TEXT, item_code TEXT,
      batch_no TEXT, qty REAL DEFAULT 0, amount REAL DEFAULT 0, produce_date TEXT, expire_date TEXT);
    CREATE TABLE scm_batch_move (id TEXT, account_set_id TEXT, doc_id TEXT, doc_type TEXT, doc_no TEXT,
      line_seq INTEGER, warehouse_code TEXT, item_code TEXT, batch_no TEXT, direction TEXT, qty REAL,
      produce_date TEXT, expire_date TEXT, created_at TEXT);
    CREATE TABLE scm_stock_move (id TEXT, account_set_id TEXT, doc_type TEXT, doc_no TEXT, line_seq INTEGER,
      item_code TEXT, direction TEXT, unit_cost REAL, qty REAL);
  `)
  db.prepare("INSERT INTO scm_doc_type (id,account_set_id,code,direction) VALUES (?,?,?,?)").run(uuidv4(), AID, 'PI', 'in')
  db.prepare("INSERT INTO scm_doc_type (id,account_set_id,code,direction) VALUES (?,?,?,?)").run(uuidv4(), AID, 'SO', 'out')
  db.prepare("INSERT INTO scm_doc_type (id,account_set_id,code,direction) VALUES (?,?,?,?)").run(uuidv4(), AID, 'TR', 'none')
  db.prepare("INSERT INTO scm_doc_type (id,account_set_id,code,direction) VALUES (?,?,?,?)").run(uuidv4(), AID, 'CK', 'none')
  return db
}

function addItem(db: Database.Database, code: string, opts: Partial<{ batch_flag: number; batch_out_mode: string; shelf_life_days: number }> = {}) {
  db.prepare("INSERT INTO scm_item (id,account_set_id,code,name,batch_flag,batch_out_mode,shelf_life_days) VALUES (?,?,?,?,?,?,?)")
    .run(uuidv4(), AID, code, code, opts.batch_flag ?? 1, opts.batch_out_mode ?? 'fifo', opts.shelf_life_days ?? 0)
}

/** 建一张单据 + 明细，并写入对应的 scm_stock_move（供 IN 取成本），返回 docId */
function makeDoc(db: Database.Database, docType: string, no: string, wh: string,
  lines: Array<{ item_code: string; qty: number; batch_no?: string; produce_date?: string; expire_date?: string; unit_cost?: number }>) {
  const docId = uuidv4()
  db.prepare("INSERT INTO scm_doc (id,account_set_id,doc_type,doc_no,warehouse_code) VALUES (?,?,?,?,?)").run(docId, AID, docType, no, wh)
  const dir = (db.prepare('SELECT direction FROM scm_doc_type WHERE account_set_id=? AND code=?').get(AID, docType) as any).direction
  lines.forEach((l, i) => {
    db.prepare("INSERT INTO scm_doc_line (id,doc_id,account_set_id,seq,item_code,warehouse_code,qty,batch_no,produce_date,expire_date) VALUES (?,?,?,?,?,?,?,?,?,?)")
      .run(uuidv4(), docId, AID, i + 1, l.item_code, wh, l.qty, l.batch_no ?? null, l.produce_date ?? null, l.expire_date ?? null)
    db.prepare("INSERT INTO scm_stock_move (id,account_set_id,doc_type,doc_no,line_seq,item_code,direction,unit_cost) VALUES (?,?,?,?,?,?,?,?)")
      .run(uuidv4(), AID, docType, no, i + 1, l.item_code, dir, l.unit_cost ?? 0)
  })
  return docId
}

function batches(db: Database.Database, item: string) {
  return db.prepare('SELECT batch_no, qty, expire_date FROM scm_stock_batch WHERE account_set_id=? AND item_code=? ORDER BY batch_no').all(AID, item) as any[]
}

describe('scmBatch 批次/保质期追溯', () => {
  let db: Database.Database
  beforeEach(() => { db = createDb() })

  it('入库建批：批次号缺省用单号，保质期按生产日期+天数算到期', () => {
    addItem(db, 'A', { shelf_life_days: 30 })
    const d = makeDoc(db, 'PI', 'PI-1', 'W1', [{ item_code: 'A', qty: 10, produce_date: '2026-06-01', unit_cost: 5 }])
    maintainDocBatches(db, AID, d)
    const b = batches(db, 'A')
    expect(b).toHaveLength(1)
    expect(b[0]).toMatchObject({ batch_no: 'PI-1', qty: 10, expire_date: '2026-07-01' })
  })

  it('FIFO 跨批出库：按到期日先出，拆分多个批次', () => {
    addItem(db, 'A', { batch_out_mode: 'fifo' })
    maintainDocBatches(db, AID, makeDoc(db, 'PI', 'P1', 'W1', [{ item_code: 'A', qty: 6, batch_no: 'B1', expire_date: '2026-07-01' }]))
    maintainDocBatches(db, AID, makeDoc(db, 'PI', 'P2', 'W1', [{ item_code: 'A', qty: 6, batch_no: 'B2', expire_date: '2026-08-01' }]))
    // 出 8：先扣 B1(6) 再扣 B2(2)
    maintainDocBatches(db, AID, makeDoc(db, 'SO', 'S1', 'W1', [{ item_code: 'A', qty: 8 }]))
    const b = batches(db, 'A')
    expect(b.find(x => x.batch_no === 'B1').qty).toBe(0)
    expect(b.find(x => x.batch_no === 'B2').qty).toBe(4)
  })

  it('手工选批：指定批次扣减；未指定/不足报错', () => {
    addItem(db, 'A', { batch_out_mode: 'manual' })
    maintainDocBatches(db, AID, makeDoc(db, 'PI', 'P1', 'W1', [{ item_code: 'A', qty: 5, batch_no: 'B1' }]))
    maintainDocBatches(db, AID, makeDoc(db, 'PI', 'P2', 'W1', [{ item_code: 'A', qty: 5, batch_no: 'B2' }]))
    // 指定 B2 出 3
    maintainDocBatches(db, AID, makeDoc(db, 'SO', 'S1', 'W1', [{ item_code: 'A', qty: 3, batch_no: 'B2' }]))
    expect(batches(db, 'A').find(x => x.batch_no === 'B2').qty).toBe(2)
    // 未指定批次 → 报错
    expect(() => maintainDocBatches(db, AID, makeDoc(db, 'SO', 'S2', 'W1', [{ item_code: 'A', qty: 1 }]))).toThrow(/手工选批/)
    // 指定批次不足 → 报错
    expect(() => maintainDocBatches(db, AID, makeDoc(db, 'SO', 'S3', 'W1', [{ item_code: 'A', qty: 99, batch_no: 'B1' }]))).toThrow(/不足/)
  })

  it('FIFO 总量不足报错', () => {
    addItem(db, 'A')
    maintainDocBatches(db, AID, makeDoc(db, 'PI', 'P1', 'W1', [{ item_code: 'A', qty: 3, batch_no: 'B1' }]))
    expect(() => maintainDocBatches(db, AID, makeDoc(db, 'SO', 'S1', 'W1', [{ item_code: 'A', qty: 5 }]))).toThrow(/不足/)
  })

  it('反审核回退：入库单回退减批、出库单回退补批', () => {
    addItem(db, 'A')
    const pin = makeDoc(db, 'PI', 'P1', 'W1', [{ item_code: 'A', qty: 10, batch_no: 'B1' }])
    maintainDocBatches(db, AID, pin)
    const sout = makeDoc(db, 'SO', 'S1', 'W1', [{ item_code: 'A', qty: 4 }])
    maintainDocBatches(db, AID, sout)
    expect(batches(db, 'A')[0].qty).toBe(6)
    // 反审核出库单 → 批次回到 10
    reverseDocBatches(db, AID, sout)
    expect(batches(db, 'A')[0].qty).toBe(10)
    // 反审核入库单 → 批次回到 0
    reverseDocBatches(db, AID, pin)
    expect(batches(db, 'A')[0].qty).toBe(0)
  })

  it('非批次物料不建批', () => {
    addItem(db, 'A', { batch_flag: 0 })
    maintainDocBatches(db, AID, makeDoc(db, 'PI', 'P1', 'W1', [{ item_code: 'A', qty: 10 }]))
    expect(batches(db, 'A')).toHaveLength(0)
  })

  it('调拨(TR)：源仓扣批 → 调入仓按同批次/日期转入', () => {
    addItem(db, 'A', { batch_out_mode: 'fifo' })
    maintainDocBatches(db, AID, makeDoc(db, 'PI', 'P1', 'W1', [{ item_code: 'A', qty: 10, batch_no: 'B1', expire_date: '2026-09-01' }]))
    // 调拨：W1 → W2，调出 6
    const docId = uuidv4()
    db.prepare("INSERT INTO scm_doc (id,account_set_id,doc_type,doc_no,warehouse_code) VALUES (?,?,?,?,?)").run(docId, AID, 'TR', 'T1', 'W1')
    db.prepare("INSERT INTO scm_doc_line (id,doc_id,account_set_id,seq,item_code,warehouse_code,qty) VALUES (?,?,?,?,?,?,?)").run(uuidv4(), docId, AID, 1, 'A', 'W2', 6)
    // TR 同时写 out(W1)+in(W2) 库存流水
    db.prepare("INSERT INTO scm_stock_move (id,account_set_id,doc_type,doc_no,line_seq,item_code,direction,unit_cost) VALUES (?,?,?,?,?,?,?,?)").run(uuidv4(), AID, 'TR', 'T1', 1, 'A', 'out', 5)
    db.prepare("INSERT INTO scm_stock_move (id,account_set_id,doc_type,doc_no,line_seq,item_code,direction,unit_cost) VALUES (?,?,?,?,?,?,?,?)").run(uuidv4(), AID, 'TR', 'T1', 1, 'A', 'in', 5)
    maintainDocBatches(db, AID, docId)
    const w1 = db.prepare("SELECT qty FROM scm_stock_batch WHERE account_set_id=? AND warehouse_code='W1' AND item_code='A' AND batch_no='B1'").get(AID) as any
    const w2 = db.prepare("SELECT qty, expire_date FROM scm_stock_batch WHERE account_set_id=? AND warehouse_code='W2' AND item_code='A' AND batch_no='B1'").get(AID) as any
    expect(w1.qty).toBe(4)
    expect(w2).toMatchObject({ qty: 6, expire_date: '2026-09-01' })  // 同批次同到期日转入
  })

  it('盘点(CK)：盘亏 FIFO 出批、盘盈建批', () => {
    addItem(db, 'A', { batch_out_mode: 'fifo' })
    maintainDocBatches(db, AID, makeDoc(db, 'PI', 'P1', 'W1', [{ item_code: 'A', qty: 10, batch_no: 'B1' }]))
    // 盘亏 3（move out 3）
    const ck1 = uuidv4()
    db.prepare("INSERT INTO scm_doc (id,account_set_id,doc_type,doc_no,warehouse_code) VALUES (?,?,?,?,?)").run(ck1, AID, 'CK', 'C1', 'W1')
    db.prepare("INSERT INTO scm_doc_line (id,doc_id,account_set_id,seq,item_code,warehouse_code,qty) VALUES (?,?,?,?,?,?,?)").run(uuidv4(), ck1, AID, 1, 'A', 'W1', 7)
    db.prepare("INSERT INTO scm_stock_move (id,account_set_id,doc_type,doc_no,line_seq,item_code,direction,unit_cost) VALUES (?,?,?,?,?,?,?,?)").run(uuidv4(), AID, 'CK', 'C1', 1, 'A', 'out', 5)
    // qty 字段=调整量 3
    db.prepare("UPDATE scm_stock_move SET qty=3 WHERE doc_no='C1'").run()
    maintainDocBatches(db, AID, ck1)
    expect((db.prepare("SELECT qty FROM scm_stock_batch WHERE account_set_id=? AND batch_no='B1'").get(AID) as any).qty).toBe(7)
    // 盘盈 5（move in 5）→ 建批 C2(单号)
    const ck2 = uuidv4()
    db.prepare("INSERT INTO scm_doc (id,account_set_id,doc_type,doc_no,warehouse_code) VALUES (?,?,?,?,?)").run(ck2, AID, 'CK', 'C2', 'W1')
    db.prepare("INSERT INTO scm_doc_line (id,doc_id,account_set_id,seq,item_code,warehouse_code,qty) VALUES (?,?,?,?,?,?,?)").run(uuidv4(), ck2, AID, 1, 'A', 'W1', 12)
    db.prepare("INSERT INTO scm_stock_move (id,account_set_id,doc_type,doc_no,line_seq,item_code,direction,unit_cost,qty) VALUES (?,?,?,?,?,?,?,?,?)").run(uuidv4(), AID, 'CK', 'C2', 1, 'A', 'in', 5, 5)
    maintainDocBatches(db, AID, ck2)
    expect((db.prepare("SELECT qty FROM scm_stock_batch WHERE account_set_id=? AND batch_no='C2'").get(AID) as any).qty).toBe(5)
  })

  it('getItemBatchCfg 读取配置', () => {
    addItem(db, 'A', { batch_flag: 1, batch_out_mode: 'manual', shelf_life_days: 90 })
    expect(getItemBatchCfg(db, AID, 'A')).toMatchObject({ batch_flag: 1, batch_out_mode: 'manual', shelf_life_days: 90 })
    expect(getItemBatchCfg(db, AID, 'NONE')).toBeNull()
  })
})
