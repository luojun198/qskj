import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import {
  clearAuxInitBalances,
  clearDirectInitBalances,
  countAuxInitClearTargets,
  countInitBalanceClearTargets,
  checkInitBalanceEditable,
  checkInitBalanceAuxEditable,
} from '../services/initBalanceClear.js'

function createTestDb() {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE account_sets (id TEXT PRIMARY KEY);
    CREATE TABLE accounts (
      id TEXT PRIMARY KEY, account_set_id TEXT, code TEXT, name TEXT,
      direction TEXT, is_aux INTEGER, aux_types TEXT
    );
    CREATE TABLE aux_categories (id TEXT PRIMARY KEY, account_set_id TEXT, code TEXT, name TEXT);
    CREATE TABLE init_balances (
      id TEXT PRIMARY KEY, account_set_id TEXT, account_id TEXT, direction TEXT,
      year INTEGER, period INTEGER,
      init_balance REAL, init_debit REAL, init_credit REAL,
      aux_item_id TEXT NOT NULL DEFAULT '',
      opening_debit REAL DEFAULT 0, opening_credit REAL DEFAULT 0,
      pre_book_debit REAL DEFAULT 0, pre_book_credit REAL DEFAULT 0
    );
    CREATE TABLE vouchers (
      id TEXT PRIMARY KEY, account_set_id TEXT, voucher_date TEXT, status TEXT
    );
    CREATE TABLE period_closing (
      id TEXT PRIMARY KEY, account_set_id TEXT, year INTEGER, period INTEGER, status TEXT
    );

    INSERT INTO account_sets VALUES ('set1');
    INSERT INTO accounts VALUES ('acc1', 'set1', '1001', '库存现金', 'debit', 0, NULL);
    INSERT INTO accounts VALUES ('acc2', 'set1', '5001', '经费支出', 'debit', 1, '{"cat-dept":null}');
    INSERT INTO aux_categories VALUES ('cat-dept', 'set1', 'dept', '部门');
    INSERT INTO init_balances VALUES ('d1', 'set1', 'acc1', 'debit', 2026, 1, 100, 100, 0, '', 100, 0, 0, 0);
    INSERT INTO init_balances VALUES ('s1', 'set1', 'acc2', 'debit', 2026, 1, 500, 500, 0, '', 500, 0, 0, 0);
    INSERT INTO init_balances VALUES ('a1', 'set1', 'acc2', 'debit', 2026, 1, 300, 300, 0, 'dept:item1', 300, 0, 0, 0);
    INSERT INTO init_balances VALUES ('a2', 'set1', 'acc2', 'debit', 2026, 1, 200, 200, 0, 'dept:item2', 200, 0, 0, 0);
  `)
  return db
}

describe('initBalanceClear', () => {
  let db: Database.Database

  beforeEach(() => {
    db = createTestDb()
  })

  it('checkInitBalanceEditable 有已审核凭证时不可编辑', () => {
    db.prepare(`INSERT INTO vouchers VALUES ('v1', 'set1', '2026-05-01', 'audited')`).run()
    const check = checkInitBalanceEditable(db, 'set1', 2026)
    expect(check.canEdit).toBe(false)
  })

  it('checkInitBalanceAuxEditable 无凭证无结账时可编辑', () => {
    const check = checkInitBalanceAuxEditable(db, 'set1', 2026)
    expect(check.canEdit).toBe(true)
  })

  it('checkInitBalanceAuxEditable 有已记账凭证时不可编辑', () => {
    db.prepare(`INSERT INTO vouchers VALUES ('v1', 'set1', '2026-05-01', 'posted')`).run()
    const check = checkInitBalanceAuxEditable(db, 'set1', 2026)
    expect(check.canEdit).toBe(false)
    expect(check.reason).toContain('已记账凭证')
  })

  it('checkInitBalanceAuxEditable 仅有已审核凭证时仍可编辑', () => {
    db.prepare(`INSERT INTO vouchers VALUES ('v1', 'set1', '2026-05-01', 'audited')`).run()
    const check = checkInitBalanceAuxEditable(db, 'set1', 2026)
    expect(check.canEdit).toBe(true)
  })

  it('checkInitBalanceAuxEditable 有已结账月份时不可编辑', () => {
    db.prepare(`INSERT INTO period_closing VALUES ('pc1', 'set1', 2026, 1, 'closed')`).run()
    const check = checkInitBalanceAuxEditable(db, 'set1', 2026)
    expect(check.canEdit).toBe(false)
    expect(check.reason).toContain('已结账')
  })

  it('clearAuxInitBalances 锁定后不可清理', () => {
    db.prepare(`INSERT INTO vouchers VALUES ('v1', 'set1', '2026-05-01', 'posted')`).run()
    expect(() => clearAuxInitBalances(db, 'set1', 2026, 'account', { accountId: 'acc2' })).toThrow(
      '已记账凭证'
    )
  })

  it('countInitBalanceClearTargets 分别统计科目期初与辅助期初', () => {
    expect(countInitBalanceClearTargets(db, 'set1', 2026, 'direct')).toBe(2)
    expect(countInitBalanceClearTargets(db, 'set1', 2026, 'aux')).toBe(2)
  })

  it('clearDirectInitBalances 可清空科目期初', () => {
    const result = clearDirectInitBalances(db, 'set1', 2026)
    expect(result.deletedCount).toBe(2)
    expect(
      (db.prepare(`SELECT COUNT(*) as c FROM init_balances WHERE aux_item_id=''`).get() as { c: number }).c
    ).toBe(0)
  })

  it('clearAuxInitBalances 可清空当前科目辅助期初并重算汇总', () => {
    expect(countAuxInitClearTargets(db, 'set1', 2026, 'account', { accountId: 'acc2' })).toBe(2)
    const result = clearAuxInitBalances(db, 'set1', 2026, 'account', { accountId: 'acc2' })
    expect(result.deletedCount).toBe(2)
    expect(
      (
        db
          .prepare(`SELECT COUNT(*) as c FROM init_balances WHERE account_id='acc2' AND aux_item_id!=''`)
          .get() as { c: number }
      ).c
    ).toBe(0)
    const summary = db
      .prepare(`SELECT init_debit FROM init_balances WHERE account_id='acc2' AND aux_item_id=''`)
      .get() as { init_debit: number } | undefined
    expect(summary).toBeUndefined()
  })

  it('clearAuxInitBalances 可按类目清理', () => {
    const result = clearAuxInitBalances(db, 'set1', 2026, 'category', {
      accountId: 'acc2',
      categoryCode: 'dept',
    })
    expect(result.deletedCount).toBe(2)
  })
})
