/**
 * hiprint 凭证字段盘。
 * 字段 key 必须与 voucherToHiprintData() 输出一致，设计器拖入后即可绑定打印数据。
 */

export const VOUCHER_TEXT_FIELDS = [
  { field: 'doc_title', title: '凭证标题', testData: '记 账 凭 证', fontSize: 16.5, fontWeight: '700', textAlign: 'center' },
  { field: 'account_set_name', title: '账套名称', testData: '示例账套', fontSize: 11 },
  { field: 'voucher_no_text', title: '凭证字号', testData: '记-001', fontSize: 11 },
  { field: 'date_text', title: '凭证日期', testData: '2026-09-07', fontSize: 11 },
  { field: 'attachments_text', title: '附件张数', testData: '附单据 2 张', fontSize: 10 },
  { field: 'total_debit_text', title: '借方合计', testData: '1,000.00', fontSize: 11, textAlign: 'right' },
  { field: 'total_credit_text', title: '贷方合计', testData: '1,000.00', fontSize: 11, textAlign: 'right' },
  { field: 'maker_text', title: '制单', testData: '制单：张三', fontSize: 10 },
  { field: 'auditor_text', title: '审核', testData: '审核：李四', fontSize: 10 },
  { field: 'poster_text', title: '记账', testData: '记账：王五', fontSize: 10 },
  { field: 'supervisor_text', title: '主管', testData: '主管：赵六', fontSize: 10 },
] as const

export const VOUCHER_TABLE_FIELD = 'entries'

export const VOUCHER_TABLE_COLUMNS = [
  { title: '摘要', field: 'summary', width: 90, align: 'left' },
  { title: '科目编码', field: 'account_code', width: 56, align: 'left' },
  { title: '会计科目', field: 'account_name', width: 90, align: 'left' },
  { title: '借方金额', field: 'debit', width: 56, align: 'right' },
  { title: '贷方金额', field: 'credit', width: 56, align: 'right' },
] as const

/** 默认不勾选、可在属性面板里按需打开的分录列 */
export const VOUCHER_TABLE_OPTIONAL_COLUMNS = [
  { title: '数量', field: 'quantity', width: 40, align: 'right' },
  { title: '单价', field: 'unit_price', width: 45, align: 'right' },
  { title: '单位', field: 'unit', width: 30, align: 'center' },
  { title: '币种', field: 'currency_code', width: 30, align: 'center' },
  { title: '汇率', field: 'exchange_rate', width: 40, align: 'right' },
  { title: '外币金额', field: 'foreign_amount', width: 56, align: 'right' },
  { title: '现金流量', field: 'cash_flow_name', width: 70, align: 'left' },
] as const

/** 列头统一水平居中（hiprint 的 halign 只作用于 thead，表体仍按 align） */
export const VOUCHER_HEADER_ALIGN: 'left' | 'right' | 'center' = 'center'

export interface VoucherTableColumnDef {
  title: string
  field: string
  width: number
  align: 'left' | 'right' | 'center'
  halign: 'left' | 'right' | 'center'
  columnId: string
  colspan: number
  checked: boolean
}

export function auxColumnField(code: string) {
  return `aux_${String(code).replace(/[^a-zA-Z0-9_]/g, '')}`
}

/**
 * 分录表列目录：5 列基础字段（默认勾选）+ 数量/外币/现金流量等可选列
 * + 当前账套辅助核算类别（默认不勾选）。hiprint 属性面板会列出全部列供勾选。
 */
export function buildVoucherTableColumns(
  auxCategories: Array<{ code?: string; name?: string }> = []
): VoucherTableColumnDef[] {
  const toDef = (col: { title: string; field: string; width: number; align: string }, checked: boolean) => ({
    title: col.title,
    field: col.field,
    width: col.width,
    align: col.align as VoucherTableColumnDef['align'],
    halign: VOUCHER_HEADER_ALIGN,
    columnId: col.field,
    colspan: 1,
    checked,
  })
  const base = VOUCHER_TABLE_COLUMNS.map(col => toDef(col, true))
  const optional = VOUCHER_TABLE_OPTIONAL_COLUMNS.map(col => toDef(col, false))
  const seen = new Set([...base, ...optional].map(col => col.field))
  const aux = auxCategories
    .filter(cat => cat.code && !seen.has(auxColumnField(cat.code as string)))
    .map(cat => {
      const field = auxColumnField(cat.code as string)
      seen.add(field)
      return {
        title: cat.name || (cat.code as string),
        field,
        width: 56,
        align: 'left' as const,
        halign: VOUCHER_HEADER_ALIGN,
        columnId: field,
        colspan: 1,
        checked: false,
      }
    })
  return [...base, ...optional, ...aux]
}

/**
 * 把列目录合并进模板里已保存的表格列：保留用户已有列的顺序、宽度和勾选状态，
 * 目录里新增的列（例如后来添加的辅助类别）以未勾选状态追加到末尾。
 */
export function mergeVoucherTableColumns(
  existing: Array<Record<string, any>> | undefined,
  catalog: VoucherTableColumnDef[]
): Array<Record<string, any>> {
  const current = Array.isArray(existing) ? existing.map(c => ({ ...c })) : []
  const seen = new Set(current.map(c => c.field || c.columnId))
  for (const col of catalog) {
    if (seen.has(col.field)) continue
    seen.add(col.field)
    current.push({ ...col, rowspan: 1 })
  }
  return current
}

/** 按权重把已勾选列的宽度铺满给定的表格宽度（pt） */
export function fitVoucherTableColumnWidths<T extends { width?: number; checked?: boolean }>(
  columns: T[],
  totalWidthPt: number
): T[] {
  const checked = columns.filter(c => c.checked !== false)
  const weightSum = checked.reduce((s, c) => s + Number(c.width || 0), 0) || 1
  return columns.map(c =>
    c.checked === false ? c : { ...c, width: Math.round((totalWidthPt * Number(c.width || 0)) / weightSum) }
  )
}

export const VOUCHER_MODULE_NAME = 'voucherModule'

export function getVoucherHiprintFieldKeys(): string[] {
  return [...VOUCHER_TEXT_FIELDS.map(f => f.field), VOUCHER_TABLE_FIELD]
}

function textElement(field: (typeof VOUCHER_TEXT_FIELDS)[number]) {
  return {
    tid: `${VOUCHER_MODULE_NAME}.${field.field}`,
    title: field.title,
    data: field.testData,
    type: 'text',
    options: {
      field: field.field,
      testData: field.testData,
      height: 16,
      fontSize: field.fontSize,
      fontWeight: 'fontWeight' in field ? field.fontWeight : '400',
      textAlign: 'textAlign' in field ? field.textAlign : 'left',
      hideTitle: true,
    },
  }
}

/** 在 hiprint.init({ providers }) 里挂上，供设计器 PrintElementTypeManager.build(..., 'voucherModule') */
export function createVoucherPrintProvider(hiprint: {
  PrintElementTypeGroup?: new (title: string, list: unknown[]) => unknown
}) {
  return {
    addElementTypes(context: {
      addPrintElementTypes: (name: string, groups: unknown[]) => void
      removePrintElementTypes?: (name: string) => void
    }) {
      const Group = hiprint.PrintElementTypeGroup
      if (!Group) return

      const infoFields = VOUCHER_TEXT_FIELDS.filter(f =>
        ['doc_title', 'account_set_name', 'voucher_no_text', 'date_text', 'attachments_text'].includes(f.field)
      )
      const totalFields = VOUCHER_TEXT_FIELDS.filter(f =>
        ['total_debit_text', 'total_credit_text'].includes(f.field)
      )
      const signFields = VOUCHER_TEXT_FIELDS.filter(f =>
        ['maker_text', 'auditor_text', 'poster_text', 'supervisor_text'].includes(f.field)
      )

      try {
        context.removePrintElementTypes?.(VOUCHER_MODULE_NAME)
        context.addPrintElementTypes(VOUCHER_MODULE_NAME, [
          new Group('凭证信息', infoFields.map(textElement)),
          new Group('分录与合计', [
            {
              tid: `${VOUCHER_MODULE_NAME}.${VOUCHER_TABLE_FIELD}`,
              title: '分录表',
              field: VOUCHER_TABLE_FIELD,
              type: 'table',
              columns: [buildVoucherTableColumns()],
            },
            ...totalFields.map(textElement),
          ]),
          new Group('签章', signFields.map(textElement)),
        ])
      } catch {
        /* 字段盘失败时设计器仍用自建 Vue 列表 */
      }
    },
  }
}

/* ------------------------------------------------------------------ *
 * 分录表「合计行」（hiprint 原生 tfoot）
 * ------------------------------------------------------------------ */

/**
 * 可参与合计的列 → 合计值保留的小数位。
 * 只放「相加有会计意义」的列：单价、汇率刻意不在其中（把每行单价加起来毫无意义）。
 */
export const VOUCHER_SUMMABLE_COLUMNS: Record<string, number> = {
  debit: 2,
  credit: 2,
  quantity: 4,
  foreign_amount: 2,
}

/** applyVoucherTableSummary 写入/清除的全部 hiprint 列属性 */
const SUMMARY_KEYS = [
  'tableSummary',
  'tableSummaryText',
  'tableSummaryColspan',
  'tableSummaryAlign',
  'tableSummaryNumFormat',
  'tableSummaryTitle',
] as const

export interface VoucherTableSummaryConfig {
  /** 是否显示合计行 */
  enabled: boolean
  /** 参与合计的列 field */
  fields: string[]
  /** 合计行左侧标签文字 */
  label: string
}

type LooseColumn = Record<string, any>

/** 当前「已勾选显示 且 可累加」的列，供设计器面板列出候选 */
export function summableColumnsOf(columns: LooseColumn[] | undefined): LooseColumn[] {
  return (columns || []).filter(
    col => col && col.checked !== false && VOUCHER_SUMMABLE_COLUMNS[col.field] !== undefined
  )
}

/**
 * 打开合计行开关时的默认选择。
 *
 * 合计行的开关状态不单独存字段，而是由「有没有列设了 tableSummary」反推（见
 * readVoucherTableSummary）。所以开关打开时必须至少选中一列，否则写回去什么都没写、
 * 回读又会把开关重置成关闭。优先借/贷方金额，都不可用时退回第一个候选列。
 */
export function defaultSummaryFields(candidateFields: string[]): string[] {
  const preset = ['debit', 'credit'].filter(field => candidateFields.includes(field))
  return preset.length ? preset : candidateFields.slice(0, 1)
}

/**
 * 把合计行配置写进列定义（hiprint 原生属性，随模板 JSON 一起保存）。
 *
 * hiprint 的 createTableFooter 会遍历所有 checked 列，按每列的 tableSummary 生成一个 <td>：
 * - 'sum'  → 求和单元格
 * - 'text' → 纯文字单元格（放「合计」二字）
 * - 未设置 → 空单元格占位
 * 并且 default 分支是 `1 <= tableSummaryColspan` 才 append <td>，所以把被标签跨掉的列
 * 设成 colspan: 0 即可实现「合计二字占满前置列」的单元格合并。
 *
 * 不修改入参，返回新数组。
 */
export function applyVoucherTableSummary(
  columns: LooseColumn[] | undefined,
  config: VoucherTableSummaryConfig
): LooseColumn[] {
  const next = (columns || []).map(col => {
    const copy = { ...col }
    for (const key of SUMMARY_KEYS) delete copy[key]
    return copy
  })
  if (!config.enabled) return next

  const chosen = new Set(
    (config.fields || []).filter(field => VOUCHER_SUMMABLE_COLUMNS[field] !== undefined)
  )
  if (!chosen.size) return next

  const checked = next.filter(col => col.checked !== false)
  const firstSumIndex = checked.findIndex(col => chosen.has(col.field))
  if (firstSumIndex < 0) return next

  for (const col of checked) {
    if (!chosen.has(col.field)) continue
    col.tableSummary = 'sum'
    col.tableSummaryAlign = 'right'
    col.tableSummaryNumFormat = VOUCHER_SUMMABLE_COLUMNS[col.field]
    // hiprint 内置分支会在数字前拼一段「合计:」前缀，实际渲染由注入的
    // tableSummaryFormatter 接管、不会走到那里；给个空格是为了设计器画布里也不显示前缀。
    col.tableSummaryText = ' '
  }

  // 第一个合计列之前的所有已勾选列，合并成一格放「合计」
  if (firstSumIndex > 0) {
    checked[0].tableSummary = 'text'
    checked[0].tableSummaryText = config.label || '合计'
    checked[0].tableSummaryColspan = firstSumIndex
    checked[0].tableSummaryAlign = 'center'
    for (let i = 1; i < firstSumIndex; i++) checked[i].tableSummaryColspan = 0
  }

  return next
}

/**
 * 给没设表头对齐的列补上居中。老模板的列定义里没有 halign，thead 会跟着表体的 align
 * 走（摘要靠左、金额靠右）；渲染前与设计器加载时都过一遍，用户在属性面板里自己改过的保留。
 * 不修改入参。
 */
export function applyVoucherHeaderAlign(columns: LooseColumn[] | undefined): LooseColumn[] {
  return (columns || []).map(col =>
    col && typeof col === 'object' && !col.halign ? { ...col, halign: VOUCHER_HEADER_ALIGN } : col
  )
}

/** 从列定义里反解合计行配置，供设计器面板回显 */
export function readVoucherTableSummary(
  columns: LooseColumn[] | undefined
): VoucherTableSummaryConfig {
  const cols = columns || []
  const fields = cols
    .filter(col => col && col.tableSummary === 'sum' && col.field)
    .map(col => String(col.field))
  const labelCol = cols.find(col => col && col.tableSummary === 'text')
  return {
    enabled: fields.length > 0,
    fields,
    label: (labelCol && String(labelCol.tableSummaryText)) || '合计',
  }
}

/* ------------------------------------------------------------------ *
 * 分录表「固定打印行数」
 *
 * hiprint 的 maxRows 是每页数据行、以及 autoCompletion 补空行的上限，只封顶不保底；
 * 一页实际放几行由「页脚线 - 表格顶」这段高度决定。要做到「每张凭证恰好 N 行」，
 * 得三件事同时成立：maxRows = N（封顶）、autoCompletion = true（补空行保底）、
 * 行高 = (表格高 - 余量) / (N + 表头 1 行 + 合计 1 行)：列头、表体、合计行统一行高，
 * 让它们正好填满表格框，套打时行距也就对齐了预印格线。
 *   - 表体：hiprint 原生 tableBodyRowHeight
 *   - 列头：hiprint 原生 tableHeaderRowHeight
 *   - 合计行：hiprint 没有表尾行高选项，由 VOUCHER_SUMMARY_FORMATTER_SRC 读 tableBodyRowHeight
 *     写进合计单元格的 style（同一行只要一格有高度整行就跟着高）
 * ------------------------------------------------------------------ */

/** hiprint 默认 td 高度（print-lock.css：`.hiprint-printElement-tableTarget td { height: 18pt }`） */
export const HIPRINT_DEFAULT_TD_HEIGHT_PT = 18
/** 行高下限，再小字就压没了 */
export const VOUCHER_MIN_BODY_ROW_HEIGHT_PT = 8
export const VOUCHER_MAX_FIXED_ROWS = 60
/**
 * 均分时预留的余量（pt）。hiprint 的 autoCompletion 循环是「clone 一行 → 若高度已到/行数已超就停 → 删掉最后 clone 的那行」，
 * 也就是说要拿到恰好 N 行，必须让它有机会去 clone 第 N+1 行、再被 maxRows 挡下删掉。
 * 若 表头 + N 行 + 表尾 正好把可用高度用满，第 N 行就会被当成「撑破的那行」删掉，只剩 N-1 行。
 * 另外表格边框还有不到 1pt 的额外高度，一起留在这里。
 */
export const VOUCHER_ROWS_FILL_SLACK_PT = 2

export interface VoucherTableRowsMeasure {
  /** 表格元素 options.height（pt） */
  tableHeightPt: number
  /** 固定行数（不含列头与合计行） */
  rows: number
  /** 是否有合计行（多占一行高度）；不传按有 */
  summaryOn?: boolean
}

/** 列头 + N 行 + 合计行均分表格框可用高度得到的统一行高（pt，向下取整到 0.5pt） */
export function computeVoucherBodyRowHeightPt(measure: VoucherTableRowsMeasure): number {
  const rows = Math.floor(Number(measure.rows) || 0)
  if (rows <= 0) return 0
  const lines = rows + 1 + (measure.summaryOn === false ? 0 : 1)
  const usable = Number(measure.tableHeightPt || 0) - VOUCHER_ROWS_FILL_SLACK_PT
  // 向下取整到 0.5pt：宁可略短一点留白，也不能撑破表格框导致最后一行补不进去
  const raw = Math.floor((usable / lines) * 2) / 2
  return Math.max(raw, VOUCHER_MIN_BODY_ROW_HEIGHT_PT)
}

export interface VoucherTableRowsConfig {
  /** 固定行数；0 / 空 = 不固定，恢复 hiprint 按高度自动 */
  rows: number
  /** 是否有合计行；不传时从 options.columns 反推 */
  summaryOn?: boolean
}

/**
 * 把固定行数写进表格元素 options（hiprint 原生字段，随模板 JSON 保存）。
 * 不修改入参，返回新对象。rows 为 0 时清掉 maxRows / tableBodyRowHeight / tableHeaderRowHeight，
 * autoCompletion 保持原值不动（合计行贴底仍依赖它）。
 */
export function applyVoucherTableRows(
  options: Record<string, any> | undefined,
  config: VoucherTableRowsConfig
): Record<string, any> {
  const next = { ...(options || {}) }
  const rows = Math.min(Math.floor(Number(config.rows) || 0), VOUCHER_MAX_FIXED_ROWS)
  if (rows <= 0) {
    delete next.maxRows
    delete next.tableBodyRowHeight
    delete next.tableHeaderRowHeight
    return next
  }
  const summaryOn =
    config.summaryOn ??
    readVoucherTableSummary(Array.isArray(next.columns?.[0]) ? next.columns[0] : []).enabled
  next.maxRows = rows
  next.autoCompletion = true
  const rowHeight = computeVoucherBodyRowHeightPt({
    tableHeightPt: Number(next.height || 0),
    rows,
    summaryOn,
  })
  next.tableBodyRowHeight = rowHeight
  // 列头与表体同高（合计行的高度在 VOUCHER_SUMMARY_FORMATTER_SRC 里跟 tableBodyRowHeight）
  next.tableHeaderRowHeight = rowHeight
  return next
}

/** 从表格元素 options 反解固定行数，供设计器面板回显（也兼容用户直接在属性面板改 maxRows） */
export function readVoucherTableRows(options: Record<string, any> | undefined): {
  rows: number
  rowHeight: number
} {
  const rows = Math.floor(Number(options?.maxRows) || 0)
  return {
    rows: rows > 0 ? rows : 0,
    rowHeight: Number(options?.tableBodyRowHeight) || 0,
  }
}

/**
 * 注入给 hiprint 的列级汇总渲染函数（源码字符串）。
 *
 * 必须自包含：hiprint 的 getColumnTableSummaryFormatter 会走
 * `eval("tableSummaryFormatter=" + column.tableSummaryFormatter)`，闭包会丢失。
 *
 * 存在的理由：hiprint 内置求和是
 *   `/^-?(0|[1-9]\d*)(\.\d+)?/.test(v) ? Number(v) : 0`
 * 而 voucherToHiprintData() 输出的是带千分位的字符串（'1,000.00'）。正则没锚定结尾所以
 * test 通过，Number('1,000.00') 却是 NaN，整列合计变 NaN。这里去掉千分位再求和。
 *
 * 签名 (column, nums, allData, options)，返回值必须是完整的 <td>…</td>。
 * 第 4 参是表格元素 options：合计行没有 hiprint 原生行高选项，这里把 tableBodyRowHeight
 * 写进合计单元格，让合计行与列头、表体同高（见 applyVoucherTableRows）。
 */
export const VOUCHER_SUMMARY_FORMATTER_SRC = `function (column, nums, allData, options) {
  var digits = Number(column.tableSummaryNumFormat)
  if (!(digits >= 0)) digits = 2
  var rows = Object.prototype.toString.call(allData) === '[object Array]' ? allData : []
  var total = 0
  for (var i = 0; i < rows.length; i++) {
    var row = rows[i]
    if (!row) continue
    var raw = row[column.field]
    if (raw === null || raw === undefined || raw === '') continue
    var num = parseFloat(String(raw).replace(/[,\s]/g, ''))
    if (!isNaN(num)) total += num
  }
  var scale = Math.pow(10, digits)
  total = Math.round(total * scale) / scale
  var text = total.toLocaleString('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: digits })
  var align = column.tableSummaryAlign || 'right'
  var colspan = column.tableSummaryColspan === null || column.tableSummaryColspan === undefined
    ? 1 : column.tableSummaryColspan
  var rowHeight = options && Number(options.tableBodyRowHeight)
  var style = 'text-align: ' + align + (rowHeight > 0 ? '; height: ' + rowHeight + 'pt' : '')
  return '<td style="' + style + '" colspan="' + colspan + '">' + text + '</td>'
}`
