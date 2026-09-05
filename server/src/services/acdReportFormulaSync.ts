import type { Database as SqliteDatabase } from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'
import iconv from 'iconv-lite'

import { parseAcdFileTables, splitTableRows } from '../scripts/importAcdToCurrentAccountSet.js'
import { fixCashFlowReportFormulas } from '../scripts/fixCashFlowReportFormulas.js'
import { fixBudgetSurplusReportFormulas } from '../scripts/fixBudgetSurplusReportFormulas.js'

type ParsedAcdCell = {
  rowIndex: number
  colIndex: number
  cellType: 'text' | 'formula'
  textValue: string | null
  formulaText: string | null
  /** 由 vts 的格式表还原出的样式，token 约定见 client 的 useReportCellStyle */
  styleKey: string | null
  /**
   * 原报表用「跨列居中」(center across selection) 实现跨列标题，而不是真的合并单元格。
   * 这里先标记出来，跨几列要等知道表格宽度后才能算，见 applyCenterAcross。
   */
  centerAcross: boolean
}

type ParsedAcdSheet = {
  name: string
  index: number
  cells: ParsedAcdCell[]
}

type ParsedAcdTemplate = {
  reportCode: string
  reportName: string
  sourceFile: string
  sheets: ParsedAcdSheet[]
}

type BinaryCellRecord = ParsedAcdCell & {
  offset: number
}

type SyncStats = {
  matchedReports: number
  matchedSheets: number
  updatedCells: number
  insertedCells: number
  skippedUnsupportedFormulas: number
  warnings: string[]
}

function getBaseFileName(value: string) {
  return value.replace(/^.*[\\/]/, '').toLowerCase()
}

function normalizeReportName(value: string) {
  return value
    .replace(/\s+/g, '')
    .replace(/[()（）]/g, '')
    .replace(/表$/u, '')
    .trim()
}

function normalizeAnchorText(value: string) {
  return value
    .replace(/\u3000/g, ' ')
    .replace(/[：﹕]/g, ':')
    .replace(/[（]/g, '(')
    .replace(/[）]/g, ')')
    .replace(/\s+/g, '')
    .trim()
}

function isSheetTitleCell(cell: BinaryCellRecord) {
  if (cell.cellType !== 'text') return false
  if (cell.rowIndex !== 0 || cell.colIndex !== 0) return false
  const text = String(cell.textValue || '').trim()
  if (!text) return false
  return /表|差异/u.test(text)
}

function getCellAddress(rowIndex: number, colIndex: number) {
  let value = colIndex + 1
  let result = ''
  while (value > 0) {
    const remainder = (value - 1) % 26
    result = String.fromCharCode(65 + remainder) + result
    value = Math.floor((value - 1) / 26)
  }
  return `${result}${rowIndex + 1}`
}

function stripOuterParentheses(value: string) {
  let result = value.trim()
  while (result.startsWith('(') && result.endsWith(')')) {
    let depth = 0
    let wrapped = true
    for (let index = 0; index < result.length; index += 1) {
      const char = result[index]
      if (char === '(') depth += 1
      if (char === ')') depth -= 1
      if (depth === 0 && index < result.length - 1) {
        wrapped = false
        break
      }
    }
    if (!wrapped) break
    result = result.slice(1, -1).trim()
  }
  return result
}

function formatNumericLiteral(value: number) {
  if (Number.isInteger(value)) {
    return String(value)
  }
  return String(Number(value.toFixed(12)))
}

/**
 * 编译公式 token 的 opcode（BIFF 风格 RPN）。同一种引用有三个「类」变体
 * （ref / value / array），语义上对我们没区别，一并接受。
 */
const PTG_REF = new Set([0x24, 0x44, 0x64])
const PTG_AREA = new Set([0x25, 0x45, 0x65])
const PTG_FUNC = new Set([0x21, 0x41, 0x61])
/** 变参函数：`[op][参数个数:1][函数号:2]` */
const PTG_FUNC_VAR = new Set([0x22, 0x42, 0x62])
/** 比较运算，栈上弹两个压一个 */
const PTG_COMPARISON: Record<number, string> = {
  0x09: '<',
  0x0a: '<=',
  0x0b: '=',
  0x0c: '>=',
  0x0d: '>',
  0x0e: '<>',
}
/** tAttr 的 bitSum：把栈顶那一个操作数包成 SUM()，即 Excel 的「优化求和」 */
const PTG_ATTR_SUM = 0x10
/**
 * tAttr 的其余位：bitIf(0x02) / bitSkip(0x04) / bitGoto(0x08) 是 IF 的**跳转优化标记**，
 * bitSpace(0x40) 只记录原文里的空格。它们都不影响表达式的值，也不进出栈，跳过即可
 * ——真正的 IF 是由末尾的 tFuncVar(函数号 1) 组装的。
 */
const PTG_ATTR_IGNORABLE = 0x02 | 0x04 | 0x08 | 0x40

/**
 * BIFF 函数号 → 函数名。这里**只收录经典函数表（0~39）里我们求值引擎实现了的那些**：
 * 这段编号自 BIFF2 以来没变过，且 27=ROUND 已由实际文件验证（`41 1b 00` 解出
 * `ROUND(C32*C33,2)`，与报表相符）。高位编号（SUMIF/COUNTIF 等）手边没有样本可核对，
 * 宁可走「未解析」告警也不冒着映射错误静默造出一条算错的公式；将来遇到实样再按需补。
 *
 * argCount 只对定参的 tFunc 有意义；tFuncVar 的参数个数由 token 自带。
 */
const COMPILED_FUNCTIONS: Record<number, { name: string; argCount: number }> = {
  0: { name: 'COUNT', argCount: 1 },
  1: { name: 'IF', argCount: 3 },
  4: { name: 'SUM', argCount: 1 },
  5: { name: 'AVERAGE', argCount: 1 },
  6: { name: 'MIN', argCount: 1 },
  7: { name: 'MAX', argCount: 1 },
  20: { name: 'SQRT', argCount: 1 },
  24: { name: 'ABS', argCount: 1 },
  25: { name: 'INT', argCount: 1 },
  26: { name: 'SIGN', argCount: 1 },
  27: { name: 'ROUND', argCount: 2 },
  36: { name: 'AND', argCount: 2 },
  37: { name: 'OR', argCount: 2 },
  38: { name: 'NOT', argCount: 1 },
  39: { name: 'MOD', argCount: 2 },
}

/**
 * 把编译公式的 RPN token 还原成 `=` 开头的表达式。
 *
 * 行号与记录头用的是同一套 1-based 编号，而落库的 rowIndex 是 0-based，故统一减 1。
 * 无法用纯表达式表达的 token（IF/GOTO 跳转、字符串常量、未知函数）一律返回 null，
 * 由调用方记 warning 后跳过——宁可缺一格，也不要造出一个算错的公式。
 */
function decodeCompiledFormula(tokens: Buffer) {
  const stack: string[] = []

  for (let index = 0; index < tokens.length; ) {
    const opcode = tokens[index]

    if (PTG_REF.has(opcode)) {
      if (index + 3 >= tokens.length) return null
      const rowIndex = (tokens.readUInt16LE(index + 1) & 0x3fff) - 1
      const colIndex = tokens[index + 3] & 0x3f
      if (rowIndex < 0) return null
      stack.push(getCellAddress(rowIndex, colIndex))
      index += 4
      continue
    }

    // 区域引用：rowFirst:2 rowLast:2 colFirst:1 colLast:1
    if (PTG_AREA.has(opcode)) {
      if (index + 6 >= tokens.length) return null
      const rowFirst = (tokens.readUInt16LE(index + 1) & 0x3fff) - 1
      const rowLast = (tokens.readUInt16LE(index + 3) & 0x3fff) - 1
      const colFirst = tokens[index + 5] & 0x3f
      const colLast = tokens[index + 6] & 0x3f
      if (rowFirst < 0 || rowLast < 0) return null
      stack.push(`${getCellAddress(rowFirst, colFirst)}:${getCellAddress(rowLast, colLast)}`)
      index += 7
      continue
    }

    if (opcode === 0x1e) {
      if (index + 2 >= tokens.length) return null
      stack.push(String(tokens.readInt16LE(index + 1)))
      index += 3
      continue
    }

    if (opcode === 0x1f) {
      if (index + 8 >= tokens.length) return null
      stack.push(formatNumericLiteral(tokens.readDoubleLE(index + 1)))
      index += 9
      continue
    }

    // 字符串字面量：`[0x17][字节数:1][GB 编码内容]`
    if (opcode === 0x17) {
      if (index + 1 >= tokens.length) return null
      const length = tokens[index + 1]
      if (index + 2 + length > tokens.length) return null
      const text = iconv
        .decode(tokens.subarray(index + 2, index + 2 + length), 'gb18030')
        .replace(/\0/g, '')
      // Excel 用两个双引号表示一个字面量双引号
      stack.push(`"${text.replace(/"/g, '""')}"`)
      index += 2 + length
      continue
    }

    // 一元正负与百分号，以及多余的括号标记（后者对表达式没有影响，我们本来就按需补括号）
    if (opcode === 0x12 || opcode === 0x13 || opcode === 0x14) {
      const operand = stack.pop()
      if (operand === undefined) return null
      stack.push(opcode === 0x12 ? `(+${operand})` : opcode === 0x13 ? `(-${operand})` : `(${operand}%)`)
      index += 1
      continue
    }

    if (opcode === 0x15) {
      index += 1
      continue
    }

    if (opcode === 0x19) {
      if (index + 3 >= tokens.length) return null
      const flags = tokens[index + 1]
      if (flags & PTG_ATTR_SUM) {
        const operand = stack.pop()
        if (operand === undefined) return null
        stack.push(`SUM(${stripOuterParentheses(operand)})`)
        index += 4
        continue
      }
      // IF 的跳转标记之类：不影响取值，跳过
      if (flags & PTG_ATTR_IGNORABLE) {
        index += 4
        continue
      }
      return null
    }

    if (PTG_COMPARISON[opcode]) {
      const right = stack.pop()
      const left = stack.pop()
      if (left === undefined || right === undefined) return null
      stack.push(`(${left}${PTG_COMPARISON[opcode]}${right})`)
      index += 1
      continue
    }

    // 变参函数：参数个数由 token 给出
    if (PTG_FUNC_VAR.has(opcode)) {
      if (index + 3 >= tokens.length) return null
      const argCount = tokens[index + 1] & 0x7f
      const fn = COMPILED_FUNCTIONS[tokens.readUInt16LE(index + 2)]
      if (!fn) return null
      const args: string[] = []
      for (let i = 0; i < argCount; i += 1) {
        const arg = stack.pop()
        if (arg === undefined) return null
        args.unshift(stripOuterParentheses(arg))
      }
      stack.push(`${fn.name}(${args.join(',')})`)
      index += 4
      continue
    }

    if (PTG_FUNC.has(opcode)) {
      if (index + 2 >= tokens.length) return null
      const fn = COMPILED_FUNCTIONS[tokens.readUInt16LE(index + 1)]
      if (!fn) return null
      const args: string[] = []
      for (let i = 0; i < fn.argCount; i += 1) {
        const arg = stack.pop()
        if (arg === undefined) return null
        args.unshift(stripOuterParentheses(arg))
      }
      stack.push(`${fn.name}(${args.join(',')})`)
      index += 3
      continue
    }

    if (opcode === 0x03 || opcode === 0x04 || opcode === 0x05 || opcode === 0x06) {
      const right = stack.pop()
      const left = stack.pop()
      if (!left || !right) return null
      const operator = opcode === 0x03
        ? '+'
        : opcode === 0x04
          ? '-'
          : opcode === 0x05
            ? '*'
            : '/'
      stack.push(`(${left}${operator}${right})`)
      index += 1
      continue
    }

    return null
  }

  if (stack.length !== 1) {
    return null
  }

  return `=${stripOuterParentheses(stack[0])}`
}

type ParsedFont = {
  /** 磅值 */
  pt: number
  bold: boolean
  /** 已归一到 useReportCellStyle 的 font-family token，取不到则为空 */
  family: string
}

/** FONT 记录至少要有到字体名长度那一字节 */
const FONT_MIN_LENGTH = 15
/** 合理的字号范围（twips，1pt = 20twips）：4pt ~ 40pt */
const FONT_MIN_TWIPS = 80
const FONT_MAX_TWIPS = 800

/** vts 里的中文/英文字体名 → style_key 的 font-family token */
const FONT_FAMILY_MAP: Array<[RegExp, string]> = [
  [/^宋体|SimSun/i, 'SimSun'],
  [/^黑体|SimHei/i, 'SimHei'],
  [/^楷体|KaiTi/i, 'KaiTi'],
  [/^仿宋|FangSong/i, 'FangSong'],
  [/^微软雅黑|Microsoft\s*YaHei/i, 'Microsoft-YaHei'],
]

/**
 * 还原字体表。
 *
 * 与 XF 一样走链式扫描，但 FONT 记录长度可变、更容易在 desync 后误命中，
 * 因此逐条做合理性校验（字号 4~40pt、粗细为常见档位、字体名可打印）；
 * **校验不过的用 null 占位而不是丢弃**——XF 是按下标引用字体的，丢一条后面全错位。
 */
function parseFontTable(buffer: Buffer): Array<ParsedFont | null> {
  const fonts: Array<ParsedFont | null> = []
  let offset = 0
  while (offset + 2 <= buffer.length) {
    const opcode = buffer[offset]
    const length = buffer[offset + 1]
    if (offset + 2 + length > buffer.length) break
    if (opcode === 0x31 && length >= FONT_MIN_LENGTH) {
      fonts.push(parseFontRecord(buffer.subarray(offset + 2, offset + 2 + length)))
    }
    offset += 2 + length
  }
  return fonts
}

function parseFontRecord(data: Buffer): ParsedFont | null {
  const twips = data.readUInt16LE(0)
  const weight = data.readUInt16LE(6)
  const nameLength = data[14]
  if (twips < FONT_MIN_TWIPS || twips > FONT_MAX_TWIPS) return null
  if (weight !== 400 && weight !== 500 && weight !== 600 && weight !== 700) return null
  if (!nameLength || nameLength > 32 || 15 + nameLength > data.length) return null

  let name = ''
  try {
    name = iconv.decode(data.subarray(15, 15 + nameLength), 'gb18030').replace(/\0/g, '').trim()
  } catch {
    return null
  }
  if (!name || /[\ue000-\uf8ff]/u.test(name)) return null

  const matched = FONT_FAMILY_MAP.find(([pattern]) => pattern.test(name))
  return { pt: twips / 20, bold: weight >= 700, family: matched ? matched[1] : '' }
}

/**
 * XF 里的字体下标要修正后才能查表。
 *
 * BIFF 的历史遗留：下标 4 是保留位、字体表里并不存在这一项，所以 >= 5 的下标要减 1。
 * 实测正是如此——不减 1 的话「纳税人名称」这类正文会被判成 24pt，减 1 后
 * 正文 11pt、表头 12pt 粗体、标题 24pt 粗体，与原报表一致。
 */
function resolveFontIndex(rawIndex: number) {
  return rawIndex >= 5 ? rawIndex - 1 : rawIndex
}

/** 磅转像素：CSS 里 1pt = 4/3 px */
function ptToPx(pt: number) {
  return Math.round((pt * 4) / 3)
}

/**
 * 从 vts 里还原格式表（XF），用于给单元格带上原报表的对齐与边框。
 *
 * vts 的记录是 `[opcode:1][length:1][data]`：这一层能按记录链走通，格式表（0xE0，20 字节）
 * 集中在文件前部，链式扫描足以完整收集。而**单元格**记录不能这么读——链式扫描在文件中段
 * 容易 desync 丢数据，这正是下面 parseTextRecords 用滑动窗口 + 字段合理性校验的原因。
 * 两者配合：滑动窗口拿单元格（可靠），链式扫描拿格式表（完整），再按 style 索引对应。
 * 实测 15 张报表的索引命中率均为 100%。
 */
function parseXfTable(buffer: Buffer): Buffer[] {
  const table: Buffer[] = []
  let offset = 0
  while (offset + 2 <= buffer.length) {
    const length = buffer[offset + 1]
    if (offset + 2 + length > buffer.length) break
    if (buffer[offset] === 0xe0 && length === XF_RECORD_LENGTH) {
      table.push(buffer.subarray(offset + 2, offset + 2 + XF_RECORD_LENGTH))
    }
    offset += 2 + length
  }
  return table
}

/** XF 记录长度；只认这个长度，避免把别的 0xE0 记录误当格式项 */
const XF_RECORD_LENGTH = 20

/** XF 第 6 字节的低 3 位是水平对齐，取值同 BIFF：0 常规 1 左 2 中 3 右 4 填充 5 两端 6 跨列居中 */
const XF_ALIGN_TOKENS = ['', 'left', 'center', 'right', '', '', 'center']

/** 水平对齐取值 6 = center across selection：老报表的跨列标题就是靠它，而非合并单元格 */
const XF_ALIGN_CENTER_ACROSS = 6

function isCenterAcross(xf: Buffer | undefined) {
  return Boolean(xf && xf.length >= XF_RECORD_LENGTH && (xf[6] & 0x07) === XF_ALIGN_CENTER_ACROSS)
}

/**
 * 把一条 XF 映射成 style_key。
 *
 * 只取两样最能还原报表原貌的信息：水平对齐、有无边框。
 * 边框不逐边解析——该 vts 的 XF 前 7 字节符合 BIFF8 布局（对齐已逐条比对无误），
 * 但其后是润衡自定义的，逐边逆向风险高收益低；实测报表主体 383 格中 378 格带边框，
 * 统一按「全部框线」还原即可满足实际需要。
 */
function xfToStyleKey(xf: Buffer | undefined, fonts: Array<ParsedFont | null> = []): string | null {
  if (!xf || xf.length < XF_RECORD_LENGTH) return null
  const tokens: string[] = []

  const align = XF_ALIGN_TOKENS[xf[6] & 0x07]
  if (align) tokens.push(`align-${align}`)

  const font = fonts[resolveFontIndex(xf.readUInt16LE(0))]
  if (font) {
    tokens.push(`font-size-${ptToPx(font.pt)}`)
    if (font.bold) tokens.push('font-bold')
    if (font.family) tokens.push(`font-family-${font.family}`)
  }

  let hasBorder = false
  for (let index = 10; index < 18; index += 1) {
    if (xf[index] !== 0) {
      hasBorder = true
      break
    }
  }
  if (hasBorder) tokens.push('border-all')

  return tokens.length ? tokens.join(' ') : null
}

function parseTextRecords(
  buffer: Buffer,
  xfTable: Buffer[],
  fonts: Array<ParsedFont | null>
): BinaryCellRecord[] {
  const records: BinaryCellRecord[] = []

  for (let offset = 0; offset <= buffer.length - 10; offset += 1) {
    if (buffer[offset] !== 0x04) continue
    const recordLength = buffer[offset + 1]
    if (recordLength < 8 || offset + 2 + recordLength > buffer.length) continue

    const rowIndex = buffer.readUInt16LE(offset + 2)
    const colIndex = buffer.readUInt16LE(offset + 4)
    const style = buffer.readUInt16LE(offset + 6)
    const textLength = buffer.readUInt16LE(offset + 8)

    if (rowIndex === 0 || colIndex > 64 || style > 0x2000) continue
    if (textLength <= 0 || textLength !== recordLength - 8 || textLength > 240) continue

    const rawText = iconv
      .decode(buffer.subarray(offset + 10, offset + 10 + textLength), 'gb18030')
      .replace(/\0/g, '')
      .trim()

    if (!rawText || /[\ue000-\uf8ff]/u.test(rawText)) continue

    const isFormula = rawText.startsWith('@') || rawText.startsWith('=')
    records.push({
      offset,
      rowIndex: rowIndex - 1,
      colIndex,
      cellType: isFormula ? 'formula' : 'text',
      textValue: isFormula ? null : rawText,
      formulaText: isFormula ? rawText : null,
      styleKey: xfToStyleKey(xfTable[style], fonts),
      centerAcross: isCenterAcross(xfTable[style]),
    })
  }

  return records
}

/**
 * 编译公式记录 0x06 的记录头布局（从 data 段起算）：
 *   row:2  col:2  style:2  缓存结果(double):8  保留:6  tokenLength:2  = 22 字节，其后是 token 段。
 *
 * 旧实现把 tokenLength 读在了 token 段的起始位置（偏移多了 2），读出的长度必然过不了
 * 长度校验，于是**每一条编译公式都被静默丢弃**——包括合计行的 `=SUM(...)`。
 */
const COMPILED_HEADER_LENGTH = 22
/** tokenLength 在 data 段内的偏移 */
const COMPILED_TOKEN_LENGTH_AT = 20
/** 整条公式就是一个数字字面量 —— 缓存值的特征 */
const CACHED_LITERAL_RE = /^=-?\d+(\.\d+)?$/

function parseCompiledFormulaRecords(
  buffer: Buffer,
  warnings: string[],
  xfTable: Buffer[],
  fonts: Array<ParsedFont | null>
): BinaryCellRecord[] {
  const records: BinaryCellRecord[] = []

  for (let offset = 0; offset <= buffer.length - COMPILED_HEADER_LENGTH - 2; offset += 1) {
    if (buffer[offset] !== 0x06) continue
    const recordLength = buffer[offset + 1]
    if (recordLength <= COMPILED_HEADER_LENGTH || offset + 2 + recordLength > buffer.length) continue

    const rowIndex = buffer.readUInt16LE(offset + 2)
    const colIndex = buffer.readUInt16LE(offset + 4)
    const style = buffer.readUInt16LE(offset + 6)
    const tokenLength = buffer.readUInt16LE(offset + 2 + COMPILED_TOKEN_LENGTH_AT)

    if (rowIndex === 0 || colIndex > 64 || style > 0x2000) continue
    // 记录尾部恰好等于 token 段：滑动窗口靠这条强约束排除假记录（实测 8936 条全部满足）
    if (tokenLength <= 0 || tokenLength !== recordLength - COMPILED_HEADER_LENGTH) continue

    const tokenStart = offset + 2 + COMPILED_HEADER_LENGTH
    const tokenBuffer = buffer.subarray(tokenStart, tokenStart + tokenLength)
    const formulaText = decodeCompiledFormula(tokenBuffer)

    if (!formulaText) {
      warnings.push(`未解析公式记录: row=${rowIndex} col=${colIndex} len=${tokenLength}`)
      continue
    }

    // token 段只有一个字面量时，这条记录存的是**上次算出来的缓存值**而不是公式
    // （实测占全部编译记录的三成）。当成公式落库会在报表里留下一个写死的过期数字，
    // 还会盖掉同一格的 @ 取数公式，因此直接丢弃，也不算「未解析」。
    if (CACHED_LITERAL_RE.test(formulaText)) continue

    records.push({
      offset,
      rowIndex: rowIndex - 1,
      colIndex,
      cellType: 'formula',
      textValue: null,
      formulaText,
      styleKey: xfToStyleKey(xfTable[style], fonts),
      centerAcross: isCenterAcross(xfTable[style]),
    })
  }

  return records
}

function parseVtsSheets(buffer: Buffer, fallbackName: string, warnings: string[]) {
  const xfTable = parseXfTable(buffer)
  const fonts = parseFontTable(buffer)
  const records = [
    ...parseTextRecords(buffer, xfTable, fonts),
    ...parseCompiledFormulaRecords(buffer, warnings, xfTable, fonts),
  ].sort((left, right) => left.offset - right.offset)

  if (records.length === 0) {
    return [] as ParsedAcdSheet[]
  }

  const sheets: ParsedAcdSheet[] = []
  let currentSheet: ParsedAcdSheet | null = null

  for (const record of records) {
    if (isSheetTitleCell(record)) {
      if (currentSheet && currentSheet.cells.length > 0) {
        sheets.push(currentSheet)
      }
      currentSheet = {
        name: String(record.textValue || fallbackName),
        index: sheets.length,
        cells: [],
      }
    }

    if (!currentSheet) {
      currentSheet = {
        name: fallbackName,
        index: sheets.length,
        cells: [],
      }
    }

    currentSheet.cells.push({
      rowIndex: record.rowIndex,
      colIndex: record.colIndex,
      cellType: record.cellType,
      textValue: record.textValue,
      formulaText: record.formulaText,
      styleKey: record.styleKey,
      centerAcross: record.centerAcross,
    })
  }

  if (currentSheet && currentSheet.cells.length > 0) {
    sheets.push(currentSheet)
  }

  return sheets
}

export function extractAcdReportTemplates(acdBuffer: Buffer) {
  const { texts, buffers } = parseAcdFileTables(acdBuffer)
  const warnings: string[] = []

  const reportCatalogEntry = Array.from(texts.entries()).find(([fileName]) => /bbml\.txt$/i.test(fileName))
  if (!reportCatalogEntry) {
    return {
      templates: [] as ParsedAcdTemplate[],
      warnings: ['ACD 中缺少 bbml.txt'],
    }
  }

  const reportRows = splitTableRows(reportCatalogEntry[1])
  const templateBuffers = new Map<string, Buffer>()
  for (const [fileName, buffer] of buffers.entries()) {
    const baseFileName = getBaseFileName(fileName)
    if (/^bb[\w]+\.vts$/i.test(baseFileName)) {
      templateBuffers.set(baseFileName, buffer)
    }
  }

  const templates: ParsedAcdTemplate[] = []
  for (const row of reportRows) {
    const reportCode = String(row[0] || '').trim()
    const reportName = String(row[1] || '').trim()
    if (!reportCode || !reportName) continue

    const sourceFile = `bb${reportCode.padStart(5, '0')}.vts`.toLowerCase()
    const buffer = templateBuffers.get(sourceFile)
    if (!buffer) continue

    let sheets: ParsedAcdSheet[]
    try {
      sheets = parseVtsSheets(buffer, reportName, warnings)
    } catch (error) {
      warnings.push(
        `跳过解析失败的报表模板: ${reportName} (${sourceFile}) - ${error instanceof Error ? error.message : String(error)}`
      )
      continue
    }
    const cellCount = sheets.reduce((sum, sheet) => sum + sheet.cells.length, 0)
    if (cellCount === 0) {
      warnings.push(`跳过空报表模板: ${reportName} (${sourceFile})`)
      continue
    }

    templates.push({
      reportCode,
      reportName,
      sourceFile,
      sheets,
    })
  }

  return { templates, warnings }
}

function getMatchedDefinitionIds(
  db: SqliteDatabase,
  accountSetId: string,
  reportName: string
) {
  const normalizedTarget = normalizeReportName(reportName)
  const definitions = db
    .prepare(
      `
      SELECT id, code, name
      FROM report_definitions
      WHERE account_set_id = ?
      ORDER BY sort_order ASC, created_at ASC, code ASC
      `
    )
    .all(accountSetId) as Array<{ id: string; code: string; name: string }>

  return definitions.filter(definition => normalizeReportName(definition.name) === normalizedTarget)
}

function getSheetIdsByDefinition(db: SqliteDatabase, definitionId: string) {
  return db
    .prepare(
      `
      SELECT id, sheet_index
      FROM report_sheets
      WHERE report_definition_id = ?
      ORDER BY sheet_index ASC
      `
    )
    .all(definitionId) as Array<{ id: string; sheet_index: number }>
}

/**
 * 把锚点位置按 (行,列) 去重后加入桶。
 * ACD（.vts 二进制）解析时同一文本单元格常被重复记录多次（同一行列出现 2~3 次），
 * 若不去重，下面「锚点必须在源/目标各恰好出现 1 次」的唯一性判断会把所有锚点判为多重并跳过，
 * 导致行偏移检测恒为 0；据此放置 ACD 公式会整体错位一行（典型：资产负债表货币资金上移到「流动资产：」表头行）。
 */
function addAnchorPosition(
  anchors: Map<string, Array<{ rowIndex: number; colIndex: number }>>,
  key: string,
  rowIndex: number,
  colIndex: number
) {
  const bucket = anchors.get(key)
  if (!bucket) {
    anchors.set(key, [{ rowIndex, colIndex }])
    return
  }
  if (bucket.some(pos => pos.rowIndex === rowIndex && pos.colIndex === colIndex)) {
    return
  }
  bucket.push({ rowIndex, colIndex })
}

export function resolveSheetOffset(
  sourceSheet: ParsedAcdSheet,
  targetCells: Array<{
    row_index: number
    col_index: number
    cell_type: string
    text_value: string | null
  }>
) {
  const sourceAnchors = new Map<string, Array<{ rowIndex: number; colIndex: number }>>()
  const targetAnchors = new Map<string, Array<{ rowIndex: number; colIndex: number }>>()

  for (const cell of sourceSheet.cells) {
    if (cell.cellType !== 'text' || !cell.textValue) continue
    const key = normalizeAnchorText(cell.textValue)
    if (!key || key.length < 2) continue
    addAnchorPosition(sourceAnchors, key, cell.rowIndex, cell.colIndex)
  }

  for (const cell of targetCells) {
    if (cell.cell_type === 'formula' || !cell.text_value) continue
    const key = normalizeAnchorText(cell.text_value)
    if (!key || key.length < 2) continue
    addAnchorPosition(targetAnchors, key, cell.row_index, cell.col_index)
  }

  const deltaCounts = new Map<string, number>()
  for (const [key, sourcePositions] of sourceAnchors.entries()) {
    const targetPositions = targetAnchors.get(key)
    if (!targetPositions) continue
    if (sourcePositions.length !== 1 || targetPositions.length !== 1) continue

    const deltaRow = targetPositions[0].rowIndex - sourcePositions[0].rowIndex
    const deltaCol = targetPositions[0].colIndex - sourcePositions[0].colIndex
    const deltaKey = `${deltaRow}:${deltaCol}`
    deltaCounts.set(deltaKey, (deltaCounts.get(deltaKey) || 0) + 1)
  }

  let bestRowDelta = 0
  let bestColDelta = 0
  let bestCount = 0
  let bestDistance = Number.POSITIVE_INFINITY

  for (const [deltaKey, count] of deltaCounts.entries()) {
    const [rowPart, colPart] = deltaKey.split(':')
    const rowDelta = Number(rowPart)
    const colDelta = Number(colPart)
    const distance = Math.abs(rowDelta) + Math.abs(colDelta)
    if (
      count > bestCount ||
      (count === bestCount && distance < bestDistance)
    ) {
      bestRowDelta = rowDelta
      bestColDelta = colDelta
      bestCount = count
      bestDistance = distance
    }
  }

  return {
    rowDelta: bestRowDelta,
    colDelta: bestColDelta,
    matchCount: bestCount,
  }
}

export function syncAcdReportFormulasToAccountSet(
  db: SqliteDatabase,
  accountSetId: string,
  acdBuffer: Buffer
) {
  const { templates, warnings } = extractAcdReportTemplates(acdBuffer)
  const stats: SyncStats = {
    matchedReports: 0,
    matchedSheets: 0,
    updatedCells: 0,
    insertedCells: 0,
    skippedUnsupportedFormulas: warnings.filter(item => item.startsWith('未解析公式记录')).length,
    warnings: [...warnings],
  }

  const updateCell = db.prepare(
    `
    UPDATE report_cells
    SET cell_type = 'formula',
        text_value = NULL,
        formula_text = ?,
        updated_at = datetime('now')
    WHERE id = ?
    `
  )

  const insertCell = db.prepare(
    `
    INSERT INTO report_cells (
      id, report_sheet_id, row_index, col_index, cell_type, text_value, formula_text,
      format_text, style_key, side, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'formula', NULL, ?, NULL, NULL, NULL, datetime('now'), datetime('now'))
    `
  )

  const clearFormulaCell = db.prepare(
    `
    UPDATE report_cells
    SET cell_type = CASE
          WHEN text_value IS NULL OR trim(text_value) = '' THEN 'empty'
          ELSE 'text'
        END,
        formula_text = NULL,
        updated_at = datetime('now')
    WHERE report_sheet_id = ?
      AND row_index = ?
      AND col_index = ?
      AND cell_type = 'formula'
    `
  )

  const transaction = db.transaction(() => {
    for (const template of templates) {
      const definitionIds = getMatchedDefinitionIds(db, accountSetId, template.reportName)
      if (definitionIds.length === 0) {
        continue
      }

      for (const definition of definitionIds) {
        stats.matchedReports += 1
        const sheets = getSheetIdsByDefinition(db, definition.id)
        const sheetCount = Math.min(sheets.length, template.sheets.length)
        stats.matchedSheets += sheetCount

        for (let index = 0; index < sheetCount; index += 1) {
          const targetSheet = sheets[index]
          const sourceSheet = template.sheets[index]
          const existingCells = db
            .prepare(
              `
              SELECT id, row_index, col_index, formula_text, cell_type, text_value
              FROM report_cells
              WHERE report_sheet_id = ?
              `
            )
            .all(targetSheet.id) as Array<{
            id: string
            row_index: number
            col_index: number
            formula_text: string | null
            cell_type: string
            text_value: string | null
          }>

          const { rowDelta, colDelta, matchCount } = resolveSheetOffset(sourceSheet, existingCells)
          if ((rowDelta !== 0 || colDelta !== 0) && matchCount > 0) {
            stats.warnings.push(
              `报表 ${template.reportName} 第 ${index + 1} 个工作表应用坐标偏移 row=${rowDelta}, col=${colDelta}`
            )
          }

          const existingCellMap = new Map(
            existingCells.map(cell => [`${cell.row_index}:${cell.col_index}`, cell])
          )
          const processedKeys = new Set<string>()
          const offsetApplied = rowDelta !== 0 || colDelta !== 0

          if (offsetApplied) {
            // 仅清理「上一次同步因偏移错位而残留的同一条 ACD 公式」，避免误删 Excel 模板
            // 在 ACD 公式原始行位上合法存在的小计公式（如「非流动负债合计」=E22+E23+E24+E25，
            // 该公式不在 ACD 中，但其行号恰好与某条 ACD 数据公式的原始行重合）。
            for (const cell of sourceSheet.cells) {
              if (!cell.formulaText) continue
              const rawKey = `${cell.rowIndex}:${cell.colIndex}`
              const existing = existingCellMap.get(rawKey)
              if (!existing || existing.cell_type !== 'formula') continue
              if (existing.formula_text !== cell.formulaText) continue
              clearFormulaCell.run(targetSheet.id, cell.rowIndex, cell.colIndex)
            }
          }

          for (const cell of sourceSheet.cells) {
            if (!cell.formulaText) continue

            const targetRowIndex = cell.rowIndex + rowDelta
            const targetColIndex = cell.colIndex + colDelta
            if (targetRowIndex < 0 || targetColIndex < 0) {
              continue
            }

            const key = `${targetRowIndex}:${targetColIndex}`
            if (processedKeys.has(key)) {
              continue
            }
            processedKeys.add(key)
            const existing = existingCellMap.get(key)

            if (existing) {
              if (
                !offsetApplied &&
                existing.cell_type === 'formula' &&
                existing.formula_text === cell.formulaText
              ) {
                continue
              }
              const result = updateCell.run(cell.formulaText, existing.id)
              stats.updatedCells += result.changes
              continue
            }

            insertCell.run(
              uuidv4(),
              targetSheet.id,
              targetRowIndex,
              targetColIndex,
              cell.formulaText
            )
            stats.insertedCells += 1
          }
        }
      }
    }
  })

  transaction()
  fixCashFlowReportFormulas(accountSetId, db)
  fixBudgetSurplusReportFormulas(accountSetId, db)

  // 按 ACD 目录顺序重排报表 sort_order，使导入结果与模板原始顺序一致
  const updateSortOrder = db.prepare(
    `UPDATE report_definitions SET sort_order = ?, updated_at = datetime('now') WHERE id = ? AND account_set_id = ?`
  )
  const reassignOrder = db.transaction(() => {
    const matchedIds = new Set<string>()
    let idx = 1
    for (const template of templates) {
      const defs = getMatchedDefinitionIds(db, accountSetId, template.reportName)
      for (const def of defs) {
        updateSortOrder.run(idx, def.id, accountSetId)
        matchedIds.add(def.id)
        idx++
      }
    }
    // 未匹配到 ACD 目录的报表排在末尾，保持其相对顺序
    const unmatched = db
      .prepare(
        `SELECT id FROM report_definitions WHERE account_set_id = ? ORDER BY sort_order ASC, created_at ASC`
      )
      .all(accountSetId) as Array<{ id: string }>
    for (const row of unmatched) {
      if (!matchedIds.has(row.id)) {
        updateSortOrder.run(idx, row.id, accountSetId)
        idx++
      }
    }
  })
  reassignOrder()

  return stats
}
