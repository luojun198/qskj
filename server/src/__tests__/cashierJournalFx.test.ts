/**
 * FIX-260：出纳日记账外币（币种跟科目走、原币 + 汇率 + 本位币金额）
 *
 *  - 迁移 144：加列并按汇率 1 回填存量
 *  - 币种解析：外币科目 → 科目币种；本位币科目 / 科目不存在 → 本位币（lookup 返回 null）
 *  - 默认汇率：本位币恒 1；外币走 exchange_rates → 期末汇率 → 默认汇率
 *  - 币种列表并入币种主数据
 *  - listJournal：未传币种按科目解析，返回本位币合计
 *  - 生成凭证：外币行金额 = 本位币，现金分录带三字段，非外币对方科目三字段为空；对方外币科目币种不一致拦截
 *  - 凭证同步：外币分录按原币写日记账（foreign_amount / 汇率 / 本位币）
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import Database from 'better-sqlite3'

let testDb: Database.Database
vi.mock('../db/index.js', () => ({
  getDb: () => testDb,
}))

import { up as cashierJournalFxUp } from '../db/migrations/20260921_cashier_journal_fx.js'
import {
  getCashierAccountCurrency,
  lookupCashierAccountCurrency,
  resolveCashierRate,
  computeBaseAmounts,
  listCashierCurrencies,
  listCashierAccounts,
  listJournal,
  generateCashierVoucher,
  syncCashierFromVoucher,
} from '../services/cashierQuery.js'

const AS = 'as-fx'

function makeDb() {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE accounts (
      id TEXT PRIMARY KEY, account_set_id TEXT, code TEXT, name TEXT, direction TEXT, parent_id TEXT,
      is_cash INTEGER DEFAULT 0, is_bank INTEGER DEFAULT 0, is_enabled INTEGER DEFAULT 1,
      is_foreign INTEGER DEFAULT 0, currency_code TEXT
    );
    CREATE TABLE currencies (
      id TEXT PRIMARY KEY, account_set_id TEXT, code TEXT, name TEXT, is_base INTEGER DEFAULT 0,
      default_rate REAL DEFAULT 1, begin_rate REAL, end_rate REAL, rate_decimals INTEGER DEFAULT 4,
      is_enabled INTEGER DEFAULT 1, sort_order INTEGER DEFAULT 0
    );
    CREATE TABLE exchange_rates (
      id TEXT PRIMARY KEY, account_set_id TEXT, currency_code TEXT, year INTEGER, period INTEGER, rate REAL, closing_rate REAL
    );
    CREATE TABLE cashier_journal (
      id TEXT PRIMARY KEY, account_set_id TEXT, account_code TEXT, currency TEXT DEFAULT 'RMB',
      biz_date TEXT, seq INTEGER DEFAULT 0, summary TEXT, debit REAL DEFAULT 0, credit REAL DEFAULT 0,
      settle_type TEXT, bill_no TEXT, counter_unit TEXT, counter_account TEXT,
      bank_name TEXT, bank_account TEXT, unit_code TEXT, reconciled INTEGER DEFAULT 0,
      match_batch TEXT, voucher_year INTEGER, voucher_month INTEGER, voucher_type TEXT, voucher_no TEXT,
      counter_aux_item_id TEXT, created_by TEXT, bank_statement_id TEXT, voucher_id TEXT,
      created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE cashier_init_balance (id TEXT PRIMARY KEY, account_set_id TEXT, account_code TEXT, currency TEXT, balance REAL, init_date TEXT, bank_balance REAL);
    CREATE TABLE bank_statement (
      id TEXT PRIMARY KEY, account_set_id TEXT, account_code TEXT, biz_date TEXT,
      debit REAL DEFAULT 0, credit REAL DEFAULT 0, settle_type TEXT, bill_no TEXT, matched INTEGER DEFAULT 0, match_batch INTEGER
    );
    CREATE TABLE voucher_types (id TEXT PRIMARY KEY, account_set_id TEXT, name TEXT, code TEXT, sort_order INTEGER DEFAULT 0);
    CREATE TABLE vouchers (
      id TEXT PRIMARY KEY, account_set_id TEXT, voucher_no TEXT, voucher_type_id TEXT,
      voucher_date TEXT, year INTEGER, period INTEGER, total_amount REAL,
      maker_name TEXT, remark TEXT, source TEXT, status TEXT DEFAULT 'draft'
    );
    CREATE TABLE voucher_entries (
      id TEXT PRIMARY KEY, account_set_id TEXT, voucher_id TEXT, seq INTEGER,
      account_id TEXT, account_code TEXT, account_name TEXT, direction TEXT,
      amount REAL, amount_cents INTEGER, summary TEXT,
      dept_id TEXT, dept_name TEXT, project_id TEXT, project_name TEXT,
      supplier_id TEXT, supplier_name TEXT, person_id TEXT, person_name TEXT,
      func_class_id TEXT, func_class_name TEXT, aux_data TEXT,
      currency_code TEXT, exchange_rate REAL, foreign_amount REAL
    );
    CREATE TABLE system_params (id TEXT PRIMARY KEY, account_set_id TEXT, param_key TEXT, param_value TEXT);
    CREATE TABLE aux_categories (id TEXT PRIMARY KEY, account_set_id TEXT, code TEXT, name TEXT);
    CREATE TABLE aux_items (id TEXT PRIMARY KEY, account_set_id TEXT, name TEXT);
  `)
  // 存量行（迁移前无 fx 列）：回填后 base_* = 原币
  db.prepare("INSERT INTO cashier_journal (id, account_set_id, account_code, currency, biz_date, debit, credit) VALUES ('legacy', ?, '1001', 'RMB', '2026-08-01', 100, 0)").run(AS)
  cashierJournalFxUp(db)

  const acc = db.prepare('INSERT INTO accounts (id, account_set_id, code, name, direction, is_cash, is_bank, is_foreign, currency_code) VALUES (?,?,?,?,?,?,?,?,?)')
  acc.run('a1001', AS, '1001', '库存现金', 'debit', 1, 0, 0, null)
  acc.run('a1002001', AS, '1002001', '美元户', 'debit', 0, 1, 1, 'USD')
  acc.run('a1122', AS, '1122', '应收账款', 'debit', 0, 0, 0, null)
  acc.run('a1122usd', AS, '1122002', '应收账款-美元', 'debit', 0, 0, 1, 'USD')
  acc.run('a1122eur', AS, '1122003', '应收账款-欧元', 'debit', 0, 0, 1, 'EUR')
  db.prepare("INSERT INTO currencies (id, account_set_id, code, name, is_base, default_rate, end_rate) VALUES ('c-rmb', ?, 'RMB', '人民币', 1, 1, NULL)").run(AS)
  db.prepare("INSERT INTO currencies (id, account_set_id, code, name, is_base, default_rate, end_rate) VALUES ('c-usd', ?, 'USD', '美元', 0, 7, 7.1)").run(AS)
  db.prepare("INSERT INTO currencies (id, account_set_id, code, name, is_base, default_rate, end_rate, is_enabled) VALUES ('c-jpy', ?, 'JPY', '日元', 0, 0.05, NULL, 0)").run(AS)
  db.prepare("INSERT INTO exchange_rates (id, account_set_id, currency_code, year, period, rate) VALUES ('r1', ?, 'USD', 2026, 9, 7.2)").run(AS)
  db.prepare("INSERT INTO voucher_types (id, account_set_id, name, code, sort_order) VALUES ('vt1', ?, '记账凭证', '1', 1)").run(AS)
  return db
}

const addJ = (db: Database.Database, row: { id: string; code: string; currency: string; date: string; debit?: number; credit?: number; rate?: number; counter?: string | null }) => {
  const rate = row.rate ?? 1
  const d = row.debit ?? 0
  const c = row.credit ?? 0
  db.prepare(
    `INSERT INTO cashier_journal (id, account_set_id, account_code, currency, biz_date, seq, summary, debit, credit, exchange_rate, base_debit, base_credit, counter_account)
     VALUES (?, ?, ?, ?, ?, 1, '测试', ?, ?, ?, ?, ?, ?)`
  ).run(row.id, AS, row.code, row.currency, row.date, d, c, rate, Math.round(d * rate * 100) / 100, Math.round(c * rate * 100) / 100, row.counter ?? null)
}

describe('FIX-260：出纳日记账外币', () => {
  let db: Database.Database
  beforeEach(() => {
    db = makeDb()
    testDb = db
  })

  it('迁移 144：加列并按汇率 1 回填存量本位币行', () => {
    const cols = (db.prepare('PRAGMA table_info(cashier_journal)').all() as Array<{ name: string }>).map(c => c.name)
    expect(cols).toEqual(expect.arrayContaining(['exchange_rate', 'base_debit', 'base_credit']))
    const legacy = db.prepare('SELECT exchange_rate, base_debit, base_credit FROM cashier_journal WHERE id=?').get('legacy') as any
    expect(legacy).toEqual({ exchange_rate: 1, base_debit: 100, base_credit: 0 })
    // 幂等
    expect(() => cashierJournalFxUp(db)).not.toThrow()
  })

  it('币种跟科目走：外币科目 → 科目币种；本位币科目 → 本位币；科目不存在 → lookup 为 null', () => {
    expect(getCashierAccountCurrency(db, AS, '1002001')).toBe('USD')
    expect(getCashierAccountCurrency(db, AS, '1001')).toBe('RMB')
    expect(getCashierAccountCurrency(db, AS, '9999')).toBe('RMB')
    expect(lookupCashierAccountCurrency(db, AS, '9999')).toBeNull()
    expect(lookupCashierAccountCurrency(db, AS, '1001')).toBe('RMB')
    const list = listCashierAccounts(AS)
    expect(list.find(a => a.code === '1002001')).toMatchObject({ is_foreign: 1, currency_code: 'USD' })
    expect(list.find(a => a.code === '1001')).toMatchObject({ is_foreign: 0 })
  })

  it('默认汇率：本位币恒 1；外币按业务日期所在期间 → 期末汇率 → 默认汇率', () => {
    expect(resolveCashierRate(db, AS, 'RMB', '2026-09-10')).toBe(1)
    expect(resolveCashierRate(db, AS, 'USD', '2026-09-10')).toBe(7.2)
    // 10 月无期间汇率 → 期末汇率 7.1
    expect(resolveCashierRate(db, AS, 'USD', '2026-10-01')).toBe(7.1)
    expect(computeBaseAmounts(100, 0, 7.25)).toEqual({ base_debit: 725, base_credit: 0 })
    expect(computeBaseAmounts(0, 33.33, 7.2)).toEqual({ base_debit: 0, base_credit: 239.98 })
  })

  it('币种列表并入启用的币种主数据（本位币在前，停用币种不列）', () => {
    expect(listCashierCurrencies(AS)).toEqual(['RMB', 'USD'])
  })

  it('listJournal：未传币种按科目解析，返回原币余额与本位币合计', () => {
    db.prepare("INSERT INTO cashier_init_balance (id, account_set_id, account_code, currency, balance, init_date) VALUES ('ib', ?, '1002001', 'USD', 1000, '2026-01-01')").run(AS)
    addJ(db, { id: 'u1', code: '1002001', currency: 'USD', date: '2026-09-02', debit: 100, rate: 7.2 })
    addJ(db, { id: 'u2', code: '1002001', currency: 'USD', date: '2026-09-05', credit: 40, rate: 7.3 })
    const r = listJournal({ accountSetId: AS, accountCode: '1002001', startDate: '2026-09-01', endDate: '2026-09-30' })
    expect(r.currency).toBe('USD')
    expect(r.opening).toBe(1000)
    expect(r.closing).toBe(1060)
    expect(r.totalBaseDebit).toBe(720)
    expect(r.totalBaseCredit).toBe(292)
    expect(r.rows.map(x => x.balance)).toEqual([1100, 1060])
    // 本位币科目：本位币合计 = 原币合计
    const b = listJournal({ accountSetId: AS, accountCode: '1001' })
    expect(b.currency).toBe('RMB')
    expect(b.totalBaseDebit).toBe(b.totalDebit)
    // 出纳与总账对账表的外币口径见 cashierGlReconcile.test.ts（FIX-262）
  })

  it('生成凭证：外币行金额 = 本位币，现金分录带三字段，非外币对方科目三字段为空', () => {
    addJ(db, { id: 'u1', code: '1002001', currency: 'USD', date: '2026-09-02', debit: 100, rate: 7.2, counter: '1122' })
    addJ(db, { id: 'u2', code: '1002001', currency: 'USD', date: '2026-09-05', credit: 40, rate: 7.3, counter: '1122002' })
    const res = generateCashierVoucher({ db, accountSetId: AS, accountCode: '1002001', makerName: 't', ids: ['u1', 'u2'] })
    expect('error' in res).toBe(false)
    const ok = res as Exclude<typeof res, { error: string }>
    expect(ok.details.map(d => [d.amount, d.currency, d.exchangeRate, d.foreignAmount])).toEqual([
      [720, 'USD', 7.2, 100],
      [292, 'USD', 7.3, 40],
    ])
    const e1 = db.prepare('SELECT account_code, direction, amount, currency_code, exchange_rate, foreign_amount FROM voucher_entries WHERE voucher_id=? ORDER BY seq').all(ok.voucherIds[0]) as any[]
    expect(e1).toEqual([
      { account_code: '1002001', direction: 'debit', amount: 720, currency_code: 'USD', exchange_rate: 7.2, foreign_amount: 100 },
      { account_code: '1122', direction: 'credit', amount: 720, currency_code: null, exchange_rate: null, foreign_amount: null },
    ])
    // 对方为同币种外币科目：同样带三字段
    const e2 = db.prepare('SELECT account_code, currency_code, foreign_amount FROM voucher_entries WHERE voucher_id=? ORDER BY seq').all(ok.voucherIds[1]) as any[]
    expect(e2).toEqual([
      { account_code: '1122002', currency_code: 'USD', foreign_amount: 40 },
      { account_code: '1002001', currency_code: 'USD', foreign_amount: 40 },
    ])
    const v = db.prepare('SELECT total_amount FROM vouchers WHERE id=?').get(ok.voucherIds[0]) as any
    expect(v.total_amount).toBe(720)
  })

  it('生成凭证：对方外币科目币种与出纳科目不一致 → 拦截', () => {
    addJ(db, { id: 'u1', code: '1002001', currency: 'USD', date: '2026-09-02', debit: 100, rate: 7.2, counter: '1122003' })
    const res = generateCashierVoucher({ db, accountSetId: AS, accountCode: '1002001', makerName: 't', ids: ['u1'] })
    expect(res).toMatchObject({ error: expect.stringMatching(/1122003.*EUR.*不一致/) })
  })

  it('凭证同步：外币分录按原币写日记账，本位币科目不受影响', () => {
    db.prepare("INSERT INTO system_params VALUES ('sp', ?, 'cashier:auto_sync', '1')").run(AS)
    const r = syncCashierFromVoucher({
      db, accountSetId: AS, voucherDate: '2026-09-12', voucherYear: 2026, voucherMonth: 9,
      voucherType: null, voucherNo: '记-1', voucherId: 'v1',
      entries: [
        { account_code: '1002001', direction: 'debit', amount: 730, currency_code: 'USD', exchange_rate: 7.3, foreign_amount: 100 },
        { account_code: '1001', direction: 'credit', amount: 730 },
      ],
    })
    expect(r.synced).toBe(2)
    const usd = db.prepare("SELECT currency, debit, credit, exchange_rate, base_debit FROM cashier_journal WHERE account_code='1002001' AND voucher_id='v1'").get() as any
    expect(usd).toEqual({ currency: 'USD', debit: 100, credit: 0, exchange_rate: 7.3, base_debit: 730 })
    const rmb = db.prepare("SELECT currency, credit, exchange_rate, base_credit FROM cashier_journal WHERE account_code='1001' AND voucher_id='v1'").get() as any
    expect(rmb).toEqual({ currency: 'RMB', credit: 730, exchange_rate: 1, base_credit: 730 })
    // 分录未带原币 → 按汇率倒算；再次同步走 update 路径
    syncCashierFromVoucher({
      db, accountSetId: AS, voucherDate: '2026-09-12', voucherYear: 2026, voucherMonth: 9,
      voucherType: null, voucherNo: '记-1', voucherId: 'v1',
      entries: [{ account_code: '1002001', direction: 'debit', amount: 1440, exchange_rate: 7.2 }],
    })
    const usd2 = db.prepare("SELECT debit, exchange_rate, base_debit FROM cashier_journal WHERE account_code='1002001' AND voucher_id='v1'").get() as any
    expect(usd2).toEqual({ debit: 200, exchange_rate: 7.2, base_debit: 1440 })
    expect((db.prepare("SELECT COUNT(*) c FROM cashier_journal WHERE voucher_id='v1'").get() as any).c).toBe(2)
  })
})
