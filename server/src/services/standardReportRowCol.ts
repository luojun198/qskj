/**
 * 标准报表插删行列：公式引用平移 + 单元格坐标平移 + 逐行高/逐列宽数组平移，一个事务内完成。
 * 路由与测试共用这一份，测试里不再复刻 SQL。
 */
import type { Database } from 'better-sqlite3'
import { rewriteFormulaForRowCol, type RowColOperation } from './reportFormulaRewrite.js'

/**
 * 插删行列后同步平移逐行高度 / 逐列宽度数组（JSON）。
 * 插入的新行列沿用操作位置原有的尺寸（在合计行上方插一行，高度与合计行一致最自然）；
 * 位置超出数组时不补。返回 undefined 表示无需改动。
 */
export function shiftSizeList(json: string | null | undefined, operation: RowColOperation) {
  if (!json) return undefined
  let sizes: unknown
  try {
    sizes = JSON.parse(json)
  } catch {
    return undefined
  }
  if (!Array.isArray(sizes)) return undefined
  const list = sizes as number[]
  if (operation.type === 'insert') {
    if (operation.index >= list.length) return undefined
    const fill = list[operation.index]
    list.splice(operation.index, 0, ...Array.from({ length: operation.count }, () => fill))
  } else {
    if (operation.index >= list.length) return undefined
    list.splice(operation.index, operation.count)
  }
  return JSON.stringify(list)
}

export function applyStandardReportRowCol(db: Database, reportId: string, operation: RowColOperation) {
  const isRow = operation.axis === 'row'
  const axisColumn = isRow ? 'row_index' : 'col_index'
  const { index, count } = operation

  const apply = db.transaction(() => {
    // 先重写公式：引用坐标与单元格自身位置无关，但必须在同一事务内完成，
    // 否则插删后既有的 =B5+B6 会静默指向错误的行列。
    const formulaCells = db
      .prepare(
        `SELECT id, formula_text FROM rh_standard_report_cells
         WHERE report_id = ? AND formula_text IS NOT NULL AND length(formula_text) > 0`
      )
      .all(reportId) as Array<{ id: string; formula_text: string }>
    const updateFormula = db.prepare(
      "UPDATE rh_standard_report_cells SET formula_text = ?, updated_at = datetime('now') WHERE id = ?"
    )
    for (const cell of formulaCells) {
      const next = rewriteFormulaForRowCol(cell.formula_text, operation)
      if (next !== cell.formula_text) updateFormula.run(next, cell.id)
    }

    // 再移动 / 删除单元格。
    // 表上有 UNIQUE(report_id, row_index, col_index)，而 UPDATE 是逐行改的：直接 +count
    // 时第 10 行改成第 12 行会撞上还没挪走的第 12 行，报「数据重复」——在报表中间插行必然失败。
    // 先把要挪的行列整体翻到负数区（不可能与现有坐标冲突），再翻回目标位置。
    const shiftCells = (from: number, delta: number) => {
      db.prepare(
        `UPDATE rh_standard_report_cells SET ${axisColumn} = -(${axisColumn} + ?) - 1, updated_at = datetime('now')
         WHERE report_id = ? AND ${axisColumn} >= ?`
      ).run(delta, reportId, from)
      db.prepare(
        `UPDATE rh_standard_report_cells SET ${axisColumn} = -${axisColumn} - 1
         WHERE report_id = ? AND ${axisColumn} < 0`
      ).run(reportId)
    }
    if (operation.type === 'insert') {
      shiftCells(index, count)
    } else {
      db.prepare(
        `DELETE FROM rh_standard_report_cells
         WHERE report_id = ? AND ${axisColumn} >= ? AND ${axisColumn} < ?`
      ).run(reportId, index, index + count)
      shiftCells(index + count, -count)
    }

    // 行高 / 列宽数组是按位置存的，必须跟着行列一起插删，否则插入后下方每一行都套上错位的高度
    const sizeColumn = isRow ? 'row_heights' : 'col_widths'
    const sizeRow = db
      .prepare(`SELECT ${sizeColumn} AS sizes FROM rh_standard_reports WHERE id = ?`)
      .get(reportId) as { sizes: string | null } | undefined
    const nextSizes = shiftSizeList(sizeRow?.sizes, operation)
    if (nextSizes !== undefined) {
      db.prepare(`UPDATE rh_standard_reports SET ${sizeColumn} = ? WHERE id = ?`).run(nextSizes, reportId)
    }

    db.prepare("UPDATE rh_standard_reports SET updated_at = datetime('now') WHERE id = ?").run(reportId)
  })
  apply()
}
