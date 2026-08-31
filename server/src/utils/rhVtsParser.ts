/**
 * @deprecated 启发式字符串提取器，丢失行列坐标，无法还原真实报表网格。
 * 标准报表导入已改用 services/acdReportFormulaSync.ts 的 extractAcdReportTemplates（二进制 VTS 解析器）。
 * 保留此文件仅为历史参考，请勿在新代码中使用。
 */
import * as zlib from 'zlib'
import iconv from 'iconv-lite'

export type RhVtsCell = {
  rowIndex: number
  colIndex: number
  textValue: string | null
  formulaText: string | null
}

export type RhVtsReport = {
  name: string
  cells: RhVtsCell[]
}

/**
 * 解压 ACD 文件并提取其中的 vts 文件
 */
export function extractVtsFromAcd(buffer: Buffer): { name: string; buffer: Buffer }[] {
  const vtsFiles: { name: string; buffer: Buffer }[] = []
  let pos = 0

  while (pos < buffer.length) {
    let nameBytes = Buffer.alloc(0)
    let i = pos
    while (i < pos + 32 && i < buffer.length) {
      const b = buffer[i]
      if (b === 0x00) break
      nameBytes = Buffer.concat([nameBytes, Buffer.from([b])])
      i++
    }

    if (nameBytes.length < 3 || i >= buffer.length) {
      break
    }

    let fileName: string
    try {
      fileName = iconv.decode(nameBytes, 'gbk').trim()
    } catch {
      break
    }

    const nullPos = buffer.indexOf(0x00, pos)
    if (nullPos === -1) break

    let fieldEnd = nullPos + 1
    while (fieldEnd < buffer.length && buffer[fieldEnd] === 0x20) {
      fieldEnd++
    }

    if (fieldEnd + 12 > buffer.length) {
      break
    }

    const compressedSize = buffer.readUInt32LE(fieldEnd + 8)
    const zlibStart = fieldEnd + 12

    if (zlibStart + compressedSize > buffer.length) {
      break
    }

    if (compressedSize > 0 && /\.vts$/i.test(fileName)) {
      const zlibData = buffer.subarray(zlibStart, zlibStart + compressedSize)
      try {
        const decompressed = zlib.inflateSync(zlibData)
        vtsFiles.push({ name: fileName, buffer: decompressed })
      } catch (err) {
        console.warn(`Failed to decompress ${fileName}:`, err)
      }
    }

    pos = zlibStart + compressedSize
  }

  return vtsFiles
}

/**
 * 提取 VTS 二进制中的文字和公式
 * 采用启发式匹配：连续的汉字视为文字，带有 () 和计算符的视为公式
 */
function isFormulaToken(value: string): boolean {
  // 匹配类似 @YE(1001) 或者 @NC("4001", "人民币")+...
  return /^@?[A-Za-z]+\(.*\)/i.test(value)
}

function isMeaningfulText(value: string): boolean {
  if (value.length < 2) return false
  // 必须包含至少两个汉字
  const chineseChars = value.match(/[\u4e00-\u9fff]/g) || []
  if (chineseChars.length < 2) return false
  // 排除系统或字体名称
  if (/^(宋体|黑体|楷体|仿宋|隶书|幼圆|Arial|System|Left|Right|True|False)/i.test(value)) return false
  // 排除制表等无意义词头
  if (/^(制表|审核|打印)/.test(value)) return false
  return true
}

export function parseVtsContent(buffer: Buffer): RhVtsCell[] {
  const content = iconv.decode(buffer, 'gbk')
  const cells: RhVtsCell[] = []
  
  let current = ''
  const strings: string[] = []
  for (let index = 0; index < content.length; index++) {
    const char = content[index]
    const code = char.charCodeAt(0)
    const isReadable = (code >= 0x20 && code !== 0x7f) || /[\u4e00-\u9fff]/.test(char)
    
    if (isReadable) {
      current += char
    } else {
      if (current.length > 0) {
        strings.push(current)
        current = ''
      }
    }
  }
  if (current.length > 0) {
    strings.push(current)
  }

  let rowIndex = 0
  let lastWasText = false

  for (let str of strings) {
    str = str.replace(/[\ufffd]/g, '').trim()
    if (!str) continue

    const isFormula = isFormulaToken(str)
    const isText = !isFormula && isMeaningfulText(str)

    if (isFormula) {
      if (!lastWasText) {
        rowIndex++
      }
      cells.push({
        rowIndex,
        colIndex: 1,
        textValue: null,
        formulaText: str
      })
      lastWasText = false
    } else if (isText) {
      rowIndex++
      cells.push({
        rowIndex,
        colIndex: 0,
        textValue: str,
        formulaText: null
      })
      lastWasText = true
    }
  }

  return cells
}
