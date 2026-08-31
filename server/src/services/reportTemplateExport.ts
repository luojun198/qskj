import { existsSync, readdirSync } from 'fs'
import { basename, join, resolve } from 'path'
import ExcelJS from 'exceljs'
import type { Database } from 'better-sqlite3'
import type { AccountScopeContext } from './accountAuthorization.js'
import { executeTemplateSheets } from './reportTemplateExecutor.js'
import { loadReportTemplateExcelSource } from './reportTemplatePersistence.js'
import {
  clearWorksheetOutsideBounds,
  collectTemplateDataCellKeys,
  sanitizeTemplateWorkbook,
  type SheetBounds,
} from './reportTemplateSanitize.js'

type ReportDefinitionRow = {
  id: string
  code: string
  name: string
  source_file: string | null
}

type ReportSheetRow = {
  id: string
  sheet_name: string
  sheet_index: number
}

type ReportCellRow = {
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
}

type ExecutedCell = {
  row_index: number
  col_index: number
  cell_type: string
  text_value: string | null
  formula_text: string | null
  format_text: string | null
  style_key: string | null
  side: string | null
  display_value: string
  numeric_value: number | null
  status: 'ok' | 'error'
  error: string | null
}

function getStandardTemplateDirs() {
  const cwd = process.cwd()
  return [join(cwd, '标准模版'), resolve(cwd, '..', '标准模版')]
}

/** 解析报表原始 Excel 模板路径（支持绝对路径、相对路径、按文件名在标准模版目录搜索） */
export function resolveTemplateFilePath(sourceFile: string | null | undefined): string | null {
  if (!sourceFile?.trim()) return null

  const normalized = sourceFile.trim().replace(/\//g, '\\')
  if (existsSync(normalized)) return normalized

  const cwd = process.cwd()
  const candidates = [
    resolve(cwd, normalized),
    resolve(cwd, '..', normalized),
    resolve(cwd, sourceFile),
    resolve(cwd, '..', sourceFile),
  ]
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }

  const fileName = basename(normalized)
  if (!fileName) return null

  for (const dir of getStandardTemplateDirs()) {
    if (!existsSync(dir)) continue
    const found = findFileByName(dir, fileName)
    if (found) return found
  }

  return null
}

function findFileByName(dir: string, fileName: string): string | null {
  let entries: Array<{ name: string; isDirectory: () => boolean }>
  try {
    entries = readdirSync(dir, { withFileTypes: true }) as Array<{
      name: string
      isDirectory: () => boolean
    }>
  } catch {
    return null
  }

  for (const entry of entries) {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      const nested = findFileByName(fullPath, fileName)
      if (nested) return nested
      continue
    }
    if (entry.name.toLowerCase() === fileName.toLowerCase()) {
      return fullPath
    }
  }
  return null
}

export function resolveUploadedTemplatePath(sourceFile: string | null | undefined): string | null {
  if (!sourceFile?.trim()) return null
  const fileName = basename(sourceFile.trim())
  if (!fileName) return null

  const cwd = process.cwd()
  const uploadRoots = [
    join(cwd, 'uploads', 'report-templates'),
    resolve(cwd, '..', 'uploads', 'report-templates'),
  ]

  for (const root of uploadRoots) {
    if (!existsSync(root)) continue
    const found = findFileByName(root, fileName)
    if (found) return found
  }

  return null
}

async function loadWorkbookForExport(
  templatePath: string | null,
  storedExcel: { buffer: Buffer } | null
): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook()

  // 优先使用数据库中保存的上传副本（导入时已经过 sanitize 净化）；
  // 历史 source_file 路径可能因目录改名 / 跨机迁移而失效，磁盘上能搜到的
  // 同名文件未必是净化后的版本，因此把 raw_content 作为 single source of truth。
  if (storedExcel?.buffer.length) {
    try {
      await workbook.xlsx.load(storedExcel.buffer as any)
      return workbook
    } catch {
      // 落到磁盘回退
    }
  }

  // 数据库无内容时回退磁盘原模板（旧数据 / 极端故障路径）
  if (templatePath && existsSync(templatePath)) {
    if (/\.xls$/i.test(templatePath) && !/\.xlsx$/i.test(templatePath)) {
      throw new Error('当前仅支持导出 .xlsx 格式模板，请将模板另存为 xlsx 后重新导入')
    }
    await workbook.xlsx.readFile(templatePath)
    return workbook
  }

  throw new Error('未找到可用的 Excel 模板内容')
}

function pickWorksheet(workbook: ExcelJS.Workbook, sheetName: string, sheetIndex: number) {
  const trimmed = sheetName.replace(/\(定义\)$/g, '').trim()
  const byName =
    workbook.getWorksheet(trimmed) ||
    workbook.worksheets.find(ws => ws.name.replace(/\(定义\)$/g, '').trim() === trimmed)
  if (byName) return byName
  return workbook.worksheets[sheetIndex] || workbook.worksheets[0]
}

/** 读取 ExcelJS cell 的当前显示值（用于与 db.text_value 比较，避免无谓重写破坏样式） */
function readCellDisplayText(cell: ExcelJS.Cell): string {
  const value = cell.value
  if (value == null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  // ExcelJS 富文本 / 公式 / 共享公式 / 错误 / 合并主单元格等情形
  if (typeof value === 'object') {
    const v = value as any
    if (typeof v.text === 'string') return v.text // hyperlink / formula 结果
    if (typeof v.result === 'string' || typeof v.result === 'number') return String(v.result) // formula
    if (Array.isArray(v.richText)) return v.richText.map((seg: any) => seg.text || '').join('')
    if (v.formula != null) return '' // 公式 cell 但没缓存结果时不视为有显示值
  }
  return ''
}

function writeExecutedValue(cell: ExcelJS.Cell, executed: ExecutedCell) {
  if (executed.status === 'error') {
    cell.value = executed.error || '#ERROR'
    return
  }

  // 公式 cell：只更新计算结果，尽量保留模板原有数字格式
  if (executed.numeric_value !== null && Number.isFinite(executed.numeric_value)) {
    const numFmt = cell.numFmt
    cell.value = executed.numeric_value
    if (numFmt) cell.numFmt = numFmt
    return
  }

  const text = executed.display_value ?? ''
  if (text === '') return

  // text / empty cell：若 Excel 模板该 cell 已经是相同值（说明 db 中的 text 来自模板未修改），
  // 跳过写入以保留原模板的样式（边框、字体、合并状态、共享字符串索引等）。
  // 这样用户在系统里修改过的 text（display_value ≠ Excel 现值）仍会被正确导出。
  if (executed.cell_type !== 'formula') {
    const existing = readCellDisplayText(cell)
    if (existing === text) return
  }

  cell.value = text
}

function computeExportBounds(templateKeys: Set<string>, cells: ExecutedCell[]): SheetBounds | null {
  let minRow = Infinity
  let maxRow = -1
  let minCol = Infinity
  let maxCol = -1

  const consider = (rowIndex: number, colIndex: number) => {
    minRow = Math.min(minRow, rowIndex)
    maxRow = Math.max(maxRow, rowIndex)
    minCol = Math.min(minCol, colIndex)
    maxCol = Math.max(maxCol, colIndex)
  }

  for (const key of templateKeys) {
    const [rowIndex, colIndex] = key.split(':').map(Number)
    consider(rowIndex, colIndex)
  }

  for (const cell of cells) {
    const key = `${cell.row_index}:${cell.col_index}`
    if (templateKeys.has(key)) {
      consider(cell.row_index, cell.col_index)
    }
  }

  if (maxRow < 0) return null
  return { minRow, maxRow, minCol, maxCol }
}

/**
 * 基于原始 Excel 模板回填取数结果并导出（保留版式、合并、样式）
 */
export async function exportReportTemplateToBuffer(params: {
  db: Database
  accountSetId: string
  reportCode: string
  year: number
  period: number
  accountScope?: AccountScopeContext
}): Promise<{ buffer: Buffer; fileName: string }> {
  const { db, accountSetId, reportCode, year, period, accountScope } = params

  const definition = db
    .prepare(
      `
      SELECT id, code, name, source_file
      FROM report_definitions
      WHERE account_set_id = ? AND code = ?
      LIMIT 1
      `
    )
    .get(accountSetId, reportCode) as ReportDefinitionRow | undefined

  if (!definition) {
    throw new Error('未找到对应报表模板')
  }

  const templatePath =
    resolveTemplateFilePath(definition.source_file) ||
    resolveUploadedTemplatePath(definition.source_file)
  const storedExcel = loadReportTemplateExcelSource(db, definition.id)

  if (!templatePath && !storedExcel) {
    throw new Error(
      `未找到原始 Excel 模板文件${definition.source_file ? `：${definition.source_file}` : ''}，请重新导入报表模板`
    )
  }

  const sheets = db
    .prepare(
      `
      SELECT id, sheet_name, sheet_index
      FROM report_sheets
      WHERE report_definition_id = ?
      ORDER BY sheet_index ASC
      `
    )
    .all(definition.id) as ReportSheetRow[]

  if (sheets.length === 0) {
    throw new Error('报表模板没有工作表数据')
  }

  const sheetIds = sheets.map(s => s.id)
  const cells = db
    .prepare(
      `
      SELECT id, report_sheet_id, row_index, col_index, cell_type, text_value, formula_text, format_text, style_key, side
      FROM report_cells
      WHERE report_sheet_id IN (${sheetIds.map(() => '?').join(', ')})
      `
    )
    .all(...sheetIds) as ReportCellRow[]

  const cellsBySheetId = new Map<string, ReportCellRow[]>()
  for (const cell of cells) {
    const bucket = cellsBySheetId.get(cell.report_sheet_id)
    if (bucket) bucket.push(cell)
    else cellsBySheetId.set(cell.report_sheet_id, [cell])
  }

  const accountSet = db
    .prepare('SELECT name FROM account_sets WHERE id = ?')
    .get(accountSetId) as { name: string } | undefined

  const executedSheets = executeTemplateSheets(
    sheets.map(sheet => ({
      id: sheet.id,
      report_definition_id: definition.id,
      sheet_key: `sheet_${sheet.sheet_index + 1}`,
      sheet_name: sheet.sheet_name,
      sheet_index: sheet.sheet_index,
      cells: (cellsBySheetId.get(sheet.id) || []).map(cell => ({
        id: cell.id,
        report_sheet_id: cell.report_sheet_id,
        row_index: cell.row_index,
        col_index: cell.col_index,
        cell_type: cell.cell_type,
        text_value: cell.text_value,
        formula_text: cell.formula_text,
        format_text: cell.format_text,
        style_key: cell.style_key,
        side: cell.side,
      })),
    })),
    {
      db,
      accountSetId,
      year,
      period,
      unitName: accountSet?.name || '',
      accountScope,
    }
  )

  const workbook = await loadWorkbookForExport(templatePath, storedExcel)
  const sheetBoundsList: SheetBounds[] = []

  for (const executedSheet of executedSheets) {
    const meta = sheets.find(s => s.id === executedSheet.id)
    if (!meta) continue

    const worksheet = pickWorksheet(workbook, meta.sheet_name, meta.sheet_index)
    if (!worksheet) continue

    const templateDataKeys = collectTemplateDataCellKeys(worksheet)
    const executedCells = executedSheet.cells as ExecutedCell[]

    for (const cell of executedCells) {
      const cellKey = `${cell.row_index}:${cell.col_index}`
      if (!templateDataKeys.has(cellKey)) continue

      const excelCell = worksheet.getRow(cell.row_index + 1).getCell(cell.col_index + 1)
      writeExecutedValue(excelCell, cell)
    }

    const bounds = computeExportBounds(templateDataKeys, executedCells)
    if (bounds) {
      clearWorksheetOutsideBounds(worksheet, bounds)
    }

    // 打印/导出：A4 纵向，缩放至单页宽高，保证整表完整落在一张 A4 上
    worksheet.pageSetup = {
      ...worksheet.pageSetup,
      orientation: 'portrait',
      paperSize: 9, // A4
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 1,
      horizontalCentered: true,
      margins: {
        left: 0.2,
        right: 0.2,
        top: 0.3,
        bottom: 0.3,
        header: 0.1,
        footer: 0.1,
      },
    }

    sheetBoundsList.push(
      bounds ?? { minRow: 0, maxRow: -1, minCol: 0, maxCol: -1 }
    )
  }

  void sheetBoundsList
  // ExcelJS 在 writeBuffer 时会重新生成 sheetView 与 dimension，丢掉原模板的
  // showGridLines=0 与已裁剪边界。导出末尾再走一遍 sanitize 保证最终文件干净。
  const rawBuffer = Buffer.from(await workbook.xlsx.writeBuffer())
  const buffer = await sanitizeTemplateWorkbook(rawBuffer)
  const safeName = (definition.name || reportCode).replace(/[\\/:*?"<>|]/g, '_')
  const fileName = `${safeName}_${year}年${period}月.xlsx`

  return { buffer, fileName }
}
