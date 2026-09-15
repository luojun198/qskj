import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'
import {
  buildAuxMultiColumnSettingsKey,
  queryAuxMultiColumnLedger,
  resolveAuxMultiColumnColumnSources,
  saveAuxMultiColumnSettings,
  type AuxMultiColumnLedgerRow,
} from '../services/auxMultiColumnLedgerQuery.js'
import type { AccountScopeContext } from '../services/accountAuthorization.js'

const SET = 'set-1'

let db: Database.Database

// 科目
const ACC = {
  expense: 'acc-expense', // 6602 管理费用（借）
  expenseChild: 'acc-expense-child', // 660201 办公费（借）
  cash: 'acc-cash', // 1001 库存现金（借）
  bank: 'acc-bank', // 1002 银行存款（借）
  payable: 'acc-payable', // 2202 应付账款（贷）
}
const CAT = 'cat-dept'
const ITEM_A = 'item-dept-a'
const ITEM_B = 'item-dept-b'

function createDb() {
  const database = new Database(':memory:')
  database.exec(`
    CREATE TABLE accounts (
      id TEXT PRIMARY KEY, account_set_id TEXT, code TEXT, name TEXT, direction TEXT,
      parent_id TEXT, level INTEGER DEFAULT 1, is_enabled INTEGER DEFAULT 1
    );
    CREATE TABLE aux_categories (id TEXT PRIMARY KEY, account_set_id TEXT, code TEXT, name TEXT);
    CREATE TABLE aux_items (
      id TEXT PRIMARY KEY, account_set_id TEXT, type TEXT, code TEXT, name TEXT, status TEXT DEFAULT 'active'
    );
    CREATE TABLE voucher_types (id TEXT PRIMARY KEY, account_set_id TEXT, name TEXT, is_closing INTEGER DEFAULT 0);
    CREATE TABLE vouchers (
      id TEXT PRIMARY KEY, account_set_id TEXT, voucher_no TEXT, voucher_date TEXT,
      voucher_type_id TEXT, year INTEGER, period INTEGER, status TEXT
    );
    CREATE TABLE voucher_entries (
      id TEXT PRIMARY KEY, account_set_id TEXT, voucher_id TEXT, seq INTEGER,
      account_id TEXT, account_code TEXT, account_name TEXT, direction TEXT, amount REAL,
      summary TEXT, aux_data TEXT,
      dept_id TEXT, dept_name TEXT, project_id TEXT, project_name TEXT,
      supplier_id TEXT, supplier_name TEXT, person_id TEXT, person_name TEXT,
      func_class_id TEXT, func_class_name TEXT, cash_flow_code TEXT, cash_flow_name TEXT
    );
    CREATE TABLE init_balances (
      id TEXT PRIMARY KEY, account_set_id TEXT, account_id TEXT, direction TEXT,
      year INTEGER, period INTEGER, init_balance REAL DEFAULT 0, init_debit REAL DEFAULT 0,
      init_credit REAL DEFAULT 0, aux_item_id TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE system_params (
      id TEXT PRIMARY KEY, account_set_id TEXT, param_key TEXT, param_value TEXT,
      updated_at TEXT
    );
  `)

  const insertAccount = database.prepare(
    'INSERT INTO accounts (id, account_set_id, code, name, direction, parent_id, level) VALUES (?,?,?,?,?,?,?)'
  )
  insertAccount.run(ACC.expense, SET, '6602', '管理费用', 'debit', null, 1)
  insertAccount.run(ACC.expenseChild, SET, '660201', '办公费', 'debit', ACC.expense, 2)
  insertAccount.run(ACC.cash, SET, '1001', '库存现金', 'debit', null, 1)
  insertAccount.run(ACC.bank, SET, '1002', '银行存款', 'debit', null, 1)
  insertAccount.run(ACC.payable, SET, '2202', '应付账款', 'credit', null, 1)

  database
    .prepare('INSERT INTO aux_categories (id, account_set_id, code, name) VALUES (?,?,?,?)')
    .run(CAT, SET, 'dept', '部门')
  const insertItem = database.prepare(
    'INSERT INTO aux_items (id, account_set_id, type, code, name) VALUES (?,?,?,?,?)'
  )
  insertItem.run(ITEM_A, SET, CAT, '001', '销售部')
  insertItem.run(ITEM_B, SET, CAT, '002', '财务部')

  database.prepare('INSERT INTO voucher_types (id, account_set_id, name) VALUES (?,?,?)').run('vt-1', SET, '记')
  return database
}

interface EntrySpec {
  accountId: string
  direction: 'debit' | 'credit'
  amount: number
  /** 用 aux_data JSON 挂辅助项目 */
  auxItemId?: string
  /** 用 dept_id 固定列挂辅助项目 */
  legacyDeptId?: string
  summary?: string
}

const ACCOUNT_META: Record<string, { code: string; name: string }> = {
  [ACC.expense]: { code: '6602', name: '管理费用' },
  [ACC.expenseChild]: { code: '660201', name: '办公费' },
  [ACC.cash]: { code: '1001', name: '库存现金' },
  [ACC.bank]: { code: '1002', name: '银行存款' },
  [ACC.payable]: { code: '2202', name: '应付账款' },
}

function addVoucher(
  date: string,
  no: string,
  entries: EntrySpec[],
  status: 'posted' | 'draft' | 'audited' = 'posted'
) {
  const voucherId = uuidv4()
  db.prepare(
    'INSERT INTO vouchers (id, account_set_id, voucher_no, voucher_date, voucher_type_id, year, period, status) VALUES (?,?,?,?,?,?,?,?)'
  ).run(voucherId, SET, no, date, 'vt-1', Number(date.slice(0, 4)), Number(date.slice(5, 7)), status)
  entries.forEach((entry, index) => {
    const meta = ACCOUNT_META[entry.accountId]
    const auxData = entry.auxItemId
      ? JSON.stringify({
          dept: {
            id: entry.auxItemId,
            name: entry.auxItemId === ITEM_A ? '销售部' : '财务部',
          },
        })
      : null
    db.prepare(
      `INSERT INTO voucher_entries
       (id, account_set_id, voucher_id, seq, account_id, account_code, account_name, direction, amount, summary, aux_data, dept_id, dept_name)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(
      uuidv4(),
      SET,
      voucherId,
      index + 1,
      entry.accountId,
      meta.code,
      meta.name,
      entry.direction,
      entry.amount,
      entry.summary ?? '测试摘要',
      auxData,
      entry.legacyDeptId ?? null,
      entry.legacyDeptId ? '销售部' : null
    )
  })
  return voucherId
}

function baseInput(overrides: Partial<Parameters<typeof queryAuxMultiColumnLedger>[1]> = {}) {
  return {
    accountSetId: SET,
    categoryId: CAT,
    auxItemIds: [ITEM_A],
    year: 2026,
    startMonth: 1,
    endMonth: 12,
    includeUnposted: false,
    ...overrides,
  }
}

const entryRows = (rows: AuxMultiColumnLedgerRow[]) => rows.filter(row => row.row_type === 'entry')
const rowOf = (rows: AuxMultiColumnLedgerRow[], type: AuxMultiColumnLedgerRow['row_type']) =>
  rows.find(row => row.row_type === type)!

beforeEach(() => {
  db = createDb()
})
afterEach(() => {
  db.close()
})

describe('辅助项目多栏明细账 - 对方科目分栏（mode=counter）', () => {
  it('单一对方科目：金额全额落入「本条分录方向 + 对方科目」那一栏', () => {
    addVoucher('2026-03-05', '记-1', [
      { accountId: ACC.expenseChild, direction: 'debit', amount: 300, auxItemId: ITEM_A },
      { accountId: ACC.cash, direction: 'credit', amount: 300 },
    ])
    const data = queryAuxMultiColumnLedger(db, baseInput())
    const entries = entryRows(data.rows)
    expect(entries).toHaveLength(1)
    expect(entries[0].amounts[`d_${ACC.cash}`]).toBe(300)
    expect(entries[0].debit_total).toBe(300)
    expect(entries[0].credit_total).toBe(0)
    expect(entries[0].balance).toBe(300)
    expect(entries[0].direction_label).toBe('借')
    // 对方科目随行返回，供页面「对方科目」列展示
    expect(entries[0].counter_label).toBe('1001 库存现金')
  })

  it('多个对方科目：按金额比例分摊，行内合计仍等于本条分录金额', () => {
    addVoucher('2026-03-06', '记-2', [
      { accountId: ACC.expenseChild, direction: 'debit', amount: 1000, auxItemId: ITEM_A },
      { accountId: ACC.cash, direction: 'credit', amount: 400 },
      { accountId: ACC.bank, direction: 'credit', amount: 600 },
    ])
    const data = queryAuxMultiColumnLedger(db, baseInput())
    const entry = entryRows(data.rows)[0]
    expect(entry.amounts[`d_${ACC.cash}`]).toBe(400)
    expect(entry.amounts[`d_${ACC.bank}`]).toBe(600)
    expect(entry.amounts[`d_${ACC.cash}`] + entry.amounts[`d_${ACC.bank}`]).toBe(1000)
    expect(entry.debit_total).toBe(1000)
  })

  it('分摊尾差补在最后一栏，合计不失衡', () => {
    addVoucher('2026-03-07', '记-3', [
      { accountId: ACC.expenseChild, direction: 'debit', amount: 100, auxItemId: ITEM_A },
      { accountId: ACC.cash, direction: 'credit', amount: 1 },
      { accountId: ACC.bank, direction: 'credit', amount: 2 },
    ])
    const data = queryAuxMultiColumnLedger(db, baseInput())
    const entry = entryRows(data.rows)[0]
    const sum = entry.amounts[`d_${ACC.cash}`] + entry.amounts[`d_${ACC.bank}`]
    expect(Math.round(sum * 100) / 100).toBe(100)
    expect(entry.debit_total).toBe(100)
  })

  it('贷方分录进 c_* 栏，余额转为贷方', () => {
    addVoucher('2026-03-08', '记-4', [
      { accountId: ACC.cash, direction: 'debit', amount: 500 },
      { accountId: ACC.payable, direction: 'credit', amount: 500, auxItemId: ITEM_A },
    ])
    const data = queryAuxMultiColumnLedger(db, baseInput())
    const entry = entryRows(data.rows)[0]
    expect(entry.amounts[`c_${ACC.cash}`]).toBe(500)
    expect(entry.amounts[`d_${ACC.cash}`]).toBe(0)
    expect(entry.credit_total).toBe(500)
    expect(entry.balance).toBe(-500)
    expect(entry.direction_label).toBe('贷')
  })

  it('对方科目编码前缀过滤：不命中的分录不进表', () => {
    addVoucher('2026-03-09', '记-5', [
      { accountId: ACC.expenseChild, direction: 'debit', amount: 200, auxItemId: ITEM_A },
      { accountId: ACC.cash, direction: 'credit', amount: 200 },
    ])
    addVoucher('2026-03-10', '记-6', [
      { accountId: ACC.expenseChild, direction: 'debit', amount: 300, auxItemId: ITEM_A },
      { accountId: ACC.bank, direction: 'credit', amount: 300 },
    ])
    const data = queryAuxMultiColumnLedger(db, baseInput({ accountCode: '1002' }))
    const entries = entryRows(data.rows)
    expect(entries).toHaveLength(1)
    expect(entries[0].amounts[`d_${ACC.bank}`]).toBe(300)
  })

  it('只统计所选辅助项目，其他项目不串行', () => {
    addVoucher('2026-03-11', '记-7', [
      { accountId: ACC.expenseChild, direction: 'debit', amount: 100, auxItemId: ITEM_A },
      { accountId: ACC.cash, direction: 'credit', amount: 100 },
    ])
    addVoucher('2026-03-12', '记-8', [
      { accountId: ACC.expenseChild, direction: 'debit', amount: 999, auxItemId: ITEM_B },
      { accountId: ACC.cash, direction: 'credit', amount: 999 },
    ])
    const data = queryAuxMultiColumnLedger(db, baseInput({ auxItemIds: [ITEM_A] }))
    const entries = entryRows(data.rows)
    expect(entries).toHaveLength(1)
    expect(entries[0].debit_total).toBe(100)
  })

  it('dept_id 固定列存储的辅助项目同样能命中', () => {
    addVoucher('2026-03-13', '记-9', [
      { accountId: ACC.expenseChild, direction: 'debit', amount: 250, legacyDeptId: ITEM_A },
      { accountId: ACC.cash, direction: 'credit', amount: 250 },
    ])
    const data = queryAuxMultiColumnLedger(db, baseInput())
    const entries = entryRows(data.rows)
    expect(entries).toHaveLength(1)
    expect(entries[0].amounts[`d_${ACC.cash}`]).toBe(250)
  })
})

describe('辅助项目多栏明细账 - 辅助项目分栏（mode=aux_item）', () => {
  it('每个辅助项目一栏，按分录方向落借/贷组', () => {
    addVoucher('2026-04-01', '记-10', [
      { accountId: ACC.expenseChild, direction: 'debit', amount: 100, auxItemId: ITEM_A },
      { accountId: ACC.cash, direction: 'credit', amount: 100 },
    ])
    addVoucher('2026-04-02', '记-11', [
      { accountId: ACC.expenseChild, direction: 'debit', amount: 200, auxItemId: ITEM_B },
      { accountId: ACC.cash, direction: 'credit', amount: 200 },
    ])
    const data = queryAuxMultiColumnLedger(
      db,
      baseInput({ mode: 'aux_item', accountId: ACC.expense, auxItemIds: [] })
    )
    const entries = entryRows(data.rows)
    expect(entries).toHaveLength(2)
    expect(entries[0].amounts[`d_${ITEM_A}`]).toBe(100)
    expect(entries[1].amounts[`d_${ITEM_B}`]).toBe(200)
    // 主科目取父科目时含子科目
    expect(data.account?.code).toBe('6602')
    expect(rowOf(data.rows, 'year_total').debit_total).toBe(300)
  })

  it('只统计所选科目（含子科目），其他科目不串', () => {
    addVoucher('2026-04-03', '记-12', [
      { accountId: ACC.expenseChild, direction: 'debit', amount: 100, auxItemId: ITEM_A },
      { accountId: ACC.cash, direction: 'credit', amount: 100 },
    ])
    addVoucher('2026-04-04', '记-13', [
      { accountId: ACC.payable, direction: 'debit', amount: 700, auxItemId: ITEM_A },
      { accountId: ACC.cash, direction: 'credit', amount: 700 },
    ])
    const data = queryAuxMultiColumnLedger(
      db,
      baseInput({ mode: 'aux_item', accountId: ACC.expense, auxItemIds: [] })
    )
    const entries = entryRows(data.rows)
    expect(entries).toHaveLength(1)
    expect(entries[0].debit_total).toBe(100)
  })

  it('缺少科目时返回空结果而不是报错', () => {
    const data = queryAuxMultiColumnLedger(db, baseInput({ mode: 'aux_item', accountId: undefined }))
    expect(data.columns).toEqual([])
    expect(data.rows).toEqual([])
  })
})

describe('辅助项目多栏明细账 - 期初、合计与累计', () => {
  it('期初 = 期初余额表 + 区间前发生额；起始月非 1 月时本年累计含区间前', () => {
    db.prepare(
      `INSERT INTO init_balances (id, account_set_id, account_id, direction, year, period, init_balance, aux_item_id)
       VALUES (?,?,?,?,?,?,?,?)`
    ).run(uuidv4(), SET, ACC.expenseChild, 'debit', 2026, 1, 1000, ITEM_A)

    // 区间前（1 月）
    addVoucher('2026-01-10', '记-14', [
      { accountId: ACC.expenseChild, direction: 'debit', amount: 200, auxItemId: ITEM_A },
      { accountId: ACC.cash, direction: 'credit', amount: 200 },
    ])
    // 区间内（3 月）
    addVoucher('2026-03-10', '记-15', [
      { accountId: ACC.expenseChild, direction: 'debit', amount: 50, auxItemId: ITEM_A },
      { accountId: ACC.cash, direction: 'credit', amount: 50 },
    ])

    const data = queryAuxMultiColumnLedger(db, baseInput({ startMonth: 3, endMonth: 3 }))
    expect(data.initBalance).toBe(1200)
    const init = rowOf(data.rows, 'init')
    expect(init.summary).toBe('期初余额')
    expect(init.balance).toBe(1200)
    expect(init.direction_label).toBe('借')

    const monthTotal = rowOf(data.rows, 'month_total')
    expect(monthTotal.debit_total).toBe(50)
    expect(monthTotal.balance).toBe(1250)

    const yearTotal = rowOf(data.rows, 'year_total')
    // 本年累计 = 区间前 200 + 区间内 50
    expect(yearTotal.debit_total).toBe(250)
    expect(yearTotal.balance).toBe(1250)
  })

  it('1 月起查时期初行显示「上年结转」', () => {
    addVoucher('2026-01-10', '记-16', [
      { accountId: ACC.expenseChild, direction: 'debit', amount: 10, auxItemId: ITEM_A },
      { accountId: ACC.cash, direction: 'credit', amount: 10 },
    ])
    const data = queryAuxMultiColumnLedger(db, baseInput())
    expect(rowOf(data.rows, 'init').summary).toBe('上年结转')
  })

  it('贷方科目的期初余额折算为负数（贷方）', () => {
    db.prepare(
      `INSERT INTO init_balances (id, account_set_id, account_id, direction, year, period, init_balance, aux_item_id)
       VALUES (?,?,?,?,?,?,?,?)`
    ).run(uuidv4(), SET, ACC.payable, 'credit', 2026, 1, 800, ITEM_A)
    addVoucher('2026-03-01', '记-17', [
      { accountId: ACC.cash, direction: 'debit', amount: 100 },
      { accountId: ACC.payable, direction: 'credit', amount: 100, auxItemId: ITEM_A },
    ])
    const data = queryAuxMultiColumnLedger(db, baseInput())
    expect(data.initBalance).toBe(-800)
    expect(rowOf(data.rows, 'init').direction_label).toBe('贷')
    expect(rowOf(data.rows, 'year_total').balance).toBe(-900)
  })

  it('每月一个本月合计行，逐月滚动余额', () => {
    addVoucher('2026-01-05', '记-18', [
      { accountId: ACC.expenseChild, direction: 'debit', amount: 100, auxItemId: ITEM_A },
      { accountId: ACC.cash, direction: 'credit', amount: 100 },
    ])
    addVoucher('2026-02-05', '记-19', [
      { accountId: ACC.expenseChild, direction: 'debit', amount: 300, auxItemId: ITEM_A },
      { accountId: ACC.cash, direction: 'credit', amount: 300 },
    ])
    const data = queryAuxMultiColumnLedger(db, baseInput())
    const monthTotals = data.rows.filter(row => row.row_type === 'month_total')
    expect(monthTotals).toHaveLength(2)
    expect(monthTotals[0].balance).toBe(100)
    expect(monthTotals[1].balance).toBe(400)
    expect(rowOf(data.rows, 'year_total').debit_total).toBe(400)
  })

  it('借贷相抵时方向标记为「平」', () => {
    addVoucher('2026-03-01', '记-20', [
      { accountId: ACC.expenseChild, direction: 'debit', amount: 100, auxItemId: ITEM_A },
      { accountId: ACC.cash, direction: 'credit', amount: 100 },
    ])
    addVoucher('2026-03-02', '记-21', [
      { accountId: ACC.cash, direction: 'debit', amount: 100 },
      { accountId: ACC.expenseChild, direction: 'credit', amount: 100, auxItemId: ITEM_A },
    ])
    const data = queryAuxMultiColumnLedger(db, baseInput())
    expect(rowOf(data.rows, 'year_total').balance).toBe(0)
    expect(rowOf(data.rows, 'year_total').direction_label).toBe('平')
  })
})

describe('辅助项目多栏明细账 - 未记账凭证开关', () => {
  it('默认只统计已记账；打开开关后草稿计入', () => {
    addVoucher('2026-03-01', '记-22', [
      { accountId: ACC.expenseChild, direction: 'debit', amount: 100, auxItemId: ITEM_A },
      { accountId: ACC.cash, direction: 'credit', amount: 100 },
    ])
    addVoucher(
      '2026-03-02',
      '记-23',
      [
        { accountId: ACC.expenseChild, direction: 'debit', amount: 70, auxItemId: ITEM_A },
        { accountId: ACC.cash, direction: 'credit', amount: 70 },
      ],
      'draft'
    )
    expect(entryRows(queryAuxMultiColumnLedger(db, baseInput()).rows)).toHaveLength(1)
    const withDraft = queryAuxMultiColumnLedger(db, baseInput({ includeUnposted: true }))
    expect(entryRows(withDraft.rows)).toHaveLength(2)
    expect(rowOf(withDraft.rows, 'year_total').debit_total).toBe(170)
  })
})

describe('辅助项目多栏明细账 - 栏目设置', () => {
  function seed() {
    addVoucher('2026-03-01', '记-24', [
      { accountId: ACC.expenseChild, direction: 'debit', amount: 100, auxItemId: ITEM_A },
      { accountId: ACC.cash, direction: 'credit', amount: 100 },
    ])
    addVoucher('2026-03-02', '记-25', [
      { accountId: ACC.expenseChild, direction: 'debit', amount: 200, auxItemId: ITEM_A },
      { accountId: ACC.bank, direction: 'credit', amount: 200 },
    ])
  }

  it('栏目发现结果与查询一致（借贷各一栏）', () => {
    seed()
    const input = baseInput()
    const resolved = resolveAuxMultiColumnColumnSources(db, input)
    const data = queryAuxMultiColumnLedger(db, input)
    expect(resolved.columns.map(column => column.key)).toEqual(data.columns.map(column => column.key))
    expect(resolved.columns.map(column => column.key).sort()).toEqual(
      [`d_${ACC.cash}`, `d_${ACC.bank}`, `c_${ACC.cash}`, `c_${ACC.bank}`].sort()
    )
    // 借方组排在贷方组前面
    expect(data.columns[0].side).toBe('debit')
    expect(data.columns[data.columns.length - 1].side).toBe('credit')
  })

  it('禁用栏目后该栏不再出现', () => {
    seed()
    const input = baseInput()
    saveAuxMultiColumnSettings(
      db,
      SET,
      buildAuxMultiColumnSettingsKey(input),
      [{ accountId: `d_${ACC.bank}`, enabled: false, printName: '', sortOrder: 0 }],
      () => uuidv4()
    )
    const data = queryAuxMultiColumnLedger(db, input)
    expect(data.columns.map(column => column.key)).not.toContain(`d_${ACC.bank}`)
    expect(data.columns.map(column => column.key)).toContain(`d_${ACC.cash}`)
  })

  it('打印名称与顺序生效', () => {
    seed()
    const input = baseInput()
    saveAuxMultiColumnSettings(
      db,
      SET,
      buildAuxMultiColumnSettingsKey(input),
      [
        { accountId: `d_${ACC.bank}`, enabled: true, printName: '银行栏', sortOrder: 0 },
        { accountId: `d_${ACC.cash}`, enabled: true, printName: '现金栏', sortOrder: 1 },
      ],
      () => uuidv4()
    )
    const data = queryAuxMultiColumnLedger(db, input)
    const debitColumns = data.columns.filter(column => column.side === 'debit')
    expect(debitColumns[0].key).toBe(`d_${ACC.bank}`)
    expect(debitColumns[0].printName).toBe('银行栏')
    expect(debitColumns[1].printName).toBe('现金栏')
  })

  it('只配置了部分栏目时，已配置的排在前面，其余按编码跟随', () => {
    seed()
    const input = baseInput()
    // 只保存 1002 银行存款一栏，未配置的 1001 库存现金应排在它后面
    saveAuxMultiColumnSettings(
      db,
      SET,
      buildAuxMultiColumnSettingsKey(input),
      [{ accountId: `d_${ACC.bank}`, enabled: true, printName: '', sortOrder: 0 }],
      () => uuidv4()
    )
    const debitColumns = queryAuxMultiColumnLedger(db, input).columns.filter(column => column.side === 'debit')
    expect(debitColumns.map(column => column.key)).toEqual([`d_${ACC.bank}`, `d_${ACC.cash}`])
  })

  it('设置键区分模式、类别、科目与所选项目', () => {
    const counterKey = buildAuxMultiColumnSettingsKey({ categoryId: CAT, auxItemIds: [ITEM_A] })
    const auxKey = buildAuxMultiColumnSettingsKey({
      mode: 'aux_item',
      categoryId: CAT,
      accountId: ACC.expense,
      auxItemIds: [ITEM_A],
    })
    expect(counterKey).not.toBe(auxKey)
    // 项目顺序不影响键
    expect(buildAuxMultiColumnSettingsKey({ categoryId: CAT, auxItemIds: [ITEM_B, ITEM_A] })).toBe(
      buildAuxMultiColumnSettingsKey({ categoryId: CAT, auxItemIds: [ITEM_A, ITEM_B] })
    )
  })
})

describe('辅助项目多栏明细账 - 科目授权', () => {
  const scope = (ids: string[]): AccountScopeContext => ({
    bypass: false,
    restricted: true,
    allowedAccountIds: new Set(ids),
  } as AccountScopeContext)

  it('越权科目上的分录不计入', () => {
    addVoucher('2026-03-01', '记-26', [
      { accountId: ACC.expenseChild, direction: 'debit', amount: 100, auxItemId: ITEM_A },
      { accountId: ACC.cash, direction: 'credit', amount: 100 },
    ])
    const allowed = queryAuxMultiColumnLedger(
      db,
      baseInput({ accountScope: scope([ACC.expenseChild, ACC.cash]) })
    )
    expect(entryRows(allowed.rows)).toHaveLength(1)

    const denied = queryAuxMultiColumnLedger(db, baseInput({ accountScope: scope([ACC.bank]) }))
    expect(entryRows(denied.rows)).toHaveLength(0)
  })

  it('授权范围为空时查不到数据', () => {
    addVoucher('2026-03-01', '记-27', [
      { accountId: ACC.expenseChild, direction: 'debit', amount: 100, auxItemId: ITEM_A },
      { accountId: ACC.cash, direction: 'credit', amount: 100 },
    ])
    const data = queryAuxMultiColumnLedger(db, baseInput({ accountScope: scope([]) }))
    expect(data.rows).toEqual([])
  })
})

describe('辅助项目多栏明细账 - 边界', () => {
  it('现金流量类别被挡掉', () => {
    db.prepare('INSERT INTO aux_categories (id, account_set_id, code, name) VALUES (?,?,?,?)').run(
      'cat-cf',
      SET,
      'cash_flow',
      '现金流量项目'
    )
    db.prepare('INSERT INTO aux_items (id, account_set_id, type, code, name) VALUES (?,?,?,?,?)').run(
      'item-cf',
      SET,
      'cat-cf',
      'CF01',
      '销售商品'
    )
    const data = queryAuxMultiColumnLedger(db, baseInput({ categoryId: 'cat-cf', auxItemIds: ['item-cf'] }))
    expect(data.columns).toEqual([])
    expect(data.rows).toEqual([])
  })

  it('没有任何发生额时不产生空栏目', () => {
    const data = queryAuxMultiColumnLedger(db, baseInput())
    expect(data.columns).toEqual([])
    expect(data.rows).toEqual([])
  })

  it('未指定辅助项目时取该类别下全部启用项目', () => {
    addVoucher('2026-03-01', '记-28', [
      { accountId: ACC.expenseChild, direction: 'debit', amount: 100, auxItemId: ITEM_A },
      { accountId: ACC.cash, direction: 'credit', amount: 100 },
    ])
    addVoucher('2026-03-02', '记-29', [
      { accountId: ACC.expenseChild, direction: 'debit', amount: 200, auxItemId: ITEM_B },
      { accountId: ACC.cash, direction: 'credit', amount: 200 },
    ])
    const data = queryAuxMultiColumnLedger(db, baseInput({ auxItemIds: [] }))
    expect(entryRows(data.rows)).toHaveLength(2)
    expect(rowOf(data.rows, 'year_total').debit_total).toBe(300)
  })
})
