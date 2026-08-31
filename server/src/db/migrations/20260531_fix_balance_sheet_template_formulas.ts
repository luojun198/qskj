import type { Database } from 'better-sqlite3'

/** 行政事业单位资产负债表：流动资产合计漏计 B5/C5（货币资金在标题行），非流动负债合计误用 2901 导致与受托代理负债重复。 */
export function up(db: Database): void {
  const updateStmt = db.prepare(`
    UPDATE report_cells
    SET formula_text = ?, updated_at = datetime('now')
    WHERE id = ?
  `)

  const assetSumOldB = '=B6+B7+B8+B9+B10+B11+B12+B13+B14+B15+B16+B17+B18'
  const assetSumNewB = '=B5+B6+B7+B8+B9+B10+B11+B12+B13+B14+B15+B16+B17+B18'
  const assetSumOldC = '=C6+C7+C8+C9+C10+C11+C12+C13+C14+C15+C16+C17+C18'
  const assetSumNewC = '=C5+C6+C7+C8+C9+C10+C11+C12+C13+C14+C15+C16+C17+C18'

  const fixAssetSum = db
    .prepare(
      `SELECT rc.id, rc.formula_text
       FROM report_cells rc
       JOIN report_sheets rs ON rs.id = rc.report_sheet_id
       JOIN report_definitions rd ON rd.id = rs.report_definition_id
       WHERE rd.name LIKE '%资产负债表%'
         AND rc.formula_text IN (?, ?)`
    )
    .all(assetSumOldB, assetSumOldC) as Array<{ id: string; formula_text: string }>

  for (const row of fixAssetSum) {
    const next = row.formula_text === assetSumOldB ? assetSumNewB : assetSumNewC
    updateStmt.run(next, row.id)
  }

  const fixNonCurrentLiab = db
    .prepare(
      `SELECT rc.id, rc.col_index, rc.formula_text
       FROM report_cells rc
       JOIN report_sheets rs ON rs.id = rc.report_sheet_id
       JOIN report_definitions rd ON rd.id = rs.report_definition_id
       WHERE rd.name LIKE '%资产负债表%'
         AND rc.row_index = 25
         AND rc.col_index IN (4, 5)
         AND rc.formula_text IN ('@ye(2901,99)', '=@ye(2901,99)', '@nc(2901)', '=@nc(2901)')`
    )
    .all() as Array<{ id: string; col_index: number; formula_text: string }>

  for (const row of fixNonCurrentLiab) {
    const next =
      row.col_index === 4 ? '=E21+E22+E23+E24+E25' : '=F21+F22+F23+F24+F25'
    updateStmt.run(next, row.id)
  }
}

export function down(_db: Database): void {
  // 模板公式修正，不回滚
}
