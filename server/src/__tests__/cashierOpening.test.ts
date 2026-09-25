/**
 * FIX-261 / FIX-262：读入总账余额——年初 + 启用月前已记账发生额；外币取原币；父级汇总末级；未记账凭证不计
 */
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { getGlOpeningBalance } from '../services/cashierOpening.js'

const AS = 'as1'

describe('cashierOpening', () => {
  let db: Database.Database
  beforeEach(() => {
    db = new Database(':memory:')
    db.exec(`
      CREATE TABLE accounts (id TEXT PRIMARY KEY, account_set_id TEXT, code TEXT, direction TEXT, parent_id TEXT);
      CREATE TABLE init_balances (id TEXT, account_set_id TEXT, account_id TEXT, year INTEGER, init_balance REAL,
        foreign_init_balance REAL DEFAULT 0, aux_item_id TEXT);
      CREATE TABLE vouchers (id TEXT PRIMARY KEY, year INTEGER, period INTEGER, status TEXT);
      CREATE TABLE voucher_entries (id TEXT, account_set_id TEXT, voucher_id TEXT, account_id TEXT, direction TEXT,
        amount REAL, foreign_amount REAL, currency_code TEXT);
    `)
    db.exec(`
      INSERT INTO accounts VALUES ('a1001', '${AS}', '1001', 'debit', NULL);
      INSERT INTO accounts VALUES ('a1002', '${AS}', '1002', 'debit', NULL);
      INSERT INTO accounts VALUES ('a100201', '${AS}', '100201', 'debit', 'a1002');
      INSERT INTO accounts VALUES ('a100202', '${AS}', '100202', 'debit', 'a1002');
      INSERT INTO init_balances VALUES ('i1', '${AS}', 'a1001', 2026, 5000, 0, NULL);
      INSERT INTO init_balances VALUES ('i2', '${AS}', 'a100201', 2026, 1000, 0, NULL);
      INSERT INTO init_balances VALUES ('i3', '${AS}', 'a100202', 2026, 7200, 1000, NULL);
      INSERT INTO vouchers VALUES ('v7', 2026, 7, 'posted'), ('v8', 2026, 8, 'posted'), ('v7d', 2026, 7, 'draft');
      -- 7 月已记账发生额计入 8 月启用前余额；8 月的、未记账的不计
      INSERT INTO voucher_entries VALUES ('e1', '${AS}', 'v7', 'a1001', 'debit', 300, NULL, NULL);
      INSERT INTO voucher_entries VALUES ('e2', '${AS}', 'v7', 'a1001', 'credit', 100, NULL, NULL);
      INSERT INTO voucher_entries VALUES ('e3', '${AS}', 'v8', 'a1001', 'debit', 999, NULL, NULL);
      INSERT INTO voucher_entries VALUES ('e5', '${AS}', 'v7d', 'a1001', 'debit', 777, NULL, NULL);
      INSERT INTO voucher_entries VALUES ('e4', '${AS}', 'v7', 'a100202', 'debit', 720, 100, 'USD');
    `)
  })

  it('读入总账余额：年初 + 启用月之前已记账发生额（草稿不计）', () => {
    expect(getGlOpeningBalance(db, AS, '1001', 'RMB', '2026-08-01', 'RMB')).toBe(5200)
    // 1 月启用：只有年初
    expect(getGlOpeningBalance(db, AS, '1001', 'RMB', '2026-01-01', 'RMB')).toBe(5000)
  })

  it('读入总账余额：父级汇总末级；外币取原币；无此科目返回 null', () => {
    expect(getGlOpeningBalance(db, AS, '1002', 'RMB', '2026-08-01', 'RMB')).toBe(1000 + 7200 + 720)
    expect(getGlOpeningBalance(db, AS, '100202', 'USD', '2026-08-01', 'RMB')).toBe(1100)
    expect(getGlOpeningBalance(db, AS, '9999', 'RMB', '2026-08-01', 'RMB')).toBeNull()
  })
})
