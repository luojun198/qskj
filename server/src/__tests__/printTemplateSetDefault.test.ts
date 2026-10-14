import { describe, it, expect, beforeEach, vi } from 'vitest'
import Database from 'better-sqlite3'

let testDb: Database.Database

vi.mock('../db/index.js', () => ({
  getDb: () => testDb,
  getDeployDir: () => '.',
}))
vi.mock('../middleware/index.js', () => ({
  authMiddleware: (_req: unknown, _res: unknown, next: () => void) => next(),
  operationLog: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}))

import router from '../routes/basePrintTemplate.js'

type Layer = { route?: { path: string; methods: Record<string, boolean>; stack: Array<{ handle: Function }> } }

function findHandler(path: string, method: 'get' | 'post') {
  const layer = (router as unknown as { stack: Layer[] }).stack.find(l => l.route?.path === path && l.route.methods[method])
  if (!layer?.route) throw new Error(`route ${method} ${path} not found`)
  return layer.route.stack[layer.route.stack.length - 1].handle
}

async function setDefault(id: string) {
  let payload: any = null
  const res = { status: () => res, json: (d: unknown) => { payload = d; return res } }
  await findHandler('/print-templates/default/:id', 'post')({ params: { id }, accountSetId: 'A' }, res, () => {})
  return payload
}

const defaults = () =>
  (testDb.prepare('SELECT id FROM print_templates WHERE is_default=1 ORDER BY id').all() as Array<{ id: string }>).map(r => r.id)

describe('设置默认打印模版只影响同一类模版', () => {
  beforeEach(() => {
    testDb = new Database(':memory:')
    testDb.exec(`CREATE TABLE print_templates (id TEXT, account_set_id TEXT, template_type TEXT, template_key TEXT,
      is_default INTEGER DEFAULT 0, updated_at TEXT)`)
    const ins = testDb.prepare('INSERT INTO print_templates VALUES (?, ?, ?, ?, ?, NULL)')
    ins.run('v1', 'A', 'voucher', null, 1)
    ins.run('v2', 'A', 'voucher', null, 0)
    ins.run('l-detail-1', 'A', 'ledger', 'detail', 1)
    ins.run('l-detail-2', 'A', 'ledger', 'detail', 0)
    ins.run('l-general', 'A', 'ledger', 'general', 1)
    ins.run('other-set', 'B', 'ledger', 'detail', 1)
  })

  it('给明细账设默认，不清掉凭证、总账和其他账套的默认', async () => {
    const r = await setDefault('l-detail-2')
    expect(r.code).toBe(0)
    expect(defaults()).toEqual(['l-detail-2', 'l-general', 'other-set', 'v1'])
  })

  it('凭证模版（无 key）之间切换默认', async () => {
    await setDefault('v2')
    expect(defaults()).toEqual(['l-detail-1', 'l-general', 'other-set', 'v2'])
  })
})
