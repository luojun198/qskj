import { describe, it, expect } from 'vitest'
import { buildDefaultScmPanel, buildScmTableColumns, scmDocToHiprintData, scmTemplateKey, SCM_TABLE_FIELD, SCM_TEXT_FIELDS } from '../hiprintScmProvider'

const fmt = { qty: (v: unknown) => String(v), price: (v: unknown) => Number(v).toFixed(2), amount: (v: unknown) => Number(v).toFixed(2) }

describe('业务单据打印模板', () => {
  it('模板键按单据类型，* 为通用', () => {
    expect(scmTemplateKey('SOa')).toBe('scm:SOa')
    expect(scmTemplateKey('')).toBe('scm:*')
  })

  it('默认版面：表头字段 + 一张明细表，字段都在字段目录里，不显示页码', () => {
    const panel = buildDefaultScmPanel().panels[0] as any
    expect(panel.paperNumberDisabled).toBe(true)
    const fields = panel.printElements.map((e: any) => e.options.field)
    expect(fields).toContain(SCM_TABLE_FIELD)
    const known = new Set([...SCM_TEXT_FIELDS.map(f => f.field), SCM_TABLE_FIELD])
    expect(fields.every((f: string) => known.has(f))).toBe(true)
    const table = panel.printElements.find((e: any) => e.options.field === SCM_TABLE_FIELD)
    const shown = table.options.columns[0].filter((c: any) => c.checked).map((c: any) => c.field)
    expect(shown).toEqual(['seq', 'item_code', 'item_name', 'spec', 'unit', 'qty', 'price', 'amount', 'remark'])
    expect(buildScmTableColumns().map(c => c.field)).toContain('gross')
  })

  it('打印数据：合计、价税合计大写、客户 / 供应商标签、明细行', () => {
    const data = scmDocToHiprintData({
      doc_type: 'SO', doc_no: 'SO-1', doc_date: '2026-10-01', partner_code: 'K1', partner_name: '客户甲', maker: '张三',
      lines: [
        { item_code: 'A', item_name: '电容', qty: 10, price: 1, amount: 10, tax_amount: 1.3, tax_rate: 13 },
        { item_code: 'B', item_name: '铝箔', qty: 5, price: 2, amount: 10, tax_amount: 1.3, tax_rate: 13 },
      ],
    }, { company: '甲公司', title: '销售出库单', fmt, partner: { contact: '李四', phone: '138' } }) as any
    expect(data.partner).toBe('客户：K1 客户甲')
    expect(data.total_gross).toBe('价税合计：22.60')
    expect(data.total_upper).toBe('大写：贰拾贰元陆角')
    expect(data.partner_contact).toBe('联系人：李四 138')
    expect(data.maker).toBe('制单：张三')
    expect(data[SCM_TABLE_FIELD]).toHaveLength(2)
    expect(data[SCM_TABLE_FIELD][1]).toMatchObject({ seq: 2, item_code: 'B', gross: '11.30', tax_rate: '13' })
    const purchase = scmDocToHiprintData({ doc_type: 'PI', partner_code: 'G1', lines: [] }, { title: '采购入库单', fmt }) as any
    expect(purchase.partner).toBe('供应商：G1')
  })
})
