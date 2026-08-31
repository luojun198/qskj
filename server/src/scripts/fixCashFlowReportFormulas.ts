import type { Database } from 'better-sqlite3'
import { getDb } from '../db/index.js'
import { fileURLToPath } from 'node:url'
import { basename } from 'node:path'

type FormulaPatch = {
  row: number
  col: number
  formula: string
}

const MAIN_SHEET_PATCHES: FormulaPatch[] = [
  { row: 11, col: 2, formula: '=B7+B8+B9+B10' },
  { row: 11, col: 3, formula: '=C7+C8+C9+C10' },
  { row: 16, col: 2, formula: '=B12+B13+B14+B15' },
  { row: 16, col: 3, formula: '=C12+C13+C14+C15' },
  { row: 17, col: 2, formula: '=B11-B16' },
  { row: 17, col: 3, formula: '=C11-C16' },
  { row: 23, col: 2, formula: '=B19+B20+B21+B22' },
  { row: 23, col: 3, formula: '=C19+C20+C21+C22' },
  { row: 28, col: 2, formula: '=B24+B25+B26+B27' },
  { row: 28, col: 3, formula: '=C24+C25+C26+C27' },
  { row: 29, col: 2, formula: '=B23-B28' },
  { row: 29, col: 3, formula: '=C23-C28' },
  { row: 34, col: 2, formula: '=B31+B32+B33' },
  { row: 34, col: 3, formula: '=C31+C32+C33' },
  { row: 38, col: 2, formula: '=B35+B36+B37' },
  { row: 38, col: 3, formula: '=C35+C36+C37' },
  { row: 39, col: 2, formula: '=B34-B38' },
  { row: 39, col: 3, formula: '=C34-C38' },
  { row: 41, col: 2, formula: '=B17+B29+B39+B40' },
  { row: 41, col: 3, formula: '=C17+C29+C39+C40' },
]

export function fixCashFlowReportFormulas(accountSetId?: string, db: Database = getDb()) {
  const targets = accountSetId
    ? [{ id: accountSetId }]
    : (db
        .prepare(
          `
          SELECT DISTINCT account_set_id as id
          FROM report_definitions
          WHERE code = '3' AND name LIKE '%现金流量%'
          `
        )
        .all() as Array<{ id: string }>)

  let updated = 0
  const updateCell = db.prepare(
    `
    UPDATE report_cells
    SET cell_type = 'formula',
        text_value = NULL,
        formula_text = ?,
        updated_at = datetime('now')
    WHERE report_sheet_id = ?
      AND row_index = ?
      AND col_index = ?
    `
  )

  const transaction = db.transaction(() => {
    for (const target of targets) {
      const definition = db
        .prepare(
          `
          SELECT id
          FROM report_definitions
          WHERE account_set_id = ? AND code = '3' AND name LIKE '%现金流量%'
          LIMIT 1
          `
        )
        .get(target.id) as { id: string } | undefined

      if (!definition) continue

      const sheet = db
        .prepare(
          `
          SELECT id
          FROM report_sheets
          WHERE report_definition_id = ?
          ORDER BY sheet_index ASC
          LIMIT 1
          `
        )
        .get(definition.id) as { id: string } | undefined

      if (!sheet) continue

      for (const patch of MAIN_SHEET_PATCHES) {
        const result = updateCell.run(patch.formula, sheet.id, patch.row - 1, patch.col - 1)
        updated += result.changes
      }
    }
  })

  transaction()
  return { updated, targetCount: targets.length }
}

function isDirectScriptRun(scriptName: string) {
  if (!process.argv[1]) return false

  const currentName = basename(fileURLToPath(import.meta.url)).replace(/\.(cjs|mjs|js|ts)$/i, '')
  const entryName = basename(process.argv[1]).replace(/\.(cjs|mjs|js|ts)$/i, '')
  return currentName === scriptName && entryName === scriptName
}

if (isDirectScriptRun('fixCashFlowReportFormulas')) {
  const accountSetId = process.argv[2]
  const result = fixCashFlowReportFormulas(accountSetId)
  console.log(`现金流量表公式修复完成：更新 ${result.updated} 个单元格，处理 ${result.targetCount} 个账套`)
}
