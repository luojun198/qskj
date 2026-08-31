import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { getPeriodEndBalanceByCode } from '../services/autoTransfer.js'

// P0-4 回归：结转取数必须累计本年 1~N 期发生额（+ 年初一次），
// 而非只取当期。account_balances.init_balance 为「年初余额」（各期行相同）、
// current_* 为「本期发生额」。旧实现 WHERE period=? 会漏掉 1~N-1 期。

function makeDb() {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE accounts (
      id TEXT PRIMARY KEY, account_set_id TEXT, code TEXT, name TEXT,
      direction TEXT, is_enabled INTEGER DEFAULT 1, is_aux INTEGER DEFAULT 0, parent_id TEXT
    );
    CREATE TABLE account_balances (
      id TEXT PRIMARY KEY, account_set_id TEXT, account_id TEXT, account_code TEXT,
      account_name TEXT, direction TEXT, year INTEGER, period INTEGER,
      init_balance REAL DEFAULT 0, current_debit REAL DEFAULT 0, current_credit REAL DEFAULT 0,
      end_balance REAL DEFAULT 0, aux_item_id TEXT DEFAULT ''
    );
  `)
  // 一个费用类叶子科目（借方），无子科目
  db.prepare(
    `INSERT INTO accounts (id, account_set_id, code, name, direction, is_enabled, is_aux)
     VALUES ('a1', 'as', '5601', '管理费用', 'debit', 1, 0)`
  ).run()
  return db
}

function insBal(
  db: any,
  period: number,
  initBalance: number,
  curDebit: number,
  curCredit: number
) {
  db.prepare(
    `INSERT INTO account_balances
      (id, account_set_id, account_id, account_code, account_name, direction, year, period, init_balance, current_debit, current_credit)
     VALUES (?, 'as', 'a1', '5601', '管理费用', 'debit', 2026, ?, ?, ?, ?)`
  ).run(`b${period}`, period, initBalance, curDebit, curCredit)
}

describe('getPeriodEndBalanceByCode - 跨期累计（P0-4）', () => {
  it('1 月发生、2 月无发生额：查 2 月应取到 1 月累计，而非 0', () => {
    const db = makeDb()
    insBal(db, 1, 0, 1000, 0) // 1 月发生借方 1000，年初 0；2 月无行
    const row = getPeriodEndBalanceByCode({
      db: db as any,
      accountSetId: 'as',
      year: 2026,
      period: 2,
      accountCode: '5601',
    }) as any
    expect(row).not.toBeNull()
    expect(row.end_balance).toBe(1000)
  })

  it('多期发生额累加：查末期取 1~N 期合计', () => {
    const db = makeDb()
    insBal(db, 1, 0, 1000, 0)
    insBal(db, 2, 0, 500, 0)
    insBal(db, 3, 0, 300, 0)
    const row = getPeriodEndBalanceByCode({
      db: db as any,
      accountSetId: 'as',
      year: 2026,
      period: 3,
      accountCode: '5601',
    }) as any
    expect(row.end_balance).toBe(1800)
  })

  it('年初余额只计一次（各期行的 init_balance 相同不得累加）', () => {
    const db = makeDb()
    insBal(db, 1, 200, 1000, 0) // 年初 200
    insBal(db, 2, 200, 500, 0)
    const row = getPeriodEndBalanceByCode({
      db: db as any,
      accountSetId: 'as',
      year: 2026,
      period: 2,
      accountCode: '5601',
    }) as any
    // 年初 200（取一次）+ 发生额 1000 + 500 = 1700
    expect(row.end_balance).toBe(1700)
  })
})
