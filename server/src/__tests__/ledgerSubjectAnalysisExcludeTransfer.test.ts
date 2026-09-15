import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { buildGeneralLedgerQuery } from '../services/ledgerQuery.js'

/**
 * 财务分析（科目分析）取数口径：排除凭证类型为「结转」的凭证。
 * 费用类科目月末结转损益后余额归零，不排除的话 12 月发生额会被结转分录抵消。
 */

const SET_ID = 'set1'

function setup() {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE account_sets (id TEXT PRIMARY KEY, start_date TEXT, fiscal_year INTEGER);
    CREATE TABLE accounts (
      id TEXT PRIMARY KEY, account_set_id TEXT, code TEXT, name TEXT, direction TEXT,
      level INTEGER DEFAULT 1, parent_id TEXT, is_enabled INTEGER DEFAULT 1,
      is_foreign INTEGER DEFAULT 0, currency_code TEXT
    );
    CREATE TABLE init_balances (
      id TEXT PRIMARY KEY, account_set_id TEXT, account_id TEXT, year INTEGER, period INTEGER,
      init_balance REAL, init_debit REAL DEFAULT 0, init_credit REAL DEFAULT 0, aux_item_id TEXT
    );
    CREATE TABLE voucher_types (id TEXT PRIMARY KEY, account_set_id TEXT, name TEXT, is_closing INTEGER DEFAULT 0);
    CREATE TABLE vouchers (
      id TEXT PRIMARY KEY, account_set_id TEXT, voucher_date TEXT, year INTEGER, period INTEGER,
      status TEXT, voucher_type_id TEXT
    );
    CREATE TABLE voucher_entries (
      id TEXT PRIMARY KEY, account_set_id TEXT, voucher_id TEXT, account_id TEXT,
      account_code TEXT, account_name TEXT, direction TEXT, amount REAL
    );
  `)
  db.prepare(`INSERT INTO account_sets VALUES (?, '2026-01-01', 2026)`).run(SET_ID)
  db.prepare(
    `INSERT INTO accounts (id, account_set_id, code, name, direction, level) VALUES
       ('a-6602', ?, '6602', '管理费用', 'debit', 1),
       ('a-6602001', ?, '6602001', '通讯费', 'debit', 2),
       ('a-6602009', ?, '6602009', '职工薪酬', 'debit', 2)`
  ).run(SET_ID, SET_ID, SET_ID)
  db.prepare(`INSERT INTO voucher_types VALUES ('vt-ji', ?, '记', 0), ('vt-jz', ?, '结转', 1)`).run(SET_ID, SET_ID)

  // 12 月：通讯费 450.21、职工薪酬 16341.55（记账凭证）
  db.prepare(`INSERT INTO vouchers VALUES ('v1', ?, '2026-12-10', 2026, 12, 'posted', 'vt-ji')`).run(SET_ID)
  db.prepare(
    `INSERT INTO voucher_entries VALUES
       ('e1', ?, 'v1', 'a-6602001', '6602001', '通讯费', 'debit', 450.21),
       ('e2', ?, 'v1', 'a-6602009', '6602009', '职工薪酬', 'debit', 16341.55)`
  ).run(SET_ID, SET_ID)
  // 12 月末结转损益：贷方同额转出
  db.prepare(`INSERT INTO vouchers VALUES ('v2', ?, '2026-12-31', 2026, 12, 'posted', 'vt-jz')`).run(SET_ID)
  db.prepare(
    `INSERT INTO voucher_entries VALUES
       ('e3', ?, 'v2', 'a-6602001', '6602001', '通讯费', 'credit', 450.21),
       ('e4', ?, 'v2', 'a-6602009', '6602009', '职工薪酬', 'credit', 16341.55)`
  ).run(SET_ID, SET_ID)
  return db
}

function run(db: Database.Database, excludeTransfer: boolean) {
  const q = buildGeneralLedgerQuery({
    accountSetId: SET_ID,
    year: 2026,
    accountCode: '6602',
    excludeTransfer,
    preBookEnabled: false,
  })
  const rows = db.prepare(q.sql).all(...q.params) as any[]
  return new Map(rows.map(r => [r.account_code, r]))
}

describe('科目分析：排除结转凭证', () => {
  it('excludeTransfer 时 12 月贷方为 0，余额等于费用发生额', () => {
    const db = setup()
    const rows = run(db, true)
    const comm = rows.get('6602001')
    const salary = rows.get('6602009')
    expect(comm.month12_debit).toBeCloseTo(450.21, 2)
    expect(comm.month12_credit).toBe(0)
    expect(salary.month12_debit).toBeCloseTo(16341.55, 2)
    expect(salary.month12_credit).toBe(0)
  })

  it('默认口径（总分类账）仍包含结转凭证', () => {
    const db = setup()
    const rows = run(db, false)
    expect(rows.get('6602001').month12_credit).toBeCloseTo(450.21, 2)
    expect(rows.get('6602009').month12_credit).toBeCloseTo(16341.55, 2)
  })

  it('FIX-143：按 is_closing 标志排除（名称「结转结余」也命中），无凭证类型的分录不被连带丢弃', () => {
    const db = setup()
    db.prepare(`INSERT INTO voucher_types VALUES ('vt-jzjy', ?, '结转结余', 1), ('vt-zz', ?, '转账', 1)`).run(SET_ID, SET_ID)
    // 结转结余凭证：通讯费贷 100（应被排除）
    db.prepare(`INSERT INTO vouchers VALUES ('v3', ?, '2026-11-30', 2026, 11, 'posted', 'vt-jzjy')`).run(SET_ID)
    db.prepare(`INSERT INTO voucher_entries VALUES ('e5', ?, 'v3', 'a-6602001', '6602001', '通讯费', 'credit', 100)`).run(SET_ID)
    // 名称不含「结转」但勾了标志（应被排除）
    db.prepare(`INSERT INTO vouchers VALUES ('v4', ?, '2026-11-30', 2026, 11, 'posted', 'vt-zz')`).run(SET_ID)
    db.prepare(`INSERT INTO voucher_entries VALUES ('e6', ?, 'v4', 'a-6602001', '6602001', '通讯费', 'credit', 30)`).run(SET_ID)
    // 无凭证类型的分录：借 7（不能因 INNER JOIN 丢失）
    db.prepare(`INSERT INTO vouchers VALUES ('v5', ?, '2026-11-05', 2026, 11, 'posted', NULL)`).run(SET_ID)
    db.prepare(`INSERT INTO voucher_entries VALUES ('e7', ?, 'v5', 'a-6602001', '6602001', '通讯费', 'debit', 7)`).run(SET_ID)

    const rows = run(db, true)
    const comm = rows.get('6602001')
    expect(comm.month11_credit).toBe(0)
    expect(comm.month11_debit).toBeCloseTo(7, 2)
  })
})
