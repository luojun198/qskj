import { describe, expect, it } from 'vitest'
import { getStatementRowSpan } from '../statementRowSpan'

describe('对账单表头单元格合并', () => {
  const rows = [
    { docKey: 'SO-001' },
    { docKey: 'SO-001' },
    { docKey: 'SO-002' },
  ]

  it('同一单据的表头字段仅从首行向下合并', () => {
    expect(getStatementRowSpan(rows, 0, 'orderNo')).toEqual([2, 1])
    expect(getStatementRowSpan(rows, 1, 'orderNo')).toEqual([0, 0])
    expect(getStatementRowSpan(rows, 2, 'orderNo')).toEqual([1, 1])
  })

  it('物料明细字段保持逐行显示', () => {
    expect(getStatementRowSpan(rows, 0, 'itemName')).toEqual([1, 1])
    expect(getStatementRowSpan(rows, 1, 'itemName')).toEqual([1, 1])
  })
})
