import type { Database } from 'better-sqlite3'
import type { AccountScopeContext } from './accountAuthorization.js'
import { executeTemplateSheets } from './reportTemplateExecutor.js'
import type { CashFlowReportScope } from './cashFlowIndirectMethod.js'

export type DynamicCashFlowTotals = {
  operating: number
  investing: number
  financing: number
  net: number
  templateName: string
  columnLabel: string
}

/** 动态现金流量表主表小计行（0-based，与 fixCashFlowReportFormulas 一致） */
const NET_CELL_ROWS = {
  operating: 17,
  investing: 29,
  financing: 39,
  net: 41,
} as const

/** col 2 = 本年累计列，col 3 = 本月金额列（0-based，与 fixCashFlowReportFormulas 一致） */
const YTD_AMOUNT_COL = 2
const CURRENT_PERIOD_COL = 3

function cellNumeric(
  cells: Array<{ row_index: number; col_index: number; numeric_value: number | null }>,
  row: number,
  col: number
): number {
  const cell = cells.find(c => c.row_index === row && c.col_index === col)
  return Number(cell?.numeric_value ?? 0)
}

/**
 * 执行账套 code=3 现金流量表模板，提取三大活动净额（与 @xj_je 公式结果一致）
 */
export function getDynamicCashFlowTotals(
  db: Database,
  accountSetId: string,
  year: number,
  period: number,
  scope: CashFlowReportScope = 'month',
  accountScope?: AccountScopeContext
): DynamicCashFlowTotals | null {
  const amountCol = scope === 'ytd' ? YTD_AMOUNT_COL : CURRENT_PERIOD_COL
  const columnLabel = scope === 'ytd' ? '本年累计金额' : '本月金额'
  const definition = db
    .prepare(
      `
      SELECT id, name
      FROM report_definitions
      WHERE account_set_id = ? AND code = '3' AND name LIKE '%现金流量%'
      ORDER BY sort_order
      LIMIT 1
    `
    )
    .get(accountSetId) as { id: string; name: string } | undefined

  if (!definition) return null

  const sheets = db
    .prepare(
      `
      SELECT id, report_definition_id, sheet_key, sheet_name, sheet_index
      FROM report_sheets
      WHERE report_definition_id = ?
      ORDER BY sheet_index
    `
    )
    .all(definition.id) as Array<{
    id: string
    report_definition_id: string
    sheet_key: string
    sheet_name: string
    sheet_index: number
  }>

  if (sheets.length === 0) return null

  const mainSheet = sheets[0]
  const cells = db
    .prepare(
      `
      SELECT id, report_sheet_id, row_index, col_index, cell_type, text_value, formula_text, format_text, style_key, side
      FROM report_cells
      WHERE report_sheet_id = ?
    `
    )
    .all(mainSheet.id) as Array<{
    id: string
    report_sheet_id: string
    row_index: number
    col_index: number
    cell_type: string
    text_value: string | null
    formula_text: string | null
    format_text: string | null
    style_key: string | null
    side: string | null
  }>

  const unitRow = db.prepare('SELECT name FROM account_sets WHERE id = ?').get(accountSetId) as
    | { name: string }
    | undefined

  const executed = executeTemplateSheets(
    [{ ...mainSheet, cells }],
    {
      db,
      accountSetId,
      year,
      period,
      unitName: unitRow?.name || '',
      accountScope,
    }
  )[0]

  if (!executed) return null

  const executedCells = executed.cells as Array<{
    row_index: number
    col_index: number
    numeric_value: number | null
  }>

  return {
    operating: cellNumeric(executedCells, NET_CELL_ROWS.operating, amountCol),
    investing: cellNumeric(executedCells, NET_CELL_ROWS.investing, amountCol),
    financing: cellNumeric(executedCells, NET_CELL_ROWS.financing, amountCol),
    net: cellNumeric(executedCells, NET_CELL_ROWS.net, amountCol),
    templateName: definition.name,
    columnLabel,
  }
}
