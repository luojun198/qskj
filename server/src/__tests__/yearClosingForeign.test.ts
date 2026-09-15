import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import {
  buildYearEndBalances,
  detectYearCloseColumnSupport,
  writeNextYearInitBalances,
} from '../services/yearClosing.js'

/**
 * FIX-140 / GL-03：年结必须把外币余额与数量结存一并结转到下年期初。
 * 老库（无外币/数量列）走降级路径，只写本位币。
 */

function createDb(withExtraColumns: boolean) {
  const db = new Database(':memory:')
  const foreignIb = withExtraColumns
    ? `foreign_init_balance REAL NOT NULL DEFAULT 0,
       foreign_opening_debit REAL NOT NULL DEFAULT 0,
       foreign_opening_credit REAL NOT NULL DEFAULT 0,
       foreign_pre_book_debit REAL NOT NULL DEFAULT 0,
       foreign_pre_book_credit REAL NOT NULL DEFAULT 0,
       qty_init_balance REAL NOT NULL DEFAULT 0,
       qty_opening_debit REAL NOT NULL DEFAULT 0,
       qty_opening_credit REAL NOT NULL DEFAULT 0,
       qty_pre_book_debit REAL NOT NULL DEFAULT 0,
       qty_pre_book_credit REAL NOT NULL DEFAULT 0,`
    : ''
  const foreignVe = withExtraColumns ? 'foreign_amount REAL, quantity REAL DEFAULT 0,' : ''
  db.exec(`
    CREATE TABLE accounts (
      id TEXT PRIMARY KEY, account_set_id TEXT NOT NULL, code TEXT NOT NULL, name TEXT NOT NULL,
      direction TEXT NOT NULL, is_enabled INTEGER DEFAULT 1
    );
    CREATE TABLE init_balances (
      id TEXT PRIMARY KEY, account_set_id TEXT NOT NULL, account_id TEXT NOT NULL, direction TEXT NOT NULL,
      year INTEGER NOT NULL, period INTEGER NOT NULL,
      init_balance REAL NOT NULL DEFAULT 0, init_debit REAL NOT NULL DEFAULT 0, init_credit REAL NOT NULL DEFAULT 0,
      aux_item_id TEXT NOT NULL DEFAULT '', created_at TEXT DEFAULT (datetime('now')),
      opening_debit REAL NOT NULL DEFAULT 0, opening_credit REAL NOT NULL DEFAULT 0,
      pre_book_debit REAL NOT NULL DEFAULT 0, pre_book_credit REAL NOT NULL DEFAULT 0,
      ${foreignIb}
      source TEXT NOT NULL DEFAULT 'manual',
      UNIQUE(account_set_id, account_id, year, period, aux_item_id)
    );
    CREATE TABLE vouchers (
      id TEXT PRIMARY KEY, account_set_id TEXT NOT NULL, voucher_no TEXT NOT NULL, voucher_date TEXT NOT NULL,
      year INTEGER NOT NULL, period INTEGER NOT NULL, status TEXT NOT NULL
    );
    CREATE TABLE voucher_entries (
      id TEXT PRIMARY KEY, account_set_id TEXT NOT NULL, voucher_id TEXT NOT NULL, seq INTEGER NOT NULL,
      account_id TEXT NOT NULL, account_code TEXT NOT NULL, account_name TEXT NOT NULL,
      direction TEXT NOT NULL, amount REAL NOT NULL, ${foreignVe}
      dept_id TEXT, project_id TEXT, supplier_id TEXT, person_id TEXT, func_class_id TEXT, aux_data TEXT
    );
  `)
  db.prepare("INSERT INTO accounts VALUES ('usd', 'set-1', '1002001', '中行美元户', 'debit', 1)").run()
  db.prepare("INSERT INTO accounts VALUES ('mat', 'set-1', '1403', '原材料', 'debit', 1)").run()
  db.prepare("INSERT INTO vouchers VALUES ('v1', 'set-1', '记-1', '2025-06-10', 2025, 6, 'posted')").run()
  return db
}

describe('FIX-140 年结结转外币与数量期初', () => {
  it('外币账套：下年 foreign_init_balance = 上年原币期初 + 全年原币净发生额；数量同理', () => {
    const db = createDb(true)
    expect(detectYearCloseColumnSupport(db)).toEqual({ foreign: true, qty: true })
    // 2025 期初：USD 户 本位币 700 / 原币 100；原材料 本位币 1000 / 数量 10
    db.prepare(
      `INSERT INTO init_balances (id, account_set_id, account_id, direction, year, period, init_balance, init_debit, foreign_init_balance, foreign_opening_debit)
       VALUES ('ib1', 'set-1', 'usd', 'debit', 2025, 1, 700, 700, 100, 100)`
    ).run()
    db.prepare(
      `INSERT INTO init_balances (id, account_set_id, account_id, direction, year, period, init_balance, init_debit, qty_init_balance, qty_opening_debit)
       VALUES ('ib2', 'set-1', 'mat', 'debit', 2025, 1, 1000, 1000, 10, 10)`
    ).run()
    // 全年：USD 借 350（50 美元）、贷 140（20 美元）；原材料 贷 300（3 个）
    const ins = db.prepare(
      `INSERT INTO voucher_entries (id, account_set_id, voucher_id, seq, account_id, account_code, account_name, direction, amount, foreign_amount, quantity)
       VALUES (?, 'set-1', 'v1', ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    ins.run('e1', 1, 'usd', '1002001', '中行美元户', 'debit', 350, 50, 0)
    ins.run('e2', 2, 'usd', '1002001', '中行美元户', 'credit', 140, 20, 0)
    ins.run('e3', 3, 'mat', '1403', '原材料', 'credit', 300, null, 3)

    const rows = buildYearEndBalances(db, 'set-1', 2025)
    const usd = rows.find(r => r.accountId === 'usd')!
    const mat = rows.find(r => r.accountId === 'mat')!
    expect(usd.initBalance).toBe(910)
    expect(usd.foreignInitBalance).toBe(130)
    expect(usd.foreignInitDebit).toBe(130)
    expect(mat.initBalance).toBe(700)
    expect(mat.qtyInitBalance).toBe(7)
    expect(mat.qtyInitDebit).toBe(7)

    const result = writeNextYearInitBalances({ db, accountSetId: 'set-1', sourceYear: 2025, rows })
    expect(result.inserted).toBe(2)
    const next = db
      .prepare(
        `SELECT account_id, init_balance, foreign_init_balance, foreign_opening_debit, foreign_opening_credit, qty_init_balance, qty_opening_debit, source
         FROM init_balances WHERE year = 2026 ORDER BY account_id`
      )
      .all() as any[]
    expect(next).toEqual([
      {
        account_id: 'mat',
        init_balance: 700,
        foreign_init_balance: 0,
        foreign_opening_debit: 0,
        foreign_opening_credit: 0,
        qty_init_balance: 7,
        qty_opening_debit: 7,
        source: 'year_close_auto',
      },
      {
        account_id: 'usd',
        init_balance: 910,
        foreign_init_balance: 130,
        foreign_opening_debit: 130,
        foreign_opening_credit: 0,
        qty_init_balance: 0,
        qty_opening_debit: 0,
        source: 'year_close_auto',
      },
    ])
  })

  it('本位币归零但原币/数量未归零的科目仍要结转（不能被本位币为 0 过滤掉）', () => {
    const db = createDb(true)
    db.prepare(
      `INSERT INTO voucher_entries (id, account_set_id, voucher_id, seq, account_id, account_code, account_name, direction, amount, foreign_amount, quantity)
       VALUES ('e1', 'set-1', 'v1', 1, 'usd', '1002001', '中行美元户', 'debit', 0, 5, 0)`
    ).run()
    const rows = buildYearEndBalances(db, 'set-1', 2025)
    expect(rows).toHaveLength(1)
    expect(rows[0].foreignInitBalance).toBe(5)
  })

  it('老库缺外币/数量列时降级：只结转本位币，不报错', () => {
    const db = createDb(false)
    expect(detectYearCloseColumnSupport(db)).toEqual({ foreign: false, qty: false })
    db.prepare(
      `INSERT INTO voucher_entries (id, account_set_id, voucher_id, seq, account_id, account_code, account_name, direction, amount)
       VALUES ('e1', 'set-1', 'v1', 1, 'usd', '1002001', '中行美元户', 'debit', 350)`
    ).run()
    const rows = buildYearEndBalances(db, 'set-1', 2025)
    expect(rows[0]).toMatchObject({ initBalance: 350, foreignInitBalance: 0, qtyInitBalance: 0 })
    const result = writeNextYearInitBalances({ db, accountSetId: 'set-1', sourceYear: 2025, rows })
    expect(result.inserted).toBe(1)
    expect((db.prepare('SELECT init_balance FROM init_balances WHERE year=2026').get() as any).init_balance).toBe(350)
  })
})
