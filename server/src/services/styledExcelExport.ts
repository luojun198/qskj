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
  /** 参数模式导出（FIX-254）：叶子列对应数据源的字段 key */
  key?: string
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
  /** 合计行之前的小计行（如外币表按币种小计），每行与叶子列一一对应，首列原样取值 */
  subtotalRows?: (string | number | null)[][]
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

/** 每写入这么多行让出一次事件循环，十万级导出期间其他请求仍可得到处理 */
const YIELD_EVERY_ROWS = 2000
/** 工作表 XML 在 zip 压缩流里积压超过该字节数就等它排空，把峰值内存压在这个量级 */
const SHEET_BACKPRESSURE_BYTES = 8 * 1024 * 1024

function yieldToEventLoop() {
  return new Promise<void>(resolve => setImmediate(resolve))
}

/**
 * ExcelJS 流式写入没有背压：`row.commit()` 把行 XML 写进内部 StreamBuf，StreamBuf 再写给 archiver 的
 * zip 变换流；写入不等待下游消费，压缩慢于生成时整张表的 XML 都会堆在变换流的写缓冲里
 * （24 万行实测 RSS 1.3GB）。这里直接看那条变换流的 writableLength，积压过多就等一次 'drain'。
 */
async function waitForSheetDrain(worksheet: ExcelJS.Worksheet) {
  const target = (worksheet as any).stream?.pipes?.[0] as
    | { writableLength?: number; once: (event: string, cb: () => void) => void }
    | undefined
  if (!target || typeof target.writableLength !== 'number') return
  if (target.writableLength < SHEET_BACKPRESSURE_BYTES) return
  await new Promise<void>(resolve => {
    // 极端情况下 drain 不触发（下游已结束）也不能把导出挂死，兜底 1s
    const timer = setTimeout(resolve, 1000)
    target.once('drain', () => {
      clearTimeout(timer)
      resolve()
    })
  })
}

/** 数据行来源：数组，或按需产出的（异步）迭代器（参数模式导出直接从 SQL 游标产出，不先落成数组） */
export type StyledXlsxRowSource =
  | (string | number | null)[][]
  | Iterable<(string | number | null)[]>
  | AsyncIterable<(string | number | null)[]>

export interface StyledXlsxStreamSpec extends Omit<StyledXlsxSheetSpec, 'rows'> {
  rows: StyledXlsxRowSource
}

/**
 * FIX-254（十万级压测 P1-3 / P2）：改用 ExcelJS 流式 WorkbookWriter，逐行 commit 到输出流。
 * 旧实现先在内存构建整本工作簿（10 万行 × 10 列 ≈ 100 万个带样式的 Cell 对象，RSS 冲到 1.1GB），
 * 再 writeBuffer；且全程同步，8 秒内整个后端无响应。现在：
 *  - 行写完即释放，峰值内存只剩 zip 输出缓冲；
 *  - 每 YIELD_EVERY_ROWS 行 await 一次 setImmediate，让排队的 HTTP 请求得到处理；
 *  - 表格网格线在写每个单元格时一并画好（旧实现末尾再整表补一遍，流式下不可行）。
 */
export async function writeStyledXlsxToStream(
  spec: StyledXlsxStreamSpec,
  stream: NodeJS.WritableStream
): Promise<{ rowCount: number }> {
  const {
    sheetName = 'Sheet1',
    title,
    subtitle,
    columns,
    rows,
    subtotalRows,
    summaryValues,
    stripe = true,
  } = spec

  const leafColumns = getLeafColumns(columns)
  const headerDepth = getHeaderDepth(columns)
  const { matrix, merges } = buildHeaderLayout(columns, headerDepth)
  const colCount = leafColumns.length

  // exceljs 的 stream 类型声明为 NodeJS.Stream，实际只用到写入方法，这里按写入流传入
  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
    stream: stream as any,
    useStyles: true,
    useSharedStrings: false,
  })
  workbook.creator = 'CW Finance'
  const worksheet = workbook.addWorksheet(sheetName, {
    views: [{ state: 'frozen', ySplit: (title ? 1 : 0) + (subtitle ? 1 : 0) + headerDepth }],
  })
  worksheet.columns = leafColumns.map(column => ({
    width: Math.max(8, Math.round((column.width || 96) / 8)),
  }))

  let currentRow = 1

  /** 标题 / 副标题行：整行合并，合并区内每个单元格都先画上网格线 */
  const writeBannerRow = (text: string, height: number, isTitle: boolean) => {
    const row = worksheet.getRow(currentRow)
    row.height = height
    for (let c = 1; c <= colCount; c += 1) {
      const cell = row.getCell(c)
      cell.value = c === 1 ? text : ''
      applyCellStyle(
        cell,
        isTitle ? { title: true, align: 'center', bold: true } : { align: 'center' }
      )
    }
    if (colCount > 1) worksheet.mergeCells(currentRow, 1, currentRow, colCount)
    row.commit()
    currentRow += 1
  }
  if (title) writeBannerRow(title, 24, true)
  if (subtitle) writeBannerRow(subtitle, 18, false)

  // 流式模式下合并必须在相关行 commit 之前完成：先把整块表头行填好、合并，再按顺序 commit
  const headerStartRow = currentRow
  const headerRows: ExcelJS.Row[] = []
  for (let r = 0; r < matrix.length; r += 1) {
    const row = worksheet.getRow(currentRow)
    row.height = 20
    for (let c = 1; c <= colCount; c += 1) {
      const cell = row.getCell(c)
      cell.value = matrix[r][c - 1] ?? ''
      applyCellStyle(cell, { header: true })
    }
    headerRows.push(row)
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
  for (const row of headerRows) row.commit()

  let rowIndex = 0
  for await (const rowData of rows as AsyncIterable<(string | number | null)[]>) {
    const row = worksheet.getRow(currentRow)
    row.height = 18
    for (let c = 0; c < colCount; c += 1) {
      const cell = row.getCell(c + 1)
      cell.value = normalizeCellValue(rowData[c])
      applyCellStyle(cell, {
        align: leafColumns[c].align,
        type: leafColumns[c].type,
        stripe: stripe && rowIndex % 2 === 1,
      })
    }
    row.commit()
    currentRow += 1
    rowIndex += 1
    if (rowIndex % 500 === 0) await waitForSheetDrain(worksheet)
    if (rowIndex % YIELD_EVERY_ROWS === 0) await yieldToEventLoop()
  }

  for (const subtotal of subtotalRows || []) {
    const row = worksheet.getRow(currentRow)
    row.height = 18
    for (let c = 0; c < colCount; c += 1) {
      const cell = row.getCell(c + 1)
      cell.value = normalizeCellValue(subtotal[c] ?? '')
      applyCellStyle(cell, { align: leafColumns[c].align, type: leafColumns[c].type, bold: true })
    }
    row.commit()
    currentRow += 1
  }

  if (summaryValues?.length) {
    const row = worksheet.getRow(currentRow)
    row.height = 20
    for (let c = 0; c < colCount; c += 1) {
      const cell = row.getCell(c + 1)
      cell.value = c === 0 ? '合计' : normalizeCellValue(summaryValues[c] ?? '')
      applyCellStyle(cell, { align: leafColumns[c].align, type: leafColumns[c].type, bold: true })
    }
    row.commit()
    currentRow += 1
  }

  worksheet.commit()
  await workbook.commit()
  return { rowCount: rowIndex }
}

/** 根据 spec 生成 xlsx Buffer（内部走流式写入，只驻留压缩后的文件字节） */
export async function buildStyledXlsxBuffer(spec: StyledXlsxSheetSpec): Promise<Buffer> {
  const { PassThrough } = await import('node:stream')
  const chunks: Buffer[] = []
  const sink = new PassThrough()
  sink.on('data', (chunk: Buffer) => chunks.push(chunk))
  const done = new Promise<void>((resolve, reject) => {
    sink.on('end', resolve)
    sink.on('error', reject)
  })
  await writeStyledXlsxToStream(spec, sink)
  await done
  return Buffer.concat(chunks)
}
