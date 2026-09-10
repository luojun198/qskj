import { describe, it, expect } from 'vitest'
import {
  centerHeaderDates,
  collectHeaderDateChanges,
  isHeaderDateText,
  withRowCenter,
} from '../services/reportHeaderLayout.js'

function text(row: number, col: number, value: string | null, styleKey: string | null = 'font-size-15', mergeInfo: string | null = null) {
  return { rowIndex: row, colIndex: col, cellType: 'text', textValue: value, formulaText: null, styleKey, mergeInfo }
}

function bordered(row: number, col: number, value: string) {
  return text(row, col, value, 'align-center font-size-16 border-all')
}

/** 资产负债表抬头：标题 / 纳税人名称 + 日期 + 会企01表 / 单位：元 / 表头 */
function balanceSheetHeader() {
  return [
    text(0, 0, '资  产  负  债  表', 'align-center font-size-32 font-bold', JSON.stringify({ rowSpan: 1, colSpan: 8 })),
    text(1, 0, '纳税人名称 ：%U'),
    text(1, 3, '%yh%mh%dh'),
    text(1, 7, '会企01表', 'align-right font-size-15'),
    text(2, 7, '单位：元', 'align-right font-size-15'),
    ...['资产', '行次', '期末余额', '年初余额', '负债及所有者权益', '行次', '期末余额', '年初余额'].map(
      (label, col) => bordered(3, col, label)
    ),
  ]
}

describe('reportHeaderLayout', () => {
  it('识别日期占位符与字面日期，排除「单位：元」', () => {
    expect(isHeaderDateText('%yh%mh%dh')).toBe(true)
    expect(isHeaderDateText('%yH%mH%dH')).toBe(true)
    expect(isHeaderDateText('2024年12月31日')).toBe(true)
    expect(isHeaderDateText('2024年12月')).toBe(true)
    expect(isHeaderDateText('单位：元')).toBe(false)
    expect(isHeaderDateText('纳税人名称：%U')).toBe(false)
    expect(isHeaderDateText(null)).toBe(false)
  })

  it('align-row-center 替换掉原有对齐 token，其余保留', () => {
    expect(withRowCenter('align-left font-size-15 font-family-SimSun')).toBe(
      'align-row-center font-size-15 font-family-SimSun'
    )
    expect(withRowCenter(null)).toBe('align-row-center')
  })

  it('公司名挪到日期下一行，日期从行首铺满到右邻之前并整行居中', () => {
    const cells = centerHeaderDates(balanceSheetHeader())
    const date = cells.find(cell => cell.textValue === '%yh%mh%dh')!
    const label = cells.find(cell => cell.textValue === '纳税人名称 ：%U')!

    expect(date.rowIndex).toBe(1)
    expect(date.colIndex).toBe(0)
    expect(JSON.parse(date.mergeInfo!)).toEqual({ rowSpan: 1, colSpan: 7 })
    expect(date.styleKey).toBe('align-row-center font-size-15')

    // 公司名到了「单位：元」那一行的左侧，样式原样保留
    expect(label.rowIndex).toBe(2)
    expect(label.colIndex).toBe(0)
    expect(label.styleKey).toBe('font-size-15')
    expect(cells.find(cell => cell.textValue === '会企01表')!.colIndex).toBe(7)
    expect(cells.find(cell => cell.textValue === '单位：元')!.rowIndex).toBe(2)
  })

  it('下一行左侧已有内容时公司名不挪，日期只铺满两邻之间', () => {
    const header = balanceSheetHeader()
    header.push(text(2, 0, '编制单位：某公司'))
    const cells = centerHeaderDates(header)
    const date = cells.find(cell => cell.textValue === '%yh%mh%dh')!
    const label = cells.find(cell => cell.textValue === '纳税人名称 ：%U')!

    expect(label.rowIndex).toBe(1)
    expect(date.colIndex).toBe(1)
    expect(JSON.parse(date.mergeInfo!)).toEqual({ rowSpan: 1, colSpan: 6 })
  })

  it('日期紧邻表体（没有下一行抬头）时公司名不挪', () => {
    const cells = centerHeaderDates([
      text(0, 0, '纳税人名称：%U'),
      text(0, 2, '%yh%mh%dh'),
      text(0, 3, '会企02表', 'align-right'),
      ...['项目', '行次', '本期金额', '上期金额'].map((label, col) => bordered(1, col, label)),
    ])
    expect(cells.find(cell => cell.textValue === '纳税人名称：%U')!.rowIndex).toBe(0)
    expect(cells.find(cell => cell.textValue === '%yh%mh%dh')!.colIndex).toBe(1)
  })

  it('利润表：先挪公司名再铺日期，变更按可落库的顺序给出', () => {
    const cells = [
      text(0, 0, '利  润  表', 'align-center font-size-32 font-bold', JSON.stringify({ rowSpan: 1, colSpan: 4 })),
      text(1, 0, '纳税人名称：%U'),
      text(1, 1, '%yh%mh%dh', 'align-center font-size-15', JSON.stringify({ rowSpan: 1, colSpan: 2 })),
      text(1, 3, '会企02表', 'align-right font-size-15'),
      text(2, 3, '单位：元', 'align-right font-size-15'),
      ...['项目', '行次', '本期金额', '上期金额'].map((label, col) => bordered(3, col, label)),
    ]
    const changes = collectHeaderDateChanges(cells)

    expect(changes.map(change => change.cell.textValue)).toEqual(['纳税人名称：%U', '%yh%mh%dh'])
    expect(changes[0]).toMatchObject({ rowIndex: 2, colIndex: 0, mergeInfo: null, styleKey: 'font-size-15' })
    expect(changes[1]).toMatchObject({ rowIndex: 1, colIndex: 0, styleKey: 'align-row-center font-size-15' })
    expect(JSON.parse(changes[1].mergeInfo!)).toEqual({ rowSpan: 1, colSpan: 3 })
  })

  it('被铺过的空占位格被剔除；已处理过的报表再跑一次没有变化', () => {
    const cells = [
      ...balanceSheetHeader(),
      text(1, 2, null, 'font-size-15'),
      text(1, 5, '', null),
      text(2, 0, null, 'font-size-15'),
    ]
    const once = centerHeaderDates(cells)

    expect(once.filter(cell => cell.rowIndex === 1).map(cell => cell.colIndex)).toEqual([0, 7])
    expect(once.filter(cell => cell.rowIndex === 2).map(cell => cell.textValue).sort()).toEqual(
      ['单位：元', '纳税人名称 ：%U'].sort()
    )
    expect(collectHeaderDateChanges(once)).toEqual([])
  })

  it('表体内的日期与没有边框信息的报表都不处理', () => {
    const inBody = [bordered(0, 0, '项目'), bordered(1, 0, '2024年12月31日')]
    expect(collectHeaderDateChanges(inBody)).toEqual([])

    const noBorder = [text(0, 0, '标题'), text(1, 2, '%yh%mh%dh')]
    expect(collectHeaderDateChanges(noBorder)).toEqual([])
  })
})
