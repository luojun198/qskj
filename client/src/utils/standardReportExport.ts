/**
 * 标准报表的「所见即所得」导出：打印 HTML 与 Excel 共用同一份网格模型。
 *
 * 之所以要抽出来：原先打印 HTML 是在 StandardReport.vue 里现拼的，**完全没有输出列宽**
 * （`width:100%` + table-layout 自动），而「页面设置」的缩放比例却是按 col_widths 算的。
 * 两者对不上，浏览器和 html2canvas 各算各的列宽，内容溢出又没有裁剪，
 * 光栅化成 PDF 后文字就互相压在一起。
 *
 * 现在打印与 Excel 都从同一个模型出发，列宽、行高、合并、样式三处同源。
 */
import ExcelJS from 'exceljs'

import { downloadExcelWorkbook } from './exportStyledExcel'
import {
  fontFamilyCss,
  parseStyleKey,
  rowCenterOffsetPx,
  styleToCssText,
  type CellStyle,
} from '@/composables/useReportCellStyle'

export interface ReportExportCell {
  rowIndex: number
  colIndex: number
  /** 已经过显示格式化的文本（与屏幕一致） */
  text: string
  rowSpan: number
  colSpan: number
  styleKey: string | null
  formatText: string | null
  /** 取数视图下的数值；null 表示这一格不是数字（文本、公式文本或出错） */
  numericValue: number | null
  isError: boolean
}

export interface ReportExportModel {
  name: string
  rowCount: number
  colCount: number
  /** 逐列宽度（px），长度等于 colCount */
  colWidths: number[]
  /** 逐行高度（px），长度等于 rowCount */
  rowHeights: number[]
  /** 已排除被合并覆盖的坐标 */
  cells: ReportExportCell[]
}

export interface BuildModelOptions {
  name: string
  rowCount: number
  colCount: number
  getColWidth: (colIndex: number) => number
  getRowHeight: (rowIndex: number) => number
  /** 原始单元格，用于读 merge_info / style_key / format_text */
  source: Array<{
    row_index: number
    col_index: number
    merge_info?: string | null
    style_key?: string | null
    format_text?: string | null
  }>
  /** 取显示文本（与屏幕同一个函数，保证所见即所得） */
  getText: (rowIndex: number, colIndex: number) => string
  /** 取数值；返回 null 表示非数字 */
  getNumeric?: (rowIndex: number, colIndex: number) => number | null
  /** 该格是否算错了 */
  isError?: (rowIndex: number, colIndex: number) => boolean
}

function parseMerge(value: string | null | undefined) {
  if (!value) return { rowSpan: 1, colSpan: 1 }
  try {
    const parsed = JSON.parse(value)
    return {
      rowSpan: Math.max(1, Number(parsed?.rowSpan) || 1),
      colSpan: Math.max(1, Number(parsed?.colSpan) || 1),
    }
  } catch {
    return { rowSpan: 1, colSpan: 1 }
  }
}

export function buildReportExportModel(options: BuildModelOptions): ReportExportModel {
  const { rowCount, colCount, source, getText, getNumeric, isError } = options

  const byKey = new Map(source.map(cell => [`${cell.row_index}_${cell.col_index}`, cell]))

  // 被合并覆盖、不参与输出的坐标
  const covered = new Set<string>()
  for (const cell of source) {
    const { rowSpan, colSpan } = parseMerge(cell.merge_info)
    if (rowSpan === 1 && colSpan === 1) continue
    for (let r = 0; r < rowSpan; r += 1) {
      for (let c = 0; c < colSpan; c += 1) {
        if (r === 0 && c === 0) continue
        covered.add(`${cell.row_index + r}_${cell.col_index + c}`)
      }
    }
  }

  const cells: ReportExportCell[] = []
  for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
    for (let colIndex = 0; colIndex < colCount; colIndex += 1) {
      const key = `${rowIndex}_${colIndex}`
      if (covered.has(key)) continue
      const template = byKey.get(key)
      const { rowSpan, colSpan } = parseMerge(template?.merge_info)
      cells.push({
        rowIndex,
        colIndex,
        text: getText(rowIndex, colIndex),
        rowSpan,
        colSpan,
        styleKey: template?.style_key ?? null,
        formatText: template?.format_text ?? null,
        numericValue: getNumeric ? getNumeric(rowIndex, colIndex) : null,
        isError: isError ? isError(rowIndex, colIndex) : false,
      })
    }
  }

  return {
    name: options.name,
    rowCount,
    colCount,
    colWidths: Array.from({ length: colCount }, (_, index) => options.getColWidth(index)),
    rowHeights: Array.from({ length: rowCount }, (_, index) => options.getRowHeight(index)),
    cells,
  }
}

/** 单元格左右内边距（px）；打印样式与铺开宽度都要用它，写死两处必然对不上 */
const CELL_PADDING_X = 8

/**
 * 数值格的左右内边距（px）。
 *
 * 金额是定宽的、一位都不能少，比项目名更需要横向空间；文本格保持 8px 不动，
 * 数值格收窄到 3px，相当于每格多出 10px ≈ 一位半数字的余量。
 */
const NUMERIC_PADDING_X = 3

/** 打印正文默认字号（px），与 tdBase 保持一致 */
const PRINT_FONT_SIZE = 12

/** 数值缩排的下限字号（px），再小就辨认不出来了 */
const MIN_NUMERIC_FONT_SIZE = 8

/**
 * 估算文本在宋体下的像素宽度：西文/数字是半角（0.5em），中日韩与全角符号按 1em 算。
 * 只用来判断「会不会被裁掉」，不需要精确到亚像素。
 */
export function estimateTextWidth(text: string, fontSize: number) {
  let width = 0
  for (const ch of text) {
    const code = ch.codePointAt(0) || 0
    width += code > 0x2e7f ? fontSize : fontSize * 0.5
  }
  return width
}

/** 打印表格默认字体，与 buildReportPrintHtml 里 table 的 font-family 一致 */
const PRINT_FONT_FAMILY = "'SimSun','宋体',serif"

/**
 * 不同渲染器（浏览器排版 / html2canvas 光栅化 / 打印机 DPI 取整）之间的字宽误差余量。
 * 比例 + 固定像素双保险：短数字靠固定像素兜底，长数字靠比例兜底。
 */
const TEXT_WIDTH_TOLERANCE_RATIO = 1.04
const TEXT_WIDTH_TOLERANCE_PX = 2

let measureContext: CanvasRenderingContext2D | null | undefined

/**
 * 用真实字体实测文本宽度（px）；非浏览器环境或 canvas 不可用时返回 null。
 *
 * 只靠「半角 0.5em」估算只对宋体成立：微软雅黑 / 黑体的数字明显更宽，
 * 加粗（宋体没有粗体字面、由渲染器加粗描边）也会变宽，估算偏小就会被裁掉末位小数。
 */
export function measureTextWidth(
  text: string,
  fontSize: number,
  fontFamily?: string,
  bold?: boolean
): number | null {
  if (measureContext === undefined) {
    try {
      measureContext =
        typeof document !== 'undefined'
          ? document.createElement('canvas').getContext('2d')
          : null
    } catch {
      measureContext = null
    }
  }
  if (!measureContext) return null
  try {
    measureContext.font = `${bold ? '700 ' : ''}${fontSize}px ${fontFamily || PRINT_FONT_FAMILY}`
    const width = measureContext.measureText(text).width
    return Number.isFinite(width) && width > 0 ? width : null
  } catch {
    return null
  }
}

export interface FitNumericFontOptions {
  /** CSS font-family；不传用打印默认宋体 */
  fontFamily?: string
  bold?: boolean
}

/**
 * 数值格的「缩小字体填充」（同 Excel 的 shrink to fit）。
 *
 * 打印 / 导出 PDF 与屏幕预览对不上、末位小数被切掉，根因是数值格 `white-space:nowrap`
 * 又套了 `overflow:hidden`：只要渲染器把字量得比浏览器宽一点点（html2canvas 重新排版、
 * 打印机按物理 DPI 取整都会），超出的部分就被直接裁掉，而且是无声裁掉。
 * 与其让它裁，不如按比例降字号，保证整串数字完整出现。
 *
 * 字宽取「真实字体实测」与「宋体估算」中的较大者，再加安全余量。
 */
export function fitNumericFontSize(
  text: string,
  availableWidth: number,
  baseFontSize: number,
  options: FitNumericFontOptions = {}
) {
  const trimmed = text.trim()
  if (!trimmed || availableWidth <= 0) return baseFontSize
  const usable = availableWidth - TEXT_WIDTH_TOLERANCE_PX
  if (usable <= 0) return MIN_NUMERIC_FONT_SIZE

  const estimated = estimateTextWidth(trimmed, baseFontSize)
  const measured = measureTextWidth(trimmed, baseFontSize, options.fontFamily, options.bold)
  const needed = Math.max(estimated, measured ?? 0) * TEXT_WIDTH_TOLERANCE_RATIO
  if (needed <= usable) return baseFontSize

  const scaled = Math.floor(((usable / needed) * baseFontSize) * 10) / 10
  return Math.max(MIN_NUMERIC_FONT_SIZE, Math.min(baseFontSize, scaled))
}

/** 认定「表格主体到此为止」所需的连续无边框列数，与导入侧 fillTableBorders 一致 */
const TABLE_COL_GAP = 2

const BORDER_SIDE_RE = /\bborder-(all|outer|header|top|bottom|left|right)\b/

function escapeHtml(value: string) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/** style_key 是否带了会打印出来的边框（border-none / 仅颜色粗细不算） */
export function styleKeyHasBorder(styleKey: string | null | undefined) {
  return BORDER_SIDE_RE.test(styleKey || '')
}

export function appendBorderAll(styleKey: string | null | undefined) {
  if (styleKeyHasBorder(styleKey)) return styleKey || null
  const cleaned = String(styleKey || '')
    .replace(/\bborder-none\b/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned ? `${cleaned} border-all` : 'border-all'
}

export function resolveExportTableBounds(
  cells: Array<{ rowIndex: number; colIndex: number; styleKey: string | null }>
) {
  const bordered = cells.filter(cell => styleKeyHasBorder(cell.styleKey))
  if (!bordered.length) return null

  const colHasBorder: boolean[] = []
  let maxBorderedCol = 0
  for (const cell of bordered) {
    colHasBorder[cell.colIndex] = true
    if (cell.colIndex > maxBorderedCol) maxBorderedCol = cell.colIndex
  }

  let lastCol = 0
  let gap = 0
  for (let col = 0; col <= maxBorderedCol; col += 1) {
    if (colHasBorder[col]) {
      lastCol = col
      gap = 0
      continue
    }
    gap += 1
    if (gap >= TABLE_COL_GAP) break
  }

  const inRange = bordered.filter(cell => cell.colIndex <= lastCol)
  if (!inRange.length) return null
  return {
    lastCol,
    firstRow: Math.min(...inRange.map(cell => cell.rowIndex)),
    lastRow: Math.max(...inRange.map(cell => cell.rowIndex)),
  }
}

/**
 * 表格主体内没有边框的格子补上 border-all。
 * 标题行（带框区域之上）不动；已经设过单边/全边的格子也不改。
 */
export function ensureExportTableBorders(model: ReportExportModel): ReportExportModel {
  const bounds = resolveExportTableBounds(model.cells)
  if (!bounds) return model
  return {
    ...model,
    cells: model.cells.map(cell => {
      if (cell.rowIndex < bounds.firstRow || cell.rowIndex > bounds.lastRow) return cell
      if (cell.colIndex > bounds.lastCol) return cell
      if (styleKeyHasBorder(cell.styleKey)) return cell
      return { ...cell, styleKey: appendBorderAll(cell.styleKey) }
    }),
  }
}

export interface PrintHtmlOptions {
  /** 打印缩放，1 表示原尺寸 */
  scale?: number
  /** 公式视图：把公式文本用等宽灰字显示 */
  showFormulaText?: boolean
}

/** 与页面设置组件同一套字段；边距单位 mm */
export interface ReportPrintPageSetup {
  paperSize?: string
  orientation?: 'portrait' | 'landscape'
  scale?: number
  marginTop?: number
  marginBottom?: number
  marginLeft?: number
  marginRight?: number
  /** true 时按纸张适配一整页；false 时用 scale 百分比 */
  fitToPage?: boolean
}

const EXCEL_PAPER_SIZE: Record<string, number> = { A4: 9, A5: 11, A3: 8 }

function mmToInch(mm: number) {
  return Math.round((mm / 25.4) * 1000) / 1000
}

function colToLetter(col: number) {
  let index = col
  let label = ''
  while (index > 0) {
    const remainder = (index - 1) % 26
    label = String.fromCharCode(65 + remainder) + label
    index = Math.floor((index - 1) / 26)
  }
  return label
}

/** 把纸张/边距/缩放写进工作表，用 Excel 打开后打印设置已就绪 */
export function applyReportPageSetup(workbook: ExcelJS.Workbook, setup?: ReportPrintPageSetup) {
  const sheet = workbook.worksheets[0]
  if (!sheet || !setup) return workbook

  sheet.pageSetup.paperSize = EXCEL_PAPER_SIZE[setup.paperSize || 'A4'] || 9
  sheet.pageSetup.orientation = setup.orientation === 'landscape' ? 'landscape' : 'portrait'
  sheet.pageSetup.horizontalCentered = true
  sheet.pageSetup.margins = {
    left: mmToInch(setup.marginLeft ?? 8),
    right: mmToInch(setup.marginRight ?? 8),
    top: mmToInch(setup.marginTop ?? 8),
    bottom: mmToInch(setup.marginBottom ?? 8),
    header: 0.3,
    footer: 0.3,
  }

  if (setup.fitToPage) {
    sheet.pageSetup.fitToPage = true
    sheet.pageSetup.fitToWidth = 1
    sheet.pageSetup.fitToHeight = 1
  } else if (setup.scale && setup.scale > 0) {
    sheet.pageSetup.fitToPage = false
    sheet.pageSetup.scale = Math.round(setup.scale * 100)
  }

  const lastCol = sheet.columnCount
  const lastRow = sheet.rowCount
  if (lastCol > 0 && lastRow > 0) {
    sheet.pageSetup.printArea = `A1:${colToLetter(lastCol)}${lastRow}`
  }
  return workbook
}

/** 与「导出 Excel」同一份工作簿，并带上打印页面设置 */
export function buildPrintWorkbook(model: ReportExportModel, pageSetup?: ReportPrintPageSetup) {
  return applyReportPageSetup(buildReportWorkbook(model), pageSetup)
}

/**
 * 一个单元格可以向右铺开的宽度（含自身列宽）；返回 null 表示不铺开、按本列宽度裁剪。
 *
 * 只对左对齐（或未设对齐）的文本格生效：数字与居中/右对齐的内容一旦铺开会看不出归属哪一列。
 * 铺开范围止于同一行右侧第一个「有内容」或「有边框」的格子——空的带框格（如行次列）
 * 也是墙，否则项目名会盖住邻格，打印时表格框线被拆成一串孤立方框。
 */
function spillWidth(
  model: ReportExportModel,
  cell: ReportExportCell,
  style: CellStyle,
  rowCells: ReportExportCell[],
  nonEmptyCols: Set<number>
): number | null {
  if (!cell.text.trim()) return null
  if (cell.numericValue !== null || cell.isError) return null
  if (style.textAlign && style.textAlign !== 'left') return null

  const startCol = cell.colIndex
  const ownWidth = model.colWidths
    .slice(startCol, startCol + cell.colSpan)
    .reduce((sum, width) => sum + width, 0)

  const borderedCols = new Set(
    rowCells.filter(item => styleKeyHasBorder(item.styleKey)).map(item => item.colIndex)
  )

  let extra = 0
  for (let col = startCol + cell.colSpan; col < model.colCount; col += 1) {
    if (nonEmptyCols.has(col) || borderedCols.has(col)) {
      // 整行居中的格子（抬头日期）不算墙：它的文字只占中线附近一小段，
      // 左侧的「纳税人名称」可以继续铺到日期文字之前，否则名称会被迫折行
      const blocker = rowCells.find(item => item.colIndex === col)
      if (blocker && !borderedCols.has(col)) {
        const blockerStyle = parseStyleKey(blocker.styleKey)
        if (blockerStyle.rowCenter && blockerStyle.textAlign === 'center') {
          const center = rowCenterOffsetPx(
            index => model.colWidths[index] || 0,
            model.colCount,
            startCol
          )
          const half =
            estimateTextWidth(blocker.text.trim(), blockerStyle.fontSize || PRINT_FONT_SIZE) / 2
          const blockerWidth = model.colWidths
            .slice(blocker.colIndex, blocker.colIndex + blocker.colSpan)
            .reduce((sum, width) => sum + (width || 0), 0)
          const allowed = Math.min(center - half - CELL_PADDING_X - ownWidth, extra + blockerWidth)
          extra = Math.max(extra, allowed)
        }
      }
      break
    }
    extra += model.colWidths[col] || 0
  }

  if (extra <= 0) return null

  // span 从「本格左内边距之后」开始画，要铺到下一个有内容的格子的左边界为止，
  // 因此必须扣掉左内边距；再留一个右内边距的空隙，避免正好贴上邻格的文字。
  return Math.max(0, ownWidth + extra - CELL_PADDING_X * 2)
}

function styleWithoutBorder(style: CellStyle): CellStyle {
  return { ...style, borderStyle: '', borderColor: '', borderWidth: 0 }
}

/**
 * 表格主体用「右+下」画线，外沿再补左/上，才能连成一张网。
 * 每格写四边 `border:1px` 再 collapse，Chrome / hiprint / html2canvas 会拆成孤立方框。
 */
function gridClassNames(
  cell: ReportExportCell,
  bounds: { firstRow: number; lastRow: number; lastCol: number } | null
) {
  if (!bounds) return ''
  if (cell.rowIndex < bounds.firstRow || cell.rowIndex > bounds.lastRow) return ''
  if (cell.colIndex > bounds.lastCol) return ''
  const names = ['cw-grid']
  if (cell.colIndex === 0) names.push('cw-grid-left')
  if (cell.rowIndex === bounds.firstRow) names.push('cw-grid-top')
  return names.join(' ')
}

/**
 * 生成自包含的打印 HTML。
 *
 * 三个关键点，缺一个 PDF 就会错位：
 *   1. `<colgroup>` 输出真实列宽，配合 `table-layout:fixed` —— 否则渲染器自行分配列宽；
 *   2. 表格用固定总宽（px）而不是 `width:100%` —— 百分比要依赖容器宽度，光栅化时不确定；
 *   3. 超宽内容在 td **内部**裁剪，td 本身不能写 overflow:hidden —— Chrome 下
 *      overflow≠visible 的单元格会退出 border-collapse，每格各画一圈孤立边框。
 *   4. 表格主体强制连续网格（右+下），标题行不加框，与 Excel 导出同一矩形范围。
 *
 * 缩放用 `transform: scale()` 而非 `zoom`：html2canvas 对 `zoom` 的支持很不稳定。
 */
export function buildReportPrintHtml(
  model: ReportExportModel,
  options: PrintHtmlOptions = {}
): string {
  if (model.rowCount === 0 || model.colCount === 0) return ''

  const printModel = ensureExportTableBorders(model)
  const bounds = resolveExportTableBounds(printModel.cells)
  const scale = options.scale && options.scale > 0 ? options.scale : 1
  const tdBase = `padding:3px ${CELL_PADDING_X}px;font-size:12px;white-space:nowrap;box-sizing:border-box;`

  const byRow = new Map<number, ReportExportCell[]>()
  for (const cell of printModel.cells) {
    const list = byRow.get(cell.rowIndex)
    if (list) list.push(cell)
    else byRow.set(cell.rowIndex, [cell])
  }

  const rowsHtml: string[] = []
  for (let rowIndex = 0; rowIndex < printModel.rowCount; rowIndex += 1) {
    const list = (byRow.get(rowIndex) || []).slice().sort((a, b) => a.colIndex - b.colIndex)
    const nonEmptyCols = new Set(list.filter(item => item.text.trim()).map(item => item.colIndex))

    const tds = list.map(cell => {
      const cellStyle = parseStyleKey(cell.styleKey)
      const inGrid = Boolean(gridClassNames(cell, bounds))
      let style = tdBase + styleToCssText(inGrid ? styleWithoutBorder(cellStyle) : cellStyle)
      // 与屏幕、Excel 一致：格子自带对齐（如居中的行次列）优先，未设对齐的数值才右对齐
      if (cell.isError) style += 'color:#c00;text-align:right;'
      else if (cell.numericValue !== null && !cellStyle.textAlign) style += 'text-align:right;'
      const classAttr = inGrid ? ` class="${gridClassNames(cell, bounds)}"` : ''
      const spanAttr =
        (cell.colSpan > 1 ? ` colspan="${cell.colSpan}"` : '') +
        (cell.rowSpan > 1 ? ` rowspan="${cell.rowSpan}"` : '')

      // 数值格：收窄内边距 + 必要时降字号，宁可字小也不能少一位小数
      const isNumericCell = cell.numericValue !== null || cell.isError
      if (isNumericCell && cell.text.trim()) {
        const ownWidth = printModel.colWidths
          .slice(cell.colIndex, cell.colIndex + cell.colSpan)
          .reduce((sum, width) => sum + (width || 0), 0)
        const baseFontSize = cellStyle.fontSize || PRINT_FONT_SIZE
        const fontSize = fitNumericFontSize(
          cell.text,
          ownWidth - NUMERIC_PADDING_X * 2,
          baseFontSize,
          {
            fontFamily: fontFamilyCss(cellStyle.fontFamily) || undefined,
            bold: cellStyle.bold,
          }
        )
        style += `padding-left:${NUMERIC_PADDING_X}px;padding-right:${NUMERIC_PADDING_X}px;font-size:${fontSize}px;`
      }

      const spill = spillWidth(printModel, cell, cellStyle, list, nonEmptyCols)
      const content = escapeHtml(cell.text)

      // 整行居中：文字锚在整张表的中线上，可以探出本格（抬头行两侧通常留白）。
      // 不能给 td 设 overflow，见函数注释第 3 点；position:relative 不影响 border-collapse。
      if (cellStyle.rowCenter && cellStyle.textAlign === 'center' && cell.text.trim()) {
        const offset = rowCenterOffsetPx(
          index => printModel.colWidths[index] || 0,
          printModel.colCount,
          cell.colIndex
        )
        return (
          `<td${classAttr}${spanAttr} style="${style}position:relative;">` +
          `<span style="position:absolute;left:${Math.round(offset)}px;top:50%;` +
          `transform:translate(-50%,-50%);white-space:nowrap;">${content}</span>` +
          `</td>`
        )
      }

      if (spill === null) {
        // 与屏幕一致：文字在格内自动换行（导入时已按折行行数撑高了行高），数值保持单行；
        // 用 max-height 兜住，避免极端长文本把行撑出预设高度、打乱分页
        const rowHeight = printModel.rowHeights[rowIndex] || 0
        const wrap =
          cell.numericValue === null && !cell.isError
            ? `white-space:normal;word-break:break-all;max-height:${Math.max(0, rowHeight - 6)}px;`
            : 'white-space:nowrap;'
        return (
          `<td${classAttr}${spanAttr} style="${style}">` +
          `<div style="overflow:hidden;${wrap}">${content}</div>` +
          `</td>`
        )
      }
      return (
        `<td${classAttr}${spanAttr} style="${style}">` +
        `<span style="display:inline-block;width:${spill}px;overflow:hidden;">${content}</span>` +
        `</td>`
      )
    })
    rowsHtml.push(`<tr style="height:${printModel.rowHeights[rowIndex]}px;">${tds.join('')}</tr>`)
  }

  const totalWidth = printModel.colWidths.reduce((sum, width) => sum + width, 0)
  const totalHeight = printModel.rowHeights.reduce((sum, height) => sum + height, 0)
  const colgroup = `<colgroup>${printModel.colWidths
    .map(width => `<col style="width:${width}px;">`)
    .join('')}</colgroup>`

  const table =
    `<table class="cw-report-table" style="border-collapse:collapse;border-spacing:0;empty-cells:show;table-layout:fixed;width:${totalWidth}px;` +
    `font-family:'SimSun','宋体',serif;">${colgroup}<tbody>${rowsHtml.join('')}</tbody></table>`

  const styled =
    `<div class="cw-report-print">` +
    `<style>` +
    `.cw-report-print table{border-collapse:collapse!important;border-spacing:0!important;empty-cells:show!important;}` +
    `.cw-report-print td.cw-grid{border-right:1px solid #000!important;border-bottom:1px solid #000!important;}` +
    `.cw-report-print td.cw-grid-left{border-left:1px solid #000!important;}` +
    `.cw-report-print td.cw-grid-top{border-top:1px solid #000!important;}` +
    `</style>${table}</div>`

  if (scale === 1) return styled

  return (
    `<div style="width:${Math.ceil(totalWidth * scale)}px;height:${Math.ceil(totalHeight * scale)}px;overflow:hidden;">` +
    `<div style="width:${totalWidth}px;transform:scale(${scale});transform-origin:top left;">${styled}</div>` +
    `</div>`
  )
}

// ─────────────────────────── 自动适配缩放 ───────────────────────────

export const PAPER_SIZES = [
  { value: 'A4', label: 'A4', width: 210, height: 297 },
  { value: 'A5', label: 'A5', width: 148, height: 210 },
  { value: 'A3', label: 'A3', width: 297, height: 420 },
]

/** CSS 里 1in = 96px = 25.4mm */
export const MM_TO_PX = 96 / 25.4

export interface AutoFitOptions {
  paperSize: string
  orientation: 'portrait' | 'landscape'
  margins: { top: number; bottom: number; left: number; right: number }
  contentSize: { width: number; height: number }
}

/** 扣掉页边距后的可打印区域（px） */
export function computePrintableSize(options: Omit<AutoFitOptions, 'contentSize'>) {
  const paper = PAPER_SIZES.find(item => item.value === options.paperSize) || PAPER_SIZES[0]
  const isLandscape = options.orientation === 'landscape'
  const widthMm =
    (isLandscape ? paper.height : paper.width) - options.margins.left - options.margins.right
  const heightMm =
    (isLandscape ? paper.width : paper.height) - options.margins.top - options.margins.bottom
  return {
    width: Math.max(10, widthMm) * MM_TO_PX,
    height: Math.max(10, heightMm) * MM_TO_PX,
  }
}

/**
 * 让报表正好放进一页所需的缩放（0.2 ~ 2）；内容比纸小就不放大，保持 1。
 *
 * 打印路径也要用它：报表若从没设过 print_scale，旧逻辑一律按 1 处理，
 * 而 ACD 导入的报表默认列宽 160px × 8 列 = 1280px，远宽于 A4 纵向的可打印区（约 700px），
 * 不缩放就必然溢出。
 */
export function computeAutoFitScale(options: AutoFitOptions) {
  const { width, height } = options.contentSize
  if (!width || !height) return 1
  const area = computePrintableSize(options)
  const ratio = Math.min(area.width / width, area.height / height, 1)
  return Math.max(0.2, Math.min(2, Math.round(ratio * 100) / 100))
}

// ─────────────────────────── Excel ───────────────────────────

/** px → Excel 列宽（约等于「标准字符数」）；Excel 的列宽单位是字符宽，1 字符 ≈ 7px */
function pxToExcelWidth(px: number) {
  return Math.max(1, Math.round((px / 7) * 100) / 100)
}

/** px → 磅（Excel 的行高与字号都用磅） */
function pxToPoints(px: number) {
  return Math.round(px * 0.75 * 100) / 100
}

/** report_cells.format_text → Excel 数字格式 */
const NUMBER_FORMATS: Record<string, string> = {
  integer: '0',
  '2decimal': '0.00',
  '4decimal': '0.0000',
  thousands: '#,##0.00',
  percent: '0.00%',
}

const FONT_NAMES: Record<string, string> = {
  SimSun: '宋体',
  SimHei: '黑体',
  KaiTi: '楷体',
  FangSong: '仿宋',
  'Microsoft-YaHei': '微软雅黑',
}

function toArgb(color: string, fallback: string) {
  const hex = String(color || '').replace(/^#/, '')
  return /^[0-9a-fA-F]{6}$/.test(hex) ? `FF${hex.toUpperCase()}` : fallback
}

/** 边框粗细 → ExcelJS 的线型；Excel 只有 thin/medium/thick 三档 */
function toBorderStyle(width: number): ExcelJS.BorderStyle {
  if (width >= 3) return 'thick'
  if (width >= 2) return 'medium'
  return 'thin'
}

/**
 * 把 style_key 的边框 token 展开成四边开关。
 * 与 useReportCellStyle.borderCss 的语义保持一致：
 * all=四边，outer=四边，header=上下，top/bottom/left/right=单边，none/空=无。
 */
function resolveBorderSides(style: CellStyle) {
  const value = style.borderStyle
  const none = { top: false, bottom: false, left: false, right: false }
  if (!value || value === 'none') return none
  if (value === 'all' || value === 'outer') {
    return { top: true, bottom: true, left: true, right: true }
  }
  if (value === 'header') return { ...none, top: true, bottom: true }
  if (value === 'top' || value === 'bottom' || value === 'left' || value === 'right') {
    return { ...none, [value]: true }
  }
  return none
}

function applyCellStyle(target: ExcelJS.Cell, cell: ReportExportCell) {
  const style = parseStyleKey(cell.styleKey)

  const font: Partial<ExcelJS.Font> = {}
  if (style.fontSize) font.size = pxToPoints(style.fontSize)
  if (style.bold) font.bold = true
  if (style.underline) font.underline = true
  if (style.fontFamily && FONT_NAMES[style.fontFamily]) font.name = FONT_NAMES[style.fontFamily]
  if (cell.isError) font.color = { argb: 'FFCC0000' }
  else if (style.textColor) font.color = { argb: toArgb(style.textColor, 'FF000000') }
  if (Object.keys(font).length > 0) target.font = font

  const alignment: Partial<ExcelJS.Alignment> = {}
  // 没有显式对齐时，数字右对齐 —— 与屏幕和打印保持一致
  if (style.textAlign) alignment.horizontal = style.textAlign
  else if (cell.numericValue !== null || cell.isError) alignment.horizontal = 'right'
  if (style.verticalAlign) {
    alignment.vertical = style.verticalAlign === 'middle' ? 'middle' : style.verticalAlign
  }
  if (Object.keys(alignment).length > 0) target.alignment = alignment

  if (style.bgColor) {
    target.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: toArgb(style.bgColor, 'FFFFFFFF') },
    }
  }

  const sides = resolveBorderSides(style)
  if (sides.top || sides.bottom || sides.left || sides.right) {
    const line = {
      style: toBorderStyle(style.borderWidth || 1),
      color: { argb: toArgb(style.borderColor, 'FF000000') },
    }
    target.border = {
      ...(sides.top ? { top: line } : {}),
      ...(sides.bottom ? { bottom: line } : {}),
      ...(sides.left ? { left: line } : {}),
      ...(sides.right ? { right: line } : {}),
    }
  }

  if (cell.numericValue === null) return
  const format =
    (cell.formatText ? NUMBER_FORMATS[cell.formatText] : '') || inferNumberFormat(cell.text)
  if (format) target.numFmt = format
}

/**
 * 没设数字格式的数值格，按屏幕显示文本反推 Excel 格式，保证 Excel 里的小数位、千分位
 * 与屏幕一致（服务端对金额默认输出「千分位 + 两位小数」，Excel 若按「常规」会丢掉末尾 0）。
 */
export function inferNumberFormat(text: string): string {
  const trimmed = String(text || '').trim()
  const matched = /^-?(\d{1,3}(,\d{3})+|\d+)(\.(\d+))?$/.exec(trimmed)
  if (!matched) return ''
  const grouping = trimmed.includes(',')
  const digits = matched[4]?.length || 0
  if (!grouping && digits === 0) return ''
  const integerPart = grouping ? '#,##0' : '0'
  return digits > 0 ? `${integerPart}.${'0'.repeat(digits)}` : integerPart
}

/** 工作表名不能含 : \\ / ? * [ ]，且不超过 31 字符 */
function toSheetName(name: string) {
  const cleaned = String(name || '报表').replace(/[:\\/?*[\]]/g, ' ').trim()
  return (cleaned || '报表').slice(0, 31)
}

/**
 * 构造 .xlsx 工作簿，尽量保持原格式：列宽、行高、合并、字体、对齐、边框、底色、数字格式。
 *
 * 数值格写成**数字**而不是字符串，这样在 Excel 里还能继续参与计算；
 * 只有文本格与算错的格才写字符串。
 *
 * 与下载动作分开，便于单测直接检查工作簿内容。
 */
export function buildReportWorkbook(model: ReportExportModel) {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet(toSheetName(model.name))

  sheet.columns = model.colWidths.map(width => ({ width: pxToExcelWidth(width) }))
  for (let rowIndex = 0; rowIndex < model.rowCount; rowIndex += 1) {
    sheet.getRow(rowIndex + 1).height = pxToPoints(model.rowHeights[rowIndex])
  }

  for (const cell of model.cells) {
    const target = sheet.getCell(cell.rowIndex + 1, cell.colIndex + 1)
    if (cell.numericValue !== null) target.value = cell.numericValue
    else if (cell.text) target.value = cell.text
    applyCellStyle(target, cell)
  }

  // 合并要放在写值之后：ExcelJS 合并时会以左上角为准清掉其余格
  for (const cell of model.cells) {
    if (cell.rowSpan === 1 && cell.colSpan === 1) continue
    sheet.mergeCells(
      cell.rowIndex + 1,
      cell.colIndex + 1,
      cell.rowIndex + cell.rowSpan,
      cell.colIndex + cell.colSpan
    )
  }

  return workbook
}

export async function exportReportToExcel(
  model: ReportExportModel,
  fileName: string,
  pageSetup?: ReportPrintPageSetup
) {
  await downloadExcelWorkbook(buildPrintWorkbook(model, pageSetup), fileName)
}
