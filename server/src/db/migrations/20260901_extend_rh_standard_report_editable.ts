import type { Database } from 'better-sqlite3'
import type { Migration } from '../migrations.js'

/**
 * 标准报表模板编辑器（一期）：给 rh_standard_report_* 补齐可编辑所需的字段。
 *
 * 字段名与语义严格对齐 report_cells / report_sheets（动态报表体系），
 * 以便前端复用 ReportSheetGrid / ReportDesignToolbar 两个组件，
 * 也为将来两套模型合并留出余地。
 *
 * 二期打印要用的 paper_* / margin_* / scale 也在本次一并加好，避免二次迁移。
 */

function columnExists(db: Database, table: string, column: string) {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  return rows.some(row => row.name === column)
}

function tableExists(db: Database, table: string) {
  const row = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`)
    .get(table)
  return Boolean(row)
}

function addColumnIfMissing(db: Database, table: string, column: string, definition: string) {
  if (!tableExists(db, table)) return
  if (columnExists(db, table, column)) return
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
}

export const up: Migration = (db: Database) => {
  // 单元格：对齐 report_cells 的字段集
  // 注意 cell_type 不加 CHECK 约束——SQLite 的 ALTER TABLE ADD COLUMN 无法回头补 CHECK，
  // 取值合法性由写接口保证（'text' | 'formula' | 'number' | 'empty' | 'merged'）。
  addColumnIfMissing(db, 'rh_standard_report_cells', 'cell_type', "TEXT NOT NULL DEFAULT 'text'")
  addColumnIfMissing(db, 'rh_standard_report_cells', 'format_text', 'TEXT')
  addColumnIfMissing(db, 'rh_standard_report_cells', 'style_key', 'TEXT')
  addColumnIfMissing(
    db,
    'rh_standard_report_cells',
    'side',
    "TEXT CHECK(side IN ('left', 'right'))"
  )
  addColumnIfMissing(db, 'rh_standard_report_cells', 'merge_info', 'TEXT')
  addColumnIfMissing(db, 'rh_standard_report_cells', 'col_width', 'TEXT')
  addColumnIfMissing(db, 'rh_standard_report_cells', 'row_height', 'TEXT')
  // 注意：SQLite 的 ALTER TABLE ADD COLUMN 不接受非常量默认值（datetime('now')），
  // 故这里加可空列后回填，而不是照搬 ensureDynamicReportSchema 里的 NOT NULL DEFAULT 写法。
  addColumnIfMissing(db, 'rh_standard_report_cells', 'updated_at', 'TEXT')

  // 报表：行列尺寸（标准报表是单 sheet，直接挂主表，不另建 sheets 层）
  addColumnIfMissing(db, 'rh_standard_reports', 'default_col_width', 'INTEGER DEFAULT 160')
  addColumnIfMissing(db, 'rh_standard_reports', 'default_row_height', 'INTEGER DEFAULT 34')
  addColumnIfMissing(db, 'rh_standard_reports', 'col_widths', 'TEXT')
  addColumnIfMissing(db, 'rh_standard_reports', 'row_heights', 'TEXT')

  // 报表：打印设置（二期使用，本期只建字段不读写）
  addColumnIfMissing(db, 'rh_standard_reports', 'paper_size', "TEXT DEFAULT 'A4'")
  addColumnIfMissing(db, 'rh_standard_reports', 'paper_orientation', "TEXT DEFAULT 'portrait'")
  addColumnIfMissing(db, 'rh_standard_reports', 'print_scale', 'REAL')
  addColumnIfMissing(db, 'rh_standard_reports', 'margin_top', 'REAL')
  addColumnIfMissing(db, 'rh_standard_reports', 'margin_bottom', 'REAL')
  addColumnIfMissing(db, 'rh_standard_reports', 'margin_left', 'REAL')
  addColumnIfMissing(db, 'rh_standard_reports', 'margin_right', 'REAL')

  // 回填存量数据：cell_type 按有无公式区分；updated_at 沿用 created_at
  if (tableExists(db, 'rh_standard_report_cells')) {
    db.exec(`
      UPDATE rh_standard_report_cells
      SET cell_type = 'formula'
      WHERE formula_text IS NOT NULL AND length(formula_text) > 0
    `)
    // 不引用 created_at：部分库的该表由建表迁移之外的路径创建，并没有这一列
    db.exec(`
      UPDATE rh_standard_report_cells
      SET updated_at = datetime('now')
      WHERE updated_at IS NULL
    `)
  }
}

export const down: Migration = () => {
  // SQLite 早期版本不支持 DROP COLUMN，且这些列均可为空/带默认值，
  // 保留它们不会影响旧代码读写，故回滚为空操作。
}
