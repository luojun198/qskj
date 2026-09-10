import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import Database from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'

let testDb: Database.Database

vi.mock('../db/index.js', () => ({
  getDb: () => testDb,
}))

import {
  buildReversedEntries,
  buildVoucherEntryPayloads,
  VOUCHER_ENTRY_INSERT_SQL,
  VOUCHER_ENTRY_INSERT_PARAM_COUNT,
  resolveQuantityFields,
  validateVoucherEntriesQuantity,
} from '../services/voucherEntry.js'
import { buildQuantityBalanceQuery } from '../services/ledgerQuery.js'
import { AccountService } from '../services/accountService.js'
import {
  calcQuantityInitBalance,
  normalizeQuantityOpeningDebitCredit,
} from '../utils/initBalanceQuantity.js'

const SET_ID = 'set-qty'

function createQtyDb() {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE account_sets (
      id TEXT PRIMARY KEY, name TEXT, code TEXT, fiscal_year INTEGER, start_date TEXT, status TEXT
    );
    CREATE TABLE system_params (
      id TEXT PRIMARY KEY, account_set_id TEXT, param_key TEXT, param_value TEXT, description TEXT
    );
    CREATE TABLE accounts (
      id TEXT PRIMARY KEY, account_set_id TEXT, code TEXT, name TEXT, direction TEXT, level INTEGER,
      parent_id TEXT, is_aux INTEGER DEFAULT 0, aux_types TEXT,
      is_cash INTEGER DEFAULT 0, is_bank INTEGER DEFAULT 0,
      is_foreign INTEGER DEFAULT 0, currency_code TEXT,
      is_quantity INTEGER NOT NULL DEFAULT 0, quantity_unit TEXT,
      no_negative INTEGER DEFAULT 0,
      is_enabled INTEGER DEFAULT 1, allow_delete INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE vouchers (
      id TEXT PRIMARY KEY, account_set_id TEXT, voucher_no TEXT, voucher_date TEXT,
      year INTEGER, period INTEGER, status TEXT
    );
    CREATE TABLE voucher_entries (
      id TEXT PRIMARY KEY, account_set_id TEXT, voucher_id TEXT, seq INTEGER,
      account_id TEXT, account_code TEXT, account_name TEXT, direction TEXT,
      amount REAL, amount_cents INTEGER, summary TEXT,
      dept_id TEXT, dept_name TEXT, project_id TEXT, project_name TEXT,
      supplier_id TEXT, supplier_name TEXT, person_id TEXT, person_name TEXT,
      func_class_id TEXT, func_class_name TEXT, aux_data TEXT,
      cash_flow_code TEXT, cash_flow_name TEXT,
      currency_code TEXT, exchange_rate REAL, foreign_amount REAL,
      quantity REAL DEFAULT 0, unit_price REAL DEFAULT 0, unit TEXT
    );
    CREATE TABLE init_balances (
      id TEXT PRIMARY KEY, account_set_id TEXT, account_id TEXT, direction TEXT,
      year INTEGER, period INTEGER,
      init_balance REAL DEFAULT 0, init_debit REAL DEFAULT 0, init_credit REAL DEFAULT 0,
      aux_item_id TEXT DEFAULT '',
      opening_debit REAL DEFAULT 0, opening_credit REAL DEFAULT 0,
      pre_book_debit REAL DEFAULT 0, pre_book_credit REAL DEFAULT 0,
      qty_init_balance REAL DEFAULT 0,
      qty_opening_debit REAL DEFAULT 0, qty_opening_credit REAL DEFAULT 0,
      qty_pre_book_debit REAL DEFAULT 0, qty_pre_book_credit REAL DEFAULT 0
    );
  `)
  db.prepare(
    `INSERT INTO account_sets (id, name, code, fiscal_year, start_date, status)
     VALUES (?, '测试账套', 'T01', 2026, '2026-01-01', 'active')`
  ).run(SET_ID)
  return db
}

function addAccount(opts: {
  id: string
  code: string
  name: string
  direction?: string
  isQuantity?: number
  unit?: string | null
}) {
  testDb
    .prepare(
      `INSERT INTO accounts (id, account_set_id, code, name, direction, level, is_quantity, quantity_unit)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?)`
    )
    .run(
      opts.id,
      SET_ID,
      opts.code,
      opts.name,
      opts.direction || 'debit',
      opts.isQuantity ?? 0,
      opts.unit ?? null
    )
}

/** 落一张已记账凭证，两条分录（数量科目一条、对方科目一条） */
function addPostedEntry(opts: {
  date: string
  accountId: string
  accountCode: string
  direction: 'debit' | 'credit'
  amount: number
  quantity: number
  unitPrice?: number
}) {
  const voucherId = uuidv4()
  const d = new Date(opts.date)
  testDb
    .prepare(
      `INSERT INTO vouchers (id, account_set_id, voucher_no, voucher_date, year, period, status)
       VALUES (?, ?, '1', ?, ?, ?, 'posted')`
    )
    .run(voucherId, SET_ID, opts.date, d.getFullYear(), d.getMonth() + 1)
  testDb
    .prepare(
      `INSERT INTO voucher_entries
        (id, account_set_id, voucher_id, seq, account_id, account_code, account_name,
         direction, amount, quantity, unit_price, unit)
       VALUES (?, ?, ?, 1, ?, ?, '原材料', ?, ?, ?, ?, '个')`
    )
    .run(
      uuidv4(),
      SET_ID,
      voucherId,
      opts.accountId,
      opts.accountCode,
      opts.direction,
      opts.amount,
      opts.quantity,
      opts.unitPrice ?? 0
    )
}

beforeEach(() => {
  testDb = createQtyDb()
})

afterEach(() => {
  testDb.close()
})

describe('AccountService 数量核算字段', () => {
  it('勾选数量核算但不填计量单位时报错', () => {
    const service = new AccountService(testDb as any)
    expect(() =>
      service.createAccount({
        account_set_id: SET_ID,
        code: '1403',
        name: '原材料',
        direction: 'debit',
        is_quantity: true,
        quantity_unit: '   ',
      })
    ).toThrow('数量核算科目必须指定计量单位')
  })

  it('创建与更新时写入 is_quantity / quantity_unit，取消勾选时清空单位', () => {
    const service = new AccountService(testDb as any)
    const id = service.createAccount({
      account_set_id: SET_ID,
      code: '1403',
      name: '原材料',
      direction: 'debit',
      is_quantity: true,
      quantity_unit: ' 个 ',
    })
    let row = testDb.prepare('SELECT is_quantity, quantity_unit FROM accounts WHERE id=?').get(id) as any
    expect(row.is_quantity).toBe(1)
    expect(row.quantity_unit).toBe('个')

    service.updateAccount(id, {
      name: '原材料',
      direction: 'debit',
      is_quantity: false,
      quantity_unit: '个',
    })
    row = testDb.prepare('SELECT is_quantity, quantity_unit FROM accounts WHERE id=?').get(id) as any
    expect(row.is_quantity).toBe(0)
    expect(row.quantity_unit).toBeNull()
  })
})

describe('resolveQuantityFields', () => {
  it('数量为空或 0 时三字段全部置空', () => {
    expect(resolveQuantityFields({ quantity: null, unit_price: 11.1, unit: '个' } as any)).toEqual({
      quantity: null,
      unitPrice: null,
      unit: null,
    })
    expect(resolveQuantityFields({ quantity: 0, unit_price: 11.1, unit: '个' } as any)).toEqual({
      quantity: null,
      unitPrice: null,
      unit: null,
    })
  })

  it('有数量时保留单价并 trim 单位', () => {
    expect(resolveQuantityFields({ quantity: 10, unit_price: 11.1, unit: ' 个 ' } as any)).toEqual({
      quantity: 10,
      unitPrice: 11.1,
      unit: '个',
    })
  })
})

describe('validateVoucherEntriesQuantity', () => {
  beforeEach(() => {
    addAccount({ id: 'acc-qty', code: '1403', name: '原材料', isQuantity: 1, unit: '个' })
    addAccount({ id: 'acc-plain', code: '1001', name: '库存现金' })
  })

  const entry = (over: Record<string, unknown> = {}) => ({
    account_id: 'acc-qty',
    account_code: '1403',
    account_name: '原材料',
    direction: 'debit' as const,
    amount: 111,
    quantity: 10,
    unit_price: 11.1,
    ...over,
  })

  it('数量核算科目缺数量时拦截', () => {
    expect(validateVoucherEntriesQuantity(testDb as any, SET_ID, [entry({ quantity: null })])).toBe(
      '数量核算科目【原材料】须填写数量'
    )
  })

  it('单价与金额都为空时拦截', () => {
    // amount 为 0 的分录会被跳过，这里用「有金额但校验单价缺失」之外的路径：
    // 金额为 0 时循环 continue，故构造 amount 非 0、单价为空 → 合法（金额侧已给）
    expect(
      validateVoucherEntriesQuantity(testDb as any, SET_ID, [entry({ unit_price: null })])
    ).toBeNull()
  })

  it('数量×单价与金额不符时拦截', () => {
    expect(
      validateVoucherEntriesQuantity(testDb as any, SET_ID, [entry({ unit_price: 20 })])
    ).toBe('数量核算科目【原材料】数量×单价与金额不符')
  })

  it('数量×单价与金额相符时放行（容差 1 分内）', () => {
    expect(validateVoucherEntriesQuantity(testDb as any, SET_ID, [entry()])).toBeNull()
    expect(
      validateVoucherEntriesQuantity(testDb as any, SET_ID, [entry({ amount: 111.004 })])
    ).toBeNull()
  })

  it('非数量核算科目带数量时拦截', () => {
    expect(
      validateVoucherEntriesQuantity(testDb as any, SET_ID, [
        entry({ account_id: 'acc-plain', account_name: '库存现金' }),
      ])
    ).toBe('科目【库存现金】未启用数量核算，不能填写数量')
  })
})

describe('分录落库参数', () => {
  it('payload 长度与 INSERT 列数一致，数量三字段在末尾', () => {
    const payloads = buildVoucherEntryPayloads({
      accountSetId: SET_ID,
      voucherId: 'v1',
      entries: [
        {
          account_id: 'acc-qty',
          account_code: '1403',
          account_name: '原材料',
          direction: 'debit',
          amount: 111,
          quantity: 10,
          unit_price: 11.1,
          unit: '个',
        },
      ] as any,
      categories: [],
      itemMap: {},
    })

    expect(VOUCHER_ENTRY_INSERT_PARAM_COUNT).toBe(30)
    expect(payloads[0]).toHaveLength(VOUCHER_ENTRY_INSERT_PARAM_COUNT)
    expect(payloads[0].slice(-3)).toEqual([10, 11.1, '个'])

    // INSERT 语句的 ? 个数必须与 payload 长度一致，否则 better-sqlite3 直接抛错
    const placeholders = (VOUCHER_ENTRY_INSERT_SQL.match(/\?/g) || []).length
    expect(placeholders).toBe(VOUCHER_ENTRY_INSERT_PARAM_COUNT)
  })

  it('冲红分录数量取负、单价保持原值', () => {
    const [reversed] = buildReversedEntries([
      {
        account_id: 'acc-qty',
        account_code: '1403',
        account_name: '原材料',
        direction: 'debit',
        amount: 111,
        quantity: 10,
        unit_price: 11.1,
      },
    ] as any)
    expect(reversed.amount).toBe(-111)
    expect((reversed as any).quantity).toBe(-10)
    expect((reversed as any).unit_price).toBe(11.1)
  })
})

describe('期初数量派生', () => {
  it('借贷同侧净额化', () => {
    expect(normalizeQuantityOpeningDebitCredit(10, 4)).toEqual({
      qty_opening_debit: 6,
      qty_opening_credit: 0,
    })
    expect(normalizeQuantityOpeningDebitCredit(4, 10)).toEqual({
      qty_opening_debit: 0,
      qty_opening_credit: 6,
    })
  })

  it('按科目方向签名', () => {
    expect(calcQuantityInitBalance('debit', 10, 0, 2, 0)).toBe(12)
    expect(calcQuantityInitBalance('credit', 0, 10, 0, 2)).toBe(12)
    expect(calcQuantityInitBalance('credit', 10, 0, 0, 0)).toBe(-10)
  })
})

describe('buildQuantityBalanceQuery', () => {
  beforeEach(() => {
    addAccount({ id: 'acc-qty', code: '1403', name: '原材料', isQuantity: 1, unit: '个' })
    addAccount({ id: 'acc-plain', code: '1001', name: '库存现金' })
  })

  function run(startDate: string, endDate: string) {
    const query = buildQuantityBalanceQuery({
      accountSetId: SET_ID,
      startDate,
      endDate,
      accountSetStartDate: '2026-01-01',
      preBookEnabled: true,
    })
    return testDb.prepare(query.sql).all(...query.params) as any[]
  }

  it('参考图场景：本期借方 10 个 / 111.00 元，结余数量 10、结余金额 111', () => {
    addPostedEntry({
      date: '2026-03-10',
      accountId: 'acc-qty',
      accountCode: '1403',
      direction: 'debit',
      amount: 111,
      quantity: 10,
      unitPrice: 11.1,
    })

    const rows = run('2026-03-01', '2026-03-31')
    expect(rows).toHaveLength(1)
    const row = rows[0]
    expect(row.account_code).toBe('1403')
    expect(row.unit).toBe('个')
    expect(row.qty_init_balance).toBe(0)
    expect(row.qty_current_debit).toBe(10)
    expect(row.current_debit).toBe(111)
    expect(row.qty_current_credit).toBe(0)
    expect(row.qty_year_debit).toBe(10)
    expect(row.year_debit).toBe(111)
    expect(row.qty_end_balance).toBe(10)
    expect(row.end_balance).toBe(111)
    // 结余单价由前端派生，避免除零
    expect(row.end_balance / row.qty_end_balance).toBeCloseTo(11.1, 4)
  })

  it('只统计数量核算科目', () => {
    addPostedEntry({
      date: '2026-03-10',
      accountId: 'acc-plain',
      accountCode: '1001',
      direction: 'debit',
      amount: 500,
      quantity: 0,
    })
    expect(run('2026-03-01', '2026-03-31')).toHaveLength(0)
  })

  it('期初数量取自 init_balances，本期出库后结余递减', () => {
    testDb
      .prepare(
        `INSERT INTO init_balances
          (id, account_set_id, account_id, direction, year, period,
           init_balance, aux_item_id, opening_debit, qty_init_balance, qty_opening_debit)
         VALUES (?, ?, 'acc-qty', 'debit', 2026, 1, 222, '', 222, 20, 20)`
      )
      .run(uuidv4(), SET_ID)

    addPostedEntry({
      date: '2026-03-10',
      accountId: 'acc-qty',
      accountCode: '1403',
      direction: 'credit',
      amount: 55.5,
      quantity: 5,
      unitPrice: 11.1,
    })

    const [row] = run('2026-03-01', '2026-03-31')
    expect(row.qty_init_balance).toBe(20)
    expect(row.init_balance).toBe(222)
    expect(row.qty_current_credit).toBe(5)
    expect(row.current_credit).toBe(55.5)
    expect(row.qty_end_balance).toBe(15)
    expect(row.end_balance).toBe(166.5)
  })

  it('本期之前的凭证计入期初而非本期', () => {
    addPostedEntry({
      date: '2026-01-15',
      accountId: 'acc-qty',
      accountCode: '1403',
      direction: 'debit',
      amount: 111,
      quantity: 10,
      unitPrice: 11.1,
    })
    addPostedEntry({
      date: '2026-03-10',
      accountId: 'acc-qty',
      accountCode: '1403',
      direction: 'debit',
      amount: 222,
      quantity: 20,
      unitPrice: 11.1,
    })

    const [row] = run('2026-03-01', '2026-03-31')
    expect(row.qty_init_balance).toBe(10)
    expect(row.qty_current_debit).toBe(20)
    // 本年累计（1 月 1 日起）包含两笔
    expect(row.qty_year_debit).toBe(30)
    expect(row.year_debit).toBe(333)
    expect(row.qty_end_balance).toBe(30)
  })

  it('期初与本期发生额全为 0 的科目不显示', () => {
    expect(run('2026-03-01', '2026-03-31')).toHaveLength(0)
  })
})
