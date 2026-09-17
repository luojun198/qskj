import { describe, it, expect, beforeEach, vi } from 'vitest'
import Database from 'better-sqlite3'

let testDb: Database.Database
vi.mock('../db/index.js', () => ({
  getDb: () => testDb,
}))

import { up as cashierPeriodClosingUp } from '../db/migrations/20260916_cashier_period_closing.js'
import { up as cashierJournalLinksUp } from '../db/migrations/20260917_cashier_journal_links.js'
import { closeCashierPeriod } from '../services/cashierPeriodClosing.js'
import {
  autoReconcile,
  manualReconcile,
  cancelReconcile,
  syncCashierFromVoucher,
} from '../services/cashierQuery.js'
import { applyPayment, reversePayment } from '../services/scmArAp.js'

/**
 * 2026-09-17 综合评审批次 C：出纳完整性
 *  - P1-1 SCM 收付款单审核 / 反审核过出纳闸
 *  - P1-5 勾对批次唯一化 + bank_statement_id 精确撤销
 *  - P1-6 勾对 / 撤销勾对 / 凭证同步过出纳闸
 *  - P2-6 凭证同步查重不含 biz_date
 *  - 迁移 127 回填
 */

const AS = 'as1'

function makeDb() {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE accounts (id TEXT PRIMARY KEY, account_set_id TEXT, code TEXT, name TEXT, is_cash INTEGER DEFAULT 0, is_bank INTEGER DEFAULT 0);
    CREATE TABLE cashier_journal (
      id TEXT PRIMARY KEY, account_set_id TEXT, account_code TEXT, currency TEXT DEFAULT 'RMB',
      biz_date TEXT, seq INTEGER DEFAULT 0, summary TEXT, debit REAL DEFAULT 0, credit REAL DEFAULT 0,
      settle_type TEXT, bill_no TEXT, counter_unit TEXT, counter_account TEXT,
      bank_name TEXT, bank_account TEXT, unit_code TEXT, reconciled INTEGER DEFAULT 0,
      match_batch TEXT, voucher_year INTEGER, voucher_month INTEGER, voucher_type TEXT, voucher_no TEXT,
      counter_aux_item_id TEXT, created_by TEXT,
      created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE bank_statement (
      id TEXT PRIMARY KEY, account_set_id TEXT, account_code TEXT, biz_date TEXT,
      debit REAL DEFAULT 0, credit REAL DEFAULT 0, settle_type TEXT, bill_no TEXT,
      matched INTEGER DEFAULT 0, match_batch TEXT, source TEXT DEFAULT 'import'
    );
    CREATE TABLE vouchers (id TEXT PRIMARY KEY, account_set_id TEXT, voucher_no TEXT, year INTEGER, period INTEGER, source TEXT);
    CREATE TABLE system_params (id TEXT PRIMARY KEY, account_set_id TEXT, param_key TEXT, param_value TEXT);
    CREATE TABLE scm_partner (id TEXT PRIMARY KEY, account_set_id TEXT, code TEXT, name TEXT, ar_account TEXT, ap_account TEXT, credit_days INTEGER);
    CREATE TABLE scm_ar_ap_log (
      id TEXT PRIMARY KEY, account_set_id TEXT, partner_code TEXT, doc_type TEXT, doc_no TEXT, doc_date TEXT, due_date TEXT,
      direction TEXT, amount REAL, ar_account TEXT, ap_account TEXT, cashier_journal_id TEXT, remark TEXT, verified_amount REAL DEFAULT 0
    );
    CREATE TABLE scm_ar_ap_verify (id TEXT PRIMARY KEY, account_set_id TEXT, in_log_id TEXT, out_log_id TEXT, amount REAL);
  `)
  cashierPeriodClosingUp(db)
  db.prepare("INSERT INTO accounts VALUES ('a1001', ?, '1001', '库存现金', 1, 0)").run(AS)
  db.prepare("INSERT INTO accounts VALUES ('a1122', ?, '1122', '应收账款', 0, 0)").run(AS)
  db.prepare("INSERT INTO scm_partner VALUES ('p1', ?, 'P001', '客户甲', NULL, NULL, 0)").run(AS)
  return db
}

const addJ = (db: Database.Database, id: string, date: string, debit: number, credit = 0, bill?: string) =>
  db.prepare(
    "INSERT INTO cashier_journal (id, account_set_id, account_code, biz_date, debit, credit, bill_no) VALUES (?,?,'1001',?,?,?,?)"
  ).run(id, AS, date, debit, credit, bill ?? null)
const addS = (db: Database.Database, id: string, date: string, debit: number, credit = 0, bill?: string) =>
  db.prepare(
    "INSERT INTO bank_statement (id, account_set_id, account_code, biz_date, debit, credit, bill_no) VALUES (?,?,'1001',?,?,?,?)"
  ).run(id, AS, date, debit, credit, bill ?? null)
const j = (db: Database.Database, id: string) => db.prepare('SELECT * FROM cashier_journal WHERE id=?').get(id) as any
const s = (db: Database.Database, id: string) => db.prepare('SELECT * FROM bank_statement WHERE id=?').get(id) as any

describe('出纳完整性（批次 C）', () => {
  let db: Database.Database
  beforeEach(() => {
    db = makeDb()
    testDb = db
  })

  it('P1-5：自动勾对每对独立批次并写 bank_statement_id，撤销一条不影响同批其它对账单', () => {
    cashierJournalLinksUp(db)
    addJ(db, 'j1', '2026-08-01', 100)
    addJ(db, 'j2', '2026-08-02', 200)
    addJ(db, 'j3', '2026-08-03', 300)
    addS(db, 's1', '2026-08-01', 100)
    addS(db, 's2', '2026-08-02', 200)
    addS(db, 's3', '2026-08-03', 300)
    const r = autoReconcile({ accountSetId: AS, accountCode: '1001' })
    expect(r.matched).toBe(3)
    expect(j(db, 'j1').bank_statement_id).toBe('s1')
    expect(j(db, 'j2').bank_statement_id).toBe('s2')
    expect(new Set([j(db, 'j1').match_batch, j(db, 'j2').match_batch, j(db, 'j3').match_batch]).size).toBe(3)
    expect(j(db, 'j1').match_batch).toBe(String(s(db, 's1').match_batch))

    expect(cancelReconcile({ db, accountSetId: AS, journalId: 'j2' })).toEqual({ ok: true })
    expect(j(db, 'j2')).toMatchObject({ reconciled: 0, bank_statement_id: null })
    expect(s(db, 's2').matched).toBe(0)
    // 其余两对保持已对账
    expect(s(db, 's1').matched).toBe(1)
    expect(s(db, 's3').matched).toBe(1)
    expect(j(db, 'j1').reconciled).toBe(1)
  })

  it('P1-5：存量共用批次（无 bank_statement_id）撤销时只在批次内仅剩一条对账单时反写，不连带清整批', () => {
    cashierJournalLinksUp(db)
    for (const n of [1, 2]) {
      addJ(db, `j${n}`, '2026-08-01', 100 * n)
      addS(db, `s${n}`, '2026-08-01', 100 * n)
      db.prepare("UPDATE cashier_journal SET reconciled=1, match_batch='old' WHERE id=?").run(`j${n}`)
      db.prepare("UPDATE bank_statement SET matched=1, match_batch='old' WHERE id=?").run(`s${n}`)
    }
    cancelReconcile({ db, accountSetId: AS, journalId: 'j1' })
    expect(j(db, 'j1').reconciled).toBe(0)
    expect(s(db, 's1').matched).toBe(1)
    expect(s(db, 's2').matched).toBe(1)
    expect(j(db, 'j2').reconciled).toBe(1)
  })

  it('P1-6：出纳已结账月份的日记账 / 对账单不参与自动勾对，手工勾对与撤销被拒绝', () => {
    cashierJournalLinksUp(db)
    addJ(db, 'j-jul', '2026-07-05', 100)
    addS(db, 's-jul', '2026-07-05', 100)
    addJ(db, 'j-aug', '2026-08-05', 100)
    addS(db, 's-aug', '2026-08-05', 100)
    // 先把 8 月一对勾上，再结 7 月
    manualReconcile({ db, accountSetId: AS, journalId: 'j-aug', bankStatementId: 's-aug' })
    closeCashierPeriod({ db, accountSetId: AS, year: 2026, month: 7 })
    expect(autoReconcile({ accountSetId: AS, accountCode: '1001' }).matched).toBe(0)
    expect(j(db, 'j-jul').reconciled).toBe(0)
    expect(manualReconcile({ db, accountSetId: AS, journalId: 'j-jul', bankStatementId: 's-jul' })).toMatchObject({
      error: expect.stringMatching(/7月出纳已结账/),
    })
    // 8 月未结账，撤销正常
    expect(cancelReconcile({ db, accountSetId: AS, journalId: 'j-aug' })).toEqual({ ok: true })
  })

  it('P2-6 / P1-6：凭证同步按凭证定位，改日期不重复插行；目标月份已结账则拒绝', () => {
    cashierJournalLinksUp(db)
    db.prepare("INSERT INTO system_params VALUES ('sp', ?, 'cashier:auto_sync', '1')").run(AS)
    const base = {
      db,
      accountSetId: AS,
      voucherYear: 2026,
      voucherMonth: 8,
      voucherType: null,
      voucherNo: '记-1',
      voucherId: 'v1',
      entries: [
        { account_code: '1001', direction: 'debit' as const, amount: 100 },
        { account_code: '1122', direction: 'credit' as const, amount: 100 },
      ],
    }
    syncCashierFromVoucher({ ...base, voucherDate: '2026-08-10' })
    syncCashierFromVoucher({ ...base, voucherDate: '2026-08-11' })
    const rows = db.prepare("SELECT biz_date, voucher_id FROM cashier_journal WHERE account_set_id=?").all(AS) as any[]
    expect(rows).toEqual([{ biz_date: '2026-08-11', voucher_id: 'v1' }])
    // 存量行（无 voucher_id）也按 年/期/号 命中并补上 voucher_id
    db.prepare("UPDATE cashier_journal SET voucher_id=NULL").run()
    syncCashierFromVoucher({ ...base, voucherDate: '2026-08-12' })
    expect(db.prepare('SELECT COUNT(*) c FROM cashier_journal').get()).toEqual({ c: 1 })
    const onlyId = (db.prepare('SELECT id FROM cashier_journal').get() as any).id
    expect(j(db, onlyId)).toMatchObject({ voucher_id: 'v1', biz_date: '2026-08-12' })

    closeCashierPeriod({ db, accountSetId: AS, year: 2026, month: 7 })
    expect(() => syncCashierFromVoucher({ ...base, voucherId: 'v2', voucherNo: '记-2', voucherDate: '2026-07-20' })).toThrow(/7月出纳已结账/)
  })

  it('P1-1：SCM 收付款单在出纳已结账月份审核 / 反审核被拒绝，未结账月份正常写入并可回退', () => {
    const doc = { doc_type: 'RCV', doc_no: 'RCV-1', doc_date: '2026/8/15', partner_code: 'P001', settle_account: '1001', payment_type: 'cash' }
    applyPayment(db, AS, doc, [{ amount: 500 }], '张三')
    const row = db.prepare('SELECT * FROM cashier_journal WHERE account_set_id=?').get(AS) as any
    expect(row).toMatchObject({ account_code: '1001', biz_date: '2026-08-15', debit: 500, credit: 0 })

    closeCashierPeriod({ db, accountSetId: AS, year: 2026, month: 7 })
    const julDoc = { ...doc, doc_no: 'RCV-2', doc_date: '2026-07-15' }
    expect(() => applyPayment(db, AS, julDoc, [{ amount: 100 }], '张三')).toThrow(/7月出纳已结账/)
    expect(db.prepare('SELECT COUNT(*) c FROM cashier_journal').get()).toEqual({ c: 1 })

    // 8 月结账后，8 月的收款单不能反审核；反结账后可以
    closeCashierPeriod({ db, accountSetId: AS, year: 2026, month: 8 })
    expect(() => reversePayment(db, AS, doc)).toThrow(/8月出纳已结账/)
    expect(db.prepare('SELECT COUNT(*) c FROM cashier_journal').get()).toEqual({ c: 1 })
    db.prepare("UPDATE cashier_period_closing SET status='open'").run()
    reversePayment(db, AS, doc)
    expect(db.prepare('SELECT COUNT(*) c FROM cashier_journal').get()).toEqual({ c: 0 })
  })

  it('迁移 127：加列并回填 voucher_id 与一对一的 bank_statement_id', () => {
    addJ(db, 'j1', '2026-08-01', 100)
    addS(db, 's1', '2026-08-01', 100)
    db.prepare("UPDATE cashier_journal SET reconciled=1, match_batch='b1', voucher_year=2026, voucher_month=8, voucher_no='5' WHERE id='j1'").run()
    db.prepare("UPDATE bank_statement SET matched=1, match_batch='b1' WHERE id='s1'").run()
    db.prepare("INSERT INTO vouchers VALUES ('v5', ?, '5', 2026, 8, 'cashier')").run(AS)
    cashierJournalLinksUp(db)
    expect(j(db, 'j1')).toMatchObject({ bank_statement_id: 's1', voucher_id: 'v5' })
    // 幂等
    expect(() => cashierJournalLinksUp(db)).not.toThrow()
  })
})
