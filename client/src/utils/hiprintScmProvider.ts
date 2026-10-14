/**
 * 业务单据（进销存）自定义打印模板（第六份反馈：业务单据类打印模板在哪里定制、新增模板）。
 *
 * 模板存 print_templates：template_type='scm_doc'，template_key='scm:<单据类型>'（如 scm:SOa），
 * 'scm:*' 表示所有单据通用。设计器复用凭证的 hiprint 设计器：表头字段为文本元素，明细为一张表格元素（字段 lines）。
 * 合计、金额大写作为独立文本字段，不依赖 hiprint 表格合计行。
 */
import { mmToPt } from './printTemplateHiprint'
import { fitVoucherTableColumnWidths } from './hiprintVoucherProvider'
import { rmbUpper } from './rmbUpper'

export const SCM_TEMPLATE_TYPE = 'scm_doc'
export const SCM_TABLE_FIELD = 'lines'
export const scmTemplateKey = (docType: string) => `scm:${docType || '*'}`

export interface ScmTextField { field: string; title: string; testData: string; fontSize: number; fontWeight?: string; textAlign?: string }

export const SCM_TEXT_FIELDS: ScmTextField[] = [
  { field: 'company', title: '单位名称', testData: '东莞市示例电子科技有限公司', fontSize: 15, fontWeight: '700', textAlign: 'center' },
  { field: 'doc_title', title: '单据标题', testData: '销售出库单', fontSize: 14, fontWeight: '700', textAlign: 'center' },
  { field: 'doc_no', title: '单据号', testData: '单号：2610120001', fontSize: 10 },
  { field: 'doc_date', title: '日期', testData: '日期：2026-10-12', fontSize: 10 },
  { field: 'partner', title: '往来单位', testData: '客户：K0101001 广州示例电子有限公司', fontSize: 10 },
  { field: 'partner_contact', title: '联系人 / 电话', testData: '联系人：张三 13800000000', fontSize: 10 },
  { field: 'partner_address', title: '地址', testData: '地址：广东省东莞市某某路 1 号', fontSize: 10 },
  { field: 'warehouse', title: '仓库', testData: '仓库：成品仓', fontSize: 10 },
  { field: 'biz_person', title: '业务员', testData: '业务员：刘总', fontSize: 10 },
  { field: 'contract_no', title: '合同 / 客户订单号', testData: '订单号：CXL20260402-4', fontSize: 10 },
  { field: 'invoice_no', title: '发票号', testData: '发票号：12345678', fontSize: 10 },
  { field: 'remark', title: '备注', testData: '备注：月结 30 天', fontSize: 10 },
  { field: 'total_qty', title: '合计数量', testData: '合计数量：120,000', fontSize: 10 },
  { field: 'total_amount', title: '合计金额（不含税）', testData: '金额：19,115.04', fontSize: 10 },
  { field: 'total_tax', title: '合计税额', testData: '税额：2,484.96', fontSize: 10 },
  { field: 'total_gross', title: '价税合计', testData: '价税合计：21,600.00', fontSize: 10, fontWeight: '700' },
  { field: 'total_upper', title: '金额大写', testData: '大写：贰万壹仟陆佰元整', fontSize: 10 },
  { field: 'maker', title: '制单', testData: '制单：刘兵', fontSize: 10 },
  { field: 'auditor', title: '审核', testData: '审核：系统管理员', fontSize: 10 },
  { field: 'operator', title: '经手 / 保管', testData: '经手人：刘兵', fontSize: 10 },
  { field: 'sign_receiver', title: '签收栏', testData: '收货人签字：____________　日期：________', fontSize: 10 },
  { field: 'print_time', title: '打印时间', testData: '打印：2026-10-14 10:00', fontSize: 9 },
]

export interface ScmTableColumnDef {
  title: string; field: string; width: number; align: 'left' | 'center' | 'right'; halign: 'center'
  columnId: string; colspan: number; checked: boolean
}

/** 明细表列目录：checked = 新建模板时默认显示 */
const COLS: Array<[field: string, title: string, weight: number, align: 'left' | 'center' | 'right', checked: boolean]> = [
  ['seq', '序号', 22, 'center', true],
  ['item_code', '物料编码', 60, 'left', true],
  ['item_name', '名称', 80, 'left', true],
  ['spec', '规格', 60, 'left', true],
  ['unit', '单位', 26, 'center', true],
  ['warehouse', '仓库', 40, 'left', false],
  ['qty', '数量', 44, 'right', true],
  ['price', '单价', 42, 'right', true],
  ['amount', '金额', 50, 'right', true],
  ['tax_rate', '税率%', 28, 'right', false],
  ['tax_amount', '税额', 44, 'right', false],
  ['price_with_tax', '含税单价', 44, 'right', false],
  ['gross', '价税合计', 52, 'right', false],
  ['batch_no', '批号', 44, 'left', false],
  ['remark', '备注', 60, 'left', true],
]

export function buildScmTableColumns(): ScmTableColumnDef[] {
  return COLS.map(([field, title, width, align, checked]) => ({ title, field, width, align, halign: 'center', columnId: field, colspan: 1, checked }))
}

export function buildScmTable(leftMm: number, topMm: number, widthMm: number, heightMm: number) {
  const widthPt = mmToPt(widthMm)
  const columns = fitVoucherTableColumnWidths(buildScmTableColumns(), widthPt)
  return {
    options: {
      left: mmToPt(leftMm), top: mmToPt(topMm), width: widthPt, height: mmToPt(heightMm),
      field: SCM_TABLE_FIELD, tableHeaderRepeat: 'first', fontSize: 9.5,
      tableHeaderFontSize: 10, tableHeaderFontWeight: 'bold', columns: [columns],
    },
    printElementType: { type: 'table', title: '明细表', columns: [columns] },
  }
}

function text(field: string, leftMm: number, topMm: number, widthMm: number, extra: Partial<ScmTextField> = {}) {
  const def = SCM_TEXT_FIELDS.find(f => f.field === field)!
  return {
    options: {
      left: mmToPt(leftMm), top: mmToPt(topMm), width: mmToPt(widthMm), height: mmToPt(7),
      field, title: def.testData, testData: def.testData, fontSize: extra.fontSize ?? def.fontSize,
      fontWeight: extra.fontWeight ?? def.fontWeight ?? '400', textAlign: extra.textAlign ?? def.textAlign ?? 'left', hideTitle: true,
    },
    printElementType: { type: 'text', title: def.title },
  }
}

/** 新建业务单据模板的起始版面（241×140mm 三联单宽度，可在设计器里改纸张） */
export function buildDefaultScmPanel(widthMm = 241, heightMm = 140) {
  const inner = widthMm - 20
  const col = inner / 3
  return {
    panels: [{
      index: 0, paperType: 'other', width: widthMm, height: heightMm, paperHeader: 0, paperFooter: mmToPt(heightMm - 4), paperNumberDisabled: true,
      printElements: [
        text('company', 10, 6, inner),
        text('doc_title', 10, 13, inner),
        text('partner', 10, 22, col * 1.5),
        text('doc_date', 10 + col * 1.5, 22, col * 0.75),
        text('doc_no', 10 + col * 2.25, 22, col * 0.75),
        text('partner_address', 10, 29, col * 1.5),
        text('partner_contact', 10 + col * 1.5, 29, col * 1.5),
        buildScmTable(10, 37, inner, heightMm - 37 - 30),
        text('total_upper', 10, heightMm - 28, col * 1.5),
        text('total_gross', 10 + col * 1.5, heightMm - 28, col * 1.5, { textAlign: 'right' }),
        text('remark', 10, heightMm - 21, inner),
        text('maker', 10, heightMm - 13, col),
        text('auditor', 10 + col, heightMm - 13, col),
        text('sign_receiver', 10 + col * 2, heightMm - 13, col),
      ],
    }],
  }
}

export interface ScmPrintFormat { qty: (v: unknown) => string; price: (v: unknown) => string; amount: (v: unknown) => string }

/** 单据详情 → hiprint 打印数据（文本字段已带标签前缀，与设计器示例一致） */
export function scmDocToHiprintData(doc: any, opts: { company?: string; title: string; fmt: ScmPrintFormat; partner?: any; warehouseName?: (code: string) => string }) {
  const f = opts.fmt
  const lines = (doc.lines || []).filter((l: any) => l.item_code || Number(l.amount))
  const sum = (k: string) => lines.reduce((s: number, l: any) => s + (Number(l[k]) || 0), 0)
  const amount = sum('amount'); const tax = sum('tax_amount'); const gross = amount + tax
  const p = opts.partner || {}
  const isSale = ['SQ', 'SOa', 'SO', 'SR', 'RS', 'RCV'].includes(doc.doc_type)
  const wh = (code: string | null | undefined) => (code ? (opts.warehouseName?.(code) || code) : '')
  const label = (t: string, v: unknown) => (v === null || v === undefined || v === '' ? '' : `${t}：${v}`)
  return {
    company: opts.company || '',
    doc_title: opts.title,
    doc_no: label('单号', doc.doc_no),
    doc_date: label('日期', doc.doc_date),
    partner: label(isSale ? '客户' : '供应商', [doc.partner_code, doc.partner_name || p.name].filter(Boolean).join(' ')),
    partner_contact: label('联系人', [p.contact, p.phone].filter(Boolean).join(' ')),
    partner_address: label('地址', p.ship_address || p.address),
    warehouse: label('仓库', wh(doc.warehouse_code)),
    biz_person: label('业务员', doc.biz_person),
    contract_no: label('订单号', doc.contract_no),
    invoice_no: label('发票号', doc.invoice_no),
    remark: label('备注', doc.remark),
    total_qty: label('合计数量', f.qty(sum('qty'))),
    total_amount: label('金额', f.amount(amount)),
    total_tax: label('税额', f.amount(tax)),
    total_gross: label('价税合计', f.amount(gross)),
    total_upper: label('大写', rmbUpper(gross)),
    maker: label('制单', doc.maker),
    auditor: label('审核', doc.auditor),
    operator: label('经手人', doc.operator),
    sign_receiver: '收货人签字：____________　日期：________',
    print_time: label('打印', new Date().toLocaleString('zh-CN', { hour12: false }).slice(0, 16)),
    [SCM_TABLE_FIELD]: lines.map((l: any, i: number) => ({
      seq: i + 1,
      item_code: l.item_code || '',
      item_name: l.item_name || l.name || '',
      spec: l.spec || l.item_spec || '',
      unit: l.unit || l.unit_name || '',
      warehouse: wh(l.warehouse_code),
      qty: f.qty(l.qty),
      price: Number(l.price) ? f.price(l.price) : '',
      amount: Number(l.amount) ? f.amount(l.amount) : '',
      tax_rate: Number(l.tax_rate) ? String(l.tax_rate) : '',
      tax_amount: Number(l.tax_amount) ? f.amount(l.tax_amount) : '',
      price_with_tax: Number(l.price_with_tax) ? f.price(l.price_with_tax) : '',
      gross: f.amount((Number(l.amount) || 0) + (Number(l.tax_amount) || 0)),
      batch_no: l.batch_no || '',
      remark: l.remark || '',
    })),
  }
}

/** 设计器「示例预览」用的样例数据 */
export function buildSampleScmPrintData() {
  const sample: Record<string, any> = {}
  for (const f of SCM_TEXT_FIELDS) sample[f.field] = f.testData
  sample[SCM_TABLE_FIELD] = [
    { seq: 1, item_code: 'S-CC000000019', item_name: '电解电容', spec: '470uf/16v 6.3*12', unit: '个', qty: '120,000', price: '0.1593', amount: '19,115.04', tax_rate: '13', tax_amount: '2,484.96', price_with_tax: '0.18', gross: '21,600.00', remark: '' },
    { seq: 2, item_code: 'S02LBO0001', item_name: '铝箔', spec: '0.1mm', unit: '公斤', qty: '12.5', price: '52.00', amount: '650.00', tax_rate: '13', tax_amount: '84.50', price_with_tax: '58.76', gross: '734.50', remark: '样品' },
  ]
  return sample
}
