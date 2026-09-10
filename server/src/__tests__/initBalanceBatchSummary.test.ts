import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { saveInitBalanceBatchItems } from '../services/initBalanceBatch.js'
import { buildInitBalanceSumExpr } from '../services/initBalanceScope.js'

/**
 * FIX-104（评审报告 B1 配套）：批量保存辅助期初必须同步维护科目汇总行。
 * 账簿 / 试算 / 报表统一按「汇总行优先」取数后，批量路径若不写汇总行，
 * 该科目期初就会退回累加辅助明细——多辅助类目场景重新成倍放大。
 */
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
      opening_debit REAL, opening_credit REAL, pre_book_debit REAL, pre_book_credit REAL,
      foreign_init_balance REAL DEFAULT 0, foreign_opening_debit REAL DEFAULT 0,
      foreign_opening_credit REAL DEFAULT 0, foreign_pre_book_debit REAL DEFAULT 0,
      foreign_pre_book_credit REAL DEFAULT 0,
      qty_init_balance REAL DEFAULT 0, qty_opening_debit REAL DEFAULT 0,
      qty_opening_credit REAL DEFAULT 0, qty_pre_book_debit REAL DEFAULT 0,
      qty_pre_book_credit REAL DEFAULT 0
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
    INSERT INTO accounts VALUES ('acc2', 'set1', '1001', '库存现金', 'debit', NULL, 0, NULL, 1);
  `)
  return db
}

function accountInit(db: Database.Database): number {
  const row = db
    .prepare(
      `SELECT ${buildInitBalanceSumExpr()} as v FROM init_balances
       WHERE account_set_id='set1' AND account_id='acc1' AND year=2026 GROUP BY account_id`
    )
    .get() as { v: number } | undefined
  return row ? Number(row.v) : 0
}

describe('批量保存辅助期初维护科目汇总行', () => {
  let db: Database.Database

  beforeEach(() => {
    db = createTestDb()
  })

  it('两个辅助类目各写一套后，科目期初取到 91 而不是 182', () => {
    const result = saveInitBalanceBatchItems(db, 'set1', 2026, [
      { account_id: 'acc1', direction: 'debit', opening_debit: 91, period: 1, aux_item_id: 'dept:item-d' },
      { account_id: 'acc1', direction: 'debit', opening_debit: 91, period: 1, aux_item_id: 'pers:item-p' },
    ])

    expect(result.failed).toBe(0)
    expect(result.success).toBe(2)

    const summary = db
      .prepare(
        `SELECT init_balance FROM init_balances
         WHERE account_set_id='set1' AND account_id='acc1' AND year=2026 AND aux_item_id=''`
      )
      .get() as { init_balance: number } | undefined
    expect(summary).toBeDefined()
    expect(summary!.init_balance).toBe(91)

    expect(accountInit(db)).toBe(91)
  })

  it('重复批量保存后汇总行仍等于单类目合计（幂等）', () => {
    const items = [
      { account_id: 'acc1', direction: 'debit', opening_debit: 60, period: 1, aux_item_id: 'dept:item-d' },
      { account_id: 'acc1', direction: 'debit', opening_debit: 60, period: 1, aux_item_id: 'pers:item-p' },
    ]
    saveInitBalanceBatchItems(db, 'set1', 2026, items)
    saveInitBalanceBatchItems(db, 'set1', 2026, items)

    const rows = db
      .prepare(
        `SELECT COUNT(*) as c FROM init_balances
         WHERE account_set_id='set1' AND account_id='acc1' AND year=2026 AND aux_item_id=''`
      )
      .get() as { c: number }
    expect(rows.c).toBe(1)
    expect(accountInit(db)).toBe(60)
  })

  it('非辅助科目走科目级期初，不受汇总行重算影响', () => {
    const result = saveInitBalanceBatchItems(db, 'set1', 2026, [
      { account_id: 'acc2', direction: 'debit', opening_debit: 50, period: 1 },
    ])
    expect(result.failed).toBe(0)

    const row = db
      .prepare(
        `SELECT ${buildInitBalanceSumExpr()} as v FROM init_balances
         WHERE account_set_id='set1' AND account_id='acc2' AND year=2026 GROUP BY account_id`
      )
      .get() as { v: number }
    expect(row.v).toBe(50)
  })
})
