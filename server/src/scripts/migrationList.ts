import type { Migration } from '../db/migrations.js'

export const migrations: Migration[] = [
  {
    version: 1,
    name: 'add_missing_tables',
    up: (db) => {
      db.exec(`
        -- 结转类型表
        CREATE TABLE IF NOT EXISTS transfer_types (
          id TEXT PRIMARY KEY,
          account_set_id TEXT REFERENCES account_sets(id),
          code TEXT NOT NULL,
          name TEXT NOT NULL,
          voucher_type TEXT DEFAULT '结转',
          period_type TEXT DEFAULT 'monthly',
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE(account_set_id, code)
        );

        -- 结转配置项表
        CREATE TABLE IF NOT EXISTS transfer_items (
          id TEXT PRIMARY KEY,
          account_set_id TEXT REFERENCES account_sets(id),
          type_code TEXT NOT NULL,
          summary TEXT,
          from_code TEXT,
          from_name TEXT,
          to_code TEXT,
          to_name TEXT,
          transfer_type TEXT DEFAULT 'all' CHECK(transfer_type IN ('all', 'partial')),
          ratio REAL DEFAULT 100,
          sort_order INTEGER DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        -- 自动结转执行记录
        CREATE TABLE IF NOT EXISTS auto_transfer_runs (
          id TEXT PRIMARY KEY,
          account_set_id TEXT NOT NULL REFERENCES account_sets(id),
          year INTEGER NOT NULL,
          period INTEGER NOT NULL,
          transfer_type TEXT NOT NULL,
          voucher_id TEXT NOT NULL REFERENCES vouchers(id),
          created_by TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE(account_set_id, year, period, transfer_type)
        );

        -- 凭证附件表
        CREATE TABLE IF NOT EXISTS voucher_attachments (
          id TEXT PRIMARY KEY,
          account_set_id TEXT NOT NULL REFERENCES account_sets(id),
          voucher_id TEXT NOT NULL REFERENCES vouchers(id),
          filename TEXT NOT NULL,
          original_name TEXT NOT NULL,
          file_path TEXT NOT NULL,
          file_size INTEGER NOT NULL,
          mime_type TEXT NOT NULL,
          created_by TEXT REFERENCES users(id),
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE(account_set_id, filename)
        );

        -- 简化报表模板表
        CREATE TABLE IF NOT EXISTS report_templates (
          id TEXT PRIMARY KEY,
          account_set_id TEXT REFERENCES account_sets(id),
          name TEXT NOT NULL,
          report_type TEXT NOT NULL CHECK(report_type IN ('balance_sheet', 'income_statement', 'cashflow')),
          sort_order INTEGER DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        -- 简化报表模板行项目表
        CREATE TABLE IF NOT EXISTS report_template_items (
          id TEXT PRIMARY KEY,
          template_id TEXT NOT NULL REFERENCES report_templates(id) ON DELETE CASCADE,
          row_no INTEGER NOT NULL,
          item_name TEXT NOT NULL,
          item_type TEXT NOT NULL DEFAULT 'detail' CHECK(item_type IN ('group', 'detail', 'formula', 'text')),
          indent INTEGER DEFAULT 0,
          side TEXT DEFAULT 'left' CHECK(side IN ('left', 'right')),
          formula_end TEXT,
          formula_begin TEXT,
          sort_order INTEGER DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        -- ACD 动态报表定义表
        CREATE TABLE IF NOT EXISTS report_definitions (
          id TEXT PRIMARY KEY,
          account_set_id TEXT NOT NULL REFERENCES account_sets(id),
          code TEXT NOT NULL,
          name TEXT NOT NULL,
          source TEXT NOT NULL DEFAULT 'acd' CHECK(source IN ('acd', 'manual')),
          source_file TEXT,
          sort_order INTEGER DEFAULT 0,
          is_enabled INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE(account_set_id, code)
        );

        -- ACD 动态报表 sheet 表
        CREATE TABLE IF NOT EXISTS report_sheets (
          id TEXT PRIMARY KEY,
          report_definition_id TEXT NOT NULL REFERENCES report_definitions(id) ON DELETE CASCADE,
          sheet_key TEXT NOT NULL,
          sheet_name TEXT NOT NULL,
          sheet_index INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE(report_definition_id, sheet_key)
        );

        -- ACD 报表来源表
        CREATE TABLE IF NOT EXISTS report_template_sources (
          id TEXT PRIMARY KEY,
          report_definition_id TEXT NOT NULL REFERENCES report_definitions(id) ON DELETE CASCADE,
          source_file TEXT NOT NULL,
          source_type TEXT NOT NULL DEFAULT 'vts' CHECK(source_type IN ('vts', 'txt')),
          raw_content TEXT,
          content_encoding TEXT DEFAULT 'gb18030',
          parse_version TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE(report_definition_id, source_file)
        );

        -- ACD 动态报表单元格表
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
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE(report_sheet_id, row_index, col_index)
        );

        -- ACD 公式函数映射表
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

        -- 索引
        CREATE INDEX IF NOT EXISTS idx_transfer_types_account_set ON transfer_types(account_set_id);
        CREATE INDEX IF NOT EXISTS idx_transfer_items_type ON transfer_items(account_set_id, type_code);
        CREATE INDEX IF NOT EXISTS idx_auto_transfer_runs_period ON auto_transfer_runs(account_set_id, year, period, transfer_type);
        CREATE INDEX IF NOT EXISTS idx_voucher_attachments_voucher ON voucher_attachments(account_set_id, voucher_id);
        CREATE INDEX IF NOT EXISTS idx_voucher_attachments_created ON voucher_attachments(account_set_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_report_templates_account_set ON report_templates(account_set_id);
        CREATE INDEX IF NOT EXISTS idx_report_template_items_template ON report_template_items(template_id);
        CREATE INDEX IF NOT EXISTS idx_report_definitions_account_set ON report_definitions(account_set_id, sort_order);
        CREATE INDEX IF NOT EXISTS idx_report_sheets_definition ON report_sheets(report_definition_id, sheet_index);
        CREATE INDEX IF NOT EXISTS idx_report_template_sources_definition ON report_template_sources(report_definition_id);
        CREATE INDEX IF NOT EXISTS idx_report_cells_sheet ON report_cells(report_sheet_id, row_index, col_index);
        CREATE INDEX IF NOT EXISTS idx_report_formula_functions_account_set ON report_formula_functions(account_set_id, function_name);
      `)
    },
    down: (db) => {
      db.exec(`
        DROP TABLE IF EXISTS report_formula_functions;
        DROP TABLE IF EXISTS report_cells;
        DROP TABLE IF EXISTS report_template_sources;
        DROP TABLE IF EXISTS report_sheets;
        DROP TABLE IF EXISTS report_definitions;
        DROP TABLE IF EXISTS report_template_items;
        DROP TABLE IF EXISTS report_templates;
        DROP TABLE IF EXISTS voucher_attachments;
        DROP TABLE IF EXISTS auto_transfer_runs;
        DROP TABLE IF EXISTS transfer_items;
        DROP TABLE IF EXISTS transfer_types;
      `)
    },
  },
  {
    version: 2,
    name: 'add_report_format_fields',
    up: (db) => {
      db.exec(`
        -- Add column width, row height, and merge info to report_cells
        ALTER TABLE report_cells ADD COLUMN col_width INTEGER DEFAULT NULL;
        ALTER TABLE report_cells ADD COLUMN row_height INTEGER DEFAULT NULL;
        ALTER TABLE report_cells ADD COLUMN merge_info TEXT DEFAULT NULL;
        
        -- Add default column widths and row heights to report_sheets
        ALTER TABLE report_sheets ADD COLUMN default_col_width INTEGER DEFAULT 160;
        ALTER TABLE report_sheets ADD COLUMN default_row_height INTEGER DEFAULT 34;
        ALTER TABLE report_sheets ADD COLUMN col_widths TEXT DEFAULT NULL;
        ALTER TABLE report_sheets ADD COLUMN row_heights TEXT DEFAULT NULL;
      `)
    },
    down: (db) => {
      db.exec(`
        -- Remove format fields from report_cells
        ALTER TABLE report_cells DROP COLUMN col_width;
        ALTER TABLE report_cells DROP COLUMN row_height;
        ALTER TABLE report_cells DROP COLUMN merge_info;
        
        -- Remove format fields from report_sheets
        ALTER TABLE report_sheets DROP COLUMN default_col_width;
        ALTER TABLE report_sheets DROP COLUMN default_row_height;
        ALTER TABLE report_sheets DROP COLUMN col_widths;
        ALTER TABLE report_sheets DROP COLUMN row_heights;
      `)
    },
  },
  {
    version: 3,
    name: 'add_transfer_type_period_type',
    up: (db) => {
      db.exec(`ALTER TABLE transfer_types ADD COLUMN period_type TEXT DEFAULT 'monthly'`)
    },
    down: (db) => {
      db.exec(`ALTER TABLE transfer_types DROP COLUMN period_type`)
    },
  },
  {
    version: 4,
    name: 'add_init_balance_detail_fields',
    up: (db) => {
      db.prepare('ALTER TABLE init_balances ADD COLUMN opening_debit REAL NOT NULL DEFAULT 0').run()
      db.prepare('ALTER TABLE init_balances ADD COLUMN opening_credit REAL NOT NULL DEFAULT 0').run()
      db.prepare('ALTER TABLE init_balances ADD COLUMN pre_book_debit REAL NOT NULL DEFAULT 0').run()
      db.prepare('ALTER TABLE init_balances ADD COLUMN pre_book_credit REAL NOT NULL DEFAULT 0').run()
    },
    down: (db) => {
      db.prepare('ALTER TABLE init_balances DROP COLUMN opening_debit').run()
      db.prepare('ALTER TABLE init_balances DROP COLUMN opening_credit').run()
      db.prepare('ALTER TABLE init_balances DROP COLUMN pre_book_debit').run()
      db.prepare('ALTER TABLE init_balances DROP COLUMN pre_book_credit').run()
    },
  },
]
