/**
 * 收付款单审核写入的出纳流水：出纳侧不得删除，不得改金额 / 日期 / 对方科目 / 辅助项（摘要可改）。
 * 否则删除会连带删掉单据凭证、让往来台账悬空；改金额会让流水与单据 / 凭证对不上。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import Database from 'better-sqlite3'

let testDb: Database.Database

vi.mock('../db/index.js', () => ({
  getDb: () => testDb,
}))
vi.mock('../middleware/index.js', () => ({
  authMiddleware: (_req: unknown, _res: unknown, next: () => void) => next(),
  requirePermission: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  requireAnyPermission: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  operationLog: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}))
vi.mock('../middleware/cashierPermission.js', () => ({
  cashierPermissionGuard: (_req: unknown, _res: unknown, next: () => void) => next(),
}))

import router from '../routes/cashierJournal.js'
import { up as cashierPeriodClosingUp } from '../db/migrations/20260916_cashier_period_closing.js'

const AS = 'as1'
const open = { bypass: true, restricted: false, allowedAccountIds: new Set<string>() }

type Layer = {
  route?: { path: string; methods: Record<string, boolean>; stack: Array<{ handle: Function }> }
}

function handlerOf(path: string, method: 'get' | 'post' | 'put' | 'delete') {
  const layer = (router as unknown as { stack: Layer[] }).stack.find(
    l => l.route?.path === path && l.route.methods[method]
  )
  if (!layer?.route) throw new Error(`route ${method} ${path} not found`)
  return layer.route.stack[layer.route.stack.length - 1].handle
}

async function call(path: string, method: 'get' | 'post' | 'put' | 'delete', req: Record<string, unknown>) {
  let statusCode = 200
  let payload: any = null
  const res = {
    status(code: number) { statusCode = code; return res },
    json(data: unknown) { payload = data; return res },
  }
  await handlerOf(path, method)({ body: {}, params: {}, query: {}, accountSetId: AS, accountScope: open, ...req }, res, () => {})
  return { statusCode, payload }
}

beforeEach(() => {
  testDb = new Database(':memory:')
  testDb.exec(`
    CREATE TABLE accounts (id TEXT PRIMARY KEY, account_set_id TEXT, code TEXT, name TEXT);
    CREATE TABLE cashier_journal (id TEXT PRIMARY KEY, account_set_id TEXT, account_code TEXT, biz_date TEXT,
      counter_account TEXT, counter_aux_item_id TEXT, voucher_no TEXT, voucher_id TEXT, voucher_year INTEGER, voucher_month INTEGER,
      currency TEXT DEFAULT 'RMB', debit REAL DEFAULT 0, credit REAL DEFAULT 0, exchange_rate REAL DEFAULT 1,
      base_debit REAL DEFAULT 0, base_credit REAL DEFAULT 0, reconciled INTEGER DEFAULT 0, summary TEXT, seq INTEGER DEFAULT 0,
      settle_type TEXT, bill_no TEXT, counter_unit TEXT, bank_name TEXT, bank_account TEXT, updated_at TEXT);
    CREATE TABLE scm_ar_ap_log (id TEXT, account_set_id TEXT, doc_type TEXT, doc_no TEXT, cashier_journal_id TEXT);
    CREATE TABLE scm_doc (id TEXT, account_set_id TEXT, doc_type TEXT, doc_no TEXT, voucher_id TEXT);
    CREATE TABLE vouchers (id TEXT PRIMARY KEY, account_set_id TEXT, voucher_no TEXT, status TEXT, source TEXT, year INTEGER, period INTEGER, voucher_type_id TEXT, voucher_date TEXT);
  `)
  cashierPeriodClosingUp(testDb)
  testDb.prepare("INSERT INTO accounts VALUES ('a1002', ?, '1002', '银行存款'), ('a1122', ?, '1122', '应收账款')").run(AS, AS)
  testDb.prepare(`INSERT INTO cashier_journal (id, account_set_id, account_code, biz_date, counter_account, debit, base_debit, summary)
    VALUES ('j1', ?, '1002', '2026-09-05', '1122', 100, 100, '收款'), ('j2', ?, '1002', '2026-09-05', '1122', 50, 50, '手工')`).run(AS, AS)
  testDb.prepare("INSERT INTO scm_doc VALUES ('d1', ?, 'RCV', 'SK-001', NULL)").run(AS)
  testDb.prepare("INSERT INTO scm_ar_ap_log VALUES ('l1', ?, 'RCV', 'SK-001', 'j1')").run(AS)
})

describe('收付款来源流水的出纳侧护栏', () => {
  it('改金额被拒，提示到供应链反审核', async () => {
    const r = await call('/cashier/journal/:id', 'put', { params: { id: 'j1' }, body: { debit: 120, credit: 0 } })
    expect(r.statusCode).toBe(400)
    expect(r.payload.message).toContain('收款单 SK-001')
  })

  it('改对方科目被拒', async () => {
    const r = await call('/cashier/journal/:id', 'put', { params: { id: 'j1' }, body: { counter_account: '6602' } })
    expect(r.statusCode).toBe(400)
  })

  it('只改摘要可以（前端带上原金额与原辅助项）', async () => {
    const r = await call('/cashier/journal/:id', 'put', {
      params: { id: 'j1' }, body: { debit: 100, credit: 0, summary: '改摘要', counter_aux_item_id: null },
    })
    expect(r.statusCode).toBe(200)
    expect((testDb.prepare("SELECT summary FROM cashier_journal WHERE id='j1'").get() as any).summary).toBe('改摘要')
  })

  it('删除被拒，往来台账不悬空', async () => {
    const r = await call('/cashier/journal/:id', 'delete', { params: { id: 'j1' } })
    expect(r.statusCode).toBe(400)
    expect(r.payload.message).toContain('反审核')
    expect(testDb.prepare("SELECT COUNT(*) c FROM cashier_journal WHERE id='j1'").get()).toMatchObject({ c: 1 })
  })

  it('手工流水不受影响：可改金额', async () => {
    const r = await call('/cashier/journal/:id', 'put', { params: { id: 'j2' }, body: { debit: 60, credit: 0 } })
    expect(r.statusCode).toBe(200)
  })
})
