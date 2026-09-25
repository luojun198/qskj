/**
 * FIX-326：出纳日记账改为强制分页后，导出走服务端数据源 cashierJournal——
 *  - 逐天取数、逐行累计余额，与分页查询的逐行余额 / 期末一致；
 *  - 结算方式、对方科目转名称，关联凭证格式与页面一致；
 *  - 导出路由按数据源校验权限（此前参数模式导出只校验登录）。
 */
import { describe, expect, it, beforeEach, vi } from 'vitest'
import Database from 'better-sqlite3'
import { up as cashierJournalFxUp } from '../db/migrations/20260921_cashier_journal_fx.js'

let testDb: Database.Database
vi.mock('../db/index.js', () => ({ getDb: () => testDb }))
vi.mock('../middleware/index.js', () => ({
  authMiddleware: (_req: unknown, _res: unknown, next: () => void) => next(),
  requirePermission: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  requireAnyPermission: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  operationLog: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}))

import { EXPORT_SOURCES } from '../services/exportSources.js'
import { listJournal } from '../services/cashierQuery.js'
import exportRouter from '../routes/export.js'

const ASID = 'set-1'

function createDb() {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE cashier_journal (
      id TEXT PRIMARY KEY, account_set_id TEXT, account_code TEXT, currency TEXT DEFAULT 'RMB',
      biz_date TEXT, seq INTEGER DEFAULT 0, summary TEXT, debit REAL DEFAULT 0, credit REAL DEFAULT 0,
      settle_type TEXT, bill_no TEXT, counter_unit TEXT, counter_account TEXT, reconciled INTEGER DEFAULT 0,
      voucher_year INTEGER, voucher_month INTEGER, voucher_no TEXT, created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE cashier_init_balance (id TEXT PRIMARY KEY, account_set_id TEXT, account_code TEXT, currency TEXT DEFAULT 'RMB', balance REAL DEFAULT 0);
    CREATE TABLE system_params (id TEXT PRIMARY KEY, account_set_id TEXT, param_key TEXT, param_value TEXT);
    CREATE TABLE settle_type (id TEXT PRIMARY KEY, account_set_id TEXT, code TEXT, name TEXT);
    CREATE TABLE accounts (id TEXT PRIMARY KEY, account_set_id TEXT, code TEXT, name TEXT, is_foreign INTEGER DEFAULT 0, currency_code TEXT);
  `)
  cashierJournalFxUp(db)
  db.prepare("INSERT INTO cashier_init_balance VALUES ('ib', ?, '1001', 'RMB', 1000)").run(ASID)
  db.prepare("INSERT INTO settle_type VALUES ('s1', ?, '01', '现金')").run(ASID)
  db.prepare("INSERT INTO accounts VALUES ('a1', ?, '1001', '库存现金', 0, NULL), ('a2', ?, '6602', '管理费用', 0, NULL)").run(ASID, ASID)
  const ins = db.prepare(
    'INSERT INTO cashier_journal (id, account_set_id, account_code, biz_date, seq, summary, debit, credit, settle_type, counter_account, voucher_year, voucher_month, voucher_no) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)'
  )
  ins.run('j0', ASID, '1001', '2025-12-31', 1, '上年', 500, 0, '01', '6602', null, null, null)
  for (let i = 1; i <= 30; i++) {
    ins.run(`j${i}`, ASID, '1001', `2026-01-${String(1 + (i % 28)).padStart(2, '0')}`, i, `第${i}笔`, i % 2 ? 10 : 0, i % 2 ? 0 : 3, '01', '6602', 2026, 1, i === 1 ? '记-1' : null)
  }
  return db
}

async function collect(it: AsyncIterable<any[]>) {
  const out: any[][] = []
  for await (const r of it) out.push(r)
  return out
}

describe('出纳日记账导出数据源（FIX-326）', () => {
  beforeEach(() => { testDb = createDb() })

  it('逐行余额与分页查询一致，末行余额 = 期末；名称与凭证格式与页面一致', async () => {
    const params = { account_code: '1001', start_date: '2026-01-01', end_date: '2026-01-31' }
    const src = EXPORT_SOURCES.cashierJournal
    const keys = ['biz_date', 'summary', 'settle_type', 'counter_account', 'debit', 'credit', 'balance', 'voucher']
    expect(src.count({ db: testDb, accountSetId: ASID }, params)).toBe(30)
    const rows = await collect(src.rows({ db: testDb, accountSetId: ASID }, params, keys))
    const page = listJournal({ accountSetId: ASID, accountCode: '1001', startDate: '2026-01-01', endDate: '2026-01-31', page: 1, pageSize: 1000 })
    expect(rows).toHaveLength(30)
    expect(rows.map(r => r[6])).toEqual(page.rows.map(r => r.balance))
    expect(rows[29][6]).toBe(page.closing)
    const first = rows[page.rows.findIndex(r => r.id === 'j1')]
    expect(first[2]).toBe('现金')
    expect(first[3]).toBe('6602 管理费用')
    expect(first[7]).toBe('2026-01 记-1')
  })

  it('导出路由按数据源校验权限：无 cashier:journal 拒绝，序时账要求 ledger:detail', async () => {
    const layer = (exportRouter as any).stack.find((l: any) => l.route?.path === '/styled-xlsx')
    const handler = layer.route.stack[layer.route.stack.length - 1].handle
    const call = async (permissions: string[], type: string) => {
      let status = 200
      const res: any = { status(c: number) { status = c; return res }, json() { return res }, setHeader() {}, write() { return true }, end() {}, on() {}, once() {}, emit() {} }
      await handler({ body: { columns: [{ key: 'biz_date', label: '日期' }], source: { type, params: { account_code: '1001' } } }, permissions, accountSetId: ASID }, res)
      return status
    }
    expect(await call(['ledger:detail'], 'cashierJournal')).toBe(403)
    expect(await call(['cashier:journal'], 'chronological')).toBe(403)
  })
})
