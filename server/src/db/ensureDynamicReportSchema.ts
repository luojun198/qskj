import type Database from 'better-sqlite3'

function tableExists(db: Database.Database, table: string): boolean {
  return !!db
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(table)
}

function columnExists(db: Database.Database, table: string, column: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  return rows.some(row => row.name === column)
}

function addColumnIfMissing(
  db: Database.Database,
  table: string,
  column: string,
  definition: string
) {
  if (!tableExists(db, table)) return
  if (columnExists(db, table, column)) return
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
}

/**
 * 旧库/部分迁移库可能仅有早期 report_* 表结构，缺列会导致动态报表加载 500。
 * 与 schema.sql 及当前导入逻辑对齐，幂等执行。
 */
export function ensureDynamicReportSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS report_definitions (
      id TEXT PRIMARY KEY,
      account_set_id TEXT NOT NULL REFERENCES account_sets(id),
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'acd' CHECK(source IN ('acd', 'manual', 'xls')),
      source_file TEXT,
      sort_order INTEGER DEFAULT 0,
      is_enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(account_set_id, code)
    );

    CREATE TABLE IF NOT EXISTS report_sheets (
      id TEXT PRIMARY KEY,
      report_definition_id TEXT NOT NULL REFERENCES report_definitions(id) ON DELETE CASCADE,
      sheet_key TEXT NOT NULL,
      sheet_name TEXT NOT NULL,
      sheet_index INTEGER NOT NULL DEFAULT 0,
      default_col_width INTEGER DEFAULT 160,
      default_row_height INTEGER DEFAULT 34,
      col_widths TEXT,
      row_heights TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(report_definition_id, sheet_key)
    );

    CREATE TABLE IF NOT EXISTS report_template_sources (
      id TEXT PRIMARY KEY,
      report_definition_id TEXT NOT NULL REFERENCES report_definitions(id) ON DELETE CASCADE,
      source_file TEXT NOT NULL,
      source_type TEXT NOT NULL DEFAULT 'vts' CHECK(source_type IN ('vts', 'txt', 'xls')),
      raw_content TEXT,
      content_encoding TEXT DEFAULT 'gb18030',
      parse_version TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(report_definition_id, source_file)
    );

    CREATE TABLE IF NOT EXISTS report_cells (
      id TEXT PRIMARY KEY,
      report_sheet_id TEXT NOT NULL REFERENCES report_sheets(id) ON DELETE CASCADE,
      row_index INTEGER NOT NULL,
      col_index INTEGER NOT NULL,
      cell_type TEXT NOT NULL DEFAULT 'text' CHECK(cell_type IN ('text', 'formula', 'number', 'empty', 'merged')),
      text_value TEXT,
      formula_text TEXT,
      format_text TEXT,
      style_key TEXT,
      side TEXT CHECK(side IN ('left', 'right')),
      col_width TEXT,
      row_height TEXT,
      merge_info TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(report_sheet_id, row_index, col_index)
    );

    CREATE TABLE IF NOT EXISTS report_formula_functions (
      id TEXT PRIMARY KEY,
      account_set_id TEXT NOT NULL REFERENCES account_sets(id),
      function_name TEXT NOT NULL,
      handler_key TEXT NOT NULL,
      description TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(account_set_id, function_name)
    );

    CREATE INDEX IF NOT EXISTS idx_report_definitions_account_set ON report_definitions(account_set_id, sort_order);
    CREATE INDEX IF NOT EXISTS idx_report_sheets_definition ON report_sheets(report_definition_id, sheet_index);
    CREATE INDEX IF NOT EXISTS idx_report_template_sources_definition ON report_template_sources(report_definition_id);
    CREATE INDEX IF NOT EXISTS idx_report_cells_sheet ON report_cells(report_sheet_id, row_index, col_index);
    CREATE INDEX IF NOT EXISTS idx_report_formula_functions_account_set ON report_formula_functions(account_set_id, function_name);
  `)

  addColumnIfMissing(db, 'report_sheets', 'default_col_width', 'INTEGER DEFAULT 160')
  addColumnIfMissing(db, 'report_sheets', 'default_row_height', 'INTEGER DEFAULT 34')
  addColumnIfMissing(db, 'report_sheets', 'col_widths', 'TEXT')
  addColumnIfMissing(db, 'report_sheets', 'row_heights', 'TEXT')
  addColumnIfMissing(db, 'report_sheets', 'created_at', "TEXT NOT NULL DEFAULT (datetime('now'))")

  addColumnIfMissing(db, 'report_cells', 'col_width', 'TEXT')
  addColumnIfMissing(db, 'report_cells', 'row_height', 'TEXT')
  addColumnIfMissing(db, 'report_cells', 'merge_info', 'TEXT')
  addColumnIfMissing(db, 'report_cells', 'side', "TEXT CHECK(side IN ('left', 'right'))")
  addColumnIfMissing(db, 'report_cells', 'format_text', 'TEXT')
  addColumnIfMissing(db, 'report_cells', 'style_key', 'TEXT')
  addColumnIfMissing(db, 'report_cells', 'updated_at', "TEXT NOT NULL DEFAULT (datetime('now'))")

  ensureReportSourceConstraint(db)
}

const REPORT_DEFINITIONS_COLUMNS = [
  'id',
  'account_set_id',
  'code',
  'name',
  'source',
  'source_file',
  'sort_order',
  'is_enabled',
  'created_at',
  'updated_at',
] as const

const REPORT_TEMPLATE_SOURCES_COLUMNS = [
  'id',
  'report_definition_id',
  'source_file',
  'source_type',
  'raw_content',
  'content_encoding',
  'parse_version',
  'created_at',
] as const

function listTableColumns(db: Database.Database, table: string): string[] {
  if (!tableExists(db, table)) return []
  return (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(
    row => row.name
  )
}

function copyTableByColumns(
  db: Database.Database,
  fromTable: string,
  toTable: string,
  targetColumns: readonly string[]
) {
  const existing = listTableColumns(db, fromTable)
  const shared = targetColumns.filter(column => existing.includes(column))
  if (shared.length === 0) return
  const columnList = shared.join(', ')
  db.exec(
    `INSERT INTO ${toTable} (${columnList}) SELECT ${columnList} FROM ${fromTable}`
  )
}

/** 允许 report_definitions.source = 'xls'（标准模版 Excel 导入） */
function ensureReportSourceConstraint(db: Database.Database) {
  if (!tableExists(db, 'report_definitions')) return

  addColumnIfMissing(db, 'report_definitions', 'created_at', "TEXT NOT NULL DEFAULT (datetime('now'))")
  addColumnIfMissing(db, 'report_definitions', 'updated_at', "TEXT NOT NULL DEFAULT (datetime('now'))")

  const tableInfo = db
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='report_definitions'")
    .get() as { sql: string } | undefined

  if (tableInfo?.sql && !tableInfo.sql.includes("'xls'")) {
    db.exec(`
      CREATE TABLE report_definitions_new (
        id TEXT PRIMARY KEY,
        account_set_id TEXT NOT NULL REFERENCES account_sets(id),
        code TEXT NOT NULL,
        name TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'acd' CHECK(source IN ('acd', 'manual', 'xls')),
        source_file TEXT,
        sort_order INTEGER DEFAULT 0,
        is_enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(account_set_id, code)
      );
    `)
    copyTableByColumns(db, 'report_definitions', 'report_definitions_new', REPORT_DEFINITIONS_COLUMNS)
    db.exec(`
      DROP TABLE report_definitions;
      ALTER TABLE report_definitions_new RENAME TO report_definitions;
      CREATE INDEX IF NOT EXISTS idx_report_definitions_account_set ON report_definitions(account_set_id, sort_order);
    `)
  }

  if (!tableExists(db, 'report_template_sources')) return

  addColumnIfMissing(
    db,
    'report_template_sources',
    'created_at',
    "TEXT NOT NULL DEFAULT (datetime('now'))"
  )

  const sourceTableInfo = db
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='report_template_sources'")
    .get() as { sql: string } | undefined

  if (sourceTableInfo?.sql && !sourceTableInfo.sql.includes("'xls'")) {
    db.exec(`
      CREATE TABLE report_template_sources_new (
        id TEXT PRIMARY KEY,
        report_definition_id TEXT NOT NULL REFERENCES report_definitions(id) ON DELETE CASCADE,
        source_file TEXT NOT NULL,
        source_type TEXT NOT NULL DEFAULT 'vts' CHECK(source_type IN ('vts', 'txt', 'xls')),
        raw_content TEXT,
        content_encoding TEXT DEFAULT 'gb18030',
        parse_version TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(report_definition_id, source_file)
      );
    `)
    copyTableByColumns(
      db,
      'report_template_sources',
      'report_template_sources_new',
      REPORT_TEMPLATE_SOURCES_COLUMNS
    )
    db.exec(`
      DROP TABLE report_template_sources;
      ALTER TABLE report_template_sources_new RENAME TO report_template_sources;
      CREATE INDEX IF NOT EXISTS idx_report_template_sources_definition ON report_template_sources(report_definition_id);
    `)
  }
}
