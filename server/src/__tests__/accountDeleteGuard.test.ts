import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getAccountReportTemplateBlockReason } from '../services/accountDeleteGuard.js'
import { AccountService } from '../services/accountService.js'

describe('accountDeleteGuard', () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    db.exec(`
      CREATE TABLE report_definitions (
        id TEXT PRIMARY KEY,
        account_set_id TEXT NOT NULL,
        code TEXT NOT NULL,
        name TEXT NOT NULL
      );
      CREATE TABLE report_sheets (
        id TEXT PRIMARY KEY,
        report_definition_id TEXT NOT NULL,
        sheet_key TEXT NOT NULL,
        sheet_name TEXT NOT NULL,
        sheet_index INTEGER DEFAULT 0
      );
      CREATE TABLE report_cells (
        id TEXT PRIMARY KEY,
        report_sheet_id TEXT NOT NULL,
        row_index INTEGER NOT NULL,
        col_index INTEGER NOT NULL,
        cell_type TEXT DEFAULT 'formula',
        formula_text TEXT
      );
    `)
    db.prepare(
      `INSERT INTO report_definitions (id, account_set_id, code, name) VALUES ('rd1', 'set-1', 'R1', '测试报表')`
    ).run()
    db.prepare(
      `INSERT INTO report_sheets (id, report_definition_id, sheet_key, sheet_name) VALUES ('rs1', 'rd1', 's1', 'Sheet1')`
    ).run()
  })

  afterEach(() => {
    db.close()
  })

  it('report_cells 含科目编码公式时阻止删除', () => {
    db.prepare(
      `INSERT INTO report_cells (id, report_sheet_id, row_index, col_index, formula_text) VALUES ('c1', 'rs1', 0, 0, '@ye(1001,99)')`
    ).run()
    expect(getAccountReportTemplateBlockReason(db, 'set-1', '1001')).toMatch(/动态报表/)
  })

  it('无公式引用时不阻止', () => {
    db.prepare(
      `INSERT INTO report_cells (id, report_sheet_id, row_index, col_index, formula_text) VALUES ('c1', 'rs1', 0, 0, '@ye(2001,99)')`
    ).run()
    expect(getAccountReportTemplateBlockReason(db, 'set-1', '1001')).toBeNull()
  })
})

describe('AccountService.deleteAccount', () => {
  let db: Database.Database
  let service: AccountService

  beforeEach(() => {
    db = new Database(':memory:')
    db.exec(`
      CREATE TABLE accounts (
        id TEXT PRIMARY KEY,
        account_set_id TEXT NOT NULL,
        code TEXT NOT NULL,
        name TEXT NOT NULL,
        direction TEXT NOT NULL,
        level INTEGER NOT NULL,
        parent_id TEXT,
        is_aux INTEGER DEFAULT 0,
        aux_types TEXT,
        is_enabled INTEGER DEFAULT 1,
        is_cash INTEGER DEFAULT 0,
        is_bank INTEGER DEFAULT 0,
        allow_delete INTEGER DEFAULT 1,
        no_negative INTEGER DEFAULT 0
      );
      CREATE TABLE init_balances (id TEXT PRIMARY KEY, account_id TEXT);
      CREATE TABLE voucher_entries (id TEXT PRIMARY KEY, account_id TEXT);
    `)
    db.prepare(
      `INSERT INTO accounts (id, account_set_id, code, name, direction, level, parent_id, allow_delete)
       VALUES ('a1', 'set-1', '100199', '测试子科目', 'debit', 2, NULL, 1)`
    ).run()
    service = new AccountService(db)
  })

  afterEach(() => {
    db.close()
  })

  it('无 report_template_cells 表时仍可删除科目', () => {
    expect(() => service.deleteAccount('a1')).not.toThrow()
    expect(db.prepare('SELECT id FROM accounts WHERE id = ?').get('a1')).toBeUndefined()
  })
})
