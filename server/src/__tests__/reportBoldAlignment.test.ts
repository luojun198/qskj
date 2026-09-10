import { describe, it, expect } from 'vitest'
import {
  alignBoldWithLabel,
  collectBoldAlignments,
  isAmountLikeFormula,
} from '../services/reportBoldAlignment.js'

function text(col: number, value: string | null, styleKey: string | null = 'font-size-13') {
  return { rowIndex: 0, colIndex: col, cellType: 'text', textValue: value, formulaText: null, styleKey }
}

function formula(col: number, source: string, styleKey: string | null = 'align-right font-size-13') {
  return { rowIndex: 0, colIndex: col, cellType: 'formula', textValue: null, formulaText: source, styleKey }
}

describe('reportBoldAlignment', () => {
  it('行次公式不算金额，取数 / 函数 / 多引用算金额', () => {
    expect(isAmountLikeFormula('=B19+1')).toBe(false)
    expect(isAmountLikeFormula('@YE(1001,99)')).toBe(true)
    expect(isAmountLikeFormula('=SUM(C6:C19)')).toBe(true)
    expect(isAmountLikeFormula('=G32+G20')).toBe(true)
    expect(isAmountLikeFormula(null)).toBe(false)
  })

  it('项目名加粗时，其右侧金额格补加粗；左右两栏各自独立', () => {
    const cells = alignBoldWithLabel([
      text(0, '流动资产合计', 'align-center font-size-13 font-bold'),
      formula(1, '=B19+1', 'align-center font-size-16'),
      formula(2, '=SUM(C6:C19)'),
      formula(3, '=SUM(D6:D19)', 'align-right font-size-13 font-bold'),
      text(4, '油气资产'),
      formula(5, '=F19+1', 'align-center font-size-16'),
      formula(6, '@YE(1631,99)'),
      formula(7, '@NC(1631)'),
    ])

    expect(cells[1].styleKey).toBe('align-center font-size-16')
    expect(cells[2].styleKey).toBe('align-right font-size-13 font-bold')
    // 已经加粗的不重复追加
    expect(cells[3].styleKey).toBe('align-right font-size-13 font-bold')
    // 右栏项目名不加粗，金额保持原样
    expect(cells[6].styleKey).toBe('align-right font-size-13')
    expect(cells[7].styleKey).toBe('align-right font-size-13')
  })

  it('空文本格不打断归属；无项目名的金额不动', () => {
    const changes = collectBoldAlignments([
      text(0, null, 'border-all'),
      formula(1, '=B44+1', 'align-center'),
      text(2, null, 'border-all'),
      text(4, '所有者权益合计', 'font-size-13 font-bold'),
      text(5, null, 'border-all'),
      formula(6, '=G35+G36'),
      formula(7, '=H35+H36'),
    ])

    expect(changes.map(item => item.cell.colIndex)).toEqual([6, 7])
    expect(changes[0].styleKey).toBe('align-right font-size-13 font-bold')
  })

  it('金额加粗但项目名不加粗时不做减法', () => {
    const changes = collectBoldAlignments([
      text(0, '货币资金'),
      formula(2, '@YE(1001,99)', 'font-bold'),
    ])
    expect(changes).toEqual([])
  })
})
