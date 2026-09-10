/**
 * 报表抬头里的日期整行居中。
 *
 * 润衡原模板的抬头行是「纳税人名称：%U ｜ …… ｜ %yh%mh%dh ｜ …… ｜ 会企01表」，
 * 日期随手放在中间某一列里左对齐，与标题的中线并不对齐；照搬过来后日期看着就偏。
 *
 * 处理成：
 *   1. 与日期同行、位于其左侧的「纳税人名称：xxx」挪到下一行（该行左侧留白时），让整行给公司名；
 *   2. 日期格铺满左右两个有内容邻格之间的全部空列（合并），并打上 align-row-center，
 *      由前端网格 / 打印按整张报表的横向中线摆放文字（Excel 导出退化为在合并区内居中）。
 * 只处理表格主体之上的抬头行，表体内的日期（如现金流量表的期间列）不动。
 */

export interface HeaderLayoutCell {
  rowIndex: number
  colIndex: number
  cellType: string
  textValue: string | null
  formulaText: string | null
  styleKey?: string | null
  mergeInfo?: string | null
}

export interface HeaderDateChange<T extends HeaderLayoutCell> {
  cell: T
  rowIndex: number
  colIndex: number
  mergeInfo: string | null
  styleKey: string | null
  /** 被挪位 / 合并盖住的空格子，落库时应删除 */
  removed: T[]
}

/** 润衡日期占位符（大小写不限）或已填死的「2025年12月31日」字面文本 */
const HEADER_DATE_RE = /%[ymd]h\b|%[ymd]h%|\d{4}\s*年\s*\d{1,2}\s*月(\s*\d{1,2}\s*日)?/i

export function isHeaderDateText(text: string | null | undefined) {
  const value = String(text || '').trim()
  if (!value) return false
  // 「单位：元」「2025年度」之类不算；要么含占位符，要么是完整的年月（日）
  return HEADER_DATE_RE.test(value)
}

function hasContent(cell: HeaderLayoutCell) {
  return Boolean((cell.textValue && cell.textValue.trim()) || cell.formulaText)
}

function parseColSpan(mergeInfo: string | null | undefined) {
  if (!mergeInfo) return 1
  try {
    return Math.max(1, Number(JSON.parse(mergeInfo)?.colSpan) || 1)
  } catch {
    return 1
  }
}

function styleKeyHasBorder(styleKey: string | null | undefined) {
  return /\bborder-(all|outer|header|top|bottom|left|right)\b/.test(styleKey || '')
}

export function withRowCenter(styleKey: string | null | undefined) {
  const tokens = String(styleKey || '')
    .split(/\s+/)
    .filter(token => token && !token.startsWith('align-'))
  return ['align-row-center', ...tokens].join(' ')
}

/**
 * 表格主体的起始行：第一行出现带边框格子的行。抬头行在它之上。
 * 没有任何边框信息时返回 null，此时不处理（无法区分抬头与表体）。
 */
export function resolveTableFirstRow(cells: HeaderLayoutCell[]) {
  let firstRow: number | null = null
  for (const cell of cells) {
    if (!styleKeyHasBorder(cell.styleKey)) continue
    if (firstRow === null || cell.rowIndex < firstRow) firstRow = cell.rowIndex
  }
  return firstRow
}

export function collectHeaderDateChanges<T extends HeaderLayoutCell>(cells: T[]): HeaderDateChange<T>[] {
  const firstTableRow = resolveTableFirstRow(cells)
  if (firstTableRow === null) return []

  const lastCol = cells.reduce((max, cell) => Math.max(max, cell.colIndex), 0)
  const byRow = new Map<number, T[]>()
  for (const cell of cells) {
    if (cell.rowIndex >= firstTableRow) continue
    const list = byRow.get(cell.rowIndex)
    if (list) list.push(cell)
    else byRow.set(cell.rowIndex, [cell])
  }

  const changes: HeaderDateChange<T>[] = []
  for (const list of byRow.values()) {
    list.sort((a, b) => a.colIndex - b.colIndex)
    const date = list.find(
      cell => cell.cellType === 'text' && !cell.formulaText && isHeaderDateText(cell.textValue)
    )
    if (!date) continue

    // 左邻：最近的有内容格，算上它自身的合并宽度；右邻：最近的有内容格
    let spanStart = 0
    let spanEnd = lastCol
    const leftCells: T[] = []
    for (const cell of list) {
      if (cell === date || !hasContent(cell)) continue
      const cellEnd = cell.colIndex + parseColSpan(cell.mergeInfo) - 1
      if (cellEnd < date.colIndex) {
        spanStart = Math.max(spanStart, cellEnd + 1)
        leftCells.push(cell)
      } else if (cell.colIndex > date.colIndex) {
        spanEnd = Math.min(spanEnd, cell.colIndex - 1)
      }
    }
    if (spanStart > spanEnd) continue

    // 「纳税人名称：xxx」与日期同行时只能挤在日期左边那一小段里，公司名稍长就得截断或折行。
    // 下一行（「单位：元」那行）左侧通常整段留白，把名称挪下去就能铺满整行。
    const label = leftCells.length === 1 ? leftCells[0] : null
    const nextRow = date.rowIndex + 1
    if (label && label.cellType === 'text' && !label.formulaText && nextRow < firstTableRow) {
      const below = byRow.get(nextRow) || []
      const labelEnd = label.colIndex + parseColSpan(label.mergeInfo) - 1
      const blocked = below.some(cell => hasContent(cell) && cell.colIndex <= spanEnd)
      if (!blocked) {
        const removed = below.filter(
          cell => !hasContent(cell) && cell.colIndex >= label.colIndex && cell.colIndex <= labelEnd
        )
        changes.push({
          cell: label,
          rowIndex: nextRow,
          colIndex: label.colIndex,
          mergeInfo: label.mergeInfo ?? null,
          styleKey: label.styleKey ?? null,
          removed,
        })
        // 名称让出来后，日期可以从行首铺起
        spanStart = Math.min(spanStart, label.colIndex)
      }
    }

    const colSpan = spanEnd - spanStart + 1
    const mergeInfo = colSpan > 1 ? JSON.stringify({ rowSpan: 1, colSpan }) : null
    const styleKey = withRowCenter(date.styleKey)
    const removed = list.filter(
      cell =>
        cell !== date &&
        !hasContent(cell) &&
        cell.colIndex >= spanStart &&
        cell.colIndex <= spanEnd
    )

    const unchanged =
      date.colIndex === spanStart &&
      (date.mergeInfo || null) === mergeInfo &&
      (date.styleKey || '') === styleKey &&
      removed.length === 0
    if (unchanged) continue

    changes.push({ cell: date, rowIndex: date.rowIndex, colIndex: spanStart, mergeInfo, styleKey, removed })
  }
  return changes
}

/** 就地应用到导入解析出的单元格，返回新数组（被盖住的空格已剔除） */
export function centerHeaderDates<T extends HeaderLayoutCell>(cells: T[]): T[] {
  const changes = collectHeaderDateChanges(cells)
  if (!changes.length) return cells
  const removed = new Set<T>()
  for (const change of changes) {
    change.cell.rowIndex = change.rowIndex
    change.cell.colIndex = change.colIndex
    change.cell.mergeInfo = change.mergeInfo
    change.cell.styleKey = change.styleKey
    for (const cell of change.removed) removed.add(cell)
  }
  return cells.filter(cell => !removed.has(cell))
}
