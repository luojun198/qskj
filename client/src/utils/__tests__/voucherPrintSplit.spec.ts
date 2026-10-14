import { describe, it, expect, vi } from 'vitest'

vi.mock('vue-plugin-hiprint/dist/print-lock.css?url', () => ({ default: '' }))
vi.mock('vue-plugin-hiprint/dist/print-lock.css?raw', () => ({ default: '' }))

import {
  splitVoucherForPrint,
  voucherToHiprintData,
  buildDefaultVoucherPanel,
  VOUCHER_PAPER_WIDTH_MM,
  VOUCHER_PAPER_HEIGHT_MM,
} from '../printTemplateDefaultsHiprint'
import {
  VOUCHER_SUMMARY_FORMATTER_SRC,
  VOUCHER_SUMMARY_LABEL_FORMATTER_SRC,
} from '../hiprintVoucherProvider'
import {
  buildVoucherPrintDocument,
  disableVoucherPaperNumber,
  injectVoucherSummaryFormatter,
  normalizePanelForRender,
  panelSizeMm,
  placeVoucherPageText,
  computeVoucherMarginTransform,
  normalizeVoucherMargins,
  applyVoucherMargins,
  panelContentBoxMm,
  templateVoucherMargins,
  voucherRowsPerPage,
} from '../printTemplateHiprint'
import type { VoucherPrintData } from '@/types/print'

function voucher(n: number): VoucherPrintData {
  const entries = Array.from({ length: n }, (_, i) => ({
    summary: `分录${i + 1}`,
    account_code: '1001',
    account_name: '库存现金',
    debit: i % 2 === 0 ? 100 : 0,
    credit: i % 2 === 0 ? 0 : 100,
  }))
  const total = entries.reduce((s, e) => s + e.debit, 0)
  return {
    id: 'v1',
    voucher_no: '001',
    date: '2026-10-10',
    voucher_type: '记',
    attachments: 0,
    account_set_name: '测试账套',
    entries,
    total_debit: total,
    total_credit: entries.reduce((s, e) => s + e.credit, 0),
    created_by: '张三',
    created_at: '2026-10-10',
  }
}

const formatter = new Function(`return ${VOUCHER_SUMMARY_FORMATTER_SRC}`)() as (
  ...args: unknown[]
) => string
const labelFormatter = new Function(`return ${VOUCHER_SUMMARY_LABEL_FORMATTER_SRC}`)() as (
  ...args: unknown[]
) => string

describe('splitVoucherForPrint 凭证切页', () => {
  it.each([
    [6, 1],
    [7, 2],
    [11, 2],
    [12, 3],
    [16, 3],
    [17, 4],
  ])('%i 条分录、每页 6 行 → %i 页', (n, pages) => {
    const list = splitVoucherForPrint(voucher(n), 6)
    expect(list).toHaveLength(pages)
    list.forEach(p => expect(p.pageEntries!.length).toBeLessThanOrEqual(6))
    // 去掉承前页后正好是全部分录、顺序不变
    const real = list.flatMap(p => p.pageEntries!.filter(e => e.summary !== '承前页'))
    expect(real.map(e => e.summary)).toEqual(voucher(n).entries.map(e => e.summary))
  })

  it('续页首行承前页 = 之前累计；末页累计 = 全凭证合计', () => {
    const v = voucher(13)
    const list = splitVoucherForPrint(v, 6)
    expect(list[0].pageEntries![0].summary).toBe('分录1')
    expect(list[1].pageEntries![0]).toMatchObject({
      summary: '承前页',
      debit: list[0].pageDebit,
      credit: list[0].pageCredit,
    })
    const last = list[list.length - 1]
    expect(last.pageDebit).toBe(v.total_debit)
    expect(last.pageCredit).toBe(v.total_credit)
  })

  it('单页时凭证号不带页次、合计行写「合计」', () => {
    const [page] = splitVoucherForPrint(voucher(3), 6)
    const data = voucherToHiprintData(page)
    expect(data.voucher_no_text).toBe('记-001')
    expect(data.page_text).toBe('')
    expect((data.entries as Array<Record<string, unknown>>)[0].__sum_label).toBe('合计')
  })

  it('多页时凭证号带页次，非末页「过次页」、末页「合计」', () => {
    const datas = splitVoucherForPrint(voucher(7), 6).map(p => voucherToHiprintData(p))
    expect(datas.map(d => d.voucher_no_text)).toEqual(['记-001', '记-001'])
    expect(datas.map(d => d.page_text)).toEqual(['1/2', '2/2'])
    const labels = datas.map(d => (d.entries as Array<Record<string, unknown>>)[0].__sum_label)
    expect(labels).toEqual(['过次页', '合计'])
  })

  it('合计金额 formatter 对含承前页的本页行求和 = 截至本页累计', () => {
    const v = voucher(7)
    const datas = splitVoucherForPrint(v, 6).map(p => voucherToHiprintData(p))
    const col = { field: 'debit', tableSummaryNumFormat: 2 }
    expect(formatter(col, [], datas[1].entries, {})).toContain('400.00')
  })
})

describe('合计行标签 formatter', () => {
  it('优先读行数据里的 __sum_label', () => {
    const html = labelFormatter({ tableSummaryText: '合计', tableSummaryColspan: 3 }, [], [{ __sum_label: '过次页' }], {
      tableBodyRowHeight: 20,
    })
    expect(html).toContain('过次页')
    expect(html).toContain('colspan="3"')
    expect(html).toContain('height: 20pt')
  })

  it('没有 __sum_label 时回退模板文字（老数据 / 设计器示例）', () => {
    expect(labelFormatter({ tableSummaryText: '合计' }, [], [{}], {})).toContain('>合计<')
  })

  it('注入：sum 列与 text 列都挂上 formatter，已有的不覆盖', () => {
    const tpl = {
      panels: [
        {
          printElements: [
            {
              options: {
                field: 'entries',
                columns: [
                  [
                    { field: 'summary', tableSummary: 'text', tableSummaryText: '合计' },
                    { field: 'debit', tableSummary: 'sum' },
                    { field: 'credit', tableSummary: 'sum', tableSummaryFormatter: 'keep' },
                  ],
                ],
              },
              printElementType: { type: 'table' },
            },
          ],
        },
      ],
    }
    const cols = (injectVoucherSummaryFormatter(tpl).panels[0].printElements[0].options as any).columns[0]
    expect(cols[0].tableSummaryFormatter).toBe(VOUCHER_SUMMARY_LABEL_FORMATTER_SRC)
    expect(cols[1].tableSummaryFormatter).toBe(VOUCHER_SUMMARY_FORMATTER_SRC)
    expect(cols[2].tableSummaryFormatter).toBe('keep')
  })
})

describe('凭证面板归一化', () => {
  it('默认凭证纸 220×140，每页行数取模板固定行数', () => {
    const tpl = buildDefaultVoucherPanel()
    expect(panelSizeMm(tpl)).toEqual({ width: VOUCHER_PAPER_WIDTH_MM, height: VOUCHER_PAPER_HEIGHT_MM })
    expect(VOUCHER_PAPER_WIDTH_MM).toBe(220)
    expect(VOUCHER_PAPER_HEIGHT_MM).toBe(140)
    expect(voucherRowsPerPage(tpl, 99)).toBe(6)
    expect(voucherRowsPerPage({ panels: [{ printElements: [] }] }, 99)).toBe(99)
  })

  it('凭证面板关闭 hiprint 页码，非凭证面板不动', () => {
    const voucherTpl = normalizePanelForRender(buildDefaultVoucherPanel())
    expect((voucherTpl.panels[0] as any).paperNumberDisabled).toBe(true)
    const other = { panels: [{ printElements: [{ options: { field: 'content' }, printElementType: { type: 'html' } }] }] }
    expect((disableVoucherPaperNumber(other).panels[0] as any).paperNumberDisabled).toBeUndefined()
  })
})

describe('buildVoucherPrintDocument 纸张模式', () => {
  const papers = ['<div class="hiprint-printPaper">A</div>', '<div class="hiprint-printPaper">B</div>']

  it('适应打印机纸张：@page 不写 size，每张凭证一个等比缩放页框', () => {
    const doc = buildVoucherPrintDocument(papers, { mode: 'fit', widthMm: 220, heightMm: 140 })
    expect(doc.head).toMatch(/@page\{margin:0\}/)
    expect(doc.head).not.toMatch(/@page\{size/)
    expect(doc.body.match(/class="cw-fit-page"/g)).toHaveLength(2)
    expect(doc.body).toContain('preserveAspectRatio="xMidYMin meet"')
  })

  it('凭证纸 1:1：@page 写模板宽高，纸面高度留安全余量', () => {
    const doc = buildVoucherPrintDocument(papers, { mode: 'actual', widthMm: 220, heightMm: 140 })
    expect(doc.head).toContain('@page{size:220mm 140mm;margin:0}')
    expect(doc.head).toContain('max-height:139.5mm!important')
    expect(doc.body).toContain('hiprint-printTemplate')
  })
})

describe('placeVoucherPageText 页次贴表格右边框', () => {
  const table = { options: { field: 'entries', left: 34, width: 590 }, printElementType: { type: 'table' } }
  const no = { options: { field: 'voucher_no_text', left: 380, top: 57, width: 100, height: 20 }, printElementType: { type: 'text' } }
  const fields = (tpl: any) => tpl.panels[0].printElements.map((e: any) => e.options.field)

  it('无附单据时补页次元素，右端对齐表格右边框、与凭证号同一行', () => {
    const out: any = placeVoucherPageText({ panels: [{ printElements: [table, no] }] })
    const page = out.panels[0].printElements.find((e: any) => e.options.field === 'page_text')
    expect(page.options.left + page.options.width).toBe(624)
    expect(page.options.top).toBe(57)
    expect(page.options.textAlign).toBe('right')
  })

  it('附单据占着右端时改绑 attachments_page_text，不再补元素', () => {
    const att = { options: { field: 'attachments_text', left: 527, top: 57, width: 96, height: 20 }, printElementType: { type: 'text' } }
    const out = placeVoucherPageText({ panels: [{ printElements: [table, no, att] }] })
    expect(fields(out)).toEqual(['entries', 'voucher_no_text', 'attachments_page_text'])
  })

  it('模板已有页次字段时按设计位置不动；标准模板接在「字第几号」后面', () => {
    const page = { options: { field: 'page_text', left: 1, top: 1 }, printElementType: { type: 'text' } }
    const tpl = { panels: [{ printElements: [table, no, page] }] }
    expect(placeVoucherPageText(tpl)).toEqual(tpl)
    expect(fields(normalizePanelForRender(buildDefaultVoucherPanel()))).toContain('voucher_word_page_text')
  })

  it('附单据与页次合并显示', () => {
    const [p1] = splitVoucherForPrint({ ...voucher(7), attachments: 2 }, 6).map(p => voucherToHiprintData(p))
    expect(p1.attachments_page_text).toBe('附单据 2 张　1/2')
  })
})

describe('标准凭证版式数据', () => {
  const base = {
    ...voucher(2),
    voucher_no: '记-001',
    date: '2026-08-06',
    attachments: 0,
    account_set_name: '深圳市丰粮农产品有限公司',
    maker: '黄会计',
  }

  it('单位名称、中文日期、字第几号、附单据竖排、签章五栏', () => {
    const d = voucherToHiprintData(splitVoucherForPrint(base, 6)[0], { brand: '润衡财经软件' })
    expect(d.unit_text).toBe('单位名称：深圳市丰粮农产品有限公司')
    expect(d.date_cn_text).toBe('2026年08月06日')
    expect(d.voucher_word_text).toBe('[记] 字第 1 号')
    expect(d.voucher_word_page_text).toBe('[记] 字第 1 号')
    expect(d.attachments_side_text).toBe('附单据　张')
    expect(d.brand_text).toBe('润衡财经软件')
    expect(d.supervisor_text).toBe('会计主管：')
    expect(d.cashier_text).toBe('出纳：')
    expect(d.maker_text).toBe('制单：黄会计')
  })

  it('科目全称 = 上级路径 + 辅助项目；承前页行为空', () => {
    const v = {
      ...base,
      entries: [
        {
          summary: '收款',
          account_code: '112201',
          account_name: '零散户',
          account_full_name: '应收账款/零散户',
          aux_data: { customer: { id: 'c', name: '239陈佳洪' } },
          debit: 0,
          credit: 1,
        },
      ],
    }
    const d = voucherToHiprintData(splitVoucherForPrint(v, 6)[0])
    expect((d.entries as any[])[0].account_full_text).toBe('应收账款/零散户/239陈佳洪')
    const pages = splitVoucherForPrint(voucher(7), 6).map(p => voucherToHiprintData(p))
    expect((pages[1].entries as any[])[0].account_full_text).toBe('')
  })

  it('大写金额只在末页合计；多页时字号后接页次', () => {
    const pages = splitVoucherForPrint({ ...voucher(7), voucher_no: '记-012' }, 6).map(p => voucherToHiprintData(p))
    expect((pages[0].entries as any[])[0].__sum_upper).toBe('')
    expect((pages[1].entries as any[])[0].__sum_upper).toBe('肆佰元整')
    expect(pages.map(p => p.voucher_word_page_text)).toEqual(['[记] 字第 12 号　1/2', '[记] 字第 12 号　2/2'])
  })

  it('标签格跨 2 列以上且有大写时拆成「合计」+ 大写两格', () => {
    const html = labelFormatter({ tableSummaryText: '合计', tableSummaryColspan: 3 }, [], [{ __sum_label: '合计', __sum_upper: '壹元整' }], {})
    expect(html).toContain('colspan="1">合计</td>')
    expect(html).toContain('colspan="2">壹元整</td>')
    // 跨 1 列放不下大写，只出标签
    expect(labelFormatter({ tableSummaryText: '合计' }, [], [{ __sum_label: '合计', __sum_upper: '壹元整' }], {})).not.toContain('壹元整')
  })
})

describe('凭证打印边距', () => {
  const paper = { width: 220, height: 140 }
  // 内容外包框：左 20、上 10、右 200、下 120（宽 180、高 110）
  const box = { left: 20, top: 10, right: 200, bottom: 120 }

  it('模板自身边距 = 外包框到纸边距离；按它套用 = 原样', () => {
    const m = templateVoucherMargins(box, paper)
    expect(m).toEqual({ top: 10, bottom: 20, left: 20, right: 20 })
    expect(computeVoucherMarginTransform(m, box, paper)).toEqual({ translateX: 0, translateY: 0, scale: 1 })
  })

  it('区域够大时原尺寸平移：左 30、右 10 → 内容右移 10mm', () => {
    expect(computeVoucherMarginTransform({ top: 10, bottom: 20, left: 30, right: 10 }, box, paper)).toEqual({
      translateX: 10,
      translateY: 0,
      scale: 1,
    })
  })

  it('装不下时等比缩小，左上角贴住边距', () => {
    // 宽可用 220-30-28 = 162 → 162/180 = 0.9；高够用
    const t = computeVoucherMarginTransform({ top: 10, bottom: 20, left: 30, right: 28 }, box, paper)
    expect(t.scale).toBeCloseTo(0.9, 4)
    expect(t.translateX).toBeCloseTo(30 - 20 * 0.9, 3)
    expect(t.translateY).toBeCloseTo(10 - 10 * 0.9, 3)
  })

  it('外包框取所有元素（pt 换算 mm）', () => {
    const b = panelContentBoxMm(buildDefaultVoucherPanel())!
    expect(b.left).toBeGreaterThan(15)
    expect(b.right).toBeLessThan(220)
    expect(b.bottom).toBeLessThan(140)
  })

  it('归一化：非数字归 0、超范围截断、保留 1 位小数', () => {
    expect(normalizeVoucherMargins({ top: 'x' as any, bottom: 999, left: -5, right: 1.26 })).toEqual({
      top: 0,
      bottom: 80,
      left: 0,
      right: 1.3,
    })
  })

  it('套到纸面内容层；原样时清掉变换', () => {
    const el = document.createElement('div')
    el.innerHTML = '<div class="hiprint-printPaper"><div class="hiprint-printPaper-content"></div></div>'
    const content = el.querySelector<HTMLElement>('.hiprint-printPaper-content')!
    applyVoucherMargins(el, { top: 10, bottom: 20, left: 30, right: 10 }, box, paper)
    expect(content.style.transform).toBe('translate(10mm, 0mm) scale(1)')
    applyVoucherMargins(el, templateVoucherMargins(box, paper), box, paper)
    expect(content.style.transform).toBe('')
  })
})
