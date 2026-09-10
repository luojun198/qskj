import { existsSync, readFileSync } from 'fs'
import { resolve } from 'path'
import { describe, expect, it } from 'vitest'

import { extractAcdReportTemplates } from '../services/acdReportFormulaSync.js'

/**
 * 编译公式记录（0x06）的还原。
 *
 * 老实现把 tokenLength 读在了 token 段的起始位置（偏移多 2 字节），读出的长度过不了校验，
 * 于是每一条编译公式都被静默丢弃 —— 合计行的 `=SUM(...)`、行次列的 `=B19+1` 全部丢失，
 * 界面上合计格连单元格都不存在。这里用仓库自带的标准模版做回归。
 */
const TEMPLATE_PATH = resolve(process.cwd(), '../模版/企业会计准则.acd')

const describeIfTemplate = existsSync(TEMPLATE_PATH) ? describe : describe.skip

describeIfTemplate('ACD 编译公式还原', () => {
  const { templates } = extractAcdReportTemplates(readFileSync(TEMPLATE_PATH))
  const balanceSheet = templates.find(item => /^资产负债表/.test(item.reportName))

  function cellsOf(reportName: RegExp) {
    const template = templates.find(item => reportName.test(item.reportName))
    return (template?.sheets || []).flatMap(sheet => sheet.cells)
  }

  it('合计行应还原出 SUM 区域公式', () => {
    expect(balanceSheet).toBeDefined()
    const formulas = cellsOf(/^资产负债表/).map(cell => cell.formulaText)

    // 流动资产合计 = 上方各流动资产项之和
    expect(formulas).toContain('=SUM(C6:C19)')
    expect(formulas).toContain('=SUM(D6:D19)')
    // 非流动负债合计跨两段区域求和
    expect(formulas).toContain('=SUM(G22:G23)+SUM(G26:G31)')
  })

  it('单元格引用的行号应与记录行号同基准（不整体错一行）', () => {
    // 行次列是「上一行行次 + 1」：位于第 20 行的格子必须引用第 19 行，引用自己即为错位。
    const formulas = cellsOf(/^资产负债表/).map(cell => cell.formulaText)
    expect(formulas).toContain('=B19+1')

    // 资产总计 = 非流动资产合计(第 40 行) + 流动资产合计(第 20 行)
    expect(formulas).toContain('=C40+C20')
  })

  it('不得把缓存值当成公式落库', () => {
    // 三成编译记录的 token 段只有一个字面量，那是上次算出来的缓存值。
    // 当公式落库会在报表里留下写死的过期数字，还会盖掉同一格的 @ 取数公式。
    const literalOnly = templates
      .flatMap(item => item.sheets)
      .flatMap(sheet => sheet.cells)
      .filter(cell => /^=-?\d+(\.\d+)?$/.test(String(cell.formulaText || '')))

    expect(literalOnly).toHaveLength(0)
  })

  it('@ 取数公式不应被编译公式挤掉', () => {
    const cells = cellsOf(/^资产负债表/)
    const anchorFormulas = cells.filter(cell =>
      String(cell.formulaText || '').startsWith('@')
    )

    expect(anchorFormulas.length).toBeGreaterThan(0)
  })

  it('带字符串分支的 IF 也能还原', () => {
    // 这批曾是仅剩的「未解析公式记录」（24 条，全是同一形状）：
    // tRef tInt tGT tAttrIf tRef tRef tDiv tAttrGoto tStr tAttrGoto tFuncVar(IF)
    const formulas = templates
      .flatMap(item => item.sheets)
      .flatMap(sheet => sheet.cells)
      .map(cell => cell.formulaText)

    expect(formulas).toContain('=IF(B5>0,D5/B5,"-")')
  })

  it('行次列手工填的数字常量（RK 记录）应还原为 number 单元格', () => {
    // 新准则资产负债表里应收票据~预付款项四行的行次不是 =B8+1 公式而是敲死的 5/6/7/8，
    // vts 把它们存成没有长度字节的 RK 记录。丢掉它们，其下的 =B12+1 就从 1 重新起算。
    const cells = cellsOf(/^资产负债表\(已执行新金融、收入准则\)/)
    const numberAt = (rowIndex: number, colIndex: number) =>
      cells.find(
        cell => cell.rowIndex === rowIndex && cell.colIndex === colIndex && cell.cellType === 'number'
      )?.textValue

    expect(numberAt(8, 1)).toBe('5')
    expect(numberAt(9, 1)).toBe('6')
    expect(numberAt(10, 1)).toBe('7')
    expect(numberAt(11, 1)).toBe('8')
    // 负债侧同行同值
    expect(numberAt(11, 5)).toBe('8')
    // 数字格与其上下的公式格共用同一套样式（居中、16px）
    const numberCell = cells.find(
      cell => cell.rowIndex === 8 && cell.colIndex === 1 && cell.cellType === 'number'
    )
    expect(numberCell?.styleKey).toContain('align-center')
  })

  it('数字常量不得与文本/公式格重合', () => {
    // 「企业所得税申报表」「利润表（季报）」等的 sheet 切分本来就不干净（两个版本粘在一起、错一行），
    // 文本格同样重合，不在此约束范围内；这里只看切分干净的三大报表标准版。
    const cleanTemplates = templates.filter(item =>
      /^(资产负债表\(已执行新金融、收入准则\)|利润表\(已执行新金融、收入准则\)|现金流量表)$/.test(item.reportName)
    )
    expect(cleanTemplates).toHaveLength(3)
    for (const template of cleanTemplates) {
      for (const sheet of template.sheets) {
        const occupied = new Set(
          sheet.cells
            .filter(cell => cell.cellType !== 'number')
            .map(cell => `${cell.rowIndex}_${cell.colIndex}`)
        )
        for (const cell of sheet.cells) {
          if (cell.cellType !== 'number') continue
          expect(
            occupied.has(`${cell.rowIndex}_${cell.colIndex}`),
            `${template.reportName} r${cell.rowIndex}c${cell.colIndex} 数字格与其它格重合`
          ).toBe(false)
        }
      }
    }
  })

  it('应还原原报表的列宽与行高版面', () => {
    expect(balanceSheet).toBeDefined()
    const layout = balanceSheet!.layout
    // 项目列 21.1 字符宽、行次列 3.4 字符宽、金额列 13 字符宽：项目列明显宽于金额列，行次列最窄
    expect(layout.colWidthsPx).toHaveLength(8)
    expect(layout.colWidthsPx[0]).toBeGreaterThan(layout.colWidthsPx[2]!)
    expect(layout.colWidthsPx[2]).toBeGreaterThan(layout.colWidthsPx[1]!)
    expect(layout.colWidthsPx[1]).toBeLessThan(50)
    // 标题行 960 twips = 64px，正文行 432 twips ≈ 29px
    expect(layout.rowHeightsPx[0]).toBe(64)
    expect(layout.rowHeightsPx[5]).toBe(29)
  })

  it('该模板已无未解析公式记录', () => {
    const { warnings } = extractAcdReportTemplates(readFileSync(TEMPLATE_PATH))
    const unresolved = warnings.filter(item => item.startsWith('未解析公式记录'))

    expect(unresolved).toEqual([])
  })
})
