import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { buildGeneralLedgerQuery } from '../services/ledgerQuery.js'

/**
 * FIX-129：年结后总分类账/科目分析期初不得双计上年活动。
 * 本年 init_balances 已有行 → 期初只取年初余额；无行（上年未年结）→ 上溯累计上年凭证。
 */

const SET_ID = 'set1'

function setup(withYearCloseRow: boolean) {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE account_sets (id TEXT PRIMARY KEY, start_date TEXT, fiscal_year INTEGER);
    CREATE TABLE accounts (
      id TEXT PRIMARY KEY, account_set_id TEXT, code TEXT, name TEXT, direction TEXT,
      level INTEGER DEFAULT 1, parent_id TEXT, is_enabled INTEGER DEFAULT 1
    );
    CREATE TABLE init_balances (
      id TEXT PRIMARY KEY, account_set_id TEXT, account_id TEXT, year INTEGER, period INTEGER,
      init_balance REAL, init_debit REAL DEFAULT 0, init_credit REAL DEFAULT 0, aux_item_id TEXT,
      source TEXT
    );
    CREATE TABLE voucher_types (id TEXT PRIMARY KEY, account_set_id TEXT, name TEXT);
    CREATE TABLE vouchers (
      id TEXT PRIMARY KEY, account_set_id TEXT, voucher_date TEXT, year INTEGER, period INTEGER,
      status TEXT, voucher_type_id TEXT
    );
    CREATE TABLE voucher_entries (
      id TEXT PRIMARY KEY, account_set_id TEXT, voucher_id TEXT, account_id TEXT,
      account_code TEXT, account_name TEXT, direction TEXT, amount REAL
    );
  `)
  db.prepare(`INSERT INTO account_sets VALUES (?, '2025-01-01', 2025)`).run(SET_ID)
  db.prepare(
    `INSERT INTO accounts (id, account_set_id, code, name, direction, level) VALUES ('a-1001', ?, '1001', '库存现金', 'debit', 1)`
  ).run(SET_ID)
  db.prepare(`INSERT INTO voucher_types VALUES ('vt-ji', ?, '记')`).run(SET_ID)
  // 2025 年期初 100，本年借 300 贷 50 → 年末 350
  db.prepare(
    `INSERT INTO init_balances VALUES ('ib-2025', ?, 'a-1001', 2025, 1, 100, 100, 0, NULL, 'manual')`
  ).run(SET_ID)
  db.prepare(`INSERT INTO vouchers VALUES ('v1', ?, '2025-03-10', 2025, 3, 'posted', 'vt-ji')`).run(SET_ID)
  db.prepare(
    `INSERT INTO voucher_entries VALUES
       ('e1', ?, 'v1', 'a-1001', '1001', '库存现金', 'debit', 300),
       ('e2', ?, 'v1', 'a-1001', '1001', '库存现金', 'credit', 50)`
  ).run(SET_ID, SET_ID)
  if (withYearCloseRow) {
    db.prepare(
      `INSERT INTO init_balances VALUES ('ib-2026', ?, 'a-1001', 2026, 1, 350, 350, 0, NULL, 'year_close_auto')`
    ).run(SET_ID)
  }
  // 2026 年 1 月借 20
  db.prepare(`INSERT INTO vouchers VALUES ('v2', ?, '2026-01-05', 2026, 1, 'posted', 'vt-ji')`).run(SET_ID)
  db.prepare(
    `INSERT INTO voucher_entries VALUES ('e3', ?, 'v2', 'a-1001', '1001', '库存现金', 'debit', 20)`
  ).run(SET_ID)
  return db
}

function query(db: Database.Database, includeUnposted = false) {
  const q = buildGeneralLedgerQuery({ accountSetId: SET_ID, year: 2026, preBookEnabled: false, includeUnposted })
  expect((q.sql.match(/\?/g) || []).length).toBe(q.params.length)
  return db.prepare(q.sql).get(...q.params) as any
}

describe('FIX-129 年结后总分类账期初', () => {
  it('本年已有年结期初行时，期初 = 年结行，不再累计上年凭证', () => {
    const row = query(setup(true))
    expect(row.init_balance).toBeCloseTo(350, 2)
    expect(row.month1_debit).toBeCloseTo(20, 2)
  })

  it('上年未年结（本年无期初行）时，仍上溯累计上年凭证', () => {
    const row = query(setup(false))
    // 旧口径：无年初行 → 累计上年凭证净额 250（缺上年 init 行 100 属 FIX-153 范围）
    expect(row.init_balance).toBeCloseTo(250, 2)
  })

  it('含未记账：年结期初只含已过账，上年未记账凭证单独累回（不双计已过账）', () => {
    const db = setup(true)
    db.prepare(`INSERT INTO vouchers VALUES ('v-draft', ?, '2025-11-20', 2025, 11, 'draft', 'vt-ji')`).run(SET_ID)
    db.prepare(`INSERT INTO voucher_entries VALUES ('e-draft', ?, 'v-draft', 'a-1001', '1001', '库存现金', 'debit', 15)`).run(SET_ID)
    expect(query(db, false).init_balance).toBeCloseTo(350, 2)
    expect(query(db, true).init_balance).toBeCloseTo(365, 2)
  })

  it('含未记账但期初行为手工录入（非年结）：不额外累计', () => {
    const db = setup(true)
    db.prepare(`UPDATE init_balances SET source = 'manual' WHERE id = 'ib-2026'`).run()
    db.prepare(`INSERT INTO vouchers VALUES ('v-draft', ?, '2025-11-20', 2025, 11, 'draft', 'vt-ji')`).run(SET_ID)
    db.prepare(`INSERT INTO voucher_entries VALUES ('e-draft', ?, 'v-draft', 'a-1001', '1001', '库存现金', 'debit', 15)`).run(SET_ID)
    expect(query(db, true).init_balance).toBeCloseTo(350, 2)
  })
})
