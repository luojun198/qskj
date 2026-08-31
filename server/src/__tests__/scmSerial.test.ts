import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'
import { maintainDocSerials, reverseDocSerials, isSerialItem } from '../services/scmSerial.js'

const AID = 'SN-TEST'

function createDb() {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE scm_item (id TEXT, account_set_id TEXT, code TEXT, name TEXT, serial_flag INTEGER DEFAULT 0);
    CREATE TABLE scm_doc (id TEXT, account_set_id TEXT, doc_type TEXT, doc_no TEXT, warehouse_code TEXT);
    CREATE TABLE scm_doc_type (id TEXT, account_set_id TEXT, code TEXT, direction TEXT);
    CREATE TABLE scm_doc_line (id TEXT, doc_id TEXT, account_set_id TEXT, seq INTEGER, item_code TEXT,
      warehouse_code TEXT, qty REAL, serial_nos TEXT);
    CREATE TABLE scm_serial (id TEXT, account_set_id TEXT, item_code TEXT, serial_no TEXT, warehouse_code TEXT,
      status TEXT, in_doc_no TEXT, out_doc_no TEXT, updated_at TEXT);
    CREATE TABLE scm_serial_move (id TEXT, account_set_id TEXT, doc_id TEXT, doc_type TEXT, doc_no TEXT,
      line_seq INTEGER, warehouse_code TEXT, item_code TEXT, serial_no TEXT, direction TEXT, created_at TEXT);
  `)
  for (const [c, d] of [['PI', 'in'], ['SO', 'out'], ['TR', 'none']]) {
    db.prepare("INSERT INTO scm_doc_type (id,account_set_id,code,direction) VALUES (?,?,?,?)").run(uuidv4(), AID, c, d)
  }
  db.prepare("INSERT INTO scm_item (id,account_set_id,code,name,serial_flag) VALUES (?,?,?,?,1)").run(uuidv4(), AID, 'A', 'A')
  return db
}

function mkdoc(db: Database.Database, type: string, no: string, wh: string, item: string, qty: number, serials: string[], destWh?: string) {
  const id = uuidv4()
  db.prepare("INSERT INTO scm_doc (id,account_set_id,doc_type,doc_no,warehouse_code) VALUES (?,?,?,?,?)").run(id, AID, type, no, wh)
  db.prepare("INSERT INTO scm_doc_line (id,doc_id,account_set_id,seq,item_code,warehouse_code,qty,serial_nos) VALUES (?,?,?,?,?,?,?,?)")
    .run(uuidv4(), id, AID, 1, item, destWh || wh, qty, JSON.stringify(serials))
  return id
}
const inStock = (db: Database.Database, sn: string) => db.prepare("SELECT status, warehouse_code FROM scm_serial WHERE account_set_id=? AND serial_no=?").get(AID, sn) as any

describe('scmSerial 序列号追溯', () => {
  let db: Database.Database
  beforeEach(() => { db = createDb() })

  it('入库登记 + 出库核销', () => {
    maintainDocSerials(db, AID, mkdoc(db, 'PI', 'P1', 'W1', 'A', 2, ['SN1', 'SN2']))
    expect(inStock(db, 'SN1')).toMatchObject({ status: 'in_stock', warehouse_code: 'W1' })
    maintainDocSerials(db, AID, mkdoc(db, 'SO', 'S1', 'W1', 'A', 1, ['SN1']))
    expect(inStock(db, 'SN1').status).toBe('out')
    expect(inStock(db, 'SN2').status).toBe('in_stock')
  })

  it('序列号个数须等于数量', () => {
    expect(() => maintainDocSerials(db, AID, mkdoc(db, 'PI', 'P1', 'W1', 'A', 2, ['SN1']))).toThrow(/须录入 2 个/)
  })

  it('重复入库 / 出库不在库 报错', () => {
    maintainDocSerials(db, AID, mkdoc(db, 'PI', 'P1', 'W1', 'A', 1, ['SN1']))
    expect(() => maintainDocSerials(db, AID, mkdoc(db, 'PI', 'P2', 'W1', 'A', 1, ['SN1']))).toThrow(/已在库/)
    expect(() => maintainDocSerials(db, AID, mkdoc(db, 'SO', 'S9', 'W1', 'A', 1, ['NOPE']))).toThrow(/不在库/)
  })

  it('同单重复序列号报错', () => {
    expect(() => maintainDocSerials(db, AID, mkdoc(db, 'PI', 'P1', 'W1', 'A', 2, ['SN1', 'SN1']))).toThrow(/重复/)
  })

  it('调拨：原仓出 + 目标仓入（同序列号换仓）', () => {
    maintainDocSerials(db, AID, mkdoc(db, 'PI', 'P1', 'W1', 'A', 1, ['SN1']))
    maintainDocSerials(db, AID, mkdoc(db, 'TR', 'T1', 'W1', 'A', 1, ['SN1'], 'W2'))
    expect(inStock(db, 'SN1')).toMatchObject({ status: 'in_stock', warehouse_code: 'W2' })
  })

  it('反审核回退：入库撤销在库、出库恢复在库', () => {
    const pin = mkdoc(db, 'PI', 'P1', 'W1', 'A', 2, ['SN1', 'SN2'])
    maintainDocSerials(db, AID, pin)
    const sout = mkdoc(db, 'SO', 'S1', 'W1', 'A', 1, ['SN1'])
    maintainDocSerials(db, AID, sout)
    reverseDocSerials(db, AID, sout)  // 撤销出库 → SN1 回到在库
    expect(inStock(db, 'SN1')).toMatchObject({ status: 'in_stock', warehouse_code: 'W1' })
    reverseDocSerials(db, AID, pin)   // 撤销入库（本单为建档来源）→ 删除登记
    expect(inStock(db, 'SN1')).toBeUndefined()
    expect(inStock(db, 'SN2')).toBeUndefined()
  })

  it('非序列号物料跳过', () => {
    db.prepare("INSERT INTO scm_item (id,account_set_id,code,name,serial_flag) VALUES (?,?,?,?,0)").run(uuidv4(), AID, 'B', 'B')
    maintainDocSerials(db, AID, mkdoc(db, 'PI', 'P1', 'W1', 'B', 5, []))
    expect(isSerialItem(db, AID, 'B')).toBe(false)
    expect(db.prepare('SELECT COUNT(*) c FROM scm_serial').get() as any).toMatchObject({ c: 0 })
  })
})
