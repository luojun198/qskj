import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'
import {
  getAccountRealtimeBalance,
  getAccountRealtimeAuxBalance,
  parseAuxBalanceSelections,
} from '../services/accountRealtimeBalance.js'

function createTestDb() {
  const db = new Database(':memory:')
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
      direction TEXT,
      amount REAL,
      dept_id TEXT,
      aux_data TEXT
    );
    CREATE TABLE aux_items (
      id TEXT PRIMARY KEY,
      account_set_id TEXT,
      name TEXT
    );
  `)
  return db
}

describe('accountRealtimeBalance', () => {
  it('parseAuxBalanceSelections 解析 code:id', () => {
    expect(parseAuxBalanceSelections('dept:a1,project:b2')).toEqual([
      { categoryCode: 'dept', itemId: 'a1' },
      { categoryCode: 'project', itemId: 'b2' },
    ])
  })

  it('getAccountRealtimeBalance 仅汇总无辅助的期初', () => {
    const db = createTestDb()
    const setId = 'set1'
    const accId = 'acc1'
    db.prepare(
      `INSERT INTO accounts VALUES (?, ?, '1001', '现金', 'debit')`
    ).run(accId, setId)
    db.prepare(
      `INSERT INTO init_balances VALUES ('i1', ?, ?, 'debit', 2026, 1, 100, 0, 0, '')`
    ).run(setId, accId)
    db.prepare(
      `INSERT INTO init_balances VALUES ('i2', ?, ?, 'debit', 2026, 1, 50, 10, 0, 'dept:d1')`
    ).run(setId, accId)

    const result = getAccountRealtimeBalance(db, {
      accountId: accId,
      accountSetId: setId,
      year: 2026,
      period: 5,
    })
    expect(result?.init_balance).toBe(100)
  })

  it('getAccountRealtimeAuxBalance 按部门项目汇总', () => {
    const db = createTestDb()
    const setId = 'set1'
    const accId = 'acc1'
    const vId = uuidv4()
    const itemId = 'dept-item-1'
    db.prepare(`INSERT INTO accounts VALUES (?, ?, '1001', '管理费用', 'debit')`).run(
      accId,
      setId
    )
    db.prepare(
      `INSERT INTO init_balances VALUES ('i1', ?, ?, 'debit', 2026, 1, 0, 20, 0, ?)`
    ).run(setId, accId, `dept:${itemId}`)
    db.prepare(
      `INSERT INTO vouchers VALUES (?, ?, '2026-05-01', 2026, 5, 'posted')`
    ).run(vId, setId)
    db.prepare(
      `INSERT INTO voucher_entries VALUES (?, ?, ?, ?, 'debit', 30, ?, ?)`
    ).run(uuidv4(), setId, vId, accId, itemId, JSON.stringify({ dept: { id: itemId, name: '行政部' } }))

    const result = getAccountRealtimeAuxBalance(db, {
      accountId: accId,
      accountSetId: setId,
      year: 2026,
      period: 5,
      categoryCode: 'dept',
      itemId,
      accountDirection: 'debit',
    })
    expect(result.end_balance).toBe(50)
  })
})
