import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { backfillInitBalanceAuxSummary } from '../scripts/backfillInitBalanceAuxSummary.js'
import { buildInitBalanceSumExpr } from '../services/initBalanceScope.js'

/** FIX-104 配套：为缺科目汇总行的历史辅助期初补建汇总行 */
function createTestDb() {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE account_sets (id TEXT PRIMARY KEY, start_date TEXT);
    CREATE TABLE accounts (
      id TEXT PRIMARY KEY, account_set_id TEXT, code TEXT, name TEXT,
      direction TEXT, parent_id TEXT, is_aux INTEGER, aux_types TEXT, is_enabled INTEGER
    );
    CREATE TABLE aux_categories (id TEXT PRIMARY KEY, account_set_id TEXT, code TEXT, name TEXT, sort_order INTEGER);
    CREATE TABLE aux_category_fields (
      id TEXT PRIMARY KEY, category_id TEXT, field_key TEXT, field_name TEXT,
      field_type TEXT DEFAULT 'text', is_enabled INTEGER DEFAULT 1, sort_order INTEGER DEFAULT 0
    );
    CREATE TABLE aux_items (
      id TEXT PRIMARY KEY, account_set_id TEXT, type TEXT, code TEXT, name TEXT,
      status TEXT DEFAULT 'active', remark TEXT, field_values TEXT DEFAULT '{}'
    );
    CREATE TABLE init_balances (
      id TEXT PRIMARY KEY, account_set_id TEXT, account_id TEXT, direction TEXT,
      year INTEGER, period INTEGER,
      init_balance REAL, init_debit REAL, init_credit REAL,
      aux_item_id TEXT NOT NULL DEFAULT '',
      opening_debit REAL, opening_credit REAL, pre_book_debit REAL, pre_book_credit REAL
    );
    CREATE TABLE vouchers (id TEXT PRIMARY KEY, account_set_id TEXT, voucher_date TEXT, status TEXT);
    CREATE TABLE period_closing (
      id TEXT PRIMARY KEY, account_set_id TEXT, year INTEGER, period INTEGER, status TEXT
    );
    INSERT INTO account_sets VALUES ('set1', '2026-01-01');
    INSERT INTO aux_categories VALUES ('cat-dept', 'set1', 'dept', '部门', 0);
    INSERT INTO aux_categories VALUES ('cat-pers', 'set1', 'pers', '人员', 1);
    INSERT INTO aux_items (id, account_set_id, type, code, name)
      VALUES ('item-d', 'set1', 'cat-dept', 'D01', '行政部');
    INSERT INTO aux_items (id, account_set_id, type, code, name)
      VALUES ('item-p', 'set1', 'cat-pers', 'P01', '张三');
    INSERT INTO accounts VALUES (
      'acc1', 'set1', '5001', '经费支出', 'debit', NULL, 1,
      '{"cat-dept":null,"cat-pers":null}', 1
    );
  `)
  return db
}

function insertAux(db: Database.Database, id: string, auxItemId: string, amount: number) {
  db.prepare(
    `INSERT INTO init_balances VALUES (?, 'set1', 'acc1', 'debit', 2026, 1, ?, ?, 0, ?, ?, 0, 0, 0)`
  ).run(id, amount, amount, auxItemId, amount)
}

function summaryRow(db: Database.Database) {
  return db
    .prepare(
      `SELECT init_balance FROM init_balances
       WHERE account_set_id='set1' AND account_id='acc1' AND year=2026 AND aux_item_id=''`
    )
    .get() as { init_balance: number } | undefined
}

describe('backfillInitBalanceAuxSummary', () => {
  let db: Database.Database

  beforeEach(() => {
    db = createTestDb()
  })

  it('试运行只出报告不写库', () => {
    insertAux(db, 'x1', 'dept:item-d', 91)
    insertAux(db, 'x2', 'pers:item-p', 91)

    const result = backfillInitBalanceAuxSummary('set1', { db })

    expect(result.filled).toBe(1)
    expect(result.rows[0].aux_total).toBe(182)
    expect(result.rows[0].summary_amount).toBe(91)
    expect(summaryRow(db)).toBeUndefined()
  })

  it('--apply 补建汇总行后账簿口径不再翻倍', () => {
    insertAux(db, 'x1', 'dept:item-d', 91)
    insertAux(db, 'x2', 'pers:item-p', 91)

    backfillInitBalanceAuxSummary('set1', { db, apply: true })

    expect(summaryRow(db)?.init_balance).toBe(91)
    const v = db
      .prepare(
        `SELECT ${buildInitBalanceSumExpr()} as v FROM init_balances
         WHERE account_set_id='set1' AND account_id='acc1' AND year=2026 GROUP BY account_id`
      )
      .get() as { v: number }
    expect(v.v).toBe(91)
  })

  it('已有汇总行的组合不再处理（幂等）', () => {
    insertAux(db, 'x1', 'dept:item-d', 91)
    insertAux(db, 'x2', 'pers:item-p', 91)
    backfillInitBalanceAuxSummary('set1', { db, apply: true })

    const second = backfillInitBalanceAuxSummary('set1', { db, apply: true })
    expect(second.filled).toBe(0)
    expect(summaryRow(db)?.init_balance).toBe(91)
  })

  it('各辅助类目合计不一致时仍补建但标记出来交人工复核', () => {
    insertAux(db, 'x1', 'dept:item-d', 91)
    insertAux(db, 'x2', 'pers:item-p', 70)

    const result = backfillInitBalanceAuxSummary('set1', { db })
    expect(result.filled).toBe(1)
    expect(result.inconsistent).toBe(1)
    expect(result.rows[0].consistent).toBe(false)
  })

  it('没有辅助明细的科目不产生任何处理', () => {
    db.prepare(
      `INSERT INTO init_balances VALUES ('p1','set1','acc1','debit',2026,1,50,50,0,'',50,0,0,0)`
    ).run()

    const result = backfillInitBalanceAuxSummary('set1', { db })
    expect(result.filled).toBe(0)
  })
})
