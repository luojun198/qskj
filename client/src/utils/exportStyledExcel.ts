import type ExcelJS from 'exceljs'
import request from '@/api/request'
import { yieldToMain } from './asyncChunk'

export type ExportProgressPhase = 'prepare' | 'generate' | 'download'

async function loadExcelJS() {
  const module = await import('exceljs')
  return module.default
}

export type ExportProgressCallback = (info: {
  phase: ExportProgressPhase
  percent: number
  message: string
}) => void

export type ExportAlign = 'left' | 'center' | 'right'
export type ExportValueType = 'text' | 'amount' | 'number' | 'integer'

/**
 * 导出列定义。
 *
 * 泛型默认 `any` 而非 `Record<string, unknown>`：后者会把 `row.xxx` 一律推成 `unknown`，
 * 而项目里大量调用方写的是裸 `ExportColumnDef[]`、行数据本身也是 `any[]`，
 * 于是每个 `value: row => row.amount` 都报 TS2322，制造了上百条无效噪音，
 * 反而让 vue-tsc 无法充当门禁。
 *
 * 想要类型检查请显式传行类型（如 `ExportColumnDef<LedgerBalanceRow>[]`，
 * 见 `ledgerExportBuilders.ts`），那条路径的检查强度不受本默认值影响。
 */
export type ExportColumnDef<T = any> = {
  label: string
  /** FIX-254：参数模式导出时叶子列对应服务端数据源的字段 key */
  key?: string
  width?: number
  align?: ExportAlign
  type?: ExportValueType
  children?: ExportColumnDef<T>[]
  value?: (row: T, index: number) => string | number | null | undefined
  indent?: (row: T) => number
  bold?: (row: T) => boolean
}

export type ExportStyledTableOptions<T = any> = {
  fileName: string
  sheetName?: string
  title?: string
  subtitle?: string
  columns: ExportColumnDef<T>[]
  rows: T[]
  /**
   * 合计行之前的小计行（如外币表按币种小计）。每行与叶子列一一对应，
   * 首列原样取数组内容（不像 summaryValues 那样强制写「合计」）。
   */
  subtotalRows?: (string | number | null | undefined)[][]
  /** 与叶子列一一对应的合计值；首列会自动写入「合计」 */
  summaryValues?: (string | number | null | undefined)[]
  stripe?: boolean
  onProgress?: ExportProgressCallback
}

export type ExportStyledAoaOptions = {
  fileName: string
  sheetName?: string
  rows: (string | number | null | undefined)[][]
  columnWidths?: number[]
  /** 0-based 行号：标题行（加粗、合并） */
  titleRowIndexes?: number[]
  /** 0-based 行号：小节标题（加粗） */
  sectionRowIndexes?: number[]
  /** 0-based 行号：合计/强调行（加粗） */
  emphasisRowIndexes?: number[]
  /** 1-based 列号：金额列 */
  amountColumns?: number[]
}

type LeafColumn<T> = Required<Pick<ExportColumnDef<T>, 'label'>> &
  Pick<ExportColumnDef<T>, 'width' | 'align' | 'type' | 'value' | 'indent' | 'bold'>

type HeaderMerge = {
  top: number
  left: number
  bottom: number
  right: number
}

/** 与界面表格网格线一致，导出 Excel 中更易辨认 */
const GRID_BORDER: Partial<ExcelJS.Borders> = {
  top: { style: 'thin', color: { argb: 'FF909399' } },
  left: { style: 'thin', color: { argb: 'FF909399' } },
  bottom: { style: 'thin', color: { argb: 'FF909399' } },
  right: { style: 'thin', color: { argb: 'FF909399' } },
}

function applyGridBorder(cell: ExcelJS.Cell) {
  cell.border = {
    top: GRID_BORDER.top!,
    left: GRID_BORDER.left!,
    bottom: GRID_BORDER.bottom!,
    right: GRID_BORDER.right!,
  }
}

/** 为指定矩形区域内每个单元格补齐边框（含空单元格），避免合并/稀疏行漏画网格线 */
export function ensureWorksheetGridLines(
  worksheet: ExcelJS.Worksheet,
  rowCount: number,
  colCount: number,
  startRow = 1
) {
  if (rowCount < startRow || colCount < 1) return
  for (let r = startRow; r <= rowCount; r += 1) {
    const row = worksheet.getRow(r)
    for (let c = 1; c <= colCount; c += 1) {
      const cell = row.getCell(c)
      if (cell.value === null || cell.value === undefined) {
        cell.value = ''
      }
      applyGridBorder(cell)
    }
  }
}

const HEADER_FILL: ExcelJS.FillPattern = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFF5F7FA' },
}

const STRIPE_FILL: ExcelJS.FillPattern = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFFAFAFA' },
}

const TITLE_FILL: ExcelJS.FillPattern = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFFFFFFF' },
}

function ensureXlsxFileName(fileName: string) {
  return fileName.toLowerCase().endsWith('.xlsx') ? fileName : `${fileName}.xlsx`
}

function getLeafColumns<T>(columns: ExportColumnDef<T>[]): LeafColumn<T>[] {
  const leaves: LeafColumn<T>[] = []
  for (const column of columns) {
    if (column.children?.length) {
      leaves.push(...getLeafColumns(column.children))
      continue
    }
    leaves.push({
      label: column.label,
      width: column.width,
      align: column.align ?? 'left',
      type: column.type ?? 'text',
      value: column.value ?? (() => ''),
      indent: column.indent,
      bold: column.bold,
    })
  }
  return leaves
}

function getHeaderDepth<T>(columns: ExportColumnDef<T>[]): number {
  let depth = 1
  for (const column of columns) {
    if (column.children?.length) {
      depth = Math.max(depth, 1 + getHeaderDepth(column.children))
    }
  }
  return depth
}

function countLeaves<T>(column: ExportColumnDef<T>): number {
  if (!column.children?.length) return 1
  return column.children.reduce((sum, child) => sum + countLeaves(child), 0)
}

function buildHeaderLayout<T>(
  columns: ExportColumnDef<T>[],
  depth: number
): { matrix: string[][]; merges: HeaderMerge[] } {
  const leafCount = columns.reduce((sum, column) => sum + countLeaves(column), 0)
  const matrix = Array.from({ length: depth }, () => Array(leafCount).fill(''))
  const merges: HeaderMerge[] = []

  function fill(columnsToFill: ExportColumnDef<T>[], row: number, colStart: number): number {
    let col = colStart
    for (const column of columnsToFill) {
      const span = countLeaves(column)
      matrix[row][col] = column.label
      if (column.children?.length) {
        merges.push({ top: row + 1, left: col + 1, bottom: row + 1, right: col + span })
        fill(column.children, row + 1, col)
      } else if (row < depth - 1) {
        merges.push({ top: row + 1, left: col + 1, bottom: depth, right: col + 1 })
      }
      col += span
    }
    return col
  }

  fill(columns, 0, 0)
  return { matrix, merges }
}

function applyCellStyle(
  cell: ExcelJS.Cell,
  options: {
    align?: ExportAlign
    type?: ExportValueType
    bold?: boolean
    header?: boolean
    stripe?: boolean
    title?: boolean
    indent?: number
  }
) {
  const bold = options.bold || options.header || options.title
  cell.font = {
    name: '宋体',
    size: options.title ? 14 : 11,
    bold,
  }
  applyGridBorder(cell)
  cell.alignment = {
    vertical: 'middle',
    horizontal: options.align ?? 'left',
    wrapText: false,
    indent: options.indent ?? 0,
  }

  if (options.header) {
    cell.fill = HEADER_FILL
    cell.alignment = { ...cell.alignment, horizontal: 'center', vertical: 'middle' }
  } else if (options.stripe) {
    cell.fill = STRIPE_FILL
  } else if (options.title) {
    cell.fill = TITLE_FILL
  }

  if (options.type === 'amount' || options.type === 'number' || options.type === 'integer') {
    if (typeof cell.value === 'number') {
      cell.numFmt = options.type === 'integer' ? '#,##0' : '#,##0.00'
    }
  }
}

function normalizeCellValue(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === '') return ''
  return value
}

export async function downloadExcelWorkbook(workbook: ExcelJS.Workbook, fileName: string) {
  const buffer = await workbook.xlsx.writeBuffer()
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = ensureXlsxFileName(fileName)
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = ensureXlsxFileName(fileName)
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

/** 可序列化列定义（发送给服务端导出，剥离 value/bold/indent 等函数） */
export type StyledXlsxColumnSpec = {
  label: string
  key?: string
  width?: number
  align?: ExportAlign
  type?: ExportValueType
  children?: StyledXlsxColumnSpec[]
}

function serializeColumns<T>(columns: ExportColumnDef<T>[]): StyledXlsxColumnSpec[] {
  return columns.map(col => {
    const spec: StyledXlsxColumnSpec = { label: col.label }
    if (col.key) spec.key = col.key
    if (col.width != null) spec.width = col.width
    if (col.align) spec.align = col.align
    if (col.type) spec.type = col.type
    if (col.children?.length) spec.children = serializeColumns(col.children)
    return spec
  })
}

async function resolveRowsMatrixChunked<T>(
  columns: ExportColumnDef<T>[],
  rows: T[],
  onProgress?: ExportProgressCallback
): Promise<(string | number | null)[][]> {
  const leaves = getLeafColumns(columns)
  const matrix: (string | number | null)[][] = []
  const batchSize = 2000
  const total = rows.length

  for (let i = 0; i < total; i += batchSize) {
    const end = Math.min(i + batchSize, total)
    for (let rowIndex = i; rowIndex < end; rowIndex += 1) {
      const row = rows[rowIndex]
      matrix.push(
        leaves.map(leaf => {
          const v = leaf.value?.(row, rowIndex)
          return v === undefined ? null : (v as string | number | null)
        })
      )
    }
    onProgress?.({
      phase: 'prepare',
      percent: total > 0 ? Math.round((end / total) * 100) : 100,
      message:
        total > 0
          ? `正在整理导出数据 ${end.toLocaleString()} / ${total.toLocaleString()} 行…`
          : '正在整理导出数据…',
    })
    if (end < total) await yieldToMain()
  }
  return matrix
}

function resolveRowsMatrix<T>(
  columns: ExportColumnDef<T>[],
  rows: T[]
): (string | number | null)[][] {
  const leaves = getLeafColumns(columns)
  return rows.map((row, rowIndex) =>
    leaves.map(leaf => {
      const v = leaf.value?.(row, rowIndex)
      return v === undefined ? null : (v as string | number | null)
    })
  )
}

/**
 * 服务端生成 xlsx 并下载（十万级数据导出，避免浏览器逐单元格生成卡死/爆内存）。
 * 前端把表格解析为「列树 + 已解析单元格矩阵」的 spec 发送给服务端。
 */
export async function exportStyledTableViaServer<T>(
  options: ExportStyledTableOptions<T> & { onProgress?: ExportProgressCallback }
) {
  const {
    fileName,
    sheetName,
    title,
    subtitle,
    columns,
    rows,
    subtotalRows,
    summaryValues,
    stripe,
    onProgress,
  } = options

  const resolvedRows = onProgress
    ? await resolveRowsMatrixChunked(columns, rows, onProgress)
    : resolveRowsMatrix(columns, rows)

  onProgress?.({
    phase: 'generate',
    percent: 0,
    message: `正在服务端生成 Excel（共 ${rows.length.toLocaleString()} 行）…`,
  })

  const spec = {
    fileName: ensureXlsxFileName(fileName),
    sheetName,
    title,
    subtitle,
    columns: serializeColumns(columns),
    rows: resolvedRows,
    subtotalRows: subtotalRows?.map(row => row.map(v => (v === undefined ? null : v))),
    summaryValues: summaryValues?.map(v => (v === undefined ? null : v)),
    stripe,
  }

  const blob = await request.downloadPost('/export/styled-xlsx', spec, { timeout: 600_000 })

  onProgress?.({
    phase: 'download',
    percent: 50,
    message: '正在保存文件…',
  })

  downloadBlob(blob, spec.fileName)

  onProgress?.({
    phase: 'download',
    percent: 100,
    message: '导出完成',
  })
}

/**
 * FIX-254：参数模式导出——前端只提交筛选参数与列定义（每个叶子列带 key），
 * 服务端自己查询 / 映射 / 流式生成 xlsx，浏览器全程不持有数据行。
 * 支持的 source.type 与列 key 见 server/src/services/exportSources.ts。
 */
export async function exportStyledTableViaSource(options: {
  fileName: string
  sheetName?: string
  title?: string
  subtitle?: string
  columns: ExportColumnDef<any>[]
  source: { type: string; params: Record<string, unknown> }
  summaryValues?: (string | number | null)[]
  stripe?: boolean
}) {
  const { fileName, sheetName, title, subtitle, columns, source, summaryValues, stripe } = options
  const spec = {
    fileName: ensureXlsxFileName(fileName),
    sheetName,
    title,
    subtitle,
    columns: serializeColumns(columns),
    source,
    summaryValues,
    stripe,
  }
  const blob = await request.downloadPost('/export/styled-xlsx', spec, { timeout: 600_000 })
  downloadBlob(blob, spec.fileName)
}

export type ExportStyledWorkbookSheet<T = Record<string, unknown>> = Omit<
  ExportStyledTableOptions<T>,
  'fileName'
>

function appendStyledSheet<T>(
  workbook: ExcelJS.Workbook,
  options: ExportStyledWorkbookSheet<T>
) {
  const {
    sheetName = 'Sheet1',
    title,
    subtitle,
    columns,
    rows,
    subtotalRows,
    summaryValues,
    stripe = true,
  } = options

  const leafColumns = getLeafColumns(columns)
  const headerDepth = getHeaderDepth(columns)
  const { matrix, merges } = buildHeaderLayout(columns, headerDepth)

  const worksheet = workbook.addWorksheet(sheetName, {
    views: [{ state: 'frozen', ySplit: (title ? 1 : 0) + (subtitle ? 1 : 0) + headerDepth }],
  })

  let currentRow = 1

  if (title) {
    const row = worksheet.getRow(currentRow)
    row.height = 24
    const cell = row.getCell(1)
    cell.value = title
    applyCellStyle(cell, { title: true, align: 'center', bold: true })
    if (leafColumns.length > 1) {
      worksheet.mergeCells(currentRow, 1, currentRow, leafColumns.length)
    }
    currentRow += 1
  }

  if (subtitle) {
    const row = worksheet.getRow(currentRow)
    row.height = 18
    const cell = row.getCell(1)
    cell.value = subtitle
    applyCellStyle(cell, { align: 'center' })
    if (leafColumns.length > 1) {
      worksheet.mergeCells(currentRow, 1, currentRow, leafColumns.length)
    }
    currentRow += 1
  }

  const headerStartRow = currentRow
  for (let r = 0; r < matrix.length; r += 1) {
    const row = worksheet.getRow(currentRow)
    row.height = 20
    matrix[r].forEach((label, index) => {
      const cell = row.getCell(index + 1)
      cell.value = label
      applyCellStyle(cell, { header: true })
    })
    currentRow += 1
  }

  for (const merge of merges) {
    worksheet.mergeCells(
      headerStartRow + merge.top - 1,
      merge.left,
      headerStartRow + merge.bottom - 1,
      merge.right
    )
  }

  leafColumns.forEach((column, index) => {
    worksheet.getColumn(index + 1).width = Math.max(8, Math.round((column.width || 96) / 8))
  })

  rows.forEach((rowData, rowIndex) => {
    const row = worksheet.getRow(currentRow)
    row.height = 18
    leafColumns.forEach((column, colIndex) => {
      const rawValue = column.value?.(rowData, rowIndex)
      const cell = row.getCell(colIndex + 1)
      cell.value = normalizeCellValue(rawValue)
      applyCellStyle(cell, {
        align: column.align,
        type: column.type,
        bold: column.bold?.(rowData),
        stripe: stripe && rowIndex % 2 === 1,
        indent: column.indent?.(rowData) ?? 0,
      })
    })
    currentRow += 1
  })

  for (const subtotal of subtotalRows || []) {
    const row = worksheet.getRow(currentRow)
    row.height = 18
    leafColumns.forEach((column, colIndex) => {
      const cell = row.getCell(colIndex + 1)
      cell.value = normalizeCellValue(subtotal[colIndex] ?? '')
      applyCellStyle(cell, { align: column.align, type: column.type, bold: true })
    })
    currentRow += 1
  }

  if (summaryValues?.length) {
    const row = worksheet.getRow(currentRow)
    row.height = 20
    leafColumns.forEach((column, colIndex) => {
      const cell = row.getCell(colIndex + 1)
      cell.value =
        colIndex === 0 ? '合计' : normalizeCellValue(summaryValues[colIndex] ?? '')
      applyCellStyle(cell, {
        align: column.align,
        type: column.type,
        bold: true,
      })
    })
    currentRow += 1
  }

  ensureWorksheetGridLines(worksheet, currentRow - 1, leafColumns.length)
}

export async function exportStyledWorkbook<T>(
  fileName: string,
  sheets: ExportStyledWorkbookSheet<T>[]
) {
  const ExcelJS = await loadExcelJS()
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'CW Finance'
  for (const sheet of sheets) {
    appendStyledSheet(workbook, sheet)
  }
  await downloadExcelWorkbook(workbook, fileName)
}

export async function exportStyledTable<T>(options: ExportStyledTableOptions<T>) {
  const { fileName, ...sheetOptions } = options
  const ExcelJS = await loadExcelJS()
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'CW Finance'
  appendStyledSheet(workbook, sheetOptions)
  await downloadExcelWorkbook(workbook, fileName)
}

export async function exportStyledAoa(options: ExportStyledAoaOptions) {
  const {
    fileName,
    sheetName = 'Sheet1',
    rows,
    columnWidths,
    titleRowIndexes = [],
    sectionRowIndexes = [],
    emphasisRowIndexes = [],
    amountColumns = [],
  } = options

  const ExcelJS = await loadExcelJS()
  const workbook = new ExcelJS.Workbook()
  const worksheet = workbook.addWorksheet(sheetName)
  const titleSet = new Set(titleRowIndexes)
  const sectionSet = new Set(sectionRowIndexes)
  const emphasisSet = new Set(emphasisRowIndexes)
  const amountSet = new Set(amountColumns)

  const maxCols = rows.reduce((max, rowValues) => Math.max(max, rowValues.length), 0) || 1

  rows.forEach((rowValues, rowIndex) => {
    const row = worksheet.getRow(rowIndex + 1)
    row.height = titleSet.has(rowIndex) ? 24 : 18
    for (let colIndex = 0; colIndex < maxCols; colIndex += 1) {
      const cell = row.getCell(colIndex + 1)
      const rawValue = colIndex < rowValues.length ? rowValues[colIndex] : ''
      cell.value = normalizeCellValue(rawValue)
      const isAmount = amountSet.has(colIndex + 1) && typeof cell.value === 'number'
      applyCellStyle(cell, {
        align: isAmount || amountSet.has(colIndex + 1) ? 'right' : colIndex === 0 ? 'left' : 'right',
        type: isAmount ? 'amount' : 'text',
        bold: titleSet.has(rowIndex) || sectionSet.has(rowIndex) || emphasisSet.has(rowIndex),
        title: titleSet.has(rowIndex),
        header: false,
      })
    }
    if (titleSet.has(rowIndex) && maxCols > 1) {
      worksheet.mergeCells(rowIndex + 1, 1, rowIndex + 1, maxCols)
    }
  })

  ensureWorksheetGridLines(worksheet, rows.length, maxCols)

  const widthCount = columnWidths?.length || maxCols
  for (let i = 0; i < widthCount; i += 1) {
    worksheet.getColumn(i + 1).width = columnWidths?.[i] ?? (i === 0 ? 42 : 16)
  }

  await downloadExcelWorkbook(workbook, fileName)
}
