import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { getCashFlowTrialBalance } from '../services/cashFlowTrialBalance.js'

function createTestDb() {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE system_params (
      account_set_id TEXT, param_key TEXT, param_value TEXT
    );
    CREATE TABLE accounts (
      id TEXT PRIMARY KEY, account_set_id TEXT, code TEXT, name TEXT,
      direction TEXT, is_cash INTEGER, is_bank INTEGER, require_cash_flow INTEGER, is_enabled INTEGER
    );
    CREATE TABLE cash_flow_items (
      id TEXT PRIMARY KEY, account_set_id TEXT, code TEXT, name TEXT,
      direction TEXT, parent_code TEXT, level INTEGER, sort_order INTEGER, is_active INTEGER
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
    INSERT INTO system_params VALUES ('set1', 'accounting_standard', 'government');
    INSERT INTO accounts VALUES ('acc-cash', 'set1', '1001', '库存现金', 'debit', 1, 0, 0, 1);
    INSERT INTO accounts VALUES ('acc-exp', 'set1', '5001', '业务活动费用', 'debit', 0, 0, 0, 1);
    INSERT INTO cash_flow_items VALUES ('cf1', 'set1', '1001', '财政拨款收到现金', 'inflow', NULL, 1, 0, 1);
    INSERT INTO cash_flow_items VALUES ('cf2', 'set1', '2001', '购建固定资产支付现金', 'outflow', NULL, 1, 1, 1);
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
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]
    db.prepare(
      `INSERT INTO voucher_entries
       (id, account_set_id, voucher_id, seq, account_id, account_code, direction, amount, cash_flow_code, cash_flow_name)
       VALUES (?, 'set1', ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      e.id,
      id,
      i + 1,
      e.accountId,
      e.accountCode,
      e.direction,
      e.amount,
      e.cashFlowCode || null,
      e.cashFlowCode ? '测试' : null
    )
  }
}

describe('cashFlowTrialBalance', () => {
  let db: Database.Database

  beforeEach(() => {
    db = createTestDb()
  })

  it('政府制度活动标签为日常活动', () => {
    const result = getCashFlowTrialBalance(db, 'set1', 2026, 5)
    expect(result.meta.activityLabels.operating).toBe('日常活动')
    expect(result.meta.accountingStandardName).toContain('政府')
  })

  it('平衡：现金流量项目净额等于现金科目净变动', () => {
    insertVoucher(db, 'v1', '记-1', 'posted', [
      { id: 'e1', accountId: 'acc-cash', accountCode: '1001', direction: 'debit', amount: 1000, cashFlowCode: '1001' },
      { id: 'e2', accountId: 'acc-exp', accountCode: '5001', direction: 'credit', amount: 1000 },
    ])

    const result = getCashFlowTrialBalance(db, 'set1', 2026, 5)
    expect(result.summary.totalNet).toBe(1000)
    expect(result.summary.cashAccountNetChange).toBe(1000)
    expect(result.summary.balanced).toBe(true)
    expect(result.summary.unmatchedCount).toBe(0)
  })

  it('不平衡：现金分录未指定现金流量项目', () => {
    insertVoucher(db, 'v2', '记-2', 'posted', [
      { id: 'e3', accountId: 'acc-cash', accountCode: '1001', direction: 'debit', amount: 500 },
      { id: 'e4', accountId: 'acc-exp', accountCode: '5001', direction: 'credit', amount: 500 },
    ])

    const result = getCashFlowTrialBalance(db, 'set1', 2026, 5)
    expect(result.summary.balanced).toBe(false)
    expect(result.unmatchedCashEntries).toHaveLength(1)
    expect(result.unmatchedCashEntries[0].voucherNo).toBe('记-2')
  })

  it('include_unposted 统计未记账凭证', () => {
    insertVoucher(db, 'v3', '记-3', 'draft', [
      { id: 'e5', accountId: 'acc-cash', accountCode: '1001', direction: 'debit', amount: 200, cashFlowCode: '1001' },
      { id: 'e6', accountId: 'acc-exp', accountCode: '5001', direction: 'credit', amount: 200 },
    ])

    const postedOnly = getCashFlowTrialBalance(db, 'set1', 2026, 5, 'month', false)
    const withDraft = getCashFlowTrialBalance(db, 'set1', 2026, 5, 'month', true)
    expect(postedOnly.summary.totalNet).toBe(0)
    expect(withDraft.summary.totalNet).toBe(200)
  })
})
