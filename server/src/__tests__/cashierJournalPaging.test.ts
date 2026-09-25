/**
 * FIX-253：出纳日记账 listJournal 分页——
 *  - 不传 page/page_size：返回全部行（对账 / 现金流量等老调用方口径不变）
 *  - 传分页：本页首行余额 = 区间期初 + 本页之前所有行净额；合计 / 期末与是否分页无关
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { up as cashierJournalFxUp } from '../db/migrations/20260921_cashier_journal_fx.js'

let testDb: Database.Database
vi.mock('../db/index.js', () => ({
  getDb: () => testDb,
}))

import { listJournal } from '../services/cashierQuery.js'

const ASID = 'set-1'

function createDb() {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE cashier_journal (
      id TEXT PRIMARY KEY, account_set_id TEXT, account_code TEXT, currency TEXT DEFAULT 'RMB',
      biz_date TEXT, seq INTEGER DEFAULT 0, summary TEXT, debit REAL DEFAULT 0, credit REAL DEFAULT 0,
      reconciled INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE cashier_init_balance (
      id TEXT PRIMARY KEY, account_set_id TEXT, account_code TEXT, currency TEXT DEFAULT 'RMB', balance REAL DEFAULT 0
    );
    CREATE TABLE system_params (id TEXT PRIMARY KEY, account_set_id TEXT, param_key TEXT, param_value TEXT);
  `)
  cashierJournalFxUp(db)
  db.prepare("INSERT INTO cashier_init_balance VALUES ('ib', ?, '1001', 'RMB', 1000)").run(ASID)
  const ins = db.prepare(
    'INSERT INTO cashier_journal (id, account_set_id, account_code, currency, biz_date, seq, summary, debit, credit) VALUES (?,?,?,?,?,?,?,?,?)'
  )
  // 2025-12-31 一笔（区间前）；2026-01 共 25 笔：奇数行借 10，偶数行贷 3
  ins.run('j0', ASID, '1001', 'RMB', '2025-12-31', 1, '上年', 500, 0)
  for (let i = 1; i <= 25; i++) {
    ins.run(`j${i}`, ASID, '1001', 'RMB', `2026-01-${String(i).padStart(2, '0')}`, i, `第${i}笔`, i % 2 ? 10 : 0, i % 2 ? 0 : 3)
  }
  return db
}

describe('listJournal 分页（FIX-253）', () => {
  beforeEach(() => {
    testDb = createDb()
  })

  const base = { accountSetId: ASID, accountCode: '1001', startDate: '2026-01-01', endDate: '2026-01-31' }

  it('不分页时返回全部行，逐行余额连续', () => {
    const r = listJournal(base)
    expect(r.rows).toHaveLength(25)
    expect(r.total).toBe(25)
    expect(r.page).toBeUndefined()
    expect(r.opening).toBe(1500) // 1000 + 上年 500
    expect(r.totalDebit).toBe(130) // 13 × 10
    expect(r.totalCredit).toBe(36) // 12 × 3
    expect(r.closing).toBe(1500 + 130 - 36)
    expect(r.rows[24].balance).toBe(r.closing)
  })

  it('分页时本页余额从「期初 + 前页净额」续算，合计与期末不受分页影响', () => {
    const full = listJournal(base)
    const p1 = listJournal({ ...base, page: 1, pageSize: 10 })
    const p2 = listJournal({ ...base, page: 2, pageSize: 10 })
    const p3 = listJournal({ ...base, page: 3, pageSize: 10 })
    expect(p1.rows.map(r => r.id)).toEqual(full.rows.slice(0, 10).map(r => r.id))
    expect(p2.rows.map(r => r.id)).toEqual(full.rows.slice(10, 20).map(r => r.id))
    expect(p3.rows).toHaveLength(5)
    expect(p2.rows[0].balance).toBe(full.rows[10].balance)
    expect(p3.rows[4].balance).toBe(full.closing)
    for (const p of [p1, p2, p3]) {
      expect(p.total).toBe(25)
      expect(p.totalDebit).toBe(full.totalDebit)
      expect(p.totalCredit).toBe(full.totalCredit)
      expect(p.closing).toBe(full.closing)
      expect(p.opening).toBe(full.opening)
    }
    expect(p2.page).toBe(2)
    expect(p2.pageSize).toBe(10)
  })

  it('page_size 上限 1000、越界页返回空行但合计仍正确', () => {
    const r = listJournal({ ...base, page: 9, pageSize: 5000 })
    expect(r.pageSize).toBe(1000)
    expect(r.rows).toHaveLength(0)
    expect(r.closing).toBe(1500 + 130 - 36)
  })

  it('评审 P1-1：未传开始日期时期初 = 期初余额，净额不重复计入', () => {
    const r = listJournal({ accountSetId: ASID, accountCode: '1001', endDate: '2026-01-31' })
    expect(r.opening).toBe(1000)
    expect(r.rows).toHaveLength(26)
    expect(r.rows[0].balance).toBe(1500)
    expect(r.closing).toBe(1000 + 500 + 130 - 36)
    expect(r.rows[25].balance).toBe(r.closing)
    // 与传了开始日期的口径接得上
    expect(listJournal(base).closing).toBe(r.closing)
    // 开始 / 结束都不传：期末 = 全部流水
    expect(listJournal({ accountSetId: ASID, accountCode: '1001' }).closing).toBe(1594)
  })

  it('评审 P2：币种与科目不一致的存量行不计入，但返回条数供前端提示', () => {
    testDb.prepare("INSERT INTO cashier_journal (id, account_set_id, account_code, currency, biz_date, seq, debit, credit) VALUES ('x1', ?, '1001', 'USD', '2026-01-10', 99, 7, 0)").run(ASID)
    const r = listJournal(base)
    expect(r.otherCurrencyCount).toBe(1)
    expect(r.closing).toBe(1500 + 130 - 36)
  })
})
