<template>
  <div ref="containerRef" class="table-fill-wrap voucher-audit-table">
    <div v-loading="loading" class="voucher-audit-table__body">
      <el-auto-resizer>
        <template #default="{ height, width }">
          <el-table-v2
            ref="tableRef"
            class="voucher-audit-table-v2"
            :columns="virtualColumns"
            :data="flatList"
            :width="width"
            :height="Math.max(height, 160)"
            :row-height="VOUCHER_VIRTUAL_ROW_HEIGHT"
            :header-height="34"
            :row-class="rowClass"
            :row-event-handlers="rowEventHandlers"
            fixed
          />
        </template>
      </el-auto-resizer>
      <div v-if="!flatList.length && !loading" class="voucher-audit-table__empty">暂无数据</div>
    </div>
    <div v-if="flatList.length > 0 && (loadingMore || !hasMore)" class="infinite-scroll-status">
      <span v-if="loadingMore" class="infinite-scroll-status__loading">
        <el-icon class="is-loading"><Loading /></el-icon>
        加载中…
      </span>
      <span v-else>已全部加载</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, h, nextTick, ref, shallowRef, watch } from 'vue'
import { ElButton, ElCheckbox, ElTag, type Column } from 'element-plus'
import { Loading } from '@element-plus/icons-vue'
import { useFillHeightTable } from '@/composables/useFillHeightTable'
import { useVirtualTableColumnResize } from '@/composables/useVirtualTableColumnResize'
import { useVirtualTableHeaderScrollSync } from '@/composables/useVirtualTableHeaderScrollSync'
import { formatMoney, statusType, statusText } from '@/composables/useVoucherAuditData'
import { VOUCHER_VIRTUAL_ROW_HEIGHT } from '@/composables/useVoucherEntryVirtualColumns'
import { discoverAuxColumnsFromRows, type AuxColumnDef } from '@/utils/voucherFlatList'
import { accountDisplayRevision, accountNameByMode } from '@/utils/voucherAccountDisplay'

interface Props {
  flatList: any[]
  isSelectableRow: (row: any) => boolean
  getRowClass: (params: { row: any }) => string
  auxCategories?: any[]
  selectedRows?: any[]
  canUnpost?: boolean
  getColVisible?: (prop: string) => boolean
  columnWidths?: Record<string, number>
  /** audit：审核/记账操作列 + 勾选；query：打印/删除；preview：只读预览（无勾选、无操作列，供生成凭证二次确认） */
  mode?: 'audit' | 'query' | 'preview'
  loading?: boolean
  highlightText?: (text: string | number | null | undefined) => string
  getCellClassNameFn?: (params: { row: any }) => string
  orderedColumnKeys?: string[]
  /** 滚动追加加载中 */
  loadingMore?: boolean
  /** 是否还有未加载的数据 */
  hasMore?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  auxCategories: () => [],
  selectedRows: () => [],
  canUnpost: true,
  getColVisible: () => () => true,
  columnWidths: () => ({}),
  mode: 'audit',
  loading: false,
  orderedColumnKeys: () => [],
  loadingMore: false,
  hasMore: false,
})

const { containerRef } = useFillHeightTable()
// 表头被拖选自动滚动时与表体错位 → 强制回同步
useVirtualTableHeaderScrollSync(containerRef)

const emit = defineEmits<{
  'selection-change': [rows: any[]]
  'view-detail': [row: any]
  audit: [row: any]
  unaudit: [row: any]
  post: [row: any]
  unpost: [row: any]
  print: [row: any]
  delete: [row: any]
  'row-click': [row: any]
  'row-dblclick': [row: any]
  'header-dragend': [newWidth: number, oldWidth: number, column: any, event: Event]
}>()

const tableRef = ref()

function colVisible(prop: string) {
  return props.getColVisible(prop)
}

const BASE_COLUMN_KEYS = ['voucher_date', 'voucher_no', 'voucher_type_name', 'summary', 'account_code', 'account_name', 'debit_amt', 'credit_amt']
const renderColumnKeys = computed(() => props.orderedColumnKeys.length
  ? props.orderedColumnKeys.filter(colVisible)
  : [...BASE_COLUMN_KEYS.filter(colVisible), ...visibleAuxColumns.value.map(column => column.prop), ...['operator_info', 'status'].filter(colVisible)])

function auxColumnByProp(prop: string) {
  if (prop === 'dept_name') return { code: 'dept', name: '部门', prop }
  if (prop === 'project_name') return { code: 'project', name: '项目', prop }
  const fromDiscovered = discoveredAuxColumns.value.find(column => column.prop === prop)
  if (fromDiscovered) return fromDiscovered
  if (prop.startsWith('_aux_')) {
    const code = prop.slice(5)
    const cat = props.auxCategories.find(c => c.code === code)
    if (cat) return { code, name: cat.name || code, prop }
  }
  return undefined
}

const DEFAULT_COL_WIDTHS: Record<string, number> = {
  voucher_date: 100,
  voucher_no: 100,
  voucher_type_name: 100,
  summary: 150,
  account_code: 100,
  account_name: 160,
  debit_amt: 130,
  credit_amt: 130,
  operator_info: 240,
  status: 120,
}

/** 拖动过程中的临时列宽（松手后 emit 给父页落盘，随后清空） */
const draftWidths = ref<Record<string, number>>({})

function colWidth(prop: string, fallback: number) {
  const dragging = draftWidths.value[prop]
  if (dragging && dragging > 0) return dragging
  const saved = props.columnWidths[prop]
  return saved && saved > 0 ? saved : fallback
}

function defaultWidthOf(key: string) {
  if (key === '操作') return props.mode === 'query' ? 120 : 172
  return DEFAULT_COL_WIDTHS[key] ?? 100
}

const { resizableHeader } = useVirtualTableColumnResize({
  getWidth: key => colWidth(key, defaultWidthOf(key)),
  onResize: (key, width) => {
    draftWidths.value = { ...draftWidths.value, [key]: width }
  },
  onResizeEnd: (key, width, oldWidth) => {
    // 与 el-table header-dragend 的 column 结构兼容（resolveTableColumnKey 读 columnKey / property）
    emit('header-dragend', width, oldWidth, { columnKey: key, property: key, label: key }, new Event('pointerup'))
    nextTick(() => {
      const next = { ...draftWidths.value }
      delete next[key]
      draftWidths.value = next
    })
  },
})

// ========== 选择（受控：勾选状态完全来自 selectedRows） ==========

const selectedVoucherIds = computed(() => {
  return new Set((props.selectedRows || []).map((r: any) => String(r._voucherId || r.id)))
})

function getRowVoucherId(row: any) {
  return row._voucherId || row.id
}

function isVoucherSelected(row: any) {
  return selectedVoucherIds.value.has(String(getRowVoucherId(row)))
}

const selectableRows = computed(() => props.flatList.filter(row => props.isSelectableRow(row)))

const allSelected = computed(
  () => selectableRows.value.length > 0 && selectableRows.value.every(isVoucherSelected)
)
const someSelected = computed(() => !allSelected.value && selectableRows.value.some(isVoucherSelected))

function currentSelectionRows() {
  return selectableRows.value.filter(isVoucherSelected)
}

function toggleVoucherSelection(row: any) {
  const firstRow = props.flatList.find(
    (r: any) => r._voucherId === row._voucherId && r._voucherRowIndex === 0
  )
  if (!firstRow || !props.isSelectableRow(firstRow)) return
  const id = String(getRowVoucherId(firstRow))
  const next = currentSelectionRows().filter(r => String(getRowVoucherId(r)) !== id)
  if (!isVoucherSelected(firstRow)) next.push(firstRow)
  emit('selection-change', next)
}

function toggleAllSelection() {
  emit('selection-change', allSelected.value ? [] : [...selectableRows.value])
}

// ========== 行事件 ==========

function rowClass({ rowData }: { rowData: any }) {
  return props.getRowClass({ row: rowData })
}

const rowEventHandlers = {
  onClick: ({ rowData, event }: { rowData: any; event: Event }) => {
    const target = event?.target as HTMLElement | null
    if (target?.closest('.audit-actions, .audit-selection')) return
    if (props.mode === 'query' || props.mode === 'preview') {
      emit('row-click', rowData)
      return
    }
    toggleVoucherSelection(rowData)
  },
  onDblclick: ({ rowData }: { rowData: any }) => emit('view-detail', rowData),
}

// ========== 动态辅助列：增量发现 ==========

const discoveredAuxColumns = shallowRef<AuxColumnDef[]>([])
const auxSeenKeys = new Set<string>()
let auxScannedLen = 0

function resetDiscoveredAux() {
  discoveredAuxColumns.value = []
  auxSeenKeys.clear()
  auxScannedLen = 0
}

watch(
  () => props.flatList,
  rows => {
    if (!rows.length) {
      resetDiscoveredAux()
      return
    }
    if (rows.length < auxScannedLen) {
      resetDiscoveredAux()
      discoveredAuxColumns.value = discoverAuxColumnsFromRows(rows, {
        mode: 'query',
        auxCategories: props.auxCategories,
        alreadySeen: auxSeenKeys,
      })
      auxScannedLen = rows.length
      return
    }
    if (rows.length > auxScannedLen) {
      const newly = discoverAuxColumnsFromRows(rows.slice(auxScannedLen), {
        mode: 'query',
        auxCategories: props.auxCategories,
        alreadySeen: auxSeenKeys,
      })
      if (newly.length) {
        discoveredAuxColumns.value = discoveredAuxColumns.value.concat(newly)
      }
      auxScannedLen = rows.length
    }
  },
  { immediate: true }
)

const visibleAuxColumns = computed(() =>
  discoveredAuxColumns.value.filter(col => colVisible(col.prop))
)

function isHeaderRow(row: any) {
  return row._voucherRowIndex === 0 || row._isFirstEntryRow === true
}

// ========== 列定义 ==========

type CellRenderer = NonNullable<Column<any>['cellRenderer']>
/** el-table-v2 的 CellRenderer 是 FunctionalComponent 类型，普通箭头函数需在此适配 */
function cell(render: (row: any) => unknown): CellRenderer {
  return (({ rowData }: { rowData: any }) => render(rowData)) as unknown as CellRenderer
}

function textCell(value: unknown) {
  const text = String(value ?? '')
  if (props.highlightText) return h('span', { innerHTML: props.highlightText(text) })
  return text
}

function headerOnly(row: any, value: unknown) {
  return isHeaderRow(row) ? String(value ?? '') : ''
}

function actionButton(label: string, type: string, onClick: () => void) {
  return h(
    ElButton,
    { link: true, type: type as any, size: 'small', onClick },
    { default: () => label }
  )
}

function renderActions(row: any) {
  if (!isHeaderRow(row)) return ''
  const buttons = []
  if (props.mode === 'query') {
    buttons.push(actionButton('打印', 'primary', () => emit('print', row)))
    if (row.status !== 'posted') {
      buttons.push(actionButton('删除', 'danger', () => emit('delete', row)))
    }
  } else {
    buttons.push(actionButton('查看', 'primary', () => emit('view-detail', row)))
    if (row.status === 'draft') buttons.push(actionButton('审核', 'success', () => emit('audit', row)))
    if (row.status === 'audited') buttons.push(actionButton('反审核', 'warning', () => emit('unaudit', row)))
    if (row.status !== 'posted') buttons.push(actionButton('记账', 'primary', () => emit('post', row)))
    if (row.status === 'posted' && props.canUnpost) {
      buttons.push(actionButton('反记账', 'warning', () => emit('unpost', row)))
    }
  }
  return h('div', { class: 'audit-actions' }, buttons)
}

function renderStatus(row: any) {
  if (!isHeaderRow(row)) return ''
  const tags = [
    h(ElTag, { type: statusType[row.status], size: 'small' }, { default: () => statusText[row.status] || row.status }),
  ]
  // 冲红标记只在凭证首行展示，避免多分录重复
  if (row.reversal_of_voucher_id) {
    tags.push(h(ElTag, { type: 'danger', size: 'small', class: 'voucher-reversal-tag' }, { default: () => '红字' }))
  } else if (row.reversed_by_voucher_id) {
    tags.push(h(ElTag, { type: 'info', size: 'small', class: 'voucher-reversal-tag' }, { default: () => '已冲红' }))
  }
  return h('span', { class: 'voucher-status-cell' }, tags)
}

function renderOperatorInfo(row: any) {
  if (!isHeaderRow(row)) return ''
  return h('span', { class: 'operator-info' }, [
    h('span', `制单 ${row.maker_name || '-'}`),
    h('span', `审核 ${row.auditor_name || '-'}`),
    h('span', `记账 ${row.poster_name || '-'}`),
  ])
}

type Align = 'left' | 'center' | 'right'

const BASE_COLUMN_DEFS: Record<string, { title: string; align?: Align; render: (row: any) => unknown }> = {
  voucher_date: { title: '日期', render: row => headerOnly(row, row.voucher_date) },
  voucher_no: { title: '凭证号', align: 'center', render: row => headerOnly(row, row.voucher_no) },
  voucher_type_name: { title: '类型', render: row => headerOnly(row, row.voucher_type_name) },
  summary: { title: '摘要', render: row => textCell(row.summary) },
  account_code: { title: '科目编码', render: row => textCell(row.account_code) },
  account_name: { title: '科目名称', render: row => textCell(accountNameByMode(row)) },
  debit_amt: { title: '借方金额', align: 'right', render: row => (row.direction === 'debit' ? formatMoney(row.amount) : '') },
  credit_amt: { title: '贷方金额', align: 'right', render: row => (row.direction === 'credit' ? formatMoney(row.amount) : '') },
  operator_info: { title: '经办信息', render: renderOperatorInfo },
  status: { title: '状态', render: renderStatus },
}

function buildColumn(key: string): Column<any> | undefined {
  const base = BASE_COLUMN_DEFS[key]
  if (base) {
    return {
      key,
      dataKey: key,
      title: base.title,
      align: base.align,
      width: colWidth(key, defaultWidthOf(key)),
      // 摘要列吸收剩余宽度，避免列宽总和不足时右侧固定的操作列被空白隔开；拖动出的宽度仍是下限
      flexGrow: key === 'summary' ? 1 : undefined,
      headerCellRenderer: resizableHeader(key, base.title, base.align),
      cellRenderer: cell(base.render),
    }
  }
  const aux = auxColumnByProp(key)
  if (!aux) return undefined
  return {
    key,
    dataKey: key,
    title: aux.name,
    width: colWidth(key, defaultWidthOf(key)),
    headerCellRenderer: resizableHeader(key, aux.name),
    cellRenderer: cell(row => String(row[key] ?? '')),
  }
}

const virtualColumns = computed<Column<any>[]>(() => {
  const cols: Column<any>[] = []

  if (props.mode === 'audit') {
    cols.push({
      key: '__selection__',
      width: colWidth('__selection__', 40),
      align: 'center',
      headerCellRenderer: resizableHeader(
        '__selection__',
        () =>
          h(ElCheckbox, {
            class: 'audit-selection',
            modelValue: allSelected.value,
            indeterminate: someSelected.value,
            disabled: selectableRows.value.length === 0,
            onChange: toggleAllSelection,
          }),
        'center'
      ),
      cellRenderer: cell(row =>
        props.isSelectableRow(row)
          ? h(ElCheckbox, {
              class: 'audit-selection',
              modelValue: isVoucherSelected(row),
              onChange: () => toggleVoucherSelection(row),
            })
          : ''
      ),
    })
  }

  // 显式依赖：开关切换 / 科目表加载完成后重建列，触发虚拟表格重绘
  void accountDisplayRevision()

  for (const key of renderColumnKeys.value) {
    const col = buildColumn(key)
    if (col) cols.push(col)
  }

  if (props.mode === 'preview') return cols

  cols.push({
    key: '操作',
    title: '操作',
    width: colWidth('操作', defaultWidthOf('操作')),
    class: 'audit-action-col',
    headerCellRenderer: resizableHeader('操作', '操作'),
    cellRenderer: cell(renderActions),
  })

  return cols
})

defineExpose({ tableRef, containerRef })
</script>

<style scoped>
.voucher-audit-table__body {
  position: relative;
  flex: 1 1 0;
  min-height: 0;
}

.voucher-audit-table__empty {
  position: absolute;
  inset: 40px 0 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--wb-text-3, #94a3b8);
  font-size: 13px;
  pointer-events: none;
}

.infinite-scroll-status {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 6px 0;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  flex-shrink: 0;
}

.infinite-scroll-status__loading {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

/* 网格线 / 斑马纹 / 选中高亮：见 voucher.styles.css（三页共用） */
:deep(.voucher-audit-table-v2) {
  font-size: var(--cw-text-base, 13px);
}

:deep(.voucher-audit-table-v2 .el-table-v2__header-cell),
:deep(.voucher-audit-table-v2 .el-table-v2__row-cell) {
  padding: 0 6px;
}

:deep(.voucher-audit-table-v2 .el-table-v2__header-cell) {
  background: var(--el-fill-color-light) !important;
  color: var(--cw-text-primary, #303133);
  font-weight: 600;
  user-select: none;
}

:deep(.voucher-audit-table-v2 .el-table-v2__row-cell) {
  color: var(--wb-text, #303133);
  line-height: 20px;
}

.voucher-status-cell {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  white-space: nowrap;
}

.operator-info {
  display: inline-flex;
  gap: 10px;
  white-space: nowrap;
  font-size: 12px;
  color: #606266;
}

/* 操作列由 cellRenderer（h()）渲染，不带 scoped 属性，此处 scoped 选择器不会命中；
   按钮间距/内边距统一走 common.css 的全局「表格操作列」规则（.el-table-v2__row-cell） */

:deep(.audit-selection .el-checkbox__label) {
  display: none;
}
</style>
