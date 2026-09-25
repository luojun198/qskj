import { describe, it, expect, beforeEach, vi } from 'vitest'
import Database from 'better-sqlite3'

let testDb: Database.Database

vi.mock('../db/index.js', () => ({
  getDb: () => testDb,
}))
vi.mock('../middleware/index.js', () => ({
  authMiddleware: (_req: unknown, _res: unknown, next: () => void) => next(),
  requirePermission: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  operationLog: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}))
vi.mock('../middleware/cashierPermission.js', () => ({
  cashierPermissionGuard: (_req: unknown, _res: unknown, next: () => void) => next(),
}))

import router from '../routes/cashierJournal.js'
import { up as cashierPeriodClosingUp } from '../db/migrations/20260916_cashier_period_closing.js'

/**
 * 评审 P1-5：出纳生成凭证 / 删除出纳凭证 / 附件端点的科目授权。
 * 受限用户只授权 1001，1002 与对方科目 6602 不在白名单内。
 */
const AS = 'as1'
const scope = { bypass: false, restricted: true, allowedAccountIds: new Set(['a1001']) }

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
  await handlerOf(path, method)({ body: {}, params: {}, query: {}, accountSetId: AS, accountScope: scope, ...req }, res, () => {})
  return { statusCode, payload }
}

beforeEach(() => {
  testDb = new Database(':memory:')
  testDb.exec(`
    CREATE TABLE accounts (id TEXT PRIMARY KEY, account_set_id TEXT, code TEXT, name TEXT);
    CREATE TABLE cashier_journal (id TEXT PRIMARY KEY, account_set_id TEXT, account_code TEXT, biz_date TEXT,
      counter_account TEXT, voucher_no TEXT, voucher_id TEXT, voucher_year INTEGER, voucher_month INTEGER);
    CREATE TABLE cashier_attachments (id TEXT PRIMARY KEY, account_set_id TEXT, journal_id TEXT, filename TEXT,
      original_name TEXT, file_path TEXT, file_size INTEGER, mime_type TEXT, created_at TEXT, created_by TEXT);
  `)
  testDb.prepare("INSERT INTO accounts VALUES ('a1001', ?, '1001', '库存现金'), ('a1002', ?, '1002', '银行存款'), ('a6602', ?, '6602', '管理费用')").run(AS, AS, AS)
  testDb.prepare("INSERT INTO cashier_journal (id, account_set_id, account_code, biz_date, counter_account) VALUES ('j1', ?, '1001', '2026-08-01', '6602'), ('j2', ?, '1002', '2026-08-01', NULL)").run(AS, AS)
})

describe('评审 P1-5：出纳端点科目授权', () => {
  it('生成凭证：对方科目越权时拒绝', async () => {
    const r = await call('/cashier/generate-voucher', 'post', { body: { account_code: '1001', ids: ['j1'] } })
    expect(r.statusCode).toBe(403)
  })

  it('生成凭证：出纳科目越权时拒绝', async () => {
    const r = await call('/cashier/generate-voucher', 'post', { body: { account_code: '1002' } })
    expect(r.statusCode).toBe(403)
  })

  it('删除出纳凭证：受限用户不指定科目时拒绝', async () => {
    const r = await call('/cashier/delete-vouchers', 'post', { body: {} })
    expect(r.statusCode).toBe(403)
  })

  it('附件：查看白名单外科目日记账的附件被拒绝，白名单内正常', async () => {
    expect((await call('/cashier/journal/:id/attachments', 'get', { params: { id: 'j2' } })).statusCode).toBe(403)
    const ok = await call('/cashier/journal/:id/attachments', 'get', { params: { id: 'j1' } })
    expect(ok.statusCode).toBe(200)
    expect(ok.payload).toEqual({ code: 0, data: [] })
  })
})

describe('评审 P2：日记账修改 / 删除出纳凭证的闸口', () => {
  const open = { bypass: true, restricted: false, allowedAccountIds: new Set<string>() }
  beforeEach(() => {
    testDb.exec(`
      ALTER TABLE cashier_journal ADD COLUMN currency TEXT DEFAULT 'RMB';
      ALTER TABLE cashier_journal ADD COLUMN debit REAL DEFAULT 0;
      ALTER TABLE cashier_journal ADD COLUMN credit REAL DEFAULT 0;
      ALTER TABLE cashier_journal ADD COLUMN exchange_rate REAL DEFAULT 1;
      ALTER TABLE cashier_journal ADD COLUMN base_debit REAL DEFAULT 0;
      ALTER TABLE cashier_journal ADD COLUMN base_credit REAL DEFAULT 0;
      ALTER TABLE cashier_journal ADD COLUMN reconciled INTEGER DEFAULT 0;
      ALTER TABLE cashier_journal ADD COLUMN summary TEXT;
      ALTER TABLE cashier_journal ADD COLUMN seq INTEGER DEFAULT 0;
      ALTER TABLE cashier_journal ADD COLUMN settle_type TEXT;
      ALTER TABLE cashier_journal ADD COLUMN bill_no TEXT;
      ALTER TABLE cashier_journal ADD COLUMN counter_unit TEXT;
      ALTER TABLE cashier_journal ADD COLUMN bank_name TEXT;
      ALTER TABLE cashier_journal ADD COLUMN bank_account TEXT;
      ALTER TABLE cashier_journal ADD COLUMN updated_at TEXT;
      CREATE TABLE vouchers (id TEXT PRIMARY KEY, account_set_id TEXT, voucher_no TEXT, status TEXT, source TEXT, year INTEGER, period INTEGER, voucher_type_id TEXT, voucher_date TEXT);
    `)
    cashierPeriodClosingUp(testDb)
    testDb.prepare("UPDATE cashier_journal SET debit=100, voucher_no='记-1', voucher_id='v1', counter_account='6602' WHERE id='j1'").run()
  })

  it('已生成凭证的行改金额被拒，只改摘要可以', async () => {
    const bad = await call('/cashier/journal/:id', 'put', { params: { id: 'j1' }, accountScope: open, body: { debit: 120, credit: 0 } })
    expect(bad.statusCode).toBe(400)
    expect(bad.payload.message).toContain('已生成凭证')
    const ok = await call('/cashier/journal/:id', 'put', { params: { id: 'j1' }, accountScope: open, body: { debit: 100, credit: 0, summary: '改摘要' } })
    expect(ok.statusCode).toBe(200)
  })

  it('勾选行删除出纳凭证时，即使带了日期区间也逐张过出纳结账闸', async () => {
    testDb.prepare("INSERT INTO vouchers VALUES ('v1', ?, '记-1', 'draft', 'cashier', 2026, 8, NULL, '2026-08-01')").run(AS)
    testDb.prepare("INSERT INTO cashier_period_closing (id, account_set_id, year, month, status) VALUES ('c8', ?, 2026, 8, 'closed')").run(AS)
    const r = await call('/cashier/delete-vouchers', 'post', {
      accountScope: open, body: { account_code: '1001', ids: ['j1'], start_date: '2026-09-01', end_date: '2026-09-30' },
    })
    expect(r.statusCode).toBe(400)
    expect(r.payload.message).toContain('已结账')
  })
})
