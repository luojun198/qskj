/**
 * PAY/RCV 收付款单生成凭证 + 反审核凭证保护 单元测试
 *
 * 直接调用 routes/scmDoc.ts 导出的 genVoucherHandler / unauditDocHandler，
 * getDb 通过 vi.mock 指向内存库，schema 只建该链路用到的表。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import Database from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'

let testDb: Database.Database

vi.mock('../db/index.js', () => ({
  getDb: () => testDb,
}))

import { genVoucherHandler, unauditDocHandler } from '../routes/scmDoc.js'

const AID = 'AS-PAY'

function createDb() {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE scm_doc (id TEXT, account_set_id TEXT, doc_type TEXT, doc_no TEXT, status TEXT,
      doc_date TEXT, partner_code TEXT, settle_account TEXT, remark TEXT, voucher_id TEXT, total_amount REAL);
    CREATE TABLE scm_doc_line (id TEXT, account_set_id TEXT, doc_id TEXT, item_code TEXT,
      qty REAL, price REAL, amount REAL, tax_amount REAL, unit_cost REAL, remark TEXT, arap_source_log_id TEXT);
    CREATE TABLE scm_doc_type (account_set_id TEXT, code TEXT, category TEXT, direction TEXT);
    CREATE TABLE scm_partner (id TEXT, account_set_id TEXT, code TEXT, name TEXT,
      partner_type TEXT, ar_account TEXT, ap_account TEXT);
    CREATE TABLE accounts (id TEXT, account_set_id TEXT, code TEXT, name TEXT, parent_id TEXT,
      is_enabled INTEGER DEFAULT 1, is_cash INTEGER DEFAULT 0, is_bank INTEGER DEFAULT 0);
    CREATE TABLE system_params (id TEXT, account_set_id TEXT, param_key TEXT, param_value TEXT);
    CREATE TABLE scm_ar_ap_log (id TEXT, account_set_id TEXT, partner_code TEXT, doc_type TEXT, doc_no TEXT,
      direction TEXT, amount REAL, verified_amount REAL DEFAULT 0);
    CREATE TABLE vouchers (id TEXT, account_set_id TEXT, voucher_no TEXT, voucher_type_id TEXT,
      voucher_date TEXT, year INTEGER, period INTEGER, total_amount REAL, maker_name TEXT, remark TEXT, source TEXT);
    CREATE TABLE voucher_entries (id TEXT, account_set_id TEXT, voucher_id TEXT, seq INTEGER,
      account_id TEXT, account_code TEXT, account_name TEXT, direction TEXT, amount REAL, amount_cents INTEGER, summary TEXT);
  `)
  return db
}

function seedAccounts(db: Database.Database, codes: Array<[string, string, Partial<{ cash: boolean; bank: boolean }>]> = []) {
  const ins = db.prepare('INSERT INTO accounts (id,account_set_id,code,name,is_cash,is_bank) VALUES (?,?,?,?,?,?)')
  for (const [code, name, flag] of [['100201', '银行存款-工行', { bank: true }] as [string, string, any],
    ['1122', '应收账款', {}], ['2202', '应付账款', {}], ...codes]) {
    ins.run(`acc-${code}`, AID, code, name, flag.cash ? 1 : 0, flag.bank ? 1 : 0)
  }
}

function seedDoc(opts: {
  docType: 'PAY' | 'RCV'
  docNo: string
  status?: string
  partner?: string | null
  settle?: string | null
  amounts: number[]
  voucherId?: string | null
}) {
  const docId = uuidv4()
  testDb.prepare(`INSERT INTO scm_doc (id,account_set_id,doc_type,doc_no,status,doc_date,partner_code,settle_account,voucher_id)
    VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(docId, AID, opts.docType, opts.docNo, opts.status || 'audited', '2026-09-01',
      opts.partner === undefined ? 'P1' : opts.partner,
      opts.settle === undefined ? '100201' : opts.settle,
      opts.voucherId ?? null)
  for (const amt of opts.amounts) {
    testDb.prepare('INSERT INTO scm_doc_line (id,account_set_id,doc_id,qty,price,amount) VALUES (?,?,?,?,?,?)')
      .run(uuidv4(), AID, docId, 1, amt, amt)
  }
  return docId
}

function callHandler(handler: any, id: string) {
  const req: any = { params: { id }, accountSetId: AID, userName: '测试员' }
  const res: any = { statusCode: 200, body: null as any }
  res.status = (c: number) => { res.statusCode = c; return res }
  res.json = (b: any) => { res.body = b; return res }
  handler(req, res)
  return res
}

const voucherEntries = (voucherId: string) =>
  testDb.prepare('SELECT account_code, direction, amount FROM voucher_entries WHERE voucher_id=? ORDER BY seq')
    .all(voucherId) as any[]

describe('PAY/RCV 收付款单生成凭证', () => {
  beforeEach(() => {
    testDb = createDb()
    seedAccounts(testDb)
    testDb.prepare('INSERT INTO scm_doc_type (account_set_id,code,category,direction) VALUES (?,?,?,?)')
      .run(AID, 'RCV', 'finance', 'none')
    testDb.prepare('INSERT INTO scm_doc_type (account_set_id,code,category,direction) VALUES (?,?,?,?)')
      .run(AID, 'PAY', 'finance', 'none')
    testDb.prepare('INSERT INTO scm_partner (id,account_set_id,code,name,partner_type) VALUES (?,?,?,?,?)')
      .run(uuidv4(), AID, 'P1', '往来单位甲', 'both')
  })

  it('RCV 收款单：借银行存款 / 贷应收账款，回写 voucher_id', () => {
    const docId = seedDoc({ docType: 'RCV', docNo: 'SK-001', amounts: [500] })
    const res = callHandler(genVoucherHandler, docId)

    expect(res.statusCode).toBe(200)
    expect(res.body.code).toBe(0)
    const voucherId = res.body.data.voucher_id
    expect(voucherEntries(voucherId)).toEqual([
      { account_code: '100201', direction: 'debit', amount: 500 },
      { account_code: '1122', direction: 'credit', amount: 500 },
    ])
    const doc = testDb.prepare('SELECT voucher_id FROM scm_doc WHERE id=?').get(docId) as any
    expect(doc.voucher_id).toBe(voucherId)
    const v = testDb.prepare('SELECT voucher_no, year, period, total_amount, source FROM vouchers WHERE id=?').get(voucherId) as any
    expect(v).toMatchObject({ year: 2026, period: 9, total_amount: 500, source: 'scm_rcv' })
  })

  it('PAY 付款单：借应付账款 / 贷银行存款', () => {
    const docId = seedDoc({ docType: 'PAY', docNo: 'FK-001', amounts: [800] })
    const res = callHandler(genVoucherHandler, docId)

    expect(res.body.code).toBe(0)
    expect(voucherEntries(res.body.data.voucher_id)).toEqual([
      { account_code: '2202', direction: 'debit', amount: 800 },
      { account_code: '100201', direction: 'credit', amount: 800 },
    ])
  })

  it('多行收款合并到同一对科目，金额汇总', () => {
    const docId = seedDoc({ docType: 'RCV', docNo: 'SK-002', amounts: [300, 200] })
    const res = callHandler(genVoucherHandler, docId)

    expect(res.body.code).toBe(0)
    expect(voucherEntries(res.body.data.voucher_id)).toEqual([
      { account_code: '100201', direction: 'debit', amount: 500 },
      { account_code: '1122', direction: 'credit', amount: 500 },
    ])
  })

  it('往来单位自定义应收科目优先于系统参数', () => {
    testDb.prepare("UPDATE scm_partner SET ar_account='1131' WHERE account_set_id=? AND code='P1'").run(AID)
    seedAccounts(testDb, [['1131', '应收账款-甲', {}]])
    const docId = seedDoc({ docType: 'RCV', docNo: 'SK-003', amounts: [100] })
    const res = callHandler(genVoucherHandler, docId)

    expect(res.body.code).toBe(0)
    expect(voucherEntries(res.body.data.voucher_id)).toEqual([
      { account_code: '100201', direction: 'debit', amount: 100 },
      { account_code: '1131', direction: 'credit', amount: 100 },
    ])
  })

  it('系统参数 scm:acc_ar 可覆盖默认应收科目', () => {
    testDb.prepare('INSERT INTO system_params (id,account_set_id,param_key,param_value) VALUES (?,?,?,?)')
      .run(uuidv4(), AID, 'scm:acc_ar', '112201')
    seedAccounts(testDb, [['112201', '应收账款-明细', {}]])
    const docId = seedDoc({ docType: 'RCV', docNo: 'SK-004', amounts: [60] })
    const res = callHandler(genVoucherHandler, docId)

    expect(res.body.code).toBe(0)
    expect(voucherEntries(res.body.data.voucher_id)).toContainEqual(
      { account_code: '112201', direction: 'credit', amount: 60 },
    )
  })

  it('未审核单据拒绝生成凭证', () => {
    const docId = seedDoc({ docType: 'RCV', docNo: 'SK-005', amounts: [100], status: 'draft' })
    const res = callHandler(genVoucherHandler, docId)
    expect(res.statusCode).toBe(400)
    expect(res.body.message).toContain('未审核')
  })

  it('已生成凭证的单据拒绝重复生成', () => {
    const docId = seedDoc({ docType: 'RCV', docNo: 'SK-006', amounts: [100], voucherId: 'v-exists' })
    const res = callHandler(genVoucherHandler, docId)
    expect(res.statusCode).toBe(400)
    expect(res.body.message).toContain('已生成凭证')
  })

  it('应收科目在科目表中不存在时给出明确提示', () => {
    testDb.prepare("DELETE FROM accounts WHERE account_set_id=? AND code='1122'").run(AID)
    const docId = seedDoc({ docType: 'RCV', docNo: 'SK-007', amounts: [100] })
    const res = callHandler(genVoucherHandler, docId)
    expect(res.statusCode).toBe(400)
    expect(res.body.message).toContain('1122')
    expect(testDb.prepare('SELECT COUNT(*) c FROM vouchers WHERE account_set_id=?').get(AID)).toMatchObject({ c: 0 })
  })

  it('收付款单缺结算账户时被校验拦截', () => {
    const docId = seedDoc({ docType: 'RCV', docNo: 'SK-008', amounts: [100], settle: null })
    const res = callHandler(genVoucherHandler, docId)
    expect(res.statusCode).toBe(400)
    expect(res.body.message).toContain('现金或银行账户')
  })
})

describe('已生成凭证单据的反审核保护', () => {
  beforeEach(() => {
    testDb = createDb()
    seedAccounts(testDb)
    testDb.prepare('INSERT INTO scm_doc_type (account_set_id,code,category,direction) VALUES (?,?,?,?)')
      .run(AID, 'RCV', 'finance', 'none')
  })

  it('已生成凭证的单据禁止反审核，提示先删凭证', () => {
    const docId = seedDoc({ docType: 'RCV', docNo: 'SK-101', amounts: [100], voucherId: 'v-1' })
    const res = callHandler(unauditDocHandler, docId)
    expect(res.statusCode).toBe(400)
    expect(res.body.message).toContain('已生成记账凭证')
    // 状态未被改动
    expect(testDb.prepare('SELECT status FROM scm_doc WHERE id=?').get(docId)).toMatchObject({ status: 'audited' })
  })
})
