import type { Database } from 'better-sqlite3'

/** 补正 v36：非流动负债合计公式在库中无 leading '='，需改为汇总 E21:E25。 */
export function up(db: Database): void {
  const updateStmt = db.prepare(`
    UPDATE report_cells
    SET formula_text = ?, updated_at = datetime('now')
    WHERE id = ?
  `)

  const rows = db
    .prepare(
      `SELECT rc.id, rc.col_index
       FROM report_cells rc
       JOIN report_sheets rs ON rs.id = rc.report_sheet_id
       JOIN report_definitions rd ON rd.id = rs.report_definition_id
       WHERE rd.name LIKE '%资产负债表%'
         AND rc.row_index = 25
         AND rc.col_index IN (4, 5)
         AND rc.formula_text IN ('@ye(2901,99)', '=@ye(2901,99)', '@nc(2901)', '=@nc(2901)')`
    )
    .all() as Array<{ id: string; col_index: number }>

  for (const row of rows) {
    const next =
      row.col_index === 4 ? '=E21+E22+E23+E24+E25' : '=F21+F22+F23+F24+F25'
    updateStmt.run(next, row.id)
  }
}

export function down(_db: Database): void {}
