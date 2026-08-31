import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { getAccountRealtimeAuxBalance } from '../services/accountRealtimeBalance.js'
import { buildAuxVoucherEntryFilter } from '../utils/auxLedgerQuery.js'

describe('buildAuxVoucherEntryFilter', () => {
  it('person 类目占位符与参数个数一致', () => {
    const { sql, params } = buildAuxVoucherEntryFilter('person', 'p1', null)
    const placeholders = (sql.match(/\?/g) || []).length
    expect(placeholders).toBe(params.length)
    expect(params).toEqual(['p1', 'p1', 'p1'])
  })

  it('cash_flow 类目含 code 时占位符与参数一致', () => {
    const { sql, params } = buildAuxVoucherEntryFilter('cash_flow', 'cf-id', '01')
    const placeholders = (sql.match(/\?/g) || []).length
    expect(placeholders).toBe(params.length)
    expect(sql).toContain('cash_flow_code')
    expect(params).toContain('01')
  })
})

describe('getAccountRealtimeAuxBalance cash_flow', () => {
  it('不应抛出 Too many parameter values', () => {
    const db = new Database(':memory:')
    db.exec(`
      CREATE TABLE accounts (id TEXT, direction TEXT);
      CREATE TABLE init_balances (
        account_id TEXT, year INTEGER, account_set_id TEXT, aux_item_id TEXT,
        init_balance REAL, init_debit REAL, init_credit REAL
      );
      CREATE TABLE vouchers (id TEXT, year INTEGER, period INTEGER);
      CREATE TABLE voucher_entries (
        account_id TEXT, account_set_id TEXT, voucher_id TEXT,
        direction TEXT, amount REAL, aux_data TEXT, cash_flow_code TEXT
      );
      CREATE TABLE aux_items (id TEXT, account_set_id TEXT, code TEXT, name TEXT);
    `)
    db.prepare(`INSERT INTO accounts VALUES ('a1', 'debit')`).run()
    db.prepare(`INSERT INTO aux_items VALUES ('cf1', 's1', '01', '现金流入')`).run()

    expect(() =>
      getAccountRealtimeAuxBalance(db, {
        accountId: 'a1',
        accountSetId: 's1',
        year: 2026,
        period: 5,
        categoryCode: 'cash_flow',
        itemId: 'cf1',
        accountDirection: 'debit',
      })
    ).not.toThrow()
  })
})
