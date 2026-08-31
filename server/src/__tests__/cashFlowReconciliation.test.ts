import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'
import { validateStaticCashFlowReport } from '../services/cashFlowReconciliation.js'
import { getDirectMethodActivityTotals } from '../services/cashFlowAmount.js'

describe('validateStaticCashFlowReport', () => {
  it('三大活动净额与现金净增加额一致时通过', () => {
    const result = validateStaticCashFlowReport({
      operatingActivities: { 净额: 100 },
      investingActivities: { 净额: -20 },
      financingActivities: { 净额: 30 },
      netCashChange: 110,
      beginCash: 1000,
      endCash: 1110,
      cashBalanceCheck: true,
    })
    expect(result.isValid).toBe(true)
    expect(result.warnings.filter(w => w.severity === 'error')).toHaveLength(0)
  })

  it('三大活动合计与净增加额不一致时报错', () => {
    const result = validateStaticCashFlowReport({
      operatingActivities: { 净额: 100 },
      investingActivities: { 净额: 0 },
      financingActivities: { 净额: 0 },
      netCashChange: 50,
      beginCash: 0,
      endCash: 50,
      cashBalanceCheck: true,
    })
    expect(result.isValid).toBe(false)
    expect(result.warnings.some(w => w.type === 'cashflow_sum_mismatch')).toBe(true)
  })

  it('期初+净额≠期末时报错', () => {
    const result = validateStaticCashFlowReport({
      operatingActivities: { 净额: 10 },
      investingActivities: { 净额: 0 },
      financingActivities: { 净额: 0 },
      netCashChange: 10,
      beginCash: 100,
      endCash: 200,
      cashBalanceCheck: false,
    })
    expect(result.isValid).toBe(false)
    expect(result.warnings.some(w => w.type === 'cash_balance_mismatch')).toBe(true)
  })
})

describe('getDirectMethodActivityTotals', () => {
  it('按分录现金流量编码汇总经营活动', () => {
    const db = new Database(':memory:')
    const accountSetId = 'set1'
    db.exec(`
      CREATE TABLE account_sets (id TEXT PRIMARY KEY);
      CREATE TABLE vouchers (
        id TEXT PRIMARY KEY, account_set_id TEXT, year INTEGER, period INTEGER, status TEXT
      );
      CREATE TABLE voucher_entries (
        id TEXT, voucher_id TEXT, direction TEXT, amount REAL, cash_flow_code TEXT
      );
      CREATE TABLE cash_flow_items (
        account_set_id TEXT, code TEXT, direction TEXT, is_active INTEGER
      );
    `)
    db.prepare(`INSERT INTO account_sets VALUES (?)`).run(accountSetId)
    db.prepare(
      `INSERT INTO cash_flow_items VALUES (?, '1101', 'inflow', 1)`
    ).run(accountSetId)
    const voucherId = uuidv4()
    db.prepare(`INSERT INTO vouchers VALUES (?, ?, 2026, 5, 'posted')`).run(
      voucherId,
      accountSetId
    )
    db.prepare(
      `INSERT INTO voucher_entries VALUES (?, ?, 'credit', 500, '1101')`
    ).run(uuidv4(), voucherId)

    const totals = getDirectMethodActivityTotals(db, accountSetId, 2026, 5, 5)
    expect(totals.operating).toBe(500)
    expect(totals.itemsWithData).toBe(1)
  })

  it('应按区间汇总多期分录（本年累计）', () => {
    const db = new Database(':memory:')
    const accountSetId = 'set2'
    db.exec(`
      CREATE TABLE account_sets (id TEXT PRIMARY KEY);
      CREATE TABLE vouchers (
        id TEXT PRIMARY KEY, account_set_id TEXT, year INTEGER, period INTEGER, status TEXT
      );
      CREATE TABLE voucher_entries (
        id TEXT, voucher_id TEXT, direction TEXT, amount REAL, cash_flow_code TEXT
      );
      CREATE TABLE cash_flow_items (
        account_set_id TEXT, code TEXT, direction TEXT, is_active INTEGER
      );
    `)
    db.prepare(`INSERT INTO account_sets VALUES (?)`).run(accountSetId)
    db.prepare(`INSERT INTO cash_flow_items VALUES (?, '1101', 'inflow', 1)`).run(accountSetId)
    for (const period of [4, 5]) {
      const voucherId = uuidv4()
      db.prepare(`INSERT INTO vouchers VALUES (?, ?, 2026, ?, 'posted')`).run(
        voucherId,
        accountSetId,
        period
      )
      db.prepare(
        `INSERT INTO voucher_entries VALUES (?, ?, 'credit', 100, '1101')`
      ).run(uuidv4(), voucherId)
    }

    expect(getDirectMethodActivityTotals(db, accountSetId, 2026, 5, 5).operating).toBe(100)
    expect(getDirectMethodActivityTotals(db, accountSetId, 2026, 1, 5).operating).toBe(200)
  })
})
