/**
 * 业务凭证中心：进销存单据列表 / 计数 / 逐张生成（互不影响）
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import Database from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'

let testDb: Database.Database

vi.mock('../db/index.js', () => ({ getDb: () => testDb }))
vi.mock('../services/licenseService.js', () => ({ assertModuleLicensed: () => null }))

import { genScmVoucherForDoc } from '../routes/scmDoc.js'
import { up as createMapTable } from '../db/migrations/20261007_add_scm_gl_aux_map.js'
import { SCM_VOUCHER_DOC_TYPES, countScm, listScmVoucherDocs } from '../services/bizVoucherCenter.js'

const AID = 'AS-BVC'
const CAT_CUS = 'cat-customer'
const ALL = [...SCM_VOUCHER_DOC_TYPES] as string[]

function createDb() {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE scm_doc (id TEXT, account_set_id TEXT, doc_type TEXT, doc_no TEXT, status TEXT,
      doc_date TEXT, partner_code TEXT, dept_code TEXT, biz_person TEXT, settle_account TEXT, remark TEXT, voucher_id TEXT,
      total_amount REAL, total_tax REAL, currency TEXT, source_doc_id TEXT, external_voucher INTEGER DEFAULT 0);
    CREATE TABLE scm_doc_line (id TEXT, account_set_id TEXT, doc_id TEXT, item_code TEXT,
      qty REAL, price REAL, amount REAL, tax_amount REAL, unit_cost REAL, remark TEXT, arap_source_log_id TEXT);
    CREATE TABLE scm_doc_type (account_set_id TEXT, code TEXT, name TEXT, category TEXT, direction TEXT);
    CREATE TABLE scm_partner (id TEXT, account_set_id TEXT, code TEXT, name TEXT, enabled INTEGER DEFAULT 1,
      partner_type TEXT, ar_account TEXT, ap_account TEXT);
    CREATE TABLE scm_item (id TEXT, account_set_id TEXT, code TEXT, name TEXT, inv_account TEXT, item_type TEXT);
    CREATE TABLE accounts (id TEXT, account_set_id TEXT, code TEXT, name TEXT, parent_id TEXT,
      is_enabled INTEGER DEFAULT 1, is_cash INTEGER DEFAULT 0, is_bank INTEGER DEFAULT 0, is_aux INTEGER DEFAULT 0, aux_types TEXT);
    CREATE TABLE system_params (id TEXT, account_set_id TEXT, param_key TEXT, param_value TEXT);
    CREATE TABLE aux_categories (id TEXT PRIMARY KEY, account_set_id TEXT, code TEXT, name TEXT);
    CREATE TABLE aux_category_fields (id TEXT, category_id TEXT, field_key TEXT, field_name TEXT, show_in_voucher INTEGER DEFAULT 0,
      required_in_archive INTEGER DEFAULT 0, sort_order INTEGER DEFAULT 0, is_enabled INTEGER DEFAULT 1);
    CREATE TABLE aux_items (id TEXT PRIMARY KEY, account_set_id TEXT, type TEXT, code TEXT, name TEXT, status TEXT DEFAULT 'active');
    CREATE TABLE scm_ar_ap_log (currency TEXT, exchange_rate REAL NOT NULL DEFAULT 1, amount_fc REAL, verified_fc REAL NOT NULL DEFAULT 0, id TEXT, account_set_id TEXT, partner_code TEXT, doc_type TEXT, doc_no TEXT,
      direction TEXT, amount REAL, verified_amount REAL DEFAULT 0, arap_side TEXT);
    CREATE TABLE vouchers (id TEXT, account_set_id TEXT, voucher_no TEXT, voucher_type_id TEXT, status TEXT DEFAULT 'draft',
      voucher_date TEXT, year INTEGER, period INTEGER, total_amount REAL, maker_name TEXT, remark TEXT, source TEXT);
    CREATE TABLE voucher_entries (currency_code TEXT, exchange_rate REAL, foreign_amount REAL, dept_id TEXT, dept_name TEXT, project_id TEXT, project_name TEXT, supplier_id TEXT, supplier_name TEXT, person_id TEXT, person_name TEXT, func_class_id TEXT, func_class_name TEXT, aux_data TEXT, cash_flow_code TEXT, cash_flow_name TEXT, quantity REAL, unit_price REAL, unit TEXT, id TEXT, account_set_id TEXT, voucher_id TEXT, seq INTEGER,
      account_id TEXT, account_code TEXT, account_name TEXT, direction TEXT, amount REAL, amount_cents INTEGER, summary TEXT);
  `)
  createMapTable(db)
  return db
}

function addDoc(docType: string, docNo: string, opts: { status?: string; partner?: string; date?: string; voucherId?: string | null; amount?: number } = {}) {
  const id = uuidv4()
  testDb.prepare(`INSERT INTO scm_doc (id,account_set_id,doc_type,doc_no,status,doc_date,partner_code,settle_account,voucher_id)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(id, AID, docType, docNo, opts.status || 'audited', opts.date || '2026-10-07', opts.partner ?? 'P1', '100201', opts.voucherId ?? null)
  if (opts.amount) {
    testDb.prepare('INSERT INTO scm_doc_line (id,account_set_id,doc_id,qty,price,amount) VALUES (?,?,?,?,?,?)').run(uuidv4(), AID, id, 1, opts.amount, opts.amount)
  }
  return id
}

function callReq() {
  return { params: {}, accountSetId: AID, userName: '测试员', permissions: ['*'] } as any
}

beforeEach(() => {
  testDb = createDb()
  const acc = testDb.prepare('INSERT INTO accounts (id,account_set_id,code,name,is_bank,is_aux,aux_types) VALUES (?,?,?,?,?,?,?)')
  acc.run('a-100201', AID, '100201', '银行存款-工行', 1, 0, null)
  acc.run('a-1122', AID, '1122', '应收账款', 0, 1, JSON.stringify({ [CAT_CUS]: null }))
  acc.run('a-2202', AID, '2202', '应付账款', 0, 0, null)
  testDb.prepare('INSERT INTO aux_categories VALUES (?,?,?,?)').run(CAT_CUS, AID, 'customer', '往来单位')
  testDb.prepare("INSERT INTO aux_items (id,account_set_id,type,code,name) VALUES ('it-1',?,?, 'K1', '甲公司')").run(AID, CAT_CUS)
  for (const [code, name] of [['RCV', '收款单'], ['PAY', '付款单'], ['TR', '调拨单'], ['PO', '采购订单']]) {
    testDb.prepare('INSERT INTO scm_doc_type (account_set_id,code,name,category,direction) VALUES (?,?,?,?,?)')
      .run(AID, code, name, code === 'RCV' || code === 'PAY' ? 'finance' : 'inventory', 'none')
  }
  testDb.prepare('INSERT INTO scm_partner (id,account_set_id,code,name,partner_type) VALUES (?,?,?,?,?)').run(uuidv4(), AID, 'P1', '甲公司', 'customer')
  testDb.prepare('INSERT INTO scm_partner (id,account_set_id,code,name,partner_type) VALUES (?,?,?,?,?)').run(uuidv4(), AID, 'P2', '全新客户', 'customer')
})

describe('进销存单据列表与计数', () => {
  it('只列已审核、会生成凭证的类型；调拨 / 订单 / 草稿不列', () => {
    addDoc('RCV', 'RCV-1'); addDoc('TR', 'TR-1'); addDoc('PO', 'PO-1'); addDoc('RCV', 'RCV-2', { status: 'draft' })
    const r = listScmVoucherDocs(testDb, AID, { allowedTypes: ALL, status: 'all' })
    expect(r.list.map((d: any) => d.doc_no)).toEqual(['RCV-1'])
    expect((r.list[0] as any).doc_type_name).toBe('收款单')
    expect((r.list[0] as any).partner_name).toBe('甲公司')
  })

  it('待生成 / 已生成筛选，带凭证号与凭证状态', () => {
    testDb.prepare("INSERT INTO vouchers (id,account_set_id,voucher_no,status,year,period) VALUES ('v1',?, '008', 'audited', 2026, 10)").run(AID)
    addDoc('RCV', 'RCV-1'); addDoc('PAY', 'PAY-1', { voucherId: 'v1' })
    expect(listScmVoucherDocs(testDb, AID, { allowedTypes: ALL, status: 'pending' }).list.map((d: any) => d.doc_no)).toEqual(['RCV-1'])
    const gen = listScmVoucherDocs(testDb, AID, { allowedTypes: ALL, status: 'generated' }).list as any[]
    expect(gen).toHaveLength(1)
    expect(gen[0]).toMatchObject({ doc_no: 'PAY-1', voucher_no: '008', voucher_status: 'audited' })
    expect(countScm(testDb, AID, ALL, {})).toEqual({ pending: 1, generated: 1 })
  })

  it('原系统导入（已制证）的单据视同已生成，不进待生成', () => {
    addDoc('RCV', 'RCV-1')
    const imported = addDoc('RCV', 'RCV-ACD')
    testDb.prepare('UPDATE scm_doc SET external_voucher=1 WHERE id=?').run(imported)
    expect(listScmVoucherDocs(testDb, AID, { allowedTypes: ALL, status: 'pending' }).list.map((d: any) => d.doc_no)).toEqual(['RCV-1'])
    const gen = listScmVoucherDocs(testDb, AID, { allowedTypes: ALL, status: 'generated' }).list as any[]
    expect(gen.map(d => d.doc_no)).toEqual(['RCV-ACD'])
    expect(gen[0].external_voucher).toBe(1)
    expect(countScm(testDb, AID, ALL, {})).toEqual({ pending: 1, generated: 1 })
  })

  it('按业务域权限过滤、日期区间与关键字（单号 / 往来单位名 / 凭证号）', () => {
    addDoc('RCV', 'RCV-1', { date: '2026-09-30' }); addDoc('PAY', 'PAY-1', { partner: 'P2' })
    expect(listScmVoucherDocs(testDb, AID, { allowedTypes: ['PAY'], status: 'all' }).total).toBe(1)
    expect(listScmVoucherDocs(testDb, AID, { allowedTypes: ALL, status: 'all', startDate: '2026-10-01' }).list.map((d: any) => d.doc_no)).toEqual(['PAY-1'])
    expect(listScmVoucherDocs(testDb, AID, { allowedTypes: ALL, status: 'all', keyword: '全新' }).list.map((d: any) => d.doc_no)).toEqual(['PAY-1'])
    expect(listScmVoucherDocs(testDb, AID, { allowedTypes: [], status: 'all' }).total).toBe(0)
  })
})

describe('逐张生成凭证', () => {
  it('一张因辅助核算对不上失败，不影响另一张成功', () => {
    const okId = addDoc('RCV', 'RCV-OK', { partner: 'P1', amount: 100 })
    const badId = addDoc('RCV', 'RCV-BAD', { partner: 'P2', amount: 50 })
    const bad = genScmVoucherForDoc(callReq(), badId)
    const ok = genScmVoucherForDoc(callReq(), okId)
    expect(bad.status).toBe(400)
    expect(bad.body.reason).toBe('SCM_AUX_UNMATCHED')
    expect(ok.body.code).toBe(0)
    const docs = testDb.prepare('SELECT doc_no, voucher_id FROM scm_doc ORDER BY doc_no').all() as any[]
    expect(docs.find(d => d.doc_no === 'RCV-OK').voucher_id).toBeTruthy()
    expect(docs.find(d => d.doc_no === 'RCV-BAD').voucher_id).toBeNull()
    expect(countScm(testDb, AID, ALL, {})).toEqual({ pending: 1, generated: 1 })
  })
})
