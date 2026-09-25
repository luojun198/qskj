import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { buildLedgerDetailQuery, buildLedgerGeneralQuery } from '../services/ledgerQuery.js'
import { resolveOpeningBaseYear } from '../services/initBalanceScope.js'

/**
 * FIX-153 / P1-账簿-6：跨年区间且结束年度未年结（init_balances 无该年行）时，
 * 期末余额必须链式上溯到最近有期初行的年度，不能丢掉整个上年。
 */
const SET = 'set1'

function setup() {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE accounts (
      id TEXT PRIMARY KEY, account_set_id TEXT, code TEXT, name TEXT, direction TEXT,
      level INTEGER DEFAULT 1, parent_id TEXT, is_enabled INTEGER DEFAULT 1,
      is_foreign INTEGER DEFAULT 0, currency_code TEXT
    );
    CREATE TABLE init_balances (
      id TEXT PRIMARY KEY, account_set_id TEXT, account_id TEXT, year INTEGER, period INTEGER,
      init_balance REAL, init_debit REAL DEFAULT 0, init_credit REAL DEFAULT 0, aux_item_id TEXT
    );
    CREATE TABLE vouchers (id TEXT PRIMARY KEY, account_set_id TEXT, voucher_date TEXT, year INTEGER, period INTEGER, status TEXT);
    CREATE TABLE voucher_entries (
      id TEXT PRIMARY KEY, account_set_id TEXT, voucher_id TEXT, account_id TEXT,
      account_code TEXT, account_name TEXT, direction TEXT, amount REAL
    );
  `)
  db.prepare(`INSERT INTO accounts (id, account_set_id, code, name, direction) VALUES ('a-1001', ?, '1001', '库存现金', 'debit')`).run(SET)
  // 2025 期初 100；2025-03 借 300 贷 50；2025-12-10 借 40；2026-01-05 借 20；2026 无期初行（上年未年结）
  db.prepare(`INSERT INTO init_balances VALUES ('ib', ?, 'a-1001', 2025, 1, 100, 100, 0, NULL)`).run(SET)
  const v = db.prepare(`INSERT INTO vouchers VALUES (?, ?, ?, ?, ?, 'posted')`)
  const e = db.prepare(`INSERT INTO voucher_entries VALUES (?, ?, ?, 'a-1001', '1001', '库存现金', ?, ?)`)
  v.run('v1', SET, '2025-03-10', 2025, 3); e.run('e1', SET, 'v1', 'debit', 300); e.run('e2', SET, 'v1', 'credit', 50)
  v.run('v2', SET, '2025-12-10', 2025, 12); e.run('e3', SET, 'v2', 'debit', 40)
  v.run('v3', SET, '2026-01-05', 2026, 1); e.run('e4', SET, 'v3', 'debit', 20)
  return db
}

describe('FIX-153 期初链式上溯', () => {
  it('resolveOpeningBaseYear：2026 无期初行 → 回到 2025', () => {
    const db = setup()
    expect(resolveOpeningBaseYear(db, SET, 2026)).toBe(2025)
    expect(resolveOpeningBaseYear(db, SET, 2025)).toBe(2025)
  })

  it('12 月跨年查询 [2025-12-01, 2026-01-31]：期末 = 100 + 250 + 40 + 20 = 410（旧口径只剩 20）', () => {
    const db = setup()
    const run = (withResolver: boolean) => {
      const q = buildLedgerGeneralQuery({
        accountSetId: SET,
        startDate: '2025-12-01',
        endDate: '2026-01-31',
        preBookEnabled: false,
        ...(withResolver ? { resolveOpeningBaseYear: (y: number) => resolveOpeningBaseYear(db, SET, y) } : {}),
      })
      expect((q.sql.match(/\?/g) || []).length).toBe(q.params.length)
      return db.prepare(q.sql).get(...q.params) as any
    }
    const fixed = run(true)
    expect(fixed.init_balance).toBeCloseTo(350, 2) // 100 + 300 - 50（12-01 前）
    expect(fixed.current_debit).toBeCloseTo(60, 2)
    expect(fixed.end_balance).toBeCloseTo(410, 2)
    // 「期初 + 本期 = 期末」勾稽
    expect(fixed.init_balance + fixed.current_debit - fixed.current_credit).toBeCloseTo(fixed.end_balance, 2)

    const legacy = run(false)
    expect(legacy.end_balance).toBeCloseTo(20, 2)
  })

  it('评审 P1-8：明细账期初同样链式上溯——2026-01 期初 = 100 + 250 + 40 = 390（旧口径 0）', () => {
    const db = setup()
    const run = (withResolver: boolean) => {
      const q = buildLedgerDetailQuery({
        accountSetId: SET,
        accountId: 'a-1001',
        startDate: '2026-01-01',
        endDate: '2026-01-31',
        page: 1,
        pageSize: 100,
        preBookEnabled: false,
        ...(withResolver ? { resolveOpeningBaseYear: (y: number) => resolveOpeningBaseYear(db, SET, y) } : {}),
      })
      expect((q.initBalanceSql.match(/\?/g) || []).length).toBe(q.initBalanceParams.length)
      return (db.prepare(q.initBalanceSql).get(...q.initBalanceParams) as any).init_balance
    }
    expect(run(true)).toBeCloseTo(390, 2)
    expect(run(false)).toBeCloseTo(0, 2)
  })

  it('评审 P1-8：年内查询不受影响——2025-12 期初 = 100 + 250 = 350', () => {
    const db = setup()
    const q = buildLedgerDetailQuery({
      accountSetId: SET, accountId: 'a-1001', startDate: '2025-12-01', endDate: '2025-12-31',
      page: 1, pageSize: 100, preBookEnabled: false,
      resolveOpeningBaseYear: (y: number) => resolveOpeningBaseYear(db, SET, y),
    })
    expect((db.prepare(q.initBalanceSql).get(...q.initBalanceParams) as any).init_balance).toBeCloseTo(350, 2)
  })
})
