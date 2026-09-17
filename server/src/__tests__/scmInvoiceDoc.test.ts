/**
 * S1：采购/销售发票（RP/RS）审核挂账与制证。
 *
 * 直接调用 routes/scmDoc.ts 导出的 auditDocHandler / genVoucherHandler，
 * getDb 通过 vi.mock 指向内存库。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import Database from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'

let testDb: Database.Database
vi.mock('../db/index.js', () => ({ getDb: () => testDb }))

import { auditDocHandler, genVoucherHandler } from '../routes/scmDoc.js'

const AID = 'INV-TEST'

function createDb() {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE system_params (id TEXT, account_set_id TEXT, param_key TEXT, param_value TEXT);
    CREATE TABLE scm_item (id TEXT, account_set_id TEXT, code TEXT, name TEXT,
      batch_flag INTEGER DEFAULT 0, batch_out_mode TEXT, shelf_life_days INTEGER DEFAULT 0,
      serial_flag INTEGER DEFAULT 0, default_warehouse_code TEXT, inv_account TEXT,
      purchase_price REAL, ref_cost REAL);
    CREATE TABLE scm_doc (id TEXT, account_set_id TEXT, doc_type TEXT, doc_no TEXT, status TEXT,
      doc_date TEXT, warehouse_code TEXT, partner_code TEXT, plan_id TEXT, bom_id TEXT,
      source_doc_id TEXT, voucher_id TEXT, total_amount REAL, auditor TEXT, audited_at TEXT, updated_at TEXT);
    CREATE TABLE scm_doc_line (id TEXT, account_set_id TEXT, doc_id TEXT, seq INTEGER, item_code TEXT,
      warehouse_code TEXT, qty REAL, price REAL, amount REAL, tax_amount REAL, unit_cost REAL,
      batch_no TEXT, serial_nos TEXT, source_line_id TEXT, field_values TEXT, line_role TEXT);
    CREATE TABLE scm_doc_type (account_set_id TEXT, code TEXT, category TEXT, direction TEXT, affects_stock INTEGER, affects_ar_ap INTEGER);
    CREATE TABLE scm_partner (id TEXT, account_set_id TEXT, code TEXT, name TEXT, ar_account TEXT, ap_account TEXT);
    CREATE TABLE scm_ar_ap_log (id TEXT, account_set_id TEXT, partner_code TEXT, doc_type TEXT, doc_no TEXT,
      doc_date TEXT, due_date TEXT, direction TEXT, amount REAL, ar_account TEXT, ap_account TEXT,
      cashier_journal_id TEXT, remark TEXT, verified_amount REAL NOT NULL DEFAULT 0);
    CREATE TABLE scm_ar_ap_verify (id TEXT, account_set_id TEXT, verify_no TEXT, in_log_id TEXT, out_log_id TEXT, amount REAL);
    CREATE TABLE scm_stock (id TEXT, account_set_id TEXT, warehouse_code TEXT, item_code TEXT,
      qty REAL DEFAULT 0, amount REAL DEFAULT 0, avg_cost REAL DEFAULT 0, updated_at TEXT);
    CREATE TABLE scm_stock_move (id TEXT, account_set_id TEXT, move_date TEXT, doc_type TEXT, doc_no TEXT,
      line_seq INTEGER, warehouse_code TEXT, item_code TEXT, direction TEXT, qty REAL, unit_cost REAL,
      amount REAL, batch_no TEXT, balance_qty REAL, balance_amount REAL, balance_avg_cost REAL);
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
    CREATE TABLE vouchers (id TEXT, account_set_id TEXT, voucher_no TEXT, voucher_date TEXT,
      year INTEGER, period INTEGER, total_amount REAL, maker_name TEXT, remark TEXT, source TEXT, voucher_type_id TEXT);
    CREATE TABLE voucher_entries (id TEXT, account_set_id TEXT, voucher_id TEXT, seq INTEGER,
      account_id TEXT, account_code TEXT, account_name TEXT, direction TEXT, amount REAL,
      amount_cents INTEGER, summary TEXT);
  `)
  return db
}

const ACCOUNTS: Array<[string, string]> = [
  ['1405', '库存商品'], ['2202', '应付账款'], ['1122', '应收账款'],
  ['6001', '主营业务收入'], ['6401', '主营业务成本'],
  ['22210101', '应交税费—进项税额'], ['22210105', '应交税费—销项税额'],
]

function seedBase() {
  const types: Array<[string, string, string, number, number]> = [
    ['RP', 'purchase', 'none', 0, 1], ['RS', 'sale', 'none', 0, 1],
    ['PI', 'purchase', 'in', 1, 1], ['SO', 'sale', 'out', 1, 1],
  ]
  for (const [code, cat, dir, stock, arap] of types) {
    testDb.prepare('INSERT INTO scm_doc_type (account_set_id,code,category,direction,affects_stock,affects_ar_ap) VALUES (?,?,?,?,?,?)')
      .run(AID, code, cat, dir, stock, arap)
  }
  for (const [code, name] of ACCOUNTS) {
    testDb.prepare('INSERT INTO accounts (id,account_set_id,code,name) VALUES (?,?,?,?)').run(uuidv4(), AID, code, name)
  }
  testDb.prepare('INSERT INTO scm_item (id,account_set_id,code,name,inv_account) VALUES (?,?,?,?,?)')
    .run(uuidv4(), AID, 'I1', '物料甲', '1405')
  testDb.prepare('INSERT INTO scm_partner (id,account_set_id,code,name,ar_account,ap_account) VALUES (?,?,?,?,?,?)')
    .run(uuidv4(), AID, 'P1', '往来甲', '1122', '2202')
  testDb.prepare('INSERT INTO scm_stock (id,account_set_id,warehouse_code,item_code,qty,amount,avg_cost) VALUES (?,?,?,?,?,?,?)')
    .run(uuidv4(), AID, 'W1', 'I1', 100, 10000, 100)
}

function seedDoc(docType: string, docNo: string,
  lines: Array<{ qty?: number; price?: number; amount?: number; tax_amount?: number }>,
  opts: { sourceDocId?: string } = {}) {
  const docId = uuidv4()
  testDb.prepare(`INSERT INTO scm_doc (id,account_set_id,doc_type,doc_no,status,doc_date,warehouse_code,partner_code,source_doc_id)
    VALUES (?,?,?,?,'draft','2026-09-04','W1','P1',?)`).run(docId, AID, docType, docNo, opts.sourceDocId ?? null)
  lines.forEach((l, i) => {
    testDb.prepare(`INSERT INTO scm_doc_line (id,account_set_id,doc_id,seq,item_code,warehouse_code,qty,price,amount,tax_amount,unit_cost)
      VALUES (?,?,?,?,'I1','W1',?,?,?,?,0)`)
      .run(uuidv4(), AID, docId, i + 1, l.qty ?? 0, l.price ?? 0, l.amount ?? 0, l.tax_amount ?? 0)
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

const logOf = (docNo: string) => testDb.prepare('SELECT * FROM scm_ar_ap_log WHERE doc_no=?').get(docNo) as any
const logCount = () => (testDb.prepare('SELECT COUNT(*) c FROM scm_ar_ap_log').get() as any).c
const entriesOf = (voucherId: string) =>
  testDb.prepare('SELECT account_code, direction, amount FROM voucher_entries WHERE voucher_id=? ORDER BY seq').all(voucherId) as any[]
const totalsOf = (voucherId: string) => {
  const es = entriesOf(voucherId)
  const r2 = (n: number) => Math.round(n * 100) / 100
  return {
    debit: r2(es.filter(e => e.direction === 'debit').reduce((s, e) => s + e.amount, 0)),
    credit: r2(es.filter(e => e.direction === 'credit').reduce((s, e) => s + e.amount, 0)),
  }
}
const latestVoucherId = () => (testDb.prepare('SELECT id FROM vouchers ORDER BY rowid DESC LIMIT 1').get() as any).id

describe('S1 发票单据挂账', () => {
  beforeEach(() => { testDb = createDb(); seedBase() })

  it('独立采购发票审核后新挂应付台账（价税合计）', () => {
    const id = seedDoc('RP', 'RP-001', [{ qty: 10, price: 100, amount: 1000, tax_amount: 130 }])
    const res = callHandler(auditDocHandler, id)
    expect(res.body.code).toBe(0)
    expect(logOf('RP-001')).toMatchObject({ direction: 'in', amount: 1130, ap_account: '2202' })
  })

  it('由采购入库下推的发票只校正来源单据挂账额，不新增台账', () => {
    const piId = seedDoc('PI', 'PI-001', [{ qty: 10, price: 100, amount: 1000, tax_amount: 130 }])
    expect(callHandler(auditDocHandler, piId).body.code).toBe(0)
    expect(logOf('PI-001').amount).toBe(1130)
    expect(logCount()).toBe(1)

    const rpId = seedDoc('RP', 'RP-002', [{ qty: 12, price: 100, amount: 1200, tax_amount: 156 }], { sourceDocId: piId })
    const res = callHandler(auditDocHandler, rpId)
    expect(res.body.code).toBe(0)
    expect(res.body.data.invoice_notice).toMatch(/1356/)
    expect(res.body.data.invoice_notice).toMatch(/PI-001/)
    expect(logCount()).toBe(1)
    expect(logOf('PI-001').amount).toBe(1356)
  })
})

describe('S1 发票行金额直录', () => {
  beforeEach(() => { testDb = createDb(); seedBase() })

  it('只填金额不填数量的发票行也能进凭证（原实现金额丢成 0）', () => {
    const id = seedDoc('RP', 'RP-010', [{ qty: 0, price: 0, amount: 500, tax_amount: 65 }])
    expect(callHandler(auditDocHandler, id).body.code).toBe(0)
    const res = callHandler(genVoucherHandler, id)
    expect(res.body.code).toBe(0)
    const vid = latestVoucherId()
    expect(totalsOf(vid)).toEqual({ debit: 565, credit: 565 })
    expect(entriesOf(vid)).toEqual(expect.arrayContaining([
      { account_code: '1405', direction: 'debit', amount: 500 },
      { account_code: '22210101', direction: 'debit', amount: 65 },
      { account_code: '2202', direction: 'credit', amount: 565 },
    ]))
  })
})

describe('S1 发票制证', () => {
  beforeEach(() => { testDb = createDb(); seedBase() })

  it('独立销售发票：借应收 / 贷收入 + 销项，不结转成本', () => {
    const id = seedDoc('RS', 'RS-001', [{ qty: 5, price: 200, amount: 1000, tax_amount: 130 }])
    callHandler(auditDocHandler, id)
    expect(callHandler(genVoucherHandler, id).body.code).toBe(0)
    const vid = latestVoucherId()
    expect(totalsOf(vid)).toEqual({ debit: 1130, credit: 1130 })
    expect(entriesOf(vid)).toEqual(expect.arrayContaining([
      { account_code: '1122', direction: 'debit', amount: 1130 },
      { account_code: '6001', direction: 'credit', amount: 1000 },
      { account_code: '22210105', direction: 'credit', amount: 130 },
    ]))
    // 无库存移动，不应出现成本科目
    expect(entriesOf(vid).some(e => e.account_code === '6401')).toBe(false)
  })

  it('有来源单据的发票拒绝制证，提示去来源单据上生成', () => {
    const piId = seedDoc('PI', 'PI-010', [{ qty: 10, price: 100, amount: 1000, tax_amount: 130 }])
    callHandler(auditDocHandler, piId)
    const rpId = seedDoc('RP', 'RP-011', [{ qty: 10, price: 100, amount: 1000, tax_amount: 130 }], { sourceDocId: piId })
    callHandler(auditDocHandler, rpId)

    const res = callHandler(genVoucherHandler, rpId)
    expect(res.statusCode).toBe(400)
    expect(res.body.message).toMatch(/PI-010/)
    expect(res.body.message).toMatch(/来源单据/)
  })

  it('来源单据已制证、发票金额一致时提示无差额无需制证', () => {
    const piId = seedDoc('PI', 'PI-011', [{ qty: 10, price: 100, amount: 1000, tax_amount: 130 }])
    callHandler(auditDocHandler, piId)
    expect(callHandler(genVoucherHandler, piId).body.code).toBe(0)

    const rpId = seedDoc('RP', 'RP-012', [{ qty: 10, price: 100, amount: 1000, tax_amount: 130 }], { sourceDocId: piId })
    callHandler(auditDocHandler, rpId)
    const res = callHandler(genVoucherHandler, rpId)
    expect(res.statusCode).toBe(400)
    expect(res.body.message).toMatch(/无差额/)
  })

  it('FIX-216 发票金额与来源单不一致：按差额补调整凭证，总账与往来同步', () => {
    // 来源 PI 1130 → 发票 904（少 200 + 税 26）：往来台账被校正为 904，总账需补 借应付 226 / 贷存货 200 / 贷进项 26
    const piId = seedDoc('PI', 'PI-020', [{ qty: 10, price: 100, amount: 1000, tax_amount: 130 }])
    callHandler(auditDocHandler, piId)
    expect(callHandler(genVoucherHandler, piId).body.code).toBe(0)
    const piLine = testDb.prepare('SELECT id FROM scm_doc_line WHERE doc_id=?').get(piId) as any
    const rpId = seedDoc('RP', 'RP-021', [{ qty: 10, price: 80, amount: 800, tax_amount: 104 }], { sourceDocId: piId })
    testDb.prepare('UPDATE scm_doc_line SET source_line_id=? WHERE doc_id=?').run(piLine.id, rpId)
    callHandler(auditDocHandler, rpId)
    expect(logOf('PI-020').amount).toBe(904)

    const res = callHandler(genVoucherHandler, rpId)
    expect(res.body.code).toBe(0)
    const es = entriesOf(res.body.data.voucher_id)
    expect(es).toEqual(expect.arrayContaining([
      expect.objectContaining({ account_code: '2202', direction: 'debit', amount: 226 }),
      expect.objectContaining({ account_code: '1405', direction: 'credit', amount: 200 }),
      expect.objectContaining({ account_code: '22210101', direction: 'credit', amount: 26 }),
    ]))
    expect(totalsOf(res.body.data.voucher_id)).toEqual({ debit: 226, credit: 226 })
    expect(callHandler(genVoucherHandler, rpId).statusCode).toBe(400)   // 已生成凭证不可重复
  })

  it('FIX-216 销售发票多开：差额 借应收 / 贷收入 + 销项', () => {
    const soId = seedDoc('SO', 'SO-020', [{ qty: 10, price: 100, amount: 1000, tax_amount: 130 }])
    callHandler(auditDocHandler, soId)
    expect(callHandler(genVoucherHandler, soId).body.code).toBe(0)
    const soLine = testDb.prepare('SELECT id FROM scm_doc_line WHERE doc_id=?').get(soId) as any
    const rsId = seedDoc('RS', 'RS-021', [{ qty: 10, price: 120, amount: 1200, tax_amount: 156 }], { sourceDocId: soId })
    testDb.prepare('UPDATE scm_doc_line SET source_line_id=? WHERE doc_id=?').run(soLine.id, rsId)
    callHandler(auditDocHandler, rsId)
    const res = callHandler(genVoucherHandler, rsId)
    expect(res.body.code).toBe(0)
    expect(entriesOf(res.body.data.voucher_id)).toEqual(expect.arrayContaining([
      expect.objectContaining({ account_code: '1122', direction: 'debit', amount: 226 }),
      expect.objectContaining({ account_code: '6001', direction: 'credit', amount: 200 }),
      expect.objectContaining({ account_code: '22210105', direction: 'credit', amount: 26 }),
    ]))
  })
})

describe('S2 往来与凭证口径一致', () => {
  beforeEach(() => { testDb = createDb(); seedBase() })

  it('销售出库：往来挂账额 == 凭证借方应收额', () => {
    const id = seedDoc('SO', 'SO-001', [{ qty: 5, price: 200, amount: 1000, tax_amount: 130 }])
    callHandler(auditDocHandler, id)
    expect(callHandler(genVoucherHandler, id).body.code).toBe(0)
    const arEntry = entriesOf(latestVoucherId()).find(e => e.account_code === '1122' && e.direction === 'debit')!
    expect(logOf('SO-001').amount).toBe(arEntry.amount)
    expect(arEntry.amount).toBe(1130)
  })

  it('采购入库：往来挂账额 == 凭证贷方应付额', () => {
    const id = seedDoc('PI', 'PI-020', [{ qty: 10, price: 100, amount: 1000, tax_amount: 130 }])
    callHandler(auditDocHandler, id)
    expect(callHandler(genVoucherHandler, id).body.code).toBe(0)
    const apEntry = entriesOf(latestVoucherId()).find(e => e.account_code === '2202' && e.direction === 'credit')!
    expect(logOf('PI-020').amount).toBe(apEntry.amount)
    expect(apEntry.amount).toBe(1130)
  })
})
