/** 对账单页面、打印和导出共享的有序列设置。 */

import { ref, computed } from 'vue'
import { loadColumnSettings, saveColumnSettings, type ColumnSetting } from '@/utils/columnSettings'

const STORAGE_KEY = 'scm_arap_stmt_columns_visible'

export interface StmtColumn extends ColumnSetting {
  def?: boolean        // 默认是否显示（这里默认全显，仅作语义记录）
}

/** 对账单默认列及默认顺序。 */
export const STATEMENT_COLUMNS: StmtColumn[] = [
  { key: 'cat',         label: '类别',       visible: true, required: true,  def: true },
  { key: 'docNo',       label: '单号',       visible: true, required: true,  def: true },
  { key: 'docDate',     label: '日期',       visible: true, required: true,  def: true },
  { key: 'invoiceType', label: '发票种类',   visible: true, def: true },
  { key: 'taxRate',     label: '税率%',      visible: true, def: true },
  { key: 'orderNo',     label: '订单编号',   visible: true, def: true },
  { key: 'extOrderNo',  label: '对方订单号', visible: true, def: true },
  { key: 'itemCode',    label: '产品编号',   visible: true, def: true },
  { key: 'itemName',    label: '产品名称',   visible: true, def: true },
  { key: 'spec',        label: '规格',       visible: true, def: true },
  { key: 'unit',        label: '单位',       visible: true, def: true },
  { key: 'refNo',       label: '对方编号',   visible: true, def: true },
  { key: 'qty',         label: '数量',       visible: true, required: true,  def: true },
  { key: 'price',       label: '含税单价',   visible: true, def: true },
  { key: 'amount',      label: '金额',       visible: true, required: true,  def: true },
]

export function useStatementColumns() {
  // 默认全显（首次或无存储时）
  const columnSettings = ref<StmtColumn[]>(loadColumnSettings(STORAGE_KEY, STATEMENT_COLUMNS))
  const visibleKeys = computed(() => columnSettings.value.filter(column => column.visible).map(column => column.key))

  /** 某列是否可见（查询页表格、打印页表头/单元格均用此判断） */
  const col = (key: string): boolean => visibleKeys.value.includes(key)

  /** 写入并持久化（查询页用）。会自动补回必选列 */
  function setKeys(keys: string[]) {
    const visible = new Set(keys)
    setColumns(columnSettings.value.map(column => ({ ...column, visible: column.required || visible.has(column.key) })))
  }

  function setColumns(columns: ColumnSetting[]) {
    columnSettings.value = columns.map(column => ({ ...column }))
    saveColumnSettings(STORAGE_KEY, columnSettings.value)
  }

  /** 重置为默认（全显） */
  function reset() {
    columnSettings.value = STATEMENT_COLUMNS.map(column => ({ ...column }))
    try { localStorage.removeItem(STORAGE_KEY) } catch { /* localStorage 不可用时忽略 */ }
  }

  /** 当前可见列，保持用户保存的顺序。 */
  const visibleColumns = computed<StmtColumn[]>(() => columnSettings.value.filter(column => column.visible))

  return {
    allColumns: columnSettings,
    columnSettings,
    visibleKeys,
    visibleColumns,
    col,
    setKeys,
    setColumns,
    reset,
  }
}
