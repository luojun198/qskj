import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'
import {
  buildIndirectMethodSchedule,
  calcNetProfitForPeriod,
} from '../services/cashFlowIndirectMethod.js'

function seedSmallBusinessSet(db: Database, accountSetId: string) {
  db.exec(`
    CREATE TABLE account_sets (id TEXT PRIMARY KEY);
    CREATE TABLE accounts (
      id TEXT PRIMARY KEY,
      account_set_id TEXT,
      code TEXT,
      name TEXT,
      direction TEXT,
      parent_id TEXT,
      is_enabled INTEGER DEFAULT 1
    );
    CREATE TABLE init_balances (
      id TEXT PRIMARY KEY,
      account_set_id TEXT,
      account_id TEXT,
      year INTEGER,
      init_balance REAL,
      aux_item_id TEXT DEFAULT ''
    );
    CREATE TABLE account_balances (
      id TEXT PRIMARY KEY,
      account_set_id TEXT,
      account_id TEXT,
      year INTEGER,
      period INTEGER,
      current_debit REAL,
      current_credit REAL
    );
    CREATE TABLE voucher_types (id TEXT PRIMARY KEY, account_set_id TEXT, name TEXT, is_closing INTEGER DEFAULT 0);
    CREATE TABLE vouchers (
      id TEXT PRIMARY KEY, account_set_id TEXT, voucher_type_id TEXT,
      year INTEGER, period INTEGER, status TEXT
    );
    CREATE TABLE voucher_entries (
      id TEXT PRIMARY KEY, account_set_id TEXT, voucher_id TEXT,
      account_id TEXT, direction TEXT, amount REAL
    );
  `)

  db.prepare(`INSERT INTO account_sets VALUES (?)`).run(accountSetId)

  const accounts: Array<[string, string, string, string]> = [
    ['5001', '5001', '主营业务收入', 'credit'],
    ['5401', '5401', '主营业务成本', 'debit'],
    ['1602', '1602', '累计折旧', 'credit'],
    ['1122', '1122', '应收账款', 'debit'],
    ['2202', '2202', '应付账款', 'credit'],
    ['3103', '3103', '本年利润', 'credit'],
  ]

  for (const [id, code, name, direction] of accounts) {
    db.prepare(
      `INSERT INTO accounts (id, account_set_id, code, name, direction, parent_id, is_enabled)
       VALUES (?, ?, ?, ?, ?, NULL, 1)`
    ).run(id, accountSetId, code, name, direction)
  }

  // 工作资本项目（应收/应付/累计折旧）仍以 account_balances 建模（间接法 balanceChange 取数）
  const bal = (accountId: string, period: number, debit: number, credit: number) => {
    db.prepare(`INSERT INTO account_balances VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
      uuidv4(),
      accountSetId,
      accountId,
      2026,
      period,
      debit,
      credit
    )
  }
  bal('1602', 4, 0, 50)
  bal('1602', 5, 0, 80)
  bal('1122', 4, 200, 0)
  bal('1122', 5, 300, 0)
  bal('2202', 4, 0, 100)
  bal('2202', 5, 0, 150)

  // 损益（收入/费用）以凭证建模：净利润须用「排除结转凭证的发生额」计算（P1-19）。
  db.prepare(`INSERT INTO voucher_types VALUES ('vt-jz', ?, '记账', 0)`).run(accountSetId)
  db.prepare(`INSERT INTO voucher_types VALUES ('vt-jzz', ?, '结转', 1)`).run(accountSetId)
  const addVoucher = (id: string, typeId: string, period: number) =>
    db.prepare(`INSERT INTO vouchers VALUES (?, ?, ?, 2026, ?, 'posted')`).run(id, accountSetId, typeId, period)
  const addEntry = (voucherId: string, accountId: string, direction: string, amount: number) =>
    db
      .prepare(`INSERT INTO voucher_entries VALUES (?, ?, ?, ?, ?, ?)`)
      .run(uuidv4(), accountSetId, voucherId, accountId, direction, amount)

  // 记账凭证：确认收入 1000、结转成本 600（业务发生额）
  addVoucher('v-biz', 'vt-jz', 5)
  addEntry('v-biz', '5001', 'credit', 1000)
  addEntry('v-biz', '5401', 'debit', 600)

  // 结转凭证：把收入转入本年利润（借 5001 / 贷 3103）。
  // 该凭证类型为「结转」，净利润计算须排除它，否则 5001 净额被冲成 0。
  addVoucher('v-close', 'vt-jzz', 5)
  addEntry('v-close', '5001', 'debit', 1000)
  addEntry('v-close', '3103', 'credit', 1000)
}

describe('cashFlowIndirectMethod', () => {
  it('应计算净利润及间接法经营活动净额', () => {
    const db = new Database(':memory:')
    const accountSetId = 'set-indirect'
    seedSmallBusinessSet(db, accountSetId)

    const profit = calcNetProfitForPeriod(db, accountSetId, 2026, 5, undefined, 'ytd')
    expect(profit.profitLabel).toBe('净利润')
    expect(profit.netProfit).toBe(400)

    const schedule = buildIndirectMethodSchedule(db, accountSetId, 2026, 5, 'ytd')
    expect(schedule.netProfit).toBe(400)
    expect(schedule.adjustments.some(a => a.label.includes('折旧'))).toBe(true)
    // ytd：400 + 折旧130(0→130) - 应收500(0→500) + 应付250(0→250)
    expect(schedule.operatingCashNet).toBe(280)
  })
})
