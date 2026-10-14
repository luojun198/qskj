import { describe, expect, it, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import {
  allocateAccountSetCode,
  bootstrapNewAccountSetDefaults,
  readAccountSetStartDate,
  resolveAccountSetStartDate,
  resolveDeprExpenseAccount,
  syncAccountSetStartDate,
} from '../services/accountSetDefaults.js'
import {
  DEFAULT_BATCH_PRINT_TEMPLATE_NAME,
  ensureDefaultPrintTemplateForAccountSet,
} from '../services/printTemplateDefaults.js'

function createPrintTemplatesTable(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS print_templates (
      id TEXT PRIMARY KEY,
      account_set_id TEXT NOT NULL,
      name TEXT NOT NULL,
      paper_size TEXT NOT NULL DEFAULT 'custom',
      paper_width REAL NOT NULL DEFAULT 220,
      paper_height REAL NOT NULL DEFAULT 140,
      margin_top REAL NOT NULL DEFAULT 15,
      margin_bottom REAL NOT NULL DEFAULT 15,
      margin_left REAL NOT NULL DEFAULT 10,
      margin_right REAL NOT NULL DEFAULT 10,
      elements TEXT NOT NULL DEFAULT '[]',
      is_default INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `)
}

describe('accountSetDefaults', () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    db.exec(`
      CREATE TABLE account_sets (
        id TEXT PRIMARY KEY,
        name TEXT,
        code TEXT,
        fiscal_year INTEGER,
        start_date TEXT,
        updated_at TEXT
      );
      CREATE TABLE system_params (
        id TEXT PRIMARY KEY,
        account_set_id TEXT,
        param_key TEXT,
        param_value TEXT,
        description TEXT,
        created_at TEXT,
        updated_at TEXT,
        UNIQUE(account_set_id, param_key)
      );
    `)
    createPrintTemplatesTable(db)
    db.prepare(`INSERT INTO account_sets (id, name, fiscal_year, start_date) VALUES ('as1', '测试账套', 2026, '')`).run()
  })

  it('应解析并默认建账日期', () => {
    expect(resolveAccountSetStartDate('2026-03-15', 2026)).toBe('2026-03-15')
    expect(resolveAccountSetStartDate('', 2026)).toBe('2026-01-01')
  })

  it('新建账套应写入 system_params.start_date', () => {
    bootstrapNewAccountSetDefaults(db, 'as1', {
      start_date: '2026-04-01',
      fiscal_year: 2026,
      unit_name: '测试单位',
    })
    const row = db
      .prepare(`SELECT param_value FROM system_params WHERE account_set_id='as1' AND param_key='start_date'`)
      .get() as { param_value: string }
    const accountSet = db
      .prepare(`SELECT start_date FROM account_sets WHERE id='as1'`)
      .get() as { start_date: string }
    expect(row.param_value).toBe('2026-04-01')
    expect(accountSet.start_date).toBe('2026-04-01')
  })

  it('默认业务参数可被 params 覆盖，旧键名随之同步（ACD 导入按源账套设置）', () => {
    bootstrapNewAccountSetDefaults(db, 'as1', {
      fiscal_year: 2026,
      params: { enable_cash_flow: 'true', require_audit: 'true' },
    })
    const read = (key: string) =>
      (
        db
          .prepare(`SELECT param_value FROM system_params WHERE account_set_id='as1' AND param_key=?`)
          .get(key) as { param_value: string }
      ).param_value
    expect(read('enable_cash_flow')).toBe('true')
    expect(read('require_audit')).toBe('true')
    expect(read('voucher_audit_required')).toBe('true')
    // 未覆盖的仍是默认值
    expect(read('direct_print')).toBe('true')
    expect(read('voucher_time_control')).toBe('false')
  })

  it('新建账套应自动创建默认批量打印模版', () => {
    bootstrapNewAccountSetDefaults(db, 'as1', { fiscal_year: 2026 })
    const template = db
      .prepare(
        `SELECT name, is_default, paper_width, paper_height FROM print_templates WHERE account_set_id='as1'`
      )
      .get() as { name: string; is_default: number; paper_width: number; paper_height: number }
    expect(template.name).toBe(DEFAULT_BATCH_PRINT_TEMPLATE_NAME)
    expect(template.is_default).toBe(1)
    expect(template.paper_width).toBe(220)
    expect(template.paper_height).toBe(140)
  })

  it('有 hiprint 列时默认写入 panel 与凭证纸尺寸', () => {
    const hiprintDb = new Database(':memory:')
    hiprintDb.exec(`
      CREATE TABLE print_templates (
        id TEXT PRIMARY KEY,
        account_set_id TEXT NOT NULL,
        name TEXT NOT NULL,
        paper_size TEXT NOT NULL DEFAULT 'custom',
        paper_width REAL NOT NULL DEFAULT 220,
        paper_height REAL NOT NULL DEFAULT 140,
        margin_top REAL NOT NULL DEFAULT 15,
        margin_bottom REAL NOT NULL DEFAULT 15,
        margin_left REAL NOT NULL DEFAULT 10,
        margin_right REAL NOT NULL DEFAULT 10,
        elements TEXT NOT NULL DEFAULT '[]',
        template_type TEXT DEFAULT 'voucher',
        template_key TEXT,
        panel TEXT,
        is_default INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `)
    const result = ensureDefaultPrintTemplateForAccountSet(hiprintDb, 'as1')
    expect(result.created).toBe(true)
    const row = hiprintDb
      .prepare(
        `SELECT name, paper_width, paper_height, template_key, panel FROM print_templates WHERE id=?`
      )
      .get(result.id) as {
      name: string
      paper_width: number
      paper_height: number
      template_key: string
      panel: string
    }
    expect(row.name).toBe(DEFAULT_BATCH_PRINT_TEMPLATE_NAME)
    expect(row.paper_width).toBe(220)
    expect(row.paper_height).toBe(140)
    expect(row.template_key).toBe('voucher:standard')
    const panel = JSON.parse(row.panel)
    expect(panel.panels[0].printElements.some((el: any) => el.options?.field === 'doc_title')).toBe(true)
    const table = panel.panels[0].printElements.find((el: any) => el.options?.field === 'entries')
    expect(table.options.maxRows).toBe(6)
    expect(table.options.autoCompletion).toBe(true)
    expect(table.options.tableFooterRepeat).toBe('last')
    const cols = table.options.columns[0] as Array<{ field: string; tableSummary?: string; tableSummaryText?: string }>
    expect(cols.find(c => c.field === 'debit')?.tableSummary).toBe('sum')
    expect(cols.find(c => c.field === 'credit')?.tableSummary).toBe('sum')
    expect(cols.find(c => c.field === 'summary')?.tableSummary).toBe('text')
    expect(cols.find(c => c.field === 'summary')?.tableSummaryText).toBe('合计')
  })

  it('ensureDefaultPrintTemplateForAccountSet 应幂等', () => {
    const first = ensureDefaultPrintTemplateForAccountSet(db, 'as1')
    const second = ensureDefaultPrintTemplateForAccountSet(db, 'as1')
    expect(first.created).toBe(true)
    expect(second.created).toBe(false)
    const count = db
      .prepare(`SELECT COUNT(*) as c FROM print_templates WHERE account_set_id='as1'`)
      .get() as { c: number }
    expect(count.c).toBe(1)
  })

  it('读取建账日期应自动修复空值', () => {
    const value = readAccountSetStartDate(db, 'as1')
    expect(value).toBe('2026-01-01')
    const row = db
      .prepare(`SELECT param_value FROM system_params WHERE account_set_id='as1' AND param_key='start_date'`)
      .get() as { param_value: string }
    expect(row.param_value).toBe('2026-01-01')
  })

  it('syncAccountSetStartDate 应同步账套表与系统参数', () => {
    syncAccountSetStartDate(db, 'as1', '2025-06-01')
    expect(readAccountSetStartDate(db, 'as1')).toBe('2025-06-01')
  })

  it('allocateAccountSetCode 应在删除账套后跳过已占用 ZT 序号', () => {
    db.prepare(`INSERT INTO account_sets (id, name, code) VALUES ('a1', 'A', 'ZT001')`).run()
    db.prepare(`INSERT INTO account_sets (id, name, code) VALUES ('a2', 'B', 'ZT002')`).run()
    db.prepare(`INSERT INTO account_sets (id, name, code) VALUES ('a3', 'C', 'ZT004')`).run()

    expect(allocateAccountSetCode(db)).toBe('ZT005')
    expect(allocateAccountSetCode(db, 'ZT004')).toBe('ZT005')
    expect(allocateAccountSetCode(db, 'ZT999')).toBe('ZT999')
  })

  it('兼容旧版 system_params 表（无 description/updated_at）', () => {
    const legacyDb = new Database(':memory:')
    legacyDb.exec(`
      CREATE TABLE account_sets (
        id TEXT PRIMARY KEY,
        name TEXT,
        fiscal_year INTEGER,
        start_date TEXT
      );
      CREATE TABLE system_params (
        id TEXT PRIMARY KEY,
        account_set_id TEXT,
        param_key TEXT NOT NULL,
        param_value TEXT
      );
      INSERT INTO account_sets (id, name, fiscal_year, start_date) VALUES ('as1', '旧库', 2026, '');
    `)
    bootstrapNewAccountSetDefaults(legacyDb, 'as1', {
      start_date: '2026-06-01',
      fiscal_year: 2026,
    })
    const row = legacyDb
      .prepare(`SELECT param_value FROM system_params WHERE account_set_id='as1' AND param_key='start_date'`)
      .get() as { param_value: string }
    expect(row.param_value).toBe('2026-06-01')
  })
})

describe('resolveDeprExpenseAccount：资产用途预设折旧费用科目', () => {
  function makeDb() {
    const db = new Database(':memory:')
    db.exec(`CREATE TABLE accounts (id TEXT PRIMARY KEY, account_set_id TEXT NOT NULL, code TEXT NOT NULL, name TEXT NOT NULL)`)
    const ins = db.prepare('INSERT INTO accounts (id, account_set_id, code, name) VALUES (?, ?, ?, ?)')
    ins.run('a1', 'as1', '6602', '管理费用')
    ins.run('a2', 'as1', '6602001', '办公费')
    ins.run('a3', 'as1', '6602010', '折旧')
    ins.run('a4', 'as1', '5101', '制造费用')
    ins.run('a5', 'as1', '5101001', '维修费')
    ins.run('a6', 'as1', '5101003', '折旧费')
    ins.run('a7', 'as1', '6601', '销售费用')
    return db
  }

  it('优先取父科目下名称含「折旧」的末级', () => {
    const db = makeDb()
    expect(resolveDeprExpenseAccount(db, 'as1', '6602')).toBe('6602010')
    expect(resolveDeprExpenseAccount(db, 'as1', '5101')).toBe('5101003')
  })

  it('无折旧末级时取第一个末级，无下级时退回父科目', () => {
    const db = makeDb()
    db.prepare("DELETE FROM accounts WHERE code='5101003'").run()
    expect(resolveDeprExpenseAccount(db, 'as1', '5101')).toBe('5101001')
    expect(resolveDeprExpenseAccount(db, 'as1', '6601')).toBe('6601')
    expect(resolveDeprExpenseAccount(db, 'as2', '6602')).toBe('6602')
  })
})
