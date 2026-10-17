import { describe, it, expect, vi } from 'vitest'

vi.mock('vue-plugin-hiprint/dist/print-lock.css?url', () => ({ default: '' }))
vi.mock('vue-plugin-hiprint/dist/print-lock.css?raw', () => ({ default: '' }))

import {
  buildForeignVoucherPanel,
  buildVoucherPanel,
  voucherHasForeign,
  voucherPresetMeta,
  voucherToHiprintData,
} from '../printTemplateDefaultsHiprint'
import { normalizePanelForRender } from '../printTemplateHiprint'
import { VOUCHER_FX_CELL_FORMATTER_SRC } from '../hiprintVoucherProvider'
import type { VoucherPrintData } from '@/types/print'

const voucher: VoucherPrintData = {
  id: 'v1', voucher_no: '记-001', date: '2026-10-15', voucher_type: '记', attachments: 0, account_set_name: 'xx公司',
  entries: [
    { summary: '销售出货给美国客户', account_code: '1122', account_name: '应收账款', debit: 78960, credit: 0,
      currency_code: 'USD', exchange_rate: 7896, foreign_amount: 10000 },
    { summary: '销售出货给美国客户', account_code: '6001', account_name: '主营业务收入', debit: 0, credit: 78960 },
  ] as any,
  total_debit: 78960, total_credit: 78960, created_by: '系统管理', created_at: '2026-10-15',
}

function tableColumns(panel: any) {
  const table = panel.panels[0].printElements.find((e: any) => e.printElementType?.type === 'table')
  return table.options.columns[0] as any[]
}

describe('复币记账凭证打印', () => {
  it('版式：摘要 | 会计科目 | 外币金额 | 汇率 | 借方 | 贷方，标题「记账凭证(复币)」', () => {
    const panel = buildForeignVoucherPanel() as any
    const shown = tableColumns(panel).filter(c => c.checked !== false).map(c => c.field)
    expect(shown).toEqual(['summary', 'account_full_text', 'fx_cell', 'exchange_rate', 'debit', 'credit'])
    expect(panel.panels[0].printElements.some((e: any) => e.options?.field === 'doc_title_fx')).toBe(true)
    // 合计行：「合计」+ 大写跨到汇率列，借贷求和
    const cols = tableColumns(panel)
    expect(cols[0]).toMatchObject({ tableSummary: 'text', tableSummaryColspan: 4 })
    expect(voucherPresetMeta('foreign')).toMatchObject({ name: '复币记账凭证', template_key: 'voucher:foreign' })
  })

  it('渲染前给复币格注入渲染函数', () => {
    const panel = normalizePanelForRender(buildForeignVoucherPanel()) as any
    const fx = tableColumns(panel).find(c => c.field === 'fx_cell')
    expect(fx.renderFormatter).toBe(VOUCHER_FX_CELL_FORMATTER_SRC)
  })

  it('数据：外币分录带币种与外币金额，本位币分录只显示本位币代码；汇率 4 位小数', () => {
    const data = voucherToHiprintData(voucher, { baseCurrency: 'RMB' }) as any
    expect(data.doc_title_fx).toBe('记账凭证(复币)')
    expect(data.entries[0]).toMatchObject({ fx_currency: 'USD', fx_amount: '10,000.00', exchange_rate: '7,896.0000' })
    expect(data.entries[1]).toMatchObject({ fx_currency: 'RMB', fx_amount: '', exchange_rate: '' })
    expect(voucherHasForeign(voucher)).toBe(true)
    expect(voucherHasForeign({ entries: [voucher.entries[1]] })).toBe(false)
  })

  it('复币格渲染函数：画出「币种」框、转义内容', () => {
    let fn: any
    // eslint-disable-next-line no-eval
    eval('fn = ' + VOUCHER_FX_CELL_FORMATTER_SRC)
    const html = fn('', { fx_currency: '<b>USD', fx_amount: '10,000.00' })
    expect(html).toContain('币种')
    expect(html).toContain('&lt;b&gt;USD')
    expect(html).toContain('10,000.00')
    expect(fn('', undefined)).toContain('币种')
  })
})

describe('空白打印模板', () => {
  it('blank 预设是空画布，没有预置字段', () => {
    const panel = buildVoucherPanel('blank') as any
    expect(panel.panels[0].printElements).toEqual([])
    expect(voucherPresetMeta('blank')).toMatchObject({
      name: '空白模板',
      template_key: 'voucher:standard',
    })
  })
})
