import { describe, expect, it } from 'vitest'
import { buildPrintTableHtml } from '../printSimpleTable'

describe('通用列表打印', () => {
  const columns = [
    { label: '物料', value: (r: any) => r.name },
    { label: '数量', align: 'right' as const, value: (r: any) => r.qty },
  ]

  it('输出标题、表头、数据、合计行，并转义 HTML', () => {
    const html = buildPrintTableHtml({ title: '库存查询', subtitle: '全部仓库', columns, rows: [{ name: '<CPU>', qty: '21.00' }], summary: ['合计', '21.00'] })
    expect(html).toContain('<h1>库存查询</h1>')
    expect(html).toContain('<div class="sub">全部仓库</div>')
    expect(html).toContain('<th style="text-align:center">物料</th>')
    expect(html).toContain('<td>&lt;CPU&gt;</td>')
    expect(html).toContain('<td style="text-align:right">21.00</td>')
    expect(html).toContain('<tr class="sum">')
    expect(html).toContain('border: 1px solid #000')
  })

  it('列多时横向打印', () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ label: `C${i}`, value: () => i }))
    expect(buildPrintTableHtml({ title: 't', columns: many, rows: [] })).toContain('A4 landscape')
    expect(buildPrintTableHtml({ title: 't', columns, rows: [] })).toContain('A4 portrait')
  })
})
