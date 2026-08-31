import { describe, expect, it, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { buildAccountInitBalanceExpr } from '../services/ledgerQuery.js'

describe('init_balances 期初去重', () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    db.exec(`
      CREATE TABLE accounts (
        id TEXT PRIMARY KEY,
        account_set_id TEXT,
        code TEXT,
        name TEXT,
        direction TEXT
      );
      CREATE TABLE init_balances (
        id TEXT PRIMARY KEY,
        account_set_id TEXT,
        account_id TEXT,
        direction TEXT,
        year INTEGER,
        period INTEGER,
        init_balance REAL,
        init_debit REAL,
        init_credit REAL,
        aux_item_id TEXT
      );
    `)
    db.prepare(`INSERT INTO accounts VALUES ('a1', 'as1', '1001', '库存现金', 'debit')`).run()
    db.prepare(
      `INSERT INTO init_balances VALUES ('i0', 'as1', 'a1', 'debit', 2026, 1, 1000, 0, 0, '')`
    ).run()
    db.prepare(
      `INSERT INTO init_balances VALUES ('i1', 'as1', 'a1', 'debit', 2026, 1, 300, 300, 0, 'dept:d1')`
    ).run()
    db.prepare(
      `INSERT INTO init_balances VALUES ('i2', 'as1', 'a1', 'debit', 2026, 1, 200, 200, 0, 'dept:d2')`
    ).run()
  })

  it('有辅助期初且无科目汇总行时只汇总辅助明细', () => {
    db.prepare(`DELETE FROM init_balances WHERE id='i0'`).run()

    const wrong = db
      .prepare(
        `SELECT SUM(init_balance) as v FROM init_balances WHERE account_id='a1' AND year=2026`
      )
      .get() as { v: number }
    expect(wrong.v).toBe(500)

    const sql = `SELECT ${buildAccountInitBalanceExpr("'a1'")} as v`
    const right = db.prepare(sql).get('as1', 2026) as { v: number }
    expect(right.v).toBe(500)
  })

  it('存在科目汇总行时以汇总行为准，不再累加各辅助类别明细', () => {
    db.prepare(`UPDATE init_balances SET init_balance=500, init_debit=500, init_credit=0 WHERE id='i0'`).run()

    const sql = `SELECT ${buildAccountInitBalanceExpr("'a1'")} as v`
    const right = db.prepare(sql).get('as1', 2026) as { v: number }
    expect(right.v).toBe(500)
  })
})
