import { computed, h, type Ref, type ComputedRef } from 'vue'
import type { Column } from 'element-plus'
import { formatAmount } from '@/utils/format'
import { readAuxDisplayValue, type AuxColumnDef } from '@/utils/voucherFlatList'
import { accountDisplayRevision, accountNameByMode } from '@/utils/voucherAccountDisplay'
import { useVirtualTableColumnResize } from '@/composables/useVirtualTableColumnResize'

export const VOUCHER_VIRTUAL_ROW_HEIGHT = 32

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

const ENTRY_COLUMN_DEFS: EntryColumnDef[] = [
  { key: 'year', title: '年', fallback: 54, align: 'center', render: row => headerCell(row, row.year) },
  { key: 'period', title: '月', fallback: 42, align: 'center', render: row => headerCell(row, row.period) },
  { key: 'voucher_type_abbr', title: '类型', fallback: 48, align: 'center', render: row => headerCell(row, row.voucher_type_abbr) },
  {
    key: 'voucher_seq',
    title: '编号',
    fallback: 64,
    align: 'center',
    render: (row, hl) => (isHeaderRow(row) ? highlighted(row.voucher_seq, hl) : ''),
  },
  { key: 'summary', title: '分录摘要', fallback: 160, render: (row, hl) => highlighted(row.summary, hl) },
  { key: 'account_code', title: '科目编码', fallback: 105, render: (row, hl) => highlighted(row.account_code, hl) },
  { key: 'account_name', title: '科目名称', fallback: 150, render: (row, hl) => highlighted(accountNameByMode(row), hl) },
  {
    key: 'debit_amount',
    title: '借方金额',
    fallback: 115,
    align: 'right',
    render: row => (row.direction === 'debit' ? formatAmount(row.amount || 0) : ''),
  },
  {
    key: 'credit_amount',
    title: '贷方金额',
    fallback: 115,
    align: 'right',
    render: row => (row.direction === 'credit' ? formatAmount(row.amount || 0) : ''),
  },
  { key: 'voucher_date', title: '凭证日期', fallback: 95, align: 'center', render: row => headerCell(row, row.voucher_date) },
  { key: 'attachment_count', title: '附单数', fallback: 60, align: 'center', render: row => headerCell(row, row.attachment_count) },
  { key: 'maker_name', title: '制单人', fallback: 75, align: 'center', render: row => headerCell(row, row.maker_name) },
  { key: 'auditor_name', title: '审核人', fallback: 75, align: 'center', render: row => headerCell(row, row.auditor_name) },
  { key: 'poster_name', title: '记账人', fallback: 75, align: 'center', render: row => headerCell(row, row.poster_name) },
]

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
      headerCellRenderer: resizable ? resizableHeader(def.key, def.title, def.align) : undefined,
      cellRenderer: (({ rowData }: { rowData: any }) => def.render(rowData, hl)) as any,
    }))

    for (const aux of options.auxColumns.value) {
      cols.push({
        key: aux.prop,
        dataKey: aux.prop,
        title: aux.name,
        width: w(aux.prop, AUX_COL_FALLBACK),
        headerCellRenderer: resizable ? resizableHeader(aux.prop, aux.name) : undefined,
        cellRenderer: (({ rowData }: { rowData: any }) => readAuxDisplayValue(rowData, aux.code)) as any,
      })
    }

    return cols
  })

  return { columns, isHeaderRow, VOUCHER_VIRTUAL_ROW_HEIGHT }
}
