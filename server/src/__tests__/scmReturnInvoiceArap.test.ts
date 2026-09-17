/**
 * 进销存评审 P0-1 / P0-2（FIX-203 / FIX-204）：
 *   - 下推发票**走路由**反审核后，来源单据的往来暂估额要回到原值（原来 reverseInvoice 是死代码）
 *   - 采购退货 PR / 销售退货 SR 审核要冲减往来台账，反审核对称删除
 *
 * 直接调用 routes/scmDoc.ts 导出的 auditDocHandler / unauditDocHandler，getDb 通过 vi.mock 指向内存库。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import Database from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'

let testDb: Database.Database
vi.mock('../db/index.js', () => ({ getDb: () => testDb }))

import { auditDocHandler, unauditDocHandler } from '../routes/scmDoc.js'
import { getPartnerLedger, getPartnerBalanceSummary, getArApAging, getPartnerOpenAr, verifyArAp } from '../services/scmArAp.js'

const AID = 'RET-TEST'

function createDb() {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE system_params (id TEXT, account_set_id TEXT, param_key TEXT, param_value TEXT);
    CREATE TABLE scm_item (id TEXT, account_set_id TEXT, code TEXT, name TEXT,
      batch_flag INTEGER DEFAULT 0, batch_out_mode TEXT, shelf_life_days INTEGER DEFAULT 0,
      serial_flag INTEGER DEFAULT 0, default_warehouse_code TEXT, inv_account TEXT,
      purchase_price REAL, ref_cost REAL);
    CREATE TABLE scm_doc (id TEXT, account_set_id TEXT, doc_type TEXT, doc_no TEXT, status TEXT,
      doc_date TEXT, warehouse_code TEXT, partner_code TEXT, plan_id TEXT, bom_id TEXT, remark TEXT,
      source_doc_id TEXT, voucher_id TEXT, total_amount REAL, auditor TEXT, audited_at TEXT, updated_at TEXT);
    CREATE TABLE scm_doc_line (id TEXT, account_set_id TEXT, doc_id TEXT, seq INTEGER, item_code TEXT,
      warehouse_code TEXT, qty REAL, price REAL, amount REAL, tax_amount REAL, unit_cost REAL,
      batch_no TEXT, serial_nos TEXT, source_line_id TEXT, field_values TEXT, line_role TEXT);
    CREATE TABLE scm_doc_type (account_set_id TEXT, code TEXT, category TEXT, direction TEXT, affects_stock INTEGER, affects_ar_ap INTEGER);
    CREATE TABLE scm_partner (id TEXT, account_set_id TEXT, code TEXT, name TEXT, partner_type TEXT, ar_account TEXT, ap_account TEXT, credit_limit REAL DEFAULT 0, credit_days INTEGER DEFAULT 0);
    CREATE TABLE scm_ar_ap_log (id TEXT, account_set_id TEXT, partner_code TEXT, doc_type TEXT, doc_no TEXT,
      doc_date TEXT, due_date TEXT, direction TEXT, amount REAL, ar_account TEXT, ap_account TEXT,
      cashier_journal_id TEXT, remark TEXT, verified_amount REAL NOT NULL DEFAULT 0, created_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE scm_ar_ap_verify (id TEXT, account_set_id TEXT, partner_code TEXT, verify_no TEXT, verify_date TEXT,
      in_log_id TEXT, out_log_id TEXT, amount REAL, created_by TEXT, created_at TEXT);
    CREATE TABLE scm_stock (id TEXT, account_set_id TEXT, warehouse_code TEXT, item_code TEXT,
      qty REAL DEFAULT 0, amount REAL DEFAULT 0, avg_cost REAL DEFAULT 0, updated_at TEXT);
    CREATE TABLE scm_stock_move (id TEXT, account_set_id TEXT, move_date TEXT, doc_type TEXT, doc_no TEXT,
      line_seq INTEGER, warehouse_code TEXT, item_code TEXT, direction TEXT, qty REAL, unit_cost REAL,
      amount REAL, batch_no TEXT, balance_qty REAL, balance_amount REAL, balance_avg_cost REAL);
    CREATE TABLE scm_production_plan (id TEXT, account_set_id TEXT, source_doc_id TEXT);
    CREATE TABLE scm_mrp_source (id TEXT, account_set_id TEXT, mrp_doc_id TEXT, source_kind TEXT, source_id TEXT);
    CREATE TABLE scm_batch_move (id TEXT, account_set_id TEXT, doc_id TEXT, warehouse_code TEXT,
      item_code TEXT, batch_no TEXT, direction TEXT, qty REAL);
    CREATE TABLE scm_stock_batch (id TEXT, account_set_id TEXT, warehouse_code TEXT, item_code TEXT,
      batch_no TEXT, qty REAL, amount REAL);
    CREATE TABLE scm_serial_move (id TEXT, account_set_id TEXT, doc_id TEXT, doc_type TEXT, doc_no TEXT,
      line_seq INTEGER, warehouse_code TEXT, item_code TEXT, serial_no TEXT, direction TEXT);
    CREATE TABLE scm_serial (id TEXT, account_set_id TEXT, item_code TEXT, serial_no TEXT, status TEXT,
      warehouse_code TEXT, in_doc_no TEXT, out_doc_no TEXT, updated_at TEXT);
  `)
  return db
}

function seedBase() {
  const types: Array<[string, string, string, number, number]> = [
    ['RP', 'purchase', 'none', 0, 1], ['RS', 'sale', 'none', 0, 1],
    ['PI', 'purchase', 'in', 1, 1], ['SO', 'sale', 'out', 1, 1],
    ['PR', 'purchase', 'out', 1, 1], ['SR', 'sale', 'in', 1, 1],
    ['RCV', 'finance', 'none', 0, 1],
  ]
  for (const [code, cat, dir, stock, arap] of types) {
    testDb.prepare('INSERT INTO scm_doc_type (account_set_id,code,category,direction,affects_stock,affects_ar_ap) VALUES (?,?,?,?,?,?)')
      .run(AID, code, cat, dir, stock, arap)
  }
  testDb.prepare('INSERT INTO scm_item (id,account_set_id,code,name,inv_account) VALUES (?,?,?,?,?)')
    .run(uuidv4(), AID, 'I1', '物料甲', '1405')
  testDb.prepare('INSERT INTO scm_partner (id,account_set_id,code,name,partner_type,ar_account,ap_account) VALUES (?,?,?,?,?,?,?)')
    .run(uuidv4(), AID, 'P1', '往来甲', 'both', '1122', '2202')
  testDb.prepare('INSERT INTO scm_stock (id,account_set_id,warehouse_code,item_code,qty,amount,avg_cost) VALUES (?,?,?,?,?,?,?)')
    .run(uuidv4(), AID, 'W1', 'I1', 100, 6000, 60)
}

function seedDoc(docType: string, docNo: string,
  lines: Array<{ qty?: number; price?: number; amount?: number; tax_amount?: number }>,
  opts: { sourceDocId?: string; date?: string } = {}) {
  const docId = uuidv4()
  testDb.prepare(`INSERT INTO scm_doc (id,account_set_id,doc_type,doc_no,status,doc_date,warehouse_code,partner_code,source_doc_id)
    VALUES (?,?,?,?,'draft',?,'W1','P1',?)`).run(docId, AID, docType, docNo, opts.date || '2026-09-04', opts.sourceDocId ?? null)
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
const closing = () => getPartnerLedger(testDb, AID, 'P1').closing

describe('FIX-203 下推发票走路由反审核', () => {
  beforeEach(() => { testDb = createDb(); seedBase() })

  it('采购入库 1130 → 下推发票 1356 → 反审核发票 → 来源台账回到 1130', () => {
    const piId = seedDoc('PI', 'PI-001', [{ qty: 10, price: 100, amount: 1000, tax_amount: 130 }])
    expect(callHandler(auditDocHandler, piId).body.code).toBe(0)
    const rpId = seedDoc('RP', 'RP-001', [{ qty: 12, price: 100, amount: 1200, tax_amount: 156 }], { sourceDocId: piId })
    expect(callHandler(auditDocHandler, rpId).body.code).toBe(0)
    expect(logOf('PI-001').amount).toBe(1356)
    expect(logCount()).toBe(1)

    const res = callHandler(unauditDocHandler, rpId)
    expect(res.body.code).toBe(0)
    expect(logCount()).toBe(1)                       // 来源单的台账没有被误删
    expect(logOf('PI-001').amount).toBe(1130)        // 暂估额还原
    expect(logOf('PI-001').remark ?? null).toBeNull() // 备注里的发票号也清掉
    expect((testDb.prepare('SELECT status FROM scm_doc WHERE id=?').get(rpId) as any).status).toBe('draft')
  })

  it('销售发货 → 下推销售发票 → 反审核发票 → 应收还原', () => {
    const soId = seedDoc('SO', 'SO-001', [{ qty: 10, price: 1000, amount: 10000, tax_amount: 1300 }])
    expect(callHandler(auditDocHandler, soId).body.code).toBe(0)
    const rsId = seedDoc('RS', 'RS-001', [{ qty: 10, price: 900, amount: 9000, tax_amount: 1170 }], { sourceDocId: soId })
    expect(callHandler(auditDocHandler, rsId).body.code).toBe(0)
    expect(closing()).toBe(10170)
    expect(callHandler(unauditDocHandler, rsId).body.code).toBe(0)
    expect(closing()).toBe(11300)
  })

  it('独立发票反审核仍删除自己的台账', () => {
    const rpId = seedDoc('RP', 'RP-009', [{ qty: 1, price: 100, amount: 100, tax_amount: 13 }])
    expect(callHandler(auditDocHandler, rpId).body.code).toBe(0)
    expect(logCount()).toBe(1)
    expect(callHandler(unauditDocHandler, rpId).body.code).toBe(0)
    expect(logCount()).toBe(0)
  })
})

describe('FIX-204 退货冲减往来', () => {
  beforeEach(() => { testDb = createDb(); seedBase() })

  it('销售退货 SR：审核写 direction=out 的应收冲减行，余额 = 发货 − 退货', () => {
    const soId = seedDoc('SO', 'SO-001', [{ qty: 10, price: 1000, amount: 10000, tax_amount: 1300 }])
    expect(callHandler(auditDocHandler, soId).body.code).toBe(0)
    const srId = seedDoc('SR', 'SR-001', [{ qty: 2, price: 1000, amount: 2000, tax_amount: 260 }])
    expect(callHandler(auditDocHandler, srId).body.code).toBe(0)

    expect(logOf('SR-001')).toMatchObject({ direction: 'out', amount: 2260, ar_account: '1122', ap_account: null })
    expect(closing()).toBe(9040)
    // 对账单：退货行归入「调整」列，不是收款
    const rows = getPartnerLedger(testDb, AID, 'P1').detail
    const sr = rows.find((r: any) => r.doc_no === 'SR-001')
    expect(sr).toMatchObject({ adjustment_amount: 2260, settlement_amount: 0, increase_amount: 0 })
    // 余额表 / 账龄 / 信用占用 同步
    expect(getPartnerBalanceSummary(testDb, AID).summary[0].ar_closing).toBe(9040)
    expect(getArApAging(testDb, AID, '2026-09-30')[0].balance).toBe(9040)
    expect(getPartnerOpenAr(testDb, AID, 'P1')).toBe(9040)
  })

  it('采购退货 PR：审核写 direction=out 的应付冲减行，反审核删除', () => {
    const piId = seedDoc('PI', 'PI-001', [{ qty: 10, price: 100, amount: 1000, tax_amount: 130 }])
    expect(callHandler(auditDocHandler, piId).body.code).toBe(0)
    const prId = seedDoc('PR', 'PR-001', [{ qty: 3, price: 100, amount: 300, tax_amount: 39 }])
    expect(callHandler(auditDocHandler, prId).body.code).toBe(0)
    expect(logOf('PR-001')).toMatchObject({ direction: 'out', amount: 339, ap_account: '2202', ar_account: null })
    expect(getPartnerBalanceSummary(testDb, AID).summary[0].ap_closing).toBe(791)

    expect(callHandler(unauditDocHandler, prId).body.code).toBe(0)
    expect(logOf('PR-001')).toBeUndefined()
    expect(getPartnerBalanceSummary(testDb, AID).summary[0].ap_closing).toBe(1130)
  })

  it('退货行可与来源发货单核销；已核销的退货单禁止反审核', () => {
    const soId = seedDoc('SO', 'SO-001', [{ qty: 10, price: 1000, amount: 10000, tax_amount: 1300 }])
    expect(callHandler(auditDocHandler, soId).body.code).toBe(0)
    const srId = seedDoc('SR', 'SR-001', [{ qty: 2, price: 1000, amount: 2000, tax_amount: 260 }])
    expect(callHandler(auditDocHandler, srId).body.code).toBe(0)
    verifyArAp(testDb, AID, { partner_code: 'P1', matches: [{ in_log_id: logOf('SO-001').id, out_log_id: logOf('SR-001').id, amount: 2260 }] })
    expect(logOf('SO-001').verified_amount).toBe(2260)
    expect(getPartnerOpenAr(testDb, AID, 'P1')).toBe(9040)
    const res = callHandler(unauditDocHandler, srId)
    expect(res.statusCode).toBe(400)
    expect(res.body.message).toMatch(/核销/)
  })

  it('无往来单位的退货不写台账', () => {
    const srId = seedDoc('SR', 'SR-002', [{ qty: 1, price: 100, amount: 100, tax_amount: 13 }])
    testDb.prepare('UPDATE scm_doc SET partner_code=NULL WHERE id=?').run(srId)
    expect(callHandler(auditDocHandler, srId).body.code).toBe(0)
    expect(logCount()).toBe(0)
  })
})
