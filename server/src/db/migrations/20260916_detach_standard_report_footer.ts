import type { Database } from 'better-sqlite3'
import type { Migration } from '../migrations.js'
import { collectFooterLayoutChanges } from '../../services/reportFooterLayout.js'

/**
 * 已导入的标准报表：签字行从表格里摘出来（规则见 services/reportFooterLayout.ts）——
 * 去框、整句跨列合并、删掉补框造出来的空格；签字行紧邻下方的整行空行同样去框。
 * 导入侧已加同一道处理，这里补存量；可重复执行（已处理过的格子不会再变）。
 *
 * 签字行整句合并后只占一行，原先按折行撑高的行高一并收回到与上一行相同。
 * down 不回收：无法区分「迁移去的」与「用户后来手工去的」边框。
 */
export const up: Migration['up'] = (db: Database) => {
  const tableExists = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`)
    .get('rh_standard_report_cells')
  if (!tableExists) return
  const columns = db.prepare(`PRAGMA table_info(rh_standard_report_cells)`).all() as Array<{ name: string }>
  if (!columns.some(column => column.name === 'merge_info')) return
  const reportColumns = db.prepare(`PRAGMA table_info(rh_standard_reports)`).all() as Array<{ name: string }>
  const hasRowHeights = reportColumns.some(column => column.name === 'row_heights')

  const reports = db
    .prepare(`SELECT id${hasRowHeights ? ', row_heights' : ''} FROM rh_standard_reports`)
    .all() as Array<{ id: string; row_heights?: string | null }>
  const selectCells = db.prepare(
    `SELECT id, row_index, col_index, cell_type, text_value, formula_text, style_key, merge_info
     FROM rh_standard_report_cells WHERE report_id = ?`
  )
  const deleteCell = db.prepare(`DELETE FROM rh_standard_report_cells WHERE id = ?`)
  const updateCell = db.prepare(
    `UPDATE rh_standard_report_cells
     SET merge_info = ?, style_key = ?, updated_at = datetime('now')
     WHERE id = ?`
  )
  const updateHeights = hasRowHeights
    ? db.prepare(`UPDATE rh_standard_reports SET row_heights = ? WHERE id = ?`)
    : null

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
      const { updated, removed } = collectFooterLayoutChanges(cells)
      for (const cell of removed) deleteCell.run(cell.id)
      for (const change of updated) {
        updateCell.run(change.mergeInfo, change.styleKey, change.cell.id)
      }

      // 整句合并的签字行：行高收回到上一行的高度
      if (!updateHeights || !report.row_heights) continue
      const merged = updated.filter(change => change.mergeInfo && !change.cell.mergeInfo)
      if (!merged.length) continue
      let heights: number[]
      try {
        heights = JSON.parse(report.row_heights)
      } catch {
        continue
      }
      if (!Array.isArray(heights)) continue
      let changed = false
      for (const change of merged) {
        const row = change.cell.rowIndex
        const above = heights[row - 1]
        if (row > 0 && typeof above === 'number' && typeof heights[row] === 'number' && heights[row] > above) {
          heights[row] = above
          changed = true
        }
      }
      if (changed) updateHeights.run(JSON.stringify(heights), report.id)
    }
  })
  apply()
}

export const down: Migration['down'] = () => {}
