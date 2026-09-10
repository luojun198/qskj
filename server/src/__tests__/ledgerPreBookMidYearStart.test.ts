import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { buildGeneralLedgerQuery, buildLedgerGeneralQuery } from '../services/ledgerQuery.js'
import { getBatchBalances, getPeriodRangeSumExcludeTransfer } from '../services/reportBalance.js'

/**
 * FIX-105 回归测试：账套年度中间启用时，「账前发生额」必须计入本年累计。
 *
 * 取自真实账套（车子物流，2025-12-01 启用）的 1002 银行存款：
 *   - 年初余额 opening_debit = 513,540.66
 *   - 账前发生额（1~11 月，旧系统已记账、本系统无凭证明细）
 *       pre_book_debit = 16,756,447.31 / pre_book_credit = 17,173,504.20
 *   - init_balance = 启用时点(12-01)余额 = 513,540.66 + 16,756,447.31 - 17,173,504.20 = 96,483.77
 *   - 12 月凭证：借 1,773,540.00 / 贷 1,730,182.48
 *
 * 外部系统的科目余额表：期初 513,540.66，本年累计借 18,529,987.31 / 贷 18,903,686.68，期末 139,841.29。
 *
 * 旧实现只读 init_balance，期末因它已内含账前净额而侥幸正确，但期初和发生额两列全错。
 */

const OPENING = 513540.66
const PRE_DEBIT = 16756447.31
const PRE_CREDIT = 17173504.2
const INIT_AT_START = 96483.77 // = OPENING + PRE_DEBIT - PRE_CREDIT
const DEC_DEBIT = 1773540.0
const DEC_CREDIT = 1730182.48
const YEAR_DEBIT = 18529987.31 // = PRE_DEBIT + DEC_DEBIT
const YEAR_CREDIT = 18903686.68 // = PRE_CREDIT + DEC_CREDIT
const END_BALANCE = 139841.29

const SET_ID = 'set1'
const ACC_ID = 'acc-1002'

// 6001 主营业务收入：账前累计贷 12,340,467.78（借方同额为期末结转），12 月收入 1,142,724.58
const PL_ACC_ID = 'acc-6001'
const PL_PRE = 12340467.78
const PL_DEC = 1142724.58
const PL_YEAR_TOTAL = 13483192.36 // = PL_PRE + PL_DEC，原软件利润表「本年累计」

function setup(options?: { withPreBookColumns?: boolean }) {
  const withCols = options?.withPreBookColumns !== false
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE account_sets (
      id TEXT PRIMARY KEY,
      start_date TEXT,
      fiscal_year INTEGER
    );
    CREATE TABLE accounts (
      id TEXT PRIMARY KEY,
      account_set_id TEXT,
      code TEXT,
      name TEXT,
      direction TEXT,
      level INTEGER DEFAULT 1,
      parent_id TEXT,
      is_enabled INTEGER DEFAULT 1,
      is_foreign INTEGER DEFAULT 0,
      currency_code TEXT
    );
    CREATE TABLE init_balances (
      id TEXT PRIMARY KEY,
      account_set_id TEXT,
      account_id TEXT,
      year INTEGER,
      period INTEGER,
      init_balance REAL,
      init_debit REAL DEFAULT 0,
      init_credit REAL DEFAULT 0,
      aux_item_id TEXT
      ${withCols ? ', opening_debit REAL DEFAULT 0, opening_credit REAL DEFAULT 0, pre_book_debit REAL DEFAULT 0, pre_book_credit REAL DEFAULT 0' : ''}
    );
    CREATE TABLE voucher_types (
      id TEXT PRIMARY KEY,
      account_set_id TEXT,
      name TEXT
    );
    CREATE TABLE vouchers (
      id TEXT PRIMARY KEY,
      account_set_id TEXT,
      voucher_date TEXT,
      year INTEGER,
      period INTEGER,
      status TEXT,
      voucher_type_id TEXT
    );
    CREATE TABLE voucher_entries (
      id TEXT PRIMARY KEY,
      account_set_id TEXT,
      voucher_id TEXT,
      account_id TEXT,
      account_code TEXT,
      account_name TEXT,
      direction TEXT,
      amount REAL
    );
    CREATE TABLE account_balances (
      id TEXT PRIMARY KEY,
      account_set_id TEXT,
      account_id TEXT,
      year INTEGER,
      period INTEGER,
      current_debit REAL DEFAULT 0,
      current_credit REAL DEFAULT 0,
      aux_item_id TEXT
    );
  `)

  db.prepare(`INSERT INTO account_sets VALUES (?, '2025-12-01', 2025)`).run(SET_ID)
  db.prepare(
    `INSERT INTO accounts (id, account_set_id, code, name, direction, level, is_enabled)
     VALUES (?, ?, '1002', '银行存款', 'debit', 1, 1)`
  ).run(ACC_ID, SET_ID)

  if (withCols) {
    db.prepare(
      `INSERT INTO init_balances
         (id, account_set_id, account_id, year, period, init_balance, aux_item_id,
          opening_debit, opening_credit, pre_book_debit, pre_book_credit)
       VALUES ('ib1', ?, ?, 2025, 1, ?, '', ?, 0, ?, ?)`
    ).run(SET_ID, ACC_ID, INIT_AT_START, OPENING, PRE_DEBIT, PRE_CREDIT)
  } else {
    db.prepare(
      `INSERT INTO init_balances (id, account_set_id, account_id, year, period, init_balance, aux_item_id)
       VALUES ('ib1', ?, ?, 2025, 1, ?, '')`
    ).run(SET_ID, ACC_ID, INIT_AT_START)
  }

  db.prepare(`INSERT INTO voucher_types VALUES ('vt-normal', ?, '记账')`).run(SET_ID)
  db.prepare(`INSERT INTO voucher_types VALUES ('vt-transfer', ?, '结转')`).run(SET_ID)
  db.prepare(
    `INSERT INTO vouchers VALUES ('v1', ?, '2025-12-20', 2025, 12, 'posted', 'vt-normal')`
  ).run(SET_ID)
  db.prepare(
    `INSERT INTO voucher_entries VALUES ('e1', ?, 'v1', ?, '1002', '银行存款', 'debit', ?)`
  ).run(SET_ID, ACC_ID, DEC_DEBIT)
  db.prepare(
    `INSERT INTO voucher_entries VALUES ('e2', ?, 'v1', ?, '1002', '银行存款', 'credit', ?)`
  ).run(SET_ID, ACC_ID, DEC_CREDIT)

  db.prepare(
    `INSERT INTO account_balances VALUES ('ab1', ?, ?, 2025, 12, ?, ?, '')`
  ).run(SET_ID, ACC_ID, DEC_DEBIT, DEC_CREDIT)

  // 损益类科目 6001：账前累计借贷相等（1~11 月已结转），12 月有收入并已结转
  db.prepare(
    `INSERT INTO accounts (id, account_set_id, code, name, direction, level, is_enabled)
     VALUES (?, ?, '6001', '主营业务收入', 'credit', 1, 1)`
  ).run(PL_ACC_ID, SET_ID)
  if (withCols) {
    db.prepare(
      `INSERT INTO init_balances
         (id, account_set_id, account_id, year, period, init_balance, aux_item_id,
          opening_debit, opening_credit, pre_book_debit, pre_book_credit)
       VALUES ('ib2', ?, ?, 2025, 1, 0, '', 0, 0, ?, ?)`
    ).run(SET_ID, PL_ACC_ID, PL_PRE, PL_PRE)
  }
  // 12 月：确认收入（记账凭证，贷方）
  db.prepare(
    `INSERT INTO voucher_entries VALUES ('e3', ?, 'v1', ?, '6001', '主营业务收入', 'credit', ?)`
  ).run(SET_ID, PL_ACC_ID, PL_DEC)
  // 12 月：结转损益（结转凭证，借方）——@jqy 必须把它排除
  db.prepare(
    `INSERT INTO vouchers VALUES ('v2', ?, '2025-12-31', 2025, 12, 'posted', 'vt-transfer')`
  ).run(SET_ID)
  db.prepare(
    `INSERT INTO voucher_entries VALUES ('e4', ?, 'v2', ?, '6001', '主营业务收入', 'debit', ?)`
  ).run(SET_ID, PL_ACC_ID, PL_DEC)

  return db
}

function queryGeneral(db: Database.Database, preBookEnabled: boolean) {
  const q = buildLedgerGeneralQuery({
    accountSetId: SET_ID,
    startDate: '2025-01-01',
    endDate: '2025-12-31',
    accountSetStartDate: '2025-12-01',
    preBookEnabled,
  })
  const rows = db.prepare(q.sql).all(...q.params) as any[]
  return rows.find(r => r.account_code === '1002')!
}

const near = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThan(0.02)

describe('FIX-105 中途启用账套的账前发生额', () => {
  it('科目余额表：期初取年初余额，本年累计含账前发生额，期末不变', () => {
    const db = setup()
    const row = queryGeneral(db, true)

    near(row.init_balance, OPENING)
    near(row.year_debit, YEAR_DEBIT)
    near(row.year_credit, YEAR_CREDIT)
    near(row.end_balance, END_BALANCE)
  })

  it('科目余额表：期初 + 本年累计发生额 = 期末（逐列勾稽）', () => {
    const db = setup()
    const row = queryGeneral(db, true)
    near(row.init_balance + row.year_debit - row.year_credit, row.end_balance)
  })

  it('查询区间起于启用日之后时，账前发生额归入期初而不重复计入发生额', () => {
    const db = setup()
    const q = buildLedgerGeneralQuery({
      accountSetId: SET_ID,
      startDate: '2025-12-01',
      endDate: '2025-12-31',
      accountSetStartDate: '2025-12-01',
      preBookEnabled: true,
    })
    const row = (db.prepare(q.sql).all(...q.params) as any[]).find(r => r.account_code === '1002')!

    near(row.init_balance, INIT_AT_START)
    near(row.current_debit, DEC_DEBIT)
    near(row.current_credit, DEC_CREDIT)
    near(row.end_balance, END_BALANCE)
  })

  it('老库缺 opening / pre_book 列时回退旧口径，不报错', () => {
    const db = setup({ withPreBookColumns: false })
    expect(() => queryGeneral(db, false)).not.toThrow()
    const row = queryGeneral(db, false)
    near(row.init_balance, INIT_AT_START)
    near(row.end_balance, END_BALANCE)
  })

  it('总分类账：账前发生额落在启用前一月，各月合计等于本年累计', () => {
    const db = setup()
    const q = buildGeneralLedgerQuery({
      accountSetId: SET_ID,
      year: 2025,
      accountSetStartDate: '2025-12-01',
      preBookEnabled: true,
    })
    const row = (db.prepare(q.sql).all(...q.params) as any[]).find(r => r.account_code === '1002')!

    near(row.init_balance, OPENING)
    near(row.month11_debit, PRE_DEBIT)
    near(row.month11_credit, PRE_CREDIT)
    near(row.month12_debit, DEC_DEBIT)
    near(row.month12_credit, DEC_CREDIT)

    let sumDebit = 0
    let sumCredit = 0
    for (let m = 1; m <= 12; m++) {
      sumDebit += row[`month${m}_debit`] || 0
      sumCredit += row[`month${m}_credit`] || 0
    }
    near(sumDebit, YEAR_DEBIT)
    near(sumCredit, YEAR_CREDIT)
    near(row.init_balance + sumDebit - sumCredit, END_BALANCE)
  })

  it('报表取数：period=0 返回年初余额，period=12 返回期末余额', () => {
    const db = setup()
    near(getBatchBalances(db, SET_ID, ['1002'], 2025, 0).get('1002') || 0, OPENING)
    near(getBatchBalances(db, SET_ID, ['1002'], 2025, 12).get('1002') || 0, END_BALANCE)
  })

  it('@jqy 损益类：本年累计 = 账前贷方 + 当年非结转贷方（不被结转额抵消）', () => {
    const db = setup()
    const sum = getPeriodRangeSumExcludeTransfer(db, SET_ID, '6001', 2025, 1, 12)
    // 贷方科目取 credit - debit
    near(sum.credit - sum.debit, PL_YEAR_TOTAL)
  })

  it('@jqy 损益类：本月金额只含当月非结转发生额', () => {
    const db = setup()
    const sum = getPeriodRangeSumExcludeTransfer(db, SET_ID, '6001', 2025, 12, 12)
    near(sum.credit - sum.debit, PL_DEC)
  })

  it('@jqy 资产负债类：账前发生额借贷双侧都计入，不按方向单侧取', () => {
    const db = setup()
    const sum = getPeriodRangeSumExcludeTransfer(db, SET_ID, '1002', 2025, 1, 12)
    near(sum.debit, PRE_DEBIT + DEC_DEBIT)
    near(sum.credit, PRE_CREDIT + DEC_CREDIT)
  })

  it('@jqy 区间不覆盖启用前一月时不计入账前发生额', () => {
    const db = setup()
    const sum = getPeriodRangeSumExcludeTransfer(db, SET_ID, '6001', 2025, 12, 12)
    expect(sum.credit).toBeLessThan(PL_PRE)
  })
})
