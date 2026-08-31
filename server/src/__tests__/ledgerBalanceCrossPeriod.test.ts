import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { buildLedgerBalanceQuery } from '../services/ledgerQuery.js'

/**
 * FIX-006 / P0-2+P0-3 回归测试：余额表期末余额跨期累计正确。
 *
 * 场景：
 *   - 2026 年初余额 1000（借方科目 1001）
 *   - 1 月发生 借 100 贷 0 → 1 月末应为 1100
 *   - 2 月发生 借 50 贷 30 → 2 月末应为 1100 + 20 = 1120
 *   - 3 月发生 借 0 贷 200 → 3 月末应为 1120 - 200 = 920
 *
 * 旧 BUG（applyVoucherPosting 写入的 end_balance 行 = 年初 + 本期净额）：
 *   - account_balances.year=2026 period=1 end_balance = 1000 + 100 = 1100 ✓
 *   - account_balances.year=2026 period=2 end_balance = 1000 + 20 = 1020 ❌（应为 1120）
 *   - account_balances.year=2026 period=3 end_balance = 1000 - 200 = 800 ❌（应为 920）
 *
 * 新 SQL 不再依赖存储的 end_balance，改为 init + SUM(period<=N) 动态计算。
 */

function setup() {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE accounts (
      id TEXT PRIMARY KEY,
      account_set_id TEXT,
      code TEXT,
      name TEXT,
      direction TEXT,
      level INTEGER DEFAULT 1,
      is_enabled INTEGER DEFAULT 1
    );
    CREATE TABLE init_balances (
      id TEXT PRIMARY KEY,
      account_set_id TEXT,
      account_id TEXT,
      year INTEGER,
      period INTEGER,
      init_balance REAL,
      aux_item_id TEXT DEFAULT ''
    );
    CREATE TABLE account_balances (
      id TEXT PRIMARY KEY,
      account_set_id TEXT,
      account_id TEXT,
      year INTEGER,
      period INTEGER,
      direction TEXT,
      init_balance REAL DEFAULT 0,
      current_debit REAL DEFAULT 0,
      current_credit REAL DEFAULT 0,
      end_balance REAL DEFAULT 0,
      aux_item_id TEXT DEFAULT ''
    );
  `)

  const setId = 'set1'
  const accId = 'acc-1001'

  db.prepare(
    `INSERT INTO accounts VALUES (?, ?, '1001', '库存现金', 'debit', 1, 1)`
  ).run(accId, setId)

  // 2026 年初 1000
  db.prepare(
    `INSERT INTO init_balances VALUES ('ib', ?, ?, 2026, 1, 1000, '')`
  ).run(setId, accId)

  // account_balances：模拟过账写入，end_balance 字段故意写错（旧 BUG 数据）
  // period=1: 借 100，贷 0
  db.prepare(
    `INSERT INTO account_balances VALUES ('ab1', ?, ?, 2026, 1, 'debit', 1000, 100, 0, 1100, '')`
  ).run(setId, accId)
  // period=2: 借 50，贷 30 → 真期末应 1120；旧 BUG 写入 1020
  db.prepare(
    `INSERT INTO account_balances VALUES ('ab2', ?, ?, 2026, 2, 'debit', 1000, 50, 30, 1020, '')`
  ).run(setId, accId)
  // period=3: 借 0，贷 200 → 真期末应 920；旧 BUG 写入 800
  db.prepare(
    `INSERT INTO account_balances VALUES ('ab3', ?, ?, 2026, 3, 'debit', 1000, 0, 200, 800, '')`
  ).run(setId, accId)

  return { db, setId }
}

function fetchPeriod(db: Database.Database, setId: string, p: number) {
  const q = buildLedgerBalanceQuery({ accountSetId: setId, year: 2026, period: p })
  const rows = db.prepare(q.sql).all(...q.params) as any[]
  return rows.find(r => r.account_code === '1001')
}

describe('余额表跨期累计期末余额（FIX-006 / P0-2+P0-3）', () => {
  it('占位符与参数数量匹配', () => {
    const q = buildLedgerBalanceQuery({ accountSetId: 'as', year: 2026, period: 5 })
    const placeholders = (q.sql.match(/\?/g) || []).length
    expect(q.params.length).toBe(placeholders)
  })

  it('period=1：期初 1000，本期借 100 贷 0，期末 1100', () => {
    const { db, setId } = setup()
    const row = fetchPeriod(db, setId, 1)!
    expect(row.init_balance).toBe(1000)
    expect(row.current_debit).toBe(100)
    expect(row.current_credit).toBe(0)
    expect(row.end_balance).toBe(1100)
  })

  it('period=2：本期借 50 贷 30，期末应为 1120（不应是旧 BUG 的 1020）', () => {
    const { db, setId } = setup()
    const row = fetchPeriod(db, setId, 2)!
    // 本期发生额只看 period=2
    expect(row.current_debit).toBe(50)
    expect(row.current_credit).toBe(30)
    // 期末 = 1000 + (100+50) - (0+30) = 1120
    expect(row.end_balance).toBe(1120)
    // 关键回归：决不允许等于旧 BUG 的 1020
    expect(row.end_balance).not.toBe(1020)
  })

  it('period=3：本期借 0 贷 200，期末应为 920（不应是旧 BUG 的 800）', () => {
    const { db, setId } = setup()
    const row = fetchPeriod(db, setId, 3)!
    expect(row.current_debit).toBe(0)
    expect(row.current_credit).toBe(200)
    // 期末 = 1000 + (100+50+0) - (0+30+200) = 920
    expect(row.end_balance).toBe(920)
    expect(row.end_balance).not.toBe(800)
  })

  it('贷方科目方向：负债类期末按 credit-debit 计算', () => {
    const db = new Database(':memory:')
    db.exec(`
      CREATE TABLE accounts (id TEXT PRIMARY KEY, account_set_id TEXT, code TEXT, name TEXT, direction TEXT, level INTEGER DEFAULT 1, is_enabled INTEGER DEFAULT 1);
      CREATE TABLE init_balances (id TEXT PRIMARY KEY, account_set_id TEXT, account_id TEXT, year INTEGER, period INTEGER, init_balance REAL, aux_item_id TEXT DEFAULT '');
      CREATE TABLE account_balances (id TEXT PRIMARY KEY, account_set_id TEXT, account_id TEXT, year INTEGER, period INTEGER, direction TEXT, init_balance REAL DEFAULT 0, current_debit REAL DEFAULT 0, current_credit REAL DEFAULT 0, end_balance REAL DEFAULT 0, aux_item_id TEXT DEFAULT '');
    `)
    db.prepare(`INSERT INTO accounts VALUES ('p', 'as', '2001', '应付账款', 'credit', 1, 1)`).run()
    // 年初贷方 500
    db.prepare(`INSERT INTO init_balances VALUES ('ib', 'as', 'p', 2026, 1, 500, '')`).run()
    // period=1: 贷 300（增加），借 0
    db.prepare(
      `INSERT INTO account_balances VALUES ('ab1', 'as', 'p', 2026, 1, 'credit', 500, 0, 300, 9999, '')`
    ).run()
    // period=2: 借 200（偿还），贷 0
    db.prepare(
      `INSERT INTO account_balances VALUES ('ab2', 'as', 'p', 2026, 2, 'credit', 500, 200, 0, 9999, '')`
    ).run()

    const q = buildLedgerBalanceQuery({ accountSetId: 'as', year: 2026, period: 2 })
    const row = (db.prepare(q.sql).all(...q.params) as any[]).find(r => r.account_code === '2001')!
    // 贷方科目：期末 = 期初 + 累计贷 - 累计借 = 500 + 300 - 200 = 600
    expect(row.end_balance).toBe(600)
    expect(row.direction).toBe('credit')
  })

  it('无 init_balances 行（年初为 0）也能正常计算', () => {
    const db = new Database(':memory:')
    db.exec(`
      CREATE TABLE accounts (id TEXT PRIMARY KEY, account_set_id TEXT, code TEXT, name TEXT, direction TEXT, level INTEGER DEFAULT 1, is_enabled INTEGER DEFAULT 1);
      CREATE TABLE init_balances (id TEXT PRIMARY KEY, account_set_id TEXT, account_id TEXT, year INTEGER, period INTEGER, init_balance REAL, aux_item_id TEXT DEFAULT '');
      CREATE TABLE account_balances (id TEXT PRIMARY KEY, account_set_id TEXT, account_id TEXT, year INTEGER, period INTEGER, direction TEXT, init_balance REAL DEFAULT 0, current_debit REAL DEFAULT 0, current_credit REAL DEFAULT 0, end_balance REAL DEFAULT 0, aux_item_id TEXT DEFAULT '');
    `)
    db.prepare(`INSERT INTO accounts VALUES ('a', 'as', '1001', 'X', 'debit', 1, 1)`).run()
    db.prepare(
      `INSERT INTO account_balances VALUES ('ab1', 'as', 'a', 2026, 1, 'debit', 0, 100, 0, 100, '')`
    ).run()
    db.prepare(
      `INSERT INTO account_balances VALUES ('ab2', 'as', 'a', 2026, 2, 'debit', 0, 0, 30, 70, '')`
    ).run()
    const q = buildLedgerBalanceQuery({ accountSetId: 'as', year: 2026, period: 2 })
    const row = (db.prepare(q.sql).all(...q.params) as any[]).find(r => r.account_code === '1001')!
    expect(row.init_balance).toBe(0)
    expect(row.end_balance).toBe(70) // 0 + 100 - 30
  })
})
