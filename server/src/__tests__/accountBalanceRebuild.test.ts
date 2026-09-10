import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { rebuildAccountBalances } from '../services/accountBalanceRebuild.js'

const AS = 'as1'

function createDb() {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE accounts (id TEXT PRIMARY KEY, account_set_id TEXT, code TEXT, name TEXT, direction TEXT);
    CREATE TABLE vouchers (id TEXT PRIMARY KEY, account_set_id TEXT, year INTEGER, period INTEGER, status TEXT);
    CREATE TABLE voucher_entries (
      id TEXT PRIMARY KEY, account_set_id TEXT, voucher_id TEXT, account_id TEXT, account_code TEXT, account_name TEXT,
      direction TEXT, amount REAL, amount_cents INTEGER, foreign_amount REAL,
      dept_id TEXT, project_id TEXT, supplier_id TEXT, person_id TEXT, func_class_id TEXT, aux_data TEXT
    );
    CREATE TABLE init_balances (
      id TEXT PRIMARY KEY, account_set_id TEXT, account_id TEXT, year INTEGER, period INTEGER,
      init_balance REAL, aux_item_id TEXT NOT NULL DEFAULT '', foreign_init_balance REAL DEFAULT 0
    );
    CREATE TABLE account_balances (
      id TEXT PRIMARY KEY, account_set_id TEXT, account_id TEXT, account_code TEXT, account_name TEXT, direction TEXT,
      year INTEGER, period INTEGER, init_balance REAL, current_debit REAL, current_credit REAL,
      end_balance REAL, end_debit REAL, end_credit REAL, aux_item_id TEXT,
      foreign_init_balance REAL DEFAULT 0, foreign_current_debit REAL DEFAULT 0,
      foreign_current_credit REAL DEFAULT 0, foreign_end_balance REAL DEFAULT 0,
      UNIQUE(account_set_id, account_id, year, period, aux_item_id)
    );
    INSERT INTO accounts VALUES ('bank', '${AS}', '1002', '银行存款', 'debit');
    INSERT INTO accounts VALUES ('ar', '${AS}', '1122', '应收账款', 'debit');
    INSERT INTO accounts VALUES ('rev', '${AS}', '6001', '主营业务收入', 'credit');
    INSERT INTO accounts VALUES ('fa', '${AS}', '1601', '固定资产', 'debit');
  `)
  return db
}

function addVoucher(db: Database.Database, id: string, period: number, status: string, entries: Array<Partial<{
  account: string; direction: string; amount: number; supplier_id: string | null; aux_data: string | null
}>>) {
  db.prepare(`INSERT INTO vouchers VALUES (?, ?, 2025, ?, ?)`).run(id, AS, period, status)
  let i = 0
  for (const e of entries) {
    const acc = db.prepare(`SELECT code, name FROM accounts WHERE id=?`).get(e.account) as { code: string; name: string }
    db.prepare(
      `INSERT INTO voucher_entries VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, NULL, NULL, ?)`
    ).run(`${id}-${i++}`, AS, id, e.account, acc.code, acc.name, e.direction, e.amount, Math.round(e.amount! * 100), e.supplier_id ?? null, e.aux_data ?? null)
  }
}

describe('rebuildAccountBalances', () => {
  let db: Database.Database
  beforeEach(() => {
    db = createDb()
  })

  it('按 (科目, 年, 期, aux) 汇总已记账凭证发生额，init_balance 取同键期初', () => {
    db.prepare(`INSERT INTO init_balances VALUES ('i1', ?, 'bank', 2025, 1, 1000, '', 0)`).run(AS)
    addVoucher(db, 'v1', 12, 'posted', [
      { account: 'bank', direction: 'debit', amount: 300 },
      { account: 'rev', direction: 'credit', amount: 300 },
    ])
    addVoucher(db, 'v2', 12, 'posted', [
      { account: 'bank', direction: 'credit', amount: 50.5 },
      { account: 'rev', direction: 'debit', amount: 50.5 },
    ])

    const result = rebuildAccountBalances(db, AS)
    expect(result.rows).toBe(2)

    const bank = db
      .prepare(`SELECT * FROM account_balances WHERE account_id='bank' AND period=12`)
      .get() as any
    expect(bank.init_balance).toBe(1000)
    expect(bank.current_debit).toBe(300)
    expect(bank.current_credit).toBe(50.5)
    expect(bank.end_balance).toBeCloseTo(1249.5, 2)
    expect(bank.aux_item_id).toBe('')

    const rev = db.prepare(`SELECT * FROM account_balances WHERE account_id='rev'`).get() as any
    expect(rev.init_balance).toBe(0)
    expect(rev.current_credit).toBe(300)
    expect(rev.current_debit).toBe(50.5)
    expect(rev.end_balance).toBeCloseTo(249.5, 2)
  })

  it('未记账凭证不计入；有期初但当年无凭证的科目补一行 period=1 零发生额', () => {
    db.prepare(`INSERT INTO init_balances VALUES ('i1', ?, 'fa', 2025, 1, 5000, '', 0)`).run(AS)
    addVoucher(db, 'draft', 12, 'draft', [
      { account: 'fa', direction: 'debit', amount: 999 },
      { account: 'bank', direction: 'credit', amount: 999 },
    ])

    rebuildAccountBalances(db, AS)
    const rows = db.prepare(`SELECT * FROM account_balances ORDER BY account_id`).all() as any[]
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ account_id: 'fa', year: 2025, period: 1, init_balance: 5000, current_debit: 0, current_credit: 0 })
  })

  it('辅助分录按 buildAuxItemId 分桶，期初只匹配同键；辅助明细期初不补行避免与汇总行重复', () => {
    db.prepare(`INSERT INTO init_balances VALUES ('i1', ?, 'ar', 2025, 1, 800, '', 0)`).run(AS)
    db.prepare(`INSERT INTO init_balances VALUES ('i2', ?, 'ar', 2025, 1, 800, 'customer:c1', 0)`).run(AS)
    addVoucher(db, 'v1', 12, 'posted', [
      { account: 'ar', direction: 'debit', amount: 100, supplier_id: 'c1', aux_data: JSON.stringify({ customer: { id: 'c1', name: '甲' } }) },
      { account: 'rev', direction: 'credit', amount: 100 },
    ])

    rebuildAccountBalances(db, AS)
    const ar = db.prepare(`SELECT * FROM account_balances WHERE account_id='ar' ORDER BY period, aux_item_id`).all() as any[]
    // 汇总行期初补行 + 辅助分录桶
    expect(ar.map(r => [r.period, r.aux_item_id, r.init_balance, r.current_debit])).toEqual([
      [1, '', 800, 0],
      [12, 'supp:c1|customer:c1', 0, 100],
    ])
  })

  it('幂等：重复执行结果一致，不会累加', () => {
    addVoucher(db, 'v1', 12, 'posted', [
      { account: 'bank', direction: 'debit', amount: 10 },
      { account: 'rev', direction: 'credit', amount: 10 },
    ])
    rebuildAccountBalances(db, AS)
    rebuildAccountBalances(db, AS)
    const bank = db.prepare(`SELECT current_debit FROM account_balances WHERE account_id='bank'`).all() as any[]
    expect(bank).toHaveLength(1)
    expect(bank[0].current_debit).toBe(10)
  })
})
