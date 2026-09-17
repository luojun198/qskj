/**
 * hiprint 默认凭证模板。
 * 元素 left/top/width/height 与 paperHeader/paperFooter 使用 pt（见 mmToPt）。
 */
import type { HiprintTemplate } from '@/utils/printTemplateHiprint'
import { mmToPt } from '@/utils/printTemplateHiprint'
import type { VoucherPrintData } from '@/types/print'
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

export function voucherToHiprintData(v: VoucherPrintData): Record<string, unknown> {
  const entries = (v.pageEntries || v.entries || []).map(e => ({
    summary: e.summary || '',
    account_name: e.account_name || '',
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
    voucher_no_text: `${v.voucher_type || '记'}-${v.voucher_no || ''}`,
    date_text: v.date || '',
    attachments_text: v.attachments ? `附单据 ${v.attachments} 张` : '',
    entries,
    total_debit_text: fmtAmount(v.pageDebit ?? v.total_debit),
    total_credit_text: fmtAmount(v.pageCredit ?? v.total_credit),
    maker_text: `制单：${v.maker || v.created_by || ''}`,
    auditor_text: `审核：${v.auditor || ''}`,
    poster_text: `记账：${v.poster || ''}`,
    supervisor_text: `主管：${v.supervisor || ''}`,
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
 * 分录表元素。列目录包含全部可选列（未勾选列不打印），供属性面板勾选。
 * 必须给 height：hiprint 重建表格（例如勾选/取消列）后会用 options.height 重设元素高度，
 * 没有的话会写成 0pt，整张表在画布上就"消失"了。
 */
export function buildEntriesTable(
  leftMm: number,
  topMm: number,
  widthMm: number,
  heightMm = 70,
  auxCategories: Array<{ code?: string; name?: string }> = [],
  /** 每张凭证固定打印的分录行数（不含合计）；0 = 不固定，按表格高度自动 */
  fixedRows = DEFAULT_VOUCHER_FIXED_ROWS
) {
  const widthPt = mmToPt(widthMm)
  // 默认预置借/贷合计行；autoCompletion 补空行填满表格高度，让合计行始终贴在表格框底部
  const columns = applyVoucherTableSummary(
    fitVoucherTableColumnWidths(buildVoucherTableColumns(auxCategories), widthPt),
    { enabled: true, fields: ['debit', 'credit'], label: '合计' }
  )
  const baseOptions = {
    left: mmToPt(leftMm),
    top: mmToPt(topMm),
    width: widthPt,
    height: mmToPt(heightMm),
    field: VOUCHER_TABLE_FIELD,
    tableHeaderRepeat: 'first',
    tableFooterRepeat: 'last',
    autoCompletion: true,
    fontSize: 11,
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

function buildVoucherPanelAt(
  width: number,
  height: number,
  opts: { tableTopMm?: number; signTopMm?: number; auxCategories?: AuxCategoryLike[] }
) {
  const left = 12
  const innerW = width - 24
  const tableTop = opts.tableTopMm ?? 30
  const signTop = opts.signTopMm ?? height - 28
  // 合计已移进分录表内部，原先留给表外合计文本的那一行还给表格
  const tableBottom = signTop - 4

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
        printElements: [
          text('doc_title', left, 8, innerW, {
            fontSize: 20,
            fontWeight: 'bold',
            textAlign: 'center',
            letterSpacing: 4,
          }),
          text('account_set_name', left, 20, 70),
          text('date_text', width / 2 - 25, 20, 50, { textAlign: 'center' }),
          text('voucher_no_text', width - 82, 20, 36, { textAlign: 'right' }),
          text('attachments_text', width - 46, 20, 34, { textAlign: 'right', fontSize: 10 }),
          // 合计由分录表自带的合计行渲染，表外不再放 total_debit_text / total_credit_text
          // （两个字段仍在字段盘里，需要时可以拖回画布）
          buildEntriesTable(left, tableTop, innerW, Math.max(tableBottom - tableTop, 28), opts.auxCategories),
          text('maker_text', left, signTop, 45),
          text('auditor_text', 60, signTop, 45),
          text('poster_text', 110, signTop, 45),
          text('supervisor_text', 155, signTop, 45),
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
      paper_width: 210,
      paper_height: 148,
      template_key: 'voucher:standard',
    }
  }
  return {
    name: '标准记账凭证',
    paper_size: 'custom' as const,
    paper_width: 210,
    paper_height: 148,
    template_key: 'voucher:standard',
  }
}

export function buildVoucherPanel(
  preset: VoucherPanelPreset = 'standard',
  auxCategories: AuxCategoryLike[] = []
): HiprintTemplate {
  if (preset === 'a4') return buildVoucherPanelAt(210, 297, { tableTopMm: 36, signTopMm: 250, auxCategories })
  return buildVoucherPanelAt(210, 148, { tableTopMm: 30, signTopMm: 120, auxCategories })
}

export function buildDefaultVoucherPanel(): HiprintTemplate {
  return buildVoucherPanel('standard')
}
