import { describe, expect, it } from 'vitest'
import { resolveSheetOffset } from '../services/acdReportFormulaSync.js'

type SourceCell = {
  rowIndex: number
  colIndex: number
  cellType: 'text' | 'formula'
  textValue: string | null
  formulaText: string | null
}

function text(rowIndex: number, colIndex: number, value: string): SourceCell {
  return { rowIndex, colIndex, cellType: 'text', textValue: value, formulaText: null }
}

function formula(rowIndex: number, colIndex: number, value: string): SourceCell {
  return { rowIndex, colIndex, cellType: 'formula', textValue: null, formulaText: value }
}

describe('resolveSheetOffset', () => {
  it('ACD 锚点三重重复时仍能检测到 +1 行偏移', () => {
    // 模拟 ACD：标签在第 0~2 行，且每个标签单元格被重复记录 3 次（同一行列）
    const labels = ['货币资金', '短期投资', '财政应返还额度']
    const sourceCells: SourceCell[] = []
    labels.forEach((label, rowIndex) => {
      for (let dup = 0; dup < 3; dup += 1) {
        sourceCells.push(text(rowIndex, 0, label))
      }
      sourceCells.push(formula(rowIndex, 1, `@ye(${1001 + rowIndex},99)`))
    })

    const sourceSheet = { name: '资产负债表', index: 0, cells: sourceCells }

    // 目标（Excel 导入结果）：相同标签整体下移 1 行（第 1~3 行），且唯一
    const targetCells = labels.map((label, rowIndex) => ({
      row_index: rowIndex + 1,
      col_index: 0,
      cell_type: 'text',
      text_value: label,
    }))

    const { rowDelta, colDelta, matchCount } = resolveSheetOffset(sourceSheet, targetCells)
    expect(rowDelta).toBe(1)
    expect(colDelta).toBe(0)
    expect(matchCount).toBeGreaterThan(0)
  })

  it('源与目标对齐时偏移为 0', () => {
    const sourceSheet = {
      name: '表',
      index: 0,
      cells: [text(5, 0, '货币资金'), text(6, 0, '短期投资')],
    }
    const targetCells = [
      { row_index: 5, col_index: 0, cell_type: 'text', text_value: '货币资金' },
      { row_index: 6, col_index: 0, cell_type: 'text', text_value: '短期投资' },
    ]
    const { rowDelta, colDelta } = resolveSheetOffset(sourceSheet, targetCells)
    expect(rowDelta).toBe(0)
    expect(colDelta).toBe(0)
  })
})
