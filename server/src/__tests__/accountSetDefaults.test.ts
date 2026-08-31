import { describe, expect, it, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import {
  allocateAccountSetCode,
  bootstrapNewAccountSetDefaults,
  readAccountSetStartDate,
  resolveAccountSetStartDate,
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
