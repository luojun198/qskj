/**
 * hiprint 默认凭证模板。
 * 元素 left/top/width/height 与 paperHeader/paperFooter 使用 pt（见 mmToPt）。
 */
import type { HiprintTemplate } from '@/utils/printTemplateHiprint'
import { mmToPt } from '@/utils/printTemplateHiprint'
import type { VoucherPrintData } from '@/types/print'
import { rmbUpper } from '@/utils/rmbUpper'
import {
  VOUCHER_TABLE_FIELD,
  VOUCHER_TEXT_FIELDS,
  applyVoucherTableRows,
  applyVoucherTableSummary,
  auxColumnField,
  buildVoucherTableColumns,
  fitVoucherTableColumnWidths,
} from '@/utils/hiprintVoucherProvider'

/**
 * 标准凭证每张固定 6 行分录（不含合计）；已保存的旧模板不受影响。
 * 服务端新建账套写入的默认模板与此一致（server/src/services/printTemplateHiprintDefaults.ts）。
 */
export const DEFAULT_VOUCHER_FIXED_ROWS = 6

/** 标准凭证纸（mm）：市面常见的 220×140 凭证打印纸；已保存的模板按各自纸张，不受影响 */
export const VOUCHER_PAPER_WIDTH_MM = 220
export const VOUCHER_PAPER_HEIGHT_MM = 140

const FIELD_TEST_DATA: Record<string, string> = Object.fromEntries(
  VOUCHER_TEXT_FIELDS.map(f => [f.field, f.testData])
)

export type VoucherPanelPreset = 'standard' | 'blank' | 'a4'

function fmtAmount(v: number | null | undefined): string {
  if (v === null || v === undefined || v === 0) return ''
  return Number(v).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtNumber(v: number | null | undefined, digits: number): string {
  if (v === null || v === undefined || v === 0) return ''
  return Number(v).toLocaleString('zh-CN', { minimumFractionDigits: 0, maximumFractionDigits: digits })
}

/** 辅助项目名称扁平成 aux_<类别code>；优先用服务端已扁平化的字段，老接口只有 aux_data 时兜底 */
function flattenEntryAux(e: VoucherPrintData['entries'][number]): Record<string, string> {
  const row: Record<string, string> = {}
  for (const [k, val] of Object.entries(e)) {
    if (k.startsWith('aux_') && k !== 'aux_data' && k !== 'aux_items') row[k] = (val as string) ?? ''
  }
  if (e.aux_data && typeof e.aux_data === 'object') {
    for (const [code, val] of Object.entries(e.aux_data)) {
      const key = auxColumnField(code)
      if (key !== 'aux_' && !(key in row)) row[key] = val?.name || ''
    }
  }
  return row
}

// 凭证字号：voucher_no 已自带类型字（如「结-004」）时原样显示，不再拼凭证类型全称；
// 仅纯序号时才补类型首字
function formatVoucherNoText(voucherNo?: string, voucherType?: string): string {
  const no = (voucherNo || '').trim()
  if (no.includes('-')) return no
  return `${(voucherType || '记').charAt(0)}-${no}`
}

/** 2026-08-06 → 2026年08月06日；不是 YYYY-MM-DD 时原样返回 */
function formatDateCn(date?: string): string {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec((date || '').trim())
  return m ? `${m[1]}年${m[2].padStart(2, '0')}月${m[3].padStart(2, '0')}日` : date || ''
}

/** 记-001 → [记] 字第 1 号（序号去掉前导 0） */
function formatVoucherWordText(voucherNo?: string, voucherType?: string): string {
  const no = (voucherNo || '').trim()
  const dash = no.lastIndexOf('-')
  const word = dash > 0 ? no.slice(0, dash) : (voucherType || '记').charAt(0)
  const seq = (dash > 0 ? no.slice(dash + 1) : no).replace(/^0+(?=\d)/, '')
  return `[${word}] 字第 ${seq} 号`
}

/** 会计科目全称：上级科目路径（服务端给出）+ 辅助项目名，用「/」连接 */
function accountFullText(e: VoucherPrintData['entries'][number]): string {
  const path = (e.account_full_name || e.account_name || '').trim()
  const auxNames = e.aux_data && typeof e.aux_data === 'object'
    ? Object.values(e.aux_data).map(a => a?.name || '').filter(Boolean)
    : []
  return [path, ...auxNames].filter(Boolean).join('/')
}

export interface VoucherPrintOptions {
  /** 左侧竖排品牌字样（品牌设置主标题） */
  brand?: string
}

/** 切页后续页首行「承前页」、非末页合计行「过次页」、末页「合计」 */
export const VOUCHER_CARRY_IN_LABEL = '承前页'
export const VOUCHER_CARRY_OUT_LABEL = '过次页'
export const VOUCHER_TOTAL_LABEL = '合计'

/**
 * 按每张凭证纸的分录行数把一张凭证切成多页打印数据。
 *
 * hiprint 表格自动分页时续页表格从页眉线起排、而标题/签章是钉死坐标的，会叠在一起；
 * 所以在数据层切好，每页都是一张完整凭证（标题、签章齐全），表格永远不触发 hiprint 分页。
 * - 第 1 页放 rows 条；后续页首行是「承前页」（借/贷 = 之前各页累计），再放 rows-1 条
 * - 合计行：非末页「过次页」、末页「合计」。合计金额由 formatter 对本页全部行求和，
 *   含承前页行，所以天然就是「截至本页累计」，末页即全凭证总额
 */
export function splitVoucherForPrint(v: VoucherPrintData, rows: number): VoucherPrintData[] {
  const entries = v.entries || []
  const perPage = Math.max(Math.floor(Number(rows) || 0), 2)
  if (entries.length <= perPage) {
    return [
      {
        ...v,
        pageIndex: 1,
        totalPages: 1,
        pageEntries: entries,
        pageDebit: v.total_debit,
        pageCredit: v.total_credit,
      },
    ]
  }
  const chunks: VoucherPrintData['entries'][] = [entries.slice(0, perPage)]
  for (let i = perPage; i < entries.length; i += perPage - 1) {
    chunks.push(entries.slice(i, i + perPage - 1))
  }
  let carryDebit = 0
  let carryCredit = 0
  return chunks.map((chunk, idx) => {
    const pageEntries =
      idx === 0
        ? chunk
        : [
            {
              summary: VOUCHER_CARRY_IN_LABEL,
              account_code: '',
              account_name: '',
              debit: carryDebit,
              credit: carryCredit,
            },
            ...chunk,
          ]
    carryDebit = pageEntries.reduce((s, e) => s + (Number(e.debit) || 0), 0)
    carryCredit = pageEntries.reduce((s, e) => s + (Number(e.credit) || 0), 0)
    return {
      ...v,
      pageIndex: idx + 1,
      totalPages: chunks.length,
      pageEntries,
      pageDebit: carryDebit,
      pageCredit: carryCredit,
    }
  })
}

export function voucherToHiprintData(
  v: VoucherPrintData,
  opts: VoucherPrintOptions = {}
): Record<string, unknown> {
  const isMultiPage = (v.totalPages || 1) > 1
  const isLastPage = !isMultiPage || (v.pageIndex || 1) >= (v.totalPages || 1)
  const sumLabel = isLastPage ? VOUCHER_TOTAL_LABEL : VOUCHER_CARRY_OUT_LABEL
  // 大写金额只出现在末页「合计」行（过次页是中间累计，不写大写）
  const sumUpper = isLastPage ? rmbUpper(v.total_debit) : ''
  const pageText = isMultiPage ? `${v.pageIndex || 1}/${v.totalPages}` : ''
  const attachmentsText = v.attachments ? `附单据 ${v.attachments} 张` : ''
  const voucherWordText = formatVoucherWordText(v.voucher_no, v.voucher_type)
  const entries = (v.pageEntries || v.entries || []).map(e => ({
    // 合计行标签（formatter 读取，见 VOUCHER_SUMMARY_LABEL_FORMATTER_SRC）
    __sum_label: sumLabel,
    __sum_upper: sumUpper,
    summary: e.summary || '',
    account_name: e.account_name || '',
    // 承前页行没有科目，不拼辅助项目
    account_full_text: e.account_code || e.account_name ? accountFullText(e) : '',
    account_code: e.account_code || '',
    debit: fmtAmount(e.debit),
    credit: fmtAmount(e.credit),
    quantity: fmtNumber(e.quantity, 4),
    unit_price: fmtNumber(e.unit_price, 4),
    unit: e.unit || '',
    currency_code: e.currency_code || '',
    exchange_rate: fmtNumber(e.exchange_rate, 6),
    foreign_amount: fmtAmount(e.foreign_amount),
    cash_flow_code: e.cash_flow_code || '',
    cash_flow_name: e.cash_flow_name || '',
    ...flattenEntryAux(e),
  }))
  return {
    doc_title: '记 账 凭 证',
    account_set_name: v.account_set_name || '',
    unit_text: `单位名称：${v.account_set_name || ''}`,
    voucher_no_text: formatVoucherNoText(v.voucher_no, v.voucher_type),
    voucher_word_text: voucherWordText,
    voucher_word_page_text: [voucherWordText, pageText].filter(Boolean).join('　'),
    date_text: v.date || '',
    date_cn_text: formatDateCn(v.date),
    brand_text: opts.brand || '',
    // 竖排：张数为 0 时留空位，便于手写
    attachments_side_text: `附单据${v.attachments ? v.attachments : '　'}张`,
    attachments_text: attachmentsText,
    // 页次单独成字段，渲染时贴着分录表右边框放（见 placeVoucherPageText）
    page_text: pageText,
    // 页次位置被「附单据」占了时，两者合在附单据那格里显示
    attachments_page_text: [attachmentsText, pageText].filter(Boolean).join('　'),
    entries,
    total_debit_text: fmtAmount(v.pageDebit ?? v.total_debit),
    total_credit_text: fmtAmount(v.pageCredit ?? v.total_credit),
    maker_text: `制单：${v.maker || v.created_by || ''}`,
    auditor_text: `审核：${v.auditor || ''}`,
    poster_text: `记账：${v.poster || ''}`,
    cashier_text: '出纳：',
    supervisor_text: `会计主管：${v.supervisor || ''}`,
  }
}

export function buildSampleVoucherPrintData(): Record<string, unknown> {
  return voucherToHiprintData({
    id: 'sample',
    voucher_no: '001',
    date: '2026-09-07',
    voucher_type: '记',
    attachments: 2,
    account_set_name: '示例账套',
    entries: [
      {
        summary: '提取现金',
        account_code: '1001',
        account_name: '库存现金',
        debit: 1000,
        credit: 0,
        aux_data: { dept: { id: 'd1', name: '财务部' } },
      },
      {
        summary: '提取现金',
        account_code: '1002',
        account_name: '银行存款',
        debit: 0,
        credit: 1000,
        aux_data: { dept: { id: 'd1', name: '财务部' } },
      },
    ],
    total_debit: 1000,
    total_credit: 1000,
    created_by: '张三',
    created_at: '2026-09-07',
    maker: '张三',
    auditor: '李四',
    poster: '王五',
    supervisor: '赵六',
  })
}

function text(
  field: string,
  leftMm: number,
  topMm: number,
  widthMm: number,
  extra: Record<string, unknown> = {}
) {
  return {
    options: {
      left: mmToPt(leftMm),
      top: mmToPt(topMm),
      height: mmToPt(7),
      width: mmToPt(widthMm),
      field,
      testData: FIELD_TEST_DATA[field] || field,
      title: FIELD_TEST_DATA[field] || field,
      fontSize: 11,
      hideTitle: true,
      // 固定坐标：打印时不跟随分录表实际高度浮动，保证设计器 = 预览 = 打印
      // （见 printTemplateHiprint.ts 的 pinDesignedPanelElements 注释）
      fixed: true,
      ...extra,
    },
    printElementType: { type: 'text' },
  }
}

/**
 * 标准凭证分录表的列：摘要 | 会计科目（全称） | 借方金额 | 贷方金额。
 * 「科目编码」「会计科目（末级名称）」保留在列目录里但不勾选，需要时可在属性面板打开。
 * 列头加全角空格拉开字距，和传统凭证纸一致。
 */
const STANDARD_COLUMN_LAYOUT: Record<string, { title: string; weight: number }> = {
  summary: { title: '摘　　要', weight: 100 },
  account_full_text: { title: '会 计 科 目', weight: 135 },
  debit: { title: '借方金额', weight: 60 },
  credit: { title: '贷方金额', weight: 60 },
}

export type VoucherTableColumnStyle = 'standard' | 'split'

/**
 * 分录表元素。列目录包含全部可选列（未勾选列不打印），供属性面板勾选。
 * 必须给 height：hiprint 重建表格（例如勾选/取消列）后会用 options.height 重设元素高度，
 * 没有的话会写成 0pt，整张表在画布上就"消失"了。
 * columnStyle：standard = 标准凭证四列（科目全称）；split = 科目编码、会计科目分两列（设计器拖入默认）
 */
export function buildEntriesTable(
  leftMm: number,
  topMm: number,
  widthMm: number,
  heightMm = 70,
  auxCategories: Array<{ code?: string; name?: string }> = [],
  /** 每张凭证固定打印的分录行数（不含合计）；0 = 不固定，按表格高度自动 */
  fixedRows = DEFAULT_VOUCHER_FIXED_ROWS,
  columnStyle: VoucherTableColumnStyle = 'split'
) {
  const widthPt = mmToPt(widthMm)
  const catalog = buildVoucherTableColumns(auxCategories).map(col => {
    if (columnStyle !== 'standard') return col
    const conf = STANDARD_COLUMN_LAYOUT[col.field]
    return conf ? { ...col, title: conf.title, width: conf.weight, checked: true } : { ...col, checked: false }
  })
  // 默认预置借/贷合计行；autoCompletion 补空行填满表格高度，让合计行始终贴在表格框底部
  const columns = applyVoucherTableSummary(fitVoucherTableColumnWidths(catalog, widthPt), {
    enabled: true,
    fields: ['debit', 'credit'],
    label: '合计',
  })
  const baseOptions = {
    left: mmToPt(leftMm),
    top: mmToPt(topMm),
    width: widthPt,
    height: mmToPt(heightMm),
    field: VOUCHER_TABLE_FIELD,
    tableHeaderRepeat: 'first',
    tableFooterRepeat: 'last',
    autoCompletion: true,
    fontSize: columnStyle === 'standard' ? 9.5 : 11,
    ...(columnStyle === 'standard' ? { tableHeaderFontSize: 10.5, tableHeaderFontWeight: 'normal' } : {}),
    columns: [columns],
  }
  return {
    // 列头 / 表体 / 合计行统一行高，均分表格框
    options: applyVoucherTableRows(baseOptions, { rows: fixedRows, summaryOn: true }),
    printElementType: {
      type: 'table',
      title: '分录表',
      columns: [columns],
    },
  }
}

type AuxCategoryLike = { code?: string; name?: string }

/** 横线（标题下划线） */
function hline(leftMm: number, topMm: number, widthMm: number) {
  return {
    options: { left: mmToPt(leftMm), top: mmToPt(topMm), width: mmToPt(widthMm), height: 9, fixed: true },
    printElementType: { type: 'hline' },
  }
}

/** 标准凭证模板版本标记：服务端据此判断已保存的默认模板是否已是新样式（见 printTemplateHiprintDefaults.ts） */
export const VOUCHER_STANDARD_LAYOUT_VERSION = 2

/**
 * 标准记账凭证排版（参照传统财务软件凭证纸）：
 *            记账凭证（下划线）
 * 单位名称：xxx
 *                2026年08月06日            [记] 字第 1 号
 * 品  ┌ 摘要 │ 会计科目（全称） │ 借方金额 │ 贷方金额 ┐ 附
 * 牌  │ ... 6 行 ...                               │ 单
 * 竖  │ 合计 │ 大写金额         │   合计   │   合计   │ 据
 *     └────────────────────────────────────────────┘ 张
 * 会计主管：   审核：   记账：   出纳：   制单：xxx
 */
function buildVoucherPanelAt(
  width: number,
  height: number,
  opts: { tableTopMm?: number; signTopMm?: number; auxCategories?: AuxCategoryLike[] }
) {
  // 左边留装订位 + 竖排品牌，右边留竖排「附单据」
  const left = Math.round(width * 0.114 * 2) / 2
  const right = width - Math.round(width * 0.105 * 2) / 2
  const innerW = right - left
  const center = width / 2
  const tableTop = opts.tableTopMm ?? 31
  const signTop = opts.signTopMm ?? height - 26.5
  const tableBottom = signTop - 2.5
  const tableH = Math.max(tableBottom - tableTop, 28)
  const titleW = 64
  // 签章五栏按内宽均分
  const signW = innerW / 5
  const sideTop = tableTop + 8
  const sideH = Math.min(tableH - 12, 48)

  return {
    panels: [
      {
        index: 0,
        paperType: width === 210 && height === 297 ? 'A4' : 'other',
        width,
        height,
        paperHeader: mmToPt(8),
        // 页脚线压到签章行之上：一来分录表的 autoCompletion 补空行是补到页脚线
        // （不是补到表格自身高度），页脚线放在纸张底部会让表格盖住签章行；二来这样
        // 签章行落在 paperFooter 之下，成为 hiprint 的页脚元素，多页时逐页按设计坐标重复。
        paperFooter: mmToPt(Math.max(tableBottom, 20)),
        cwLayoutVersion: VOUCHER_STANDARD_LAYOUT_VERSION,
        printElements: [
          text('doc_title', center - titleW / 2, 12, titleW, {
            height: mmToPt(9),
            fontSize: 18,
            fontWeight: 'bold',
            textAlign: 'center',
            letterSpacing: 1,
          }),
          hline(center - titleW / 2, 21.3, titleW),
          text('unit_text', left, 22.5, innerW / 2, { fontSize: 10, height: mmToPt(5) }),
          text('date_cn_text', center - 25, 25.5, 50, { fontSize: 10, textAlign: 'center', height: mmToPt(5) }),
          text('voucher_word_text', right - 50, 25.5, 50, { fontSize: 10, textAlign: 'right', height: mmToPt(5) }),
          buildEntriesTable(left, tableTop, innerW, tableH, opts.auxCategories, DEFAULT_VOUCHER_FIXED_ROWS, 'standard'),
          // 竖排：元素只有一个字宽，文字逐字折行
          text('brand_text', left - 5.5, sideTop, 4, {
            height: mmToPt(sideH),
            fontSize: 8,
            textAlign: 'center',
            color: '#666',
          }),
          text('attachments_side_text', right + 1.5, sideTop, 4.5, {
            height: mmToPt(sideH),
            fontSize: 10,
            textAlign: 'center',
          }),
          text('supervisor_text', left, signTop, signW, { fontSize: 10 }),
          text('auditor_text', left + signW, signTop, signW, { fontSize: 10 }),
          text('poster_text', left + signW * 2, signTop, signW, { fontSize: 10 }),
          text('cashier_text', left + signW * 3, signTop, signW, { fontSize: 10 }),
          text('maker_text', left + signW * 4, signTop, signW, { fontSize: 10 }),
        ],
      },
    ],
  } as HiprintTemplate
}

export function voucherPresetMeta(preset: VoucherPanelPreset) {
  if (preset === 'a4') {
    return {
      name: 'A4 竖版凭证',
      paper_size: 'A4' as const,
      paper_width: 210,
      paper_height: 297,
      template_key: 'voucher:standard',
    }
  }
  if (preset === 'blank') {
    return {
      name: '套打底图模板',
      paper_size: 'custom' as const,
      paper_width: VOUCHER_PAPER_WIDTH_MM,
      paper_height: VOUCHER_PAPER_HEIGHT_MM,
      template_key: 'voucher:standard',
    }
  }
  return {
    name: '标准记账凭证',
    paper_size: 'custom' as const,
    paper_width: VOUCHER_PAPER_WIDTH_MM,
    paper_height: VOUCHER_PAPER_HEIGHT_MM,
    template_key: 'voucher:standard',
  }
}

export function buildVoucherPanel(
  preset: VoucherPanelPreset = 'standard',
  auxCategories: AuxCategoryLike[] = []
): HiprintTemplate {
  if (preset === 'a4') return buildVoucherPanelAt(210, 297, { tableTopMm: 36, signTopMm: 250, auxCategories })
  return buildVoucherPanelAt(VOUCHER_PAPER_WIDTH_MM, VOUCHER_PAPER_HEIGHT_MM, { auxCategories })
}

export function buildDefaultVoucherPanel(): HiprintTemplate {
  return buildVoucherPanel('standard')
}
