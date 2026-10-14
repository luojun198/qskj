<template>
  <div class="page voucher-list-page">
    <!-- 顶部功能工具栏：单行按钮 + 下拉组（参照金蝶） -->
    <div class="wb-card gl-toolbar-card gl-toolbar-card--inline">
      <div class="gl-toolbar">
        <GlToolbarButtons :buttons="glToolbarButtons" :groups="glToolbarGroups" />
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
          status-quick
          enable-year-period
          enable-voucher-type
          enable-account
          enable-auxiliary
          enable-sort
          enable-query-scheme
          query-scheme-key="voucher-audit-schemes"
          @search="handleSearch"
          @sort-change="onSortChange"
          @load-accounts="loadAccounts"
          @load-aux-items="loadAuxItems"
          @search-aux-items="searchAuxItems"
          @apply-scheme="handleApplyScheme"
        />
      </div>
    </div>

    <VoucherAuditTable
      ref="voucherTableRef"
      class="voucher-audit-table-host"
      :flat-list="flatList"
      :loading-more="loadingMore"
      :has-more="hasMore"
      :show-load-status="false"
      :is-selectable-row="isSelectableRow"
      :get-row-class="getRowClass"
      :aux-categories="auxCategories"
      :selected-rows="selected"
      :can-unpost="canUnpostVoucher"
      :get-col-visible="getColVisible"
      :ordered-column-keys="orderedColumnKeys"
      :column-widths="columnWidths"
      @header-dragend="onColumnDragEnd"
      @selection-change="onSelect"
      @view-detail="openEntryDialog"
      @audit="audit"
      @unaudit="unAudit"
      @post="post"
      @unpost="unPost"
    />

    <!-- 底部状态（一行纯文字，不单独分区）：左 已选 | 中 加载状态 | 右 条数与每次加载 -->
    <div class="pagination-bar toolbar list-status-bar">
      <span class="pagination-text batch-selected-text">
        {{
          selectAllMode
            ? `已选中全部 ${pagination.total} 条（含未加载数据）`
            : `已选 ${selectedVoucherCount} 张`
        }}
      </span>
      <template v-if="flatList.length > 0">
        <span class="status-item">借方合计 <b class="summary-debit">{{ formatAmount(totalDebit) }}</b></span>
        <span class="status-item">贷方合计 <b class="summary-credit">{{ formatAmount(totalCredit) }}</b></span>
      </template>
      <span v-if="flatList.length > 0 && (loadingMore || !hasMore)" class="status-item status-hint">
        {{ loadingMore ? '加载中…' : '已全部加载' }}
      </span>
      <span class="status-right">
        <span class="pagination-text">
          共 {{ pagination.total }} 条 · 已加载 {{ loadedVoucherCount }} 条
        </span>
        <template v-if="softCapReached">
          <span class="pagination-text">已加载较多，自动滚动已暂停</span>
          <el-button size="small" plain :loading="loading || loadingMore" @click="loadMore">
            继续加载
          </el-button>
        </template>
        <span class="pagination-text">每次加载</span>
        <el-select v-model="pagination.pageSize" class="page-size-select" @change="handlePageSizeChange">
          <el-option label="20条" :value="20" />
          <el-option label="50条" :value="50" />
          <el-option label="100条" :value="100" />
          <el-option label="200条" :value="200" />
          <el-option label="全部" :value="-1" />
        </el-select>
      </span>
    </div>

    <BatchAuditDialog
      v-model="batchAuditVisible"
      :form="batchAuditForm"
      :voucher-types="voucherTypes"
      :auditing="batchAuditing"
      :previewing="batchAuditPreviewing"
      :preview-count="batchAuditPreviewCount"
      :preview-first-voucher-no="batchAuditPreviewFirstVoucherNo"
      :preview-last-voucher-no="batchAuditPreviewLastVoucherNo"
      :preview-blocked-voucher-no="batchAuditPreviewBlockedVoucherNo"
      :can-unpost="canUnpostVoucher"
      @preview="handleBatchAuditPreviewWithPermission"
      @confirm="handleBatchAuditConfirm"
    />

    <VoucherEntryDialogHost ref="entryDialogHostRef" @saved="fetchData" />
    <ColumnSettingsDialog v-model="columnDialogVisible" :columns="columnSettingsList" @update:columns="updateColumnSettings" @reset="resetColumnSettings" />

    <VoucherHiprintDialog v-model="printDialogVisible" :voucher-ids="printVoucherIds" :mode="printMode" />

    <BatchPrintDialog v-model="batchPrintVisible" :default-date-range="filters.dateRange || []" />

    <!-- 任务进度对话框 -->
    <TaskProgressDialog
      v-model="taskProgressVisible"
      :task-id="currentTaskId"
      :task-type="currentTaskType"
      @completed="handleTaskCompleted"
    />

    <!-- 转模版对话框 -->
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
        <el-button type="primary" :loading="templateSaving" @click="handleTemplateConfirm"
          >确定</el-button
        >
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
// 凭证页共用全局样式：用脚本 import 而非 <style src>。
// 多个组件 <style src> 同一文件时，生产构建只编译一份且可能套用某个导入方的 scoped，导致其它页面样式丢失（FIX-344）
import '@/views/voucher/voucher.styles.css'
import { computed, onMounted, onActivated, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  Download,
  RotateCw,
  Eye,
  CheckCheck,
  ListChecks,
  FileX,
  BookCheck,
  BookX,
  Undo2,
  ExternalLink,
  Printer,
  Layers,
  Settings2,
  FilePen,
  ArrowLeft,
  MoreHorizontal,
} from 'lucide-vue-next'
import { ElMessage, ElMessageBox } from 'element-plus'
import request from '@/api/request'
import VoucherAuditTable from '@/components/voucher/VoucherAuditTable.vue'
import VoucherFilterBar from '@/components/voucher/VoucherFilterBar.vue'
import GlToolbarButtons, { type GlToolbarButton, type GlToolbarGroup } from '@/components/voucher/GlToolbarButtons.vue'
import BatchAuditDialog from '@/components/voucher/BatchAuditDialog.vue'
import VoucherEntryDialogHost from '@/components/voucher/VoucherEntryDialogHost.vue'
import VoucherHiprintDialog from '@/components/print/VoucherHiprintDialog.vue'
import BatchPrintDialog from '@/components/print/BatchPrintDialog.vue'
import TaskProgressDialog from '@/components/task/TaskProgressDialog.vue'
import { useVoucherQuery, applyVoucherFilters, type VoucherFilters } from '@/composables/useVoucherQuery'
import { useTableInfiniteScroll } from '@/composables/useTableInfiniteScroll'
import { useVoucherAuditActions } from '@/composables/useVoucherAuditActions'
import { useBatchAuditDialog } from '@/composables/useBatchAuditDialog'
import { useVoucherModalRestore } from '@/composables/useVoucherModalRestore'
import { useKeyboardShortcuts } from '@/composables/useKeyboardShortcuts'
import { useColumnWidthMemory } from '@/composables/useColumnWidthMemory'
import { hasPermission } from '@/utils/permission'
import { exportVouchersToExcel, fetchAllVouchers } from '@/utils/voucherExport'
import { useSystemParamsStore } from '@/stores/systemParams'
import { extractErrorMessage } from '@/composables/useMessage'
import { useVoucherAuditReturnStore } from '@/stores/voucherAuditReturn'
import { useVoucherReverse, canReverseVoucher, reverseDisabledReason } from '@/composables/useVoucherReverse'
import ColumnSettingsDialog from '@/components/common/ColumnSettingsDialog.vue'
import { loadColumnSettings, saveColumnSettings, type ColumnSetting } from '@/utils/columnSettings'
import { useIncrementalAuxColumns } from '@/composables/useIncrementalAuxColumns'
import { VOUCHER_LIST_SOFT_CAP } from '@/utils/voucherListPerf'

const VIS_COL_KEY = 'voucher-audit-cols-visible'
const {
  widths: columnWidths,
  onDragEnd: onColumnDragEnd,
  load: reloadColumnWidths,
} = useColumnWidthMemory('voucher_audit')

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
  { key: 'maker_name', label: '制单', visible: true },
  { key: 'auditor_name', label: '审核', visible: true },
  { key: 'poster_name', label: '记账', visible: true },
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
const canUnpostVoucher = computed(() => hasPermission('voucher:unpost'))

const route = useRoute()
const router = useRouter()
const voucherAuditReturnStore = useVoucherAuditReturnStore()

// 使用 useVoucherQuery composable（启用排序功能）
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
  loadUpTo,
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
  searchMemoryKey: 'voucher-audit-filters',
})

// 借贷合计：随 flatList 增量累加，避免每次全表 reduce
const totalDebit = ref(0)
const totalCredit = ref(0)
let totalsScannedLen = 0

watch(
  () => flatList.value,
  rows => {
    if (rows.length < totalsScannedLen) {
      totalDebit.value = 0
      totalCredit.value = 0
      totalsScannedLen = 0
    }
    for (let i = totalsScannedLen; i < rows.length; i++) {
      const row = rows[i]
      if (row.direction === 'debit') totalDebit.value += Number(row.amount) || 0
      else if (row.direction === 'credit') totalCredit.value += Number(row.amount) || 0
    }
    totalsScannedLen = rows.length
  },
  { immediate: true }
)

function formatAmount(value: number): string {
  return value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// 已加载的凭证张数（flatList 是分录行，不能直接用）
const loadedVoucherCount = computed(() => list.value.length)

// 滚轮下拉自动加载下一页（追加式无限滚动）
const voucherTableRef = ref<any>(null)
const { scrollToTop, isOverSoftCap } = useTableInfiniteScroll({
  getScrollEl: () => voucherTableRef.value?.containerRef ?? null,
  hasMore,
  loading,
  loadingMore,
  onLoadMore: loadMore,
  watchSource: () => flatList.value.length,
  maxAutoRows: VOUCHER_LIST_SOFT_CAP,
})
const softCapReached = computed(() => isOverSoftCap() && hasMore.value)

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

const { discoveredDynamicCols } = useIncrementalAuxColumns({
  flatList,
  auxCategories,
  storageKey: VIS_COL_KEY,
  baseVisibleCols,
  visibleCols,
})

// 选择相关逻辑
const selected = ref<any[]>([])

// ========== 凭证冲红 ==========

const { reverseVoucher } = useVoucherReverse({ onSuccess: () => fetchData() })

/** 冲红是单张操作：仅当恰好选中一张凭证（可能勾选多行分录）时可用 */
const reverseTargetVoucher = computed(() => {
  if (selectAllMode.value) return null
  const ids = Array.from(selectedIdSet.value)
  if (ids.length !== 1) return null
  return list.value.find((v: any) => v.id === ids[0]) || null
})

const canReverseSelected = computed(() => canReverseVoucher(reverseTargetVoucher.value))

const reverseTooltip = computed(() => {
  if (canReverseSelected.value) return ''
  if (selectAllMode.value) return '冲红为单张操作，请取消全选后只勾选一张凭证'
  if (!reverseTargetVoucher.value) return '冲红为单张操作，请只勾选一张凭证'
  return reverseDisabledReason(reverseTargetVoucher.value)
})

function handleReverse() {
  void reverseVoucher(reverseTargetVoucher.value)
}
const selectAllMode = ref(false) // 是否全选所有页
const selectionRestoreActive = ref(false)
const selectionRestoreIds = ref<string[] | null>(null)

/** O(1) 选中判断，供 getRowClass 使用 */
const selectedIdSet = computed(() => {
  const set = new Set<string>()
  for (const row of selected.value) {
    const id = row._voucherId || row.id
    if (id) set.add(String(id))
  }
  return set
})

function applySelectionRestore() {
  if (!selectionRestoreActive.value) return
  if (selectAllMode.value) {
    selected.value = flatList.value.filter(isSelectableRow)
    return
  }
  if (!selectionRestoreIds.value?.length) {
    selected.value = []
    return
  }
  const idSet = new Set(selectionRestoreIds.value)
  selected.value = flatList.value.filter(
    row => isSelectableRow(row) && idSet.has(row._voucherId || row.id)
  )
}

watch(flatList, () => {
  if (selectionRestoreActive.value) {
    applySelectionRestore()
  }
})

function isSelectableRow(row: any) {
  return row._voucherRowIndex === 0
}

function getRowClass({ row }: { row: any }) {
  const stripeClass = row._stripeGroup === 0 ? 'voucher-group-even' : 'voucher-group-odd'
  const isSelected = selectedIdSet.value.has(String(row._voucherId || ''))
  return isSelected ? `${stripeClass} voucher-selected is-selected` : stripeClass
}

function onSelect(selection: any[]) {
  selectionRestoreActive.value = false
  selectionRestoreIds.value = null
  selected.value = selection

  // 判断是否全选了当前页
  const selectableRows = flatList.value.filter(isSelectableRow)
  const isCurrentPageFullSelected =
    selection.length > 0 && selection.length === selectableRows.length

  // 如果全选了已加载数据，且还有未加载数据，且不在全选模式，提示是否全选全部
  if (isCurrentPageFullSelected && list.value.length < pagination.total && !selectAllMode.value) {
    // 显示提示：是否要全选所有页？
    showSelectAllPagesPrompt()
  } else if (selection.length === 0) {
    // 取消全选
    selectAllMode.value = false
  }
}

// 显示全选所有页的确认提示
function showSelectAllPagesPrompt() {
  ElMessageBox.confirm(
    `已加载部分已全选，是否要全选所有 ${pagination.total} 条凭证（含未加载数据）？`,
    '全选确认',
    {
      confirmButtonText: '全选所有',
      cancelButtonText: '仅已加载',
      type: 'info',
    }
  )
    .then(() => {
      // 用户确认全选所有
      selectAllMode.value = true
      ElMessage.success(`已选中全部 ${pagination.total} 条凭证（含未加载数据）`)
    })
    .catch(() => {
      // 用户取消，保持当前页全选
      selectAllMode.value = false
    })
}

const systemParamsStore = useSystemParamsStore()

const entryDialogHostRef = ref<InstanceType<typeof VoucherEntryDialogHost> | null>(null)
const { tryRestoreVoucherModal } = useVoucherModalRestore(entryDialogHostRef)

function openEntryDialog(row: any) {
  entryDialogHostRef.value?.open(row)
}

const {
  batchPosting,
  batchUnauditing,
  audit,
  unAudit,
  post,
  unPost,
  batchAudit,
  batchUnAudit,
  batchPost,
  batchUnpost,
} = useVoucherAuditActions(fetchData)

const {
  batchAuditVisible,
  batchAuditing,
  batchAuditPreviewing,
  batchAuditPreviewCount,
  batchAuditPreviewFirstVoucherNo,
  batchAuditPreviewLastVoucherNo,
  batchAuditPreviewBlockedVoucherNo,
  batchAuditForm,
  handleBatchAuditPreview,
  handleBatchAudit,
} = useBatchAuditDialog(fetchData)

// 转模版相关
const templateDialogVisible = ref(false)
const templateForm = ref({
  template_no: '',
  template_name: '',
})
const templateSaving = ref(false)

function handleTurnTemplate() {
  if (!selected.value.length || selected.value.length > 1) {
    ElMessage.warning('请先勾选一张凭证')
    return
  }
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
      voucher_id: getRowVoucherId(selected.value[0]),
    })
    ElMessage.success('模版保存成功')
    templateDialogVisible.value = false
  } catch (error: any) {
    ElMessage.error(error.response?.data?.message || '保存失败')
  } finally {
    templateSaving.value = false
  }
}

async function handleBatchAuditPreviewWithPermission() {
  if (batchAuditForm.value.operation === 'unpost' && !canUnpostVoucher.value) {
    ElMessage.warning('当前用户没有凭证反记账权限')
    batchAuditForm.value.operation = 'audit'
    return
  }

  await handleBatchAuditPreview()
}

async function handleBatchUnAudit() {
  if (selectAllMode.value) {
    // 全选模式：二次确认
    try {
      await ElMessageBox.confirm(
        `即将批量反审核 ${pagination.total} 条凭证，此操作不可撤销，是否继续？`,
        '批量反审核确认',
        {
          confirmButtonText: '确认反审核',
          cancelButtonText: '取消',
          type: 'warning',
        }
      )

      // 用户确认后，调用异步 API
      const params: any = {}
      if (filters.value.dateRange?.length === 2) {
        params.dateRange = filters.value.dateRange
      }
      if (filters.value.voucherTypeIds?.length > 0) {
        params.voucher_type_ids = filters.value.voucherTypeIds
      }

      const res = await request.post('/voucher/vouchers/batch-unaudit-async', params)
      currentTaskId.value = (res.data as any).taskId
      currentTaskType.value = 'batch-unaudit'
      taskProgressVisible.value = true
    } catch (error: any) {
      if (error === 'cancel') {
        // 用户取消操作
        return
      }
      ElMessage.error(extractErrorMessage(error,'创建批量反审核任务失败'))
    }
  } else {
    // 当前页模式：直接操作
    if (selected.value.length === 0) {
      ElMessage.warning('请先选择要反审核的凭证')
      return
    }
    try {
      await batchUnAudit(selected.value)
    } finally {
      selected.value = []
    }
  }

  // 注意：不清空 selectAllMode，让用户可以继续进行其他批量操作
  // 用户可以通过点击表头取消全选来退出全选模式
}

async function handleBatchPost() {
  if (selectAllMode.value) {
    // 全选模式：二次确认
    try {
      await ElMessageBox.confirm(
        `即将批量记账 ${pagination.total} 条凭证，此操作不可撤销，是否继续？`,
        '批量记账确认',
        {
          confirmButtonText: '确认记账',
          cancelButtonText: '取消',
          type: 'warning',
        }
      )

      // 用户确认后，调用异步 API
      const params: any = {}
      if (filters.value.dateRange?.length === 2) {
        params.dateRange = filters.value.dateRange
      }
      if (filters.value.voucherTypeIds?.length > 0) {
        params.voucher_type_ids = filters.value.voucherTypeIds
      }

      const res = await request.post('/voucher/vouchers/batch-post-async', params)
      currentTaskId.value = (res.data as any).taskId
      currentTaskType.value = 'batch-post'
      taskProgressVisible.value = true
    } catch (error: any) {
      if (error === 'cancel') {
        // 用户取消操作
        return
      }
      ElMessage.error(extractErrorMessage(error,'创建批量记账任务失败'))
    }
  } else {
    // 当前页模式：直接操作
    if (selected.value.length === 0) {
      ElMessage.warning('请先选择要记账的凭证')
      return
    }
    try {
      await batchPost(selected.value)
    } finally {
      selected.value = []
    }
  }

  // 注意：不清空 selectAllMode，让用户可以继续进行其他批量操作
  // 用户可以通过点击表头取消全选来退出全选模式
}

async function handleBatchUnpost() {
  if (!canUnpostVoucher.value) {
    ElMessage.warning('当前用户没有凭证反记账权限')
    return
  }

  if (selectAllMode.value) {
    // 全选模式：二次确认
    try {
      await ElMessageBox.confirm(
        `即将批量反记账 ${pagination.total} 条凭证，此操作不可撤销，是否继续？`,
        '批量反记账确认',
        {
          confirmButtonText: '确认反记账',
          cancelButtonText: '取消',
          type: 'warning',
        }
      )

      // 用户确认后，调用异步 API
      const params: any = {}
      if (filters.value.dateRange?.length === 2) {
        params.dateRange = filters.value.dateRange
      }
      if (filters.value.voucherTypeIds?.length > 0) {
        params.voucher_type_ids = filters.value.voucherTypeIds
      }

      const res = await request.post('/voucher/vouchers/batch-unpost-async', params)
      currentTaskId.value = (res.data as any).taskId
      currentTaskType.value = 'batch-unpost'
      taskProgressVisible.value = true
    } catch (error: any) {
      if (error === 'cancel') {
        // 用户取消操作
        return
      }
      ElMessage.error(extractErrorMessage(error,'创建批量反记账任务失败'))
    }
  } else {
    // 当前页模式：直接操作
    if (selected.value.length === 0) {
      ElMessage.warning('请先选择要反记账的凭证')
      return
    }
    try {
      await batchUnpost(selected.value)
    } finally {
      selected.value = []
    }
  }

  // 注意：不清空 selectAllMode，让用户可以继续进行其他批量操作
  // 用户可以通过点击表头取消全选来退出全选模式
}

const printDialogVisible = ref(false)
const printVoucherIds = ref<Array<string | number>>([])
const printMode = ref<'single' | 'batch'>('batch')
const batchPrintVisible = ref(false)
const exporting = ref(false)

// 任务进度对话框
const taskProgressVisible = ref(false)
const currentTaskId = ref('')
const currentTaskType = ref<'batch-audit' | 'batch-unaudit' | 'batch-post' | 'batch-unpost'>(
  'batch-audit'
)


function getRowVoucherId(row: { _voucherId?: string; id?: string }) {
  return row._voucherId || row.id || ''
}

function handlePrint() {
  if (!selected.value.length) return
  printVoucherIds.value = [
    ...new Set(selected.value.map((v: any) => getRowVoucherId(v)).filter(Boolean)),
  ]
  printMode.value = selected.value.length === 1 ? 'single' : 'batch'
  printDialogVisible.value = true
}

async function exportData() {
  exporting.value = true
  try {
    const vouchers = await fetchAllVouchers(buildQueryParams())
    await exportVouchersToExcel(vouchers, {
      sheetName: '凭证管理',
      filePrefix: '凭证管理',
    })
    ElMessage.success(`已导出 ${vouchers.length} 张凭证`)
  } catch (error: any) {
    ElMessage.error(error.response?.data?.message || error.message || '导出失败')
  } finally {
    exporting.value = false
  }
}

async function handleSelectedBatchAudit() {
  if (selectAllMode.value) {
    // 全选模式：二次确认
    try {
      await ElMessageBox.confirm(
        `即将批量审核 ${pagination.total} 条凭证，此操作不可撤销，是否继续？`,
        '批量审核确认',
        {
          confirmButtonText: '确认审核',
          cancelButtonText: '取消',
          type: 'warning',
        }
      )

      // 用户确认后，调用异步 API
      const params: any = {}
      if (filters.value.dateRange?.length === 2) {
        params.dateRange = filters.value.dateRange
      }
      if (filters.value.voucherTypeIds?.length > 0) {
        params.voucher_type_ids = filters.value.voucherTypeIds
      }
      // 注意：不传递 status 参数，让后端根据操作类型自动设置正确的状态

      const res = await request.post('/voucher/vouchers/batch-audit-async', params)
      currentTaskId.value = (res.data as any).taskId
      currentTaskType.value = 'batch-audit'
      taskProgressVisible.value = true
    } catch (error: any) {
      if (error === 'cancel') {
        // 用户取消操作
        return
      }
      ElMessage.error(extractErrorMessage(error,'创建批量审核任务失败'))
    }
  } else {
    // 当前页模式：直接操作
    if (selected.value.length === 0) {
      ElMessage.warning('请先选择要审核的凭证')
      return
    }
    try {
      await batchAudit(selected.value)
    } finally {
      // 成功或失败后都清空选中，避免表格残留旧勾选导致下次批量提交混入无效凭证
      selected.value = []
    }
  }

  // 注意：不清空 selectAllMode，让用户可以继续进行其他批量操作
  // 用户可以通过点击表头取消全选来退出全选模式
}

// 任务完成后的回调
function handleTaskCompleted() {
  // 刷新数据
  fetchData()
}

async function handleBatchAuditConfirm() {
  if (batchAuditForm.value.operation === 'unpost' && !canUnpostVoucher.value) {
    ElMessage.warning('当前用户没有凭证反记账权限')
    batchAuditForm.value.operation = 'audit'
    return
  }

  const [start_date, end_date] = batchAuditForm.value.dateRange || []
  const hasFilterCondition =
    Boolean(start_date) &&
    Boolean(end_date) &&
    Boolean(batchAuditForm.value.voucher_type_ids?.length)

  if (!hasFilterCondition && selected.value.length > 0) {
    try {
      await batchAudit(selected.value)
    } finally {
      selected.value = []
    }
    batchAuditVisible.value = false
    return
  }

  await handleBatchAudit()
}

/** 已勾选的凭证张数（selected 为分录行，按凭证去重） */
const selectedVoucherCount = computed(
  () => new Set(selected.value.map((row: any) => getRowVoucherId(row)).filter(Boolean)).size
)

const hasBatchTarget = computed(() => selected.value.length > 0 || selectAllMode.value)
const batchHint = computed(() => (selectAllMode.value ? `（全部 ${pagination.total} 条）` : ''))

function handleViewSelected() {
  if (selectedVoucherCount.value !== 1) {
    ElMessage.warning('请先勾选一张凭证')
    return
  }
  openEntryDialog(selected.value[0])
}

function handleReturn() {
  if (window.history.length > 1) {
    router.back()
  } else {
    router.push('/group/财务总账')
  }
}

// 顶部功能工具栏下拉组：审核 / 打印为分体按钮（主体直接执行第一项），其余低频操作收进「更多」
const glToolbarGroups: Record<string, GlToolbarGroup> = {
  audit: { label: '审核', split: true },
  print: { label: '打印', split: true },
  more: { label: '更多', icon: MoreHorizontal },
}

// 顶部功能工具栏（批量操作全部放到这里；group 决定收进哪个下拉）
const glToolbarButtons = computed<GlToolbarButton[]>(() => [
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
    tooltip: '查看勾选的凭证',
    disabled: selectedVoucherCount.value !== 1,
    action: handleViewSelected,
  },
  {
    key: 'batch-audit',
    group: 'audit',
    name: '批审核',
    icon: CheckCheck,
    tooltip: `批量审核勾选的凭证${batchHint.value}`,
    tone: 'forward',
    disabled: !hasBatchTarget.value,
    action: handleSelectedBatchAudit,
  },
  {
    key: 'batch-post',
    group: 'audit',
    name: '批记账',
    icon: BookCheck,
    tooltip: `批量记账勾选的凭证${batchHint.value}`,
    tone: 'forward',
    disabled: !hasBatchTarget.value || batchPosting.value,
    action: handleBatchPost,
  },
  {
    key: 'batch-unaudit',
    group: 'audit',
    name: '批反审',
    icon: FileX,
    tooltip: `批量反审核勾选的凭证${batchHint.value}`,
    tone: 'reverse',
    disabled: !hasBatchTarget.value || batchUnauditing.value,
    action: handleBatchUnAudit,
  },
  {
    key: 'batch-unpost',
    group: 'audit',
    name: '批反记账',
    icon: BookX,
    tooltip: canUnpostVoucher.value
      ? `批量反记账勾选的凭证${batchHint.value}`
      : '当前用户没有凭证反记账权限',
    tone: 'reverse',
    disabled: !hasBatchTarget.value || !canUnpostVoucher.value,
    action: handleBatchUnpost,
  },
  {
    key: 'batch-ops',
    group: 'audit',
    name: '批操作',
    icon: ListChecks,
    tooltip: '按日期 / 类型范围批量审核、记账（Ctrl+E）',
    action: () => (batchAuditVisible.value = true),
  },
  {
    key: 'print',
    group: 'print',
    name: '打印',
    icon: Printer,
    tooltip: '打印勾选的凭证',
    disabled: !selected.value.length,
    action: handlePrint,
  },
  {
    key: 'batch-print',
    group: 'print',
    name: '连打',
    icon: Layers,
    tooltip: '连续打印（批量打印）',
    action: () => (batchPrintVisible.value = true),
  },
  {
    key: 'entry',
    name: '录入',
    icon: FilePen,
    tooltip: '跳转凭证录入',
    action: () => router.push('/voucher/entry'),
  },
  {
    key: 'reverse',
    group: 'more',
    name: '反冲',
    icon: Undo2,
    tooltip: reverseTooltip.value || '凭证红字冲销',
    tone: 'reverse',
    disabled: !canReverseSelected.value,
    action: handleReverse,
  },
  {
    key: 'turn-template',
    group: 'more',
    name: '转出',
    icon: ExternalLink,
    tooltip: '保存为凭证模版',
    disabled: selectedVoucherCount.value !== 1,
    action: handleTurnTemplate,
  },
  {
    key: 'save',
    // 第五份反馈：客户找不到「另存」（原收在「更多」里），提到工具栏常驻
    name: '另存',
    icon: Download,
    tooltip: '导出为 Excel 文件',
    disabled: exporting.value,
    action: exportData,
  },
  {
    key: 'columns',
    group: 'more',
    name: '列设置',
    icon: Settings2,
    tooltip: '设置显示列',
    action: () => (columnDialogVisible.value = true),
  },
  {
    key: 'return',
    name: '返回',
    icon: ArrowLeft,
    tooltip: '返回',
    action: handleReturn,
  },
])

async function handlePageSizeChange(size: number) {
  if (size === -1) {
    if (pagination.total > VOUCHER_LIST_SOFT_CAP) {
      try {
        await ElMessageBox.confirm(
          `当前共 ${pagination.total} 条记录，一次加载进表格会明显卡顿（建议阈值约 ${VOUCHER_LIST_SOFT_CAP} 行分录）。请改用「另存」导出，或缩小筛选范围。是否仍要加载全部？`,
          '加载全部',
          { type: 'warning', confirmButtonText: '继续加载', cancelButtonText: '取消' }
        )
      } catch {
        pagination.pageSize = 20
        return
      }
    } else if (pagination.total > 500) {
      try {
        await ElMessageBox.confirm(
          `当前共 ${pagination.total} 条记录，加载全部可能较慢，建议使用导出功能处理大量数据。是否继续？`,
          '加载全部',
          { type: 'warning', confirmButtonText: '继续加载', cancelButtonText: '取消' }
        )
      } catch {
        pagination.pageSize = 20
        return
      }
    }
  }
  onPageSizeChange(size)
  await scrollToTop()
}

async function tryRestoreVoucherAuditContext() {
  if (route.query.restoreAudit !== '1') return

  const state = voucherAuditReturnStore.consumeRestore()
  if (!state) {
    await router.replace({ name: 'VoucherAudit' })
    return
  }

  Object.assign(filters.value, state.filters)
  selectAllMode.value = state.selectAllMode
  selectionRestoreActive.value = true
  selectionRestoreIds.value = state.selectAllMode ? null : [...state.selectedVoucherIds]

  await router.replace({ name: 'VoucherAudit' })
  // 滚动加载下，一次性把离开前已加载的所有行还原回来
  await loadUpTo(state.pagination.page, state.pagination.pageSize)
  applySelectionRestore()
}

/**
 * 财务总账工作页面以 ?status=draft / audited 进入时，预设状态筛选：
 * 「凭证审核」看待审核（只录入），「凭证过账」看待记账（已审核）。
 * 覆盖搜索记忆恢复出来的旧状态，但不动其他条件。
 */
const ROUTE_STATUS_PRESETS = new Set(['draft', 'audited', 'posted'])
function applyRouteStatusPreset() {
  const status = String(route.query.status || '')
  if (!ROUTE_STATUS_PRESETS.has(status)) return
  filters.value.status = status
  pagination.page = 1
}

async function bootstrapAuditPage() {
  restoreVisibleCols()
  await Promise.all([loadVoucherTypes(), systemParamsStore.load(), loadAuxCategories()])
  registerAuditReturnCapture()

  if (route.query.restoreAudit === '1') {
    await tryRestoreVoucherAuditContext()
    return
  }

  applyRouteStatusPreset()
  await fetchData()
  await tryRestoreVoucherModal()
}

function registerAuditReturnCapture() {
  voucherAuditReturnStore.registerCapture(() => ({
    filters: JSON.parse(JSON.stringify(filters.value)),
    pagination: { page: pagination.page, pageSize: pagination.pageSize },
    selectedVoucherIds: selected.value
      .map((row: any) => row._voucherId || row.id)
      .filter(Boolean),
    selectAllMode: selectAllMode.value,
    targetYear: filters.value.year,
  }))
}

onMounted(async () => {
  await bootstrapAuditPage()
})

onActivated(async () => {
  reloadColumnWidths()
  registerAuditReturnCapture()

  if (route.query.restoreAudit === '1') {
    await tryRestoreVoucherAuditContext()
    return
  }

  await Promise.all([loadVoucherTypes(), systemParamsStore.load(), loadAuxCategories()])
  applyRouteStatusPreset()
  await fetchData()
  await tryRestoreVoucherModal()
})

onBeforeUnmount(() => {
  voucherAuditReturnStore.unregisterCapture()
})

useKeyboardShortcuts([
  {
    key: 'e',
    ctrl: true,
    handler: () => {
      batchAuditVisible.value = true
    },
    description: 'Ctrl+E 批量操作',
  },
  { key: 'd', ctrl: true, handler: () => handleBatchUnpost(), description: 'Ctrl+D 批量反记账' },
])
</script>

