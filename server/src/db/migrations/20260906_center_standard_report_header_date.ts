import type { Database } from 'better-sqlite3'
import type { Migration } from '../migrations.js'
import { collectHeaderDateChanges } from '../../services/reportHeaderLayout.js'

/**
 * 已导入的标准报表：抬头日期整行居中、公司名挪到日期下一行（规则见 services/reportHeaderLayout.ts）。
 * 导入侧已加同一道处理，这里补存量；可重复执行（已处理过的格子不会再变）。
 * 迁移 117 复用本函数：116 若已在旧规则下跑过，117 会把后来加的「公司名挪行」补上。
 */
export function applyStandardReportHeaderLayout(db: Database) {
  const tableExists = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`)
    .get('rh_standard_report_cells')
  if (!tableExists) return
  const columns = db.prepare(`PRAGMA table_info(rh_standard_report_cells)`).all() as Array<{ name: string }>
  if (!columns.some(column => column.name === 'merge_info')) return

  const reports = db.prepare(`SELECT id FROM rh_standard_reports`).all() as Array<{ id: string }>
  const selectCells = db.prepare(
    `SELECT id, row_index, col_index, cell_type, text_value, formula_text, style_key, merge_info
     FROM rh_standard_report_cells WHERE report_id = ?`
  )
  const deleteCell = db.prepare(`DELETE FROM rh_standard_report_cells WHERE id = ?`)
  const updateCell = db.prepare(
    `UPDATE rh_standard_report_cells
     SET row_index = ?, col_index = ?, merge_info = ?, style_key = ?, updated_at = datetime('now')
     WHERE id = ?`
  )

  const apply = db.transaction(() => {
    for (const report of reports) {
      const rows = selectCells.all(report.id) as Array<{
        id: string
        row_index: number
        col_index: number
        cell_type: string
        text_value: string | null
        formula_text: string | null
        style_key: string | null
        merge_info: string | null
      }>
      const cells = rows.map(row => ({
        id: row.id,
        rowIndex: row.row_index,
        colIndex: row.col_index,
        cellType: row.cell_type,
        textValue: row.text_value,
        formulaText: row.formula_text,
        styleKey: row.style_key,
        mergeInfo: row.merge_info,
      }))
      // 变更按顺序应用：先删被盖住的空格、先挪公司名再铺日期，避免撞上 (report_id, row, col) 唯一约束
      for (const change of collectHeaderDateChanges(cells)) {
        for (const removed of change.removed) deleteCell.run(removed.id)
        updateCell.run(change.rowIndex, change.colIndex, change.mergeInfo, change.styleKey, change.cell.id)
      }
    }
  })
  apply()
}

export const up: Migration = (db: Database) => {
  applyStandardReportHeaderLayout(db)
}

export const down: Migration = () => {}
