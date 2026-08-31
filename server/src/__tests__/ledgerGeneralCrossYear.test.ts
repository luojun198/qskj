import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { buildLedgerGeneralQuery } from '../services/ledgerQuery.js'

/**
 * FIX-002 / P0-4 回归测试：总账查询跨年时不能重复计算上年发生额。
 *
 * 场景：
 *   - 账套启用 2026
 *   - 2026 年初余额 = 1000（借方科目，比如 1001 库存现金）
 *   - 2026 年发生：借 500，贷 200 → 2026 末 = 1300
 *   - 年结后，2027 年初余额 = 1300（系统结转写入 init_balances year=2027）
 *   - 2027 年发生：借 100 → 2027 末 = 1400
 *
 * 总账查询：
 *   1) 同年查询 [2026-01-01, 2026-12-31]：期初=1000, 期末=1300
 *   2) 同年查询 [2027-01-01, 2027-06-30]：期初=1300, 期末=1400
 *   3) 跨年查询 [2026-12-01, 2027-06-30]：期初=1300（2026-11-30 时点），期末=1400
 *
 * 旧 BUG 表现：跨年查询时
 *   init_balance = 2027 年初(1300) + 2026 年 (-前11月) 凭证 → 重复加了
 *   end_balance  = 2027 年初(1300) + 所有 voucher_date<=endDate 凭证 → 也重复加了
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
      init_debit REAL DEFAULT 0,
      init_credit REAL DEFAULT 0,
      aux_item_id TEXT
    );
    CREATE TABLE vouchers (
      id TEXT PRIMARY KEY,
      account_set_id TEXT,
      voucher_date TEXT,
      year INTEGER,
      period INTEGER,
      status TEXT
    );
    CREATE TABLE voucher_entries (
      id TEXT PRIMARY KEY,
      account_set_id TEXT,
      voucher_id TEXT,
      account_id TEXT,
      account_code TEXT,
      account_name TEXT,
      direction TEXT,
      amount REAL
    );
  `)

  const setId = 'set1'
  const accId = 'acc-1001'

  db.prepare(
    `INSERT INTO accounts VALUES (?, ?, '1001', '库存现金', 'debit', 1, 1)`
  ).run(accId, setId)

  // 2026 年初 1000
  db.prepare(
    `INSERT INTO init_balances VALUES ('ib2026', ?, ?, 2026, 1, 1000, 1000, 0, '')`
  ).run(setId, accId)
  // 2027 年初 1300（=2026末，模拟年结结转写入）
  db.prepare(
    `INSERT INTO init_balances VALUES ('ib2027', ?, ?, 2027, 1, 1300, 1300, 0, '')`
  ).run(setId, accId)

  // 2026 凭证
  let v = 0
  function addVoucher(date: string, dir: 'debit' | 'credit', amount: number) {
    const vid = `v${++v}`
    const year = Number(date.slice(0, 4))
    const period = Number(date.slice(5, 7))
    db.prepare(
      `INSERT INTO vouchers VALUES (?, ?, ?, ?, ?, 'posted')`
    ).run(vid, setId, date, year, period)
    db.prepare(
      `INSERT INTO voucher_entries VALUES (?, ?, ?, ?, '1001', '库存现金', ?, ?)`
    ).run(`e${v}`, setId, vid, accId, dir, amount)
  }

  addVoucher('2026-03-15', 'debit', 500)
  addVoucher('2026-08-10', 'credit', 200)
  addVoucher('2027-02-20', 'debit', 100)

  return { db, setId, accId }
}

function runQuery(
  db: Database.Database,
  setId: string,
  startDate: string,
  endDate: string
) {
  const q = buildLedgerGeneralQuery({
    accountSetId: setId,
    startDate,
    endDate,
  })
  const rows = db.prepare(q.sql).all(...q.params) as any[]
  return rows.find(r => r.account_code === '1001')!
}

describe('总账跨年查询期初/期末不双计（FIX-002 / P0-4）', () => {
  it('占位符与参数个数匹配', () => {
    const q = buildLedgerGeneralQuery({
      accountSetId: 'as',
      startDate: '2026-01-01',
      endDate: '2026-12-31',
    })
    const placeholders = (q.sql.match(/\?/g) || []).length
    expect(q.params.length).toBe(placeholders)
  })

  it('同年查询 2026 全年：期初 1000, 期末 1300', () => {
    const { db, setId } = setup()
    const row = runQuery(db, setId, '2026-01-01', '2026-12-31')
    expect(row.init_balance).toBe(1000)
    expect(row.current_debit).toBe(500)
    expect(row.current_credit).toBe(200)
    expect(row.end_balance).toBe(1300)
  })

  it('同年查询 2027 上半年：期初 1300, 期末 1400', () => {
    const { db, setId } = setup()
    const row = runQuery(db, setId, '2027-01-01', '2027-06-30')
    expect(row.init_balance).toBe(1300)
    expect(row.current_debit).toBe(100)
    expect(row.current_credit).toBe(0)
    expect(row.end_balance).toBe(1400)
  })

  it('跨年查询 [2026-12-01, 2027-06-30]：期初=1300（2026-11-30 末），期末=1400（不重复加）', () => {
    const { db, setId } = setup()
    const row = runQuery(db, setId, '2026-12-01', '2027-06-30')
    // 起始时点是 2026-12-01：2026 年初 1000 + 2026-01 ~ 2026-11 凭证 (500 - 200) = 1300
    expect(row.init_balance).toBe(1300)
    // 本期凭证：2026-12-01 ~ 2027-06-30 → 只命中 2027-02-20 的借 100
    expect(row.current_debit).toBe(100)
    expect(row.current_credit).toBe(0)
    // 期末（2027-06-30 时点）：2027 年初 1300 + 2027-01-01 ~ 2027-06-30 凭证 (100) = 1400
    expect(row.end_balance).toBe(1400)
    // 双计校验：旧 BUG 下 init_balance 会 = 2027 init(1300) + 2026 前11月 (500-200=300) = 1600
    expect(row.init_balance).not.toBe(1600)
  })

  it('查询起始日恰为年初 2026-01-01：期初应等于 2026 年初余额 1000', () => {
    const { db, setId } = setup()
    const row = runQuery(db, setId, '2026-01-01', '2026-06-30')
    expect(row.init_balance).toBe(1000)
  })

  it('查询起始日为 2026-04-01：期初=1000 + 2026-03-15 的借 500 = 1500', () => {
    const { db, setId } = setup()
    const row = runQuery(db, setId, '2026-04-01', '2026-06-30')
    expect(row.init_balance).toBe(1500)
    expect(row.current_debit).toBe(0)
    expect(row.current_credit).toBe(0)
    expect(row.end_balance).toBe(1500)
  })
})
