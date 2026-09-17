/**
 * TR 调拨单 / CK 盘点单 审核与反审核全链路单元测试
 *
 * 直接调用 routes/scmDoc.ts 导出的 auditDocHandler / unauditDocHandler / genVoucherHandler，
 * getDb 通过 vi.mock 指向内存库，schema 覆盖审核链路网关到的表。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import Database from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'

let testDb: Database.Database

vi.mock('../db/index.js', () => ({
  getDb: () => testDb,
}))

import { auditDocHandler, unauditDocHandler, genVoucherHandler } from '../routes/scmDoc.js'

const AID = 'AS-TRCK'

function createDb() {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE system_params (id TEXT, account_set_id TEXT, param_key TEXT, param_value TEXT);
    CREATE TABLE scm_item (id TEXT, account_set_id TEXT, code TEXT, name TEXT,
      batch_flag INTEGER DEFAULT 0, batch_out_mode TEXT, shelf_life_days INTEGER DEFAULT 0,
      serial_flag INTEGER DEFAULT 0, default_warehouse_code TEXT, inv_account TEXT);
    CREATE TABLE scm_doc (id TEXT, account_set_id TEXT, doc_type TEXT, doc_no TEXT, status TEXT,
      doc_date TEXT, warehouse_code TEXT, partner_code TEXT, plan_id TEXT, bom_id TEXT,
      voucher_id TEXT, total_amount REAL, auditor TEXT, audited_at TEXT, updated_at TEXT);
    CREATE TABLE scm_doc_line (id TEXT, account_set_id TEXT, doc_id TEXT, seq INTEGER, item_code TEXT,
      warehouse_code TEXT, qty REAL, price REAL, amount REAL, unit_cost REAL,
      batch_no TEXT, serial_nos TEXT, source_line_id TEXT, field_values TEXT, line_role TEXT);
    CREATE TABLE scm_doc_type (account_set_id TEXT, code TEXT, category TEXT, direction TEXT, affects_stock INTEGER);
    CREATE TABLE scm_stock (id TEXT, account_set_id TEXT, warehouse_code TEXT, item_code TEXT,
      qty REAL DEFAULT 0, amount REAL DEFAULT 0, avg_cost REAL DEFAULT 0, updated_at TEXT);
    CREATE TABLE scm_stock_move (id TEXT, account_set_id TEXT, move_date TEXT, doc_type TEXT, doc_no TEXT,
      line_seq INTEGER, warehouse_code TEXT, item_code TEXT, direction TEXT, qty REAL, unit_cost REAL,
      amount REAL, batch_no TEXT, balance_qty REAL, balance_amount REAL, balance_avg_cost REAL);
    CREATE TABLE scm_ar_ap_log (currency TEXT, exchange_rate REAL NOT NULL DEFAULT 1, amount_fc REAL, verified_fc REAL NOT NULL DEFAULT 0, id TEXT, account_set_id TEXT, doc_no TEXT, verified_amount REAL DEFAULT 0);
    CREATE TABLE scm_ar_ap_verify (id TEXT, account_set_id TEXT, verify_no TEXT, in_log_id TEXT, out_log_id TEXT);
    CREATE TABLE scm_production_plan (id TEXT, account_set_id TEXT, source_doc_id TEXT);
    CREATE TABLE scm_batch_move (id TEXT, account_set_id TEXT, doc_id TEXT, warehouse_code TEXT,
      item_code TEXT, batch_no TEXT, direction TEXT, qty REAL);
    CREATE TABLE scm_stock_batch (id TEXT, account_set_id TEXT, warehouse_code TEXT, item_code TEXT,
      batch_no TEXT, qty REAL, amount REAL);
    CREATE TABLE scm_serial_move (id TEXT, account_set_id TEXT, doc_id TEXT, doc_type TEXT, doc_no TEXT,
      line_seq INTEGER, warehouse_code TEXT, item_code TEXT, serial_no TEXT, direction TEXT);
    CREATE TABLE scm_serial (id TEXT, account_set_id TEXT, item_code TEXT, serial_no TEXT, status TEXT,
      warehouse_code TEXT, in_doc_no TEXT, out_doc_no TEXT, updated_at TEXT);
    CREATE TABLE accounts (id TEXT, account_set_id TEXT, code TEXT, name TEXT);
  `)
  return db
}

function seedBase() {
  testDb.prepare('INSERT INTO scm_doc_type (account_set_id,code,category,direction,affects_stock) VALUES (?,?,?,?,1)')
    .run(AID, 'TR', 'inventory', 'none')
  testDb.prepare('INSERT INTO scm_doc_type (account_set_id,code,category,direction,affects_stock) VALUES (?,?,?,?,1)')
    .run(AID, 'CK', 'inventory', 'none')
  testDb.prepare('INSERT INTO scm_item (id,account_set_id,code,name) VALUES (?,?,?,?)')
    .run(uuidv4(), AID, 'I1', '物料甲')
  testDb.prepare('INSERT INTO scm_item (id,account_set_id,code,name) VALUES (?,?,?,?)')
    .run(uuidv4(), AID, 'I2', '物料乙')
  // 调出仓 W-A：I1 有 10 件 @100
  testDb.prepare('INSERT INTO scm_stock (id,account_set_id,warehouse_code,item_code,qty,amount,avg_cost) VALUES (?,?,?,?,?,?,?)')
    .run(uuidv4(), AID, 'W-A', 'I1', 10, 1000, 100)
}

function seedDoc(docType: 'TR' | 'CK', docNo: string, headerWh: string | null,
  lines: Array<{ item?: string; wh?: string | null; qty: number }>) {
  const docId = uuidv4()
  testDb.prepare(`INSERT INTO scm_doc (id,account_set_id,doc_type,doc_no,status,doc_date,warehouse_code)
    VALUES (?,?,?,?,'draft','2026-09-04',?)`).run(docId, AID, docType, docNo, headerWh)
  lines.forEach((l, i) => {
    testDb.prepare('INSERT INTO scm_doc_line (id,account_set_id,doc_id,seq,item_code,warehouse_code,qty) VALUES (?,?,?,?,?,?,?)')
      .run(uuidv4(), AID, docId, i + 1, l.item || 'I1', l.wh ?? null, l.qty)
  })
  return docId
}

function callHandler(handler: any, id: string) {
  const req: any = { params: { id }, accountSetId: AID, userName: '测试员', body: {} }
  const res: any = { statusCode: 200, body: null as any }
  res.status = (c: number) => { res.statusCode = c; return res }
  res.json = (b: any) => { res.body = b; return res }
  handler(req, res)
  return res
}

const stock = (wh: string, item = 'I1') =>
  testDb.prepare('SELECT qty, amount, avg_cost FROM scm_stock WHERE account_set_id=? AND warehouse_code=? AND item_code=?')
    .get(AID, wh, item) as any
const moves = (docNo: string) =>
  testDb.prepare('SELECT warehouse_code, direction, qty, unit_cost, amount FROM scm_stock_move WHERE account_set_id=? AND doc_no=? ORDER BY rowid')
    .all(AID, docNo) as any[]
const docStatus = (id: string) =>
  (testDb.prepare('SELECT status FROM scm_doc WHERE id=?').get(id) as any)?.status

describe('TR 调拨单审核', () => {
  beforeEach(() => { testDb = createDb(); seedBase() })

  it('审核后调出仓减少、调入仓按同成本增加，产生 out+in 两条流水', () => {
    const docId = seedDoc('TR', 'TR-001', 'W-A', [{ wh: 'W-B', qty: 4 }])
    const res = callHandler(auditDocHandler, docId)

    expect(res.body.code).toBe(0)
    expect(res.body.data.status).toBe('audited')
    expect(stock('W-A')).toMatchObject({ qty: 6, amount: 600, avg_cost: 100 })
    expect(stock('W-B')).toMatchObject({ qty: 4, amount: 400, avg_cost: 100 })
    expect(moves('TR-001')).toEqual([
      { warehouse_code: 'W-A', direction: 'out', qty: 4, unit_cost: 100, amount: 400 },
      { warehouse_code: 'W-B', direction: 'in', qty: 4, unit_cost: 100, amount: 400 },
    ])
    // 行成本回写
    const line = testDb.prepare('SELECT unit_cost FROM scm_doc_line WHERE doc_id=?').get(docId) as any
    expect(line.unit_cost).toBe(100)
  })

  it('多行不同调入仓分别入账', () => {
    const docId = seedDoc('TR', 'TR-002', 'W-A', [{ wh: 'W-B', qty: 2 }, { wh: 'W-C', qty: 3 }])
    const res = callHandler(auditDocHandler, docId)

    expect(res.body.code).toBe(0)
    expect(stock('W-A').qty).toBe(5)
    expect(stock('W-B').qty).toBe(2)
    expect(stock('W-C').qty).toBe(3)
  })

  it('调入仓与调出仓相同被拒绝', () => {
    const docId = seedDoc('TR', 'TR-003', 'W-A', [{ wh: 'W-A', qty: 1 }])
    const res = callHandler(auditDocHandler, docId)
    expect(res.statusCode).toBe(400)
    expect(res.body.message).toContain('不能相同')
    expect(docStatus(docId)).toBe('draft')
  })

  it('调出仓库存不足被拒绝且库存不变', () => {
    const docId = seedDoc('TR', 'TR-004', 'W-A', [{ wh: 'W-B', qty: 99 }])
    const res = callHandler(auditDocHandler, docId)
    expect(res.statusCode).toBe(400)
    expect(res.body.message).toContain('调出仓库存不足')
    expect(stock('W-A').qty).toBe(10)
  })

  it('缺调出仓（表头仓库）被拒绝', () => {
    const docId = seedDoc('TR', 'TR-005', null, [{ wh: 'W-B', qty: 1 }])
    const res = callHandler(auditDocHandler, docId)
    expect(res.statusCode).toBe(400)
    expect(res.body.message).toContain('调出仓')
  })

  it('反审核后两仓库存还原、流水删除、状态回草稿', () => {
    const docId = seedDoc('TR', 'TR-006', 'W-A', [{ wh: 'W-B', qty: 4 }])
    callHandler(auditDocHandler, docId)
    const res = callHandler(unauditDocHandler, docId)

    expect(res.body.code).toBe(0)
    expect(stock('W-A')).toMatchObject({ qty: 10, amount: 1000 })
    // 调入仓库存行保留但归零（reverseDocMoves 只冲数量不删行）
    expect(stock('W-B')).toMatchObject({ qty: 0, amount: 0 })
    expect(moves('TR-006')).toEqual([])
    expect(docStatus(docId)).toBe('draft')
  })
})

describe('CK 盘点单审核', () => {
  beforeEach(() => { testDb = createDb(); seedBase() })

  it('盘盈：实盘大于账面，按账面均价入库', () => {
    const docId = seedDoc('CK', 'CK-001', 'W-A', [{ qty: 12 }])
    const res = callHandler(auditDocHandler, docId)

    expect(res.body.code).toBe(0)
    expect(stock('W-A')).toMatchObject({ qty: 12, amount: 1200, avg_cost: 100 })
    expect(moves('CK-001')).toEqual([
      { warehouse_code: 'W-A', direction: 'in', qty: 2, unit_cost: 100, amount: 200 },
    ])
  })

  it('盘亏：实盘小于账面，出库冲减', () => {
    const docId = seedDoc('CK', 'CK-002', 'W-A', [{ qty: 7 }])
    const res = callHandler(auditDocHandler, docId)

    expect(res.body.code).toBe(0)
    expect(stock('W-A')).toMatchObject({ qty: 7, amount: 700 })
    expect(moves('CK-002')).toEqual([
      { warehouse_code: 'W-A', direction: 'out', qty: 3, unit_cost: 100, amount: 300 },
    ])
  })

  it('零差异：实盘等于账面，不产生库存流水', () => {
    const docId = seedDoc('CK', 'CK-003', 'W-A', [{ qty: 10 }])
    const res = callHandler(auditDocHandler, docId)

    expect(res.body.code).toBe(0)
    expect(stock('W-A')).toMatchObject({ qty: 10, amount: 1000 })
    expect(moves('CK-003')).toEqual([])
  })

  it('实盘为 0 视为全盘亏', () => {
    const docId = seedDoc('CK', 'CK-004', 'W-A', [{ qty: 0 }])
    const res = callHandler(auditDocHandler, docId)

    expect(res.body.code).toBe(0)
    expect(stock('W-A')).toMatchObject({ qty: 0, amount: 0 })
    expect(moves('CK-004')).toEqual([
      { warehouse_code: 'W-A', direction: 'out', qty: 10, unit_cost: 100, amount: 1000 },
    ])
  })

  it('账面无库存时盘盈从零建仓', () => {
    const docId = seedDoc('CK', 'CK-005', 'W-B', [{ qty: 5 }])
    const res = callHandler(auditDocHandler, docId)

    expect(res.body.code).toBe(0)
    expect(stock('W-B')).toMatchObject({ qty: 5 })
  })

  it('反审核后库存还原到账面', () => {
    const docId = seedDoc('CK', 'CK-006', 'W-A', [{ qty: 12 }])
    callHandler(auditDocHandler, docId)
    const res = callHandler(unauditDocHandler, docId)

    expect(res.body.code).toBe(0)
    expect(stock('W-A')).toMatchObject({ qty: 10, amount: 1000 })
    expect(moves('CK-006')).toEqual([])
    expect(docStatus(docId)).toBe('draft')
  })
})

describe('TR/CK 不生成凭证（direction=none）', () => {
  beforeEach(() => { testDb = createDb(); seedBase() })

  it('已审核调拨单 gen-voucher 返回「无有效分录」', () => {
    const docId = seedDoc('TR', 'TR-101', 'W-A', [{ wh: 'W-B', qty: 1 }])
    callHandler(auditDocHandler, docId)
    const res = callHandler(genVoucherHandler, docId)
    expect(res.statusCode).toBe(400)
    expect(res.body.message).toContain('无有效分录')
  })

  it('已审核盘点单 gen-voucher 返回「无有效分录」', () => {
    const docId = seedDoc('CK', 'CK-101', 'W-A', [{ qty: 10 }])
    callHandler(auditDocHandler, docId)
    const res = callHandler(genVoucherHandler, docId)
    expect(res.statusCode).toBe(400)
    expect(res.body.message).toContain('无有效分录')
  })
})
