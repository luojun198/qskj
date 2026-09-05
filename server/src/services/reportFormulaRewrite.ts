/**
 * 插入/删除行列后，重写报表公式里的单元格引用。
 *
 * 背景：报表模板支持两类公式，混在同一个表达式里，例如
 *   `@ye(1001,99)+ye(1002,99)`   —— 取数函数，括号里是**科目号与期间**，不是单元格引用
 *   `=B5+B6`、`=SUM(A1:A3)`      —— 单元格引用，插删行列后必须跟着平移
 *
 * 因此不能对整条公式无脑做正则替换：`@ye(1001,99)` 里的 `1001` 一旦被当成引用改写，
 * 取数科目就被改错了，而且错得很隐蔽（照样能算出一个数）。
 * 这里的做法是先标出取数函数的参数区间加以保护，只重写落在保护区之外的引用。
 */
import { ANCHOR_FUNCTION_NAMES } from './reportFormula.js'


export const REF_ERROR = '#REF!'

export type RowColAxis = 'row' | 'col'

export type RowColOperation = {
  type: 'insert' | 'delete'
  axis: RowColAxis
  /** 操作起点，0-based */
  index: number
  /** 操作数量，至少 1 */
  count: number
}

function columnNameToIndex(value: string) {
  let result = 0
  for (const char of value.toUpperCase()) {
    result = result * 26 + (char.charCodeAt(0) - 64)
  }
  return result - 1
}

function columnIndexToName(colIndex: number) {
  let col = colIndex
  let name = ''
  do {
    name = String.fromCharCode(65 + (col % 26)) + name
    col = Math.floor(col / 26) - 1
  } while (col >= 0)
  return name
}

/**
 * 找出取数函数的参数区间（含括号），这些区间内的内容原样保留。
 * 支持嵌套括号；`SUM(...)` 这类非取数函数不受保护，其参数会正常参与引用重写。
 */
function findProtectedRanges(formula: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = []

  // 字符串字面量整体保护：`=IF(A1>0,A1,"A1")` 里引号内的 A1 是文本，不能跟着平移
  const stringPattern = /"(?:[^"]|"")*"/g
  let stringMatch: RegExpExecArray | null
  while ((stringMatch = stringPattern.exec(formula)) !== null) {
    ranges.push([stringMatch.index, stringMatch.index + stringMatch[0].length - 1])
  }

  const pattern = /@?([A-Za-z_]\w*)\s*\(/g
  let match: RegExpExecArray | null

  while ((match = pattern.exec(formula)) !== null) {
    const name = match[1].toLowerCase()
    if (!ANCHOR_FUNCTION_NAMES.has(name)) continue

    // 从左括号开始配对，找到对应的右括号
    const openIndex = formula.indexOf('(', match.index)
    if (openIndex < 0) continue
    let depth = 0
    let closeIndex = -1
    for (let i = openIndex; i < formula.length; i += 1) {
      if (formula[i] === '(') depth += 1
      else if (formula[i] === ')') {
        depth -= 1
        if (depth === 0) {
          closeIndex = i
          break
        }
      }
    }
    if (closeIndex < 0) closeIndex = formula.length - 1

    ranges.push([match.index, closeIndex])
    pattern.lastIndex = closeIndex
  }

  return ranges
}

function isProtected(position: number, ranges: Array<[number, number]>) {
  return ranges.some(([start, end]) => position >= start && position <= end)
}

/** 单个坐标在插删后的新值；返回 null 表示该坐标被删除（应变成 #REF!） */
function shiftIndex(value: number, operation: RowColOperation): number | null {
  const { type, index, count } = operation
  if (type === 'insert') {
    return value >= index ? value + count : value
  }
  if (value >= index && value < index + count) return null
  return value > index ? value - count : value
}

type ParsedRef = {
  colAbs: string
  colName: string
  rowAbs: string
  rowNumber: string
}

function buildRef(parsed: ParsedRef, colIndex: number, rowIndex: number) {
  return `${parsed.colAbs}${columnIndexToName(colIndex)}${parsed.rowAbs}${rowIndex + 1}`
}

/**
 * 重写一条公式。返回新公式；被删除的引用会变成 #REF!。
 * 非公式（不以 = / @ / ＝ 开头）或空值原样返回。
 */
export function rewriteFormulaForRowCol(
  formulaText: string | null | undefined,
  operation: RowColOperation
): string | null | undefined {
  if (!formulaText) return formulaText
  if (operation.count <= 0) return formulaText

  const protectedRanges = findProtectedRanges(formulaText)
  const refPattern = /(\$?)([A-Za-z]{1,3})(\$?)(\d+)/g

  return formulaText.replace(refPattern, (whole, colAbs, colName, rowAbs, rowNumber, offset) => {
    if (isProtected(offset, protectedRanges)) return whole

    // 前一个非空白字符是字母/数字/下划线时，说明这是标识符的一部分（如函数名尾巴），不是引用
    const prevChar = formulaText[offset - 1]
    if (prevChar && /[A-Za-z0-9_]/.test(prevChar)) return whole
    // 紧跟左括号的是函数调用，不是引用
    const nextChar = formulaText[offset + whole.length]
    if (nextChar === '(') return whole

    const parsed: ParsedRef = { colAbs, colName, rowAbs, rowNumber }
    const colIndex = columnNameToIndex(colName)
    const rowIndex = Number(rowNumber) - 1

    if (operation.axis === 'row') {
      const next = shiftIndex(rowIndex, operation)
      if (next === null) return REF_ERROR
      return buildRef(parsed, colIndex, next)
    }

    const next = shiftIndex(colIndex, operation)
    if (next === null) return REF_ERROR
    return buildRef(parsed, next, rowIndex)
  })
}
