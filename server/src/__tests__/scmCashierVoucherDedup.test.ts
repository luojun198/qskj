/**
 * 收付款制证方式（payment_voucher_mode）：收付款单与出纳严格单侧制证，杜绝同一笔资金两张凭证。
 *
 * 收款单审核会同时写往来台账（scm_ar_ap_log.cashier_journal_id）和出纳流水，这里直接按审核结果造数据，
 * 再分别调用供应链 genVoucherHandler / unauditDocHandler 与出纳 generateCashierVoucher / previewCashierGenerate。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import Database from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'

let testDb: Database.Database

vi.mock('../db/index.js', () => ({
  getDb: () => testDb,
}))

import { genVoucherHandler, unauditDocHandler } from '../routes/scmDoc.js'
import { generateCashierVoucher, previewCashierGenerate } from '../services/cashierQuery.js'
import { countCashier } from '../services/bizVoucherCenter.js'
import { deleteVoucherWithRefs } from '../services/voucherDelete.js'
import { up as cashierJournalFxUp } from '../db/migrations/20260921_cashier_journal_fx.js'
import { fixScmCashierDupVoucher } from '../scripts/fixScmCashierDupVoucher.js'

const AID = 'AS-DEDUP'
const BANK = '100201'

process.env.LICENSE_SKIP = 'true'

function createDb() {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE scm_doc (id TEXT, account_set_id TEXT, doc_type TEXT, doc_no TEXT, status TEXT,
      doc_date TEXT, partner_code TEXT, settle_account TEXT, remark TEXT, voucher_id TEXT, total_amount REAL);
    CREATE TABLE scm_doc_line (id TEXT, account_set_id TEXT, doc_id TEXT, item_code TEXT,
      qty REAL, price REAL, amount REAL, tax_amount REAL, unit_cost REAL, remark TEXT, arap_source_log_id TEXT);
    CREATE TABLE scm_doc_type (account_set_id TEXT, code TEXT, name TEXT, category TEXT, direction TEXT);
    CREATE TABLE scm_partner (id TEXT, account_set_id TEXT, code TEXT, name TEXT,
      partner_type TEXT, ar_account TEXT, ap_account TEXT);
    CREATE TABLE accounts (id TEXT PRIMARY KEY, account_set_id TEXT, code TEXT, name TEXT, direction TEXT, parent_id TEXT,
      is_enabled INTEGER DEFAULT 1, is_cash INTEGER DEFAULT 0, is_bank INTEGER DEFAULT 0,
      is_foreign INTEGER DEFAULT 0, currency_code TEXT);
    CREATE TABLE system_params (id TEXT, account_set_id TEXT, param_key TEXT, param_value TEXT);
    CREATE TABLE scm_ar_ap_log (id TEXT, account_set_id TEXT, partner_code TEXT, doc_type TEXT, doc_no TEXT,
      direction TEXT, amount REAL, verified_amount REAL DEFAULT 0, cashier_journal_id TEXT,
      currency TEXT, exchange_rate REAL NOT NULL DEFAULT 1, amount_fc REAL, verified_fc REAL NOT NULL DEFAULT 0, arap_side TEXT);
    CREATE TABLE voucher_types (id TEXT PRIMARY KEY, account_set_id TEXT, name TEXT, code TEXT, sort_order INTEGER DEFAULT 0);
    CREATE TABLE vouchers (id TEXT PRIMARY KEY, account_set_id TEXT, voucher_no TEXT, voucher_type_id TEXT,
      voucher_date TEXT, year INTEGER, period INTEGER, total_amount REAL, maker_name TEXT, remark TEXT, source TEXT,
      status TEXT DEFAULT 'draft', reversed_by_voucher_id TEXT, reversal_of_voucher_id TEXT);
    CREATE TABLE voucher_attachments (id TEXT, voucher_id TEXT);
    CREATE TABLE auto_transfer_runs (id TEXT, voucher_id TEXT);
    CREATE TABLE voucher_entries (currency_code TEXT, exchange_rate REAL, foreign_amount REAL, dept_id TEXT, dept_name TEXT,
      project_id TEXT, project_name TEXT, supplier_id TEXT, supplier_name TEXT, person_id TEXT, person_name TEXT,
      func_class_id TEXT, func_class_name TEXT, aux_data TEXT, cash_flow_code TEXT, cash_flow_name TEXT,
      quantity REAL, unit_price REAL, unit TEXT, id TEXT, account_set_id TEXT, voucher_id TEXT, seq INTEGER,
      account_id TEXT, account_code TEXT, account_name TEXT, direction TEXT, amount REAL, amount_cents INTEGER, summary TEXT);
    CREATE TABLE cashier_journal (
      id TEXT PRIMARY KEY, account_set_id TEXT, account_code TEXT, currency TEXT DEFAULT 'RMB',
      biz_date TEXT, seq INTEGER DEFAULT 0, summary TEXT, debit REAL DEFAULT 0, credit REAL DEFAULT 0,
      settle_type TEXT, bill_no TEXT, counter_unit TEXT, counter_account TEXT,
      bank_name TEXT, bank_account TEXT, unit_code TEXT, reconciled INTEGER DEFAULT 0,
      match_batch TEXT, voucher_year INTEGER, voucher_month INTEGER, voucher_type TEXT, voucher_no TEXT,
      counter_aux_item_id TEXT, created_by TEXT, bank_statement_id TEXT, voucher_id TEXT,
      created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE aux_items (id TEXT PRIMARY KEY, account_set_id TEXT, name TEXT);
    CREATE TABLE settle_type (account_set_id TEXT, code TEXT, name TEXT);
    CREATE TABLE cashier_journal_aux (id TEXT, account_set_id TEXT, journal_id TEXT, category_id TEXT, category_code TEXT, item_id TEXT);
  `)
  const acc = db.prepare('INSERT INTO accounts (id,account_set_id,code,name,direction,is_bank,is_cash) VALUES (?,?,?,?,?,?,?)')
  acc.run(`acc-${BANK}`, AID, BANK, '银行存款-工行', 'debit', 1, 0)
  acc.run('acc-1001', AID, '1001', '库存现金', 'debit', 0, 1)
  acc.run('acc-1122', AID, '1122', '应收账款', 'debit', 0, 0)
  acc.run('acc-2202', AID, '2202', '应付账款', 'credit', 0, 0)
  acc.run('acc-6602', AID, '6602', '管理费用', 'debit', 0, 0)
  db.prepare("INSERT INTO voucher_types (id,account_set_id,name,code,sort_order) VALUES ('vt1',?,'记账凭证','1',1)").run(AID)
  for (const code of ['RCV', 'PAY']) {
    db.prepare('INSERT INTO scm_doc_type (account_set_id,code,name,category,direction) VALUES (?,?,?,?,?)')
      .run(AID, code, code === 'RCV' ? '收款单' : '付款单', 'finance', 'none')
  }
  db.prepare('INSERT INTO scm_partner (id,account_set_id,code,name,partner_type) VALUES (?,?,?,?,?)')
    .run(uuidv4(), AID, 'P1', '往来单位甲', 'both')
  cashierJournalFxUp(db)
  return db
}

function setMode(mode: 'scm' | 'cashier' | null) {
  testDb.prepare("DELETE FROM system_params WHERE account_set_id=? AND param_key='payment_voucher_mode'").run(AID)
  if (mode) {
    testDb.prepare("INSERT INTO system_params (id,account_set_id,param_key,param_value) VALUES (?,?,'payment_voucher_mode',?)")
      .run(uuidv4(), AID, mode)
  }
}

/** 模拟收款单审核结果：单据 + 每行一条出纳流水 + 往来台账挂流水 */
function seedReceipt(docNo: string, amounts: number[]) {
  const docId = uuidv4()
  testDb.prepare(`INSERT INTO scm_doc (id,account_set_id,doc_type,doc_no,status,doc_date,partner_code,settle_account)
    VALUES (?,?,?,?,?,?,?,?)`).run(docId, AID, 'RCV', docNo, 'audited', '2026-09-05', 'P1', BANK)
  const journalIds: string[] = []
  amounts.forEach((amt, i) => {
    testDb.prepare('INSERT INTO scm_doc_line (id,account_set_id,doc_id,qty,price,amount) VALUES (?,?,?,?,?,?)')
      .run(uuidv4(), AID, docId, 1, amt, amt)
    const jid = `${docNo}-j${i + 1}`
    testDb.prepare(`INSERT INTO cashier_journal (id,account_set_id,account_code,currency,biz_date,seq,summary,debit,credit,counter_account,exchange_rate,base_debit,base_credit)
      VALUES (?,?,?,?,?,?,?,?,?,?,1,?,0)`).run(jid, AID, BANK, 'RMB', '2026-09-05', i + 1, `收款 ${docNo}`, amt, 0, '1122', amt)
    testDb.prepare(`INSERT INTO scm_ar_ap_log (id,account_set_id,partner_code,doc_type,doc_no,direction,amount,cashier_journal_id,currency,amount_fc)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run(uuidv4(), AID, 'P1', 'RCV', docNo, 'out', amt, jid, 'RMB', amt)
    journalIds.push(jid)
  })
  return { docId, journalIds }
}

function addManualJournal(id: string, amount: number) {
  testDb.prepare(`INSERT INTO cashier_journal (id,account_set_id,account_code,currency,biz_date,seq,summary,debit,credit,counter_account,exchange_rate,base_debit,base_credit)
    VALUES (?,?,?,?,?,?,?,?,?,?,1,0,?)`).run(id, AID, BANK, 'RMB', '2026-09-06', 9, '手工付费用', 0, amount, '6602', amount)
}

function callHandler(handler: any, id: string) {
  const req: any = { params: { id }, accountSetId: AID, userName: '测试员' }
  const res: any = { statusCode: 200, body: null as any }
  res.status = (c: number) => { res.statusCode = c; return res }
  res.json = (b: any) => { res.body = b; return res }
  handler(req, res)
  return res
}

const cashierGen = (ids?: string[]) =>
  generateCashierVoucher({ db: testDb, accountSetId: AID, accountCode: BANK, makerName: 't', ids, startDate: '2026-09-01', endDate: '2026-09-30' })
const journal = (id: string) => testDb.prepare('SELECT voucher_id, voucher_no FROM cashier_journal WHERE id=?').get(id) as any
const docVoucher = (docId: string) => (testDb.prepare('SELECT voucher_id FROM scm_doc WHERE id=?').get(docId) as any).voucher_id
const voucherCount = () => (testDb.prepare('SELECT COUNT(*) c FROM vouchers WHERE account_set_id=?').get(AID) as any).c

beforeEach(() => {
  testDb = createDb()
})

describe('收付款单直接生成凭证（scm 模式，默认）', () => {
  it('未设置参数时按 scm：收款单制证后凭证号回写到全部关联流水', () => {
    const { docId, journalIds } = seedReceipt('SK-001', [300, 200])
    const res = callHandler(genVoucherHandler, docId)
    expect(res.body.code).toBe(0)
    const vid = res.body.data.voucher_id
    for (const jid of journalIds) expect(journal(jid)).toMatchObject({ voucher_id: vid, voucher_no: res.body.data.voucher_no })
  })

  it('出纳勾选来源行生成凭证被拒，凭证数不变', () => {
    const { journalIds } = seedReceipt('SK-002', [100])
    const r = cashierGen([journalIds[0]]) as any
    expect(r.error).toContain('收款单 SK-002')
    expect(r.error).toContain('收付款单直接生成凭证')
    expect(voucherCount()).toBe(0)
    expect((previewCashierGenerate({ db: testDb, accountSetId: AID, accountCode: BANK, ids: [journalIds[0]] }) as any).error).toBeTruthy()
  })

  it('出纳按日期区间批量生成：自动跳过来源行，只生成手工流水', () => {
    const { journalIds } = seedReceipt('SK-003', [100])
    addManualJournal('m1', 50)
    const r = cashierGen() as any
    expect(r.error).toBeUndefined()
    expect(r.syncedCount).toBe(1)
    expect(journal('m1').voucher_id).toBeTruthy()
    expect(journal(journalIds[0]).voucher_id).toBeNull()
    const preview = previewCashierGenerate({ db: testDb, accountSetId: AID, accountCode: BANK, startDate: '2026-09-01', endDate: '2026-09-30' })
    expect(preview.rows).toHaveLength(0)
  })

  it('删除收款单凭证后流水恢复未生成，可再次由收款单制证', () => {
    const { docId, journalIds } = seedReceipt('SK-004', [100])
    const vid = callHandler(genVoucherHandler, docId).body.data.voucher_id
    deleteVoucherWithRefs(testDb, AID, testDb.prepare('SELECT * FROM vouchers WHERE id=?').get(vid) as any)
    expect(journal(journalIds[0])).toMatchObject({ voucher_id: null, voucher_no: null })
    expect(docVoucher(docId)).toBeNull()
    expect(callHandler(genVoucherHandler, docId).body.code).toBe(0)
  })
})

describe('通过出纳生成凭证（cashier 模式）', () => {
  beforeEach(() => setMode('cashier'))

  it('收款单不能直接生成凭证', () => {
    const { docId } = seedReceipt('SK-101', [100])
    const res = callHandler(genVoucherHandler, docId)
    expect(res.statusCode).toBe(400)
    expect(res.body.message).toContain('通过出纳生成凭证')
    expect(voucherCount()).toBe(0)
  })

  it('出纳只勾一行：同单其它行自动带入，合并成一张凭证并回写收款单', () => {
    const { docId, journalIds } = seedReceipt('SK-102', [300, 200])
    const preview = previewCashierGenerate({ db: testDb, accountSetId: AID, accountCode: BANK, ids: [journalIds[0]] })
    expect(preview.rows.map(r => r.id).sort()).toEqual([...journalIds].sort())
    expect(preview.rows.find(r => r.id === journalIds[1])).toMatchObject({ auto_included: true, scm_doc_no: 'SK-102' })

    const r = cashierGen([journalIds[0]]) as any
    expect(r.error).toBeUndefined()
    expect(r.voucherIds).toHaveLength(1)
    const vid = r.voucherIds[0]
    for (const jid of journalIds) expect(journal(jid).voucher_id).toBe(vid)
    expect(docVoucher(docId)).toBe(vid)
    const v = testDb.prepare('SELECT total_amount, remark, source FROM vouchers WHERE id=?').get(vid) as any
    expect(v).toMatchObject({ total_amount: 500, remark: '收款单SK-102', source: 'cashier' })
    const entries = testDb.prepare('SELECT account_code, direction, amount FROM voucher_entries WHERE voucher_id=? ORDER BY seq').all(vid)
    expect(entries).toEqual([
      { account_code: BANK, direction: 'debit', amount: 300 },
      { account_code: '1122', direction: 'credit', amount: 300 },
      { account_code: BANK, direction: 'debit', amount: 200 },
      { account_code: '1122', direction: 'credit', amount: 200 },
    ])
  })

  it('出纳制证后收款单反审核被拦，提示到出纳删除凭证', () => {
    const { docId, journalIds } = seedReceipt('SK-103', [100])
    cashierGen([journalIds[0]])
    const res = callHandler(unauditDocHandler, docId)
    expect(res.statusCode).toBe(400)
    expect(res.body.message).toContain('出纳')
    expect((testDb.prepare('SELECT status FROM scm_doc WHERE id=?').get(docId) as any).status).toBe('audited')
  })

  it('手工流水仍一行一凭证', () => {
    addManualJournal('m1', 50)
    addManualJournal('m2', 60)
    const r = cashierGen(['m1', 'm2']) as any
    expect(r.voucherIds).toHaveLength(2)
  })
})

describe('切换参数后仍不会重复制证', () => {
  it('scm 模式已由收款单制证，切到 cashier 后出纳仍被拒', () => {
    const { docId, journalIds } = seedReceipt('SK-201', [100])
    expect(callHandler(genVoucherHandler, docId).body.code).toBe(0)
    setMode('cashier')
    // 已有凭证号的流水不在待制证范围内
    const r = cashierGen([journalIds[0]]) as any
    expect(r.error).toBeTruthy()
    expect(voucherCount()).toBe(1)
  })

  it('cashier 模式已由出纳制证，切回 scm 后收款单仍被拒', () => {
    setMode('cashier')
    const { docId, journalIds } = seedReceipt('SK-202', [100])
    cashierGen([journalIds[0]])
    setMode('scm')
    const res = callHandler(genVoucherHandler, docId)
    expect(res.statusCode).toBe(400)
    expect(voucherCount()).toBe(1)
  })

  it('历史数据：出纳已制证但收款单未回写，收款单制证被拒', () => {
    const { docId, journalIds } = seedReceipt('SK-203', [100])
    addManualJournal('m1', 1)
    testDb.prepare("UPDATE cashier_journal SET voucher_id='v-old', voucher_no='记-9' WHERE id=?").run(journalIds[0])
    const res = callHandler(genVoucherHandler, docId)
    expect(res.statusCode).toBe(400)
    expect(res.body.message).toContain('记-9')
  })
})

describe('业务凭证中心出纳待生成计数', () => {
  it('scm 模式不计收付款来源流水；cashier 模式计入', () => {
    // 出纳查询要读辅助类别（列出动态列）；供应链制证用例不建这张表，避免触发辅助核算对应校验
    testDb.exec('CREATE TABLE aux_categories (id TEXT PRIMARY KEY, account_set_id TEXT, code TEXT, name TEXT, sort_order INTEGER DEFAULT 0)')
    seedReceipt('SK-301', [100, 50])
    addManualJournal('m1', 10)
    expect(countCashier(testDb, AID, undefined, {}).pending).toBe(1)
    setMode('cashier')
    expect(countCashier(testDb, AID, undefined, {}).pending).toBe(3)
  })
})

describe('存量重复制证修复脚本', () => {
  it('scm 模式：删除出纳侧重复凭证并回写流水，可重复执行', () => {
    const { docId, journalIds } = seedReceipt('SK-401', [100])
    const scmVid = callHandler(genVoucherHandler, docId).body.data.voucher_id
    // 模拟旧版本：出纳又对同一流水生成了一张凭证
    testDb.prepare("INSERT INTO vouchers (id,account_set_id,voucher_no,voucher_date,year,period,total_amount,source,status) VALUES ('v-dup',?,'记-099','2026-09-05',2026,9,100,'cashier','draft')").run(AID)
    testDb.prepare("UPDATE cashier_journal SET voucher_id='v-dup', voucher_no='记-099' WHERE id=?").run(journalIds[0])

    const dry = fixScmCashierDupVoucher(AID, { db: testDb })
    expect(dry.rows[0]).toMatchObject({ action: 'duplicate', cashier_voucher_nos: ['记-099'] })
    expect(voucherCount()).toBe(2)

    fixScmCashierDupVoucher(AID, { db: testDb, apply: true })
    expect(voucherCount()).toBe(1)
    expect(journal(journalIds[0]).voucher_id).toBe(scmVid)
    expect(fixScmCashierDupVoucher(AID, { db: testDb }).rows[0].action).toBe('ok')
  })

  it('待删一侧已记账：只报告不改', () => {
    const { docId, journalIds } = seedReceipt('SK-402', [100])
    callHandler(genVoucherHandler, docId)
    testDb.prepare("INSERT INTO vouchers (id,account_set_id,voucher_no,voucher_date,year,period,total_amount,source,status) VALUES ('v-p',?,'记-098','2026-09-05',2026,9,100,'cashier','posted')").run(AID)
    testDb.prepare("UPDATE cashier_journal SET voucher_id='v-p', voucher_no='记-098' WHERE id=?").run(journalIds[0])
    const r = fixScmCashierDupVoucher(AID, { db: testDb, apply: true })
    expect(r.rows[0].action).toBe('posted_conflict')
    expect(voucherCount()).toBe(2)
  })
})
