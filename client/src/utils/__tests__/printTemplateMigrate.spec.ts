import { describe, expect, it } from 'vitest'
import { mmToPt } from '@/utils/printTemplateHiprint'
import { getVoucherHiprintFieldKeys } from '@/utils/hiprintVoucherProvider'
import {
  buildDefaultVoucherPanel,
  buildSampleVoucherPrintData,
  voucherToHiprintData,
} from '@/utils/printTemplateDefaultsHiprint'
import {
  buildUpgradedTemplatePayload,
  isHiprintTemplate,
  isLegacyPrintTemplate,
  migrateElementsToHiprintPanel,
} from '@/utils/printTemplateMigrate'
import type { FieldElement, PrintTemplate } from '@/types/print'

describe('voucher hiprint fields', () => {
  it('Provider 字段与 voucherToHiprintData 的 key 对齐', () => {
    const data = buildSampleVoucherPrintData()
    for (const key of getVoucherHiprintFieldKeys()) {
      expect(data).toHaveProperty(key)
    }
  })

  it('默认面板元素坐标使用 pt 而不是 CSS px', () => {
    const panel = buildDefaultVoucherPanel().panels[0]
    const title = (panel.printElements as any[]).find(el => el.options?.field === 'doc_title')
    expect(title.options.left).toBe(mmToPt(12))
    expect(title.options.top).toBe(mmToPt(8))
    expect(title.options.testData).toBe('记 账 凭 证')
    expect(panel.paperHeader).toBe(mmToPt(8))
  })

  it('voucherToHiprintData 拼出字号与签章', () => {
    const data = voucherToHiprintData({
      id: '1',
      voucher_no: '12',
      date: '2026-01-02',
      voucher_type: '记',
      attachments: 3,
      account_set_name: '甲公司',
      entries: [{ summary: 'a', account_code: '1001', account_name: '现金', debit: 10, credit: 0 }],
      total_debit: 10,
      total_credit: 10,
      created_by: '张三',
      created_at: '2026-01-02',
      maker: '张三',
    })
    expect(data.voucher_no_text).toBe('记-12')
    expect(data.attachments_text).toBe('附单据 3 张')
    expect(data.maker_text).toBe('制单：张三')
  })
})

describe('printTemplateMigrate', () => {
  it('识别 hiprint / 旧模板', () => {
    expect(isHiprintTemplate({ panel: { panels: [{}] } })).toBe(true)
    expect(isLegacyPrintTemplate({ elements: [{ id: '1' }] })).toBe(true)
    expect(isLegacyPrintTemplate({ panel: { panels: [{}] }, elements: [{ id: '1' }] })).toBe(false)
  })

  it('把 FieldElement 转成 hiprint panel 并映射字段', () => {
    const elements: FieldElement[] = [
      {
        id: 't1',
        type: 'title',
        x: 10,
        y: 4,
        width: 80,
        height: 8,
        fontSize: 16,
        fontWeight: 'bold',
        align: 'center',
      },
      {
        id: 'tb',
        type: 'table',
        x: 10,
        y: 20,
        width: 180,
        height: 40,
        fontSize: 11,
        fontWeight: 'normal',
        align: 'left',
        columns: [
          { field: 'summary', label: '摘要', width: '50%', visible: true },
          { field: 'aux_CAT001', label: '部门', width: '50%', visible: true },
        ],
      },
    ]
    const { panel, warnings } = migrateElementsToHiprintPanel({
      paper_width: 210,
      paper_height: 148,
      paper_size: 'custom',
      elements,
    })
    const els = panel.panels[0].printElements as any[]
    expect(els[0].options.field).toBe('doc_title')
    expect(els[0].options.testData).toBe('记 账 凭 证')
    expect(els[0].options.left).toBe(mmToPt(10))
    expect(els[1].options.field).toBe('entries')
    expect(els[1].options.columns[0].some((c: { field: string }) => c.field === 'aux_CAT001')).toBe(true)
    expect(warnings).toEqual([])
  })

  it('voucherToHiprintData 把辅助项目摊平到 aux_code 字段', () => {
    const data = voucherToHiprintData({
      id: '1',
      voucher_no: '1',
      date: '2026-01-02',
      voucher_type: '记',
      attachments: 0,
      account_set_name: '甲',
      entries: [
        {
          summary: 'a',
          account_code: '1001',
          account_name: '现金',
          debit: 10,
          credit: 0,
          aux_data: { dept: { id: 'd1', name: '财务部' } },
        },
      ],
      total_debit: 10,
      total_credit: 10,
      created_by: '张三',
      created_at: '2026-01-02',
    })
    expect((data.entries as Array<Record<string, string>>)[0].aux_dept).toBe('财务部')
  })

  it('升级 payload 写入 panel 并保留原 elements', () => {
    const template = {
      id: 'tpl1',
      account_set_id: 'as1',
      name: '旧模板',
      paper_size: 'custom',
      paper_width: 220,
      paper_height: 140,
      margin_top: 10,
      margin_bottom: 10,
      margin_left: 10,
      margin_right: 10,
      elements: [
        {
          id: 't1',
          type: 'voucher_no',
          x: 0,
          y: 0,
          width: 40,
          height: 6,
          fontSize: 12,
          fontWeight: 'normal',
          align: 'left',
        },
      ],
      is_default: false,
      created_at: '',
      updated_at: '',
    } as PrintTemplate
    const { payload } = buildUpgradedTemplatePayload(template)
    expect(payload.template_key).toBe('voucher:standard')
    expect((payload.panel as any).panels[0].printElements[0].options.field).toBe('voucher_no_text')
    expect(payload.elements).toHaveLength(1)
  })
})
