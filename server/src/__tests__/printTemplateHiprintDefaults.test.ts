import { describe, expect, it } from 'vitest'
import {
  DEFAULT_VOUCHER_FIXED_ROWS,
  buildDefaultVoucherHiprintPanel,
  computeBodyRowHeightPt,
} from '../services/printTemplateHiprintDefaults.js'

const findTable = (panel: ReturnType<typeof buildDefaultVoucherHiprintPanel>) =>
  panel.panels[0].printElements.find(el => el.printElementType.type === 'table') as any

describe('buildDefaultVoucherHiprintPanel（新建账套默认凭证模板）', () => {
  it('标准凭证：凭证纸 210×148，固定 6 行，合计行内嵌，超出分页', () => {
    const panel = buildDefaultVoucherHiprintPanel()
    const p = panel.panels[0]
    expect([p.width, p.height]).toEqual([210, 148])
    const table = findTable(panel)
    expect(DEFAULT_VOUCHER_FIXED_ROWS).toBe(6)
    expect(table.options.maxRows).toBe(6)
    expect(table.options.autoCompletion).toBe(true)
    expect(table.options.tableFooterRepeat).toBe('last')
    expect(table.options.tableHeaderRepeat).toBe('first')
    expect(table.options.tableBodyRowHeight).toBe(
      computeBodyRowHeightPt(table.options.height, 6)
    )
    expect(table.options.tableBodyRowHeight).toBeGreaterThan(8)
    expect(table.options.tableHeaderRowHeight).toBe(table.options.tableBodyRowHeight)
  })

  it('合计行：借/贷方求和，前置列合并成一格放「合计」', () => {
    const cols = findTable(buildDefaultVoucherHiprintPanel()).options.columns[0] as any[]
    const byField = Object.fromEntries(cols.map(c => [c.field, c]))
    expect(byField.debit.tableSummary).toBe('sum')
    expect(byField.credit.tableSummary).toBe('sum')
    expect(byField.summary.tableSummary).toBe('text')
    expect(byField.summary.tableSummaryText).toBe('合计')
    expect(byField.summary.tableSummaryColspan).toBe(3)
    expect(byField.account_code.tableSummaryColspan).toBe(0)
    expect(byField.account_name.tableSummaryColspan).toBe(0)
    // 可选列默认不勾选，不参与合计
    expect(byField.quantity.checked).toBe(false)
    expect(byField.quantity.tableSummary).toBeUndefined()
  })

  it('页脚线压在表格底边；表外不再放合计文本；文本元素固定坐标', () => {
    const panel = buildDefaultVoucherHiprintPanel()
    const p = panel.panels[0]
    const table = findTable(panel)
    expect(p.paperFooter).toBe(table.options.top + table.options.height)
    const fields = p.printElements.map(el => (el.options as any).field)
    expect(fields).not.toContain('total_debit_text')
    expect(fields).not.toContain('total_credit_text')
    for (const el of p.printElements) {
      if (el.printElementType.type === 'text') expect((el.options as any).fixed).toBe(true)
    }
  })

  it('computeBodyRowHeightPt：列头 + N 行 + 合计行扣掉余量后均分，向下取到 0.5pt', () => {
    // (244 - 2) / (6 + 2) = 30.25 → 30
    expect(computeBodyRowHeightPt(244, 6)).toBe(30)
    expect(computeBodyRowHeightPt(244, 0)).toBe(0)
    expect(computeBodyRowHeightPt(40, 20)).toBe(8)
  })
})
