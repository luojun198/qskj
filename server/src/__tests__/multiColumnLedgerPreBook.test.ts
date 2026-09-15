import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { queryMultiColumnLedger } from '../services/multiColumnLedgerQuery.js'

/**
 * FIX-149 / FIX-150：通用多栏账
 *  - 期初 = 年初余额（opening）+ 归属日早于区间起点的账前发生额（不再用启用时点 init_balance 一刀切）
 *  - 本年累计包含账前发生额（此前入参收了不用）
 */
const SET = 'set-1'

function createDb() {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE accounts (
      id TEXT PRIMARY KEY, account_set_id TEXT, code TEXT, name TEXT, direction TEXT,
      parent_id TEXT, level INTEGER DEFAULT 1, is_enabled INTEGER DEFAULT 1
    );
    CREATE TABLE voucher_types (id TEXT PRIMARY KEY, account_set_id TEXT, name TEXT, is_closing INTEGER DEFAULT 0);
    CREATE TABLE vouchers (
      id TEXT PRIMARY KEY, account_set_id TEXT, voucher_no TEXT, voucher_date TEXT,
      voucher_type_id TEXT, year INTEGER, period INTEGER, status TEXT
    );
    CREATE TABLE voucher_entries (
      id TEXT PRIMARY KEY, account_set_id TEXT, voucher_id TEXT, seq INTEGER,
      account_id TEXT, account_code TEXT, account_name TEXT, direction TEXT, amount REAL, summary TEXT
    );
    CREATE TABLE init_balances (
      id TEXT PRIMARY KEY, account_set_id TEXT, account_id TEXT, direction TEXT,
      year INTEGER, period INTEGER, init_balance REAL DEFAULT 0, init_debit REAL DEFAULT 0,
      init_credit REAL DEFAULT 0, aux_item_id TEXT NOT NULL DEFAULT '',
      opening_debit REAL DEFAULT 0, opening_credit REAL DEFAULT 0,
      pre_book_debit REAL DEFAULT 0, pre_book_credit REAL DEFAULT 0
    );
    CREATE TABLE system_params (id TEXT PRIMARY KEY, account_set_id TEXT, param_key TEXT, param_value TEXT);
  `)
  const acc = db.prepare('INSERT INTO accounts (id, account_set_id, code, name, direction, parent_id, level) VALUES (?,?,?,?,?,?,?)')
  acc.run('main', SET, '6602', '管理费用', 'debit', null, 1)
  acc.run('c1', SET, '660201', '办公费', 'debit', 'main', 2)
  acc.run('c2', SET, '660202', '差旅费', 'debit', 'main', 2)
  // 账套 2026-03-15 启用：办公费 年初 0，账前借方 1000（1/1~3/14 的累计），启用时点余额 1000
  db.prepare(
    `INSERT INTO init_balances (id, account_set_id, account_id, direction, year, period, init_balance, init_debit, opening_debit, pre_book_debit)
     VALUES ('ib1', ?, 'c1', 'debit', 2026, 1, 1000, 1000, 0, 1000)`
  ).run(SET)
  db.prepare(`INSERT INTO voucher_types VALUES ('vt', ?, '记', 0)`).run(SET)
  db.prepare(`INSERT INTO vouchers VALUES ('v1', ?, '记-1', '2026-04-10', 'vt', 2026, 4, 'posted')`).run(SET)
  db.prepare(`INSERT INTO voucher_entries VALUES ('e1', ?, 'v1', 1, 'c2', '660202', '差旅费', 'debit', 200, '出差')`).run(SET)
  return db
}

const base = { accountSetId: SET, mainAccountId: 'main', year: 2026, accountSetStartDate: '2026-03-15', preBookEnabled: true }

describe('FIX-149/150 多栏账账前发生额', () => {
  it('查 1~2 月（区间早于账前归属日 3/14）：期初取年初余额 0，本年累计不含账前', () => {
    const r = queryMultiColumnLedger(createDb(), { ...base, startMonth: 1, endMonth: 2 })
    expect(r.initBalance).toBe(0)
    const yearTotal = r.rows.find(row => row.row_type === 'year_total')!
    expect(yearTotal.amounts['c1']).toBe(0)
  })

  it('查 4 月（区间晚于账前归属日）：期初含账前 1000，本年累计含账前 1000 + 当年凭证 200', () => {
    const r = queryMultiColumnLedger(createDb(), { ...base, startMonth: 4, endMonth: 4 })
    expect(r.initBalance).toBe(1000)
    const yearTotal = r.rows.find(row => row.row_type === 'year_total')!
    expect(yearTotal.amounts['c1']).toBe(1000)
    expect(yearTotal.amounts['c2']).toBe(200)
  })

  it('老库缺 opening / pre_book 列（preBookEnabled=false）：回退 init_balance 口径', () => {
    const r = queryMultiColumnLedger(createDb(), { ...base, preBookEnabled: false, startMonth: 1, endMonth: 2 })
    expect(r.initBalance).toBe(1000)
  })
})
