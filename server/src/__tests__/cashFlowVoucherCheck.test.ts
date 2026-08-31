import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { getCashFlowVoucherCheck } from '../services/cashFlowVoucherCheck.js'

function createTestDb() {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE system_params (account_set_id TEXT, param_key TEXT, param_value TEXT);
    CREATE TABLE accounts (
      id TEXT PRIMARY KEY, account_set_id TEXT, code TEXT, name TEXT,
      direction TEXT, is_cash INTEGER, is_bank INTEGER, is_enabled INTEGER
    );
    CREATE TABLE cash_flow_items (
      id TEXT PRIMARY KEY, account_set_id TEXT, code TEXT, name TEXT,
      direction TEXT, is_active INTEGER
    );
    CREATE TABLE vouchers (
      id TEXT PRIMARY KEY, account_set_id TEXT, voucher_no TEXT, voucher_date TEXT,
      year INTEGER, period INTEGER, status TEXT
    );
    CREATE TABLE voucher_entries (
      id TEXT PRIMARY KEY, account_set_id TEXT, voucher_id TEXT, seq INTEGER,
      account_id TEXT, account_code TEXT, direction TEXT, amount REAL,
      cash_flow_code TEXT, cash_flow_name TEXT
    );
    INSERT INTO system_params VALUES ('set1', 'enable_cash_flow', 'true');
    INSERT INTO accounts VALUES ('acc-cash', 'set1', '1001', '库存现金', 'debit', 1, 0, 1);
    INSERT INTO accounts VALUES ('acc-exp', 'set1', '5001', '业务活动费用', 'debit', 0, 0, 1);
    INSERT INTO cash_flow_items VALUES ('cf1', 'set1', '1101', '销售收现', 'inflow', 1);
  `)
  return db
}

function insertVoucher(
  db: Database.Database,
  id: string,
  no: string,
  status: string,
  entries: Array<{
    id: string
    accountId: string
    accountCode: string
    direction: 'debit' | 'credit'
    amount: number
    cashFlowCode?: string
  }>
) {
  db.prepare(
    `INSERT INTO vouchers (id, account_set_id, voucher_no, voucher_date, year, period, status)
     VALUES (?, 'set1', ?, '2026-05-01', 2026, 5, ?)`
  ).run(id, no, status)
  entries.forEach((e, i) => {
    db.prepare(
      `INSERT INTO voucher_entries
       (id, account_set_id, voucher_id, seq, account_id, account_code, direction, amount, cash_flow_code)
       VALUES (?, 'set1', ?, ?, ?, ?, ?, ?, ?)`
    ).run(e.id, id, i + 1, e.accountId, e.accountCode, e.direction, e.amount, e.cashFlowCode || null)
  })
}

describe('cashFlowVoucherCheck', () => {
  let db: Database.Database

  beforeEach(() => {
    db = createTestDb()
  })

  it('全部通过时 issueCount 为 0', () => {
    insertVoucher(db, 'v1', '记-1', 'posted', [
      { id: 'e1', accountId: 'acc-cash', accountCode: '1001', direction: 'debit', amount: 100, cashFlowCode: '1101' },
      { id: 'e2', accountId: 'acc-exp', accountCode: '5001', direction: 'credit', amount: 100 },
    ])

    const result = getCashFlowVoucherCheck(db, 'set1', 2026, 5)
    expect(result.summary.totalCashEntries).toBe(1)
    expect(result.summary.passed).toBe(true)
    expect(result.summary.issueCount).toBe(0)
  })

  it('检出未指定现金流量项目', () => {
    insertVoucher(db, 'v2', '记-2', 'posted', [
      { id: 'e3', accountId: 'acc-cash', accountCode: '1001', direction: 'debit', amount: 500 },
      { id: 'e4', accountId: 'acc-exp', accountCode: '5001', direction: 'credit', amount: 500 },
    ])

    const result = getCashFlowVoucherCheck(db, 'set1', 2026, 5)
    expect(result.summary.missingCount).toBe(1)
    expect(result.missingEntries[0].voucherNo).toBe('记-2')
    expect(result.summary.passed).toBe(false)
  })

  it('检出无效现金流量项目编码', () => {
    insertVoucher(db, 'v3', '记-3', 'posted', [
      {
        id: 'e5',
        accountId: 'acc-cash',
        accountCode: '1001',
        direction: 'debit',
        amount: 200,
        cashFlowCode: '9999',
      },
      { id: 'e6', accountId: 'acc-exp', accountCode: '5001', direction: 'credit', amount: 200 },
    ])

    const result = getCashFlowVoucherCheck(db, 'set1', 2026, 5)
    expect(result.summary.invalidCodeCount).toBe(1)
    expect(result.invalidCodeEntries[0].cashFlowCode).toBe('9999')
    expect(result.summary.issueCount).toBe(1)
  })

  it('检出非现金科目误填现金流量项目', () => {
    insertVoucher(db, 'v4', '记-4', 'posted', [
      {
        id: 'e7',
        accountId: 'acc-exp',
        accountCode: '5001',
        direction: 'debit',
        amount: 300,
        cashFlowCode: '1101',
      },
      { id: 'e8', accountId: 'acc-cash', accountCode: '1001', direction: 'credit', amount: 300, cashFlowCode: '1101' },
    ])

    const result = getCashFlowVoucherCheck(db, 'set1', 2026, 5)
    expect(result.summary.orphanCount).toBe(1)
    expect(result.orphanEntries[0].accountCode).toBe('5001')
  })
})
