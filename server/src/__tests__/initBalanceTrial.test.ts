import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import {
  getInitBalanceTrialTotals,
  validateInitBalanceBalancedForPosting,
} from '../services/initBalanceTrial.js'

function createTestDb() {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE accounts (
      id TEXT PRIMARY KEY, account_set_id TEXT, code TEXT, name TEXT,
      direction TEXT, parent_id TEXT, is_enabled INTEGER DEFAULT 1
    );
    CREATE TABLE init_balances (
      id TEXT PRIMARY KEY, account_set_id TEXT, account_id TEXT, direction TEXT,
      year INTEGER, period INTEGER,
      init_balance REAL, init_debit REAL, init_credit REAL,
      aux_item_id TEXT NOT NULL DEFAULT '',
      opening_debit REAL, opening_credit REAL, pre_book_debit REAL, pre_book_credit REAL
    );
    INSERT INTO accounts VALUES ('parent', 'set1', '1001', '资产', 'debit', NULL, 1);
    INSERT INTO accounts VALUES ('leaf1', 'set1', '1001001', '现金', 'debit', 'parent', 1);
    INSERT INTO accounts VALUES ('leaf2', 'set1', '2001', '负债', 'credit', NULL, 1);
    INSERT INTO accounts VALUES ('aux-leaf', 'set1', '5001', '经费支出', 'debit', NULL, 1);
  `)
  return db
}

describe('initBalanceTrial', () => {
  let db: Database.Database

  beforeEach(() => {
    db = createTestDb()
  })

  it('无期初数据时视为平衡', () => {
    const totals = getInitBalanceTrialTotals(db, 'set1', 2026)
    expect(totals.balanced).toBe(true)
    expect(totals.totalDebit).toBe(0)
    expect(totals.totalCredit).toBe(0)
  })

  it('末级科目借贷相等时平衡', () => {
    db.prepare(
      `INSERT INTO init_balances VALUES ('b1','set1','leaf1','debit',2026,0,100,100,0,'',NULL,NULL,NULL,NULL)`
    ).run()
    db.prepare(
      `INSERT INTO init_balances VALUES ('b2','set1','leaf2','credit',2026,0,100,0,100,'',NULL,NULL,NULL,NULL)`
    ).run()

    const totals = getInitBalanceTrialTotals(db, 'set1', 2026)
    expect(totals.balanced).toBe(true)
    expect(totals.totalDebit).toBe(100)
    expect(totals.totalCredit).toBe(100)
  })

  it('末级科目借贷不等时不平衡', () => {
    db.prepare(
      `INSERT INTO init_balances VALUES ('b1','set1','leaf1','debit',2026,0,100,100,0,'',NULL,NULL,NULL,NULL)`
    ).run()
    db.prepare(
      `INSERT INTO init_balances VALUES ('b2','set1','leaf2','credit',2026,0,70,0,70,'',NULL,NULL,NULL,NULL)`
    ).run()

    const totals = getInitBalanceTrialTotals(db, 'set1', 2026)
    expect(totals.balanced).toBe(false)
    expect(totals.totalDebit).toBe(100)
    expect(totals.totalCredit).toBe(70)
  })

  it('父科目期初不计入汇总，避免重复累加', () => {
    db.prepare(
      `INSERT INTO init_balances VALUES ('bp','set1','parent','debit',2026,0,500,500,0,'',NULL,NULL,NULL,NULL)`
    ).run()
    db.prepare(
      `INSERT INTO init_balances VALUES ('b1','set1','leaf1','debit',2026,0,100,100,0,'',NULL,NULL,NULL,NULL)`
    ).run()
    db.prepare(
      `INSERT INTO init_balances VALUES ('b2','set1','leaf2','credit',2026,0,100,0,100,'',NULL,NULL,NULL,NULL)`
    ).run()

    const totals = getInitBalanceTrialTotals(db, 'set1', 2026)
    expect(totals.balanced).toBe(true)
    expect(totals.totalDebit).toBe(100)
    expect(totals.totalCredit).toBe(100)
  })

  it('有辅助期初明细时只汇总 aux 行', () => {
    db.prepare(
      `INSERT INTO init_balances VALUES ('ba0','set1','aux-leaf','debit',2026,0,300,300,0,'',NULL,NULL,NULL,NULL)`
    ).run()
    db.prepare(
      `INSERT INTO init_balances VALUES ('ba1','set1','aux-leaf','debit',2026,0,60,60,0,'dept:a',NULL,NULL,NULL,NULL)`
    ).run()
    db.prepare(
      `INSERT INTO init_balances VALUES ('ba2','set1','aux-leaf','debit',2026,0,40,40,0,'dept:b',NULL,NULL,NULL,NULL)`
    ).run()
    db.prepare(
      `INSERT INTO init_balances VALUES ('b2','set1','leaf2','credit',2026,0,100,0,100,'',NULL,NULL,NULL,NULL)`
    ).run()

    const totals = getInitBalanceTrialTotals(db, 'set1', 2026)
    expect(totals.balanced).toBe(true)
    expect(totals.totalDebit).toBe(100)
    expect(totals.totalCredit).toBe(100)
  })

  it('优先使用 opening + pre_book 字段', () => {
    db.prepare(
      `INSERT INTO init_balances VALUES ('b1','set1','leaf1','debit',2026,0,999,999,0,'',80,0,20,0)`
    ).run()
    db.prepare(
      `INSERT INTO init_balances VALUES ('b2','set1','leaf2','credit',2026,0,999,0,999,'',0,100,0,0)`
    ).run()

    const totals = getInitBalanceTrialTotals(db, 'set1', 2026)
    expect(totals.balanced).toBe(true)
    expect(totals.totalDebit).toBe(100)
    expect(totals.totalCredit).toBe(100)
  })

  it('validateInitBalanceBalancedForPosting 不平衡时返回错误文案', () => {
    db.prepare(
      `INSERT INTO init_balances VALUES ('b1','set1','leaf1','debit',2026,0,100,100,0,'',NULL,NULL,NULL,NULL)`
    ).run()

    const msg = validateInitBalanceBalancedForPosting(db, 'set1', 2026)
    expect(msg).toBe('年初不平，不允许记账')
  })

  it('validateInitBalanceBalancedForPosting 平衡时返回 null', () => {
    db.prepare(
      `INSERT INTO init_balances VALUES ('b1','set1','leaf1','debit',2026,0,100,100,0,'',NULL,NULL,NULL,NULL)`
    ).run()
    db.prepare(
      `INSERT INTO init_balances VALUES ('b2','set1','leaf2','credit',2026,0,100,0,100,'',NULL,NULL,NULL,NULL)`
    ).run()

    expect(validateInitBalanceBalancedForPosting(db, 'set1', 2026)).toBeNull()
  })
})
