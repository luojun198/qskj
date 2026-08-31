<template>
  <div ref="containerRef" class="table-fill-wrap">
    <el-table
      ref="tableRef"
      :data="flatList"
      border
      size="small"
      class="compact-data-table"
      :height="tableHeight"
      :loading="loading"
      :row-class-name="getRowClass"
      :cell-class-name="getCellClassName"
      :span-method="voucherSpanMethod"
      @selection-change="onSelect"
      @row-click="handleRowClick"
      @row-dblclick="handleRowDblclick"
      @header-dragend="onHeaderDragEnd"
    >
    <el-table-column
      v-if="mode !== 'query'"
      type="selection"
      column-key="__selection__"
      width="40"
      :selectable="isSelectableRow"
    />
    <template v-for="columnKey in renderColumnKeys" :key="columnKey">
    <el-table-column
      v-if="columnKey === 'voucher_date'"
      column-key="voucher_date"
      prop="voucher_date"
      label="日期"
      :width="colWidth('voucher_date', 100)"
    />
    <el-table-column
      v-else-if="columnKey === 'voucher_no'"
      column-key="voucher_no"
      prop="voucher_no"
      label="凭证号"
      :width="colWidth('voucher_no', 100)"
      align="center"
    />
    <el-table-column
      v-else-if="columnKey === 'voucher_type_name'"
      column-key="voucher_type_name"
      prop="voucher_type_name"
      label="类型"
      :width="colWidth('voucher_type_name', 100)"
    />
    <el-table-column
      v-else-if="columnKey === 'summary'"
      column-key="summary"
      prop="summary"
      label="摘要"
      :width="colWidth('summary', 150)"
    >
      <template v-if="highlightText" #default="{ row }">
        <span v-html="highlightText(row.summary || '')"></span>
      </template>
    </el-table-column>
    <el-table-column
      v-else-if="columnKey === 'account_code'"
      column-key="account_code"
      prop="account_code"
      label="科目编码"
      :width="colWidth('account_code', 100)"
    >
      <template v-if="highlightText" #default="{ row }">
        <span v-html="highlightText(row.account_code || '')"></span>
      </template>
    </el-table-column>
    <el-table-column
      v-else-if="columnKey === 'account_name'"
      column-key="account_name"
      prop="account_name"
      label="科目名称"
      :width="colWidth('account_name', 160)"
    >
      <template v-if="highlightText" #default="{ row }">
        <span v-html="highlightText(row.account_name || '')"></span>
      </template>
    </el-table-column>
    <el-table-column
      v-else-if="columnKey === 'debit_amt'"
      column-key="debit_amt"
      prop="debit_amt"
      label="借方金额"
      :width="colWidth('debit_amt', 130)"
      align="right"
    >
      <template #default="{ row }">
        <span v-if="row.direction === 'debit'">{{ formatMoney(row.amount) }}</span>
      </template>
    </el-table-column>
    <el-table-column
      v-else-if="columnKey === 'credit_amt'"
      column-key="credit_amt"
      prop="credit_amt"
      label="贷方金额"
      :width="colWidth('credit_amt', 130)"
      align="right"
    >
      <template #default="{ row }">
        <span v-if="row.direction === 'credit'">{{ formatMoney(row.amount) }}</span>
      </template>
    </el-table-column>
    <el-table-column
      v-else-if="columnKey === 'operator_info'"
      column-key="operator_info"
      prop="operator_info"
      label="经办信息"
      :width="colWidth('operator_info', 150)"
    >
      <template #default="{ row }">
        <div class="operator-info">
          <span>制单 {{ row.maker_name || '-' }}</span>
          <span>审核 {{ row.auditor_name || '-' }}</span>
          <span>记账 {{ row.poster_name || '-' }}</span>
        </div>
      </template>
    </el-table-column>
    <el-table-column
      v-else-if="columnKey === 'status'"
      column-key="status"
      prop="status"
      label="状态"
      :width="colWidth('status', 80)"
    >
      <template #default="{ row }">
        <el-tag :type="statusType[row.status]" size="small">{{ statusText[row.status] }}</el-tag>
      </template>
    </el-table-column>
    <el-table-column
      v-else-if="auxColumnByProp(columnKey)"
      :column-key="columnKey"
      :prop="columnKey"
      :label="auxColumnByProp(columnKey)?.name"
      :width="colWidth(columnKey, 100)"
    />
    </template>
    <el-table-column
      column-key="操作"
      label="操作"
      :width="colWidth('操作', mode === 'query' ? 120 : 172)"
      fixed="right"
      class-name="audit-action-col"
    >
      <template #default="{ row }">
        <div v-if="mode === 'query'" class="audit-actions">
          <el-button link type="primary" size="small" @click="emit('print', row)">打印</el-button>
          <el-button
            v-if="row.status !== 'posted'"
            link
            type="danger"
            size="small"
            @click="emit('delete', row)"
          >
            删除
          </el-button>
        </div>
        <div v-else class="audit-actions">
          <el-button link type="primary" size="small" @click="emit('view-detail', row)">
            查看
          </el-button>
          <el-button
            v-if="row.status === 'draft'"
            link
            type="success"
            size="small"
            @click="emit('audit', row)"
          >
            审核
          </el-button>
          <el-button
            v-if="row.status === 'audited'"
            link
            type="warning"
            size="small"
            @click="emit('unaudit', row)"
          >
            反审核
          </el-button>
          <el-button
            v-if="row.status !== 'posted'"
            link
            type="primary"
            size="small"
            @click="emit('post', row)"
          >
            记账
          </el-button>
          <el-button
            v-if="row.status === 'posted' && canUnpost"
            link
            type="warning"
            size="small"
            @click="emit('unpost', row)"
          >
            反记账
          </el-button>
        </div>
      </template>
    </el-table-column>
  </el-table>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, toRef } from 'vue'
import { useFillHeightTable } from '@/composables/useFillHeightTable'
import { formatMoney, statusType, statusText } from '@/composables/useVoucherAuditData'
import { bindTableColumnLayout } from '@/composables/useColumnWidthMemory'

interface Props {
  flatList: any[]
  isSelectableRow: (row: any) => boolean
  getRowClass: (params: { row: any }) => string
  auxCategories?: any[]
  selectedRows?: any[]
  canUnpost?: boolean
  getColVisible?: (prop: string) => boolean
  columnWidths?: Record<string, number>
  mode?: 'audit' | 'query'
  loading?: boolean
  highlightText?: (text: string | number | null | undefined) => string
  getCellClassNameFn?: (params: { row: any }) => string
  orderedColumnKeys?: string[]
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
})

const { containerRef, tableHeight } = useFillHeightTable()

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
  return visibleAuxColumns.value.find(column => column.prop === prop)
}

function colWidth(prop: string, fallback: number) {
  const saved = props.columnWidths[prop]
  return saved && saved > 0 ? saved : fallback
}

function onHeaderDragEnd(newWidth: number, oldWidth: number, column: any, event: Event) {
  emit('header-dragend', newWidth, oldWidth, column, event)
}

bindTableColumnLayout(toRef(props, 'columnWidths'), tableRef)

const isInternalSelection = ref(false)

const selectedVoucherIds = computed(() => {
  return new Set((props.selectedRows || []).map((r: any) => r._voucherId || r.id))
})

function isVoucherSelected(row: any) {
  return selectedVoucherIds.value.has(row._voucherId || row.id)
}

function getCellClassName({ row }: { row: any }) {
  if (props.getCellClassNameFn) return props.getCellClassNameFn({ row })
  return isVoucherSelected(row) ? 'voucher-cell-selected' : ''
}

function onSelect(rows: any[]) {
  if (isInternalSelection.value) return
  emit('selection-change', rows)
}

function getRowVoucherId(row: any) {
  return row._voucherId || row.id
}

/** 将表格勾选状态与父组件 selectedRows 对齐，避免批量操作后残留旧勾选 */
function syncTableSelection() {
  if (!tableRef.value) return

  nextTick(() => {
    isInternalSelection.value = true
    tableRef.value.clearSelection()

    const rows = props.selectedRows || []
    if (rows.length === 0) {
      setTimeout(() => {
        isInternalSelection.value = false
      }, 0)
      return
    }

    const selectedIds = new Set(rows.map((r: any) => getRowVoucherId(r)))

    props.flatList.forEach((row: any) => {
      if (selectedIds.has(getRowVoucherId(row)) && props.isSelectableRow(row)) {
        tableRef.value.toggleRowSelection(row, true)
      }
    })

    setTimeout(() => {
      isInternalSelection.value = false
    }, 0)
  })
}

// 外部选中变化或列表刷新后，同步表格勾选（清空残留的旧行引用）
if (props.mode !== 'query') {
  watch(() => props.selectedRows, syncTableSelection, { deep: true })
  watch(() => props.flatList, syncTableSelection)
}

// 检查固定辅助列（部门、项目）是否在凭证中被使用
const hasUsedDept = computed(() => {
  return props.flatList.some(row => row.dept_name && String(row.dept_name).trim() !== '')
})

const hasUsedProject = computed(() => {
  return props.flatList.some(row => row.project_name && String(row.project_name).trim() !== '')
})

// 动态辅助列：从 flatList 中提取实际使用的辅助类别，排除已有固定列的 dept/project
const auxColumns = computed(() => {
  const fixedCodes = new Set(['dept', 'project', 'supplier', 'person', 'func_class'])
  const colMap = new Map<string, string>()
  for (const row of props.flatList) {
    for (const key of Object.keys(row)) {
      if (key.startsWith('_aux_')) {
        const value = row[key]
        // 只有当值存在且不为空字符串时才认为该辅助项目被使用
        if (!value || (typeof value === 'string' && value.trim() === '')) continue

        const code = key.slice(5)
        if (fixedCodes.has(code) || colMap.has(code)) continue

        // 只显示在 auxCategories 中且启用的类别
        const cat = props.auxCategories.find(c => c.code === code)
        if (cat) {
          colMap.set(code, cat.name || code)
        }
      }
    }
  }
  return Array.from(colMap.entries()).map(([code, name]) => ({
    code,
    name,
    prop: `_aux_${code}`,
  }))
})

// 合并所有辅助列：固定列（部门、项目）+ 动态辅助列，并按列设置过滤
const visibleAuxColumns = computed(() => {
  const columns: Array<{ code: string; name: string; prop: string }> = []

  if (hasUsedDept.value) {
    columns.push({ code: 'dept', name: '部门', prop: 'dept_name' })
  }

  if (hasUsedProject.value) {
    columns.push({ code: 'project', name: '项目', prop: 'project_name' })
  }

  columns.push(...auxColumns.value)

  return columns.filter(col => colVisible(col.prop))
})

function handleRowClick(row: any, column: any) {
  if (column && column.label === '操作') {
    return
  }

  if (props.mode === 'query') {
    emit('row-click', row)
    return
  }

  if (column && column.type === 'selection') {
    return
  }

  const firstRow = props.flatList.find(
    (r: any) => r._voucherId === row._voucherId && r._voucherRowIndex === 0
  )

  if (!firstRow || !props.isSelectableRow(firstRow)) {
    return
  }

  isInternalSelection.value = true

  tableRef.value.toggleRowSelection(firstRow)

  nextTick(() => {
    const currentSelection = tableRef.value.getSelectionRows()
    isInternalSelection.value = false
    emit('selection-change', currentSelection)
  })
}

function handleRowDblclick(row: any) {
  emit('view-detail', row)
}

function voucherSpanMethod({ row, column }: { row: any; column: any }) {
  // 这些列同一个凭证的多行分录合并显示
  const mergeProps = [
    'voucher_no',
    'voucher_date',
    'voucher_type_name',
    'operator_info',
    'status',
  ]
  if (
    mergeProps.includes(column.property) ||
    column.label === '操作' ||
    column.type === 'selection'
  ) {
    if (row._voucherRowIndex === 0) {
      return { rowspan: row._voucherEntryCount, colspan: 1 }
    }
    return { rowspan: 0, colspan: 0 }
  }
}
</script>

<style scoped>
.voucher-group-even td {
  background-color: #f0f5ff;
}
.voucher-group-odd td {
  background-color: #ffffff;
}

.operator-info {
  display: flex;
  flex-direction: column;
  gap: 1px;
  line-height: 1.35;
  font-size: 12px;
  color: #606266;
}

.audit-actions {
  display: inline-flex;
  flex-wrap: nowrap;
  align-items: center;
  gap: 2px;
  line-height: 1;
  max-width: 100%;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: thin;
}

.audit-actions :deep(.el-button.is-link) {
  margin: 0;
  padding: 2px 3px;
  min-height: 20px;
  font-size: 12px;
}

:deep(.audit-action-col .cell) {
  padding-left: 6px !important;
  padding-right: 6px !important;
}

:deep(.el-table__body tr.is-selected td:not(.el-table-fixed-column--left):not(.el-table-fixed-column--right)),
:deep(.el-table__body tr:has(.el-checkbox.is-checked) td:not(.el-table-fixed-column--left):not(.el-table-fixed-column--right)),
:deep(.el-table__body tr.voucher-selected td:not(.el-table-fixed-column--left):not(.el-table-fixed-column--right)),
:deep(.el-table__body td.voucher-cell-selected:not(.el-table-fixed-column--left):not(.el-table-fixed-column--right)) {
  background-color: #b3d8ff !important;
  font-weight: 500;
}

:deep(.el-table__body tr.is-selected:hover td:not(.el-table-fixed-column--left):not(.el-table-fixed-column--right)),
:deep(.el-table__body tr:has(.el-checkbox.is-checked):hover td:not(.el-table-fixed-column--left):not(.el-table-fixed-column--right)),
:deep(.el-table__body tr.voucher-selected:hover td:not(.el-table-fixed-column--left):not(.el-table-fixed-column--right)),
:deep(.el-table__body tr:hover td.voucher-cell-selected:not(.el-table-fixed-column--left):not(.el-table-fixed-column--right)) {
  background-color: #b3d8ff !important;
}
</style>
