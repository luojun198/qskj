import type { Database } from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'

import { extractAcdReportTemplates, type AcdSheetLayout } from './acdReportFormulaSync.js'
import { alignBoldWithLabel } from './reportBoldAlignment.js'
import { centerHeaderDates } from './reportHeaderLayout.js'
import { normalizeFooterRows } from './reportFooterLayout.js'

export interface AcdStandardReportCell {
  rowIndex: number
  colIndex: number
  /** number = 数字常量格（vts 的 RK 记录），求值时与公式结果一样参与引用运算 */
  cellType: 'text' | 'formula' | 'number'
  textValue: string | null
  formulaText: string | null
  /** JSON，形如 {"rowSpan":1,"colSpan":8}；导入时为标题行固化跨列合并 */
  mergeInfo?: string | null
  /** 空格分隔的样式 token，与 report_cells.style_key 同约定 */
  styleKey?: string | null
  /** 原报表用跨列居中实现的跨列标题，导入时换算成跨列合并 */
  centerAcross?: boolean
}

export interface PreparedAcdStandardReport {
  code: string
  name: string
  sourceFile: string
  sortOrder: number
  /** 按内容估算的列宽（px），落到 rh_standard_reports.col_widths */
  colWidths?: number[]
  /** 按该行最大字号推算的行高（px），落到 rh_standard_reports.row_heights */
  rowHeights?: number[]
  cells: AcdStandardReportCell[]
}

export interface AcdStandardReportSummary {
  code: string
  name: string
  source_file: string
}

export interface ImportedAcdStandardReport {
  id: string
  code: string
  name: string
}

export interface AcdStandardReportPreview {
  reports: AcdStandardReportSummary[]
  warnings: string[]
  prepared: PreparedAcdStandardReport[]
}

export class AcdStandardReportImportError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AcdStandardReportImportError'
  }
}

/**
 * 同一格的取值优先级：@ 取数公式 > = 表达式 > 纯文本，同级取先出现的那条。
 *
 * vts 里一格可能同时有润衡的 @ 取数公式（文本记录）和 Excel 侧的 = 表达式（编译记录），
 * 例如合计行既能 @JQY 取数、又能 SUM 上方各行。@ 公式是账务口径的权威来源，
 * 必须压过 =，否则重新导入会把已经在用的取数公式换成单元格求和。
 */
function cellPriority(cell: AcdStandardReportCell) {
  if (cell.cellType !== 'formula') return 0
  return String(cell.formulaText || '').trimStart().startsWith('@') ? 2 : 1
}

export function deduplicateStandardReportCells(cells: AcdStandardReportCell[]) {
  const cellMap = new Map<string, AcdStandardReportCell>()
  for (const cell of cells) {
    if (cell.rowIndex < 0 || cell.colIndex < 0) continue
    const key = `${cell.rowIndex}_${cell.colIndex}`
    const existing = cellMap.get(key)
    if (!existing || cellPriority(cell) > cellPriority(existing)) {
      cellMap.set(key, cell)
    }
  }
  return Array.from(cellMap.values())
}

/**
 * 从一个 .vts 解析出的多个 sheet 中挑出要落库的那个。
 *
 * 一个 .vts 里通常存着同一张报表的多个版本：带 %U/%yh 占位符和 @ 取数公式的「模板版」，
 * 以及公司名/日期已填死、不含公式的「数据快照版」。旧实现固定取第一个非空 sheet，
 * 碰上快照版排在前面时公式会全部丢失（如「资产负债表（老格式）」整页无公式）。
 *
 * 但 parseVtsSheets 的切分并不总是干净——某些 sheet 会把两个版本粘在一起（如「利润表（季报）」
 * 的 col>=8 区其实是另一版按「本季数/本年累计数」取数的表）。若无条件改取「公式最多」的 sheet，
 * 会给本来正常的报表引入杂质列。因此这里采取保守策略：
 *
 *   1. 第一个非空 sheet 只要**已有公式**，就沿用它（保持既有行为不变，零风险）；
 *   2. 只有当它**一个公式都没有**时，才退而去找公式最多的 sheet（专门救那批整页空白的报表）。
 */
function countAnchorFormulas(cells: AcdStandardReportCell[]) {
  return cells.filter(cell => String(cell.formulaText || '').trimStart().startsWith('@')).length
}

function countFormulas(cells: AcdStandardReportCell[]) {
  return cells.filter(cell => cell.formulaText).length
}

/**
 * 模板版的表头带润衡占位符（`纳税人名称：%U`、`%YH年`、`%yh%mh%dh`……），
 * 数据快照版则把公司名/日期填成了字面文本。这是区分两者最直接的特征。
 */
const TEMPLATE_PLACEHOLDER_RE = /%[A-Za-z]/

function hasTemplatePlaceholder(cells: AcdStandardReportCell[]) {
  return cells.some(cell => cell.cellType === 'text' && TEMPLATE_PLACEHOLDER_RE.test(cell.textValue || ''))
}

export function pickTemplateSheet<T extends { index: number; cells: AcdStandardReportCell[] }>(
  sheets: T[]
): { sheet: T | undefined; recovered: boolean } {
  const nonEmpty = sheets.filter(item => item.cells.length > 0)
  const first = nonEmpty[0]
  if (!first) {
    return { sheet: undefined, recovered: false }
  }

  // 判据必须是 @ 取数公式：行次的 =B19+1、合计的 =SUM(...) 在「数据快照版」里同样存在，
  // 拿「有没有公式」去判会把快照版当成模板版，结果整列取数公式丢失。
  // 若整个 vts 一条 @ 公式都没有（纯计算表），退回按公式总数计分，保持原有行为。
  const score = nonEmpty.some(item => countAnchorFormulas(item.cells) > 0)
    ? countAnchorFormulas
    : countFormulas

  // 快照版并非一定「零 @ 公式」：「利润表(已执行新金融、收入准则)」的快照版在表尾之下
  // 还挂着两行辅助格（资产减值损失 @JQY(6701,…)），只凭「第一个有 @ 公式的 sheet」会把它
  // 当成模板版——正文 22 条取数公式全部丢失，页尾还多出「资产减值损失 1 / 信用减值损失 2」。
  // 因此先找「表头带占位符 且 有取数公式」的 sheet；第一个 sheet 自身满足时行为与从前一致。
  const templated = nonEmpty.find(item => hasTemplatePlaceholder(item.cells) && score(item.cells) > 0)
  if (templated) {
    return { sheet: templated, recovered: templated !== first }
  }

  if (score(first.cells) > 0) {
    return { sheet: first, recovered: false }
  }

  const best = nonEmpty
    .slice()
    .sort(
      (left, right) =>
        score(right.cells) - score(left.cells) ||
        right.cells.length - left.cells.length ||
        left.index - right.index
    )[0]

  return score(best.cells) > 0 ? { sheet: best, recovered: true } : { sheet: first, recovered: false }
}

/** 认定「正文已结束」所需的连续空行/空列数 */
const DETACHED_BLOCK_GAP = 3

/**
 * 裁掉与正文脱节的「孤岛」内容。
 *
 * 仅用于 pickTemplateSheet 走了 recovered 分支的报表：那些 sheet 是切分不干净的产物，
 * 正文之后往往隔着一大片空白，再散落几格另一版报表的残留。以「资产负债表（老格式）」为例，
 * 正文是 42 行 x 8 列，其后隔着 8 个空列、7 个空行才出现 col 16/21/24 上的零星碎片，
 * 前端据此把网格撑到 57 行 x 25 列，页面出现大片空白和重复的「单位负责人」行。
 *
 * 做法：行、列各自从 0 扫起，遇到连续 DETACHED_BLOCK_GAP 个全空的行/列即认定正文到此为止，
 * 丢弃其后的全部内容。阈值取 3 是为了容忍报表内部正常的单行/双行留白
 * （如「企业所得税申报表」正文中就有单个空行），实测不会伤及正文与公式。
 */
export function trimDetachedBlocks(
  cells: AcdStandardReportCell[],
  gap: number = DETACHED_BLOCK_GAP
): AcdStandardReportCell[] {
  if (cells.length === 0) {
    return cells
  }

  const rowUsed: boolean[] = []
  const colUsed: boolean[] = []
  let maxRow = 0
  let maxCol = 0
  for (const cell of cells) {
    rowUsed[cell.rowIndex] = true
    colUsed[cell.colIndex] = true
    if (cell.rowIndex > maxRow) maxRow = cell.rowIndex
    if (cell.colIndex > maxCol) maxCol = cell.colIndex
  }

  const findBoundary = (used: boolean[], max: number) => {
    let run = 0
    for (let index = 0; index <= max; index += 1) {
      if (used[index]) {
        run = 0
        continue
      }
      run += 1
      if (run >= gap) {
        return index - gap + 1
      }
    }
    return max + 1
  }

  const rowLimit = findBoundary(rowUsed, maxRow)
  const colLimit = findBoundary(colUsed, maxCol)

  return cells.filter(cell => cell.rowIndex < rowLimit && cell.colIndex < colLimit)
}

/**
 * 把公式版裁到呈现版的行列范围内。
 *
 * vts 的第一个 sheet 是原软件实际展示的「呈现版」（带 COLINFO/ROW 版面），后面的 @ 公式版
 * 往往在正文右侧/下方挂着辅助列、辅助行（如「利润表（季报）」公式版的 c11~c24、
 * 「利润表（分12个月）」公式版的 r23~r39 是另一套取数口径），原软件里这些是看不见的。
 * 当选中的不是呈现版时，凡超出呈现版最大行/列的格子一律不要——这比「连续 N 个空行/列才截断」
 * 的猜测准确：辅助区与正文之间常常只隔 1 列、甚至紧挨着。
 */
export function clipToDisplayBounds(
  cells: AcdStandardReportCell[],
  displayCells: AcdStandardReportCell[]
): AcdStandardReportCell[] {
  const filled = displayCells.filter(cell => cell.textValue || cell.formulaText)
  if (!filled.length) return cells
  const maxRow = Math.max(...filled.map(cell => cell.rowIndex))
  const maxCol = Math.max(...filled.map(cell => cell.colIndex))
  return cells.filter(cell => cell.rowIndex <= maxRow && cell.colIndex <= maxCol)
}

const MIN_COL_WIDTH = 60
const MAX_COL_WIDTH = 360
/** 一个半角字符的估算宽度（px），中文按两倍计 */
const CHAR_WIDTH = 8
const COL_PADDING = 18

/**
 * 按内容估算每一列的宽度。
 *
 * vts 里的列宽记录读不出来——记录链在文件中段会 desync，只有前部的格式表能可靠取到
 * （详见 acdReportFormulaSync.parseXfTable 的说明）。所以这里退而求其次按内容估算，
 * 让「项目」这种长文本列宽一些、「行次」这种窄一些，至少排版是合理的，
 * 总比所有列一律 120px 强。用户仍可在编辑器里拖动调整，调整后会覆盖这里的估算值。
 */
export function estimateColumnWidths(cells: AcdStandardReportCell[]): number[] {
  const bounds = resolveTableBounds(cells)
  const lastCol = bounds
    ? bounds.lastCol
    : cells.reduce((max, cell) => Math.max(max, cell.colIndex), 0)

  const widths: number[] = []
  for (let col = 0; col <= lastCol; col += 1) {
    let maxLen = 4
    for (const cell of cells) {
      if (cell.colIndex !== col) continue
      // 用公式原文估宽会过宽（@JQY(6001,97,99) 比取数结果长得多），故只看文本
      const text = cell.textValue || ''
      if (!text) continue
      let len = 0
      for (const char of text) len += /[\u4e00-\u9fa5\uff00-\uffef]/.test(char) ? 2 : 1
      if (len > maxLen) maxLen = len
    }
    widths.push(Math.min(MAX_COL_WIDTH, Math.max(MIN_COL_WIDTH, maxLen * CHAR_WIDTH + COL_PADDING)))
  }
  return widths
}

const MIN_ROW_HEIGHT = 24
const MAX_ROW_HEIGHT = 96
/** 行高 = 字号 x 该系数，留出上下边距 */
const ROW_HEIGHT_RATIO = 1.6

/**
 * 按每行最大字号推算行高。
 *
 * vts 的行高记录与列宽一样读不出来（记录链中段 desync），但字号已经能从字体表还原，
 * 而行高本来就该跟着字号走——标题行 24pt 的字挤在 24px 行里会被截断。
 * 用户拖动调整后会覆盖这里的推算值。
 */
export function estimateRowHeights(cells: AcdStandardReportCell[]): number[] {
  const maxRow = cells.reduce((max, cell) => Math.max(max, cell.rowIndex), 0)
  const heights: number[] = []
  for (let row = 0; row <= maxRow; row += 1) {
    let maxFontPx = 0
    for (const cell of cells) {
      if (cell.rowIndex !== row) continue
      const matched = /font-size-(\d+)/.exec(cell.styleKey || '')
      if (matched) {
        const size = Number(matched[1])
        if (size > maxFontPx) maxFontPx = size
      }
    }
    heights.push(
      maxFontPx
        ? Math.min(MAX_ROW_HEIGHT, Math.max(MIN_ROW_HEIGHT, Math.round(maxFontPx * ROW_HEIGHT_RATIO)))
        : MIN_ROW_HEIGHT
    )
  }
  return heights
}

/**
 * vts 给出的列宽允许越过估算的上下限——行次列原版只有 3.4 个字符宽，利润表的项目列则有 56 个字符宽，
 * 都是原报表的真实版面；只拦住明显不合理的极端值。
 */
const MIN_ACD_COL_WIDTH = 24
const MAX_ACD_COL_WIDTH = 720
/** 单元格左右内边距合计（与前端 .cell 的 padding 2px 6px 对应） */
const CELL_PADDING_X = 12
/** 单元格上下内边距 + 边框 */
const CELL_PADDING_Y = 6
/** 一行文字占用高度 = 字号 x 该系数 */
const LINE_HEIGHT_RATIO = 1.35
/** 自动换行最多算到几行，防止极端长文本把行撑到离谱 */
const MAX_WRAP_LINES = 4
const DEFAULT_FONT_PX = 13

/**
 * 列宽：优先用 vts 的 COLINFO 记录（原报表的真实版面），没记录的列退回按内容估算。
 */
export function resolveColumnWidths(cells: AcdStandardReportCell[], layout?: AcdSheetLayout): number[] {
  const estimated = estimateColumnWidths(cells)
  if (!layout) return estimated
  return estimated.map((width, col) => {
    const fromAcd = layout.colWidthsPx[col]
    if (fromAcd === undefined) return width
    return Math.min(MAX_ACD_COL_WIDTH, Math.max(MIN_ACD_COL_WIDTH, fromAcd))
  })
}

function fontPxOf(styleKey: string | null | undefined) {
  const matched = /font-size-(\d+)/.exec(styleKey || '')
  return matched ? Number(matched[1]) : DEFAULT_FONT_PX
}

/** 估算一段文字的渲染宽度（px）：中文按一个字号宽、其余按 0.6 字号 */
function estimateTextWidth(text: string, fontPx: number) {
  let width = 0
  for (const char of text) width += /[\u4e00-\u9fa5\uff00-\uffef]/.test(char) ? fontPx : fontPx * 0.6
  return width
}

function parseColSpan(cell: AcdStandardReportCell) {
  if (!cell.mergeInfo) return 1
  try {
    return Math.max(1, Number(JSON.parse(cell.mergeInfo)?.colSpan) || 1)
  } catch {
    return 1
  }
}

/**
 * 行高：优先用 vts 的 ROW 记录，没记录的行退回按字号推算；再按「自动换行」把行撑高——
 * 文本按所在列宽折行后需要几行，就至少给几行的高度，标题、项目名折成两行才不会被行高截掉。
 *
 * 原报表也是这么呈现的：表头行 49px 正是「行次」在 3.4 字符宽的列里折成两行的结果。
 */
export function resolveRowHeights(
  cells: AcdStandardReportCell[],
  colWidths: number[],
  layout?: AcdSheetLayout
): number[] {
  const estimated = estimateRowHeights(cells)
  const heights = estimated.map((height, row) => {
    const fromAcd = layout?.rowHeightsPx[row]
    return fromAcd === undefined ? height : Math.max(MIN_ROW_HEIGHT / 2, fromAcd)
  })

  for (const cell of cells) {
    if (cell.rowIndex >= heights.length) continue
    const fontPx = fontPxOf(cell.styleKey)
    let lines = 1
    const text = cell.cellType === 'text' ? cell.textValue || '' : ''
    if (text) {
      const span = parseColSpan(cell)
      let available = 0
      for (let col = cell.colIndex; col < cell.colIndex + span; col += 1) {
        available += colWidths[col] ?? colWidths[colWidths.length - 1] ?? 0
      }
      available = Math.max(1, available - CELL_PADDING_X)
      lines = Math.min(MAX_WRAP_LINES, Math.max(1, Math.ceil(estimateTextWidth(text, fontPx) / available)))
    }
    const needed = Math.round(lines * fontPx * LINE_HEIGHT_RATIO + CELL_PADDING_Y)
    if (needed > heights[cell.rowIndex]) heights[cell.rowIndex] = Math.min(MAX_ROW_HEIGHT * 2, needed)
  }
  return heights
}

/** 认定「表格主体到此为止」所需的连续空列数 */
const TABLE_COL_GAP = 2

/**
 * 给表格区域内缺失的位置补上带边框的空单元格。
 *
 * vts 里**不存空白格**——表格中没填内容的格子（如「行次」列的正文、合计行的金额列）
 * 压根没有记录。于是导入后这些位置既没有单元格也没有边框，表格看起来到处是断口。
 *
 * 做法：以「带边框的单元格」圈出表格主体的矩形范围（列从 0 起算，遇到连续
 * TABLE_COL_GAP 个没有边框的列即认定表格到此为止，避免把远处另一版报表的残留算进来），
 * 再把该矩形内缺失的坐标补成空的带框格子；已有格子若完全没有边框 token，
 * 补上 border-all 并保留对齐/字体，避免项目名列「有格没框」、打印时只剩数字列的孤立方框。
 */
/**
 * 依据带边框的单元格圈出表格主体的矩形范围。
 * 列从 0 起算，遇到连续 TABLE_COL_GAP 个没有边框的列即认定表格到此为止——
 * 这样远处另一版报表的残留（如「利润表（季报）」在 col 12/20 上的另一版）不会被算进来。
 */
export function resolveTableBounds(cells: AcdStandardReportCell[]) {
  const bordered = cells.filter(cell => cell.styleKey?.includes('border-all'))
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
 * 把「跨列居中」换算成跨列合并。
 *
 * 老报表的跨列标题（「资 产 负 债 表」「利 润 表」）不是合并单元格，而是 XF 的
 * center across selection 对齐（水平对齐取值 6）。数据里不存跨几列，按其本来的语义推断：
 * 一直跨到该行下一个有内容的格子之前，最远到表格右边界。
 *
 * 这比早先「文字去空格后等于报表名」的猜测可靠得多——那个判定 15 张报表里只命中 6 张，
 * 「资产负债表（老格式）」这类带后缀的版本名一律对不上。
 */
export function applyCenterAcross(cells: AcdStandardReportCell[]): AcdStandardReportCell[] {
  const bounds = resolveTableBounds(cells)
  if (!bounds) return cells

  const byRow = new Map<number, AcdStandardReportCell[]>()
  for (const cell of cells) {
    const list = byRow.get(cell.rowIndex)
    if (list) list.push(cell)
    else byRow.set(cell.rowIndex, [cell])
  }

  for (const cell of cells) {
    if (!cell.centerAcross) continue
    if (cell.mergeInfo) continue
    if (cell.colIndex > bounds.lastCol) continue
    // 只有文本才会「跨列居中」（标题、日期）。现金流量表「二、投资活动产生的现金流量：」
    // 这类小节行的行次 `=B15+1` 也套了居中格式，右侧金额格恰好为空，若照样跨过去，
    // 行次 11 就会跑到「本期金额」列中央；数值/公式格的位置就是它所在的列，不做跨列。
    if (cell.cellType !== 'text' || cell.formulaText) continue

    // 右侧第一个「有内容」的格子；补边框造出来的空格子不算内容
    const nextFilled = (byRow.get(cell.rowIndex) || [])
      .filter(
        item =>
          item.colIndex > cell.colIndex &&
          ((item.textValue && item.textValue.length > 0) || item.formulaText)
      )
      .map(item => item.colIndex)
      .sort((a, b) => a - b)[0]

    const end = Math.min(
      nextFilled === undefined ? bounds.lastCol + 1 : nextFilled,
      bounds.lastCol + 1
    )
    const colSpan = Math.max(1, end - cell.colIndex)
    if (colSpan <= 1) continue

    cell.mergeInfo = JSON.stringify({ rowSpan: 1, colSpan })
  }

  return cells
}

const BORDER_SIDE_RE = /\bborder-(all|outer|header|top|bottom|left|right)\b/

function styleKeyHasBorder(styleKey: string | null | undefined) {
  return BORDER_SIDE_RE.test(styleKey || '')
}

function appendBorderAll(styleKey: string | null | undefined) {
  if (styleKeyHasBorder(styleKey)) return styleKey ?? null
  const cleaned = String(styleKey || '')
    .replace(/\bborder-none\b/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned ? `${cleaned} border-all` : 'border-all'
}

export function fillTableBorders(cells: AcdStandardReportCell[]): AcdStandardReportCell[] {
  const bounds = resolveTableBounds(cells)
  if (!bounds) return cells
  const { lastCol, firstRow, lastRow } = bounds

  const existing = new Set(cells.map(cell => `${cell.rowIndex}_${cell.colIndex}`))
  const filled = cells.map(cell => {
    if (cell.rowIndex < firstRow || cell.rowIndex > lastRow || cell.colIndex > lastCol) return cell
    if (styleKeyHasBorder(cell.styleKey)) return cell
    return { ...cell, styleKey: appendBorderAll(cell.styleKey) }
  })
  for (let row = firstRow; row <= lastRow; row += 1) {
    for (let col = 0; col <= lastCol; col += 1) {
      const key = `${row}_${col}`
      if (existing.has(key)) continue
      filled.push({
        rowIndex: row,
        colIndex: col,
        cellType: 'text',
        textValue: null,
        formulaText: null,
        styleKey: 'border-all',
      })
    }
  }
  return filled
}

/** 与前端 normalizeTitle、迁移 106 保持一致：去掉半角与全角空白 */
function normalizeReportTitle(value: string | null | undefined) {
  return (value || '').replace(/[\s\u3000]/g, '')
}

const TITLE_STYLE_KEY = 'align-center font-size-18 font-bold'

/**
 * 给标题行固化跨列合并。
 *
 * 判定与前端旧的 titleRowIndex 一致：该行只有一个无公式单元格，且文字去空格后等于报表名。
 * 不这样做的话，每次重新导入 ACD 都会把迁移固化好的合并冲掉，标题又变回左对齐的小字。
 */
export function applyTitleMerge(cells: AcdStandardReportCell[], reportName: string) {
  const target = normalizeReportTitle(reportName)
  if (!target || !cells.length) return cells

  const byRow = new Map<number, { count: number; first: AcdStandardReportCell }>()
  let maxCol = 0
  for (const cell of cells) {
    if (cell.colIndex > maxCol) maxCol = cell.colIndex
    const entry = byRow.get(cell.rowIndex)
    if (entry) entry.count += 1
    else byRow.set(cell.rowIndex, { count: 1, first: cell })
  }

  const colSpan = maxCol + 1
  if (colSpan <= 1) return cells

  for (const [, entry] of byRow) {
    if (entry.count !== 1) continue
    if (entry.first.formulaText) continue
    if (normalizeReportTitle(entry.first.textValue) !== target) continue
    // center-across 已经给出跨列合并时不再覆盖
    if (entry.first.mergeInfo) break
    entry.first.mergeInfo = JSON.stringify({ rowSpan: 1, colSpan })
    // 与 vts 还原出的样式合并。注意**不要覆盖已还原的字号与字体**——
    // 原报表标题往往是 24pt(32px)，硬套 TITLE_STYLE_KEY 的 18px 反而把真实字号改小了。
    // 只在字体表没读出字号时，才用兜底的居中放大。
    const existing = (entry.first.styleKey || '').split(/\s+/).filter(Boolean)
    const hasFontSize = existing.some(token => token.startsWith('font-size-'))
    const kept = existing.filter(token => !token.startsWith('align-'))
    entry.first.styleKey = hasFontSize
      ? ['align-center', ...kept].join(' ')
      : [TITLE_STYLE_KEY, ...kept.filter(token => !token.startsWith('font-'))].join(' ')
    break
  }

  return cells
}

export function previewAcdStandardReports(acdBuffer: Buffer): AcdStandardReportPreview {
  let extracted: ReturnType<typeof extractAcdReportTemplates>
  try {
    extracted = extractAcdReportTemplates(acdBuffer)
  } catch (error) {
    throw new AcdStandardReportImportError(
      `ACD 标准报表解析失败: ${error instanceof Error ? error.message : String(error)}`
    )
  }
  const { templates, warnings: parserWarnings } = extracted
  const warnings = [...parserWarnings]
  const prepared: PreparedAcdStandardReport[] = []
  const seenCodes = new Set<string>()

  templates.forEach((template, templateIndex) => {
    const code = String(template.reportCode || '').trim()
    if (!code || seenCodes.has(code)) {
      if (code) warnings.push(`跳过重复报表编码: ${code}`)
      return
    }

    const { sheet, recovered } = pickTemplateSheet(template.sheets)
    // 只对「被救回来」的报表裁边：先按呈现版（第一个非空 sheet）的行列范围裁掉公式版的辅助区，
    // 再裁孤岛；本来就选中呈现版的报表一格都不动
    const displaySheet = template.sheets.find(item => item.cells.length > 0)
    const sheetCells = sheet
      ? recovered
        ? trimDetachedBlocks(displaySheet ? clipToDisplayBounds(sheet.cells, displaySheet.cells) : sheet.cells)
        : sheet.cells
      : []
    // 补框之后紧接着把签字行从表格里摘出来：去框、整句合并、删掉补出来的空格
    const normalized = alignBoldWithLabel(
      applyCenterAcross(normalizeFooterRows(fillTableBorders(deduplicateStandardReportCells(sheetCells))))
    )
    if (normalized.length === 0) {
      warnings.push(`跳过空报表模板: ${template.reportName} (${template.sourceFile})`)
      return
    }

    applyTitleMerge(normalized, template.reportName)
    const cells = centerHeaderDates(normalized)
    const colWidths = resolveColumnWidths(cells, template.layout)

    seenCodes.add(code)
    prepared.push({
      code,
      name: template.reportName,
      sourceFile: template.sourceFile,
      // bbml.xh（即 code）才是原软件的报表呈现顺序，bbml.txt 的物理行序与之无关。
      // 用 code 作排序键，选择性重新导入时也不会让未选中报表的顺序漂移。
      sortOrder: Number.parseInt(code, 10) || templateIndex,
      cells,
      colWidths,
      rowHeights: resolveRowHeights(cells, colWidths, template.layout),
    })
  })

  return {
    reports: prepared.map(report => ({
      code: report.code,
      name: report.name,
      source_file: report.sourceFile,
    })),
    warnings,
    prepared,
  }
}

export function persistPreparedAcdStandardReports(
  db: Database,
  accountSetId: string,
  prepared: PreparedAcdStandardReport[],
  reportCodes?: string[]
): ImportedAcdStandardReport[] {
  const availableByCode = new Map(prepared.map(report => [report.code, report]))
  const selectedCodes = reportCodes?.map(code => String(code).trim()).filter(Boolean)
  const requestedCodes = selectedCodes?.length ? selectedCodes : prepared.map(report => report.code)

  if (selectedCodes) {
    const uniqueCodes = new Set(selectedCodes)
    if (uniqueCodes.size !== selectedCodes.length) {
      throw new AcdStandardReportImportError('选择的报表编码不能重复')
    }
    const invalidCodes = selectedCodes.filter(code => !availableByCode.has(code))
    if (invalidCodes.length > 0) {
      throw new AcdStandardReportImportError(`ACD 中不存在所选报表: ${invalidCodes.join('、')}`)
    }
  }

  const selectedReports = requestedCodes
    .map(code => availableByCode.get(code))
    .filter((report): report is PreparedAcdStandardReport => !!report)

  if (selectedReports.length === 0) {
    throw new AcdStandardReportImportError('没有可导入的标准报表')
  }

  const existingStmt = db.prepare(
    'SELECT id FROM rh_standard_reports WHERE account_set_id = ? AND code = ?'
  )
  const insertReport = db.prepare(
    `INSERT INTO rh_standard_reports
      (id, account_set_id, code, name, source_file, sort_order, col_widths, row_heights, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
  )
  const updateReport = db.prepare(
    `UPDATE rh_standard_reports
     SET name = ?, source_file = ?, sort_order = ?, col_widths = ?, row_heights = ?, updated_at = datetime('now')
     WHERE id = ? AND account_set_id = ?`
  )
  const deleteCells = db.prepare('DELETE FROM rh_standard_report_cells WHERE report_id = ?')
  const insertCell = db.prepare(
    `INSERT INTO rh_standard_report_cells
      (id, report_id, row_index, col_index, text_value, formula_text,
       cell_type, merge_info, style_key, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
  )

  return db.transaction(() => {
    const imported: ImportedAcdStandardReport[] = []
    for (const report of selectedReports) {
      const existing = existingStmt.get(accountSetId, report.code) as { id: string } | undefined
      const reportId = existing?.id || uuidv4()

      if (existing) {
        deleteCells.run(reportId)
        updateReport.run(
          report.name,
          report.sourceFile,
          report.sortOrder,
          report.colWidths?.length ? JSON.stringify(report.colWidths) : null,
          report.rowHeights?.length ? JSON.stringify(report.rowHeights) : null,
          reportId,
          accountSetId
        )
      } else {
        insertReport.run(
          reportId,
          accountSetId,
          report.code,
          report.name,
          report.sourceFile,
          report.sortOrder,
          report.colWidths?.length ? JSON.stringify(report.colWidths) : null,
          report.rowHeights?.length ? JSON.stringify(report.rowHeights) : null
        )
      }

      for (const cell of report.cells) {
        insertCell.run(
          uuidv4(),
          reportId,
          cell.rowIndex,
          cell.colIndex,
          cell.textValue,
          cell.formulaText,
          cell.cellType || (cell.formulaText ? 'formula' : 'text'),
          cell.mergeInfo ?? null,
          cell.styleKey ?? null
        )
      }

      imported.push({ id: reportId, code: report.code, name: report.name })
    }
    return imported
  })()
}

export function importAcdStandardReports(
  db: Database,
  accountSetId: string,
  acdBuffer: Buffer,
  reportCodes?: string[]
) {
  const preview = previewAcdStandardReports(acdBuffer)
  if (preview.prepared.length === 0) {
    if (reportCodes?.length) {
      throw new AcdStandardReportImportError(
        preview.warnings[0] || 'ACD 中没有可导入的标准报表'
      )
    }
    return { reports: [] as ImportedAcdStandardReport[], warnings: preview.warnings }
  }

  const reports = persistPreparedAcdStandardReports(
    db,
    accountSetId,
    preview.prepared,
    reportCodes
  )
  return { reports, warnings: preview.warnings }
}
