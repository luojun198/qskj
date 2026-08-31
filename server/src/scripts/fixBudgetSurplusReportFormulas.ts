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
  { row: 8, col: 2, formula: '=B9+B12-B17-B20+B25' },
  { row: 9, col: 2, formula: '=B10+B11' },
  { row: 12, col: 2, formula: '=B13+B14+B15+B16' },
  { row: 17, col: 2, formula: '=B18+B19' },
  { row: 20, col: 2, formula: '=B21+B22+B23+B24' },
  { row: 26, col: 2, formula: '=B6+B8' },
]

export function fixBudgetSurplusReportFormulas(accountSetId?: string, db: Database = getDb()) {
  const targets = accountSetId
    ? [{ id: accountSetId }]
    : (db
        .prepare(
          `
          SELECT DISTINCT account_set_id as id
          FROM report_definitions
          WHERE code = '5' AND name LIKE '%预算结余%'
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
          WHERE account_set_id = ? AND code = '5' AND name LIKE '%预算结余%'
          LIMIT 1
          `
        )
        .get(target.id) as { id: string } | undefined

      if (!definition) continue

      const sheets = db
        .prepare(
          `
          SELECT id
          FROM report_sheets
          WHERE report_definition_id = ?
          ORDER BY sheet_index ASC
          `
        )
        .all(definition.id) as Array<{ id: string }>

      if (sheets.length === 0) continue

      for (const sheet of sheets) {
        for (const patch of MAIN_SHEET_PATCHES) {
          const result = updateCell.run(patch.formula, sheet.id, patch.row - 1, patch.col - 1)
          updated += result.changes
        }
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

if (isDirectScriptRun('fixBudgetSurplusReportFormulas')) {
  const accountSetId = process.argv[2]
  const result = fixBudgetSurplusReportFormulas(accountSetId)
  console.log(`本年盈余与预算结余差异表公式修复完成：更新 ${result.updated} 个单元格，处理 ${result.targetCount} 个账套`)
}
