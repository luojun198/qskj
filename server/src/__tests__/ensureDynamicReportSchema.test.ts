import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ensureDynamicReportSchema } from '../db/ensureDynamicReportSchema.js'

describe('ensureDynamicReportSchema', () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    db.exec(`
      CREATE TABLE account_sets (id TEXT PRIMARY KEY);
      INSERT INTO account_sets (id) VALUES ('set-1');
      CREATE TABLE report_definitions (
        id TEXT PRIMARY KEY, account_set_id TEXT, code TEXT, name TEXT,
        source TEXT, source_file TEXT, sort_order INTEGER, is_enabled INTEGER
      );
      CREATE TABLE report_sheets (
        id TEXT PRIMARY KEY, report_definition_id TEXT, sheet_key TEXT,
        sheet_name TEXT, sheet_index INTEGER
      );
      CREATE TABLE report_cells (
        id TEXT PRIMARY KEY, report_sheet_id TEXT, row_index INTEGER, col_index INTEGER,
        cell_type TEXT, text_value TEXT, formula_text TEXT, format_text TEXT, style_key TEXT
      );
    `)
  })

  afterEach(() => {
    db.close()
  })

  it('补齐 report_sheets / report_cells 缺列后可加载模板详情 SQL', () => {
    ensureDynamicReportSchema(db)

    expect(() => {
      db.prepare(
        `SELECT default_col_width, default_row_height, col_widths, row_heights FROM report_sheets LIMIT 1`
      ).get()
    }).not.toThrow()

    expect(() => {
      db.prepare(`SELECT col_width, row_height, merge_info, side FROM report_cells LIMIT 1`).get()
    }).not.toThrow()
  })

  it('缺表时创建 report_formula_functions', () => {
    ensureDynamicReportSchema(db)
    const row = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='report_formula_functions'"
      )
      .get() as { name: string }
    expect(row?.name).toBe('report_formula_functions')
  })
})
