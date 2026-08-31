import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  getCashBankLeavesByRootCode,
  getDashboardPeriod,
  getFinancialResultReportLink,
  INCOME_PREDICATE,
  EXPENSE_PREDICATE,
  queryPeriodFlow,
} from '../routes/dashboard.js'

describe('dashboard financial result report link', () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    db.exec(`
      CREATE TABLE report_definitions (
        id TEXT PRIMARY KEY,
        account_set_id TEXT NOT NULL,
        code TEXT NOT NULL,
        name TEXT NOT NULL,
        sort_order INTEGER DEFAULT 0,
        is_enabled INTEGER DEFAULT 1
      );
    `)
  })

  afterEach(() => db.close())

  it('政府会计账套应进入已启用的收入费用表，而不是固定编号', () => {
    const insert = db.prepare(`
      INSERT INTO report_definitions (id, account_set_id, code, name, sort_order, is_enabled)
      VALUES (?, 'set-1', ?, ?, ?, ?)
    `)
    insert.run('r1', '2', '财政拨款预算收入支出表', 1, 1)
    insert.run('r2', '3', '收入费用表', 2, 1)

    expect(getFinancialResultReportLink(db as any, 'set-1', 'government')).toEqual({
      code: '3',
      name: '收入费用表',
      path: '/report/dynamic/3?view=1',
    })
  })

  it('企业账套优先精确匹配利润表，避免误进利润表季报', () => {
    const insert = db.prepare(`
      INSERT INTO report_definitions (id, account_set_id, code, name, sort_order, is_enabled)
      VALUES (?, 'set-1', ?, ?, ?, 1)
    `)
    insert.run('r1', '2', '利润表季报', 1)
    insert.run('r2', '1', '利润表', 2)

    expect(getFinancialResultReportLink(db as any, 'set-1', 'enterprise')).toMatchObject({
      code: '1',
      name: '利润表',
    })
  })

  it('禁用的财务成果报表不能作为首页跳转目标', () => {
    db.prepare(`
      INSERT INTO report_definitions (id, account_set_id, code, name, sort_order, is_enabled)
      VALUES ('r1', 'set-1', '3', '收入费用表', 1, 0)
    `).run()

    expect(getFinancialResultReportLink(db as any, 'set-1', 'government')).toBeNull()
  })
})

describe('dashboard cash bank structure', () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    db.exec(`
      CREATE TABLE accounts (
        id TEXT PRIMARY KEY,
        account_set_id TEXT NOT NULL,
        code TEXT NOT NULL,
        name TEXT NOT NULL,
        direction TEXT NOT NULL,
        parent_id TEXT,
        is_enabled INTEGER DEFAULT 1,
        is_cash INTEGER DEFAULT 0,
        is_bank INTEGER DEFAULT 0
      );

      CREATE TABLE init_balances (
        id TEXT PRIMARY KEY,
        account_set_id TEXT NOT NULL,
        account_id TEXT NOT NULL,
        year INTEGER NOT NULL,
        init_balance REAL NOT NULL DEFAULT 0
      );

      CREATE TABLE vouchers (
        id TEXT PRIMARY KEY,
        account_set_id TEXT NOT NULL,
        voucher_date TEXT NOT NULL
      );

      CREATE TABLE voucher_entries (
        id TEXT PRIMARY KEY,
        account_set_id TEXT NOT NULL,
        voucher_id TEXT NOT NULL,
        account_id TEXT NOT NULL,
        direction TEXT NOT NULL,
        amount REAL NOT NULL
      );
    `)

    const insertAccount = db.prepare(`
      INSERT INTO accounts (id, account_set_id, code, name, direction, parent_id, is_enabled, is_cash, is_bank)
      VALUES (?, 'set-1', ?, ?, 'debit', ?, ?, ?, ?)
    `)
    insertAccount.run('cash-root', '1001', '不依赖名称的现金根', null, 1, 0, 0)
    insertAccount.run('cash-leaf', '100101', '现金下级', 'cash-root', 1, 0, 0)
    insertAccount.run('bank-root', '1002', '不依赖名称的银行根', null, 1, 0, 0)
    insertAccount.run('name-cash', '1999', '现金', null, 1, 1, 0)
    insertAccount.run('flag-bank', '2999', '其他银行科目', null, 1, 0, 1)

    const insertInit = db.prepare(`
      INSERT INTO init_balances (id, account_set_id, account_id, year, init_balance)
      VALUES (?, 'set-1', ?, 2026, ?)
    `)
    insertInit.run('init-cash-root', 'cash-root', 9999)
    insertInit.run('init-cash-leaf', 'cash-leaf', 100)
    insertInit.run('init-bank-root', 'bank-root', 200)
    insertInit.run('init-name-cash', 'name-cash', 8888)
    insertInit.run('init-flag-bank', 'flag-bank', 7777)

    db.prepare("INSERT INTO vouchers (id, account_set_id, voucher_date) VALUES ('v1', 'set-1', '2026-01-15')").run()
    const insertEntry = db.prepare(`
      INSERT INTO voucher_entries (id, account_set_id, voucher_id, account_id, direction, amount)
      VALUES (?, 'set-1', 'v1', ?, ?, ?)
    `)
    insertEntry.run('entry-cash-debit', 'cash-leaf', 'debit', 20)
    insertEntry.run('entry-cash-credit', 'cash-leaf', 'credit', 5)
    insertEntry.run('entry-bank-credit', 'bank-root', 'credit', 30)
  })

  afterEach(() => {
    db.close()
  })

  it('现金结构只读取 1001 及其启用叶子下级，不按名称或标记回退', () => {
    const rows = getCashBankLeavesByRootCode(db as any, 'set-1', '1001', 2026, '2026-01-31')

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ code: '100101', name: '现金下级', balance: 115 })
  })

  it('银行结构在 1002 没有下级时读取 1002 本身', () => {
    const rows = getCashBankLeavesByRootCode(db as any, 'set-1', '1002', 2026, '2026-01-31')

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ code: '1002', balance: 170 })
  })
})

describe('getDashboardPeriod', () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    db.exec(`
      CREATE TABLE account_sets (id TEXT PRIMARY KEY, fiscal_year INTEGER);
      CREATE TABLE vouchers (
        id TEXT PRIMARY KEY,
        account_set_id TEXT NOT NULL,
        year INTEGER NOT NULL,
        period INTEGER NOT NULL,
        voucher_date TEXT NOT NULL,
        voucher_no TEXT,
        status TEXT NOT NULL DEFAULT 'draft'
      );
      CREATE TABLE period_closing (
        id TEXT PRIMARY KEY,
        account_set_id TEXT NOT NULL,
        year INTEGER NOT NULL,
        period INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'open',
        UNIQUE(account_set_id, year, period)
      );
      INSERT INTO account_sets VALUES ('set-1', 2026);
    `)
  })

  afterEach(() => db.close())

  it('优先用 period_closing 最大已结期 + 1 作为本期', () => {
    db.prepare(`INSERT INTO period_closing VALUES ('c1', 'set-1', 2026, 4, 'closed')`).run()
    db.prepare(`INSERT INTO period_closing VALUES ('c2', 'set-1', 2026, 5, 'closed')`).run()
    expect(getDashboardPeriod(db as any, 'set-1')).toEqual({ year: 2026, period: 6 })
  })

  it('已结 12 月 → 下一年 1 月', () => {
    db.prepare(`INSERT INTO period_closing VALUES ('c1', 'set-1', 2025, 12, 'closed')`).run()
    expect(getDashboardPeriod(db as any, 'set-1')).toEqual({ year: 2026, period: 1 })
  })

  it('无 period_closing 但有凭证 → 用最新凭证 (year, period)', () => {
    db.prepare(
      `INSERT INTO vouchers VALUES ('v1','set-1',2026,3,'2026-03-15','1','posted')`
    ).run()
    db.prepare(
      `INSERT INTO vouchers VALUES ('v2','set-1',2026,4,'2026-04-20','2','posted')`
    ).run()
    expect(getDashboardPeriod(db as any, 'set-1')).toEqual({ year: 2026, period: 4 })
  })

  it('草稿和已审核凭证不能改变首页会计期间', () => {
    db.prepare(
      `INSERT INTO vouchers VALUES ('v1','set-1',2026,3,'2026-03-15','1','posted')`
    ).run()
    db.prepare(
      `INSERT INTO vouchers VALUES ('v2','set-1',2026,9,'2026-09-20','2','draft')`
    ).run()
    expect(getDashboardPeriod(db as any, 'set-1')).toEqual({ year: 2026, period: 3 })
  })

  it('无数据 → 兜底用 fiscal_year + 当前自然月', () => {
    const result = getDashboardPeriod(db as any, 'set-1')
    expect(result.year).toBe(2026)
    expect(result.period).toBeGreaterThanOrEqual(1)
    expect(result.period).toBeLessThanOrEqual(12)
  })

  it('period_closing 优先级高于 vouchers', () => {
    db.prepare(`INSERT INTO period_closing VALUES ('c1', 'set-1', 2026, 4, 'closed')`).run()
    db.prepare(
      `INSERT INTO vouchers VALUES ('v1','set-1',2026,8,'2026-08-15','1','posted')`
    ).run()
    expect(getDashboardPeriod(db as any, 'set-1')).toEqual({ year: 2026, period: 5 })
  })
})

describe('损益谓词（INCOME/EXPENSE PREDICATE）', () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    db.exec(`
      CREATE TABLE accounts (
        id TEXT PRIMARY KEY,
        code TEXT,
        name TEXT,
        direction TEXT
      );
    `)
  })

  afterEach(() => db.close())

  function isIncome(code: string, name: string, direction: 'debit' | 'credit'): boolean {
    db.prepare(`DELETE FROM accounts`).run()
    db.prepare(`INSERT INTO accounts VALUES ('x', ?, ?, ?)`).run(code, name, direction)
    const row = db.prepare(`SELECT (${INCOME_PREDICATE}) AS hit FROM accounts a`).get() as any
    return !!row?.hit
  }
  function isExpense(code: string, name: string, direction: 'debit' | 'credit'): boolean {
    db.prepare(`DELETE FROM accounts`).run()
    db.prepare(`INSERT INTO accounts VALUES ('x', ?, ?, ?)`).run(code, name, direction)
    const row = db.prepare(`SELECT (${EXPENSE_PREDICATE}) AS hit FROM accounts a`).get() as any
    return !!row?.hit
  }

  it('企业准则：6001 主营业务收入 → 收入', () => {
    expect(isIncome('6001', '主营业务收入', 'credit')).toBe(true)
  })

  it('行政事业：4001 财政拨款收入 → 收入', () => {
    expect(isIncome('4001', '财政拨款收入', 'credit')).toBe(true)
  })

  it('企业准则：4001 实收资本 → 不是收入（不含"收入"字样）', () => {
    expect(isIncome('4001', '实收资本', 'credit')).toBe(false)
  })

  it('企业准则：6601 销售费用 → 支出', () => {
    expect(isExpense('6601', '销售费用', 'debit')).toBe(true)
  })

  it('行政事业：5001 工资福利支出 → 支出', () => {
    expect(isExpense('5001', '工资福利支出', 'debit')).toBe(true)
  })

  it('企业准则：5001 生产成本 → 支出（含"成本"字样）', () => {
    expect(isExpense('5001', '生产成本', 'debit')).toBe(true)
  })

  it('收入但方向不对（错配）→ 不算收入', () => {
    expect(isIncome('6001', '主营业务收入', 'debit')).toBe(false)
  })

  it('资产类（无"收入/支出/费用/成本"字样）→ 都不命中', () => {
    expect(isIncome('1001', '库存现金', 'debit')).toBe(false)
    expect(isExpense('1001', '库存现金', 'debit')).toBe(false)
  })
})

describe('queryPeriodFlow 趋势拆分', () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    db.exec(`
      CREATE TABLE accounts (
        id TEXT PRIMARY KEY,
        account_set_id TEXT NOT NULL,
        code TEXT NOT NULL,
        name TEXT NOT NULL,
        direction TEXT NOT NULL,
        parent_id TEXT
      );
      CREATE TABLE vouchers (
        id TEXT PRIMARY KEY,
        account_set_id TEXT NOT NULL,
        year INTEGER NOT NULL,
        period INTEGER NOT NULL,
        voucher_date TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'posted'
      );
      CREATE TABLE voucher_entries (
        id TEXT PRIMARY KEY,
        account_set_id TEXT NOT NULL,
        voucher_id TEXT NOT NULL,
        account_id TEXT NOT NULL,
        direction TEXT NOT NULL,
        amount REAL NOT NULL
      );
      CREATE TABLE auto_transfer_runs (
        id TEXT PRIMARY KEY,
        account_set_id TEXT NOT NULL,
        voucher_id TEXT NOT NULL
      );
      CREATE TABLE system_params (
        id TEXT PRIMARY KEY,
        account_set_id TEXT,
        param_key TEXT NOT NULL,
        param_value TEXT
      );
    `)

    db.prepare(`
      INSERT INTO system_params (id, account_set_id, param_key, param_value)
      VALUES ('std-set-1', 'set-1', 'accounting_standard', 'custom')
    `).run()
    db.prepare(`
      INSERT INTO system_params (id, account_set_id, param_key, param_value)
      VALUES ('rules-set-1', 'set-1', 'dashboard_category_rules', ?)
    `).run(JSON.stringify({
      income: { codeRoots: [], nameKeywords: ['收入'] },
      pureExpense: { codeRoots: [], nameKeywords: ['支出'] },
      fee: { codeRoots: [], nameKeywords: ['费用'] },
      cost: { codeRoots: [], nameKeywords: ['成本'] },
    }))

    const insertAccount = db.prepare(`
      INSERT INTO accounts (id, account_set_id, code, name, direction, parent_id)
      VALUES (?, 'set-1', ?, ?, ?, ?)
    `)
    insertAccount.run('acc-income', '4001', '财政拨款收入', 'credit', null)
    insertAccount.run('acc-expense', '5001', '项目支出', 'debit', null)
    insertAccount.run('acc-fee', '6601', '管理费用', 'debit', null)
    insertAccount.run('acc-fee-leaf', '6601001', '通讯费', 'debit', 'acc-fee')
    insertAccount.run('acc-cost', '5002', '营业成本', 'debit', null)

    db.prepare(`
      INSERT INTO vouchers (id, account_set_id, year, period, voucher_date)
      VALUES ('v-biz', 'set-1', 2026, 4, '2026-04-10')
    `).run()
    db.prepare(`
      INSERT INTO vouchers (id, account_set_id, year, period, voucher_date)
      VALUES ('v-transfer', 'set-1', 2026, 4, '2026-04-28')
    `).run()

    const insertEntry = db.prepare(`
      INSERT INTO voucher_entries (id, account_set_id, voucher_id, account_id, direction, amount)
      VALUES (?, 'set-1', ?, ?, ?, ?)
    `)
    insertEntry.run('e-income', 'v-biz', 'acc-income', 'credit', 120000)
    insertEntry.run('e-expense', 'v-biz', 'acc-expense', 'debit', 30000)
    insertEntry.run('e-fee', 'v-biz', 'acc-fee', 'debit', 45000)
    insertEntry.run('e-fee-leaf', 'v-biz', 'acc-fee-leaf', 'debit', 1200)
    insertEntry.run('e-cost', 'v-biz', 'acc-cost', 'debit', 20000)
    insertEntry.run('e-transfer-fee', 'v-transfer', 'acc-fee', 'debit', 99999)

    db.prepare(`
      INSERT INTO auto_transfer_runs (id, account_set_id, voucher_id)
      VALUES ('run-1', 'set-1', 'v-transfer')
    `).run()
  })

  afterEach(() => db.close())

  it('按收入/支出/费用/成本拆分，合计 expense 与 EXPENSE_PREDICATE 一致', () => {
    const flow = queryPeriodFlow(db as any, 'set-1', 2026, 4)

    expect(flow.income).toBe(120000)
    expect(flow.pureExpense).toBe(30000)
    expect(flow.fee).toBe(46200)
    expect(flow.cost).toBe(20000)
    expect(flow.expense).toBe(96200)
    expect(flow.pureExpense + flow.fee + flow.cost).toBe(flow.expense)
  })

  it('管理费用下级叶子科目（通讯费）计入费用', () => {
    const flow = queryPeriodFlow(db as any, 'set-1', 2026, 4)
    expect(flow.fee).toBeGreaterThanOrEqual(46200)
  })

  it('排除自动结转凭证中的发生额', () => {
    const flow = queryPeriodFlow(db as any, 'set-1', 2026, 4)
    expect(flow.fee).toBe(46200)
    expect(flow.fee).not.toBe(46200 + 99999)
  })
})
