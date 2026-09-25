<template>
  <el-card ref="containerRef" class="draft-card gl-table-card">
    <template #header>
      <!-- 次级操作搜索栏（参照参考图第二行） -->
      <div class="gl-sub-bar">
        <!-- 左侧主操作：新增凭证 -->
        <el-button
          type="primary"
          class="gl-sub-bar__add-btn"
          @click="emit('add-voucher')"
        >
          <el-icon><Plus /></el-icon>
          新增凭证
        </el-button>

        <!-- 本页固定只列未记账凭证（草稿 + 已审核），已记账的请到「凭证管理」查看 -->
        <span class="gl-sub-scope" title="凭证录入只处理未记账凭证；已记账凭证请到「凭证管理」查看">
          仅未记账凭证
        </span>

        <!-- 中间：搜索条件 + 输入框 + 快速搜索 -->
        <div class="gl-search-group">
          <span class="gl-search-label">搜索条件</span>
          <el-input
            v-model="filters.keyword"
            class="gl-search-input"
            placeholder="搜索凭证号、摘要、科目..."
            clearable
            size="small"
            @keyup.enter="handleKeywordChange"
            @clear="handleKeywordChange"
          />
          <el-button
            class="gl-search-btn"
            size="small"
            @click="handleKeywordChange"
          >
            快速搜索
          </el-button>
        </div>

        <AccountDisplayModeSwitch class="gl-sub-bar__account-display" />

        <!-- 恢复凭证排列 -->
        <el-button
          class="gl-reset-btn"
          size="small"
          @click="handleResetOrder"
        >
          恢复凭证排列
        </el-button>
      </div>
    </template>

    <!-- 凭证分录明细表格（el-table-v2 虚拟滚动） -->
    <div v-loading="loading" class="gl-virtual-table-wrap">
      <el-auto-resizer>
        <template #default="{ height, width }">
          <el-table-v2
            ref="tableRef"
            class="gl-entry-table gl-entry-table-v2"
            :columns="virtualColumns"
            :data="filteredData"
            :width="width"
            :height="Math.max(height, 200)"
            :row-height="VOUCHER_VIRTUAL_ROW_HEIGHT"
            :header-height="36"
            :row-class="getVirtualRowClass"
            :row-event-handlers="rowEventHandlers"
            fixed
          />
        </template>
      </el-auto-resizer>
      <div v-if="!filteredData.length && !loading" class="gl-virtual-empty">暂无凭证数据</div>
    </div>

    <!-- 底部滚动加载状态与页码 -->
    <div v-if="props.pagination" class="draft-pagination">
      <span class="draft-pagination__text">
        共 {{ props.pagination.total }} 条 · 已加载 {{ loadedVoucherCount }} 条
      </span>
      <span v-if="loadingMore" class="draft-pagination__text">加载中…</span>
      <template v-else-if="softCapReached">
        <span class="draft-pagination__text">已加载较多，自动滚动已暂停</span>
        <el-button size="small" plain @click="emit('continue-load')">继续加载</el-button>
      </template>
      <span v-else-if="!hasMore && loadedVoucherCount > 0" class="draft-pagination__text">
        已全部加载
      </span>
      <el-select
        :model-value="props.pagination.pageSize"
        size="small"
        style="width: 105px"
        @change="handleSizeChange"
      >
        <el-option label="每次 20 条" :value="20" />
        <el-option label="每次 50 条" :value="50" />
        <el-option label="每次 100 条" :value="100" />
        <el-option label="每次 200 条" :value="200" />
      </el-select>
    </div>
  </el-card>
</template>

<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue'
import { Plus } from '@element-plus/icons-vue'
import { useListColumnWidth } from '@/composables/useColumnWidthMemory'
import { useTableSearch } from '@/composables/useTableSearch'
import { useVirtualTableHeaderScrollSync } from '@/composables/useVirtualTableHeaderScrollSync'
import {
  buildVoucherFlatRows,
  discoverAuxColumnsFromRows,
  type AuxColumnDef,
} from '@/utils/voucherFlatList'
import {
  useVoucherEntryVirtualColumns,
  VOUCHER_VIRTUAL_ROW_HEIGHT,
} from '@/composables/useVoucherEntryVirtualColumns'

interface SortConfig {
  field: string
  order: string
}

interface DraftFilters {
  keyword: string
  dateRange: string[]
  voucherTypeIds: string[]
  accountIds: number[]
  minAmount: string
  maxAmount: string
  status?: string
}

interface Props {
  vouchers: any[]
  /** 父页增量展平后的分录行；传入后不再在本组件全量重算 */
  flatList?: any[]
  loading?: boolean
  sortConfig?: SortConfig
  auxCategories?: any[]
  voucherTypes?: any[]
  accounts?: any[]
  pagination?: {
    page: number
    pageSize: number
    total: number
  }
  selectedVoucherId?: string
  /** 滚动追加加载中 */
  loadingMore?: boolean
  /** 是否还有未加载的数据 */
  hasMore?: boolean
  /** 已达软上限，自动滚动暂停 */
  softCapReached?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  loading: false,
  flatList: undefined,
  sortConfig: () => ({ field: 'voucher_date', order: 'asc' }),
  auxCategories: () => [],
  voucherTypes: () => [],
  accounts: () => [],
  selectedVoucherId: '',
  loadingMore: false,
  hasMore: false,
  softCapReached: false,
})

const emit = defineEmits<{
  refresh: []
  edit: [row: any]
  delete: [row: any]
  'sort-change': [config: SortConfig]
  'row-click': [row: any]
  'row-dblclick': [row: any]
  'page-change': [page: number, pageSize: number]
  'filter-change': [filters: DraftFilters]
  'load-accounts': []
  'add-voucher': []
  'reset-order': []
  'continue-load': []
}>()

// 筛选条件
const filters = ref<DraftFilters>({
  keyword: '',
  dateRange: [],
  voucherTypeIds: [],
  accountIds: [],
  minAmount: '',
  maxAmount: '',
  // 录入页固定只列未记账凭证（草稿 + 已审核），不提供切换
  status: 'unposted',
})

function handleKeywordChange() {
  emit('filter-change', filters.value)
}

function handleResetOrder() {
  filters.value.keyword = ''
  filters.value.status = 'unposted'
  emit('reset-order')
}

const { tableRef, colWidth, widths: columnWidths, saveColumnWidth } = useListColumnWidth('gl_voucher_entry_table')

/** 拖动过程中只改内存里的列宽，松手再由 saveColumnWidth 落盘 */
function setColumnWidth(key: string, width: number) {
  columnWidths.value = { ...columnWidths.value, [key]: width }
}
const containerRef = ref<any>(null)
// 表头被拖选自动滚动时与表体错位 → 强制回同步
useVirtualTableHeaderScrollSync(containerRef)

function handleRowClick(row: any) {
  emit('row-click', row)
}

function handleRowDblclick(row: any) {
  if (row) emit('row-dblclick', row)
}

function getVirtualRowClass({ rowData }: { rowData: any }) {
  const stripeClass = rowData._stripeGroup === 0 ? 'voucher-group-even' : 'voucher-group-odd'
  if (props.selectedVoucherId && rowData._voucherId === props.selectedVoucherId) {
    return `${stripeClass} voucher-selected`
  }
  return stripeClass
}

const rowEventHandlers = {
  onClick: ({ rowData }: { rowData: any }) => handleRowClick(rowData),
  onDblclick: ({ rowData }: { rowData: any }) => handleRowDblclick(rowData),
}

/** 表格数据：优先用父页增量 flatList，否则本地从 vouchers 展平（测试兜底） */
const filteredData = computed(() => {
  if (props.flatList) return props.flatList
  return buildVoucherFlatRows(props.vouchers || [], { mode: 'entry' })
})

const loadedVoucherCount = computed(() => {
  if (props.flatList) {
    let n = 0
    for (const row of props.flatList) {
      if (row._voucherRowIndex === 0) n++
    }
    return n
  }
  return props.vouchers?.length || 0
})

// 动态辅助列：增量发现，只扫新增行
const auxColumns = shallowRef<AuxColumnDef[]>([])
const auxSeenKeys = new Set<string>()
let auxScannedLen = 0

function resetAuxColumns() {
  auxColumns.value = []
  auxSeenKeys.clear()
  auxScannedLen = 0
}

function absorbAuxFromRows(rows: any[]) {
  if (!rows.length) return
  const newly = discoverAuxColumnsFromRows(rows, {
    mode: 'entry',
    auxCategories: props.auxCategories,
    alreadySeen: auxSeenKeys,
  })
  if (newly.length) {
    auxColumns.value = auxColumns.value.concat(newly)
  }
}

watch(
  () => filteredData.value,
  rows => {
    if (!rows.length) {
      resetAuxColumns()
      return
    }
    if (rows.length < auxScannedLen) {
      // 列表被重置 / 缩短：全量重扫
      resetAuxColumns()
      absorbAuxFromRows(rows)
      auxScannedLen = rows.length
      return
    }
    if (rows.length > auxScannedLen) {
      absorbAuxFromRows(rows.slice(auxScannedLen))
      auxScannedLen = rows.length
    }
  },
  { immediate: true }
)

watch(
  () => props.auxCategories,
  () => {
    // 类别名称变更时刷新已有列的显示名
    if (!auxColumns.value.length) return
    auxColumns.value = auxColumns.value.map(col => {
      const name = props.auxCategories.find(c => c.code === col.code)?.name || col.name
      return { ...col, name, label: name }
    })
  }
)

// 搜索高亮
const { highlightText } = useTableSearch(() => props.vouchers, [])

const { columns: virtualColumns } = useVoucherEntryVirtualColumns({
  auxColumns,
  colWidth,
  setColumnWidth,
  saveColumnWidth,
  highlightText,
})

function handleSizeChange(size: number) {
  emit('page-change', 1, size)
}

defineExpose({ tableRef, containerRef })
</script>

<style scoped>
.gl-table-card {
  margin-bottom: 0;
  border-radius: var(--wb-radius, 6px);
  border: 1px solid var(--wb-line);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
}

:deep(.el-card__header) {
  padding: 8px 12px !important;
  background: #ffffff;
  border-bottom: 1px solid var(--wb-line);
}

:deep(.el-card__body) {
  padding: 0 !important;
}

/* 次级操作搜索栏（第二行） */
.gl-sub-bar {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: nowrap;
}

.gl-sub-bar__add-btn {
  height: 28px;
  padding: 0 14px;
  font-size: 12px;
  font-weight: 500;
  border-radius: var(--wb-radius-sm, 4px);
  background: var(--mint-500);
  border-color: var(--mint-500);
  color: #ffffff;
  box-shadow: 0 1px 2px rgba(16, 185, 129, 0.2);
}

.gl-sub-bar__add-btn:hover {
  background: var(--mint-600);
  border-color: var(--mint-600);
}

.gl-search-group {
  display: flex;
  align-items: center;
  gap: 8px;
}

.gl-search-label {
  font-size: 12px;
  font-weight: 500;
  color: var(--wb-text-2, #475569);
  white-space: nowrap;
}

.gl-search-input {
  width: 220px;
}

:deep(.gl-search-input .el-input__inner) {
  height: 28px;
  font-size: 12px;
}

.gl-search-btn,
.gl-reset-btn {
  height: 28px;
  padding: 0 12px;
  font-size: 12px;
  border-radius: var(--wb-radius-sm, 4px);
  color: var(--wb-text);
  border-color: var(--wb-line-strong);
  background: #ffffff;
}

.gl-search-btn:hover,
.gl-reset-btn:hover {
  color: var(--mint-700);
  border-color: var(--mint-500);
  background: var(--surface-brand-soft, #f0fdf4);
}

/* 固定范围提示：本页只列未记账凭证 */
.gl-sub-scope {
  flex: 0 0 auto;
  padding: 2px 8px;
  border: 1px solid var(--mint-500);
  border-radius: 10px;
  font-size: 12px;
  line-height: 18px;
  color: var(--mint-700);
  background: var(--mint-50, rgba(16, 185, 129, 0.08));
  white-space: nowrap;
  cursor: default;
}

/* 虚拟表格容器 */
.gl-virtual-table-wrap {
  position: relative;
  flex: 1;
  min-height: 280px;
  height: calc(100vh - 215px);
}

.gl-virtual-empty {
  position: absolute;
  inset: 40px 0 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--wb-text-3, #94a3b8);
  font-size: 13px;
  pointer-events: none;
}

/* 表格主体及浅绿雅致表头（兼容 el-table / el-table-v2） */
:deep(.gl-entry-table th.el-table__cell),
:deep(.gl-entry-table-v2 .el-table-v2__header-cell) {
  background-color: var(--surface-brand-soft, #f0fdf4) !important;
  color: var(--mint-800, #065f46) !important;
  font-weight: 600;
  font-size: 12px;
  padding: 4px 0;
  border-bottom: 1px solid var(--mint-200, #a7f3d0) !important;
  user-select: none;
}

:deep(.gl-entry-table td.el-table__cell),
:deep(.gl-entry-table-v2 .el-table-v2__row-cell) {
  padding: 3px 6px;
  font-size: 12px;
  color: var(--wb-text);
  line-height: 20px;
}

/* 斑马纹 / 选中高亮 / 网格线：见 voucher.styles.css（三页共用） */

/* 底部滚动统计与分页 */
.draft-pagination {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
  padding: 6px 14px;
  font-size: 12px;
  color: var(--wb-text-3);
  border-top: 1px solid var(--wb-line);
  background: #ffffff;
}

.draft-pagination__text {
  white-space: nowrap;
}
</style>
