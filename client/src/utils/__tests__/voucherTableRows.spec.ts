import { describe, expect, it } from 'vitest'
import {
  HIPRINT_DEFAULT_TD_HEIGHT_PT,
  VOUCHER_MAX_FIXED_ROWS,
  VOUCHER_MIN_BODY_ROW_HEIGHT_PT,
  VOUCHER_ROWS_FILL_SLACK_PT,
  applyVoucherTableRows,
  computeVoucherBodyRowHeightPt,
  readVoucherTableRows,
} from '@/utils/hiprintVoucherProvider'
import { DEFAULT_VOUCHER_FIXED_ROWS, buildEntriesTable } from '@/utils/printTemplateDefaultsHiprint'

describe('computeVoucherBodyRowHeightPt', () => {
  it('N 行均分表格框可用高度（扣掉余量），向下取整到 0.5pt', () => {
    // (200 - 18 - 18 - 2) / 5 = 32.4 → 32
    expect(computeVoucherBodyRowHeightPt({ tableHeightPt: 200, rows: 5, headerPt: 18, footerPt: 18 })).toBe(32)
  })

  it('没传表头高度时按 hiprint 默认 td 高度，没开合计行时表尾按 0', () => {
    const h = computeVoucherBodyRowHeightPt({ tableHeightPt: 120, rows: 5 })
    expect(h).toBe((120 - HIPRINT_DEFAULT_TD_HEIGHT_PT - VOUCHER_ROWS_FILL_SLACK_PT) / 5)
  })

  it('rows 为 0 返回 0；表格太矮时行高不低于下限', () => {
    expect(computeVoucherBodyRowHeightPt({ tableHeightPt: 200, rows: 0 })).toBe(0)
    expect(computeVoucherBodyRowHeightPt({ tableHeightPt: 30, rows: 10, headerPt: 18 })).toBe(
      VOUCHER_MIN_BODY_ROW_HEIGHT_PT
    )
  })
})

describe('applyVoucherTableRows', () => {
  const base = { height: 200, autoCompletion: true, tableFooterRepeat: 'last', columns: [[]] }

  it('写入 maxRows / autoCompletion / tableBodyRowHeight，不改入参', () => {
    const next = applyVoucherTableRows(base, { rows: 5, headerPt: 18, footerPt: 18 })
    expect(next.maxRows).toBe(5)
    expect(next.autoCompletion).toBe(true)
    expect(next.tableBodyRowHeight).toBe(32)
    expect(base).not.toHaveProperty('maxRows')
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
    const next = applyVoucherTableRows({ height: 160 }, { rows: 7, headerPt: 18, footerPt: 18 })
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
  })

  it('传 0 时不固定', () => {
    const el = buildEntriesTable(12, 30, 186, 70, [], 0)
    expect(el.options).not.toHaveProperty('maxRows')
    expect(el.options).not.toHaveProperty('tableBodyRowHeight')
  })
})
