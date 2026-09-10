import iconv from 'iconv-lite'
import { describe, expect, it } from 'vitest'
import xlsx from 'xlsx'

import {
  mapWorkbookToSheets,
  parseOleVtsSheets,
  parseVtsSheets,
  shiftFormulaRows,
} from '../services/acdReportFormulaSync.js'

/**
 * 用合成的 vts 字节流验证解析器对三代格式的兼容：
 *   1. 老版：文本记录 `[0x04][len][row][col][xf][n][GBK]`
 *   2. 新版：文本记录多一个 flags 字节、正文 UTF-16；编译公式的引用 token 列宽 2 字节
 *   3. OLE2：整个 vts 就是一个 xls 工作簿
 * 真实样本（ZW04 绿环 BVI、卡格尔、车子物流等 ACD）不在仓库里，这里只固定各格式的结构约定。
 */

function u16(value: number) {
  const buffer = Buffer.alloc(2)
  buffer.writeUInt16LE(value)
  return buffer
}

/** 老版文本记录；row 是 vts 的 1-based 行号 */
function legacyText(row: number, col: number, text: string, xf = 0) {
  const body = iconv.encode(text, 'gb18030')
  const data = Buffer.concat([u16(row), u16(col), u16(xf), u16(body.length), body])
  return Buffer.concat([Buffer.from([0x04, data.length]), data])
}

/** 新版文本记录：flags=1 时 UTF-16，n 为字符数 */
function flaggedText(row: number, col: number, text: string, xf = 0, unicode = true) {
  const body = unicode ? Buffer.from(text, 'utf16le') : iconv.encode(text, 'gb18030')
  const data = Buffer.concat([u16(row), u16(col), u16(xf), u16(text.length), Buffer.from([unicode ? 1 : 0]), body])
  return Buffer.concat([Buffer.from([0x04, data.length]), data])
}

/** 编译公式记录：头 22 字节（row col xf 缓存值 8 保留 6 tokenLength）+ token */
function compiledFormula(row: number, col: number, tokens: Buffer) {
  const data = Buffer.concat([u16(row), u16(col), u16(0), Buffer.alloc(8), Buffer.alloc(6), u16(tokens.length), tokens])
  return Buffer.concat([Buffer.from([0x06, data.length]), data])
}

/** `=B{row}+1`：tRefV(0x44) + tInt(0x1e) 1 + tAdd(0x03)；列宽按版本 1/2 字节 */
function rowNumberTokens(refRow: number, wide: boolean) {
  const col = wide ? u16(1) : Buffer.from([1])
  return Buffer.concat([Buffer.from([0x44]), u16(refRow), col, Buffer.from([0x1e]), u16(1), Buffer.from([0x03])])
}

/** 记录之间塞一段不会被误认成单元格的填充（全 0） */
const PAD = Buffer.alloc(16)

describe('vts 三代格式兼容', () => {
  it('老版 GBK 文本记录照常解析', () => {
    const buffer = Buffer.concat([PAD, legacyText(1, 0, '利 润 表'), PAD, legacyText(2, 0, '编制单位：%U'), PAD])
    const { sheets } = parseVtsSheets(buffer, '利润表', [])

    expect(sheets).toHaveLength(1)
    expect(sheets[0].cells.map(cell => [cell.rowIndex, cell.colIndex, cell.textValue])).toEqual([
      [0, 0, '利 润 表'],
      [1, 0, '编制单位：%U'],
    ])
  })

  it('新版带 flags 字节的 UTF-16 文本记录也能解析，且 @ 取数公式保留为公式', () => {
    const buffer = Buffer.concat([
      PAD,
      flaggedText(1, 0, '现 金 流 量 表'),
      PAD,
      flaggedText(3, 0, '纳税人名称：%U'),
      PAD,
      flaggedText(6, 2, '@xj_je(1101,1,99)', 0, false),
      PAD,
    ])
    const { sheets } = parseVtsSheets(buffer, '现金流量表', [])

    expect(sheets).toHaveLength(1)
    expect(sheets[0].cells).toEqual([
      expect.objectContaining({ rowIndex: 0, colIndex: 0, cellType: 'text', textValue: '现 金 流 量 表' }),
      expect.objectContaining({ rowIndex: 2, colIndex: 0, cellType: 'text', textValue: '纳税人名称：%U' }),
      expect.objectContaining({ rowIndex: 5, colIndex: 2, cellType: 'formula', formulaText: '@xj_je(1101,1,99)' }),
    ])
  })

  it('新版编译公式的引用 token 列宽为 2 字节，行次公式不再落入「未解析」', () => {
    const warnings: string[] = []
    const buffer = Buffer.concat([
      PAD,
      flaggedText(1, 0, '现 金 流 量 表'),
      PAD,
      compiledFormula(6, 1, rowNumberTokens(5, true)),
      PAD,
    ])
    const { sheets } = parseVtsSheets(buffer, '现金流量表', warnings)

    expect(warnings).toEqual([])
    expect(sheets[0].cells[1]).toEqual(expect.objectContaining({ rowIndex: 5, colIndex: 1, formulaText: '=B5+1' }))
  })

  it('老版编译公式仍按 1 字节列宽解析', () => {
    const warnings: string[] = []
    const buffer = Buffer.concat([PAD, legacyText(1, 0, '利 润 表'), PAD, compiledFormula(6, 1, rowNumberTokens(5, false)), PAD])
    const { sheets } = parseVtsSheets(buffer, '利润表', warnings)

    expect(warnings).toEqual([])
    expect(sheets[0].cells[1]).toEqual(expect.objectContaining({ rowIndex: 5, colIndex: 1, formulaText: '=B5+1' }))
  })

  it('按行列序回退切分多个版本，而不依赖标题文字里有「表」字', () => {
    // 三个版本：呈现版（无 @）、公式版、编译版；标题都不含「表」字
    const version = (formula: string | null) =>
      Buffer.concat([
        legacyText(1, 0, '收入费用情况'),
        PAD,
        legacyText(3, 0, '项目'),
        PAD,
        legacyText(4, 0, '主营业务收入'),
        PAD,
        ...(formula ? [legacyText(4, 2, formula), PAD] : []),
      ])
    const buffer = Buffer.concat([PAD, version(null), PAD, version('@JQY(6001,01,99)'), PAD, version(null)])
    const { sheets } = parseVtsSheets(buffer, '收入费用', [])

    expect(sheets.map(sheet => sheet.cells.length)).toEqual([3, 4, 3])
    expect(sheets.map(sheet => sheet.name)).toEqual(['收入费用', '收入费用', '收入费用'])
    expect(sheets[1].cells.some(cell => cell.formulaText === '@JQY(6001,01,99)')).toBe(true)
  })

  it('同一格既有文本又有编译记录时不算版本边界', () => {
    const buffer = Buffer.concat([
      PAD,
      legacyText(1, 0, '利 润 表'),
      PAD,
      legacyText(6, 1, '5'),
      PAD,
      compiledFormula(6, 1, rowNumberTokens(5, false)),
      PAD,
      legacyText(7, 0, '营业收入'),
      PAD,
    ])
    const { sheets } = parseVtsSheets(buffer, '利润表', [])

    expect(sheets).toHaveLength(1)
    expect(sheets[0].cells).toHaveLength(4)
  })
})

describe('OLE2 工作簿形态的 vts', () => {
  function buildWorkbook() {
    const worksheet = xlsx.utils.aoa_to_sheet([
      [],
      ['利 润 分 配 表'],
      [],
      ['编制单位：%U', null, '%YH%MH', '单位： 元'],
      ['项目', '行次', '本年实际', '上年实际'],
      ['一、净利润', 1, '@DF(4103,01,12)-JF(4103,01,12)', '@DF(4103,101,112)'],
      ['加：年初未分配利润', null, '@NC(4104015)', '@YE(4104015,212)'],
      ['二、可供分配利润', null, null, null],
    ])
    // 行次与合计写成真正的 Excel 公式
    worksheet['B7'] = { t: 'n', f: 'B6+1' }
    worksheet['B8'] = { t: 'n', f: 'B7+1' }
    worksheet['C8'] = { t: 'n', f: 'C6+C7' }
    worksheet['!cols'] = [{ wpx: 320 }, { wpx: 52 }, { wpx: 195 }, { wpx: 195 }]
    worksheet['!rows'] = [{ hpx: 8 }, { hpx: 30 }, { hpx: 19 }, { hpx: 24 }]
    const workbook = xlsx.utils.book_new()
    xlsx.utils.book_append_sheet(workbook, worksheet, '损益表(定义)')
    return workbook
  }

  it('OLE2 魔数的 vts 走 xlsx 库解析', () => {
    const worksheet = xlsx.utils.aoa_to_sheet([[], ['利 润 分 配 表'], ['编制单位：%U']])
    const workbook = xlsx.utils.book_new()
    xlsx.utils.book_append_sheet(workbook, worksheet, '损益表(定义)')
    const buffer = xlsx.write(workbook, { type: 'buffer', bookType: 'biff8' }) as Buffer

    expect(buffer.subarray(0, 4)).toEqual(Buffer.from([0xd0, 0xcf, 0x11, 0xe0]))
    const { sheets } = parseOleVtsSheets(buffer, '利润分配表', [])
    expect(sheets[0].cells.map(cell => [cell.rowIndex, cell.textValue])).toEqual([
      [0, '利 润 分 配 表'],
      [1, '编制单位：%U'],
    ])
  })

  it('映射成与自研格式一致的结构（整体上移一行、公式行号同步减 1）', () => {
    // 社区版 xlsx 写 biff8 不落公式，这里直接用内存工作簿验证映射逻辑
    const { sheets, layout } = mapWorkbookToSheets(buildWorkbook(), '利润分配表')

    expect(sheets).toHaveLength(1)
    const cells = sheets[0].cells
    const find = (row: number, col: number) => cells.find(cell => cell.rowIndex === row && cell.colIndex === col)

    expect(find(0, 0)).toEqual(expect.objectContaining({ cellType: 'text', textValue: '利 润 分 配 表' }))
    expect(find(2, 0)).toEqual(expect.objectContaining({ cellType: 'text', textValue: '编制单位：%U' }))
    expect(find(4, 1)).toEqual(expect.objectContaining({ cellType: 'number', textValue: '1' }))
    expect(find(4, 2)).toEqual(expect.objectContaining({ cellType: 'formula', formulaText: '@DF(4103,01,12)-JF(4103,01,12)' }))
    expect(find(5, 1)).toEqual(expect.objectContaining({ cellType: 'formula', formulaText: '=B5+1' }))
    expect(find(6, 1)).toEqual(expect.objectContaining({ cellType: 'formula', formulaText: '=B6+1' }))
    expect(find(6, 2)).toEqual(expect.objectContaining({ cellType: 'formula', formulaText: '=C5+C6' }))
    expect(cells.some(cell => cell.rowIndex < 0)).toBe(false)

    expect(layout.colWidthsPx.slice(0, 4)).toEqual([320, 52, 195, 195])
    expect(layout.rowHeightsPx.slice(0, 3)).toEqual([30, 19, 24])
  })
})

describe('shiftFormulaRows', () => {
  it('只改引号外的 A1 引用，函数名与字符串不动', () => {
    expect(shiftFormulaRows('B8+1', -1)).toBe('B7+1')
    expect(shiftFormulaRows('SUM(C6:C8)-$D$10', -1)).toBe('SUM(C5:C7)-$D$9')
    expect(shiftFormulaRows('IF(A2>0,"A2",LOG10(B3))', -1)).toBe('IF(A1>0,"A2",LOG10(B2))')
  })

  it('行号减到 0 以下时保持原样，不产生非法地址', () => {
    expect(shiftFormulaRows('A1+B2', -1)).toBe('A1+B1')
  })
})
