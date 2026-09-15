/**
 * 总账「账前发生额」跨年归属回归测试（GL-02）
 *
 * 背景：账前发生额（启用前在旧系统记账、本系统无凭证明细的部分）按 ACD 规则记账在
 * 「账套启用年」的 init_balances 里。旧实现把 current/year 分支的账前子查询年份
 * 都写死为 endDateYear；当查询区间跨过启用年（如启用 2024-12-15，查询
 * 2024-12-01 ~ 2025-03-31）时会在 2025 年里找不到账前行 → 本期用漏算。
 *
 * 本测试构造该场景，断言账前 300 元被计入本期借方。
 */
import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { buildLedgerGeneralQuery } from '../services/ledgerQuery.js'

function setup(opts: { startDate: string; preBookYear: number; preBookDebit: number }) {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE accounts (
      id TEXT PRIMARY KEY, account_set_id TEXT, code TEXT, name TEXT, direction TEXT,
      level INTEGER DEFAULT 1, is_enabled INTEGER DEFAULT 1,
      is_foreign INTEGER DEFAULT 0, currency_code TEXT
    );
    CREATE TABLE init_balances (
      id TEXT PRIMARY KEY, account_set_id TEXT, account_id TEXT, year INTEGER, period INTEGER,
      init_balance REAL, init_debit REAL DEFAULT 0, init_credit REAL DEFAULT 0,
      opening_debit REAL DEFAULT 0, opening_credit REAL DEFAULT 0,
      pre_book_debit REAL DEFAULT 0, pre_book_credit REAL DEFAULT 0,
      aux_item_id TEXT
    );
    CREATE TABLE vouchers (
      id TEXT PRIMARY KEY, account_set_id TEXT, voucher_date TEXT, year INTEGER, period INTEGER, status TEXT
    );
    CREATE TABLE voucher_entries (
      id TEXT PRIMARY KEY, account_set_id TEXT, voucher_id TEXT, account_id TEXT,
      account_code TEXT, account_name TEXT, direction TEXT, amount REAL
    );
  `)
  const setId = 'set1'
  db.prepare(
    `INSERT INTO accounts (id, account_set_id, code, name, direction, level, is_enabled)
     VALUES ('acc-1001', ?, '1001', '库存现金', 'debit', 1, 1)`
  ).run(setId)
  db.prepare(
    `INSERT INTO init_balances
       (id, account_set_id, account_id, year, period, init_balance, init_debit, init_credit,
        opening_debit, opening_credit, pre_book_debit, pre_book_credit, aux_item_id)
     VALUES ('ib', ?, 'acc-1001', ?, 1, ?, 0, 0, 0, 0, ?, 0, '')`
  ).run(setId, opts.preBookYear, opts.preBookDebit, opts.preBookDebit)
  return { db, setId }
}

function run(
  db: Database.Database,
  setId: string,
  startDate: string,
  endDate: string,
  accountSetStartDate: string
) {
  const q = buildLedgerGeneralQuery({
    accountSetId: setId,
    startDate,
    endDate,
    accountSetStartDate,
    preBookEnabled: true,
  })
  const rows = db.prepare(q.sql).all(...q.params) as any[]
  return { row: rows.find(r => r.account_code === '1001')!, placeholders: (q.sql.match(/\?/g) || []).length, paramCount: q.params.length }
}

describe('总账账前发生额跨年归属（GL-02）', () => {
  it('占位符与参数个数匹配', () => {
    const { db, setId } = setup({ startDate: '2024-12-01', preBookYear: 2024, preBookDebit: 300 })
    const r = run(db, setId, '2024-12-01', '2025-03-31', '2024-12-15')
    expect(r.paramCount).toBe(r.placeholders)
  })

  it('同年区间：账前 100 计入本期借方', () => {
    const { db, setId } = setup({ startDate: '2025-06-01', preBookYear: 2025, preBookDebit: 100 })
    const { row } = run(db, setId, '2025-06-01', '2025-12-31', '2025-06-15')
    expect(row.current_debit).toBe(100)
  })

  it('跨年区间（2024-12-15 启用，查 2024-12-01~2025-03-31）：账前 300 必须计入本期借方', () => {
    const { db, setId } = setup({ startDate: '2024-12-01', preBookYear: 2024, preBookDebit: 300 })
    const { row } = run(db, setId, '2024-12-01', '2025-03-31', '2024-12-15')
    // 修复前：账前行在 2024 年，占位符却查 2025 年 → current_debit = 0
    expect(row.current_debit).toBe(300)
  })

  it('跨年区间：账前只在本期出现一次（期初不含、本期 300）', () => {
    const { db, setId } = setup({ startDate: '2024-12-01', preBookYear: 2024, preBookDebit: 300 })
    const { row } = run(db, setId, '2024-12-01', '2025-03-31', '2024-12-15')
    expect(row.init_balance).toBe(0)
    expect(row.current_debit).toBe(300)
  })
})
