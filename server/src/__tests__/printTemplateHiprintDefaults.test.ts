import { describe, expect, it } from 'vitest'
import {
  DEFAULT_VOUCHER_FIXED_ROWS,
  buildDefaultVoucherHiprintPanel,
  computeBodyRowHeightPt,
  VOUCHER_STANDARD_LAYOUT_VERSION,
} from '../services/printTemplateHiprintDefaults.js'

const findTable = (panel: ReturnType<typeof buildDefaultVoucherHiprintPanel>) =>
  panel.panels[0].printElements.find(el => el.printElementType.type === 'table') as any

describe('buildDefaultVoucherHiprintPanel（新建账套默认凭证模板）', () => {
  it('标准凭证：凭证纸 220×140，固定 6 行，合计行内嵌，超出分页', () => {
    const panel = buildDefaultVoucherHiprintPanel()
    const p = panel.panels[0]
    expect([p.width, p.height]).toEqual([220, 140])
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

  it('标准四列：摘要 / 会计科目（全称）/ 借方 / 贷方；合计标签跨两列（拆成「合计」+ 大写金额）', () => {
    const cols = findTable(buildDefaultVoucherHiprintPanel()).options.columns[0] as any[]
    const byField = Object.fromEntries(cols.map(c => [c.field, c]))
    expect(cols.filter(c => c.checked).map(c => c.field)).toEqual([
      'summary',
      'account_full_text',
      'debit',
      'credit',
    ])
    expect(byField.debit.tableSummary).toBe('sum')
    expect(byField.credit.tableSummary).toBe('sum')
    expect(byField.summary.tableSummary).toBe('text')
    expect(byField.summary.tableSummaryText).toBe('合计')
    expect(byField.summary.tableSummaryColspan).toBe(2)
    expect(byField.account_full_text.tableSummaryColspan).toBe(0)
    // 科目编码 / 末级科目名 / 可选列保留在列目录但不勾选
    expect(byField.account_code.checked).toBe(false)
    expect(byField.account_name.checked).toBe(false)
    expect(byField.quantity.checked).toBe(false)
    expect(byField.quantity.tableSummary).toBeUndefined()
  })

  it('版式元素：标题下划线、单位名称、中文日期、字第几号、竖排品牌与附单据、五栏签章；带版本标记', () => {
    const p = buildDefaultVoucherHiprintPanel().panels[0]
    const fields = p.printElements.map(el => (el.options as any).field).filter(Boolean)
    for (const f of [
      'doc_title',
      'unit_text',
      'date_cn_text',
      'voucher_word_text',
      'brand_text',
      'attachments_side_text',
      'supervisor_text',
      'auditor_text',
      'poster_text',
      'cashier_text',
      'maker_text',
    ]) {
      expect(fields).toContain(f)
    }
    expect(p.printElements.some(el => el.printElementType.type === 'hline')).toBe(true)
    expect(p.cwLayoutVersion).toBe(VOUCHER_STANDARD_LAYOUT_VERSION)
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
