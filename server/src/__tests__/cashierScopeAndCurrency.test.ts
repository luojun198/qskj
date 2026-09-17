import { describe, it, expect, beforeEach, vi } from 'vitest'
import Database from 'better-sqlite3'

let testDb: Database.Database
vi.mock('../db/index.js', () => ({
  getDb: () => testDb,
}))

import { up as cashierJournalLinksUp } from '../db/migrations/20260917_cashier_journal_links.js'
import {
  searchJournals,
  getAccountBalanceReport,
  getCashFlowSummary,
  listCashierCurrencies,
  getCashierBaseCurrency,
  normalizeCashierCurrency,
  syncCashierVoucherNos,
} from '../services/cashierQuery.js'
import { applyPayment } from '../services/scmArAp.js'
import { cashierPermissionReason } from '../middleware/cashierPermission.js'

/**
 * 2026-09-17 综合评审批次 D：
 *  - P1-2 本位币统一（CNY / RMB 归一）
 *  - P1-3 / P2-12 / P2-13 权限规则
 *  - P1-10 科目授权铺开到出纳查询 / 报表
 *  - P1-11 重排号后按 voucher_id 刷新日记账凭证号
 */

const AS = 'as1'

function makeDb() {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE accounts (id TEXT PRIMARY KEY, account_set_id TEXT, code TEXT, name TEXT, is_cash INTEGER DEFAULT 0, is_bank INTEGER DEFAULT 0, parent_id TEXT, is_enabled INTEGER DEFAULT 1);
    CREATE TABLE cashier_journal (
      id TEXT PRIMARY KEY, account_set_id TEXT, account_code TEXT, currency TEXT DEFAULT 'RMB',
      biz_date TEXT, seq INTEGER DEFAULT 0, summary TEXT, debit REAL DEFAULT 0, credit REAL DEFAULT 0,
      settle_type TEXT, bill_no TEXT, counter_unit TEXT, counter_account TEXT,
      bank_name TEXT, bank_account TEXT, unit_code TEXT, reconciled INTEGER DEFAULT 0,
      match_batch TEXT, voucher_year INTEGER, voucher_month INTEGER, voucher_type TEXT, voucher_no TEXT,
      counter_aux_item_id TEXT, created_by TEXT,
      created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE cashier_init_balance (id TEXT PRIMARY KEY, account_set_id TEXT, account_code TEXT, currency TEXT, balance REAL, init_date TEXT);
    CREATE TABLE vouchers (id TEXT PRIMARY KEY, account_set_id TEXT, voucher_no TEXT, voucher_type_id TEXT, year INTEGER, period INTEGER, source TEXT);
    CREATE TABLE system_params (id TEXT PRIMARY KEY, account_set_id TEXT, param_key TEXT, param_value TEXT);
    CREATE TABLE settle_type (id TEXT PRIMARY KEY, account_set_id TEXT, code TEXT, name TEXT);
    CREATE TABLE scm_partner (id TEXT PRIMARY KEY, account_set_id TEXT, code TEXT, name TEXT, ar_account TEXT, ap_account TEXT, credit_days INTEGER);
    CREATE TABLE scm_ar_ap_log (
      id TEXT PRIMARY KEY, account_set_id TEXT, partner_code TEXT, doc_type TEXT, doc_no TEXT, doc_date TEXT, due_date TEXT,
      direction TEXT, amount REAL, ar_account TEXT, ap_account TEXT, cashier_journal_id TEXT, remark TEXT, verified_amount REAL DEFAULT 0
    );
    CREATE TABLE scm_ar_ap_verify (id TEXT PRIMARY KEY, account_set_id TEXT, in_log_id TEXT, out_log_id TEXT, amount REAL);
  `)
  cashierJournalLinksUp(db)
  db.prepare("INSERT INTO accounts (id, account_set_id, code, name, is_cash) VALUES ('a1001', ?, '1001', '库存现金', 1)").run(AS)
  db.prepare("INSERT INTO accounts (id, account_set_id, code, name, is_bank) VALUES ('a1002', ?, '1002', '银行存款', 1)").run(AS)
  db.prepare("INSERT INTO accounts (id, account_set_id, code, name) VALUES ('a1122', ?, '1122', '应收账款')").run(AS)
  db.prepare("INSERT INTO scm_partner VALUES ('p1', ?, 'P001', '客户甲', NULL, NULL, 0)").run(AS)
  const ins = db.prepare(
    "INSERT INTO cashier_journal (id, account_set_id, account_code, currency, biz_date, debit, credit) VALUES (?,?,?,?,?,?,?)"
  )
  ins.run('j1', AS, '1001', 'RMB', '2026-08-01', 100, 0)
  ins.run('j2', AS, '1002', 'RMB', '2026-08-02', 0, 50)
  ins.run('j3', AS, '1002', 'USD', '2026-08-03', 20, 0)
  return db
}

const scope1001 = { bypass: false, restricted: true, allowedAccountIds: new Set(['a1001']) }

describe('批次 D：口径 / 权限 / 关联', () => {
  let db: Database.Database
  beforeEach(() => {
    db = makeDb()
    testDb = db
  })

  it('P1-2：本位币解析与 CNY 归一，币种列表本位币在前且不重复', () => {
    expect(getCashierBaseCurrency(db, AS)).toBe('RMB')
    expect(normalizeCashierCurrency('cny', 'RMB')).toBe('RMB')
    expect(normalizeCashierCurrency('', 'RMB')).toBe('RMB')
    expect(normalizeCashierCurrency('usd', 'RMB')).toBe('USD')
    db.prepare("INSERT INTO cashier_init_balance VALUES ('ib', ?, '1001', 'CNY', 0, NULL)").run(AS)
    expect(listCashierCurrencies(AS)).toEqual(['RMB', 'USD'])
    // system_params 指定其它本位币
    db.prepare("INSERT INTO system_params VALUES ('sp', ?, 'base_currency', 'HKD')").run(AS)
    expect(getCashierBaseCurrency(db, AS)).toBe('HKD')
    expect(listCashierCurrencies(AS)[0]).toBe('HKD')
  })

  it('P1-2：SCM 收款单默认 CNY 写入出纳流水时落为本位币 RMB，出纳默认视图可见', () => {
    applyPayment(db, AS, { doc_type: 'RCV', doc_no: 'R1', doc_date: '2026-08-15', partner_code: 'P001', settle_account: '1001', currency: 'CNY' }, [{ amount: 300 }], 'u')
    const row = db.prepare("SELECT currency, debit FROM cashier_journal WHERE summary LIKE '%R1%'").get() as any
    expect(row).toEqual({ currency: 'RMB', debit: 300 })
    const res = searchJournals({ accountSetId: AS, accountCodes: ['1001'], currency: 'RMB' })
    expect(res.list.map(r => r.id)).toContain(row ? (db.prepare("SELECT id FROM cashier_journal WHERE summary LIKE '%R1%'").get() as any).id : '')
  })

  it('P1-10：科目授权只允许 1001 时，综合查询 / 账户余额表 / 收支汇总表看不到 1002', () => {
    const search = searchJournals({ accountSetId: AS, scope: scope1001 })
    expect(search.list.map(r => r.account_code)).toEqual(['1001'])
    const report = getAccountBalanceReport({ accountSetId: AS, startDate: '2026-08-01', endDate: '2026-08-31', scope: scope1001 })
    expect(report.rows.map(r => r.account_code)).toEqual(['1001'])
    const summary = getCashFlowSummary({ accountSetId: AS, startDate: '2026-08-01', endDate: '2026-08-31', groupBy: 'month', scope: scope1001 })
    expect(summary).toHaveLength(1)
    expect(Number(summary[0].income)).toBe(100)
    // 未受限时全部可见
    expect(searchJournals({ accountSetId: AS }).list).toHaveLength(3)
  })

  it('P1-11：重排号后按 voucher_id 刷新日记账上的凭证号', () => {
    db.prepare("INSERT INTO vouchers VALUES ('v1', ?, '记-9', 'vt', 2026, 8, 'cashier')").run(AS)
    db.prepare("UPDATE cashier_journal SET voucher_id='v1', voucher_year=2026, voucher_month=8, voucher_no='记-9' WHERE id='j1'").run()
    db.prepare("UPDATE vouchers SET voucher_no='记-1' WHERE id='v1'").run()
    expect(syncCashierVoucherNos(db, AS, ['v1'])).toBe(1)
    expect(db.prepare("SELECT voucher_no, voucher_type FROM cashier_journal WHERE id='j1'").get()).toEqual({ voucher_no: '记-1', voucher_type: 'vt' })
  })

  it('P1-3 / P1-8 / P2-12 / P2-13：出纳权限规则', () => {
    const r = (path: string, perms: string[], method = 'POST') => cashierPermissionReason({ path, method, permissions: perms })
    expect(r('/cashier/reset', ['cashier:journal'])).toBe('无此操作权限')
    expect(r('/cashier/reset', ['cashier:initbal'])).toBeNull()
    expect(r('/cashier/periods/2026.5/9/close', ['cashier:journal'])).toBe('无此操作权限')
    expect(r('/cashier/periods/2026/9/close', ['cashier:param'])).toBeNull()
    expect(r('/cashier/periods/2026', ['cashier:journal'], 'GET')).toBeNull()
    expect(r('/cashier/daily-report', ['cashier:journal'], 'GET')).toBeNull()
    expect(r('/cashier/daily-report', ['cashier:report'], 'GET')).toBeNull()
    expect(r('/cashier/summary-report', ['cashier:report'], 'GET')).toBeNull()
    expect(r('/cashier/bank-statement/import/confirm', ['cashier:reconcile'])).toBeNull()
    expect(r('/cashier/bank-statement/import/confirm', ['cashier:journal'])).toBe('无此操作权限')
    expect(r('/cashier/journal', ['cashier:report'])).toBe('无此操作权限')
    expect(r('/cashier/journal', ['*'])).toBeNull()
  })
})
