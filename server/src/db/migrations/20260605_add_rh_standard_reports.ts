import type { Database } from 'better-sqlite3'
import type { Migration } from '../migrations.js'

export const up: Migration = (db: Database) => {
  // 独立标准报表主表
  db.exec(`
    CREATE TABLE IF NOT EXISTS rh_standard_reports (
      id TEXT PRIMARY KEY,
      account_set_id TEXT NOT NULL REFERENCES account_sets(id),
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      source_file TEXT,
      sort_order INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (account_set_id) REFERENCES account_sets(id) ON DELETE CASCADE,
      UNIQUE(account_set_id, code)
    )
  `)

  // 独立标准报表单元格表（存储解析后的文字和公式）
  db.exec(`
    CREATE TABLE IF NOT EXISTS rh_standard_report_cells (
      id TEXT PRIMARY KEY,
      report_id TEXT NOT NULL REFERENCES rh_standard_reports(id) ON DELETE CASCADE,
      row_index INTEGER NOT NULL,
      col_index INTEGER NOT NULL,
      text_value TEXT,
      formula_text TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(report_id, row_index, col_index)
    )
  `)

  // 索引
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_rh_standard_reports_account_set ON rh_standard_reports(account_set_id, sort_order);
    CREATE INDEX IF NOT EXISTS idx_rh_standard_report_cells_report ON rh_standard_report_cells(report_id, row_index, col_index);
  `)
}

export const down: Migration = (db: Database) => {
  db.exec(`DROP TABLE IF EXISTS rh_standard_report_cells`)
  db.exec(`DROP TABLE IF EXISTS rh_standard_reports`)
}
