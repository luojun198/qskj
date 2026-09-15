import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { up } from '../db/migrations/20260915_backfill_init_balance_opening.js'

/** FIX-146：老库 opening_* 全 0 时按 init_balance 与方向回填 */
describe('migration 122 backfill_init_balance_opening', () => {
  it('四列全 0 的行按方向回填，已有 opening/pre_book 的行不动', () => {
    const db = new Database(':memory:')
    db.exec(`CREATE TABLE init_balances (
      id TEXT PRIMARY KEY, direction TEXT, init_balance REAL,
      opening_debit REAL DEFAULT 0, opening_credit REAL DEFAULT 0,
      pre_book_debit REAL DEFAULT 0, pre_book_credit REAL DEFAULT 0
    )`)
    const ins = db.prepare('INSERT INTO init_balances VALUES (?,?,?,?,?,?,?)')
    ins.run('d+', 'debit', 100, 0, 0, 0, 0)
    ins.run('d-', 'debit', -30, 0, 0, 0, 0)
    ins.run('c+', 'credit', 200, 0, 0, 0, 0)
    ins.run('c-', 'credit', -50, 0, 0, 0, 0)
    ins.run('keep', 'debit', 100, 60, 0, 40, 0)
    ins.run('zero', 'debit', 0, 0, 0, 0, 0)
    up(db)
    const rows = Object.fromEntries(
      (db.prepare('SELECT * FROM init_balances').all() as any[]).map(r => [r.id, [r.opening_debit, r.opening_credit, r.pre_book_debit]])
    )
    expect(rows['d+']).toEqual([100, 0, 0])
    expect(rows['d-']).toEqual([0, 30, 0])
    expect(rows['c+']).toEqual([0, 200, 0])
    expect(rows['c-']).toEqual([50, 0, 0])
    expect(rows['keep']).toEqual([60, 0, 40])
    expect(rows['zero']).toEqual([0, 0, 0])
  })
})
