import type { Database } from 'better-sqlite3'
import type { Migration } from '../migrations.js'

/**
 * 把标准报表的标题行合并固化成真实数据。
 *
 * 此前「标题跨列居中」是前端每次渲染时猜出来的（该行只有一个无公式单元格、
 * 且文字去空格后等于报表名），从未落库。于是：
 *   - 公式视图的编辑网格没有这个效果，两个视图观感不一致；
 *   - 一旦用户改了标题文字，猜测失配，居中效果就消失。
 *
 * 这里用与前端 titleRowIndex 完全相同的判定，一次性写入 merge_info 与 style_key。
 * 只在 merge_info 为空时写，可重复执行。
 */

/** 与前端 normalizeTitle 保持一致：去掉半角与全角空白 */
function normalizeTitle(value: string | null) {
  return (value || '').replace(/[\s\u3000]/g, '')
}

const TITLE_STYLE_KEY = 'align-center font-size-18 font-bold'

export const up: Migration['up'] = (db: Database) => {
  const tableExists = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`)
    .get('rh_standard_report_cells')
  if (!tableExists) return

  // merge_info 列由 20260901_extend_rh_standard_report_editable 添加；未执行则跳过
  const columns = db.prepare(`PRAGMA table_info(rh_standard_report_cells)`).all() as Array<{
    name: string
  }>
  if (!columns.some(column => column.name === 'merge_info')) return

  const reports = db.prepare(`SELECT id, name FROM rh_standard_reports`).all() as Array<{
    id: string
    name: string
  }>

  const selectCells = db.prepare(
    `SELECT id, row_index, col_index, text_value, formula_text, merge_info, style_key
     FROM rh_standard_report_cells WHERE report_id = ?`
  )
  const updateCell = db.prepare(
    `UPDATE rh_standard_report_cells
     SET merge_info = ?, style_key = COALESCE(style_key, ?), updated_at = datetime('now')
     WHERE id = ?`
  )

  for (const report of reports) {
    const target = normalizeTitle(report.name)
    if (!target) continue

    const cells = selectCells.all(report.id) as Array<{
      id: string
      row_index: number
      col_index: number
      text_value: string | null
      formula_text: string | null
      merge_info: string | null
      style_key: string | null
    }>
    if (!cells.length) continue

    // 每行的单元格数量与首个单元格（判定标题行需要"该行仅一格"）
    const byRow = new Map<number, { count: number; first: (typeof cells)[number] }>()
    let maxCol = 0
    for (const cell of cells) {
      if (cell.col_index > maxCol) maxCol = cell.col_index
      const entry = byRow.get(cell.row_index)
      if (entry) entry.count += 1
      else byRow.set(cell.row_index, { count: 1, first: cell })
    }

    for (const [, entry] of byRow) {
      if (entry.count !== 1) continue
      if (entry.first.formula_text) continue
      if (normalizeTitle(entry.first.text_value) !== target) continue
      // 已有合并信息的不覆盖
      if (entry.first.merge_info) continue

      const colSpan = maxCol + 1
      if (colSpan <= 1) continue
      updateCell.run(JSON.stringify({ rowSpan: 1, colSpan }), TITLE_STYLE_KEY, entry.first.id)
      break
    }
  }
}

export const down: Migration['down'] = (db: Database) => {
  const tableExists = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`)
    .get('rh_standard_report_cells')
  if (!tableExists) return
  // 只回收本迁移写入的标题样式，避免误删用户后来手动设置的合并
  db.prepare(
    `UPDATE rh_standard_report_cells
     SET merge_info = NULL, style_key = NULL
     WHERE style_key = ?`
  ).run(TITLE_STYLE_KEY)
}
