/**
 * 业务凭证中心合并制证：所选汇总一张 / 按日期汇总 / 按客商汇总（均按期间拆分），
 * 以及合并凭证删除后全部单据恢复待生成。用收款单（借银行 / 贷应收）造数据便于核对分录。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import Database from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'

let testDb: Database.Database

vi.mock('../db/index.js', () => ({
  getDb: () => testDb,
}))

process.env.LICENSE_SKIP = 'true'

import { genScmVouchersMerged, genVoucherHandler } from '../routes/scmDoc.js'
import { deleteVoucherWithRefs } from '../services/voucherDelete.js'

const AID = 'AS-MERGE'

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
    CREATE TABLE scm_ar_ap_log (currency TEXT, exchange_rate REAL NOT NULL DEFAULT 1, amount_fc REAL, verified_fc REAL NOT NULL DEFAULT 0, id TEXT, account_set_id TEXT, partner_code TEXT, doc_type TEXT, doc_no TEXT,
      direction TEXT, amount REAL, verified_amount REAL DEFAULT 0, arap_side TEXT);
    CREATE TABLE vouchers (id TEXT, account_set_id TEXT, voucher_no TEXT, voucher_type_id TEXT,
      voucher_date TEXT, year INTEGER, period INTEGER, total_amount REAL, maker_name TEXT, remark TEXT, source TEXT,
      status TEXT DEFAULT 'draft', reversed_by_voucher_id TEXT, reversal_of_voucher_id TEXT);
    CREATE TABLE voucher_entries (currency_code TEXT, exchange_rate REAL, foreign_amount REAL, dept_id TEXT, dept_name TEXT, project_id TEXT, project_name TEXT, supplier_id TEXT, supplier_name TEXT, person_id TEXT, person_name TEXT, func_class_id TEXT, func_class_name TEXT, aux_data TEXT, cash_flow_code TEXT, cash_flow_name TEXT, quantity REAL, unit_price REAL, unit TEXT, id TEXT, account_set_id TEXT, voucher_id TEXT, seq INTEGER,
      account_id TEXT, account_code TEXT, account_name TEXT, direction TEXT, amount REAL, amount_cents INTEGER, summary TEXT);
    CREATE TABLE voucher_attachments (id TEXT, voucher_id TEXT);
    CREATE TABLE auto_transfer_runs (id TEXT, voucher_id TEXT);
  `)
  const ins = db.prepare('INSERT INTO accounts (id,account_set_id,code,name,is_bank) VALUES (?,?,?,?,?)')
  ins.run('acc-100201', AID, '100201', '银行存款-工行', 1)
  ins.run('acc-1122', AID, '1122', '应收账款', 0)
  ins.run('acc-112201', AID, '112201', '应收账款-乙', 0)
  db.prepare("INSERT INTO scm_doc_type (account_set_id,code,category,direction) VALUES (?,'RCV','finance','none')").run(AID)
  db.prepare("INSERT INTO scm_partner (id,account_set_id,code,name,partner_type) VALUES ('p1',?,'P1','客户甲','customer')").run(AID)
  db.prepare("INSERT INTO scm_partner (id,account_set_id,code,name,partner_type,ar_account) VALUES ('p2',?,'P2','客户乙','customer','112201')").run(AID)
  return db
}

function seedRcv(docNo: string, date: string, partner: string, amount: number) {
  const id = uuidv4()
  testDb.prepare(`INSERT INTO scm_doc (id,account_set_id,doc_type,doc_no,status,doc_date,partner_code,settle_account)
    VALUES (?,?,'RCV',?,'audited',?,?,'100201')`).run(id, AID, docNo, date, partner)
  testDb.prepare('INSERT INTO scm_doc_line (id,account_set_id,doc_id,qty,price,amount) VALUES (?,?,?,?,?,?)')
    .run(uuidv4(), AID, id, 1, amount, amount)
  return id
}

const req: any = { accountSetId: AID, userName: '测试员' }
const entries = (voucherId: string) =>
  testDb.prepare('SELECT account_code, direction, amount FROM voucher_entries WHERE voucher_id=? ORDER BY seq').all(voucherId)
const voucherCount = () => (testDb.prepare('SELECT COUNT(*) c FROM vouchers').get() as any).c
const docVoucher = (id: string) => (testDb.prepare('SELECT voucher_id FROM scm_doc WHERE id=?').get(id) as any).voucher_id

beforeEach(() => {
  testDb = createDb()
})

describe('合并制证', () => {
  it('所选汇总一张：同科目同方向分录合并、所有单据回写同一凭证', () => {
    const a = seedRcv('SK-1', '2026-09-01', 'P1', 100)
    const b = seedRcv('SK-2', '2026-09-05', 'P1', 200)
    const c = seedRcv('SK-3', '2026-09-03', 'P2', 50)
    const r = genScmVouchersMerged(req, [a, b, c], 'all')
    expect(r.every(x => x.ok)).toBe(true)
    expect(voucherCount()).toBe(1)
    const vid = r[0].voucher_id!
    expect([a, b, c].map(docVoucher)).toEqual([vid, vid, vid])
    expect(entries(vid)).toEqual([
      { account_code: '100201', direction: 'debit', amount: 350 },
      { account_code: '1122', direction: 'credit', amount: 300 },
      { account_code: '112201', direction: 'credit', amount: 50 },
    ])
    const v = testDb.prepare('SELECT voucher_date, total_amount, remark, source FROM vouchers WHERE id=?').get(vid)
    expect(v).toEqual({ voucher_date: '2026-09-05', total_amount: 350, remark: '供应链单据SK-1等3张', source: 'scm_rcv' })
    expect(r[0].merged_count).toBe(3)
  })

  it('跨月单据按期间拆成多张', () => {
    const a = seedRcv('SK-1', '2026-08-31', 'P1', 100)
    const b = seedRcv('SK-2', '2026-09-01', 'P1', 200)
    genScmVouchersMerged(req, [a, b], 'all')
    expect(voucherCount()).toBe(2)
    expect(docVoucher(a)).not.toBe(docVoucher(b))
  })

  it('按日期汇总：同日一张', () => {
    const a = seedRcv('SK-1', '2026-09-01', 'P1', 100)
    const b = seedRcv('SK-2', '2026-09-01', 'P2', 200)
    const c = seedRcv('SK-3', '2026-09-02', 'P1', 50)
    genScmVouchersMerged(req, [a, b, c], 'date')
    expect(voucherCount()).toBe(2)
    expect(docVoucher(a)).toBe(docVoucher(b))
    expect(docVoucher(c)).not.toBe(docVoucher(a))
  })

  it('按客商汇总：同往来单位一张', () => {
    const a = seedRcv('SK-1', '2026-09-01', 'P1', 100)
    const b = seedRcv('SK-2', '2026-09-08', 'P1', 200)
    const c = seedRcv('SK-3', '2026-09-02', 'P2', 50)
    genScmVouchersMerged(req, [a, b, c], 'partner')
    expect(voucherCount()).toBe(2)
    expect(docVoucher(a)).toBe(docVoucher(b))
    expect(entries(docVoucher(a))).toEqual([
      { account_code: '100201', direction: 'debit', amount: 300 },
      { account_code: '1122', direction: 'credit', amount: 300 },
    ])
  })

  it('校验不通过的单据单独报错，不影响同组其它单据', () => {
    const a = seedRcv('SK-1', '2026-09-01', 'P1', 100)
    const bad = seedRcv('SK-2', '2026-09-01', 'P1', 200)
    testDb.prepare("UPDATE scm_doc SET settle_account=NULL WHERE id=?").run(bad)
    const r = genScmVouchersMerged(req, [a, bad], 'all')
    expect(r.find(x => x.id === a)).toMatchObject({ ok: true, merged_count: 1 })
    expect(r.find(x => x.id === bad)).toMatchObject({ ok: false })
    expect(voucherCount()).toBe(1)
  })

  it('删除合并凭证：全部单据恢复待生成，可重新逐张生成', () => {
    const a = seedRcv('SK-1', '2026-09-01', 'P1', 100)
    const b = seedRcv('SK-2', '2026-09-02', 'P1', 200)
    const vid = genScmVouchersMerged(req, [a, b], 'all')[0].voucher_id
    deleteVoucherWithRefs(testDb as any, AID, testDb.prepare('SELECT * FROM vouchers WHERE id=?').get(vid) as any)
    expect([docVoucher(a), docVoucher(b)]).toEqual([null, null])
    const res: any = { status(c: number) { this.statusCode = c; return this }, json(b: any) { this.body = b; return this } }
    genVoucherHandler({ ...req, params: { id: a } } as any, res)
    expect(res.body.code).toBe(0)
    expect(entries(res.body.data.voucher_id)).toEqual([
      { account_code: '100201', direction: 'debit', amount: 100 },
      { account_code: '1122', direction: 'credit', amount: 100 },
    ])
  })
})

describe('指定凭证类型', () => {
  beforeEach(() => {
    testDb.exec('CREATE TABLE voucher_types (id TEXT PRIMARY KEY, account_set_id TEXT, name TEXT, code TEXT, sort_order INTEGER DEFAULT 0)')
    testDb.prepare("INSERT INTO voucher_types VALUES ('vt-ji',?,'记','1',1), ('vt-shou',?,'收','2',2)").run(AID, AID)
  })
  const run = (id: string, body: any) => {
    const res: any = { status(c: number) { this.statusCode = c; return this }, json(b: any) { this.body = b; return this } }
    genVoucherHandler({ ...req, params: { id }, body } as any, res)
    return res
  }
  const typeOf = (vid: string) => (testDb.prepare('SELECT voucher_type_id FROM vouchers WHERE id=?').get(vid) as any).voucher_type_id

  it('本次指定 > 进销存默认参数', () => {
    testDb.prepare("INSERT INTO system_params VALUES ('p',?,'scm:default_voucher_type_id','vt-ji')").run(AID)
    const a = run(seedRcv('SK-1', '2026-09-01', 'P1', 100), { voucher_type_id: 'vt-shou' })
    expect(typeOf(a.body.data.voucher_id)).toBe('vt-shou')
    const b = run(seedRcv('SK-2', '2026-09-01', 'P1', 100), {})
    expect(typeOf(b.body.data.voucher_id)).toBe('vt-ji')
  })

  it('合并制证同样使用指定类型；非法类型 400 且不生成', () => {
    const r = genScmVouchersMerged(req, [seedRcv('SK-1', '2026-09-01', 'P1', 100)], 'all', 'vt-shou')
    expect(typeOf(r[0].voucher_id!)).toBe('vt-shou')
    const bad = run(seedRcv('SK-2', '2026-09-01', 'P1', 100), { voucher_type_id: 'nope' })
    expect(bad.statusCode).toBe(400)
    expect(voucherCount()).toBe(1)
  })
})
