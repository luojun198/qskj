import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import Database from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'

let testDb: Database.Database

vi.mock('../db/index.js', () => ({
  getDb: () => testDb,
}))

import {
  createCurrency,
  updateCurrency,
  resolveExchangeRate,
  upsertExchangeRate,
  getCurrencies,
  getCurrencySettings,
  saveCurrencySettings,
  upsertCurrencyRow,
} from '../services/currencyService.js'
import {
  buildReversedEntries,
  buildVoucherEntryPayloads,
  VOUCHER_ENTRY_INSERT_PARAM_COUNT,
  resolveForeignCurrencyFields,
  validateVoucherEntriesForeignCurrency,
} from '../services/voucherEntry.js'
import { rebuildAccountBalances } from '../services/accountBalanceRebuild.js'
import { buildForeignBalanceQuery } from '../services/ledgerQuery.js'

function createFxDb() {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE account_sets (
      id TEXT PRIMARY KEY, name TEXT, code TEXT, fiscal_year INTEGER, start_date TEXT, status TEXT
    );
    CREATE TABLE system_params (
      id TEXT PRIMARY KEY, account_set_id TEXT, param_key TEXT, param_value TEXT, description TEXT
    );
    CREATE TABLE currencies (
      id TEXT PRIMARY KEY, account_set_id TEXT NOT NULL, code TEXT NOT NULL, name TEXT NOT NULL,
      is_base INTEGER NOT NULL DEFAULT 0, default_rate REAL NOT NULL DEFAULT 1,
      begin_rate REAL NOT NULL DEFAULT 1, end_rate REAL NOT NULL DEFAULT 1,
      rate_decimals INTEGER NOT NULL DEFAULT 4, is_enabled INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(account_set_id, code)
    );
    CREATE TABLE exchange_rates (
      id TEXT PRIMARY KEY, account_set_id TEXT NOT NULL, currency_code TEXT NOT NULL,
      year INTEGER NOT NULL, period INTEGER NOT NULL, rate REAL NOT NULL DEFAULT 1,
      closing_rate REAL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(account_set_id, currency_code, year, period)
    );
    CREATE TABLE accounts (
      id TEXT PRIMARY KEY, account_set_id TEXT, code TEXT, name TEXT, direction TEXT, level INTEGER,
      is_foreign INTEGER DEFAULT 0, currency_code TEXT, is_enabled INTEGER DEFAULT 1
    );
    CREATE TABLE vouchers (
      id TEXT PRIMARY KEY, account_set_id TEXT, voucher_no TEXT, voucher_date TEXT,
      year INTEGER, period INTEGER, status TEXT, total_amount REAL
    );
    CREATE TABLE voucher_entries (
      id TEXT PRIMARY KEY, account_set_id TEXT, voucher_id TEXT, seq INTEGER,
      account_id TEXT, account_code TEXT, account_name TEXT, direction TEXT, amount REAL,
      amount_cents INTEGER, currency_code TEXT, exchange_rate REAL, foreign_amount REAL,
      dept_id TEXT, project_id TEXT, supplier_id TEXT, person_id TEXT, func_class_id TEXT, aux_data TEXT
    );
    CREATE TABLE init_balances (
      id TEXT PRIMARY KEY, account_set_id TEXT, account_id TEXT, direction TEXT,
      year INTEGER, period INTEGER, init_balance REAL, init_debit REAL, init_credit REAL,
      aux_item_id TEXT NOT NULL DEFAULT '',
      foreign_init_balance REAL DEFAULT 0, foreign_opening_debit REAL DEFAULT 0,
      foreign_opening_credit REAL DEFAULT 0, foreign_pre_book_debit REAL DEFAULT 0,
      foreign_pre_book_credit REAL DEFAULT 0
    );
    CREATE TABLE account_balances (
      id TEXT PRIMARY KEY, account_set_id TEXT, account_id TEXT, account_code TEXT, account_name TEXT,
      direction TEXT, year INTEGER, period INTEGER, init_balance REAL,
      current_debit REAL, current_credit REAL, end_balance REAL, end_debit REAL, end_credit REAL,
      aux_item_id TEXT,
      foreign_init_balance REAL DEFAULT 0, foreign_current_debit REAL DEFAULT 0,
      foreign_current_credit REAL DEFAULT 0, foreign_end_balance REAL DEFAULT 0,
      UNIQUE(account_set_id, account_id, year, period, aux_item_id)
    );
  `)
  return db
}

describe('currencyService', () => {
  let accountSetId: string

  beforeEach(() => {
    testDb = createFxDb()
    accountSetId = uuidv4()
    testDb
      .prepare(
        `INSERT INTO account_sets (id, name, code, fiscal_year, start_date, status)
         VALUES (?, 'FX', 'FX', 2026, '2026-01-01', 'active')`
      )
      .run(accountSetId)
  })

  afterEach(() => {
    testDb.close()
  })

  it('resolveExchangeRate：本期 → 期末汇率 → 最近一期 → default_rate', () => {
    const usd = createCurrency({
      account_set_id: accountSetId,
      code: 'USD',
      name: '美元',
      default_rate: 6.5,
    })
    expect(resolveExchangeRate(accountSetId, 'USD', 2026, 3)).toBe(6.5)

    // 只维护了 1 月期间汇率：3 月仍以外币类型页的期末汇率为准，不被旧期间盖住
    upsertExchangeRate({
      account_set_id: accountSetId,
      currency_code: 'USD',
      year: 2026,
      period: 1,
      rate: 7.1,
    })
    expect(resolveExchangeRate(accountSetId, 'USD', 2026, 3)).toBe(6.5)
    expect(resolveExchangeRate(accountSetId, 'USD', 2026, 1)).toBe(7.1)

    // 期末汇率被清掉（历史库 end_rate=0 之类）时才回退到最近一期
    testDb.prepare(`UPDATE currencies SET end_rate = 0 WHERE id = ?`).run(usd.id)
    expect(resolveExchangeRate(accountSetId, 'USD', 2026, 3)).toBe(7.1)
    testDb.prepare(`UPDATE currencies SET end_rate = 6.5 WHERE id = ?`).run(usd.id)

    upsertExchangeRate({
      account_set_id: accountSetId,
      currency_code: 'USD',
      year: 2026,
      period: 3,
      rate: 7.2,
    })
    expect(resolveExchangeRate(accountSetId, 'USD', 2026, 3)).toBe(7.2)
  })

  it('年初/期末汇率：创建默认回填、期末汇率优先于 default_rate 兜底、更新校验', () => {
    const usd = createCurrency({
      account_set_id: accountSetId,
      code: 'USD',
      name: '美元',
      begin_rate: 7.0,
      end_rate: 7.2,
    })
    expect(usd.begin_rate).toBe(7.0)
    expect(usd.end_rate).toBe(7.2)
    // 未显式给 default_rate 时跟随期末汇率
    expect(usd.default_rate).toBe(7.2)

    // 没有期间汇率 → 回退到期末汇率，而不是 default_rate
    updateCurrency(usd.id, accountSetId, { default_rate: 6.0 })
    expect(resolveExchangeRate(accountSetId, 'USD', 2026, 5)).toBe(7.2)

    updateCurrency(usd.id, accountSetId, { end_rate: 7.3 })
    expect(resolveExchangeRate(accountSetId, 'USD', 2026, 5)).toBe(7.3)

    // 本期有期间汇率时以本期期间汇率为准
    upsertExchangeRate({ account_set_id: accountSetId, currency_code: 'USD', year: 2026, period: 5, rate: 7.5 })
    expect(resolveExchangeRate(accountSetId, 'USD', 2026, 5)).toBe(7.5)
    expect(resolveExchangeRate(accountSetId, 'USD', 2026, 6)).toBe(7.3)

    expect(() => updateCurrency(usd.id, accountSetId, { begin_rate: 0 })).toThrow('年初汇率')

    // 只给 default_rate 的老调用方式：年初/期末跟随 default_rate
    const hkd = createCurrency({ account_set_id: accountSetId, code: 'HKD', default_rate: 0.9 })
    expect(hkd.begin_rate).toBe(0.9)
    expect(hkd.end_rate).toBe(0.9)

    // 本位币恒为 1
    const rmb = createCurrency({ account_set_id: accountSetId, code: 'RMB', is_base: true, end_rate: 9 })
    expect(rmb.begin_rate).toBe(1)
    expect(rmb.end_rate).toBe(1)
  })

  it('汇兑损益科目设置：校验科目存在并可读回', () => {
    expect(getCurrencySettings(accountSetId).exchange_gain_account_code).toBeNull()
    expect(() => saveCurrencySettings(accountSetId, { exchange_gain_account_code: '6603' })).toThrow(
      '不存在'
    )
    testDb
      .prepare(
        `INSERT INTO accounts (id, account_set_id, code, name, direction, level)
         VALUES (?, ?, '660301', '汇兑损益', 'debit', 2)`
      )
      .run(uuidv4(), accountSetId)
    const saved = saveCurrencySettings(accountSetId, { exchange_gain_account_code: '660301' })
    expect(saved.exchange_gain_account_code).toBe('660301')
    expect(saved.exchange_gain_account_name).toBe('汇兑损益')
    // 幂等覆盖
    saveCurrencySettings(accountSetId, { exchange_gain_account_code: '' })
    expect(getCurrencySettings(accountSetId).exchange_gain_account_code).toBeNull()
  })

  it('upsertCurrencyRow 幂等', () => {
    upsertCurrencyRow({ account_set_id: accountSetId, code: 'HKD', name: '港币', default_rate: 0.9 })
    upsertCurrencyRow({ account_set_id: accountSetId, code: 'HKD', name: '港币', default_rate: 0.92 })
    const list = getCurrencies(accountSetId)
    expect(list.filter(c => c.code === 'HKD')).toHaveLength(1)
    expect(list.find(c => c.code === 'HKD')!.default_rate).toBe(0.92)
  })
})

describe('voucherEntry 外币', () => {
  it('payload 含 27 列且冲红取反原币', () => {
    const entries = [
      {
        account_id: 'a1',
        account_code: '1002',
        account_name: '银行存款-美元',
        direction: 'debit' as const,
        amount: 700,
        currency_code: 'USD',
        exchange_rate: 7,
        foreign_amount: 100,
      },
      {
        account_id: 'a2',
        account_code: '6001',
        account_name: '主营业务收入',
        direction: 'credit' as const,
        amount: 700,
      },
    ]
    const payloads = buildVoucherEntryPayloads({
      accountSetId: 'as1',
      voucherId: 'v1',
      entries,
      categories: [],
      itemMap: {},
    })
    expect(payloads[0]).toHaveLength(VOUCHER_ENTRY_INSERT_PARAM_COUNT)
    expect(VOUCHER_ENTRY_INSERT_PARAM_COUNT).toBe(30)
    expect(payloads[0][24]).toBe('USD')
    expect(payloads[0][25]).toBe(7)
    expect(payloads[0][26]).toBe(100)

    const reversed = buildReversedEntries(entries)
    expect(reversed[0].foreign_amount).toBe(-100)
    expect(reversed[0].amount).toBe(-700)
  })

  it('resolveForeignCurrencyFields 无原币时清空', () => {
    expect(
      resolveForeignCurrencyFields({
        account_id: 'a',
        account_code: '1',
        account_name: 'x',
        direction: 'debit',
        amount: 1,
        currency_code: 'USD',
        exchange_rate: 7,
        foreign_amount: 0,
      })
    ).toEqual({ currencyCode: null, exchangeRate: null, foreignAmount: null })
  })

  it('validateVoucherEntriesForeignCurrency 拦截缺原币', () => {
    testDb = createFxDb()
    const accountSetId = uuidv4()
    testDb
      .prepare(
        `INSERT INTO account_sets (id, name, code, fiscal_year, start_date, status)
         VALUES (?, 'FX', 'FX', 2026, '2026-01-01', 'active')`
      )
      .run(accountSetId)
    createCurrency({ account_set_id: accountSetId, code: 'USD', name: '美元', default_rate: 7 })
    testDb
      .prepare(
        `INSERT INTO system_params (id, account_set_id, param_key, param_value)
         VALUES (?, ?, 'enable_foreign_currency', 'true')`
      )
      .run(uuidv4(), accountSetId)
    const accountId = uuidv4()
    testDb
      .prepare(
        `INSERT INTO accounts (id, account_set_id, code, name, direction, level, is_foreign, currency_code)
         VALUES (?, ?, '1002001', '银行存款-美元', 'debit', 2, 1, 'USD')`
      )
      .run(accountId, accountSetId)

    const err = validateVoucherEntriesForeignCurrency(testDb as any, accountSetId, [
      {
        account_id: accountId,
        account_code: '1002001',
        account_name: '银行存款-美元',
        direction: 'debit',
        amount: 700,
      },
      {
        account_id: uuidv4(),
        account_code: '6001',
        account_name: '收入',
        direction: 'credit',
        amount: 700,
      },
    ])
    expect(err).toContain('原币')
    testDb.close()
  })

  it('科目缺省 USD 时，凭证可选账套内其他外币', () => {
    testDb = createFxDb()
    const accountSetId = uuidv4()
    testDb
      .prepare(
        `INSERT INTO account_sets (id, name, code, fiscal_year, start_date, status)
         VALUES (?, 'FX', 'FX', 2026, '2026-01-01', 'active')`
      )
      .run(accountSetId)
    createCurrency({ account_set_id: accountSetId, code: 'USD', name: '美元', default_rate: 7 })
    createCurrency({ account_set_id: accountSetId, code: 'HKD', name: '港币', default_rate: 0.9 })
    testDb
      .prepare(
        `INSERT INTO system_params (id, account_set_id, param_key, param_value)
         VALUES (?, ?, 'enable_foreign_currency', 'true')`
      )
      .run(uuidv4(), accountSetId)
    const accountId = uuidv4()
    testDb
      .prepare(
        `INSERT INTO accounts (id, account_set_id, code, name, direction, level, is_foreign, currency_code)
         VALUES (?, ?, '1002001', '银行存款-外币', 'debit', 2, 1, 'USD')`
      )
      .run(accountId, accountSetId)

    const err = validateVoucherEntriesForeignCurrency(testDb as any, accountSetId, [
      {
        account_id: accountId,
        account_code: '1002001',
        account_name: '银行存款-外币',
        direction: 'debit',
        amount: 90,
        currency_code: 'HKD',
        exchange_rate: 0.9,
        foreign_amount: 100,
      },
    ])
    expect(err).toBeNull()
    testDb.close()
  })

  it('凭证币种不在账套外币类型中时拒绝', () => {
    testDb = createFxDb()
    const accountSetId = uuidv4()
    testDb
      .prepare(
        `INSERT INTO account_sets (id, name, code, fiscal_year, start_date, status)
         VALUES (?, 'FX', 'FX', 2026, '2026-01-01', 'active')`
      )
      .run(accountSetId)
    createCurrency({ account_set_id: accountSetId, code: 'USD', name: '美元', default_rate: 7 })
    testDb
      .prepare(
        `INSERT INTO system_params (id, account_set_id, param_key, param_value)
         VALUES (?, ?, 'enable_foreign_currency', 'true')`
      )
      .run(uuidv4(), accountSetId)
    const accountId = uuidv4()
    testDb
      .prepare(
        `INSERT INTO accounts (id, account_set_id, code, name, direction, level, is_foreign, currency_code)
         VALUES (?, ?, '1002001', '银行存款-外币', 'debit', 2, 1, 'USD')`
      )
      .run(accountId, accountSetId)

    const err = validateVoucherEntriesForeignCurrency(testDb as any, accountSetId, [
      {
        account_id: accountId,
        account_code: '1002001',
        account_name: '银行存款-外币',
        direction: 'debit',
        amount: 700,
        currency_code: 'EUR',
        exchange_rate: 7,
        foreign_amount: 100,
      },
    ])
    expect(err).toMatch(/EUR/)
    testDb.close()
  })

  it('科目缺省币种为空时，凭证上选了外币即可保存', () => {
    testDb = createFxDb()
    const accountSetId = uuidv4()
    testDb
      .prepare(
        `INSERT INTO account_sets (id, name, code, fiscal_year, start_date, status)
         VALUES (?, 'FX', 'FX', 2026, '2026-01-01', 'active')`
      )
      .run(accountSetId)
    createCurrency({ account_set_id: accountSetId, code: 'USD', name: '美元', default_rate: 7 })
    createCurrency({ account_set_id: accountSetId, code: 'HKD', name: '港币', default_rate: 0.9 })
    testDb
      .prepare(
        `INSERT INTO system_params (id, account_set_id, param_key, param_value)
         VALUES (?, ?, 'enable_foreign_currency', 'true')`
      )
      .run(uuidv4(), accountSetId)
    const accountId = uuidv4()
    testDb
      .prepare(
        `INSERT INTO accounts (id, account_set_id, code, name, direction, level, is_foreign, currency_code)
         VALUES (?, ?, '1002001', '银行存款-外币', 'debit', 2, 1, NULL)`
      )
      .run(accountId, accountSetId)

    const ok = validateVoucherEntriesForeignCurrency(testDb as any, accountSetId, [
      {
        account_id: accountId,
        account_code: '1002001',
        account_name: '银行存款-外币',
        direction: 'debit',
        amount: 90,
        currency_code: 'HKD',
        exchange_rate: 0.9,
        foreign_amount: 100,
      },
    ])
    expect(ok).toBeNull()

    const missing = validateVoucherEntriesForeignCurrency(testDb as any, accountSetId, [
      {
        account_id: accountId,
        account_code: '1002001',
        account_name: '银行存款-外币',
        direction: 'debit',
        amount: 90,
        exchange_rate: 0.9,
        foreign_amount: 100,
      },
    ])
    expect(missing).toMatch(/请选择币种/)
    testDb.close()
  })
})

describe('accountBalanceRebuild + foreign balance query', () => {
  it('重建含 foreign_* 且外币余额表可读', () => {
    testDb = createFxDb()
    const accountSetId = uuidv4()
    testDb
      .prepare(
        `INSERT INTO account_sets (id, name, code, fiscal_year, start_date, status)
         VALUES (?, 'FX', 'FX', 2026, '2026-01-01', 'active')`
      )
      .run(accountSetId)
    createCurrency({ account_set_id: accountSetId, code: 'USD', name: '美元', default_rate: 7 })

    const usdAccount = uuidv4()
    const cnyAccount = uuidv4()
    testDb
      .prepare(
        `INSERT INTO accounts (id, account_set_id, code, name, direction, level, is_foreign, currency_code)
         VALUES (?, ?, '1002001', '银行存款-美元', 'debit', 2, 1, 'USD')`
      )
      .run(usdAccount, accountSetId)
    testDb
      .prepare(
        `INSERT INTO accounts (id, account_set_id, code, name, direction, level)
         VALUES (?, ?, '6001', '主营业务收入', 'credit', 1)`
      )
      .run(cnyAccount, accountSetId)

    testDb
      .prepare(
        `INSERT INTO init_balances (
           id, account_set_id, account_id, direction, year, period,
           init_balance, init_debit, init_credit, aux_item_id,
           foreign_init_balance, foreign_opening_debit
         ) VALUES (?, ?, ?, 'debit', 2026, 1, 700, 700, 0, '', 100, 100)`
      )
      .run(uuidv4(), accountSetId, usdAccount)

    const voucherId = uuidv4()
    testDb
      .prepare(
        `INSERT INTO vouchers (
           id, account_set_id, voucher_no, voucher_date, year, period, status, total_amount
         ) VALUES (?, ?, '记-1', '2026-01-15', 2026, 1, 'posted', 700)`
      )
      .run(voucherId, accountSetId)
    testDb
      .prepare(
        `INSERT INTO voucher_entries (
           id, account_set_id, voucher_id, seq, account_id, account_code, account_name,
           direction, amount, currency_code, exchange_rate, foreign_amount
         ) VALUES (?, ?, ?, 1, ?, '1002001', '银行存款-美元', 'debit', 700, 'USD', 7, 100)`
      )
      .run(uuidv4(), accountSetId, voucherId, usdAccount)
    testDb
      .prepare(
        `INSERT INTO voucher_entries (
           id, account_set_id, voucher_id, seq, account_id, account_code, account_name,
           direction, amount
         ) VALUES (?, ?, ?, 2, ?, '6001', '主营业务收入', 'credit', 700)`
      )
      .run(uuidv4(), accountSetId, voucherId, cnyAccount)

    const { rows } = rebuildAccountBalances(testDb, accountSetId)
    expect(rows).toBeGreaterThan(0)

    const bal = testDb
      .prepare(
        `SELECT foreign_init_balance, foreign_current_debit, foreign_end_balance
         FROM account_balances WHERE account_id = ? AND period = 1`
      )
      .get(usdAccount) as any
    expect(Number(bal.foreign_init_balance)).toBe(100)
    expect(Number(bal.foreign_current_debit)).toBe(100)
    expect(Number(bal.foreign_end_balance)).toBe(200)

    const q = buildForeignBalanceQuery({ accountSetId, year: 2026, period: 1 })
    const list = testDb.prepare(q.sql).all(...q.params) as any[]
    expect(list.some(r => r.account_code === '1002001')).toBe(true)

    testDb.close()
  })
})
