/**
 * FIX-264：出纳初始化一步到位——已记账出纳凭证自动反记账（回滚科目余额）后删除、出纳结账月份一并清除、
 * 对账批次清空；总账期间已结账时拒绝；非出纳来源凭证不受影响。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { up as periodClosingUp } from '../db/migrations/20260916_cashier_period_closing.js'
import { up as glMatchUp } from '../db/migrations/20260924_cashier_gl_match.js'
import { getCashierResetImpact, performCashierReset } from '../services/cashierReset.js'

const AS = 'as1'
let db: Database.Database

function voucher(id: string, no: string, status: string, source: string | null, amount: number) {
  db.prepare(`INSERT INTO vouchers (id, account_set_id, voucher_no, voucher_date, year, period, status, source)
    VALUES (?, ?, ?, '2026-09-10', 2026, 9, ?, ?)`).run(id, AS, no, status, source)
  const ins = db.prepare(`INSERT INTO voucher_entries (id, account_set_id, voucher_id, seq, account_id, account_code, account_name, direction, amount, amount_cents)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
  ins.run(`${id}-1`, AS, id, 1, 'a1002', '1002', '银行存款', 'debit', amount, amount * 100)
  ins.run(`${id}-2`, AS, id, 2, 'a6001', '6001', '主营业务收入', 'credit', amount, amount * 100)
}
function balance(accountId: string, direction: string, debit: number, credit: number) {
  db.prepare(`INSERT INTO account_balances (id, account_set_id, account_id, account_code, direction, year, period, current_debit, current_credit, end_balance, aux_item_id)
    VALUES (?, ?, ?, ?, ?, 2026, 9, ?, ?, ?, '')`).run(`b-${accountId}`, AS, accountId, accountId.slice(1), direction, debit, credit,
    direction === 'debit' ? debit - credit : credit - debit)
}

beforeEach(() => {
  db = new Database(':memory:')
  db.exec(`
    CREATE TABLE vouchers (id TEXT PRIMARY KEY, account_set_id TEXT, voucher_no TEXT, voucher_date TEXT, year INTEGER, period INTEGER,
      status TEXT, source TEXT, poster_id TEXT, poster_name TEXT, posted_at TEXT, updated_at TEXT,
      reversed_by_voucher_id TEXT, reversal_of_voucher_id TEXT);
    CREATE TABLE voucher_entries (id TEXT PRIMARY KEY, account_set_id TEXT, voucher_id TEXT, seq INTEGER, account_id TEXT, account_code TEXT,
      account_name TEXT, direction TEXT, amount REAL, amount_cents INTEGER, dept_id TEXT, project_id TEXT, supplier_id TEXT, person_id TEXT,
      func_class_id TEXT, aux_data TEXT, currency_code TEXT, exchange_rate REAL, foreign_amount REAL);
    CREATE TABLE account_balances (id TEXT PRIMARY KEY, account_set_id TEXT, account_id TEXT, account_code TEXT, account_name TEXT, direction TEXT,
      year INTEGER, period INTEGER, init_balance REAL DEFAULT 0, current_debit REAL DEFAULT 0, current_credit REAL DEFAULT 0,
      end_balance REAL DEFAULT 0, aux_item_id TEXT DEFAULT '', foreign_current_debit REAL DEFAULT 0, foreign_current_credit REAL DEFAULT 0,
      foreign_end_balance REAL DEFAULT 0);
    CREATE TABLE voucher_attachments (id TEXT, voucher_id TEXT);
    CREATE TABLE auto_transfer_runs (id TEXT, voucher_id TEXT);
    CREATE TABLE scm_doc (id TEXT, account_set_id TEXT, voucher_id TEXT);
    CREATE TABLE period_closing (id TEXT, account_set_id TEXT, year INTEGER, period INTEGER, status TEXT);
    CREATE TABLE system_params (id TEXT, account_set_id TEXT, param_key TEXT, param_value TEXT);
    CREATE TABLE cashier_journal (id TEXT PRIMARY KEY, account_set_id TEXT, account_code TEXT, biz_date TEXT, debit REAL, credit REAL,
      voucher_year INTEGER, voucher_month INTEGER, voucher_type TEXT, voucher_no TEXT, voucher_id TEXT, reconciled INTEGER DEFAULT 0);
    CREATE TABLE cashier_init_balance (id TEXT, account_set_id TEXT, account_code TEXT, currency TEXT, balance REAL);
    CREATE TABLE cashier_attachments (id TEXT, account_set_id TEXT, filename TEXT);
    CREATE TABLE bank_statement (id TEXT, account_set_id TEXT);
  `)
  periodClosingUp(db)
  glMatchUp(db)
  // 出纳凭证：已记账 5000 + 草稿 300；总账手工凭证（已记账 100）不受影响
  voucher('vc1', '结-018', 'posted', 'cashier', 5000)
  voucher('vc2', '结-019', 'draft', 'cashier', 300)
  voucher('vg1', '记-010', 'posted', null, 100)
  balance('a1002', 'debit', 5100, 0)
  balance('a6001', 'credit', 0, 5100)
  db.exec(`
    INSERT INTO cashier_journal (id, account_set_id, account_code, biz_date, debit, credit, voucher_id, reconciled)
      VALUES ('j1', '${AS}', '1002', '2026-09-10', 5000, 0, 'vc1', 1), ('j2', '${AS}', '1002', '2026-09-10', 300, 0, 'vc2', 0);
    INSERT INTO cashier_init_balance VALUES ('ib', '${AS}', '1002', 'RMB', 1000);
    INSERT INTO cashier_period_closing (id, account_set_id, year, month, status) VALUES ('p8', '${AS}', 2026, 8, 'closed');
    INSERT INTO cashier_gl_match (id, account_set_id, account_code, currency, batch_id, side, ref_id, amount, match_type)
      VALUES ('m1', '${AS}', '1002', 'RMB', 'b1', 'cashier', 'j1', 5000, 'link'), ('m2', '${AS}', '1002', 'RMB', 'b1', 'gl', 'vc1-1', 5000, 'link');
  `)
})

describe('cashierReset', () => {
  it('预览：列出已记账凭证、将清除的结账月份，无阻断项', () => {
    expect(getCashierResetImpact(db, AS)).toEqual({
      journalRows: 2, vouchers: 2, postedVouchers: ['结-018'], closedMonths: ['2026-08'], blockedGlPeriods: [],
    })
  })

  it('执行：已记账出纳凭证反记账（余额回滚）后删除，结账 / 对账 / 日记账 / 期初全部清空；手工凭证不动', () => {
    const r = performCashierReset(db, AS)
    expect(r).toEqual({ deletedVouchers: 2, unpostedVouchers: 1, clearedClosings: 1 })
    const vs = (db.prepare('SELECT id FROM vouchers ORDER BY id').all() as any[]).map(x => x.id)
    expect(vs).toEqual(['vg1'])
    const bal = db.prepare("SELECT current_debit FROM account_balances WHERE account_id='a1002'").get() as any
    expect(bal.current_debit).toBe(100)
    for (const t of ['cashier_journal', 'cashier_init_balance', 'cashier_period_closing', 'cashier_gl_match']) {
      expect((db.prepare(`SELECT COUNT(*) n FROM ${t}`).get() as any).n).toBe(0)
    }
  })

  it('已记账出纳凭证所在总账期间已结账：预览给出阻断项，执行拒绝且不改任何数据', () => {
    db.prepare("INSERT INTO period_closing VALUES ('pc', ?, 2026, 9, 'closed')").run(AS)
    expect(getCashierResetImpact(db, AS).blockedGlPeriods).toEqual(['2026年9期'])
    expect(() => performCashierReset(db, AS)).toThrow('已结账')
    expect((db.prepare("SELECT COUNT(*) n FROM vouchers WHERE source='cashier'").get() as any).n).toBe(2)
    expect((db.prepare('SELECT COUNT(*) n FROM cashier_journal').get() as any).n).toBe(2)
  })
})
