import type { Database } from 'better-sqlite3'
import type { Migration } from '../migrations.js'
import { collectBoldAlignments } from '../../services/reportBoldAlignment.js'

/**
 * 已导入的标准报表：金额格的加粗跟随项目名称（规则见 services/reportBoldAlignment.ts）。
 *
 * 导入侧已加同一道归一化，这里只是把存量报表补齐；只加不减，可重复执行。
 * down 不回收：无法区分「迁移补的」与「用户后来手工加的」加粗，回滚会误删用户样式。
 */
export const up: Migration = (db: Database) => {
  const tableExists = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`)
    .get('rh_standard_report_cells')
  if (!tableExists) return

  const reports = db.prepare(`SELECT id FROM rh_standard_reports`).all() as Array<{ id: string }>
  const selectCells = db.prepare(
    `SELECT id, row_index, col_index, cell_type, text_value, formula_text, style_key
     FROM rh_standard_report_cells WHERE report_id = ?`
  )
  const updateCell = db.prepare(
    `UPDATE rh_standard_report_cells SET style_key = ?, updated_at = datetime('now') WHERE id = ?`
  )

  for (const report of reports) {
    const rows = selectCells.all(report.id) as Array<{
      id: string
      row_index: number
      col_index: number
      cell_type: string
      text_value: string | null
      formula_text: string | null
      style_key: string | null
    }>
    const cells = rows.map(row => ({
      id: row.id,
      rowIndex: row.row_index,
      colIndex: row.col_index,
      cellType: row.cell_type,
      textValue: row.text_value,
      formulaText: row.formula_text,
      styleKey: row.style_key,
    }))
    for (const { cell, styleKey } of collectBoldAlignments(cells)) {
      updateCell.run(styleKey, cell.id)
    }
  }
}

export const down: Migration = () => {}
