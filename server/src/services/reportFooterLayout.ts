/**
 * 报表表尾签字行的版式归一化。
 *
 * 润衡原模板的签字行「单位负责人：  会计主管：  审核：  制表：」是表格之下的一行自由文字，
 * 不带框线。但导入时 fillTableBorders 是按「最上到最下有边框的行」整块补框的，
 * 只要签字行之下还挂着别的带框内容（「利润表(已执行新金融)」表尾之下有两行
 * 「资产减值损失 / 信用减值损失」的辅助取数格，「利润表(2018停用，季报)」之下是「补充资料」小表），
 * 签字行连同它与下方内容之间的空行就会被一并框起来；签字行整句 40 多个字挤在 A 列里还会折行。
 *
 * 处理成：
 *   1. 签字行所有格子去掉边框 token，补框造出来的空格子直接删掉；
 *   2. 签字行只有一个有内容的格子（整句写在 A 列）时，向右合并到报表最右列，整句一行放下；
 *      「单位负责人:｜会计主管:｜审核:｜制表:」分写在几列里的保持原样，只去框；
 *   3. 签字行下方紧邻的整行空行，同样去框 / 删掉补框空格——它们是表与表之间的留白，不是表格的一部分。
 * 签字行之下的内容（辅助行、补充资料、叠放的第二张报表）一律不动。
 */

export interface FooterLayoutCell {
  rowIndex: number
  colIndex: number
  cellType: string
  textValue: string | null
  formulaText: string | null
  styleKey?: string | null
  mergeInfo?: string | null
}

export interface FooterLayoutUpdate<T extends FooterLayoutCell> {
  cell: T
  styleKey: string | null
  mergeInfo: string | null
}

export interface FooterLayoutResult<T extends FooterLayoutCell> {
  updated: FooterLayoutUpdate<T>[]
  /** 补框造出来的空格子，落库时应删除 */
  removed: T[]
}

/** 签字行的判据：含「xx负责人：/会计主管：/制表：/审核：」之类的落款标签 */
const FOOTER_SIGNATURE_RE =
  /(单位负责人|财务负责人|会计主管|财务主管|主管会计|制表人?|审核人?|复核人?|填表人?)\s*[：:]/

export function isFooterSignatureText(text: string | null | undefined) {
  const value = String(text || '').trim()
  if (!value || value.length > 80) return false
  return FOOTER_SIGNATURE_RE.test(value)
}

function hasContent(cell: FooterLayoutCell) {
  return Boolean((cell.textValue && cell.textValue.trim()) || cell.formulaText)
}

function isSignatureCell(cell: FooterLayoutCell) {
  return cell.cellType === 'text' && !cell.formulaText && isFooterSignatureText(cell.textValue)
}

/** 去掉全部边框相关 token（border-all/outer/…/none、border-color-*、border-width-*） */
export function stripBorderTokens(styleKey: string | null | undefined) {
  const tokens = String(styleKey || '')
    .split(/\s+/)
    .filter(token => token && !token.startsWith('border-'))
  return tokens.length ? tokens.join(' ') : null
}

function parseColSpan(mergeInfo: string | null | undefined) {
  if (!mergeInfo) return 1
  try {
    return Math.max(1, Number(JSON.parse(mergeInfo)?.colSpan) || 1)
  } catch {
    return 1
  }
}

export function collectFooterLayoutChanges<T extends FooterLayoutCell>(cells: T[]): FooterLayoutResult<T> {
  const result: FooterLayoutResult<T> = { updated: [], removed: [] }
  if (!cells.length) return result

  const byRow = new Map<number, T[]>()
  let lastCol = 0
  let lastRow = 0
  for (const cell of cells) {
    if (cell.colIndex > lastCol) lastCol = cell.colIndex
    if (cell.rowIndex > lastRow) lastRow = cell.rowIndex
    const list = byRow.get(cell.rowIndex)
    if (list) list.push(cell)
    else byRow.set(cell.rowIndex, [cell])
  }

  const stripRow = (list: T[]) => {
    for (const cell of list) {
      const styleKey = stripBorderTokens(cell.styleKey)
      if (!hasContent(cell) && !styleKey && !cell.mergeInfo) {
        result.removed.push(cell)
        continue
      }
      if (styleKey !== (cell.styleKey || null)) {
        result.updated.push({ cell, styleKey, mergeInfo: cell.mergeInfo ?? null })
      }
    }
  }

  const signatureRows = [...byRow.keys()]
    .filter(rowIndex => (byRow.get(rowIndex) || []).some(isSignatureCell))
    .sort((a, b) => a - b)

  const handled = new Set<number>()
  for (const rowIndex of signatureRows) {
    const list = (byRow.get(rowIndex) || []).slice().sort((a, b) => a.colIndex - b.colIndex)
    handled.add(rowIndex)

    const filled = list.filter(hasContent)
    const single = filled.length === 1 ? filled[0] : null
    const spanTo = single ? lastCol : -1
    const colSpan = single ? spanTo - single.colIndex + 1 : 1

    for (const cell of list) {
      const styleKey = stripBorderTokens(cell.styleKey)
      if (cell === single && colSpan > 1 && parseColSpan(cell.mergeInfo) < colSpan) {
        result.updated.push({
          cell,
          styleKey,
          mergeInfo: JSON.stringify({ rowSpan: 1, colSpan }),
        })
        continue
      }
      // 整句合并后盖住的空格子一律删掉；分列书写的签字行只删补框空格
      if (!hasContent(cell) && (single || !styleKey)) {
        result.removed.push(cell)
        continue
      }
      if (styleKey !== (cell.styleKey || null)) {
        result.updated.push({ cell, styleKey, mergeInfo: cell.mergeInfo ?? null })
      }
    }

    // 签字行下方紧邻的整行空行：表与表之间的留白，不该带框
    for (let below = rowIndex + 1; below <= lastRow; below += 1) {
      if (handled.has(below)) break
      const rowCells = byRow.get(below)
      if (!rowCells) break
      if (rowCells.some(hasContent)) break
      handled.add(below)
      stripRow(rowCells)
    }
  }

  return result
}

/** 就地应用到导入解析出的单元格，返回新数组（被删的空格已剔除） */
export function normalizeFooterRows<T extends FooterLayoutCell>(cells: T[]): T[] {
  const { updated, removed } = collectFooterLayoutChanges(cells)
  if (!updated.length && !removed.length) return cells
  for (const change of updated) {
    change.cell.styleKey = change.styleKey
    change.cell.mergeInfo = change.mergeInfo
  }
  const gone = new Set(removed)
  return cells.filter(cell => !gone.has(cell))
}
