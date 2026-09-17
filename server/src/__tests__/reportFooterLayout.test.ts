import { describe, it, expect } from 'vitest'
import {
  collectFooterLayoutChanges,
  isFooterSignatureText,
  normalizeFooterRows,
  stripBorderTokens,
} from '../services/reportFooterLayout.js'

function cell(
  row: number,
  col: number,
  value: string | null,
  styleKey: string | null = 'border-all',
  formulaText: string | null = null
) {
  return {
    rowIndex: row,
    colIndex: col,
    cellType: formulaText ? 'formula' : 'text',
    textValue: value,
    formulaText,
    styleKey,
    mergeInfo: null as string | null,
  }
}

const SIGN = '单位负责人：          会计主管：            审核：              制表：'

/** 利润表(已执行新金融)表尾：最后一行正文 / 整句签字行 / 补框空行 / 两行辅助取数格 */
function incomeStatementFooter() {
  return [
    cell(48, 0, '（二）稀释每股收益', 'align-left font-size-16 border-all'),
    cell(48, 1, null, 'align-center font-size-16 border-all', '=B48+1'),
    cell(48, 2, null),
    cell(48, 3, null),
    cell(49, 0, SIGN, 'font-size-16 font-family-SimSun border-all'),
    cell(49, 1, null),
    cell(49, 2, null),
    cell(49, 3, null),
    cell(50, 0, null),
    cell(50, 1, null),
    cell(50, 2, null),
    cell(50, 3, null),
    cell(51, 0, '资产减值损失', 'align-left font-size-16 border-all'),
    cell(51, 1, null, 'align-center font-size-16 border-all', '=B51+1'),
    cell(51, 2, null, 'font-size-13 border-all', '@JQY(6701,01,99)'),
    cell(51, 3, null, 'font-size-13 border-all', '@JQY(6701,101,199)'),
  ]
}

describe('reportFooterLayout', () => {
  it('识别签字行文字', () => {
    expect(isFooterSignatureText(SIGN)).toBe(true)
    expect(isFooterSignatureText('单位负责人:')).toBe(true)
    expect(isFooterSignatureText('财务主管：')).toBe(true)
    expect(isFooterSignatureText('制表：')).toBe(true)
    expect(isFooterSignatureText('编制单位：%U')).toBe(false)
    expect(isFooterSignatureText('资产减值损失')).toBe(false)
    expect(isFooterSignatureText(null)).toBe(false)
  })

  it('去掉全部边框 token，其余保留', () => {
    expect(stripBorderTokens('font-size-16 border-all border-color-FF0000 border-width-2')).toBe('font-size-16')
    expect(stripBorderTokens('border-all')).toBeNull()
    expect(stripBorderTokens(null)).toBeNull()
  })

  it('整句签字行：去框、合并到最右列、删掉补框空格；下方空行同样清掉', () => {
    const cells = incomeStatementFooter()
    const { updated, removed } = collectFooterLayoutChanges(cells)

    const sign = updated.find(change => change.cell.textValue === SIGN)
    expect(sign).toBeDefined()
    expect(sign!.styleKey).toBe('font-size-16 font-family-SimSun')
    expect(sign!.mergeInfo).toBe(JSON.stringify({ rowSpan: 1, colSpan: 4 }))

    const removedKeys = removed.map(item => `${item.rowIndex}_${item.colIndex}`).sort()
    expect(removedKeys).toEqual(['49_1', '49_2', '49_3', '50_0', '50_1', '50_2', '50_3'])

    // 正文与辅助行一格不动
    expect(updated.some(change => change.cell.rowIndex === 48)).toBe(false)
    expect(updated.some(change => change.cell.rowIndex === 51)).toBe(false)
    expect(removed.some(item => item.rowIndex === 51)).toBe(false)
  })

  it('分列书写的签字行：只去框，不合并', () => {
    const cells = [
      cell(46, 0, '负债和所有者权益总计', 'font-bold border-all'),
      cell(46, 1, null),
      cell(47, 0, '单位负责人:', 'align-left font-size-16 border-all'),
      cell(47, 1, null),
      cell(47, 2, '会计主管：', 'align-left font-size-16 border-all'),
      cell(47, 3, '制表：', 'align-left font-size-16 border-all'),
    ]
    const { updated, removed } = collectFooterLayoutChanges(cells)

    expect(updated.map(change => change.cell.colIndex).sort()).toEqual([0, 2, 3])
    expect(updated.every(change => change.mergeInfo === null)).toBe(true)
    expect(updated.every(change => change.styleKey === 'align-left font-size-16')).toBe(true)
    expect(removed.map(item => `${item.rowIndex}_${item.colIndex}`)).toEqual(['47_1'])
  })

  it('已处理过的签字行不再产生变更（可重复执行）', () => {
    const cells = normalizeFooterRows(incomeStatementFooter())
    const again = collectFooterLayoutChanges(cells)

    expect(again.updated).toHaveLength(0)
    expect(again.removed).toHaveLength(0)
    expect(cells.some(item => item.rowIndex === 50)).toBe(false)
    expect(cells.find(item => item.textValue === SIGN)!.mergeInfo).toBe(JSON.stringify({ rowSpan: 1, colSpan: 4 }))
  })

  it('签字行之下的「补充资料」小表保留边框', () => {
    const cells = [
      cell(24, 0, '单位负责人：', 'font-size-16 border-all'),
      cell(24, 1, '会计主管：', 'font-size-16 border-all'),
      cell(24, 2, null),
      cell(25, 0, null),
      cell(25, 1, null),
      cell(25, 2, null),
      cell(26, 0, '补充资料：', 'font-size-16 border-all'),
      cell(26, 1, null),
      cell(26, 2, null),
      cell(27, 0, '项目', 'border-all'),
      cell(27, 1, '行', 'border-all'),
      cell(27, 2, '本年累计数', 'border-all'),
    ]
    const result = normalizeFooterRows(cells)

    expect(result.filter(item => item.rowIndex === 25)).toHaveLength(0)
    expect(result.filter(item => item.rowIndex >= 26).every(item => /border-all/.test(item.styleKey || ''))).toBe(true)
  })
})
