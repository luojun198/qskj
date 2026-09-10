/**
 * 让金额格的加粗跟随它所属的项目名称。
 *
 * 润衡原模板里合计行的加粗是逐格手工设的，经常前后不一致：「流动资产合计」只有年初列加粗、
 * 期末列没加粗；「非流动资产合计」两列金额都没加粗；「资产总计」又全部加粗。逐格照搬到
 * 我们的报表里就显得忽粗忽细。这里按「项目名称加粗 → 该项目的金额一并加粗」归一化。
 *
 * 只加不减：金额本来就加粗、而项目名没加粗的格子不动，避免误伤用户手工设的样式。
 * 行次（`=B19+1`、手工敲的序号）不算金额，不跟随加粗。
 */

export interface BoldAlignmentCell {
  rowIndex: number
  colIndex: number
  cellType: string
  textValue: string | null
  formulaText: string | null
  styleKey?: string | null
}

const CELL_REF_RE = /\$?[A-Z]{1,3}\$?\d+/g

/**
 * 金额格的判据：带 @ 取数、调用了函数（SUM 等）、或引用了两个以上单元格（=C40+C20）。
 * 行次公式 `=B19+1` 只有一个引用，排除在外。
 */
export function isAmountLikeFormula(formulaText: string | null | undefined) {
  const source = String(formulaText || '').trim()
  if (!source) return false
  if (source.includes('@')) return true
  if (/[A-Za-z_]+\s*\(/.test(source)) return true
  const refs = source.match(CELL_REF_RE) || []
  return refs.length >= 2
}

function hasBold(styleKey: string | null | undefined) {
  return /\bfont-bold\b/.test(styleKey || '')
}

export function appendBold(styleKey: string | null | undefined) {
  if (hasBold(styleKey)) return styleKey ?? null
  const cleaned = String(styleKey || '').replace(/\s+/g, ' ').trim()
  return cleaned ? `${cleaned} font-bold` : 'font-bold'
}

/**
 * 返回需要补加粗的单元格（已经写好新的 styleKey），不改动入参。
 * 同一行从左到右扫：遇到非空文本格就记住它是否加粗，其右侧的金额格照此处理，
 * 直到下一个非空文本格（资产负债表左右两栏就是这样分开的）。
 */
export function collectBoldAlignments<T extends BoldAlignmentCell>(
  cells: T[]
): Array<{ cell: T; styleKey: string }> {
  const byRow = new Map<number, T[]>()
  for (const cell of cells) {
    const list = byRow.get(cell.rowIndex)
    if (list) list.push(cell)
    else byRow.set(cell.rowIndex, [cell])
  }

  const result: Array<{ cell: T; styleKey: string }> = []
  for (const list of byRow.values()) {
    list.sort((a, b) => a.colIndex - b.colIndex)
    let labelBold = false
    for (const cell of list) {
      const isLabel = cell.cellType === 'text' && !cell.formulaText && (cell.textValue || '').trim()
      if (isLabel) {
        labelBold = hasBold(cell.styleKey)
        continue
      }
      if (!labelBold) continue
      if (!isAmountLikeFormula(cell.formulaText)) continue
      if (hasBold(cell.styleKey)) continue
      result.push({ cell, styleKey: appendBold(cell.styleKey) as string })
    }
  }
  return result
}

/** 就地应用到导入解析出的单元格 */
export function alignBoldWithLabel<T extends BoldAlignmentCell>(cells: T[]): T[] {
  for (const { cell, styleKey } of collectBoldAlignments(cells)) {
    cell.styleKey = styleKey
  }
  return cells
}
