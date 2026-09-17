<template>
  <div class="page voucher-list-page">
    <!-- 顶部功能工具栏（与凭证录入页同款） -->
    <div class="wb-card gl-toolbar-card">
      <div class="gl-toolbar">
        <button
          v-for="btn in glToolbarButtons"
          :key="btn.key"
          type="button"
          class="gl-tool-btn"
          :class="{ 'is-disabled': btn.disabled }"
          :disabled="btn.disabled"
          :title="btn.tooltip || btn.name"
          @click="btn.action"
        >
          <span class="gl-tool-btn__icon">
            <component :is="btn.icon" :size="17" :stroke-width="1.8" />
          </span>
          <span class="gl-tool-btn__label">{{ btn.name }}</span>
        </button>
        <AccountDisplayModeSwitch class="gl-toolbar-account-display" />
        <VoucherFilterBar
          class="gl-toolbar-filter"
          layout="grouped"
          :filters="filters"
          :aux-categories="auxCategories"
          :voucher-types="voucherTypes"
          :accounts="accounts"
          :aux-items-map="auxItemsMap"
          enable-status
          enable-year-period
          enable-voucher-type
          enable-account
          enable-auxiliary
          enable-sort
          enable-query-scheme
          enable-operator
          query-scheme-key="voucher-query-schemes"
          @search="handleSearch"
          @sort-change="onSortChange"
          @load-accounts="loadAccounts"
          @load-aux-items="loadAuxItems"
          @search-aux-items="searchAuxItems"
          @apply-scheme="handleApplyScheme"
        />
      </div>
    </div>

    <div class="voucher-page-top">
      <div class="voucher-load-status">
        <span class="voucher-load-status__text">
          共 <strong>{{ pagination.total }}</strong> 条凭证 · 已加载
          <strong>{{ list.length }}</strong> 条
          <template v-if="softCapReached">
            （已加载较多，自动滚动已暂停，可点「继续加载」或改用导出）
          </template>
          <template v-else-if="hasMore">（继续下滚可加载更多）</template>
        </span>
        <el-button
          v-if="softCapReached"
          size="small"
          plain
          :loading="loading || loadingMore"
          @click="handleContinueLoad"
        >
          继续加载
        </el-button>
        <el-button
          v-else-if="hasMore"
          size="small"
          plain
          :loading="loading || loadingMore"
          @click="handleLoadRemaining"
        >
          加载剩余
        </el-button>
      </div>
    </div>

    <VoucherAuditTable
      ref="voucherTableRef"
      class="voucher-audit-table-host"
      mode="query"
      :loading="loading"
      :loading-more="loadingMore"
      :has-more="hasMore"
      :flat-list="flatList"
      :is-selectable-row="() => false"
      :get-row-class="getRowClass"
      :get-cell-class-name-fn="getCellClassName"
      :aux-categories="auxCategories"
      :get-col-visible="getColVisible"
      :ordered-column-keys="orderedColumnKeys"
      :column-widths="columnWidths"
      :highlight-text="highlightText"
      @header-dragend="onColumnDragEnd"
      @row-click="handleRowClick"
      @view-detail="handleRowDblclick"
      @print="printVoucher"
      @delete="handleDelete"
    />

    <div v-if="flatList.length > 0" class="voucher-batch-bar voucher-query-summary-bar">
      <span class="summary-item">
        <span class="summary-label">已加载凭证：</span>
        <span class="summary-value">{{ voucherCount }} 张</span>
      </span>
      <span class="summary-item">
        <span class="summary-label">借方合计：</span>
        <span class="summary-value summary-debit">{{ formatAmount(totalDebit) }}</span>
      </span>
      <span class="summary-item">
        <span class="summary-label">贷方合计：</span>
        <span class="summary-value summary-credit">{{ formatAmount(totalCredit) }}</span>
      </span>
      <span class="summary-item">
        <span class="summary-label">差额：</span>
        <span class="summary-value" :class="balanceDiff !== 0 ? 'summary-error' : ''">
          {{ formatAmount(balanceDiff) }}
        </span>
      </span>
    </div>

    <div class="pagination-bar toolbar">
      <span class="pagination-text">
        共 {{ pagination.total }} 条 · 已加载 {{ list.length }} 条
      </span>
      <span class="pagination-text">每次加载</span>
      <el-select v-model="pagination.pageSize" style="width: 95px" @change="handlePageSizeChange">
        <el-option label="20条" :value="20" />
        <el-option label="50条" :value="50" />
        <el-option label="100条" :value="100" />
        <el-option label="200条" :value="200" />
      </el-select>
      <el-button
        v-if="softCapReached"
        size="small"
        plain
        :loading="loading || loadingMore"
        @click="handleContinueLoad"
      >
        继续加载
      </el-button>
      <el-button
        v-else-if="hasMore"
        size="small"
        plain
        :loading="loading || loadingMore"
        @click="handleLoadRemaining"
      >
        加载剩余
      </el-button>
    </div>

    <VoucherEntryDialogHost ref="entryDialogHostRef" @saved="fetchData" />
    <ColumnSettingsDialog v-model="columnDialogVisible" :columns="columnSettingsList" @update:columns="updateColumnSettings" @reset="resetColumnSettings" />

    <VoucherHiprintDialog
      v-model="printDialogVisible"
      :voucher-ids="printVoucherIds"
      :mode="printMode"
      :auto-print="directPrint"
    />

    <BatchPrintDialog
      v-model="batchPrintVisible"
      :default-date-range="batchPrintDateRange"
      :default-voucher-type-ids="batchPrintVoucherTypeIds"
    />

    <el-dialog v-model="templateDialogVisible" title="保存为模版" width="500px">
      <el-form :model="templateForm" label-width="100px">
        <el-form-item label="模版编号" required>
          <el-input v-model="templateForm.template_no" placeholder="如：MB001" />
        </el-form-item>
        <el-form-item label="模版说明" required>
          <el-input v-model="templateForm.template_name" placeholder="如：差旅费报销" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="templateDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="templateSaving" @click="handleTemplateConfirm">
          确定
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onActivated, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import request from '@/api/request'
import {
  Download,
  RotateCw,
  Eye,
  FileEdit,
  Undo2,
  Trash2,
  ExternalLink,
  Printer,
  FileText,
  Settings2,
  BookOpen,
  Calculator,
  FilePen,
  ArrowLeft,
} from 'lucide-vue-next'
import { ElMessage, ElMessageBox } from 'element-plus'
import { getAssetVoucherLockMessage } from '@/utils/voucherSourceGuard'
import BatchPrintDialog from '@/components/print/BatchPrintDialog.vue'
import VoucherHiprintDialog from '@/components/print/VoucherHiprintDialog.vue'
import VoucherFilterBar from '@/components/voucher/VoucherFilterBar.vue'
import VoucherAuditTable from '@/components/voucher/VoucherAuditTable.vue'
import VoucherEntryDialogHost from '@/components/voucher/VoucherEntryDialogHost.vue'
import { useDeleteConfirm } from '@/composables/useConfirm'
import { showSuccess, showOperationError } from '@/composables/useMessage'
import { useVoucherQuery, applyVoucherFilters, type VoucherFilters } from '@/composables/useVoucherQuery'
import { useVoucherModalRestore } from '@/composables/useVoucherModalRestore'
import { useTableInfiniteScroll } from '@/composables/useTableInfiniteScroll'
import { useOperationHistory } from '@/composables/useOperationHistory'
import { useVoucherReverse, canReverseVoucher, reverseDisabledReason } from '@/composables/useVoucherReverse'
import { useColumnWidthMemory } from '@/composables/useColumnWidthMemory'
import { useTableSearch } from '@/composables/useTableSearch'
import { exportVouchersToExcel, fetchAllVouchers } from '@/utils/voucherExport'
import ColumnSettingsDialog from '@/components/common/ColumnSettingsDialog.vue'
import { loadColumnSettings, saveColumnSettings, type ColumnSetting } from '@/utils/columnSettings'
import { useIncrementalAuxColumns } from '@/composables/useIncrementalAuxColumns'
import { VOUCHER_LIST_SOFT_CAP } from '@/utils/voucherListPerf'

const VIS_COL_KEY = 'voucher-query-cols-visible'
const {
  widths: columnWidths,
  onDragEnd: onColumnDragEnd,
  load: reloadColumnWidths,
} = useColumnWidthMemory('voucher_query')

interface ColSetting extends ColumnSetting {
  dynamic?: boolean
}

const baseVisibleCols: ColSetting[] = [
  { key: 'voucher_date', label: '日期', visible: true },
  { key: 'voucher_no', label: '凭证号', visible: true },
  { key: 'voucher_type_name', label: '类型', visible: true },
  { key: 'summary', label: '摘要', visible: true },
  { key: 'account_code', label: '科目编码', visible: true },
  { key: 'account_name', label: '科目名称', visible: true },
  { key: 'debit_amt', label: '借方金额', visible: true },
  { key: 'credit_amt', label: '贷方金额', visible: true },
  { key: 'operator_info', label: '经办信息', visible: true },
  { key: 'status', label: '状态', visible: true },
]

const visibleCols = ref<ColSetting[]>(loadColumnSettings(VIS_COL_KEY, baseVisibleCols))

function restoreVisibleCols() {
  visibleCols.value = loadColumnSettings(VIS_COL_KEY, visibleCols.value)
}

function saveVisibleCols() {
  saveColumnSettings(VIS_COL_KEY, visibleCols.value)
}

function getColVisible(prop: string) {
  return visibleCols.value.find(c => c.key === prop)?.visible ?? true
}

const columnSettingsList = computed(() => visibleCols.value)
const orderedColumnKeys = computed(() => visibleCols.value.filter(column => column.visible).map(column => column.key))
const columnDialogVisible = ref(false)
function updateColumnSettings(columns: ColumnSetting[]) {
  visibleCols.value = columns.map(column => ({ ...column, dynamic: visibleCols.value.find(current => current.key === column.key)?.dynamic }))
  saveVisibleCols()
}
function resetColumnSettings() {
  updateColumnSettings([
    ...baseVisibleCols.map(column => ({ ...column })),
    ...discoveredDynamicCols.value.map(column => ({ ...column, visible: true })),
  ])
}

const route = useRoute()
const router = useRouter()
const { addRecord } = useOperationHistory()

const {
  filters,
  pagination,
  list,
  loading,
  loadingMore,
  hasMore,
  auxCategories,
  voucherTypes,
  accounts,
  auxItemsMap,
  flatList,
  fetchData,
  loadMore,
  loadRemaining,
  buildQueryParams,
  onPageSizeChange,
  onSortChange,
  loadAuxCategories,
  loadVoucherTypes,
  loadAccounts,
  loadAuxItems,
  searchAuxItems,
} = useVoucherQuery({
  enableStatus: true,
  enableYearPeriod: true,
  enableVoucherType: true,
  enableAccount: true,
  enableAuxiliary: true,
  enableSort: true,
  enableSearchMemory: true,
  searchMemoryKey: 'voucher-query-filters',
  defaultPageSize: 50,
})

const { highlightText, searchKeyword } = useTableSearch(
  () => flatList.value,
  ['summary', 'account_code', 'account_name']
)

watch(
  () => filters.value.keyword,
  kw => {
    searchKeyword.value = kw
  },
  { immediate: true }
)

const { discoveredDynamicCols } = useIncrementalAuxColumns({
  flatList,
  auxCategories,
  storageKey: VIS_COL_KEY,
  baseVisibleCols,
  visibleCols,
})

// 借贷合计 / 凭证张数：随 flatList 增量累加，避免每次全表 reduce
const loadedVoucherIds = new Set<string>()
const voucherCount = ref(0)
const totalDebit = ref(0)
const totalCredit = ref(0)
let totalsScannedLen = 0

watch(
  () => flatList.value,
  rows => {
    if (rows.length < totalsScannedLen) {
      loadedVoucherIds.clear()
      voucherCount.value = 0
      totalDebit.value = 0
      totalCredit.value = 0
      totalsScannedLen = 0
    }
    for (let i = totalsScannedLen; i < rows.length; i++) {
      const row = rows[i]
      if (row._voucherId) loadedVoucherIds.add(String(row._voucherId))
      if (row.direction === 'debit') totalDebit.value += Number(row.amount) || 0
      else if (row.direction === 'credit') totalCredit.value += Number(row.amount) || 0
    }
    totalsScannedLen = rows.length
    voucherCount.value = loadedVoucherIds.size
  },
  { immediate: true }
)

const balanceDiff = computed(() => totalDebit.value - totalCredit.value)

function formatAmount(value: number): string {
  return value.toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

// 滚轮下拉自动加载下一页（追加式无限滚动）
const voucherTableRef = ref<InstanceType<typeof VoucherAuditTable> | null>(null)
const { scrollToTop, isOverSoftCap } = useTableInfiniteScroll({
  getScrollEl: () => (voucherTableRef.value as any)?.containerRef ?? null,
  hasMore,
  loading,
  loadingMore,
  onLoadMore: loadMore,
  watchSource: () => flatList.value.length,
  maxAutoRows: VOUCHER_LIST_SOFT_CAP,
})

const softCapReached = computed(() => isOverSoftCap() && hasMore.value)

const entryDialogHostRef = ref<InstanceType<typeof VoucherEntryDialogHost> | null>(null)
const { tryRestoreVoucherModal } = useVoucherModalRestore(entryDialogHostRef)
const exporting = ref(false)
const selectedVoucherId = ref('')

function getRowClass({ row }: { row: { _stripeGroup?: number; _voucherId?: string } }) {
  const stripeClass = row._stripeGroup === 0 ? 'voucher-group-even' : 'voucher-group-odd'
  if (selectedVoucherId.value && row._voucherId === selectedVoucherId.value) {
    return `${stripeClass} voucher-selected`
  }
  return stripeClass
}

function getCellClassName({ row }: { row: { _voucherId?: string } }) {
  return selectedVoucherId.value && row._voucherId === selectedVoucherId.value
    ? 'voucher-cell-selected'
    : ''
}

async function handleApplyScheme(schemeFilters: Partial<VoucherFilters>) {
  applyVoucherFilters(filters.value, schemeFilters)
  pagination.page = 1
  await fetchData()
  await scrollToTop()
}

async function handleSearch() {
  pagination.page = 1
  await fetchData()
  await scrollToTop()
}

/** 切换每次加载条数：重新从第一页加载并回到顶部 */
async function handlePageSizeChange(size: number) {
  onPageSizeChange(size)
  await scrollToTop()
}

async function handleContinueLoad() {
  await loadMore()
}

async function handleLoadRemaining() {
  const remaining = Math.max(0, pagination.total - list.value.length)
  if (remaining <= 0) return
  if (list.value.length + remaining > VOUCHER_LIST_SOFT_CAP) {
    try {
      await ElMessageBox.confirm(
        `剩余约 ${remaining} 条，全部加载进表格可能变卡。建议改用「另存」导出，或缩小日期范围。是否仍要加载（最多 ${VOUCHER_LIST_SOFT_CAP} 条）？`,
        '加载确认',
        {
          type: 'warning',
          confirmButtonText: '继续加载',
          cancelButtonText: '取消',
        }
      )
    } catch {
      return
    }
  }
  await loadRemaining()
  await scrollToTop()
}

function applyRouteFilters() {
  const year = Number(route.query.year)
  const period = Number(route.query.period)
  const keyword = typeof route.query.keyword === 'string' ? route.query.keyword : ''

  if (Number.isFinite(year) && year > 0) filters.value.year = year
  if (Number.isFinite(period) && period > 0) filters.value.period = period
  filters.value.keyword = keyword
}

function handleRowClick(row: { _voucherId?: string }) {
  if (!row._voucherId) return
  selectedVoucherId.value = selectedVoucherId.value === row._voucherId ? '' : row._voucherId
}

function handleRowDblclick(row: any) {
  entryDialogHostRef.value?.open(row)
}

const printDialogVisible = ref(false)
const printVoucherIds = ref<Array<string | number>>([])
const printMode = ref<'single' | 'batch'>('batch')
const directPrint = ref(false)
const batchPrintVisible = ref(false)
const batchPrintDateRange = ref<string[]>([])
const batchPrintVoucherTypeIds = ref<string[]>([])

function printVoucher(row: { _voucherId?: string; id?: string }) {
  const voucherId = row._voucherId || row.id
  if (!voucherId) return
  printVoucherIds.value = [voucherId]
  printMode.value = 'single'
  printDialogVisible.value = true
}

function handleHiprint() {
  if (!selectedVoucherId.value) return
  printVoucherIds.value = [selectedVoucherId.value]
  printMode.value = 'single'
  printDialogVisible.value = true
}

function handleBatchPrint() {
  const vouchers = list.value
  if (vouchers.length > 0) {
    const dates = vouchers
      .map((v: any) => v.voucher_date || v.date)
      .filter(Boolean)
      .sort() as string[]
    if (dates.length >= 2) {
      batchPrintDateRange.value = [dates[0], dates[dates.length - 1]]
    } else if (dates.length === 1) {
      batchPrintDateRange.value = [dates[0], dates[0]]
    } else {
      batchPrintDateRange.value = []
    }
    const typeIds = new Set<string>()
    vouchers.forEach((v: any) => {
      if (v.voucher_type_id) typeIds.add(v.voucher_type_id)
    })
    batchPrintVoucherTypeIds.value = Array.from(typeIds)
  } else {
    batchPrintDateRange.value = []
    batchPrintVoucherTypeIds.value = []
  }
  batchPrintVisible.value = true
}

const templateDialogVisible = ref(false)
const templateForm = ref({
  template_no: '',
  template_name: '',
})
const templateSaving = ref(false)

// ========== 凭证冲红 ==========

const { reverseVoucher } = useVoucherReverse({ onSuccess: () => fetchData() })

/** 当前选中的凭证原始记录（list 为 v.* 全字段，含冲红关联列） */
const selectedVoucher = computed(() =>
  selectedVoucherId.value ? list.value.find((v: any) => v.id === selectedVoucherId.value) : null
)

const canReverseSelected = computed(() => canReverseVoucher(selectedVoucher.value))

const reverseTooltip = computed(() =>
  canReverseSelected.value ? '' : reverseDisabledReason(selectedVoucher.value)
)

function handleReverse() {
  void reverseVoucher(selectedVoucher.value)
}

function handleTurnTemplate() {
  if (!selectedVoucherId.value) return
  templateForm.value = {
    template_no: '',
    template_name: '',
  }
  templateDialogVisible.value = true
}

async function handleTemplateConfirm() {
  if (!templateForm.value.template_no || !templateForm.value.template_name) {
    ElMessage.warning('请填写模版编号和模版说明')
    return
  }
  templateSaving.value = true
  try {
    await request.post('/voucher-templates', {
      template_no: templateForm.value.template_no,
      template_name: templateForm.value.template_name,
      voucher_id: selectedVoucherId.value,
    })
    showSuccess('模版保存成功')
    templateDialogVisible.value = false
  } catch (error: any) {
    showOperationError(error, '保存失败')
  } finally {
    templateSaving.value = false
  }
}

function handleViewSelected() {
  if (!selectedVoucher.value) {
    ElMessage.warning('请先在列表中点击选择一张凭证')
    return
  }
  entryDialogHostRef.value?.open(selectedVoucher.value)
}

function handleDeleteSelected() {
  if (!selectedVoucherId.value) return
  void handleDelete({ _voucherId: selectedVoucherId.value })
}

function handleReturn() {
  if (window.history.length > 1) {
    router.back()
  } else {
    router.push('/group/财务总账')
  }
}

// 顶部功能工具栏（与凭证录入页同款排版）
const glToolbarButtons = computed(() => [
  {
    key: 'save',
    name: '另存',
    icon: Download,
    tooltip: '导出为 Excel 文件',
    disabled: exporting.value,
    action: exportData,
  },
  {
    key: 'refresh',
    name: '刷新',
    icon: RotateCw,
    tooltip: '刷新凭证列表',
    action: () => fetchData(),
  },
  {
    key: 'view',
    name: '查看',
    icon: Eye,
    tooltip: '查看选中的凭证',
    disabled: !selectedVoucherId.value,
    action: handleViewSelected,
  },
  {
    key: 'edit',
    name: '修改',
    icon: FileEdit,
    tooltip: '修改选中的凭证（仅草稿可编辑）',
    disabled: !selectedVoucherId.value,
    action: handleViewSelected,
  },
  {
    key: 'reverse',
    name: '反冲',
    icon: Undo2,
    tooltip: reverseTooltip.value || '凭证红字冲销',
    disabled: !canReverseSelected.value,
    action: handleReverse,
  },
  {
    key: 'delete',
    name: '删除',
    icon: Trash2,
    tooltip: '删除选中的凭证',
    disabled: !selectedVoucherId.value,
    action: handleDeleteSelected,
  },
  {
    key: 'turn-template',
    name: '转出',
    icon: ExternalLink,
    tooltip: '保存为凭证模版',
    disabled: !selectedVoucherId.value,
    action: handleTurnTemplate,
  },
  {
    key: 'batch-print',
    name: '连打',
    icon: Printer,
    tooltip: '连续打印（批量打印）',
    action: handleBatchPrint,
  },
  {
    key: 'hiprint',
    name: '打印',
    icon: FileText,
    tooltip: '打印选中凭证',
    disabled: !selectedVoucherId.value,
    action: handleHiprint,
  },
  {
    key: 'columns',
    name: '列设置',
    icon: Settings2,
    tooltip: '设置显示列',
    action: () => (columnDialogVisible.value = true),
  },
  {
    key: 'entry',
    name: '录入',
    icon: FilePen,
    tooltip: '跳转凭证录入',
    action: () => router.push('/voucher/entry'),
  },
  {
    key: 'detail-ledger',
    name: '明细账',
    icon: BookOpen,
    tooltip: '跳转明细账',
    action: () => router.push('/ledger/detail'),
  },
  {
    key: 'summary-ledger',
    name: '汇总',
    icon: Calculator,
    tooltip: '跳转凭证汇总表',
    action: () => router.push('/ledger/summary'),
  },
  {
    key: 'return',
    name: '返回',
    icon: ArrowLeft,
    tooltip: '返回',
    action: handleReturn,
  },
])

async function exportData() {
  exporting.value = true
  try {
    const vouchers = await fetchAllVouchers(buildQueryParams())
    await exportVouchersToExcel(vouchers, {
      sheetName: '凭证查询',
      filePrefix: '凭证查询',
    })
    ElMessage.success(`已导出 ${vouchers.length} 张凭证`)
  } catch (error) {
    showOperationError('导出', error)
  } finally {
    exporting.value = false
  }
}

async function handleDelete(row: any) {
  const voucher = list.value.find((v: any) => v.id === row._voucherId)
  if (!voucher) return

  // 固定资产生成的凭证只能回固定资产模块反折旧/撤销处置后删除（后端同样拦截）
  const lock = getAssetVoucherLockMessage(voucher as { source?: string | null }, '删除')
  if (lock) {
    ElMessage.warning(lock)
    return
  }

  const confirmed = await useDeleteConfirm(`凭证 ${voucher.voucher_no}`)
  if (!confirmed) return

  try {
    await request.delete(`/voucher/vouchers/${row._voucherId}`)
    showSuccess('删除成功')
    addRecord('delete', '凭证查询', `删除凭证：${voucher.voucher_no}`)
    if (selectedVoucherId.value === row._voucherId) {
      selectedVoucherId.value = ''
    }
    fetchData()
  } catch (error) {
    showOperationError('删除', error)
  }
}

onMounted(async () => {
  applyRouteFilters()
  restoreVisibleCols()
  const [, , paramsRes] = await Promise.all([
    loadAuxCategories(),
    loadVoucherTypes(),
    request.get<unknown[]>('/system/params').catch(() => ({ data: [] })),
  ])
  const params = ((paramsRes as { data?: Array<{ param_key: string; param_value: string }> }).data ||
    []) as Array<{ param_key: string; param_value: string }>
  const dp = params.find(p => p.param_key === 'direct_print')
  directPrint.value = dp ? dp.param_value === 'true' : false
  fetchData()
  await tryRestoreVoucherModal()
})

onActivated(() => {
  reloadColumnWidths()
  void tryRestoreVoucherModal()
})
</script>

<style src="./voucher.styles.css"></style>
