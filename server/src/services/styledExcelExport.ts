import ExcelJS from 'exceljs'

/**
 * 服务端「带样式表格」xlsx 生成（与前端 client/src/utils/exportStyledExcel.ts 样式保持一致）。
 * 用于十万级数据导出：前端把表格解析为「列树 + 已解析单元格矩阵」的可序列化 spec，
 * 由服务端生成并流式返回，避免浏览器逐单元格生成卡死/爆内存。
 */

export type ExportAlign = 'left' | 'center' | 'right'
export type ExportValueType = 'text' | 'amount' | 'number' | 'integer'

/** 列定义（可序列化）：叶子列携带 width/align/type；父列通过 children 表达多级表头 */
export interface ExportColumnSpec {
  label: string
  width?: number
  align?: ExportAlign
  type?: ExportValueType
  children?: ExportColumnSpec[]
}

export interface StyledXlsxSheetSpec {
  sheetName?: string
  title?: string
  subtitle?: string
  columns: ExportColumnSpec[]
  /** 已解析的叶子单元格值矩阵（行主序，按叶子列顺序） */
  rows: (string | number | null)[][]
  /** 合计行（与叶子列一一对应；首列自动写「合计」） */
  summaryValues?: (string | number | null)[]
  stripe?: boolean
}

export interface StyledXlsxSpec extends StyledXlsxSheetSpec {
  fileName: string
}

type LeafColumn = {
  label: string
  width?: number
  align: ExportAlign
  type: ExportValueType
}

type HeaderMerge = { top: number; left: number; bottom: number; right: number }

const GRID_BORDER = {
  top: { style: 'thin' as const, color: { argb: 'FF909399' } },
  left: { style: 'thin' as const, color: { argb: 'FF909399' } },
  bottom: { style: 'thin' as const, color: { argb: 'FF909399' } },
  right: { style: 'thin' as const, color: { argb: 'FF909399' } },
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

export function ensureXlsxFileName(fileName: string) {
  return fileName.toLowerCase().endsWith('.xlsx') ? fileName : `${fileName}.xlsx`
}

function applyGridBorder(cell: ExcelJS.Cell) {
  cell.border = { ...GRID_BORDER }
}

function ensureWorksheetGridLines(
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

function getLeafColumns(columns: ExportColumnSpec[]): LeafColumn[] {
  const leaves: LeafColumn[] = []
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
    })
  }
  return leaves
}

function getHeaderDepth(columns: ExportColumnSpec[]): number {
  let depth = 1
  for (const column of columns) {
    if (column.children?.length) {
      depth = Math.max(depth, 1 + getHeaderDepth(column.children))
    }
  }
  return depth
}

function countLeaves(column: ExportColumnSpec): number {
  if (!column.children?.length) return 1
  return column.children.reduce((sum, child) => sum + countLeaves(child), 0)
}

function buildHeaderLayout(
  columns: ExportColumnSpec[],
  depth: number
): { matrix: string[][]; merges: HeaderMerge[] } {
  const leafCount = columns.reduce((sum, column) => sum + countLeaves(column), 0)
  const matrix = Array.from({ length: depth }, () => Array(leafCount).fill(''))
  const merges: HeaderMerge[] = []

  function fill(columnsToFill: ExportColumnSpec[], row: number, colStart: number): number {
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
  }
) {
  const bold = options.bold || options.header || options.title
  cell.font = { name: '宋体', size: options.title ? 14 : 11, bold }
  applyGridBorder(cell)
  cell.alignment = {
    vertical: 'middle',
    horizontal: options.align ?? 'left',
    wrapText: false,
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

function appendStyledSheet(workbook: ExcelJS.Workbook, options: StyledXlsxSheetSpec) {
  const {
    sheetName = 'Sheet1',
    title,
    subtitle,
    columns,
    rows,
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
      const cell = row.getCell(colIndex + 1)
      cell.value = normalizeCellValue(rowData[colIndex])
      applyCellStyle(cell, {
        align: column.align,
        type: column.type,
        stripe: stripe && rowIndex % 2 === 1,
      })
    })
    currentRow += 1
  })

  if (summaryValues?.length) {
    const row = worksheet.getRow(currentRow)
    row.height = 20
    leafColumns.forEach((column, colIndex) => {
      const cell = row.getCell(colIndex + 1)
      cell.value = colIndex === 0 ? '合计' : normalizeCellValue(summaryValues[colIndex] ?? '')
      applyCellStyle(cell, { align: column.align, type: column.type, bold: true })
    })
    currentRow += 1
  }

  ensureWorksheetGridLines(worksheet, currentRow - 1, leafColumns.length)
}

/** 根据 spec 生成 xlsx Buffer */
export async function buildStyledXlsxBuffer(spec: StyledXlsxSheetSpec): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'CW Finance'
  appendStyledSheet(workbook, spec)
  const buffer = await workbook.xlsx.writeBuffer()
  return Buffer.from(buffer)
}
