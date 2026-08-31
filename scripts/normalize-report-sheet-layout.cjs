/**
 * 将 report_sheets.col_widths / row_heights 裁剪为实际使用的列数/行数。
 * 用法: node scripts/normalize-report-sheet-layout.cjs [dbPath]
 */
const Database = require('better-sqlite3')
const { resolve } = require('path')

const dbPath = resolve(process.argv[2] || 'data/finance.db')
const db = new Database(dbPath)

const sheets = db
  .prepare(
    `
    SELECT rs.id, rs.col_widths, rs.row_heights
    FROM report_sheets rs
    `
  )
  .all()

let updated = 0
const tx = db.transaction(() => {
  for (const sheet of sheets) {
    const bounds = db
      .prepare(
        `
        SELECT MAX(row_index) AS max_row, MAX(col_index) AS max_col
        FROM report_cells
        WHERE report_sheet_id = ?
        `
      )
      .get(sheet.id)

    const colCount = Math.max((bounds?.max_col ?? -1) + 1, 1)
    const rowCount = Math.max((bounds?.max_row ?? -1) + 1, 1)

    let colWidths = []
    let rowHeights = []
    try {
      colWidths = sheet.col_widths ? JSON.parse(sheet.col_widths) : []
    } catch {
      colWidths = []
    }
    try {
      rowHeights = sheet.row_heights ? JSON.parse(sheet.row_heights) : []
    } catch {
      rowHeights = []
    }

    const nextColWidths = colWidths.slice(0, colCount)
    while (nextColWidths.length < colCount) nextColWidths.push(160)

    const nextRowHeights = rowHeights.slice(0, rowCount)
    while (nextRowHeights.length < rowCount) {
      nextRowHeights.push(nextRowHeights.length === 0 ? 37 : 28)
    }

    const nextColJson = JSON.stringify(nextColWidths)
    const nextRowJson = JSON.stringify(nextRowHeights)
    if (nextColJson !== sheet.col_widths || nextRowJson !== sheet.row_heights) {
      db.prepare(`UPDATE report_sheets SET col_widths = ?, row_heights = ? WHERE id = ?`).run(
        nextColJson,
        nextRowJson,
        sheet.id
      )
      updated += 1
    }
  }
})

tx()
console.log(`Normalized ${updated}/${sheets.length} sheets in ${dbPath}`)
db.close()
