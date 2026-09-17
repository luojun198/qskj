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
  db.exec(`CREATE TABLE scm_stock_move (id TEXT, account_set_id TEXT, doc_type TEXT, doc_no TEXT,
      line_seq INTEGER, warehouse_code TEXT, item_code TEXT, direction TEXT, qty REAL);`)
  for (const [c, d] of [['PI', 'in'], ['SO', 'out'], ['TR', 'none'], ['CK', 'none']]) {
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

  // ── S6：盘点(CK)维护序列号台账 ────────────────────────────

  const mkMove = (db: Database.Database, docNo: string, dir: string, qty: number) =>
    db.prepare("INSERT INTO scm_stock_move (id,account_set_id,doc_type,doc_no,line_seq,item_code,direction,qty) VALUES (?,?,?,?,?,?,?,?)")
      .run(uuidv4(), AID, 'CK', docNo, 1, 'A', dir, qty)

  it('S6 盘盈：实盘清单里账上没有的序列号被登记入库', () => {
    maintainDocSerials(db, AID, mkdoc(db, 'PI', 'P1', 'W1', 'A', 1, ['SN1']))
    const ck = mkdoc(db, 'CK', 'C1', 'W1', 'A', 2, ['SN1', 'SN2'])
    mkMove(db, 'C1', 'in', 1)
    expect(maintainDocSerials(db, AID, ck)).toEqual([])
    expect(inStock(db, 'SN2')).toMatchObject({ status: 'in_stock', warehouse_code: 'W1' })
    expect(inStock(db, 'SN1').status).toBe('in_stock')
  })

  it('S6 盘亏：账上在库但实盘清单里没有的序列号被核销', () => {
    maintainDocSerials(db, AID, mkdoc(db, 'PI', 'P1', 'W1', 'A', 2, ['SN1', 'SN2']))
    const ck = mkdoc(db, 'CK', 'C1', 'W1', 'A', 1, ['SN1'])
    mkMove(db, 'C1', 'out', 1)
    expect(maintainDocSerials(db, AID, ck)).toEqual([])
    expect(inStock(db, 'SN2').status).toBe('out')
    expect(inStock(db, 'SN1').status).toBe('in_stock')
  })

  it('S6 盘点差异与序列号对不上时只告警不拦截', () => {
    maintainDocSerials(db, AID, mkdoc(db, 'PI', 'P1', 'W1', 'A', 1, ['SN1']))
    const ck = mkdoc(db, 'CK', 'C1', 'W1', 'A', 3, ['SN1'])
    mkMove(db, 'C1', 'in', 2)
    const warnings = maintainDocSerials(db, AID, ck)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatch(/盘盈 2/)
  })

  it('S6 账实相符（无库存移动）时序列号台账不动', () => {
    maintainDocSerials(db, AID, mkdoc(db, 'PI', 'P1', 'W1', 'A', 1, ['SN1']))
    const ck = mkdoc(db, 'CK', 'C1', 'W1', 'A', 1, ['SN1'])
    expect(maintainDocSerials(db, AID, ck)).toEqual([])
    expect(inStock(db, 'SN1').status).toBe('in_stock')
    const moves = db.prepare("SELECT COUNT(*) c FROM scm_serial_move WHERE doc_type='CK'").get() as any
    expect(moves.c).toBe(0)
  })

  it('非序列号物料跳过', () => {
    db.prepare("INSERT INTO scm_item (id,account_set_id,code,name,serial_flag) VALUES (?,?,?,?,0)").run(uuidv4(), AID, 'B', 'B')
    maintainDocSerials(db, AID, mkdoc(db, 'PI', 'P1', 'W1', 'B', 5, []))
    expect(isSerialItem(db, AID, 'B')).toBe(false)
    expect(db.prepare('SELECT COUNT(*) c FROM scm_serial').get() as any).toMatchObject({ c: 0 })
  })

  it('FIX-205 调拨反审核：序列号档案保留、回到原仓，原始入库追溯不丢，调拨可重新审核', () => {
    maintainDocSerials(db, AID, mkdoc(db, 'PI', 'P1', 'W1', 'A', 1, ['SN1']))
    const tr = mkdoc(db, 'TR', 'T1', 'W1', 'A', 1, ['SN1'], 'W2')
    maintainDocSerials(db, AID, tr)
    expect(inStock(db, 'SN1')).toMatchObject({ status: 'in_stock', warehouse_code: 'W2' })
    reverseDocSerials(db, AID, tr)
    const sn = db.prepare("SELECT status, warehouse_code, in_doc_no, out_doc_no FROM scm_serial WHERE account_set_id=? AND serial_no='SN1'").get(AID) as any
    expect(sn).toMatchObject({ status: 'in_stock', warehouse_code: 'W1', in_doc_no: 'P1', out_doc_no: null })
    // PI 的流水仍在，只有调拨流水被删
    expect((db.prepare("SELECT COUNT(*) c FROM scm_serial_move WHERE doc_no='P1'").get() as any).c).toBe(1)
    expect((db.prepare("SELECT COUNT(*) c FROM scm_serial_move WHERE doc_no='T1'").get() as any).c).toBe(0)
    // 再次审核调拨通过
    expect(() => maintainDocSerials(db, AID, tr)).not.toThrow()
    expect(inStock(db, 'SN1')).toMatchObject({ status: 'in_stock', warehouse_code: 'W2' })
  })

  it('FIX-205 销售出库反审核后再反审核入库：按剩余流水逐级还原', () => {
    const pin = mkdoc(db, 'PI', 'P1', 'W1', 'A', 1, ['SN1'])
    maintainDocSerials(db, AID, pin)
    const so = mkdoc(db, 'SO', 'S1', 'W1', 'A', 1, ['SN1'])
    maintainDocSerials(db, AID, so)
    // 反审核顺序错乱（先入后出）也不会把档案误删：入库回退后档案按出库流水还原为已出库
    reverseDocSerials(db, AID, pin)
    expect(inStock(db, 'SN1')).toMatchObject({ status: 'out' })
    reverseDocSerials(db, AID, so)
    expect(inStock(db, 'SN1')).toBeUndefined()
  })

  it('FIX-206 组装单：子件序列号核销、成品序列号登记；被消耗的序列号不能再出库', () => {
    db.prepare("INSERT INTO scm_doc_type (id,account_set_id,code,direction) VALUES (?,?,?,?)").run(uuidv4(), AID, 'AS', 'none')
    db.prepare("INSERT INTO scm_item (id,account_set_id,code,name,serial_flag) VALUES (?,?,?,?,1)").run(uuidv4(), AID, 'FP', 'FP')
    maintainDocSerials(db, AID, mkdoc(db, 'PI', 'P1', 'W1', 'A', 2, ['SN1', 'SN2']))
    // 组装单：行1 子件 A×2（出），行2 成品 FP×1（入）；库存移动由成本引擎写入，这里直接模拟
    const asId = uuidv4()
    db.prepare("INSERT INTO scm_doc (id,account_set_id,doc_type,doc_no,warehouse_code) VALUES (?,?,?,?,?)").run(asId, AID, 'AS', 'AS1', 'W1')
    db.prepare("INSERT INTO scm_doc_line (id,doc_id,account_set_id,seq,item_code,warehouse_code,qty,serial_nos) VALUES (?,?,?,?,?,?,?,?)")
      .run(uuidv4(), asId, AID, 1, 'A', 'W1', 2, JSON.stringify(['SN1', 'SN2']))
    db.prepare("INSERT INTO scm_doc_line (id,doc_id,account_set_id,seq,item_code,warehouse_code,qty,serial_nos) VALUES (?,?,?,?,?,?,?,?)")
      .run(uuidv4(), asId, AID, 2, 'FP', 'W1', 1, JSON.stringify(['FP-001']))
    db.prepare("INSERT INTO scm_stock_move (id,account_set_id,doc_type,doc_no,line_seq,warehouse_code,item_code,direction,qty) VALUES (?,?,?,?,?,?,?,?,?)")
      .run(uuidv4(), AID, 'AS', 'AS1', 1, 'W1', 'A', 'out', 2)
    db.prepare("INSERT INTO scm_stock_move (id,account_set_id,doc_type,doc_no,line_seq,warehouse_code,item_code,direction,qty) VALUES (?,?,?,?,?,?,?,?,?)")
      .run(uuidv4(), AID, 'AS', 'AS1', 2, 'W1', 'FP', 'in', 1)
    maintainDocSerials(db, AID, asId)
    expect(inStock(db, 'SN1').status).toBe('out')
    expect(inStock(db, 'SN2').status).toBe('out')
    expect(inStock(db, 'FP-001')).toMatchObject({ status: 'in_stock', warehouse_code: 'W1' })
    expect(() => maintainDocSerials(db, AID, mkdoc(db, 'SO', 'S1', 'W1', 'A', 1, ['SN1']))).toThrow(/不在库/)
    // 反审核组装单：子件恢复在库，成品撤销建档
    reverseDocSerials(db, AID, asId)
    expect(inStock(db, 'SN1')).toMatchObject({ status: 'in_stock', warehouse_code: 'W1' })
    expect(inStock(db, 'FP-001')).toBeUndefined()
  })
})
