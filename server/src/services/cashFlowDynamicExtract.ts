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

/** 按行标签定位小计行（各准则模板行次不同：企业 11 号、小企业 3 号、政府 4 号…） */
const NET_ROW_LABELS = {
  operating: /(经营|日常|业务)活动产生的现金流量净额/,
  investing: /投资活动产生的现金流量净额/,
  financing: /筹资活动产生的现金流量净额/,
  net: /现金(及现金等价物)?净增加额/,
} as const

function findRowByLabel(
  cells: Array<{ row_index: number; col_index: number; text_value: string | null }>,
  pattern: RegExp
): number | null {
  const hit = cells
    .filter(c => c.col_index <= 1 && pattern.test(String(c.text_value || '').replace(/\s/g, '')))
    .sort((a, b) => a.row_index - b.row_index)[0]
  return hit ? hit.row_index : null
}

/** 按表头文字定位金额列（找不到时沿用固定列） */
function findAmountCol(
  cells: Array<{ row_index: number; col_index: number; text_value: string | null }>,
  scope: CashFlowReportScope,
  fallback: number
): number {
  const pattern = scope === 'ytd' ? /本年累计|累计金额|本年金额/ : /本月|本期金额/
  const hit = cells
    .filter(c => c.row_index <= 6 && c.col_index >= 1 && pattern.test(String(c.text_value || '').replace(/\s/g, '')))
    .sort((a, b) => a.row_index - b.row_index || a.col_index - b.col_index)[0]
  return hit ? hit.col_index : fallback
}

/**
 * 执行账套的现金流量表模板，提取三大活动净额（与 @xj_je 公式结果一致）。
 * 优先 code=3（小企业模板），否则取名称为「现金流量表」的第一张报表；小计行 / 金额列按文字定位。
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
      SELECT id, name, code
      FROM report_definitions
      WHERE account_set_id = ? AND name LIKE '%现金流量表%' AND name NOT LIKE '%补充%' AND name NOT LIKE '%附表%'
      ORDER BY CASE WHEN code = '3' THEN 0 ELSE 1 END, sort_order
      LIMIT 1
    `
    )
    .get(accountSetId) as { id: string; name: string; code: string } | undefined

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

  const rowOf = (key: keyof typeof NET_CELL_ROWS) => findRowByLabel(cells, NET_ROW_LABELS[key])
  const labelRows = {
    operating: rowOf('operating'),
    investing: rowOf('investing'),
    financing: rowOf('financing'),
    net: rowOf('net'),
  }
  const byLabel = labelRows.operating !== null && labelRows.investing !== null && labelRows.financing !== null
  // 行文字找不到时只有沿用固定行次的 code=3 版式才可信
  if (!byLabel && String(definition.code) !== '3') return null
  const rows = byLabel
    ? { ...NET_CELL_ROWS, ...Object.fromEntries(Object.entries(labelRows).filter(([, v]) => v !== null)) }
    : NET_CELL_ROWS
  const col = byLabel ? findAmountCol(cells, scope, amountCol) : amountCol

  return {
    operating: cellNumeric(executedCells, rows.operating, col),
    investing: cellNumeric(executedCells, rows.investing, col),
    financing: cellNumeric(executedCells, rows.financing, col),
    net: cellNumeric(executedCells, rows.net, col),
    templateName: definition.name,
    columnLabel,
  }
}
