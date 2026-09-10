import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import Database from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'

let testDb: Database.Database

vi.mock('../db/index.js', () => ({
  getDb: () => testDb,
}))
vi.mock('../middleware/index.js', () => ({
  authMiddleware: (_req: unknown, _res: unknown, next: () => void) => next(),
  requirePermission: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  operationLog: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}))

import router from '../routes/ledger.js'

type Layer = {
  route?: { path: string; methods: Record<string, boolean>; stack: Array<{ handle: Function }> }
}

function findHandler(path: string, method: 'get' | 'post') {
  const stack = (router as unknown as { stack: Layer[] }).stack
  const layer = stack.find(l => l.route?.path === path && l.route.methods[method])
  if (!layer?.route) throw new Error(`route ${method} ${path} not found`)
  return layer.route.stack[layer.route.stack.length - 1].handle
}

async function callAuxBalance(body: Record<string, unknown>, accountSetId: string) {
  const handler = findHandler('/aux-balance', 'post')
  let payload: any = null
  let statusCode = 200
  const res = {
    status(code: number) {
      statusCode = code
      return res
    },
    json(data: unknown) {
      payload = data
      return res
    },
  }
  await handler({ body, accountSetId, accountScope: undefined }, res, () => {})
  return { statusCode, payload }
}

function createAuxDb() {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE accounts (
      id TEXT PRIMARY KEY, account_set_id TEXT, code TEXT, name TEXT, direction TEXT, level INTEGER,
      is_foreign INTEGER DEFAULT 0, currency_code TEXT, is_enabled INTEGER DEFAULT 1,
      is_quantity INTEGER DEFAULT 0, quantity_unit TEXT
    );
    CREATE TABLE aux_categories (id TEXT PRIMARY KEY, account_set_id TEXT, code TEXT, name TEXT);
    CREATE TABLE aux_items (
      id TEXT PRIMARY KEY, account_set_id TEXT, type TEXT, code TEXT, name TEXT, status TEXT DEFAULT 'active'
    );
    CREATE TABLE aux_category_fields (
      id TEXT PRIMARY KEY, category_id TEXT, field_key TEXT, field_name TEXT,
      sort_order INTEGER DEFAULT 0, is_enabled INTEGER DEFAULT 1
    );
    CREATE TABLE vouchers (
      id TEXT PRIMARY KEY, account_set_id TEXT, voucher_no TEXT, voucher_date TEXT,
      year INTEGER, period INTEGER, status TEXT
    );
    CREATE TABLE voucher_entries (
      id TEXT PRIMARY KEY, account_set_id TEXT, voucher_id TEXT, account_id TEXT,
      account_code TEXT, account_name TEXT, direction TEXT, amount REAL,
      currency_code TEXT, exchange_rate REAL, foreign_amount REAL, aux_data TEXT,
      quantity REAL DEFAULT 0, unit_price REAL DEFAULT 0, unit TEXT,
      dept_id TEXT, dept_name TEXT, project_id TEXT, project_name TEXT,
      supplier_id TEXT, supplier_name TEXT, person_id TEXT, person_name TEXT,
      func_class_id TEXT, func_class_name TEXT, cash_flow_code TEXT, cash_flow_name TEXT
    );
    CREATE TABLE init_balances (
      id TEXT PRIMARY KEY, account_set_id TEXT, account_id TEXT, direction TEXT,
      year INTEGER, period INTEGER, init_balance REAL, init_debit REAL, init_credit REAL,
      aux_item_id TEXT NOT NULL DEFAULT '', foreign_init_balance REAL DEFAULT 0,
      qty_init_balance REAL DEFAULT 0, qty_opening_debit REAL DEFAULT 0,
      qty_opening_credit REAL DEFAULT 0, qty_pre_book_debit REAL DEFAULT 0,
      qty_pre_book_credit REAL DEFAULT 0
    );
    -- 汇率列数据源：外币模式下路由会读币种期末汇率
    CREATE TABLE currencies (
      id TEXT PRIMARY KEY, account_set_id TEXT, code TEXT, name TEXT, is_base INTEGER DEFAULT 0,
      default_rate REAL DEFAULT 1, end_rate REAL, is_enabled INTEGER DEFAULT 1
    );
    CREATE TABLE exchange_rates (
      id TEXT PRIMARY KEY, account_set_id TEXT, currency_code TEXT, year INTEGER, period INTEGER,
      rate REAL, closing_rate REAL
    );
  `)
  db.prepare(
    `INSERT INTO currencies (id, account_set_id, code, name, is_base, default_rate, end_rate)
     VALUES ('cur-cny', 'as-fx', 'CNY', '人民币', 1, 1, 1)`
  ).run()
  db.prepare(
    `INSERT INTO currencies (id, account_set_id, code, name, is_base, default_rate, end_rate)
     VALUES ('cur-usd', 'as-fx', 'USD', '美元', 0, 7, 7.25)`
  ).run()
  db.prepare(
    `INSERT INTO currencies (id, account_set_id, code, name, is_base, default_rate, end_rate)
     VALUES ('cur-hkd', 'as-fx', 'HKD', '港币', 0, 0.9, 0.92)`
  ).run()
  return db
}

describe('辅助项目余额表 外币模式', () => {
  const accountSetId = 'as-fx'
  const custCatId = 'cat-customer'
  const custA = 'cust-a'
  const custB = 'cust-b'
  const usdAccount = 'acc-usd'
  const hkdAccount = 'acc-hkd'
  const cnyAccount = 'acc-cny'

  beforeEach(() => {
    testDb = createAuxDb()
    testDb
      .prepare(`INSERT INTO aux_categories (id, account_set_id, code, name) VALUES (?, ?, 'customer', '客户')`)
      .run(custCatId, accountSetId)
    testDb
      .prepare(`INSERT INTO aux_items (id, account_set_id, type, code, name) VALUES (?, ?, ?, '001', '客户A')`)
      .run(custA, accountSetId, custCatId)
    testDb
      .prepare(`INSERT INTO aux_items (id, account_set_id, type, code, name) VALUES (?, ?, ?, '002', '客户B')`)
      .run(custB, accountSetId, custCatId)

    const insertAccount = testDb.prepare(
      `INSERT INTO accounts (id, account_set_id, code, name, direction, level, is_foreign, currency_code)
       VALUES (?, ?, ?, ?, 'debit', 2, ?, ?)`
    )
    insertAccount.run(usdAccount, accountSetId, '112201', '应收账款-美元', 1, 'USD')
    insertAccount.run(hkdAccount, accountSetId, '112202', '应收账款-港币', 1, 'HKD')
    insertAccount.run(cnyAccount, accountSetId, '112203', '应收账款-人民币', 0, null)

    // 客户A 美元期初：原币 100，本位币 700
    testDb
      .prepare(
        `INSERT INTO init_balances (
           id, account_set_id, account_id, direction, year, period,
           init_balance, init_debit, init_credit, aux_item_id, foreign_init_balance
         ) VALUES (?, ?, ?, 'debit', 2026, 1, 700, 700, 0, ?, 100)`
      )
      .run(uuidv4(), accountSetId, usdAccount, `customer:${custA}`)

    const insertVoucher = testDb.prepare(
      `INSERT INTO vouchers (id, account_set_id, voucher_no, voucher_date, year, period, status)
       VALUES (?, ?, ?, ?, ?, ?, 'posted')`
    )
    const insertEntry = testDb.prepare(
      `INSERT INTO voucher_entries (
         id, account_set_id, voucher_id, account_id, account_code, account_name, direction, amount,
         currency_code, exchange_rate, foreign_amount, aux_data
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    const auxJson = (id: string, name: string) => JSON.stringify({ customer: { id, name } })

    // 3 月：客户A 美元借方 50 USD = 350；客户B 港币借方 200 HKD = 180；人民币科目 客户A 借 999
    const v1 = uuidv4()
    insertVoucher.run(v1, accountSetId, '记-1', '2026-03-10', 2026, 3)
    insertEntry.run(uuidv4(), accountSetId, v1, usdAccount, '112201', '应收账款-美元', 'debit', 350, 'USD', 7, 50, auxJson(custA, '客户A'))
    insertEntry.run(uuidv4(), accountSetId, v1, hkdAccount, '112202', '应收账款-港币', 'debit', 180, 'HKD', 0.9, 200, auxJson(custB, '客户B'))
    insertEntry.run(uuidv4(), accountSetId, v1, cnyAccount, '112203', '应收账款-人民币', 'debit', 999, null, null, null, auxJson(custA, '客户A'))

    // 4 月：客户A 美元贷方 20 USD = 140
    const v2 = uuidv4()
    insertVoucher.run(v2, accountSetId, '记-2', '2026-04-05', 2026, 4)
    insertEntry.run(uuidv4(), accountSetId, v2, usdAccount, '112201', '应收账款-美元', 'credit', 140, 'USD', 7, 20, auxJson(custA, '客户A'))
  })

  afterEach(() => {
    testDb.close()
  })

  it('外币模式只统计外币科目并返回原币期初/发生/期末，合计按币种分列', async () => {
    const { statusCode, payload } = await callAuxBalance(
      {
        aux_category_ids: custCatId,
        start_date: '2026-04-01',
        end_date: '2026-04-30',
        with_foreign: true,
        page: 1,
        pageSize: 50,
      },
      accountSetId
    )
    expect(statusCode).toBe(200)
    expect(payload.code).toBe(0)

    const rows = payload.data as any[]
    // 人民币科目不应出现
    expect(rows.some(r => r.account_code === '112203')).toBe(false)

    const usdRow = rows.find(r => r.account_code === '112201' && r.aux_id === custA)
    expect(usdRow).toBeTruthy()
    expect(usdRow.currency_code).toBe('USD')
    // 期初 = init_balances 700/100 + 3 月发生 350/50
    expect(usdRow.init_balance).toBeCloseTo(1050, 2)
    expect(usdRow.foreign_init_balance).toBeCloseTo(150, 2)
    expect(usdRow.current_debit).toBeCloseTo(0, 2)
    expect(usdRow.current_credit).toBeCloseTo(140, 2)
    expect(usdRow.foreign_current_debit).toBeCloseTo(0, 2)
    expect(usdRow.foreign_current_credit).toBeCloseTo(20, 2)
    expect(usdRow.end_balance).toBeCloseTo(910, 2)
    expect(usdRow.foreign_end_balance).toBeCloseTo(130, 2)

    const hkdRow = rows.find(r => r.account_code === '112202' && r.aux_id === custB)
    expect(hkdRow).toBeTruthy()
    expect(hkdRow.currency_code).toBe('HKD')
    expect(hkdRow.foreign_init_balance).toBeCloseTo(200, 2)
    expect(hkdRow.foreign_end_balance).toBeCloseTo(200, 2)

    // 本位币合计跨币种相加；原币合计按币种分列
    expect(payload.totals.init_balance).toBeCloseTo(1050 + 180, 2)
    expect(payload.totals.end_balance).toBeCloseTo(910 + 180, 2)
    expect(payload.foreign_totals.USD.foreign_init_balance).toBeCloseTo(150, 2)
    expect(payload.foreign_totals.USD.foreign_current_credit).toBeCloseTo(20, 2)
    expect(payload.foreign_totals.USD.foreign_end_balance).toBeCloseTo(130, 2)
    expect(payload.foreign_totals.HKD.foreign_end_balance).toBeCloseTo(200, 2)
  })

  it('币种筛选只保留该币种的科目与期初', async () => {
    const { payload } = await callAuxBalance(
      {
        aux_category_ids: custCatId,
        start_date: '2026-01-01',
        end_date: '2026-12-31',
        with_foreign: true,
        currency_code: 'hkd',
        page: 1,
        pageSize: 50,
      },
      accountSetId
    )
    const rows = payload.data as any[]
    expect(rows).toHaveLength(1)
    expect(rows[0].account_code).toBe('112202')
    expect(rows[0].currency_code).toBe('HKD')
    expect(rows[0].foreign_current_debit).toBeCloseTo(200, 2)
    expect(Object.keys(payload.foreign_totals)).toEqual(['HKD'])
    expect(payload.totals.current_debit).toBeCloseTo(180, 2)
  })

  it('非外币模式保持原行为：不过滤科目、不返回 foreign_totals', async () => {
    const { payload } = await callAuxBalance(
      {
        aux_category_ids: custCatId,
        start_date: '2026-01-01',
        end_date: '2026-12-31',
        page: 1,
        pageSize: 50,
      },
      accountSetId
    )
    const rows = payload.data as any[]
    expect(rows.some(r => r.account_code === '112203')).toBe(true)
    expect(payload.foreign_totals).toBeUndefined()
    expect(payload.totals.current_debit).toBeCloseTo(350 + 180 + 999, 2)
  })
})
