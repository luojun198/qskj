import { describe, expect, it, vi } from 'vitest'
import {
  buildSingleHtmlPanel,
  buildTablePrintHtml,
  renderHiprintPdfBlob,
} from '@/utils/printTemplateHiprint'

describe('printTemplateHiprint', () => {
  it('按 A4 横向尺寸构造无底图 HTML 面板', () => {
    const template = buildSingleHtmlPanel({
      html: '<table></table>',
      paperType: 'A4',
      orientation: 'landscape',
      background: null,
    })

    expect(template.panels).toHaveLength(1)
    expect(template.panels[0].paperType).toBe('A4')
    expect(template.panels[0].width).toBe(297)
    expect(template.panels[0].height).toBe(210)
    expect(template.panels[0].background).toBeUndefined()
  })

  it('生成带多级表头、合计行且无底色的黑白表格', () => {
    const html = buildTablePrintHtml({
      title: '科目余额表 & 测试',
      subtitle: ['账套：测试账套', '筛选口径：全部'],
      monochrome: true,
      fitToPage: true,
      headerRows: [
        [
          { label: '科目', rowspan: 2 },
          { label: '本期发生额', colspan: 2 },
        ],
        [{ label: '借方' }, { label: '贷方' }],
      ],
      columns: [
        { label: '科目', align: 'left', render: row => row.name },
        { label: '借方', align: 'right', render: row => row.debit },
        { label: '贷方', align: 'right', render: row => row.credit },
      ],
      rows: [{ name: '<库存现金>', debit: '1,000.00', credit: '' }],
      rowStyle: () => 'font-weight:600;background:red;color:red;',
      footer: ['合计', '1,000.00', '0.00'],
    })

    expect(html).toContain('rowspan="2"')
    expect(html).toContain('colspan="2"')
    expect(html).toContain('科目余额表 &amp; 测试')
    expect(html).toContain('&lt;库存现金&gt;')
    expect(html).toContain('合计')
    expect(html).toContain('table-header-group')
    expect(html).toContain('table-layout:fixed')
    expect(html).toContain('<colgroup>')
    expect(html).toContain('width:33.333333333333336%')
    expect(html).toContain('page-break-inside: avoid')
    expect(html).not.toMatch(/background\s*:/i)
    expect(html).not.toContain('color:red')
  })

  it('使用真实 toPdf API 生成 Blob 并关闭插件内部下载', async () => {
    const expected = new Blob(['pdf-data'], { type: 'application/pdf' })
    const toPdf = vi.fn().mockResolvedValue(expected)

    const blob = await renderHiprintPdfBlob({ toPdf }, { content: 'test' }, '科目余额表.pdf')

    expect(blob).toBe(expected)
    expect(toPdf).toHaveBeenCalledWith({ content: 'test' }, '科目余额表.pdf', {
      isDownload: false,
      type: 'blob',
    })
  })

  it('根据宽表列数自动收紧 A4 自适应字号和间距', () => {
    const columns = Array.from({ length: 16 }, (_, index) => ({
      label: `第${index + 1}列`,
      align: 'right' as const,
      render: () => '1,000.00',
    }))

    const html = buildTablePrintHtml({
      title: '辅助明细账',
      monochrome: true,
      fitToPage: true,
      columns,
      rows: [{}],
    })

    expect(html).toContain('font-size:7px')
    expect(html).toContain('padding:2px 1px')
    expect(html).toContain('width:6.25%')
    expect(html).toContain('white-space:nowrap')
  })
})
