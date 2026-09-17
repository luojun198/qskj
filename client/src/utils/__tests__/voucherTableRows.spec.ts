import { describe, expect, it } from 'vitest'
import {
  VOUCHER_MAX_FIXED_ROWS,
  VOUCHER_MIN_BODY_ROW_HEIGHT_PT,
  VOUCHER_ROWS_FILL_SLACK_PT,
  applyVoucherTableRows,
  computeVoucherBodyRowHeightPt,
  readVoucherTableRows,
} from '@/utils/hiprintVoucherProvider'
import { DEFAULT_VOUCHER_FIXED_ROWS, buildEntriesTable } from '@/utils/printTemplateDefaultsHiprint'

describe('computeVoucherBodyRowHeightPt', () => {
  it('列头 + N 行 + 合计行均分表格框可用高度（扣掉余量），向下取整到 0.5pt', () => {
    // (200 - 2) / (5 + 2) = 28.28 → 28
    expect(computeVoucherBodyRowHeightPt({ tableHeightPt: 200, rows: 5, summaryOn: true })).toBe(28)
  })

  it('不传 summaryOn 按有合计行；没开合计行时只多列头一行', () => {
    expect(computeVoucherBodyRowHeightPt({ tableHeightPt: 200, rows: 5 })).toBe(28)
    const h = computeVoucherBodyRowHeightPt({ tableHeightPt: 122, rows: 5, summaryOn: false })
    expect(h).toBe((122 - VOUCHER_ROWS_FILL_SLACK_PT) / 6)
  })

  it('rows 为 0 返回 0；表格太矮时行高不低于下限', () => {
    expect(computeVoucherBodyRowHeightPt({ tableHeightPt: 200, rows: 0 })).toBe(0)
    expect(computeVoucherBodyRowHeightPt({ tableHeightPt: 30, rows: 10 })).toBe(
      VOUCHER_MIN_BODY_ROW_HEIGHT_PT
    )
  })
})

describe('applyVoucherTableRows', () => {
  const base = { height: 200, autoCompletion: true, tableFooterRepeat: 'last', columns: [[]] }

  it('写入 maxRows / autoCompletion / 表体与列头同一行高，不改入参', () => {
    const next = applyVoucherTableRows(base, { rows: 5, summaryOn: true })
    expect(next.maxRows).toBe(5)
    expect(next.autoCompletion).toBe(true)
    expect(next.tableBodyRowHeight).toBe(28)
    expect(next.tableHeaderRowHeight).toBe(28)
    expect(base).not.toHaveProperty('maxRows')
  })

  it('没传 summaryOn 时从列定义反推：有 tableSummary 列多算合计行', () => {
    const withSum = { height: 200, columns: [[{ field: 'debit', tableSummary: 'sum' }]] }
    const noSum = { height: 200, columns: [[{ field: 'debit' }]] }
    expect(applyVoucherTableRows(withSum, { rows: 5 }).tableBodyRowHeight).toBe(28)
    expect(applyVoucherTableRows(noSum, { rows: 5 }).tableBodyRowHeight).toBe(33)
  })

  it('没开合计行时 autoCompletion 也会被打开（补空行是保底）', () => {
    const next = applyVoucherTableRows({ height: 200, autoCompletion: false }, { rows: 4 })
    expect(next.autoCompletion).toBe(true)
  })

  it('rows 为 0 时清掉 maxRows 与 tableBodyRowHeight，autoCompletion 保持原值', () => {
    const fixed = applyVoucherTableRows(base, { rows: 5 })
    const cleared = applyVoucherTableRows(fixed, { rows: 0 })
    expect(cleared).not.toHaveProperty('maxRows')
    expect(cleared).not.toHaveProperty('tableBodyRowHeight')
    expect(cleared).not.toHaveProperty('tableHeaderRowHeight')
    expect(cleared.autoCompletion).toBe(true)
  })

  it('行数封顶、小数向下取整', () => {
    expect(applyVoucherTableRows(base, { rows: 999 }).maxRows).toBe(VOUCHER_MAX_FIXED_ROWS)
    expect(applyVoucherTableRows(base, { rows: 5.9 }).maxRows).toBe(5)
  })
})

describe('readVoucherTableRows', () => {
  it('从 maxRows 回读，兼容用户直接在属性面板输入的字符串', () => {
    expect(readVoucherTableRows({ maxRows: '6', tableBodyRowHeight: 20 })).toEqual({ rows: 6, rowHeight: 20 })
    expect(readVoucherTableRows({})).toEqual({ rows: 0, rowHeight: 0 })
    expect(readVoucherTableRows(undefined)).toEqual({ rows: 0, rowHeight: 0 })
  })

  it('与 applyVoucherTableRows 往返一致', () => {
    const next = applyVoucherTableRows({ height: 160 }, { rows: 7 })
    expect(readVoucherTableRows(next)).toEqual({ rows: 7, rowHeight: next.tableBodyRowHeight })
  })
})

describe('buildEntriesTable 默认固定行数', () => {
  it('新建预设默认 6 行，并带上均分后的行高', () => {
    const el = buildEntriesTable(12, 30, 186, 70)
    expect(DEFAULT_VOUCHER_FIXED_ROWS).toBe(6)
    expect(el.options.maxRows).toBe(6)
    expect(el.options.autoCompletion).toBe(true)
    expect(el.options.tableBodyRowHeight).toBeGreaterThan(VOUCHER_MIN_BODY_ROW_HEIGHT_PT)
    expect(el.options.tableHeaderRowHeight).toBe(el.options.tableBodyRowHeight)
  })

  it('传 0 时不固定', () => {
    const el = buildEntriesTable(12, 30, 186, 70, [], 0)
    expect(el.options).not.toHaveProperty('maxRows')
    expect(el.options).not.toHaveProperty('tableBodyRowHeight')
  })
})
