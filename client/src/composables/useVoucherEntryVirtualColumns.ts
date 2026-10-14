import { computed, h, type Ref, type ComputedRef } from 'vue'
import type { Column } from 'element-plus'
import { formatAmount } from '@/utils/format'
import { readAuxDisplayValue, type AuxColumnDef } from '@/utils/voucherFlatList'
import { accountDisplayRevision, accountNameByMode } from '@/utils/voucherAccountDisplay'
import { useVirtualTableColumnResize } from '@/composables/useVirtualTableColumnResize'

export const VOUCHER_VIRTUAL_ROW_HEIGHT = 32

/** el-table-v2 横向滚动条轨道高度：横向溢出时用 footer-height 让出，样式把滚动条移进去，避免盖住最后一行 */
export const VIRTUAL_TABLE_HBAR_GAP = 10

/** 列宽合计超过可视宽度时返回让出的轨道高度，否则 0 */
export function virtualTableHBarGap(columns: Column<any>[], width: number) {
  const total = columns.reduce((sum, c) => sum + (Number(c.width) || 0), 0)
  return total > width ? VIRTUAL_TABLE_HBAR_GAP : 0
}

function isHeaderRow(row: any) {
  return row?._voucherRowIndex === 0 || row?._isFirstEntryRow === true
}

function headerCell(row: any, value: unknown) {
  return isHeaderRow(row) ? String(value ?? '') : ''
}

type Align = 'left' | 'center' | 'right'

interface EntryColumnDef {
  key: string
  title: string
  fallback: number
  align?: Align
  render: (row: any, hl?: (text: string | number | null | undefined) => string) => unknown
}

function highlighted(text: unknown, hl?: (text: string | number | null | undefined) => string) {
  const str = String(text ?? '')
  if (hl) return h('span', { innerHTML: hl(str) })
  return str
}

// 第五份反馈：列与「凭证查询」统一——日期 / 凭证号「记-1」/ 类型 / 摘要 / 科目 / 借贷金额（不带 ¥）/ 制单审核记账
const ENTRY_COLUMN_DEFS: EntryColumnDef[] = [
  { key: 'voucher_date', title: '日期', fallback: 100, align: 'center', render: row => headerCell(row, row.voucher_date) },
  {
    key: 'voucher_code',
    title: '凭证号',
    fallback: 90,
    align: 'center',
    render: (row, hl) => (isHeaderRow(row) ? highlighted(row.voucher_code, hl) : ''),
  },
  { key: 'voucher_type_name', title: '类型', fallback: 90, render: row => headerCell(row, row.voucher_type_name) },
  { key: 'summary', title: '摘要', fallback: 160, render: (row, hl) => highlighted(row.summary, hl) },
  { key: 'account_code', title: '科目编码', fallback: 105, render: (row, hl) => highlighted(row.account_code, hl) },
  { key: 'account_name', title: '科目名称', fallback: 150, render: (row, hl) => highlighted(accountNameByMode(row), hl) },
  {
    key: 'debit_amount',
    title: '借方金额',
    fallback: 125,
    align: 'right',
    render: row => (row.direction === 'debit' ? formatAmount(row.amount || 0) : ''),
  },
  {
    key: 'credit_amount',
    title: '贷方金额',
    fallback: 125,
    align: 'right',
    render: row => (row.direction === 'credit' ? formatAmount(row.amount || 0) : ''),
  },
  { key: 'attachment_count', title: '附单数', fallback: 60, align: 'center', render: row => headerCell(row, row.attachment_count) },
  { key: 'maker_name', title: '制单', fallback: 80, render: row => headerCell(row, row.maker_name) },
  { key: 'auditor_name', title: '审核', fallback: 80, render: row => headerCell(row, row.auditor_name) },
  { key: 'poster_name', title: '记账', fallback: 80, render: row => headerCell(row, row.poster_name) },
]

/** 凭证级列（整张凭证只在首行显示）：录入列表按「合并单元格」样式只在凭证末行画横线 */
const VOUCHER_HEAD_KEYS = new Set(['voucher_date', 'voucher_code', 'voucher_type_name', 'attachment_count', 'maker_name', 'auditor_name', 'poster_name'])

/** 单元格统一包一层单行省略的 span，悬停 title 显示全文（摘要 / 科目名长时不再折成两行被截断） */
function cellText(content: unknown, plain: unknown) {
  const title = String(plain ?? '')
  return h('span', { class: 'vt-cell-text', title: title || undefined }, [content as any])
}

const AUX_COL_FALLBACK = 95

/**
 * 录入页虚拟表格列定义（el-table-v2），表头带列宽拖动手把
 */
export function useVoucherEntryVirtualColumns(options: {
  auxColumns: Ref<AuxColumnDef[]> | ComputedRef<AuxColumnDef[]>
  colWidth: (key: string, fallback: number) => number
  /** 拖动松手后落盘列宽；不传则表头不可拖 */
  saveColumnWidth?: (key: string, width: number) => void
  /** 拖动过程中实时更新（仅内存，不落盘）；不传则拖动中也走 saveColumnWidth */
  setColumnWidth?: (key: string, width: number) => void
  highlightText?: (text: string | number | null | undefined) => string
}) {
  const fallbackOf = (key: string) =>
    ENTRY_COLUMN_DEFS.find(d => d.key === key)?.fallback ?? AUX_COL_FALLBACK

  const { resizableHeader } = useVirtualTableColumnResize({
    getWidth: key => options.colWidth(key, fallbackOf(key)),
    onResize: (key, width) => (options.setColumnWidth ?? options.saveColumnWidth)?.(key, width),
    onResizeEnd: (key, width) => options.saveColumnWidth?.(key, width),
  })

  const columns = computed<Column<any>[]>(() => {
    // 显式依赖：开关切换 / 科目表加载完成后重建列，触发虚拟表格重绘
    void accountDisplayRevision()
    const w = options.colWidth
    const hl = options.highlightText
    const resizable = !!options.saveColumnWidth

    const cols: Column<any>[] = ENTRY_COLUMN_DEFS.map(def => ({
      key: def.key,
      dataKey: def.key,
      title: def.title,
      width: w(def.key, def.fallback),
      align: def.align,
      class: VOUCHER_HEAD_KEYS.has(def.key) ? 'vt-col-head' : undefined,
      headerCellRenderer: resizable ? resizableHeader(def.key, def.title, def.align) : undefined,
      cellRenderer: (({ rowData }: { rowData: any }) => {
        const out = def.render(rowData, hl)
        const plain = typeof out === 'string' ? out : def.key === 'account_name' ? accountNameByMode(rowData) : rowData?.[def.key]
        return cellText(out, plain)
      }) as any,
    }))

    for (const aux of options.auxColumns.value) {
      cols.push({
        key: aux.prop,
        dataKey: aux.prop,
        title: aux.name,
        width: w(aux.prop, AUX_COL_FALLBACK),
        headerCellRenderer: resizable ? resizableHeader(aux.prop, aux.name) : undefined,
        cellRenderer: (({ rowData }: { rowData: any }) => {
          const v = readAuxDisplayValue(rowData, aux.code)
          return cellText(v, v)
        }) as any,
      })
    }

    return cols
  })

  return { columns, isHeaderRow, VOUCHER_VIRTUAL_ROW_HEIGHT }
}
