/**
 * 报表公式引擎：分词 → 递归下降解析 → 求值。
 *
 * 取代原先「正则替换 + 只认四则运算的小解析器」的做法。旧实现有三个硬限制：
 *   1. `safeEvaluateExpression` 只放行 `0-9 + - * / ( )`，写个 `>` 或字符串就报「公式包含非法字符」；
 *   2. `applyFormulaFunctions` 是单趟正则且参数写死 `[^()]*`，**函数无法嵌套**——
 *      `=ROUND(SUM(A1:A5),2)` 这种最常见的写法算不出来；
 *   3. 除了 SUM 之外没有任何函数。
 *
 * 这里把公式当成真正的语言来处理，同时保留润衡的 `@` 取数函数：它们的参数是**科目编码与期间**
 * 而不是表达式（`@JQY(6601,01,99)` 里的 `01` 不能被当成数字 1），因此解析时单独取原始文本，
 * 交给执行器注入的回调去算。
 */

/** 公式的取值：数字 / 文本 / 布尔，与 Excel 一致 */
export type FormulaValue = number | string | boolean

/** 区域只能作为函数参数出现，不参与四则运算 */
type RangeValue = { kind: 'range'; values: Array<FormulaValue | undefined> }

/** 求值过程中的中间值；undefined 表示空单元格，与「0」区分 */
type EvalValue = FormulaValue | RangeValue | undefined

/** Excel 风格的错误码，直接作为单元格显示值 */
export type FormulaErrorCode = '#DIV/0!' | '#VALUE!' | '#NAME?' | '#REF!' | '#NUM!' | '#N/A' | '#ERROR' | '#CIRCULAR!'

export class FormulaError extends Error {
  constructor(
    readonly code: FormulaErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'FormulaError'
  }
}

export type FormulaContext = {
  /** 取单元格的值；空单元格返回 undefined（与 0 区分，COUNT/AVERAGE 要靠它跳过空格） */
  getCell: (address: string) => FormulaValue | undefined
  /** 调用 @ 取数函数，参数是未经求值的原始文本 */
  callAnchor?: (name: string, rawArgs: string[]) => number
}

// ─────────────────────────── 地址工具 ───────────────────────────

export function columnNameToIndex(value: string) {
  let result = 0
  for (const char of value.toUpperCase()) {
    result = result * 26 + (char.charCodeAt(0) - 64)
  }
  return result - 1
}

export function columnIndexToName(colIndex: number) {
  let col = colIndex
  let name = ''
  do {
    name = String.fromCharCode(65 + (col % 26)) + name
    col = Math.floor(col / 26) - 1
  } while (col >= 0)
  return name
}

/** 展开 `A1:B3` 为逐格地址；起止顺序颠倒也能正确展开 */
export function expandRange(from: string, to: string): string[] {
  const start = parseAddress(from)
  const end = parseAddress(to)
  if (!start || !end) return []

  const rowStart = Math.min(start.rowIndex, end.rowIndex)
  const rowEnd = Math.max(start.rowIndex, end.rowIndex)
  const colStart = Math.min(start.colIndex, end.colIndex)
  const colEnd = Math.max(start.colIndex, end.colIndex)

  const refs: string[] = []
  for (let rowIndex = rowStart; rowIndex <= rowEnd; rowIndex += 1) {
    for (let colIndex = colStart; colIndex <= colEnd; colIndex += 1) {
      refs.push(`${columnIndexToName(colIndex)}${rowIndex + 1}`)
    }
  }
  return refs
}

function parseAddress(value: string) {
  const match = value.trim().match(/^\$?([A-Z]+)\$?(\d+)$/i)
  if (!match) return null
  return { colIndex: columnNameToIndex(match[1]), rowIndex: Number(match[2]) - 1 }
}

// ─────────────────────────── 分词 ───────────────────────────

type TokenType =
  | 'number'
  | 'string'
  | 'ref'
  | 'ident'
  | 'op'
  | 'lparen'
  | 'rparen'
  | 'comma'
  | 'colon'

type Token = {
  type: TokenType
  value: string
  /** 在源串中的起止位置，取数函数要靠它切出参数原文 */
  start: number
  end: number
}

const OPERATORS = ['<>', '<=', '>=', '=', '<', '>', '+', '-', '*', '/', '^', '&', '%']

function tokenize(source: string): Token[] {
  const tokens: Token[] = []
  let index = 0

  while (index < source.length) {
    const char = source[index]

    if (/\s/.test(char)) {
      index += 1
      continue
    }

    if (char === '"') {
      let cursor = index + 1
      let text = ''
      while (cursor < source.length) {
        if (source[cursor] === '"') {
          // Excel 用连续两个双引号表示一个字面量双引号
          if (source[cursor + 1] === '"') {
            text += '"'
            cursor += 2
            continue
          }
          break
        }
        text += source[cursor]
        cursor += 1
      }
      if (cursor >= source.length) {
        throw new FormulaError('#VALUE!', '字符串缺少右引号')
      }
      tokens.push({ type: 'string', value: text, start: index, end: cursor + 1 })
      index = cursor + 1
      continue
    }

    if (/[0-9]/.test(char) || (char === '.' && /[0-9]/.test(source[index + 1] || ''))) {
      const match = /^\d*\.?\d+([eE][+-]?\d+)?/.exec(source.slice(index))!
      tokens.push({ type: 'number', value: match[0], start: index, end: index + match[0].length })
      index += match[0].length
      continue
    }

    // 单元格引用要在标识符之前判定：A1 是引用，SUM 是标识符
    const refMatch = /^\$?[A-Za-z]{1,3}\$?\d+(?![\w(])/.exec(source.slice(index))
    if (refMatch) {
      tokens.push({
        type: 'ref',
        value: refMatch[0].replace(/\$/g, '').toUpperCase(),
        start: index,
        end: index + refMatch[0].length,
      })
      index += refMatch[0].length
      continue
    }

    // 标识符：函数名与 @ 取数函数名（@ 可有可无，`@YE(..)+YE(..)` 两种写法都要认）
    const identMatch = /^@?[A-Za-z_][A-Za-z_0-9]*/.exec(source.slice(index))
    if (identMatch) {
      tokens.push({
        type: 'ident',
        value: identMatch[0].replace(/^@/, ''),
        start: index,
        end: index + identMatch[0].length,
      })
      index += identMatch[0].length
      continue
    }

    if (char === '(') {
      tokens.push({ type: 'lparen', value: char, start: index, end: index + 1 })
      index += 1
      continue
    }
    if (char === ')') {
      tokens.push({ type: 'rparen', value: char, start: index, end: index + 1 })
      index += 1
      continue
    }
    // 分号也当参数分隔符：部分区域设置的 Excel 导出会用 `;`
    if (char === ',' || char === ';') {
      tokens.push({ type: 'comma', value: ',', start: index, end: index + 1 })
      index += 1
      continue
    }
    if (char === ':') {
      tokens.push({ type: 'colon', value: char, start: index, end: index + 1 })
      index += 1
      continue
    }

    const operator = OPERATORS.find(item => source.startsWith(item, index))
    if (operator) {
      tokens.push({ type: 'op', value: operator, start: index, end: index + operator.length })
      index += operator.length
      continue
    }

    throw new FormulaError('#VALUE!', `无法识别的字符 ${char}`)
  }

  return tokens
}

// ─────────────────────────── 语法树 ───────────────────────────

type Node =
  | { kind: 'number'; value: number }
  | { kind: 'string'; value: string }
  | { kind: 'ref'; address: string }
  | { kind: 'range'; from: string; to: string }
  | { kind: 'unary'; operator: '-' | '+'; operand: Node }
  | { kind: 'percent'; operand: Node }
  | { kind: 'binary'; operator: string; left: Node; right: Node }
  | { kind: 'call'; name: string; args: Node[] }
  | { kind: 'anchor'; name: string; rawArgs: string[] }

/** 二元运算优先级，数字越大结合越紧（与 Excel 一致） */
const BINARY_PRECEDENCE: Record<string, number> = {
  '=': 1,
  '<>': 1,
  '<': 1,
  '<=': 1,
  '>': 1,
  '>=': 1,
  '&': 2,
  '+': 3,
  '-': 3,
  '*': 4,
  '/': 4,
  '^': 5,
}

class Parser {
  private index = 0

  constructor(
    private readonly tokens: Token[],
    private readonly source: string,
    private readonly isAnchor: (name: string) => boolean
  ) {}

  parse(): Node {
    const node = this.parseExpression(0)
    if (this.index < this.tokens.length) {
      throw new FormulaError('#VALUE!', '公式存在多余内容')
    }
    return node
  }

  private peek() {
    return this.tokens[this.index]
  }

  private expect(type: TokenType, message: string) {
    const token = this.peek()
    if (!token || token.type !== type) {
      throw new FormulaError('#VALUE!', message)
    }
    this.index += 1
    return token
  }

  private parseExpression(minPrecedence: number): Node {
    let left = this.parseUnary()

    for (;;) {
      const token = this.peek()
      if (!token || token.type !== 'op') break
      const precedence = BINARY_PRECEDENCE[token.value]
      if (precedence === undefined || precedence < minPrecedence) break
      this.index += 1
      // `^` 右结合，其余左结合
      const nextMin = token.value === '^' ? precedence : precedence + 1
      const right = this.parseExpression(nextMin)
      left = { kind: 'binary', operator: token.value, left, right }
    }

    return left
  }

  private parseUnary(): Node {
    const token = this.peek()
    if (token && token.type === 'op' && (token.value === '-' || token.value === '+')) {
      this.index += 1
      return { kind: 'unary', operator: token.value, operand: this.parseUnary() }
    }
    return this.parsePostfix()
  }

  private parsePostfix(): Node {
    let node = this.parsePrimary()
    for (;;) {
      const token = this.peek()
      if (token && token.type === 'op' && token.value === '%') {
        this.index += 1
        node = { kind: 'percent', operand: node }
        continue
      }
      break
    }
    return node
  }

  private parsePrimary(): Node {
    const token = this.peek()
    if (!token) {
      throw new FormulaError('#VALUE!', '公式不完整')
    }

    if (token.type === 'number') {
      this.index += 1
      return { kind: 'number', value: Number(token.value) }
    }

    if (token.type === 'string') {
      this.index += 1
      return { kind: 'string', value: token.value }
    }

    if (token.type === 'ref') {
      this.index += 1
      const next = this.peek()
      if (next && next.type === 'colon' && this.tokens[this.index + 1]?.type === 'ref') {
        const to = this.tokens[this.index + 1]
        this.index += 2
        return { kind: 'range', from: token.value, to: to.value }
      }
      return { kind: 'ref', address: token.value }
    }

    if (token.type === 'lparen') {
      this.index += 1
      const node = this.parseExpression(0)
      this.expect('rparen', '括号未闭合')
      return node
    }

    if (token.type === 'ident') {
      this.index += 1
      const name = token.value.toLowerCase()

      // TRUE / FALSE 允许不带括号
      if (!this.peek() || this.peek()!.type !== 'lparen') {
        if (name === 'true') return { kind: 'number', value: 1 }
        if (name === 'false') return { kind: 'number', value: 0 }
        throw new FormulaError('#NAME?', `未知的名称 ${token.value}`)
      }

      return this.isAnchor(name) ? this.parseAnchorCall(name) : this.parseFunctionCall(name)
    }

    throw new FormulaError('#VALUE!', `无法解析的片段 ${token.value}`)
  }

  /** @ 取数函数：参数按原文切分，不做求值（科目编码可能有前导零） */
  private parseAnchorCall(name: string): Node {
    const lparen = this.expect('lparen', '括号未闭合')
    let depth = 1
    let argStart = lparen.end
    const rawArgs: string[] = []

    while (this.index < this.tokens.length) {
      const token = this.tokens[this.index]
      if (token.type === 'lparen') depth += 1
      if (token.type === 'rparen') {
        depth -= 1
        if (depth === 0) {
          const text = this.source.slice(argStart, token.start).trim()
          if (text || rawArgs.length > 0) rawArgs.push(text)
          this.index += 1
          return { kind: 'anchor', name, rawArgs }
        }
      }
      if (token.type === 'comma' && depth === 1) {
        rawArgs.push(this.source.slice(argStart, token.start).trim())
        argStart = token.end
      }
      this.index += 1
    }

    throw new FormulaError('#VALUE!', '括号未闭合')
  }

  private parseFunctionCall(name: string): Node {
    this.expect('lparen', '括号未闭合')
    const args: Node[] = []

    if (this.peek()?.type === 'rparen') {
      this.index += 1
      return { kind: 'call', name, args }
    }

    for (;;) {
      args.push(this.parseExpression(0))
      const token = this.peek()
      if (token && token.type === 'comma') {
        this.index += 1
        continue
      }
      this.expect('rparen', '括号未闭合')
      break
    }

    return { kind: 'call', name, args }
  }
}

// ─────────────────────────── 取值辅助 ───────────────────────────

function isRange(value: EvalValue): value is RangeValue {
  return typeof value === 'object' && value !== null && (value as RangeValue).kind === 'range'
}

/** 参与算术时的取数：空值算 0，文本数字自动转换，不可转换则 #VALUE! */
function toNumber(value: EvalValue): number {
  if (isRange(value)) {
    throw new FormulaError('#VALUE!', '区域不能直接参与运算')
  }
  if (value === undefined || value === null || value === '') return 0
  if (typeof value === 'boolean') return value ? 1 : 0
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new FormulaError('#NUM!', '数值溢出')
    return value
  }
  const parsed = Number(String(value).replace(/,/g, '').trim())
  if (!Number.isFinite(parsed)) {
    throw new FormulaError('#VALUE!', `无法把「${value}」当作数字`)
  }
  return parsed
}

function toText(value: EvalValue): string {
  if (isRange(value)) throw new FormulaError('#VALUE!', '区域不能直接参与运算')
  if (value === undefined || value === null) return ''
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE'
  return String(value)
}

function toBoolean(value: EvalValue): boolean {
  if (isRange(value)) throw new FormulaError('#VALUE!', '区域不能作为条件')
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    const upper = value.trim().toUpperCase()
    if (upper === 'TRUE') return true
    if (upper === 'FALSE' || upper === '') return false
  }
  return toNumber(value) !== 0
}

/** 把参数摊平成标量序列：区域展开，空格保留为 undefined 供 COUNT/AVERAGE 判断 */
function flatten(values: EvalValue[]): Array<FormulaValue | undefined> {
  const result: Array<FormulaValue | undefined> = []
  for (const value of values) {
    if (isRange(value)) result.push(...value.values)
    else result.push(value)
  }
  return result
}

/** 聚合函数只统计数字：区域里的文本与空格跳过，直接写的参数则必须能转成数字 */
function numericOperands(values: EvalValue[]): number[] {
  const result: number[] = []
  for (const value of values) {
    if (isRange(value)) {
      for (const item of value.values) {
        if (item === undefined || item === '' || typeof item === 'string') continue
        if (typeof item === 'boolean') continue
        result.push(item)
      }
      continue
    }
    if (value === undefined) continue
    result.push(toNumber(value))
  }
  return result
}

function roundTo(value: number, digits: number, mode: 'half' | 'up' | 'down') {
  const safeDigits = Math.min(15, Math.max(-15, Math.trunc(digits) || 0))
  const factor = 10 ** safeDigits
  const scaled = value * factor
  const rounded =
    mode === 'half'
      ? Math.sign(scaled) * Math.round(Math.abs(scaled))
      : mode === 'up'
        ? Math.sign(scaled) * Math.ceil(Math.abs(scaled))
        : Math.sign(scaled) * Math.floor(Math.abs(scaled))
  return rounded / factor
}

/**
 * SUMIF / COUNTIF 的条件：支持 `">100"`、`"<=0"`、`"<>0"` 以及直接给值的等值比较。
 */
function buildCriteria(raw: EvalValue): (value: FormulaValue | undefined) => boolean {
  if (typeof raw === 'string') {
    const match = /^\s*(<>|>=|<=|>|<|=)\s*(.*)$/.exec(raw)
    if (match) {
      const [, operator, operand] = match
      const numeric = Number(operand)
      const compare = (value: FormulaValue | undefined) => {
        if (Number.isFinite(numeric) && operand.trim() !== '') {
          const left = value === undefined || value === '' ? 0 : toNumber(value)
          switch (operator) {
            case '>':
              return left > numeric
            case '>=':
              return left >= numeric
            case '<':
              return left < numeric
            case '<=':
              return left <= numeric
            case '<>':
              return left !== numeric
            default:
              return left === numeric
          }
        }
        const left = toText(value ?? '')
        return operator === '<>' ? left !== operand : left === operand
      }
      return compare
    }
  }

  const target = raw
  return value => {
    if (typeof target === 'number') {
      if (value === undefined || value === '') return false
      return toNumber(value) === target
    }
    return toText(value ?? '') === toText(target ?? '')
  }
}

// ─────────────────────────── 函数表 ───────────────────────────

type FunctionDef = {
  minArgs: number
  maxArgs: number
  /**
   * 惰性求值：拿到的是「求值函数」而不是值。
   * IF/AND/OR/IFERROR 必须惰性，否则 `IF(B5>0, D5/B5, 0)` 在 B5=0 时会先炸出 #DIV/0!。
   */
  lazy?: boolean
  call: (args: EvalValue[]) => FormulaValue
  lazyCall?: (args: Array<() => EvalValue>) => FormulaValue
}

/**
 * 支持的 Excel 函数。**要加新函数只需在这里加一条**，解析、嵌套、区域参数都是通用的。
 * 名字统一小写，调用时不区分大小写。
 */
export const EXCEL_FUNCTIONS: Record<string, FunctionDef> = {
  sum: {
    minArgs: 1,
    maxArgs: Infinity,
    call: args => numericOperands(args).reduce((total, item) => total + item, 0),
  },
  product: {
    minArgs: 1,
    maxArgs: Infinity,
    call: args => numericOperands(args).reduce((total, item) => total * item, 1),
  },
  average: {
    minArgs: 1,
    maxArgs: Infinity,
    call: args => {
      const numbers = numericOperands(args)
      if (numbers.length === 0) throw new FormulaError('#DIV/0!', '没有可平均的数值')
      return numbers.reduce((total, item) => total + item, 0) / numbers.length
    },
  },
  max: {
    minArgs: 1,
    maxArgs: Infinity,
    call: args => {
      const numbers = numericOperands(args)
      return numbers.length === 0 ? 0 : Math.max(...numbers)
    },
  },
  min: {
    minArgs: 1,
    maxArgs: Infinity,
    call: args => {
      const numbers = numericOperands(args)
      return numbers.length === 0 ? 0 : Math.min(...numbers)
    },
  },
  count: {
    minArgs: 1,
    maxArgs: Infinity,
    call: args => numericOperands(args).length,
  },
  counta: {
    minArgs: 1,
    maxArgs: Infinity,
    call: args => flatten(args).filter(item => item !== undefined && item !== '').length,
  },
  abs: { minArgs: 1, maxArgs: 1, call: args => Math.abs(toNumber(args[0])) },
  sign: { minArgs: 1, maxArgs: 1, call: args => Math.sign(toNumber(args[0])) },
  int: { minArgs: 1, maxArgs: 1, call: args => Math.floor(toNumber(args[0])) },
  sqrt: {
    minArgs: 1,
    maxArgs: 1,
    call: args => {
      const value = toNumber(args[0])
      if (value < 0) throw new FormulaError('#NUM!', '负数不能开平方')
      return Math.sqrt(value)
    },
  },
  power: { minArgs: 2, maxArgs: 2, call: args => toNumber(args[0]) ** toNumber(args[1]) },
  mod: {
    minArgs: 2,
    maxArgs: 2,
    call: args => {
      const divisor = toNumber(args[1])
      if (divisor === 0) throw new FormulaError('#DIV/0!', '除数为 0')
      return toNumber(args[0]) % divisor
    },
  },
  round: {
    minArgs: 1,
    maxArgs: 2,
    call: args => roundTo(toNumber(args[0]), args.length > 1 ? toNumber(args[1]) : 0, 'half'),
  },
  roundup: {
    minArgs: 1,
    maxArgs: 2,
    call: args => roundTo(toNumber(args[0]), args.length > 1 ? toNumber(args[1]) : 0, 'up'),
  },
  rounddown: {
    minArgs: 1,
    maxArgs: 2,
    call: args => roundTo(toNumber(args[0]), args.length > 1 ? toNumber(args[1]) : 0, 'down'),
  },
  trunc: {
    minArgs: 1,
    maxArgs: 2,
    call: args => roundTo(toNumber(args[0]), args.length > 1 ? toNumber(args[1]) : 0, 'down'),
  },
  sumif: {
    minArgs: 2,
    maxArgs: 3,
    call: args => {
      const source = isRange(args[0]) ? args[0].values : [args[0] as FormulaValue]
      const matches = buildCriteria(args[1] as FormulaValue)
      const target = args.length > 2 && isRange(args[2]) ? args[2].values : source
      let total = 0
      source.forEach((item, position) => {
        if (!matches(item)) return
        const value = target[position]
        if (value === undefined || typeof value === 'string' || typeof value === 'boolean') return
        total += value
      })
      return total
    },
  },
  countif: {
    minArgs: 2,
    maxArgs: 2,
    call: args => {
      const source = isRange(args[0]) ? args[0].values : [args[0] as FormulaValue]
      const matches = buildCriteria(args[1] as FormulaValue)
      return source.filter(item => matches(item)).length
    },
  },
  not: { minArgs: 1, maxArgs: 1, call: args => !toBoolean(args[0]) },
  if: {
    minArgs: 2,
    maxArgs: 3,
    lazy: true,
    call: () => 0,
    lazyCall: args => {
      const condition = toBoolean(args[0]())
      if (condition) return asScalar(args[1]())
      return args.length > 2 ? asScalar(args[2]()) : false
    },
  },
  iferror: {
    minArgs: 2,
    maxArgs: 2,
    lazy: true,
    call: () => 0,
    lazyCall: args => {
      try {
        return asScalar(args[0]())
      } catch {
        return asScalar(args[1]())
      }
    },
  },
  and: {
    minArgs: 1,
    maxArgs: Infinity,
    lazy: true,
    call: () => 0,
    lazyCall: args => {
      for (const arg of args) {
        if (!toBoolean(arg())) return false
      }
      return true
    },
  },
  or: {
    minArgs: 1,
    maxArgs: Infinity,
    lazy: true,
    call: () => 0,
    lazyCall: args => {
      for (const arg of args) {
        if (toBoolean(arg())) return true
      }
      return false
    },
  },
}

function asScalar(value: EvalValue): FormulaValue {
  if (isRange(value)) throw new FormulaError('#VALUE!', '区域不能作为结果')
  // 空单元格作为整条公式的结果时按 0 处理（`=A1` 指向空格应显示 0，而不是空白）
  return value === undefined ? 0 : value
}

/**
 * 润衡的 @ 取数函数名单。这些函数的参数是**科目编码与期间**而不是表达式
 * （`@JQY(6601,01,99)` 里的 `01` 不能被当成数字 1），因此解析器取参数原文交给执行器。
 *
 * 只此一份：执行器按它分派取数，reportFormulaRewrite 按它判断哪些括号内容不该被当作
 * 单元格引用改写。两处各存一份必然漂移。
 */
export const ANCHOR_FUNCTION_NAMES = new Set([
  'ye', 'nc', 'jf', 'df',
  'jy', 'mjy', 'dy', 'mdy',
  'nj', 'mnj', 'nd', 'mnd',
  'jqy', 'jqj', 'jqd',
  'xj_je', 'ys_cy',
])

export function isAnchorFunction(name: string) {
  return ANCHOR_FUNCTION_NAMES.has(name.toLowerCase())
}

/** 供前端做函数提示用：已支持的 Excel 函数名（大写） */
export const EXCEL_FUNCTION_NAMES = Object.keys(EXCEL_FUNCTIONS).map(name => name.toUpperCase())

/**
 * 函数速查表，供公式栏的「fx」弹层展示。
 * 新增函数时在 EXCEL_FUNCTIONS 里加实现，再在这里补一条说明即可。
 */
export const FORMULA_REFERENCE: Array<{
  group: string
  name: string
  signature: string
  description: string
}> = [
  { group: '求和统计', name: 'SUM', signature: 'SUM(区域或数值, ...)', description: '求和，如 SUM(C6:C19)' },
  { group: '求和统计', name: 'AVERAGE', signature: 'AVERAGE(区域, ...)', description: '求平均，跳过文本与空格' },
  { group: '求和统计', name: 'MAX', signature: 'MAX(区域, ...)', description: '最大值' },
  { group: '求和统计', name: 'MIN', signature: 'MIN(区域, ...)', description: '最小值' },
  { group: '求和统计', name: 'COUNT', signature: 'COUNT(区域, ...)', description: '统计数字格个数' },
  { group: '求和统计', name: 'COUNTA', signature: 'COUNTA(区域, ...)', description: '统计非空格个数' },
  { group: '求和统计', name: 'PRODUCT', signature: 'PRODUCT(数值, ...)', description: '连乘' },
  { group: '条件', name: 'IF', signature: 'IF(条件, 真值, 假值)', description: '条件取值，如 IF(C20>0,"盈","亏")' },
  { group: '条件', name: 'IFERROR', signature: 'IFERROR(表达式, 出错时取值)', description: '兜住除零等错误' },
  { group: '条件', name: 'AND', signature: 'AND(条件, ...)', description: '全部成立' },
  { group: '条件', name: 'OR', signature: 'OR(条件, ...)', description: '任一成立' },
  { group: '条件', name: 'NOT', signature: 'NOT(条件)', description: '取反' },
  { group: '条件', name: 'SUMIF', signature: 'SUMIF(区域, 条件, [求和区域])', description: '按条件求和，如 SUMIF(C6:C19,">0")' },
  { group: '条件', name: 'COUNTIF', signature: 'COUNTIF(区域, 条件)', description: '按条件计数' },
  { group: '取整', name: 'ROUND', signature: 'ROUND(数值, 位数)', description: '四舍五入' },
  { group: '取整', name: 'ROUNDUP', signature: 'ROUNDUP(数值, 位数)', description: '向上取' },
  { group: '取整', name: 'ROUNDDOWN', signature: 'ROUNDDOWN(数值, 位数)', description: '向下取' },
  { group: '取整', name: 'INT', signature: 'INT(数值)', description: '向下取整' },
  { group: '取整', name: 'TRUNC', signature: 'TRUNC(数值, 位数)', description: '截断' },
  { group: '数学', name: 'ABS', signature: 'ABS(数值)', description: '绝对值' },
  { group: '数学', name: 'SIGN', signature: 'SIGN(数值)', description: '取符号 -1/0/1' },
  { group: '数学', name: 'MOD', signature: 'MOD(被除数, 除数)', description: '取余' },
  { group: '数学', name: 'POWER', signature: 'POWER(底数, 指数)', description: '乘方，也可写 2^3' },
  { group: '数学', name: 'SQRT', signature: 'SQRT(数值)', description: '平方根' },
  { group: '取数', name: '@YE', signature: '@ye(科目编码, 期间)', description: '期末余额，期间 99 表示当前期' },
  { group: '取数', name: '@NC', signature: '@nc(科目编码)', description: '年初余额' },
  { group: '取数', name: '@JF', signature: '@jf(科目编码, 期间)', description: '本期借方发生额' },
  { group: '取数', name: '@DF', signature: '@df(科目编码, 期间)', description: '本期贷方发生额' },
  { group: '取数', name: '@MJY', signature: '@mjy(科目编码, 期间)', description: '期末借方余额' },
  { group: '取数', name: '@MDY', signature: '@mdy(科目编码, 期间)', description: '期末贷方余额' },
  { group: '取数', name: '@MNJ', signature: '@mnj(科目编码)', description: '年初借方余额' },
  { group: '取数', name: '@MND', signature: '@mnd(科目编码)', description: '年初贷方余额' },
  { group: '取数', name: '@JQY', signature: '@jqy(科目编码, 起期, 止期)', description: '区间净发生额（排除结转）' },
  { group: '取数', name: '@JQJ', signature: '@jqj(科目编码, 起期, 止期)', description: '区间借方发生额' },
  { group: '取数', name: '@JQD', signature: '@jqd(科目编码, 起期, 止期)', description: '区间贷方发生额' },
  { group: '取数', name: '@XJ_JE', signature: '@xj_je(项目编码, 起期, 止期)', description: '现金流量项目金额' },
]

// ─────────────────────────── 求值 ───────────────────────────

function evaluateNode(node: Node, context: FormulaContext): EvalValue {
  switch (node.kind) {
    case 'number':
      return node.value
    case 'string':
      return node.value
    case 'ref':
      return context.getCell(node.address)
    case 'range':
      return {
        kind: 'range',
        values: expandRange(node.from, node.to).map(address => context.getCell(address)),
      }
    case 'unary': {
      const value = toNumber(evaluateNode(node.operand, context))
      return node.operator === '-' ? -value : value
    }
    case 'percent':
      return toNumber(evaluateNode(node.operand, context)) / 100
    case 'binary':
      return evaluateBinary(node, context)
    case 'anchor': {
      if (!context.callAnchor) {
        throw new FormulaError('#NAME?', `当前上下文不支持取数函数 @${node.name}`)
      }
      return context.callAnchor(node.name, node.rawArgs)
    }
    case 'call': {
      const definition = EXCEL_FUNCTIONS[node.name]
      if (!definition) {
        throw new FormulaError('#NAME?', `暂不支持函数 ${node.name.toUpperCase()}`)
      }
      if (node.args.length < definition.minArgs || node.args.length > definition.maxArgs) {
        throw new FormulaError('#VALUE!', `函数 ${node.name.toUpperCase()} 的参数个数不对`)
      }
      if (definition.lazy && definition.lazyCall) {
        return definition.lazyCall(node.args.map(arg => () => evaluateNode(arg, context)))
      }
      return definition.call(node.args.map(arg => evaluateNode(arg, context)))
    }
  }
}

function evaluateBinary(
  node: Extract<Node, { kind: 'binary' }>,
  context: FormulaContext
): FormulaValue {
  const left = evaluateNode(node.left, context)
  const right = evaluateNode(node.right, context)

  switch (node.operator) {
    case '+':
      return toNumber(left) + toNumber(right)
    case '-':
      return toNumber(left) - toNumber(right)
    case '*':
      return toNumber(left) * toNumber(right)
    case '/': {
      const divisor = toNumber(right)
      if (divisor === 0) throw new FormulaError('#DIV/0!', '除数为 0')
      return toNumber(left) / divisor
    }
    case '^':
      return toNumber(left) ** toNumber(right)
    case '&':
      return toText(left) + toText(right)
    default:
      return compareValues(node.operator, left, right)
  }
}

function compareValues(operator: string, left: EvalValue, right: EvalValue): boolean {
  // 两边都不是文本时按数值比，否则按文本比（与 Excel 的宽松比较接近）
  const bothNumericish =
    (typeof left !== 'string' || left === '') && (typeof right !== 'string' || right === '')
  const [a, b] = bothNumericish
    ? [toNumber(left), toNumber(right)]
    : [toText(left), toText(right)]

  switch (operator) {
    case '=':
      return a === b
    case '<>':
      return a !== b
    case '<':
      return a < b
    case '<=':
      return a <= b
    case '>':
      return a > b
    default:
      return a >= b
  }
}

/** 去掉开头的 `=`（含全角 `＝`），公式文本可能两种都有 */
export function stripFormulaPrefix(source: string) {
  let text = String(source || '').trim()
  if (text.startsWith('＝')) text = `=${text.slice(1)}`
  if (text.startsWith('=')) text = text.slice(1)
  return text
}

function parseFormula(source: string, isAnchor: (name: string) => boolean): Node {
  const text = stripFormulaPrefix(source)
  if (!text) return { kind: 'number', value: 0 }
  return new Parser(tokenize(text), text, isAnchor).parse()
}

export function evaluateFormula(
  source: string,
  context: FormulaContext,
  isAnchor: (name: string) => boolean = () => false
): FormulaValue {
  const node = parseFormula(source, isAnchor)
  const value = asScalar(evaluateNode(node, context))
  // -0 与 0 在报表上没有区别，但会让金额展示变得难看
  return Object.is(value, -0) ? 0 : value
}

/**
 * 收集公式引用到的所有单元格地址（区域会展开），供执行器做拓扑排序。
 * 解析失败时返回空数组：拿不到依赖顶多是求值时报错，不该让整张表崩掉。
 */
export function collectCellRefs(source: string, isAnchor: (name: string) => boolean = () => false) {
  const refs = new Set<string>()
  let node: Node
  try {
    node = parseFormula(source, isAnchor)
  } catch {
    return [] as string[]
  }

  const walk = (current: Node) => {
    switch (current.kind) {
      case 'ref':
        refs.add(current.address)
        break
      case 'range':
        for (const address of expandRange(current.from, current.to)) refs.add(address)
        break
      case 'unary':
      case 'percent':
        walk(current.operand)
        break
      case 'binary':
        walk(current.left)
        walk(current.right)
        break
      case 'call':
        current.args.forEach(walk)
        break
      default:
        break
    }
  }

  walk(node)
  return Array.from(refs)
}
