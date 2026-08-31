import { Database } from 'better-sqlite3'
import { readFileSync } from 'fs'
import { v4 as uuidv4 } from 'uuid'
import xlsx from 'xlsx'
import ExcelJS from 'exceljs'
import { isImportableExcelFileName } from '../utils/reportTemplateFiles.js'
import { saveReportTemplateExcelSource } from './reportTemplatePersistence.js'
import { ensureDynamicReportSchema } from '../db/ensureDynamicReportSchema.js'

interface ExcelFile {
  name: string // 报表名称（文件名去除扩展名）
  path: string // 文件路径
}

interface ReportImportResult {
  success: boolean
  reportCode: string
  reportName: string
  error?: string
}

type MergeSpan = { rowSpan: number; colSpan: number }
type SheetContentBounds = { minR: number; minC: number; maxR: number; maxC: number }

type ExcelCellStyle = {
  font?: Partial<ExcelJS.Font>
  alignment?: Partial<ExcelJS.Alignment>
  border?: Partial<ExcelJS.Borders>
  numFmt?: string
}

type ExcelStyleBundle = {
  stylesBySheet: Map<number, Map<string, ExcelCellStyle>>
  mergesBySheet: Map<number, Map<string, MergeSpan>>
  dimensionsBySheet: Map<number, { maxR: number; maxC: number }>
}

const EMPTY_STYLE_BUNDLE: ExcelStyleBundle = {
  stylesBySheet: new Map(),
  mergesBySheet: new Map(),
  dimensionsBySheet: new Map(),
}

function extractFormulaFunctions(formulas: string[]) {
  const functions = new Set<string>()
  for (const formula of formulas) {
    for (const match of formula.matchAll(/(?:^|[^\w])@?([a-zA-Z_][\w]*)\s*\(/g)) {
      functions.add(match[1].toLowerCase())
    }
  }
  return Array.from(functions)
}

function isCellValueEmpty(value: unknown) {
  return value === undefined || value === null || normalizeCellText(value) === ''
}

/** 规范化单元格文本（全角空格、首尾空白） */
function normalizeCellText(value: unknown): string {
  return String(value ?? '')
    .replace(/\u3000/g, ' ')
    .trim()
}

function isTaxpayerHeaderText(text: string) {
  return /纳税人名称|编制单位|纳税人|报送单位/u.test(normalizeCellText(text))
}

function isFormCodeHeaderText(text: string) {
  return /会企\d+表|会政财\d+表|会政\d+表/u.test(normalizeCellText(text))
}

function isUnitHeaderText(text: string) {
  return /^单位[：:]/u.test(normalizeCellText(text))
}

export function getSheetContentBounds(sheet: xlsx.WorkSheet): SheetContentBounds {
  const fallbackRange = xlsx.utils.decode_range(sheet['!ref'] || 'A1')
  const bounds = {
    minR: fallbackRange.s.r,
    minC: fallbackRange.s.c,
    maxR: fallbackRange.s.r,
    maxC: fallbackRange.s.c,
  }
  let hasContent = false

  for (const [address, rawCell] of Object.entries(sheet)) {
    if (address.startsWith('!')) continue
    const cell = rawCell as any
    if (!cell?.f && isCellValueEmpty(cell?.v ?? cell?.w)) continue

    const position = xlsx.utils.decode_cell(address)
    if (!hasContent) {
      bounds.minR = position.r
      bounds.maxR = position.r
      bounds.minC = position.c
      bounds.maxC = position.c
      hasContent = true
      continue
    }

    bounds.minR = Math.min(bounds.minR, position.r)
    bounds.maxR = Math.max(bounds.maxR, position.r)
    bounds.minC = Math.min(bounds.minC, position.c)
    bounds.maxC = Math.max(bounds.maxC, position.c)
  }

  return bounds
}

function normalizeFontFamilyToken(name: string) {
  const map: Record<string, string> = {
    宋体: 'SimSun',
    新宋体: 'NSimSun',
    楷体: 'KaiTi',
    楷体_GB2312: 'KaiTi',
    黑体: 'SimHei',
    仿宋: 'FangSong',
    仿宋_GB2312: 'FangSong',
    微软雅黑: 'Microsoft-YaHei',
    'Microsoft YaHei': 'Microsoft-YaHei',
  }
  return (map[name] || name).replace(/\s+/g, '-')
}

function getExcelColorHex(color: Partial<ExcelJS.Color> | undefined) {
  const argb = color?.argb
  if (!argb) return null
  const hex = argb.length === 8 ? argb.slice(2) : argb
  return /^[0-9a-fA-F]{6}$/.test(hex) ? hex.toLowerCase() : null
}

function getBorderStyleInfo(border: Partial<ExcelJS.Borders> | undefined) {
  const entries = [
    ['top', border?.top],
    ['right', border?.right],
    ['bottom', border?.bottom],
    ['left', border?.left],
  ] as const
  const visible = entries.filter(([, side]) => Boolean(side?.style))
  if (visible.length === 0) {
    return { parts: ['border-none'] as string[] }
  }

  const parts: string[] = []
  if (visible.length === 4) {
    parts.push('border-all')
  } else if (visible.length === 1) {
    parts.push(`border-${visible[0][0]}`)
  } else {
    parts.push('border-all')
  }

  const widthRank: Record<string, number> = {
    hair: 1,
    thin: 1,
    medium: 2,
    thick: 3,
    double: 3,
  }
  const width = Math.max(
    ...visible.map(([, side]) => widthRank[String(side?.style || 'thin')] || 1)
  )
  if (width > 1) {
    parts.push(`border-width-${width}`)
  }

  const firstColor = visible
    .map(([, side]) => getExcelColorHex(side?.color))
    .find(Boolean)
  if (firstColor) {
    parts.push(`border-color-${firstColor}`)
  }

  return { parts }
}

export function buildExcelStyleKey(params: {
  rawCell?: any
  excelStyle?: ExcelCellStyle
  merge?: MergeSpan
}) {
  const styleParts: string[] = []
  const alignment = params.excelStyle?.alignment || params.rawCell?.s?.alignment
  if (alignment) {
    if (alignment.horizontal === 'center' || alignment.horizontal === 'centerContinuous') {
      styleParts.push('align-center')
    } else if (alignment.horizontal === 'right') {
      styleParts.push('align-right')
    } else if (alignment.horizontal === 'left') {
      styleParts.push('align-left')
    }
    if (alignment.vertical === 'middle' || alignment.vertical === 'center') {
      styleParts.push('valign-middle')
    } else if (alignment.vertical === 'bottom') {
      styleParts.push('valign-bottom')
    }
  }

  const font = params.excelStyle?.font || params.rawCell?.s?.font
  if (font) {
    if (font.bold) styleParts.push('font-bold')
    if (font.underline) styleParts.push('font-underline')
    if (font.size && Number(font.size) !== 13) {
      styleParts.push(`font-size-${Number(font.size)}`)
    } else if (font.sz && Number(font.sz) !== 13) {
      styleParts.push(`font-size-${Number(font.sz)}`)
    }
    const name = font.name
    if (name) {
      styleParts.push(`font-family-${normalizeFontFamilyToken(String(name))}`)
    }
  }

  const border = params.excelStyle?.border
  if (border) {
    styleParts.push(...getBorderStyleInfo(border).parts)
  }

  if (params.merge && (params.merge.colSpan > 1 || params.merge.rowSpan > 1)) {
    if (!styleParts.some(part => part.startsWith('valign-'))) {
      styleParts.push('valign-middle')
    }
  }

  return Array.from(new Set(styleParts)).join(' ') || null
}

function getExcelFormatText(rawCell: any, excelStyle?: ExcelCellStyle) {
  return rawCell?.s?.numFmt || excelStyle?.numFmt || null
}

function hasMeaningfulStyle(style: ExcelCellStyle | undefined) {
  if (!style) return false
  return Boolean(style.font || style.alignment || style.border || style.numFmt)
}

function mergeRefToSpan(ref: string): { key: string; span: MergeSpan } | null {
  const [start, end] = ref.split(':')
  if (!start || !end) return null
  const s = xlsx.utils.decode_cell(start)
  const e = xlsx.utils.decode_cell(end)
  return {
    key: `${s.r}:${s.c}`,
    span: {
      rowSpan: e.r - s.r + 1,
      colSpan: e.c - s.c + 1,
    },
  }
}

function isCellInsideBounds(rowIndex: number, colIndex: number, bounds?: SheetContentBounds) {
  if (!bounds) return true
  return (
    rowIndex >= bounds.minR &&
    rowIndex <= bounds.maxR &&
    colIndex >= bounds.minC &&
    colIndex <= bounds.maxC
  )
}

function isMergeInsideBounds(key: string, span: MergeSpan, bounds?: SheetContentBounds) {
  if (!bounds) return true
  const [rowIndex, colIndex] = key.split(':').map(Number)
  const endRow = rowIndex + span.rowSpan - 1
  const endCol = colIndex + span.colSpan - 1
  return (
    rowIndex <= bounds.maxR &&
    endRow >= bounds.minR &&
    colIndex <= bounds.maxC &&
    endCol >= bounds.minC
  )
}

function buildCoveredMergeKeys(mergeMap: Map<string, MergeSpan>) {
  const covered = new Set<string>()
  for (const [key, span] of mergeMap.entries()) {
    const [rowIndex, colIndex] = key.split(':').map(Number)
    for (let dr = 0; dr < span.rowSpan; dr += 1) {
      for (let dc = 0; dc < span.colSpan; dc += 1) {
        if (dr === 0 && dc === 0) continue
        covered.add(`${rowIndex + dr}:${colIndex + dc}`)
      }
    }
  }
  return covered
}

function getCellText(sheet: xlsx.WorkSheet, rowIndex: number, colIndex: number) {
  const raw = sheet[xlsx.utils.encode_cell({ r: rowIndex, c: colIndex })] as any
  return normalizeCellText(raw?.v ?? raw?.w ?? '')
}

function findRightHeaderColumn(
  sheet: xlsx.WorkSheet,
  rowIndex: number,
  maxC: number,
  mergeMap: Map<string, MergeSpan>
) {
  for (let colIndex = maxC; colIndex >= 0; colIndex -= 1) {
    const key = `${rowIndex}:${colIndex}`
    if (mergeMap.has(key)) continue
    const text = getCellText(sheet, rowIndex, colIndex)
    if (!text) continue
    if (isFormCodeHeaderText(text) || isUnitHeaderText(text)) {
      return colIndex
    }
  }
  return -1
}

function isDatePlaceholderText(text: string) {
  return /%[yYmMdDhHsS]/.test(text) || /编制日期|报表日期/.test(text)
}

/** 标准报表模板常用“跨列居中”而非显式 merge，补充表头日期/名称/表号/单位等区域 */
function inferReportHeaderMerges(
  sheet: xlsx.WorkSheet,
  mergeMap: Map<string, MergeSpan>,
  maxR: number,
  maxC: number
) {
  const headerMaxRow = Math.min(maxR, 10)
  for (let rowIndex = 0; rowIndex <= headerMaxRow; rowIndex += 1) {
    const rightCol = findRightHeaderColumn(sheet, rowIndex, maxC, mergeMap)
    let dateCol = -1

    for (let colIndex = 0; colIndex <= maxC; colIndex += 1) {
      const key = `${rowIndex}:${colIndex}`
      if (mergeMap.has(key)) continue

      const text = getCellText(sheet, rowIndex, colIndex)
      if (!text) continue

      if (isDatePlaceholderText(text)) {
        dateCol = colIndex
        let endCol = colIndex
        for (let nextCol = colIndex + 1; nextCol <= maxC; nextCol += 1) {
          if (rightCol >= 0 && nextCol >= rightCol) break
          const nextText = getCellText(sheet, rowIndex, nextCol)
          if (nextText) break
          endCol = nextCol
        }
        if (endCol > colIndex) {
          mergeMap.set(key, { rowSpan: 1, colSpan: endCol - colIndex + 1 })
        }
      }
    }

    const leftBoundary = dateCol >= 0 ? dateCol : rightCol >= 0 ? rightCol : maxC + 1
    if (leftBoundary > 1) {
      const leftText = getCellText(sheet, rowIndex, 0)
      if (leftText && isTaxpayerHeaderText(leftText)) {
        const leftKey = `${rowIndex}:0`
        const leftSpan = { rowSpan: 1, colSpan: leftBoundary }
        const existing = mergeMap.get(leftKey)
        if (!existing || existing.colSpan < leftBoundary) {
          mergeMap.set(leftKey, leftSpan)
        }
      }
    }

    // 仅右侧“单位：元”行：合并左侧空白区，避免零散空格单元格把表头挤乱
    if (rightCol > 0 && dateCol < 0) {
      const rightText = getCellText(sheet, rowIndex, rightCol)
      if (isUnitHeaderText(rightText)) {
        let hasOtherText = false
        for (let colIndex = 0; colIndex < rightCol; colIndex += 1) {
          if (getCellText(sheet, rowIndex, colIndex)) {
            hasOtherText = true
            break
          }
        }
        if (!hasOtherText) {
          const leftKey = `${rowIndex}:0`
          if (!mergeMap.has(leftKey)) {
            mergeMap.set(leftKey, { rowSpan: 1, colSpan: rightCol })
          }
        }
      }
    }
  }
}

function appendStyleKey(styleKey: string | null, extra: string) {
  const parts = new Set((styleKey || '').split(/\s+/).filter(Boolean))
  parts.add(extra)
  return Array.from(parts).join(' ')
}

export async function readExcelStyleBundle(
  buffer: Buffer,
  boundsBySheet: SheetContentBounds[] = []
): Promise<ExcelStyleBundle> {
  try {
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(buffer as any)
    const stylesBySheet = new Map<number, Map<string, ExcelCellStyle>>()
    const mergesBySheet = new Map<number, Map<string, MergeSpan>>()
    const dimensionsBySheet = new Map<number, { maxR: number; maxC: number }>()

    workbook.worksheets.forEach((worksheet, sheetIndex) => {
      if (boundsBySheet.length > 0 && sheetIndex >= boundsBySheet.length) return

      const bounds = boundsBySheet[sheetIndex]
      const styleMap = new Map<string, ExcelCellStyle>()
      const mergeMap = new Map<string, MergeSpan>()
      let maxR = 0
      let maxC = 0

      for (const mergeRef of worksheet.model.merges || []) {
        const parsed = mergeRefToSpan(mergeRef)
        if (parsed && isMergeInsideBounds(parsed.key, parsed.span, bounds)) {
          mergeMap.set(parsed.key, parsed.span)
          const [r, c] = parsed.key.split(':').map(Number)
          maxR = Math.max(maxR, r + parsed.span.rowSpan - 1)
          maxC = Math.max(maxC, c + parsed.span.colSpan - 1)
        }
      }

      worksheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
        row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
          if (!isCellInsideBounds(rowNumber - 1, colNumber - 1, bounds)) return

          const key = `${rowNumber - 1}:${colNumber - 1}`
          const style: ExcelCellStyle = {}
          if (cell.font && Object.keys(cell.font).length > 0) style.font = cell.font
          if (cell.alignment && Object.keys(cell.alignment).length > 0) style.alignment = cell.alignment
          if (cell.border && Object.keys(cell.border).length > 0) style.border = cell.border
          if (cell.numFmt) style.numFmt = cell.numFmt
          if (hasMeaningfulStyle(style)) styleMap.set(key, style)

          if (!isCellValueEmpty(cell.value)) {
            maxR = Math.max(maxR, rowNumber - 1)
            maxC = Math.max(maxC, colNumber - 1)
          }
        })
      })

      // Excel 的“跨列居中”不是严格 merge，但在报表模板里视觉效果等同于横向合并。
      const minRowNumber = bounds ? bounds.minR + 1 : 1
      const maxRowNumber = bounds ? bounds.maxR + 1 : worksheet.rowCount
      const minColNumber = bounds ? bounds.minC + 1 : 1
      const maxColNumber = bounds ? bounds.maxC + 1 : worksheet.columnCount
      for (let rowNumber = minRowNumber; rowNumber <= maxRowNumber; rowNumber += 1) {
        const row = worksheet.getRow(rowNumber)
        for (let colNumber = minColNumber; colNumber <= maxColNumber; colNumber += 1) {
          const cell = row.getCell(colNumber)
          if (isCellValueEmpty(cell.value) || cell.alignment?.horizontal !== 'centerContinuous') {
            continue
          }

          let endCol = colNumber
          for (let next = colNumber + 1; next <= maxColNumber; next += 1) {
            const nextCell = row.getCell(next)
            if (
              !isCellValueEmpty(nextCell.value) ||
              nextCell.alignment?.horizontal !== 'centerContinuous'
            ) {
              break
            }
            endCol = next
          }
          if (endCol > colNumber) {
            mergeMap.set(`${rowNumber - 1}:${colNumber - 1}`, {
              rowSpan: 1,
              colSpan: endCol - colNumber + 1,
            })
          }
        }
      }

      stylesBySheet.set(sheetIndex, styleMap)
      mergesBySheet.set(sheetIndex, mergeMap)
      dimensionsBySheet.set(sheetIndex, { maxR, maxC })
    })

    return { stylesBySheet, mergesBySheet, dimensionsBySheet }
  } catch {
    return EMPTY_STYLE_BUNDLE
  }
}

export interface ReportImportStats {
  total: number
  success: number
  failed: number
  results: ReportImportResult[]
}

/**
 * 批量导入 Excel 报表
 */
export async function importExcelReportsFromTemplate(
  db: Database,
  accountSetId: string,
  excelFiles: ExcelFile[]
): Promise<ReportImportStats> {
  ensureDynamicReportSchema(db)
  console.log('[Excel导入] 开始批量导入')
  console.log('[Excel导入] 账套ID:', accountSetId)
  const importableFiles = excelFiles.filter(file => {
    const fileName = file.path.split(/[/\\]/).pop() || file.name
    if (!isImportableExcelFileName(fileName)) {
      console.log(`[Excel导入] 跳过非报表文件: ${fileName}`)
      return false
    }
    return true
  })
  console.log('[Excel导入] 可导入文件数量:', importableFiles.length)

  const results: ReportImportResult[] = []

  // 获取当前账套已有的最大报表编码
  const maxCodeRow = db
    .prepare(
      `
    SELECT MAX(CAST(code AS INTEGER)) as max_code
    FROM report_definitions
    WHERE account_set_id = ?
    AND code GLOB '[0-9]*'
  `
    )
    .get(accountSetId) as { max_code: number | null } | undefined

  let nextCode = (maxCodeRow?.max_code || 0) + 1

  for (const file of importableFiles) {
    try {
      console.log(`[Excel导入] 正在处理文件 [${nextCode}]: ${file.name}`)
      console.log(`[Excel导入] 文件路径: ${file.path}`)

      // 读取 Excel 文件
      const buffer = readFileSync(file.path)
      console.log(`[Excel导入] 文件大小: ${buffer.length} 字节`)

      const workbook = xlsx.read(buffer, { type: 'buffer', cellStyles: true, codepage: 936 })
      const sheetsToImport = workbook.SheetNames.slice(0, 1)
      const contentBoundsBySheet = sheetsToImport.map(sheetName =>
        getSheetContentBounds(workbook.Sheets[sheetName])
      )
      const styleBundle = await readExcelStyleBundle(buffer, contentBoundsBySheet)

      // 生成报表编码（使用递增的数字）
      const reportCode = String(nextCode)
      const reportName = file.name

      console.log(`[Excel] 导入报表: [${reportCode}] ${reportName}`)

      // 导入报表（传入显式 1-based 序号用于初始 sort_order）
      importSingleExcelReport(
        db,
        accountSetId,
        reportCode,
        reportName,
        workbook,
        file.path,
        buffer,
        styleBundle,
        nextCode
      )

      results.push({
        success: true,
        reportCode,
        reportName,
      })

      nextCode++
    } catch (error: any) {
      console.error(`[Excel] 导入报表失败: ${file.name}`, error)
      results.push({
        success: false,
        reportCode: String(nextCode),
        reportName: file.name,
        error: error.message,
      })
      nextCode++
    }
  }

  return {
    total: importableFiles.length,
    success: results.filter(r => r.success).length,
    failed: results.filter(r => !r.success).length,
    results,
  }
}

/**
 * 导入单个 Excel 报表
 * 提取自 reportTemplate.ts 的核心逻辑
 */
function importSingleExcelReport(
  db: Database,
  accountSetId: string,
  reportCode: string,
  reportName: string,
  workbook: xlsx.WorkBook,
  sourceFile: string,
  excelBuffer: Buffer,
  styleBundle: ExcelStyleBundle,
  /** 报表在本次批量导入中的 1-based 序号，用于 sort_order（覆盖 MAX+1 策略） */
  importIndex?: number
) {
  // 使用事务确保原子性
  const applyImport = db.transaction(() => {
    // 1. Upsert report_definitions
    const definition = db
      .prepare('SELECT id FROM report_definitions WHERE account_set_id = ? AND code = ?')
      .get(accountSetId, reportCode) as { id: string } | undefined

    let definitionId: string

    if (definition) {
      // 更新现有报表
      definitionId = definition.id
      db.prepare(
        `UPDATE report_definitions
         SET name = ?, source = 'xls', source_file = ?, updated_at = datetime('now')
         WHERE id = ?`
      ).run(reportName, sourceFile, definitionId)

      // 删除旧的 sheets 和 cells
      db.prepare(
        `DELETE FROM report_cells
         WHERE report_sheet_id IN (SELECT id FROM report_sheets WHERE report_definition_id = ?)`
      ).run(definitionId)
      db.prepare('DELETE FROM report_sheets WHERE report_definition_id = ?').run(definitionId)
      db.prepare('DELETE FROM report_template_sources WHERE report_definition_id = ?').run(definitionId)
    } else {
      // 创建新报表
      definitionId = uuidv4()
      let sortOrder: number
      if (importIndex !== undefined) {
        sortOrder = importIndex
      } else {
        const maxSort = db
          .prepare(
            'SELECT MAX(sort_order) as max_order FROM report_definitions WHERE account_set_id = ?'
          )
          .get(accountSetId) as { max_order: number | null }
        sortOrder = (maxSort?.max_order ?? 0) + 1
      }

      db.prepare(
        `INSERT INTO report_definitions
         (id, account_set_id, code, name, source, source_file, sort_order, is_enabled, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'xls', ?, ?, 1, datetime('now'), datetime('now'))`
      ).run(definitionId, accountSetId, reportCode, reportName, sourceFile, sortOrder)
    }

    saveReportTemplateExcelSource(db, definitionId, sourceFile, excelBuffer)

    // 2. 导入工作表和单元格
    const formulaTexts: string[] = []
    const sheetsToImport = workbook.SheetNames.slice(0, 1)
    sheetsToImport.forEach((sheetName, sheetIndex) => {
      const sheetId = uuidv4()
      const cleanSheetName = sheetName.replace(/\(定义\)$/g, '').trim()
      const sheet = workbook.Sheets[sheetName]

      // 提取列宽和行高
      const colWidths: number[] = []
      const rowHeights: number[] = []
      const sheetCols = (sheet['!cols'] || []) as Array<{
        wpx?: number
        wch?: number
        width?: number
        hidden?: number
      }>
      const sheetRows = (sheet['!rows'] || []) as Array<{
        hpx?: number
        hpt?: number
        hidden?: number
      }>

      for (const col of sheetCols) {
        if (!col) {
          colWidths.push(72)
          continue
        }
        if (col.hidden) {
          colWidths.push(-1)
          continue
        }
        colWidths.push(col.wpx || Math.round((col.wch || col.width || 8) * 8))
      }
      for (const row of sheetRows) {
        if (!row) {
          rowHeights.push(20)
          continue
        }
        if (row.hidden) {
          rowHeights.push(-1)
          continue
        }
        rowHeights.push(row.hpx || Math.round((row.hpt || 15) * 1.33))
      }

      // 插入工作表
      db.prepare(
        `INSERT INTO report_sheets
         (id, report_definition_id, sheet_key, sheet_name, sheet_index, default_col_width, default_row_height, col_widths, row_heights, created_at)
         VALUES (?, ?, ?, ?, ?, 160, 34, ?, ?, datetime('now'))`
      ).run(
        sheetId,
        definitionId,
        `sheet_${sheetIndex + 1}`,
        cleanSheetName,
        sheetIndex,
        colWidths.length > 0 ? JSON.stringify(colWidths) : null,
        rowHeights.length > 0 ? JSON.stringify(rowHeights) : null
      )

      // 导入单元格
      const range = getSheetContentBounds(sheet)
      const merges = sheet['!merges'] || []
      const excelStyleMap = styleBundle.stylesBySheet.get(sheetIndex) || new Map<string, ExcelCellStyle>()
      const excelMergeMap = styleBundle.mergesBySheet.get(sheetIndex) || new Map<string, MergeSpan>()

      // 构建合并单元格映射
      const mergeMap = new Map<string, MergeSpan>()
      for (const m of merges) {
        mergeMap.set(`${m.s.r}:${m.s.c}`, {
          rowSpan: m.e.r - m.s.r + 1,
          colSpan: m.e.c - m.s.c + 1,
        })
        range.minR = Math.min(range.minR, m.s.r)
        range.minC = Math.min(range.minC, m.s.c)
        range.maxR = Math.max(range.maxR, m.e.r)
        range.maxC = Math.max(range.maxC, m.e.c)
      }
      for (const [key, merge] of excelMergeMap.entries()) {
        if (!mergeMap.has(key)) mergeMap.set(key, merge)
      }
      inferReportHeaderMerges(sheet, mergeMap, range.maxR, range.maxC)
      const coveredMergeKeys = buildCoveredMergeKeys(mergeMap)

      let effectiveMaxR = range.maxR
      let effectiveMaxC = range.maxC
      for (const [key, merge] of mergeMap.entries()) {
        const [rowIndex, colIndex] = key.split(':').map(Number)
        effectiveMaxR = Math.max(effectiveMaxR, rowIndex + merge.rowSpan - 1)
        effectiveMaxC = Math.max(effectiveMaxC, colIndex + merge.colSpan - 1)
      }

      const insertCell = db.prepare(
        `INSERT INTO report_cells (id, report_sheet_id, row_index, col_index, cell_type, text_value, formula_text, format_text, style_key, col_width, row_height, merge_info, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
      )

      for (let R = range.minR; R <= effectiveMaxR; R++) {
        for (let C = range.minC; C <= effectiveMaxC; C++) {
          const positionKey = `${R}:${C}`
          if (coveredMergeKeys.has(positionKey)) continue

          const cellAddress = xlsx.utils.encode_cell({ r: R, c: C })
          const rawCell = sheet[cellAddress] as any
          const excelStyle = excelStyleMap.get(positionKey)
          const merge = mergeMap.get(positionKey)
          if (!rawCell && !excelStyle && !merge) continue

          // 跳过被合并覆盖的单元格 (type 'z')
          if (rawCell?.t === 'z' && !excelStyle && !merge) continue

          // 提取单元格值
          let cellStr = ''
          if (rawCell?.f) {
            cellStr =
              rawCell.f.startsWith('=') || rawCell.f.startsWith('@') ? rawCell.f : '=' + rawCell.f
          } else {
            cellStr = normalizeCellText(rawCell?.v ?? rawCell?.w ?? '')
          }
          if (!cellStr && !excelStyle && !merge) continue

          const isFormula = cellStr.startsWith('=') || cellStr.startsWith('@')
          if (isFormula) {
            formulaTexts.push(cellStr)
          }

          // 提取数字格式
          const formatText = getExcelFormatText(rawCell, excelStyle)

          let styleKey = buildExcelStyleKey({ rawCell, excelStyle, merge })
          if (merge) {
            if (isTaxpayerHeaderText(cellStr)) {
              styleKey = appendStyleKey(styleKey, 'align-left')
            } else if (isDatePlaceholderText(cellStr)) {
              styleKey = appendStyleKey(styleKey, 'align-center')
            }
          }
          if (isFormCodeHeaderText(cellStr) || isUnitHeaderText(cellStr)) {
            styleKey = appendStyleKey(styleKey, 'align-right')
          }
          const mergeInfo = merge ? JSON.stringify(merge) : null

          insertCell.run(
            uuidv4(),
            sheetId,
            R,
            C,
            isFormula ? 'formula' : cellStr ? 'text' : 'empty',
            isFormula ? null : cellStr,
            isFormula ? cellStr : null,
            formatText,
            styleKey,
            null, // col_width: stored at sheet level
            null, // row_height: stored at sheet level
            mergeInfo
          )
        }
      }
    })

    db.prepare('DELETE FROM report_formula_functions WHERE account_set_id = ?').run(accountSetId)
    const insertFormulaFunction = db.prepare(
      `INSERT INTO report_formula_functions (id, account_set_id, function_name, handler_key, description, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
    )
    for (const functionName of extractFormulaFunctions(formulaTexts)) {
      insertFormulaFunction.run(
        uuidv4(),
        accountSetId,
        functionName,
        `xls:${functionName}`,
        'Excel 报表公式函数'
      )
    }
  })

  applyImport()
}
