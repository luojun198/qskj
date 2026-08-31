import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_DASHBOARD_CATEGORY_RULES,
  parseDashboardCategoryRulesJson,
  serializeDashboardCategoryRules,
  validateDashboardCategoryRules,
} from '../services/accountingStandard.js'
import {
  buildAccountCodeRootsPredicate,
  buildPresetDashboardBudgetRules,
  buildPresetDashboardCategoryRules,
  getDashboardCategoryConfig,
} from '../services/dashboardCategoryConfig.js'
import { queryPeriodFlow } from '../routes/dashboard.js'

function seedSystemParams(
  db: Database.Database,
  accountSetId: string,
  standard: string,
  rulesJson?: string
) {
  db.prepare(
    `INSERT INTO system_params (id, account_set_id, param_key, param_value) VALUES (?, ?, 'accounting_standard', ?)`
  ).run(`std-${accountSetId}`, accountSetId, standard)
  if (rulesJson) {
    db.prepare(
      `INSERT INTO system_params (id, account_set_id, param_key, param_value) VALUES (?, ?, 'dashboard_category_rules', ?)`
    ).run(`rules-${accountSetId}`, accountSetId, rulesJson)
  }
}

function insertAccount(
  db: Database.Database,
  id: string,
  code: string,
  name: string,
  direction: string,
  parentId: string | null = null
) {
  db.prepare(`
    INSERT INTO accounts (id, account_set_id, code, name, direction, parent_id)
    VALUES (?, 'set-1', ?, ?, ?, ?)
  `).run(id, code, name, direction, parentId)
}

describe('dashboardCategoryConfig', () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    db.exec(`
      CREATE TABLE system_params (
        id TEXT PRIMARY KEY,
        account_set_id TEXT,
        param_key TEXT NOT NULL,
        param_value TEXT
      );
      CREATE TABLE accounts (
        id TEXT PRIMARY KEY,
        account_set_id TEXT NOT NULL,
        code TEXT NOT NULL,
        name TEXT NOT NULL,
        direction TEXT NOT NULL,
        parent_id TEXT
      );
    `)
  })

  afterEach(() => db.close())

  it('预设政府准则仅匹配账套现有科目', () => {
    insertAccount(db, 'gov-income', '4001', '财政拨款收入', 'credit')
    insertAccount(db, 'gov-fee', '5101', '单位管理费用', 'debit')
    insertAccount(db, 'gov-budget-exp', '7201', '事业支出', 'debit')
    seedSystemParams(db, 'set-1', 'government')

    const config = getDashboardCategoryConfig(db, 'set-1')
    expect(config.standardName).toBe('政府会计制度')
    expect(config.rules.income.codeRoots).toEqual(['4001'])
    expect(config.rules.fee.codeRoots).toEqual(['5101'])
    expect(config.rules.pureExpense.codeRoots).toEqual([])
    expect(config.budgetRules.expense.codeRoots).toEqual(['7201'])
    expect(config.rules.income.codeRoots).not.toContain('4603')
    expect(config.rules.income.codeRoots).not.toContain('6001')
  })

  it('预设准则下保存的科目调整应覆盖默认规则', () => {
    insertAccount(db, 'gov-income', '4001', '财政拨款收入', 'credit')
    insertAccount(db, 'ent-income', '6001', '主营业务收入', 'credit')
    insertAccount(db, 'gov-fee', '5101', '单位管理费用', 'debit')
    seedSystemParams(
      db,
      'set-1',
      'government',
      JSON.stringify({
        income: { codeRoots: ['6001'], nameKeywords: [] },
        pureExpense: { codeRoots: [], nameKeywords: [] },
        fee: { codeRoots: [], nameKeywords: [] },
        cost: { codeRoots: [], nameKeywords: [] },
      })
    )
    const config = getDashboardCategoryConfig(db, 'set-1')
    expect(config.standardName).toBe('政府会计制度')
    expect(config.rules.income.codeRoots).toEqual(['6001'])
    expect(config.rules.fee.codeRoots).toEqual(['5101'])
  })

  it('预设新企业准则仅匹配账套现有科目', () => {
    insertAccount(db, 'ent-income', '6001', '主营业务收入', 'credit')
    insertAccount(db, 'ent-cost', '6401', '主营业务成本', 'debit')
    insertAccount(db, 'ent-fee', '6601', '销售费用', 'debit')
    seedSystemParams(db, 'set-1', 'enterprise')

    const config = getDashboardCategoryConfig(db, 'set-1')
    expect(config.standardName).toBe('新企业会计准则')
    expect(config.rules.income.codeRoots).toEqual(['6001'])
    expect(config.rules.cost.codeRoots).toEqual(['6401'])
    expect(config.rules.fee.codeRoots).toEqual(['6601'])
    expect(config.rules.income.codeRoots).not.toContain('6011')
    expect(config.rules.pureExpense.codeRoots).not.toContain('6701')
  })

  it('政府准则应匹配旧版账套常见编码（如 4701 利息收入）', () => {
    insertAccount(db, 'legacy-interest', '4701', '利息收入', 'credit')
    const rules = buildPresetDashboardCategoryRules(db, 'set-1', 'government')
    expect(rules.income.codeRoots).toContain('4701')
  })

  it('政府准则不会把企业 6001 主营业务收入误匹配为预算收入', () => {
    insertAccount(db, 'ent-income', '6001', '主营业务收入', 'credit')
    const rules = buildPresetDashboardCategoryRules(db, 'set-1', 'government')
    expect(rules.income.codeRoots).not.toContain('6001')
  })

  it('政府预算规则补齐债务预算收入 6501', () => {
    insertAccount(db, 'gov-debt-income', '6501', '债务预算收入', 'credit')
    const rules = buildPresetDashboardBudgetRules(db, 'set-1', 'government')
    expect(rules.income.codeRoots).toContain('6501')
  })

  it('自定义规则 JSON 解析与校验', () => {
    const rules = parseDashboardCategoryRulesJson(
      JSON.stringify({
        income: { codeRoots: ['6001'], nameKeywords: [] },
        pureExpense: { codeRoots: [], nameKeywords: ['支出'] },
        fee: { codeRoots: ['6601'], nameKeywords: [] },
        cost: { codeRoots: ['6401'], nameKeywords: [] },
      })
    )
    expect(validateDashboardCategoryRules(rules)).toBeNull()
    expect(serializeDashboardCategoryRules(rules)).toContain('6001')
  })

  it('编码根谓词应匹配下级科目', () => {
    insertAccount(db, 'parent', '6601', '管理费用', 'debit')
    insertAccount(db, 'leaf', '6601001', '通讯费', 'debit', 'parent')
    const predicate = buildAccountCodeRootsPredicate(['6601'], 'debit')
    const parentHit = db.prepare(`SELECT (${predicate}) AS hit FROM accounts a WHERE a.id='parent'`).get() as any
    const leafHit = db.prepare(`SELECT (${predicate}) AS hit FROM accounts a WHERE a.id='leaf'`).get() as any
    expect(parentHit.hit).toBe(1)
    expect(leafHit.hit).toBe(1)
  })
})

describe('queryPeriodFlow 按会计准则取数', () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    db.exec(`
      CREATE TABLE system_params (
        id TEXT PRIMARY KEY,
        account_set_id TEXT,
        param_key TEXT NOT NULL,
        param_value TEXT
      );
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
        status TEXT NOT NULL DEFAULT 'draft'
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
    `)

    insertAccount(db, 'gov-income', '4001', '财政拨款收入', 'credit')
    insertAccount(db, 'ent-income', '6001', '主营业务收入', 'credit')
    insertAccount(db, 'ent-fee', '6601', '销售费用', 'debit')
    insertAccount(db, 'ent-fee-leaf', '6601001', '广告费', 'debit', 'ent-fee')
    insertAccount(db, 'ent-cost', '6401', '主营业务成本', 'debit')

    db.prepare(`
      INSERT INTO vouchers (id, account_set_id, year, period, voucher_date, status)
      VALUES ('v1', 'set-1', 2026, 4, '2026-04-10', 'posted')
    `).run()
    db.prepare(`
      INSERT INTO vouchers (id, account_set_id, year, period, voucher_date, status)
      VALUES ('v-draft', 'set-1', 2026, 4, '2026-04-11', 'draft')
    `).run()

    const insertEntry = db.prepare(`
      INSERT INTO voucher_entries (id, account_set_id, voucher_id, account_id, direction, amount)
      VALUES (?, 'set-1', 'v1', ?, ?, ?)
    `)
    insertEntry.run('e-gov', 'gov-income', 'credit', 80000)
    insertEntry.run('e-ent-income', 'ent-income', 'credit', 50000)
    insertEntry.run('e-ent-fee', 'ent-fee', 'debit', 12000)
    insertEntry.run('e-ent-fee-leaf', 'ent-fee-leaf', 'debit', 800)
    insertEntry.run('e-ent-cost', 'ent-cost', 'debit', 22000)
    db.prepare(`
      INSERT INTO voucher_entries (id, account_set_id, voucher_id, account_id, direction, amount)
      VALUES ('e-draft-income', 'set-1', 'v-draft', 'ent-income', 'credit', 999999)
    `).run()
  })

  afterEach(() => db.close())

  it('政府准则只统计账套内已配置的 4 字头收入', () => {
    seedSystemParams(db, 'set-1', 'government')
    const flow = queryPeriodFlow(db as any, 'set-1', 2026, 4)
    expect(flow.income).toBe(80000)
    expect(flow.fee).toBe(0)
    expect(flow.cost).toBe(0)
  })

  it('新企业准则统计 6001 收入、6601 费用与 6401 成本', () => {
    seedSystemParams(db, 'set-1', 'enterprise')
    const flow = queryPeriodFlow(db as any, 'set-1', 2026, 4)
    expect(flow.income).toBe(50000)
    expect(flow.fee).toBe(12800)
    expect(flow.cost).toBe(22000)
    expect(flow.expense).toBe(34800)
  })

  it('自定义规则按编码根取数', () => {
    seedSystemParams(
      db,
      'set-1',
      'custom',
      JSON.stringify({
        income: { codeRoots: ['6001'], nameKeywords: [] },
        pureExpense: { codeRoots: [], nameKeywords: [] },
        fee: { codeRoots: ['6601'], nameKeywords: [] },
        cost: { codeRoots: ['6401'], nameKeywords: [] },
      })
    )
    const flow = queryPeriodFlow(db as any, 'set-1', 2026, 4)
    expect(flow.income).toBe(50000)
    expect(flow.fee).toBe(12800)
    expect(flow.cost).toBe(22000)
  })
})

describe('buildPresetDashboardCategoryRules', () => {
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
    `)
  })

  afterEach(() => db.close())

  it('小企业准则费用应拆分为成本与费用', () => {
    insertAccount(db, 'sb-income', '5001', '主营业务收入', 'credit')
    insertAccount(db, 'sb-cost', '5401', '主营业务成本', 'debit')
    insertAccount(db, 'sb-fee', '5601', '销售费用', 'debit')
    const rules = buildPresetDashboardCategoryRules(db, 'set-1', 'small_business')
    expect(rules.income.codeRoots).toEqual(['5001'])
    expect(rules.cost.codeRoots).toEqual(['5401'])
    expect(rules.fee.codeRoots).toEqual(['5601'])
  })

  it('默认自定义规则包含名称关键字兜底', () => {
    expect(DEFAULT_DASHBOARD_CATEGORY_RULES.income.nameKeywords).toContain('收入')
  })
})
