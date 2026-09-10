import type { Database as SqliteDatabase } from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'
import iconv from 'iconv-lite'
import xlsx from 'xlsx'

import { parseAcdFileTables, splitTableRows } from '../scripts/importAcdToCurrentAccountSet.js'
import { fixCashFlowReportFormulas } from '../scripts/fixCashFlowReportFormulas.js'
import { fixBudgetSurplusReportFormulas } from '../scripts/fixBudgetSurplusReportFormulas.js'

type ParsedAcdCell = {
  rowIndex: number
  colIndex: number
  /** number = vts 里的数字常量格（RK/NUMBER/INTEGER 记录），如行次列手工填的 5、6、7 */
  cellType: 'text' | 'formula' | 'number'
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

/**
 * 从 vts 还原出的版面：按列下标的列宽（px）与按行下标的行高（px），稀疏数组，缺项表示 vts 没给。
 * 行下标与单元格同基准（vts 的第 0 行是空的占位行，单元格记录已整体上移一行，这里同样处理）。
 */
export type AcdSheetLayout = {
  colWidthsPx: Array<number | undefined>
  rowHeightsPx: Array<number | undefined>
}

type ParsedAcdTemplate = {
  reportCode: string
  reportName: string
  sourceFile: string
  sheets: ParsedAcdSheet[]
  /** 版面只在第一个 sheet（呈现版）里有 COLINFO/ROW 记录，后续公式版共用同一套 */
  layout: AcdSheetLayout
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
function decodeCompiledFormula(tokens: Buffer, wideRefs = false) {
  const stack: string[] = []
  // 老版引用 token 是 BIFF5 式（列 1 字节、行高 2 位是相对标志）；新版是 BIFF8 式（列 2 字节、相对标志在列的高 2 位）
  const colWidth = wideRefs ? 2 : 1
  const readCol = (at: number) => (wideRefs ? tokens.readUInt16LE(at) & 0x3fff : tokens[at] & 0x3f)

  for (let index = 0; index < tokens.length; ) {
    const opcode = tokens[index]

    if (PTG_REF.has(opcode)) {
      const size = 1 + 2 + colWidth
      if (index + size > tokens.length) return null
      const rowIndex = (tokens.readUInt16LE(index + 1) & 0x3fff) - 1
      const colIndex = readCol(index + 3)
      if (rowIndex < 0) return null
      stack.push(getCellAddress(rowIndex, colIndex))
      index += size
      continue
    }

    // 区域引用：rowFirst:2 rowLast:2 colFirst colLast（列宽随版本 1/2 字节）
    if (PTG_AREA.has(opcode)) {
      const size = 1 + 4 + colWidth * 2
      if (index + size > tokens.length) return null
      const rowFirst = (tokens.readUInt16LE(index + 1) & 0x3fff) - 1
      const rowLast = (tokens.readUInt16LE(index + 3) & 0x3fff) - 1
      const colFirst = readCol(index + 5)
      const colLast = readCol(index + 5 + colWidth)
      if (rowFirst < 0 || rowLast < 0) return null
      stack.push(`${getCellAddress(rowFirst, colFirst)}:${getCellAddress(rowLast, colLast)}`)
      index += size
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

    // 字符串字面量：老版 `[0x17][字节数:1][GB 编码内容]`；新版 `[0x17][字符数:1][flags:1][内容]`，flags bit0 为 UTF-16
    if (opcode === 0x17) {
      if (index + 1 >= tokens.length) return null
      const length = tokens[index + 1]
      let text: string
      let size: number
      if (wideRefs) {
        const unicode = (tokens[index + 2] & 0x01) === 0x01
        const byteLength = unicode ? length * 2 : length
        if (index + 3 + byteLength > tokens.length) return null
        const body = tokens.subarray(index + 3, index + 3 + byteLength)
        text = unicode ? body.toString('utf16le') : iconv.decode(body, 'gb18030')
        size = 3 + byteLength
      } else {
        if (index + 2 + length > tokens.length) return null
        text = iconv.decode(tokens.subarray(index + 2, index + 2 + length), 'gb18030')
        size = 2 + length
      }
      // Excel 用两个双引号表示一个字面量双引号
      stack.push(`"${text.replace(/\0/g, '').replace(/"/g, '""')}"`)
      index += size
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
  if (!nameLength || nameLength > 32) return null

  // 字体名与文本记录同样分两代：老版 `[n:1][n 字节 GBK]`；新版 `[n:1][flags:1][正文]`，flags bit0 为 UTF-16
  let name = ''
  try {
    // 新版 flags 字节只会是 0/1，作为 GBK 首字节是控制字符，字体名不可能以它开头——据此区分两代布局
    const isNewLayout = data[15] <= 0x01
    if (!isNewLayout) {
      if (15 + nameLength > data.length) return null
      name = iconv.decode(data.subarray(15, 15 + nameLength), 'gb18030')
    } else {
      const unicode = (data[15] & 0x01) === 0x01
      const byteLength = unicode ? nameLength * 2 : nameLength
      if (16 + byteLength > data.length) return null
      const body = data.subarray(16, 16 + byteLength)
      name = unicode ? body.toString('utf16le') : iconv.decode(body, 'gb18030')
    }
    name = name.replace(/\0/g, '').trim()
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
    if (buffer[offset] === 0xe0 && (length === XF_RECORD_LENGTH || length === XF_RECORD_LENGTH_V2)) {
      table.push(buffer.subarray(offset + 2, offset + 2 + length))
    }
    offset += 2 + length
  }
  return table
}

/** XF 记录长度；只认这两个长度，避免把别的 0xE0 记录误当格式项 */
const XF_RECORD_LENGTH = 20
/**
 * 新版（文本记录带 flags 字节的那一代）XF 是 24 字节：第 7 字节插入了旋转角度、第 8 字节插入了缩进，
 * 原第 7 字节的标志位后移到第 9 字节，边框段仍在 10~17 字节，所以下面按下标取对齐/字体/边框的逻辑两代通用。
 * 已用同一张现金流量表的两代文件逐条比对 XF #39~#57，对齐、字体下标、有无边框完全一致。
 */
const XF_RECORD_LENGTH_V2 = 24

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

/** 文本记录头：row:2 col:2 xf:2 charCount:2 */
const TEXT_HEADER_LENGTH = 8
/** 单格文本最多多少个字符（老版按字节、新版按字符），超出即视为误命中 */
const TEXT_MAX_CHARS = 240

/**
 * 解出文本记录的正文。vts 有两代文本记录布局，按记录长度自动区分：
 *   老版：`[0x04][len][row][col][xf][n:2][n 字节 GBK]`，len = 8 + n；
 *   新版：`[0x04][len][row][col][xf][n:2][flags:1][正文]`，flags bit0 = 1 时正文为 n 个 UTF-16LE 字符
 *         （2n 字节），为 0 时是 n 字节单字节文本；len = 9 + 正文字节数。
 * 新版是较新的润衡导出的（如 2025 年的 ZW04 绿环 BVI），中文全部走 UTF-16，
 * 旧解析器按老版布局校验长度全部落空，整份 ACD 19 张报表有 18 张被当成空模板跳过。
 */
function decodeTextRecordBody(
  buffer: Buffer,
  dataStart: number,
  recordLength: number,
  charCount: number
): { text: string; layout: TextLayout } | null {
  if (charCount <= 0 || charCount > TEXT_MAX_CHARS) return null
  const bodyStart = dataStart + TEXT_HEADER_LENGTH
  if (recordLength === TEXT_HEADER_LENGTH + charCount) {
    return { text: iconv.decode(buffer.subarray(bodyStart, bodyStart + charCount), 'gb18030'), layout: 'legacy' }
  }
  const flags = buffer[bodyStart]
  if (flags > 0x01) return null
  const unicode = flags === 0x01
  const byteLength = unicode ? charCount * 2 : charCount
  if (recordLength !== TEXT_HEADER_LENGTH + 1 + byteLength) return null
  const body = buffer.subarray(bodyStart + 1, bodyStart + 1 + byteLength)
  return { text: unicode ? body.toString('utf16le') : iconv.decode(body, 'gb18030'), layout: 'flagged' }
}

/**
 * 文本记录的两代布局，同时决定编译公式里引用 token 的宽度：
 * legacy（老版）配 BIFF5 式引用（列 1 字节），flagged（新版）配 BIFF8 式引用（列 2 字节）。
 */
type TextLayout = 'legacy' | 'flagged'

function parseTextRecords(
  buffer: Buffer,
  xfTable: Buffer[],
  fonts: Array<ParsedFont | null>
): { records: BinaryCellRecord[]; layout: TextLayout } {
  const records: BinaryCellRecord[] = []
  const layoutVotes: Record<TextLayout, number> = { legacy: 0, flagged: 0 }

  for (let offset = 0; offset <= buffer.length - 10; offset += 1) {
    if (buffer[offset] !== 0x04) continue
    const recordLength = buffer[offset + 1]
    if (recordLength < TEXT_HEADER_LENGTH + 1 || offset + 2 + recordLength > buffer.length) continue

    const rowIndex = buffer.readUInt16LE(offset + 2)
    const colIndex = buffer.readUInt16LE(offset + 4)
    const style = buffer.readUInt16LE(offset + 6)
    const textLength = buffer.readUInt16LE(offset + 8)

    if (rowIndex === 0 || colIndex > 64 || style > 0x2000) continue

    const decoded = decodeTextRecordBody(buffer, offset + 2, recordLength, textLength)
    if (decoded === null) continue
    const rawText = decoded.text.replace(/\0/g, '').trim()

    if (!rawText || /[\ue000-\uf8ff]/u.test(rawText)) continue

    layoutVotes[decoded.layout] += 1
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

  return { records, layout: layoutVotes.flagged > layoutVotes.legacy ? 'flagged' : 'legacy' }
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
  fonts: Array<ParsedFont | null>,
  layout: TextLayout = 'legacy'
): BinaryCellRecord[] {
  const wideRefs = layout === 'flagged'
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
    const formulaText = decodeCompiledFormula(tokenBuffer, wideRefs)

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

/**
 * 数值常量记录**没有长度字节**：`[opcode][row:2][col:2][xf:2][value]`，value 依记录类型定长。
 * 这也是链式扫描一到单元格区就 desync 的根源——碰到第一条 RK 就把值当成了长度。
 *
 * 行次列里手工敲的数字（如新准则模板里应收票据~预付款项的 5/6/7/8）就存成 RK 记录，
 * 旧实现只认文本与公式，这些格子被整体丢掉，其下 `=B12+1` 就从 1 重新起算，行号全错。
 */
const NUMBER_RECORD_DATA_LENGTH: Record<number, number> = {
  0x7e: 10, // RK：4 字节压缩数值
  0x03: 14, // NUMBER：8 字节 double
}

/**
 * 单元格记录之后紧跟的记录类型（另一格 / 空格 / 行尾 EOF 等）。
 * 数值记录无长度字节可校验，滑动窗口靠「下一字节必须是合法记录头」排除误命中，
 * 实测标准模板 1200 余条命中里只有这些取值。
 */
const CELL_FOLLOWER_OPCODES = new Set([
  0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x0a, 0x1c, 0x5d, 0x7e, 0xbd, 0xbe, 0xd6, 0xfd,
])

/** RK 编码：低两位是标志（bit1 整数、bit0 除以 100），其余 30 位是整数或 double 的高 30 位 */
function decodeRkValue(raw: number) {
  const isInteger = (raw & 2) !== 0
  const divideBy100 = (raw & 1) !== 0
  let value: number
  if (isInteger) {
    value = raw >> 2
  } else {
    const scratch = Buffer.alloc(8)
    scratch.writeInt32LE(raw & ~3, 4)
    value = scratch.readDoubleLE(0)
  }
  return divideBy100 ? value / 100 : value
}

/**
 * @param startOffset 只认此偏移之后的记录：单元格按行序存放，每个 sheet 的第一格都是标题文本，
 *   数值格必然在首条文本/公式记录之后；文件头部（字体表、格式表、版面）里的同形字节一律不认。
 */
function parseNumberRecords(
  buffer: Buffer,
  xfTable: Buffer[],
  fonts: Array<ParsedFont | null>,
  startOffset: number
): BinaryCellRecord[] {
  const records: BinaryCellRecord[] = []
  // 没读出格式表时无法校验 xf，宁可不认数值记录，也不要把随机字节当成单元格
  if (xfTable.length === 0) return records

  for (let offset = Math.max(0, startOffset); offset < buffer.length - 1; offset += 1) {
    const dataLength = NUMBER_RECORD_DATA_LENGTH[buffer[offset]]
    if (!dataLength) continue
    const end = offset + 1 + dataLength
    if (end >= buffer.length) continue

    const rowIndex = buffer.readUInt16LE(offset + 1)
    const colIndex = buffer.readUInt16LE(offset + 3)
    const style = buffer.readUInt16LE(offset + 5)
    if (rowIndex === 0 || rowIndex > 1000 || colIndex > 64 || style >= xfTable.length) continue
    if (!CELL_FOLLOWER_OPCODES.has(buffer[end])) continue

    const value =
      buffer[offset] === 0x7e
        ? decodeRkValue(buffer.readInt32LE(offset + 7))
        : buffer.readDoubleLE(offset + 7)
    if (!Number.isFinite(value) || Math.abs(value) >= 1e15) continue

    records.push({
      offset,
      rowIndex: rowIndex - 1,
      colIndex,
      cellType: 'number',
      textValue: formatNumericLiteral(value),
      formulaText: null,
      styleKey: xfToStyleKey(xfTable[style], fonts),
      centerAcross: isCenterAcross(xfTable[style]),
    })
  }

  return records
}

/** COLINFO / ROW 记录同样没有长度字节，数据段定长 */
const COLINFO_DATA_LENGTH = 12
const ROW_DATA_LENGTH = 16
/** 列宽单位是默认字体一个字符宽的 1/256；数字字符宽约为字号的 0.556（Arial 比例） */
const COL_CHAR_WIDTH_RATIO = 0.556
/** 列宽换算后再加的左右留白（px） */
const COL_EXTRA_PX = 5
/** 行高单位 twips：1pt = 20twips，1pt = 4/3px，故 1px = 15twips */
const TWIPS_PER_PX = 15

/**
 * 还原版面（列宽、行高）。
 *
 * 只扫第一格单元格记录之前的区域：三个 sheet 里只有排在最前的呈现版带 COLINFO 与自定义行高
 * （ROW 记录 flags 含 0x40），后面的公式版行高全是默认值，读了也没用。
 * 单元格记录已把 vts 的行号整体减 1（第 0 行是空占位行），行高同样对齐。
 */
function parseSheetLayout(
  buffer: Buffer,
  firstCellOffset: number,
  fonts: Array<ParsedFont | null>
): AcdSheetLayout {
  const layout: AcdSheetLayout = { colWidthsPx: [], rowHeightsPx: [] }
  const defaultFontPt = fonts[0]?.pt || 12
  const charPx = ptToPx(defaultFontPt) * COL_CHAR_WIDTH_RATIO

  const limit = Math.min(firstCellOffset, buffer.length)
  for (let offset = 0; offset + 1 + ROW_DATA_LENGTH <= limit; offset += 1) {
    const opcode = buffer[offset]
    if (opcode === 0x7d) {
      const firstCol = buffer.readUInt16LE(offset + 1)
      const lastCol = buffer.readUInt16LE(offset + 3)
      const width = buffer.readUInt16LE(offset + 5)
      const style = buffer.readUInt16LE(offset + 7)
      if (firstCol > lastCol || lastCol > 64 || width === 0 || width > 30000 || style > 512) continue
      const px = Math.round((width / 256) * charPx + COL_EXTRA_PX)
      for (let col = firstCol; col <= lastCol; col += 1) layout.colWidthsPx[col] = px
      offset += COLINFO_DATA_LENGTH
      continue
    }
    if (opcode === 0x08) {
      const row = buffer.readUInt16LE(offset + 1)
      const firstCol = buffer.readUInt16LE(offset + 3)
      const lastCol = buffer.readUInt16LE(offset + 5)
      const twips = buffer.readUInt16LE(offset + 7)
      const reserved = buffer.readUInt32LE(offset + 9)
      if (row > 1000 || firstCol > lastCol || lastCol > 64 || reserved !== 0) continue
      if (twips < 60 || twips > 5000) continue
      // 第 0 行是占位行，单元格已整体上移一行
      if (row >= 1) layout.rowHeightsPx[row - 1] = Math.round(twips / TWIPS_PER_PX)
      offset += ROW_DATA_LENGTH
    }
  }
  return layout
}

export function parseVtsSheets(buffer: Buffer, fallbackName: string, warnings: string[]) {
  const xfTable = parseXfTable(buffer)
  const fonts = parseFontTable(buffer)
  const textResult = parseTextRecords(buffer, xfTable, fonts)
  const anchoredRecords = [
    ...textResult.records,
    ...parseCompiledFormulaRecords(buffer, warnings, xfTable, fonts, textResult.layout),
  ]
  if (anchoredRecords.length === 0) {
    return { sheets: [] as ParsedAcdSheet[], layout: { colWidthsPx: [], rowHeightsPx: [] } }
  }
  anchoredRecords.sort((left, right) => left.offset - right.offset)
  const firstCellOffset = anchoredRecords[0].offset
  const layout = parseSheetLayout(buffer, firstCellOffset, fonts)

  // 一个 vts 顺序存放同一报表的多个版本（呈现版 / @ 公式版 / 编译版），每个版本内部的单元格
  // 严格按 (row, col) 升序排列。因此「行列序回退」就是版本边界，比早先靠 r0c0 文本含「表」字
  // 判标题可靠得多——标题不含「表」、或首格不在 r0c0 的报表，旧法会把两个版本粘成一张。
  // 边界只用文本/公式记录来判：数值记录无长度字节、校验较弱，偶有误命中会制造假边界。
  const boundaries: number[] = []
  for (let index = 1; index < anchoredRecords.length; index += 1) {
    const prev = anchoredRecords[index - 1]
    const curr = anchoredRecords[index]
    const goesBack =
      curr.rowIndex < prev.rowIndex || (curr.rowIndex === prev.rowIndex && curr.colIndex < prev.colIndex)
    if (goesBack) boundaries.push(curr.offset)
  }

  const records = [
    ...anchoredRecords,
    ...parseNumberRecords(buffer, xfTable, fonts, firstCellOffset),
  ].sort((left, right) => left.offset - right.offset)

  const sheets: ParsedAcdSheet[] = []
  let currentSheet: ParsedAcdSheet | null = null
  let nextBoundary = 0

  for (const record of records) {
    const reachedBoundary = nextBoundary < boundaries.length && record.offset >= boundaries[nextBoundary]
    if (reachedBoundary) nextBoundary += 1
    if (!currentSheet || reachedBoundary) {
      if (currentSheet && currentSheet.cells.length > 0) {
        sheets.push(currentSheet)
      }
      currentSheet = {
        name: isSheetTitleCell(record) ? String(record.textValue || fallbackName) : fallbackName,
        index: sheets.length,
        cells: [],
      }
    }

    currentSheet!.cells.push({
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

  return { sheets, layout }
}

/** OLE2 复合文档魔数（真正的 BIFF8 .xls 工作簿） */
const OLE2_MAGIC = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])

function isOle2Workbook(buffer: Buffer) {
  return buffer.length > OLE2_MAGIC.length && buffer.subarray(0, OLE2_MAGIC.length).equals(OLE2_MAGIC)
}

/**
 * xlsx 库对 BIFF8 里的单字节字符串按 Latin-1 解码（未挂 codepage 表），中文会变成 `²¹³ä×ÊÁÏ` 这样的乱码；
 * 原字节其实是 GBK，按 Latin-1 还原字节后再以 gb18030 解码即可。全是 ASCII 或已含真正中文的串不动。
 */
function repairLatin1Gbk(value: string) {
  if (!/[\u0080-\u00ff]/.test(value) || /[\u0100-\uffff]/.test(value)) return value
  try {
    return iconv.decode(Buffer.from(value, 'latin1'), 'gb18030')
  } catch {
    return value
  }
}

/**
 * 第三代 vts：整个文件就是一个标准 Excel 97-2003 工作簿（如 2025 年的 ZW04 绿环 BVI 里 19 张报表中的 11 张）。
 * 交给 xlsx 库解析，再映射成与自研二进制解析器一致的 sheet/cell/layout 结构：
 *   - 字符串以 @ / = 开头 → 取数公式 / 表达式；带 f 的数值或错误格 → `=` 公式；纯数值 → number 常量；
 *   - 与自研格式一样，第 0 行是占位空行，单元格与行高整体上移一行；
 *   - 列宽/行高直接取 !cols / !rows 的像素值。
 * 社区版 xlsx 不解析单元格样式，styleKey 为空，边框由导入侧 fillTableBorders 统一补齐。
 */
export function parseOleVtsSheets(buffer: Buffer, fallbackName: string, warnings: string[]) {
  let workbook: xlsx.WorkBook
  try {
    workbook = xlsx.read(buffer, { type: 'buffer', cellStyles: true, cellFormula: true, cellNF: false })
  } catch (error) {
    warnings.push(`xlsx 解析 vts 失败: ${fallbackName} - ${error instanceof Error ? error.message : String(error)}`)
    return { sheets: [] as ParsedAcdSheet[], layout: { colWidthsPx: [], rowHeightsPx: [] } as AcdSheetLayout }
  }
  return mapWorkbookToSheets(workbook, fallbackName)
}

/** 把 xlsx 库读出的工作簿映射成 sheet/cell/layout；独立出来便于用内存工作簿做单测 */
export function mapWorkbookToSheets(workbook: xlsx.WorkBook, fallbackName: string) {
  const layout: AcdSheetLayout = { colWidthsPx: [], rowHeightsPx: [] }
  const sheets: ParsedAcdSheet[] = []
  workbook.SheetNames.forEach((sheetName, sheetIndex) => {
    const worksheet = workbook.Sheets[sheetName]
    if (!worksheet || !worksheet['!ref']) return
    const range = xlsx.utils.decode_range(worksheet['!ref'])
    const cells: ParsedAcdCell[] = []

    for (let row = Math.max(1, range.s.r); row <= range.e.r; row += 1) {
      for (let col = range.s.c; col <= range.e.c; col += 1) {
        const cell = worksheet[xlsx.utils.encode_cell({ r: row, c: col })] as xlsx.CellObject | undefined
        if (!cell) continue
        const parsed = mapWorkbookCell(cell)
        if (!parsed) continue
        cells.push({ rowIndex: row - 1, colIndex: col, styleKey: null, centerAcross: false, ...parsed })
      }
    }
    if (!cells.length) return

    // 版面只取第一个 sheet（呈现版）的，与自研格式一致
    if (sheets.length === 0) {
      ;(worksheet['!cols'] || []).forEach((info, index) => {
        if (info?.wpx && info.wpx > 0) layout.colWidthsPx[index] = Math.round(info.wpx)
      })
      ;(worksheet['!rows'] || []).forEach((info, index) => {
        if (index >= 1 && info?.hpx && info.hpx > 0) layout.rowHeightsPx[index - 1] = Math.round(info.hpx)
      })
    }

    const title = cells.find(cell => cell.rowIndex === 0 && cell.colIndex === 0 && cell.cellType === 'text')
    sheets.push({
      name: title?.textValue || sheetName || `${fallbackName}#${sheetIndex}`,
      index: sheets.length,
      cells,
    })
  })

  return { sheets, layout }
}

/**
 * 单元格整体上移一行后，`=` 表达式里的行号也要同步减 1（`=B8+1` → `=B7+1`），
 * 否则行次公式会指向自己。只改引号外的 A1 式引用；函数名（SUM、LOG10）后面紧跟 `(`，不会被误改。
 */
export function shiftFormulaRows(formula: string, delta: number) {
  return formula
    .split('"')
    .map((segment, index) => {
      if (index % 2 === 1) return segment
      return segment.replace(
        /(?<![A-Za-z0-9_.])(\$?)([A-Z]{1,3})(\$?)(\d+)(?![\d(])/g,
        (_match, colAbs: string, col: string, rowAbs: string, row: string) => {
          const shifted = Number(row) + delta
          return shifted >= 1 ? `${colAbs}${col}${rowAbs}${shifted}` : `${colAbs}${col}${rowAbs}${row}`
        }
      )
    })
    .join('"')
}

function mapWorkbookCell(
  cell: xlsx.CellObject
): Pick<ParsedAcdCell, 'cellType' | 'textValue' | 'formulaText'> | null {
  if (cell.f) {
    return { cellType: 'formula', textValue: null, formulaText: `=${shiftFormulaRows(cell.f, -1)}` }
  }
  if (cell.t === 's' || cell.t === 'str') {
    const text = repairLatin1Gbk(String(cell.v ?? '')).replace(/\0/g, '').trim()
    if (!text) return null
    const isFormula = text.startsWith('@') || text.startsWith('=')
    return {
      cellType: isFormula ? 'formula' : 'text',
      textValue: isFormula ? null : text,
      formulaText: isFormula ? text : null,
    }
  }
  if (cell.t === 'n' && typeof cell.v === 'number' && Number.isFinite(cell.v)) {
    return { cellType: 'number', textValue: formatNumericLiteral(cell.v), formulaText: null }
  }
  return null
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
    let layout: AcdSheetLayout
    try {
      ;({ sheets, layout } = isOle2Workbook(buffer)
        ? parseOleVtsSheets(buffer, reportName, warnings)
        : parseVtsSheets(buffer, reportName, warnings))
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
      layout,
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
