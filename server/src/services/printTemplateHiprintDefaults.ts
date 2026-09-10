/**
 * 新建账套时写入的默认凭证打印模板（hiprint panel）。
 *
 * 与客户端 `printTemplateDefaultsHiprint.ts` 的 buildVoucherPanel('standard') 保持同一套排版：
 * 凭证纸 210×148，分录表固定 6 行（不含合计）、合计行内嵌在表格 tfoot、超出自动分页。
 * 服务端不能引用客户端代码，这里是一份精简移植；改一处时请同步另一处。
 */

const PT_PER_MM = 72 / 25.4
const mmToPt = (mm: number) => Math.round(mm * PT_PER_MM)

/** 标准凭证每张固定打印的分录行数（不含合计行） */
export const DEFAULT_VOUCHER_FIXED_ROWS = 6
/** hiprint 默认 td 高度（print-lock.css） */
const HIPRINT_DEFAULT_TD_HEIGHT_PT = 18
/** 见客户端 VOUCHER_ROWS_FILL_SLACK_PT：补空行循环会删掉最后 clone 的一行，行高必须留余量 */
const ROWS_FILL_SLACK_PT = 2
const MIN_BODY_ROW_HEIGHT_PT = 8

const FIELD_TEST_DATA: Record<string, string> = {
  doc_title: '记 账 凭 证',
  account_set_name: '示例账套',
  voucher_no_text: '记-001',
  date_text: '2026-09-07',
  attachments_text: '附单据 2 张',
  total_debit_text: '1,000.00',
  total_credit_text: '1,000.00',
  maker_text: '制单：张三',
  auditor_text: '审核：李四',
  poster_text: '记账：王五',
  supervisor_text: '主管：赵六',
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
      // 固定坐标：打印时不跟随分录表实际高度浮动
      fixed: true,
      ...extra,
    },
    printElementType: { type: 'text' },
  }
}

type Align = 'left' | 'right' | 'center'
interface ColDef {
  title: string
  field: string
  width: number
  align: Align
  checked: boolean
}

/** 默认勾选的 5 列 + 可在属性面板按需打开的可选列，与客户端 VOUCHER_TABLE_COLUMNS / OPTIONAL 一致 */
const TABLE_COLS: ColDef[] = [
  { title: '摘要', field: 'summary', width: 90, align: 'left', checked: true },
  { title: '科目编码', field: 'account_code', width: 56, align: 'left', checked: true },
  { title: '会计科目', field: 'account_name', width: 90, align: 'left', checked: true },
  { title: '借方金额', field: 'debit', width: 56, align: 'right', checked: true },
  { title: '贷方金额', field: 'credit', width: 56, align: 'right', checked: true },
  { title: '数量', field: 'quantity', width: 40, align: 'right', checked: false },
  { title: '单价', field: 'unit_price', width: 45, align: 'right', checked: false },
  { title: '单位', field: 'unit', width: 30, align: 'center', checked: false },
  { title: '币种', field: 'currency_code', width: 30, align: 'center', checked: false },
  { title: '汇率', field: 'exchange_rate', width: 40, align: 'right', checked: false },
  { title: '外币金额', field: 'foreign_amount', width: 56, align: 'right', checked: false },
  { title: '现金流量', field: 'cash_flow_name', width: 70, align: 'left', checked: false },
]

/** 合计列小数位（与客户端 VOUCHER_SUMMABLE_COLUMNS 一致） */
const SUMMARY_DIGITS: Record<string, number> = { debit: 2, credit: 2 }

/**
 * 列定义：已勾选列按权重铺满表宽；借/贷方金额设 hiprint 原生 tableSummary='sum'，
 * 第一个合计列之前的已勾选列合并成一格放「合计」二字（见客户端 applyVoucherTableSummary）。
 */
function buildColumns(widthPt: number): Array<Record<string, unknown>> {
  const checked = TABLE_COLS.filter(c => c.checked)
  const weightSum = checked.reduce((s, c) => s + c.width, 0) || 1
  const cols: Array<Record<string, unknown>> = TABLE_COLS.map(c => ({
    title: c.title,
    field: c.field,
    width: c.checked ? Math.round((widthPt * c.width) / weightSum) : c.width,
    align: c.align,
    columnId: c.field,
    colspan: 1,
    checked: c.checked,
  }))

  const checkedCols = cols.filter(c => c.checked !== false)
  const firstSumIndex = checkedCols.findIndex(c => SUMMARY_DIGITS[String(c.field)] !== undefined)
  for (const col of checkedCols) {
    const digits = SUMMARY_DIGITS[String(col.field)]
    if (digits === undefined) continue
    col.tableSummary = 'sum'
    col.tableSummaryAlign = 'right'
    col.tableSummaryNumFormat = digits
    col.tableSummaryText = ' '
  }
  if (firstSumIndex > 0) {
    checkedCols[0].tableSummary = 'text'
    checkedCols[0].tableSummaryText = '合计'
    checkedCols[0].tableSummaryColspan = firstSumIndex
    checkedCols[0].tableSummaryAlign = 'center'
    for (let i = 1; i < firstSumIndex; i++) checkedCols[i].tableSummaryColspan = 0
  }
  return cols
}

/** N 行均分表格框可用高度（见客户端 computeVoucherBodyRowHeightPt） */
export function computeBodyRowHeightPt(tableHeightPt: number, rows: number): number {
  if (rows <= 0) return 0
  const usable = tableHeightPt - HIPRINT_DEFAULT_TD_HEIGHT_PT * 2 - ROWS_FILL_SLACK_PT
  return Math.max(Math.floor((usable / rows) * 2) / 2, MIN_BODY_ROW_HEIGHT_PT)
}

function buildEntriesTable(leftMm: number, topMm: number, widthMm: number, heightMm: number, rows: number) {
  const widthPt = mmToPt(widthMm)
  const heightPt = mmToPt(heightMm)
  const columns = buildColumns(widthPt)
  return {
    options: {
      left: mmToPt(leftMm),
      top: mmToPt(topMm),
      width: widthPt,
      height: heightPt,
      field: 'entries',
      tableHeaderRepeat: 'first',
      // 合计只在最后一页出现；autoCompletion 补空行到固定行数
      tableFooterRepeat: 'last',
      autoCompletion: true,
      maxRows: rows,
      tableBodyRowHeight: computeBodyRowHeightPt(heightPt, rows),
      fontSize: 11,
      columns: [columns],
    },
    printElementType: {
      type: 'table',
      title: '分录表',
      columns: [columns.map(c => ({ ...c }))],
    },
  }
}

export function buildDefaultVoucherHiprintPanel(fixedRows = DEFAULT_VOUCHER_FIXED_ROWS) {
  const width = 210
  const height = 148
  const left = 12
  const innerW = width - 24
  const tableTop = 30
  const signTop = 120
  const tableBottom = signTop - 4

  return {
    panels: [
      {
        index: 0,
        paperType: 'other',
        width,
        height,
        paperHeader: mmToPt(8),
        // 页脚线压在表格底边：补空行补到页脚线为止，同时签章行成为逐页重复的页脚元素
        paperFooter: mmToPt(tableBottom),
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
          buildEntriesTable(left, tableTop, innerW, tableBottom - tableTop, fixedRows),
          text('maker_text', left, signTop, 45),
          text('auditor_text', 60, signTop, 45),
          text('poster_text', 110, signTop, 45),
          text('supervisor_text', 155, signTop, 45),
        ],
      },
    ],
  }
}
