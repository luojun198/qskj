<template>
  <div
    v-loading="pageLoading"
    class="page voucher-list-page"
    element-loading-text="加载凭证类型、科目等数据中..."
  >
    <div class="page-header">
      <div class="page-header-title-row">
        <h3>凭证录入</h3>
        <DrillDownReturnButton />
      </div>
      <div class="voucher-toolbar">
        <div class="voucher-toolbar-group voucher-toolbar-group--primary">
          <el-button
            type="primary"
            class="voucher-toolbar-btn voucher-toolbar-btn--hero"
            @click="openVoucherDialog()"
          >
            <el-icon><Plus /></el-icon>
            新增凭证
          </el-button>
        </div>

        <div class="voucher-toolbar-group voucher-toolbar-group--create">
          <span class="voucher-toolbar-group-label">录入</span>
          <el-button
            class="voucher-toolbar-btn"
            plain
            :disabled="!selectedDraftId"
            @click="handleCopyDraft"
          >
            <el-icon><DocumentCopy /></el-icon>复制
          </el-button>
          <el-button class="voucher-toolbar-btn" plain @click="handleImportDraft">
            <el-icon><Upload /></el-icon>引入
          </el-button>
          <el-button
            class="voucher-toolbar-btn"
            plain
            :disabled="!selectedDraftId"
            @click="handleInsertDraft"
          >
            <el-icon><Bottom /></el-icon>插行
          </el-button>
        </div>

        <div class="voucher-toolbar-group voucher-toolbar-group--template">
          <span class="voucher-toolbar-group-label">模版</span>
          <el-button
            class="voucher-toolbar-btn"
            plain
            :disabled="!selectedDraftId"
            @click="handleTurnTemplate"
          >
            <el-icon><Collection /></el-icon>转模版
          </el-button>
          <el-button class="voucher-toolbar-btn" plain @click="handleImportTemplate">
            <el-icon><Document /></el-icon>引模版
          </el-button>
        </div>

        <div class="voucher-toolbar-group voucher-toolbar-group--edit">
          <span class="voucher-toolbar-group-label">维护</span>
          <el-button
            class="voucher-toolbar-btn"
            type="warning"
            plain
            :disabled="!selectedDraftId"
            @click="handleEditDraft"
          >
            <el-icon><Edit /></el-icon>编辑
          </el-button>
          <el-button
            class="voucher-toolbar-btn"
            type="danger"
            plain
            :disabled="!selectedDraftId"
            @click="handleDeleteDraftSelected"
          >
            <el-icon><Delete /></el-icon>删除
          </el-button>
        </div>

        <div class="voucher-toolbar-group voucher-toolbar-group--print">
          <span class="voucher-toolbar-group-label">输出</span>
          <el-button
            class="voucher-toolbar-btn"
            plain
            :disabled="!selectedDraftId"
            @click="handlePrint"
          >
            <el-icon><Printer /></el-icon>打印
          </el-button>
          <el-button
            class="voucher-toolbar-btn"
            plain
            :disabled="!selectedDraftId"
            @click="handleHiprint"
          >
            <el-icon><Printer /></el-icon>套打
          </el-button>
          <el-button class="voucher-toolbar-btn" plain @click="handleBatchPrint">
            <el-icon><Printer /></el-icon>批量打印
          </el-button>
          <el-button
            class="voucher-toolbar-btn"
            type="success"
            plain
            :loading="exporting"
            @click="exportDraftData"
          >
            <el-icon><Download /></el-icon>导出
          </el-button>
        </div>

        <div class="voucher-toolbar-group voucher-toolbar-group--tools">
          <span class="voucher-toolbar-group-label">工具</span>
          <el-button class="voucher-toolbar-btn" plain @click="renumberDialogVisible = true">
            <el-icon><Sort /></el-icon>重新排号
          </el-button>
          <el-button
            class="voucher-toolbar-btn"
            type="danger"
            plain
            @click="batchDeleteVisible = true"
          >
            <el-icon><Delete /></el-icon>批量删除
          </el-button>
        </div>
      </div>
    </div>

    <VoucherDraftList
      ref="draftListRef"
      class="voucher-list-main"
      :vouchers="sortedVouchers"
      :loading="draftLoading"
      :sort-config="sortConfig"
      :aux-categories="auxCategories"
      :voucher-types="voucherTypes"
      :accounts="accounts"
      :pagination="draftPagination"
      :selected-voucher-id="selectedDraftId"
      @refresh="fetchDraftVouchers"
      @edit="handleEdit"
      @delete="handleDeleteDraft"
      @sort-change="handleSortChange"
      @row-click="handleDraftRowClick"
      @row-dblclick="handleDraftDblclick"
      @page-change="handlePageChange"
      @filter-change="handleFilterChange"
      @load-accounts="loadAccounts"
    />

    <VoucherBatchDelete
      v-model="batchDeleteVisible"
      :voucher-types="voucherTypes"
      @success="fetchDraftVouchers"
    />

    <PrintDialog
      v-model="printDialogVisible"
      :voucher-ids="printVoucherIds"
      mode="single"
      :auto-print="directPrint"
    />

    <VoucherHiprintDialog
      v-model="hiprintVisible"
      :voucher-ids="printVoucherIds"
      mode="single"
    />

    <BatchPrintDialog
      v-model="batchPrintVisible"
      :default-date-range="batchPrintDateRange"
      :default-voucher-type-ids="batchPrintVoucherTypeIds"
    />

    <!-- 重新排号对话框 -->
    <el-dialog v-model="renumberDialogVisible" title="重新排号" width="500px">
      <el-form label-width="100px">
        <el-form-item label="年份">
          <el-input-number v-model="renumberForm.year" :min="2000" :max="2100" />
        </el-form-item>
        <el-form-item label="期间">
          <el-input-number v-model="renumberForm.period" :min="1" :max="12" />
        </el-form-item>
        <el-form-item label="凭证类型">
          <el-select
            v-model="renumberForm.voucher_type_id"
            clearable
            placeholder="全部类型"
            style="width: 100%"
          >
            <el-option
              v-for="type in voucherTypes"
              :key="type.id"
              :label="type.name"
              :value="type.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="起始编号">
          <el-input-number v-model="renumberForm.start_no" :min="1" />
        </el-form-item>
        <el-alert title="提示" type="warning" :closable="false" show-icon style="margin-top: 12px">
          <template #default>
            <div style="font-size: 13px; line-height: 1.6">
              <p style="margin: 0 0 8px 0">重新排号将按日期和创建时间顺序重新分配凭证编号</p>
              <p style="margin: 0">• 选择凭证类型：只对该类型的凭证重新排号</p>
              <p style="margin: 0">• 不选凭证类型：对所有类型的凭证统一排号</p>
            </div>
          </template>
        </el-alert>
      </el-form>
      <template #footer>
        <el-button @click="renumberDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="handleRenumber">确定</el-button>
      </template>
    </el-dialog>

    <!-- 引入新增对话框 -->
    <el-dialog v-model="importDialogVisible" title="引入新增" width="500px">
      <el-form label-width="100px">
        <el-form-item label="凭证类型" required>
          <el-select
            v-model="importForm.voucher_type_id"
            placeholder="请选择凭证类型"
            style="width: 100%"
          >
            <el-option
              v-for="type in voucherTypes"
              :key="type.id"
              :label="type.name"
              :value="type.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="年份" required>
          <el-input-number v-model="importForm.year" :min="2000" :max="2100" style="width: 100%" />
        </el-form-item>
        <el-form-item label="期间" required>
          <el-input-number v-model="importForm.period" :min="1" :max="12" style="width: 100%" />
        </el-form-item>
        <el-form-item label="凭证号" required>
          <el-input v-model="importForm.voucher_no" placeholder="请输入凭证号" />
        </el-form-item>
        <el-alert title="提示" type="info" :closable="false" show-icon style="margin-top: 12px">
          <div style="font-size: 13px; line-height: 1.6">
            <p style="margin: 0">根据凭证类型、年月、凭证号定位历史凭证，复制其内容作为新凭证</p>
          </div>
        </el-alert>
      </el-form>
      <template #footer>
        <el-button @click="importDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="handleImportConfirm">确定</el-button>
      </template>
    </el-dialog>

    <!-- 引模版对话框 -->
    <el-dialog v-model="selectTemplateDialogVisible" title="选择凭证模版" width="900px">
      <div style="margin-bottom: 12px">
        <el-input
          v-model="templateSearchKeyword"
          placeholder="搜索模版编号、说明..."
          clearable
          style="width: 300px"
          prefix-icon="Search"
        />
      </div>
      <el-table
        v-loading="templateListLoading"
        :data="filteredTemplateList"
        border
        size="small"
        class="compact-data-table"
        empty-text="暂无凭证模版"
        highlight-current-row
        @row-dblclick="handleSelectTemplate"
      >
        <el-table-column prop="template_no" label="模版编号" width="120" />
        <el-table-column prop="template_name" label="模版说明" min-width="200" />
        <el-table-column prop="voucher_type_name" label="凭证类型" width="120" />
        <el-table-column prop="entries_count" label="分录数量" width="100" align="center" />
        <el-table-column prop="created_at" label="创建时间" width="180">
          <template #default="{ row }">
            {{ formatDateTime(row.created_at) }}
          </template>
        </el-table-column>
      </el-table>
      <template #footer>
        <el-button @click="selectTemplateDialogVisible = false">取消</el-button>
      </template>
    </el-dialog>

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
        <el-button type="primary" @click="handleTemplateConfirm">确定</el-button>
      </template>
    </el-dialog>

    <VoucherEntryForm
      v-model="dialogVisible"
      :mode="dialogMode"
      :form="form"
      :current-entry="currentEntry"
      :voucher-types="voucherTypes"
      :accounts="accounts"
      :aux-categories="auxCategories"
      :total-debit="totalDebit"
      :total-credit="totalCredit"
      :is-balanced="isBalanced"
      :current-entry-aux-categories="currentEntryAuxCategories"
      :is-parent-account="isParentAccount"
      :enable-cash-flow="enableCashFlow"
      :cash-flow-items="cashFlowItems"
      :get-aux-item-names="getAuxItemNames"
      :get-aux-options="voucherAux.getAuxOptions"
      :is-aux-select-loading="isAuxSelectLoading"
      :search-aux-items="voucherAux.searchAuxItems"
      :on-aux-dropdown-open="voucherAux.onDropdownOpen"
      :resolve-aux-item-name="voucherAux.resolveAuxItemName"
      :fetch-next-aux-code="voucherAux.fetchNextAuxCode"
      :ensure-selected-for-entry="ensureAuxSelectedForEntry"
      :on-account-change="onAccountChange"
      :on-amount-change="onAmountChange"
      :add-entry="addEntry"
      :remove-entry="removeEntry"
      :set-current-entry="setCurrentEntry"
      :attachments="attachments"
      :update-attachments="updateAttachments"
      :submit-loading="submitLoading"
      :navigation-info="navigationInfo"
      :account-set-start-date="accountSetStartDate"
      :duplicate-warnings="duplicateWarnings"
      @queue-upload="queuePendingUploads"
      @remove-queued-upload="removeQueuedUpload"
      @ai-summary="handleAiSummary"
      @submit="handleSubmit"
      @submit-and-add="handleSubmitAndAdd"
      @navigate="handleNavigate"
      @clear-current-entry="handleClearCurrentEntry"
      @add-aux-item="handleAddAuxItem"
      @quick-create-account="handleQuickCreateAccount"
      @print="handlePrintCurrent"
      @turn-template="handleTurnTemplateInDialog"
      @import-template="handleImportTemplateInDialog"
    />

    <AccountDialog
      v-model="quickAddAccountVisible"
      mode="add"
      title="快速新增科目"
      :form="accountForm"
      :parent-usage="parentUsage"
      :tree-select-data="treeSelectData"
      :get-available-cats="getAvailableCats"
      :get-aux-options="quickAccountAuxSelect.getAuxOptions"
      :search-aux-items="quickAccountAuxSelect.searchAuxItems"
      :on-aux-dropdown-open="quickAccountAuxSelect.onDropdownOpen"
      :is-aux-select-loading="isQuickAccountAuxSelectLoading"
      :on-aux-cat-change="handleQuickAuxCatChange"
      :add-aux="addAux"
      :remove-aux="removeAux"
      :saving="quickAccountSaving"
      @parent-change="handleQuickParentChange"
      @save="saveQuickAccount"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onActivated, nextTick } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessageBox } from 'element-plus'
import {
  Printer,
  Plus,
  Edit,
  Delete,
  Download,
  DocumentCopy,
  Upload,
  Bottom,
  Collection,
  Document,
  Sort,
} from '@element-plus/icons-vue'
import dayjs from 'dayjs'
import request from '@/api/request'
import { getCashFlowItems } from '@/api/cashFlow'
import VoucherDraftList from '@/components/voucher/VoucherDraftList.vue'
import VoucherBatchDelete from '@/components/voucher/VoucherBatchDelete.vue'
import VoucherEntryForm from '@/components/voucher/VoucherEntryForm.vue'
import DrillDownReturnButton from '@/components/common/DrillDownReturnButton.vue'
import AccountDialog from '@/components/base/AccountDialog.vue'
import PrintDialog from '@/components/print/PrintDialog.vue'
import BatchPrintDialog from '@/components/print/BatchPrintDialog.vue'
import VoucherHiprintDialog from '@/components/print/VoucherHiprintDialog.vue'
import { useVoucherForm } from '@/composables/useVoucherForm'
import { useAuxiliaryAccounting } from '@/composables/useAuxiliaryAccounting'
import { useVoucherAuxItems } from '@/composables/useVoucherAuxItems'
import { useAccountForm, createFlatAuxLookupRefs } from '@/composables/useAccountForm'
import { useAccountTree } from '@/composables/useAccountTree'
import {
  showSuccess,
  showError,
  showWarning,
  showOperationError,
  extractErrorMessage,
  isNoNegativeBalanceMessage,
  showNoNegativeBalanceAlert,
} from '@/composables/useMessage'
import { useDeleteConfirm } from '@/composables/useConfirm'
import { useKeyboardShortcuts, commonShortcuts } from '@/composables/useKeyboardShortcuts'
import { useOperationHistory } from '@/composables/useOperationHistory'
import { performanceMonitor } from '@/utils/performanceMonitor'
import { compareVoucherTypeCode } from '@/utils/voucherTypeSort'
import { exportVouchersToExcel, fetchAllVouchers } from '@/utils/voucherExport'
import { useSystemParamsStore } from '@/stores/systemParams'
import { useUserStore } from '@/stores/user'
import { accountNeedsCashFlowItem } from '@/utils/accountCashFlow'
import { useBaseDataStore } from '@/stores/baseData'
import { buildEntryKey, useVoucherModalReturnStore } from '@/stores/voucherModalReturn'
import { useVoucherModalRestore } from '@/composables/useVoucherModalRestore'

const baseDataStore = useBaseDataStore()
const voucherTypes = computed(() => baseDataStore.voucherTypes)
const accounts = computed(() => baseDataStore.accounts)
const auxCategories = computed(() => baseDataStore.auxCategories)
const auxItems = computed(() => baseDataStore.auxItems)
const attachments = ref<any[]>([])
const queuedUploads = ref<Record<string, File>>({})
const draftVouchers = ref<any[]>([])
const draftLoading = ref(false)
const draftPagination = ref({
  page: 1,
  pageSize: 50,
  total: 0,
})
const pageLoading = ref(false)
const submitLoading = ref(false)
const batchDeleteVisible = ref(false)
const printDialogVisible = ref(false)
const hiprintVisible = ref(false)
const printVoucherIds = ref<Array<string | number>>([])

// 获取当月日期范围
function getCurrentMonthRange() {
  const today = new Date()
  const year = today.getFullYear()
  const month = today.getMonth()
  const startDate = `${year}-${String(month + 1).padStart(2, '0')}-01`
  const lastDay = new Date(year, month + 1, 0).getDate()
  const endDate = `${year}-${String(month + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
  return [startDate, endDate]
}

const draftFilters = ref({
  keyword: '',
  dateRange: getCurrentMonthRange(),
  voucherTypeIds: [],
  accountIds: [],
  minAmount: '',
  maxAmount: '',
})
const systemParamsStore = useSystemParamsStore()
const userStore = useUserStore()
const directPrint = computed(() => systemParamsStore.directPrint)
const enableCashFlow = computed(() => systemParamsStore.enableCashFlow)
const cashFlowItems = ref<Array<{ code: string; name: string }>>([])
const accountSetStartDate = ref('')
const batchPrintVisible = ref(false)
const batchPrintDateRange = ref<string[]>([])
const batchPrintVoucherTypeIds = ref<string[]>([])
const exporting = ref(false)

function handleBatchPrint() {
  // 从当前页面显示的凭证中提取日期范围和凭证类型
  const vouchers = sortedVouchers.value
  if (vouchers.length > 0) {
    // 提取日期范围：取所有凭证的最小/最大日期
    const dates = vouchers
      .map((v: any) => v.voucher_date || v.date)
      .filter(Boolean)
      .sort()
    if (dates.length >= 2) {
      batchPrintDateRange.value = [dates[0], dates[dates.length - 1]]
    } else if (dates.length === 1) {
      batchPrintDateRange.value = [dates[0], dates[0]]
    } else {
      batchPrintDateRange.value = []
    }
    // 提取凭证类型ID：取页面上所有出现的凭证类型
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

async function exportDraftData() {
  exporting.value = true
  try {
    const vouchers = await fetchAllVouchers({
      status: 'draft',
      sortField: sortConfig.value.field,
      sortOrder: sortConfig.value.order,
    })
    await exportVouchersToExcel(vouchers, {
      sheetName: '凭证录入',
      filePrefix: '凭证录入_未审核凭证',
    })
    showSuccess(`已导出 ${vouchers.length} 张未审核凭证`)
  } catch (error) {
    showOperationError('导出', error)
  } finally {
    exporting.value = false
  }
}
const draftListRef = ref<any>(null)
const selectedDraftId = ref<string>('')

function handleDraftRowClick(row: any) {
  // 点击行切换选中
  if (selectedDraftId.value === row._voucherId) {
    selectedDraftId.value = ''
  } else {
    selectedDraftId.value = row._voucherId
  }
}

function handleDraftDblclick(row: any) {
  // 双击直接打开编辑
  const voucher = sortedVouchers.value.find((v: any) => v.id === row._voucherId)
  if (voucher) handleEdit(voucher)
}

function handleEditDraft() {
  if (!selectedDraftId.value) return
  const row = sortedVouchers.value.find((v: any) => v.id === selectedDraftId.value)
  if (row) handleEdit(row)
}

function handleDeleteDraftSelected() {
  if (!selectedDraftId.value) return
  const row = sortedVouchers.value.find((v: any) => v.id === selectedDraftId.value)
  if (row) handleDeleteDraft(row)
}

function handlePrint() {
  if (!selectedDraftId.value) return
  const row = sortedVouchers.value.find((v: any) => v.id === selectedDraftId.value)
  if (row && row.id) {
    printVoucherIds.value = [row.id]
    printDialogVisible.value = true
  }
}

// hiprint 套打（可视化模板 + 底图）
function handleHiprint() {
  if (!selectedDraftId.value) return
  const row = sortedVouchers.value.find((v: any) => v.id === selectedDraftId.value)
  if (row && row.id) {
    printVoucherIds.value = [row.id]
    hiprintVisible.value = true
  }
}

// 在编辑对话框内打印当前凭证
function handlePrintCurrent() {
  if (form.value.id) {
    printVoucherIds.value = [form.value.id]
    printDialogVisible.value = true
  }
}

async function handleInsertDraft() {
  if (!selectedDraftId.value) return
  const targetVoucher = sortedVouchers.value.find((v: any) => v.id === selectedDraftId.value)
  if (!targetVoucher) return

  // 直接设置插入模式，不走 openVoucherDialog（避免 resetForm 覆盖）
  dialogMode.value = 'insert'
  resetForm()
  attachments.value = []
  queuedUploads.value = {}
  currentVoucherIndex.value = sortedVouchers.value.indexOf(targetVoucher)
  insertTargetId.value = targetVoucher.id
  // 预填目标凭证的信息
  form.value.voucher_date = targetVoucher.voucher_date
  form.value.voucher_type_id = targetVoucher.voucher_type_id || ''
  form.value.voucher_no = targetVoucher.voucher_no || ''
  dialogVisible.value = true
}

function handleCopyDraft() {
  if (!selectedDraftId.value) return

  // 1. 找到选中的凭证
  const sourceVoucher = sortedVouchers.value.find((v: any) => v.id === selectedDraftId.value)
  if (!sourceVoucher) {
    ElMessage.warning('未找到选中的凭证')
    return
  }

  // 2. 加载凭证数据到表单（包含所有分录和辅助核算）
  loadVoucherData(sourceVoucher)

  // 3. 清除 ID，表示这是新增凭证
  form.value.id = ''

  // 4. 保持原凭证的类型和日期
  form.value.voucher_type_id = sourceVoucher.voucher_type_id || ''
  form.value.voucher_date = sourceVoucher.voucher_date || sourceVoucher.date

  // 5. 智能编号：取同类型草稿凭证的最大号+1
  const typeId = form.value.voucher_type_id
  const sameTypeDrafts = sortedVouchers.value.filter(
    (v: any) => v.voucher_type_id === typeId && v.status === 'draft'
  )

  if (sameTypeDrafts.length > 0) {
    const maxNo = Math.max(
      ...sameTypeDrafts.map((v: any) => {
        const no = parseInt(v.voucher_no || '0')
        return isNaN(no) ? 0 : no
      })
    )
    form.value.voucher_no = String(maxNo + 1)
  } else {
    form.value.voucher_no = '1'
  }

  // 6. 清空附件（复制凭证不复制附件）
  attachments.value = []
  queuedUploads.value = {}

  // 7. 设置对话框模式为新增
  dialogMode.value = 'add'
  currentVoucherIndex.value = -1

  // 8. 打开对话框
  dialogVisible.value = true

  ElMessage.success('已复制凭证，请修改后保存')
}

function handleImportDraft() {
  // 打开引入新增对话框
  importForm.value = {
    voucher_type_id: '',
    year: new Date().getFullYear(),
    period: new Date().getMonth() + 1,
    voucher_no: '',
  }
  importDialogVisible.value = true
}

async function handleImportConfirm() {
  // 验证表单
  if (!importForm.value.voucher_type_id) {
    ElMessage.warning('请选择凭证类型')
    return
  }
  if (!importForm.value.year || !importForm.value.period) {
    ElMessage.warning('请选择年份和期间')
    return
  }
  if (!importForm.value.voucher_no) {
    ElMessage.warning('请输入凭证号')
    return
  }

  try {
    // 根据条件查询凭证
    const res = await request.get<any[]>('/voucher/vouchers', {
      params: {
        voucher_type_id: importForm.value.voucher_type_id,
        year: importForm.value.year,
        period: importForm.value.period,
        voucher_no: importForm.value.voucher_no,
        status: 'all', // 查询所有状态的凭证
      },
    })

    if (!res.data || res.data.length === 0) {
      ElMessage.warning('未找到符合条件的凭证')
      return
    }

    // 找到第一个匹配的凭证
    const sourceVoucher = res.data[0]

    // 关闭引入对话框
    importDialogVisible.value = false

    // 加载凭证数据到表单（包含所有分录和辅助核算）
    loadVoucherData(sourceVoucher)

    // 清除 ID，表示这是新增凭证
    form.value.id = ''

    // 保持原凭证的类型，但使用当前日期
    form.value.voucher_type_id = sourceVoucher.voucher_type_id || ''
    form.value.voucher_date = dayjs().format('YYYY-MM-DD') // 使用当前日期

    // 智能编号：取同类型草稿凭证的最大号+1
    const typeId = form.value.voucher_type_id
    const sameTypeDrafts = sortedVouchers.value.filter(
      (v: any) => v.voucher_type_id === typeId && v.status === 'draft'
    )

    if (sameTypeDrafts.length > 0) {
      const maxNo = Math.max(
        ...sameTypeDrafts.map((v: any) => {
          const no = parseInt(v.voucher_no || '0')
          return isNaN(no) ? 0 : no
        })
      )
      form.value.voucher_no = String(maxNo + 1)
    } else {
      form.value.voucher_no = '1'
    }

    // 清空附件（引入凭证不复制附件）
    attachments.value = []
    queuedUploads.value = {}

    // 设置对话框模式为新增
    dialogMode.value = 'add'
    currentVoucherIndex.value = -1

    // 打开对话框
    dialogVisible.value = true

    ElMessage.success('已引入凭证，请修改后保存')
  } catch (error: any) {
    ElMessage.error(error.message || '查询凭证失败')
  }
}

function handleTurnTemplate() {
  if (!selectedDraftId.value) return

  const sourceVoucher = sortedVouchers.value.find((v: any) => v.id === selectedDraftId.value)
  if (!sourceVoucher) {
    showWarning('未找到选中的凭证')
    return
  }

  // 重置表单
  templateForm.value = {
    template_no: '',
    template_name: '',
  }

  // 打开对话框
  templateDialogVisible.value = true
}

async function handleTemplateConfirm() {
  // 验证表单
  if (!templateForm.value.template_no || !templateForm.value.template_name) {
    showWarning('请填写模版编号和模版说明')
    return
  }

  try {
    if (isConvertingFromDialog.value) {
      // 从对话框内转模版（未保存的凭证）
      // 过滤有效分录
      const validEntries = form.value.entries.filter(
        (e: any) => e.account_id && (e.debit_amount > 0 || e.credit_amount > 0)
      )

      // 转换分录格式
      const entries = validEntries.map((e: any) => {
        const direction = e.debit_amount > 0 ? 'debit' : 'credit'
        const amount = e.debit_amount > 0 ? e.debit_amount : e.credit_amount

        // 构建辅助核算数据
        const auxData: Record<string, any> = {}
        for (const cat of auxCategories.value) {
          const itemId = e[`_${cat.code}_id`]
          if (itemId) {
            const item =
              voucherAux.getAuxItemFromCache(cat.id, itemId) ||
              (e[`_${cat.code}_name`]
                ? { id: itemId, name: e[`_${cat.code}_name`] }
                : null)
            if (item) {
              auxData[cat.code] = {
                id: itemId,
                name: item.name,
              }
            }
          }
        }

        return {
          account_id: e.account_id,
          account_code: e.account_code,
          account_name: e.account_name,
          direction,
          amount,
          summary: e.summary,
          dept_id: e.dept_id,
          dept_name: e.dept_name,
          project_id: e.project_id,
          project_name: e.project_name,
          supplier_id: e.supplier_id,
          supplier_name: e.supplier_name,
          person_id: e.person_id,
          person_name: e.person_name,
          func_class_id: e.func_class_id,
          func_class_name: e.func_class_name,
          aux_data: Object.keys(auxData).length > 0 ? auxData : null,
        }
      })

      // 调用 API 创建模版（传递 entries 数据）
      await request.post('/voucher-templates', {
        template_no: templateForm.value.template_no,
        template_name: templateForm.value.template_name,
        voucher_type_id: form.value.voucher_type_id || null,
        remark: form.value.remark || '',
        entries,
      })
    } else {
      // 从已保存的凭证转模版
      await request.post('/voucher-templates', {
        template_no: templateForm.value.template_no,
        template_name: templateForm.value.template_name,
        voucher_id: selectedDraftId.value,
      })
    }

    showSuccess('模版保存成功')
    templateDialogVisible.value = false
    isConvertingFromDialog.value = false // 重置标志
  } catch (error: any) {
    showOperationError(error, '保存失败')
  }
}

async function handleImportTemplate() {
  // 加载模版列表
  await loadTemplateList()
  // 打开模版选择对话框
  selectTemplateDialogVisible.value = true
}

async function loadTemplateList() {
  templateListLoading.value = true
  try {
    const res = await request.get<any[]>('/voucher-templates')
    templateList.value = res.data
  } catch (error: any) {
    showOperationError(error, '加载模版列表失败')
  } finally {
    templateListLoading.value = false
  }
}

function handleSelectTemplate(row: any) {
  // 关闭对话框
  selectTemplateDialogVisible.value = false
  // 加载模版并创建凭证
  loadTemplateAndCreate(row.id)
}

function formatDateTime(dateStr: string) {
  if (!dateStr) return ''
  return dayjs(dateStr).format('YYYY-MM-DD HH:mm:ss')
}

// 在对话框内点击"转模版"
function handleTurnTemplateInDialog() {
  // 验证当前表单数据
  const validEntries = form.value.entries.filter(
    (e: any) => e.account_id && (e.debit_amount > 0 || e.credit_amount > 0)
  )

  if (validEntries.length === 0) {
    showWarning('请至少填写一条有效分录')
    return
  }

  // 检查借贷是否平衡
  if (!isBalanced.value) {
    showWarning('借贷不平衡，无法转为模版')
    return
  }

  // 重置表单
  templateForm.value = {
    template_no: '',
    template_name: '',
  }

  // 标记为从对话框内转模版
  isConvertingFromDialog.value = true

  // 打开转模版对话框
  templateDialogVisible.value = true
}

// 在对话框内点击"引模版"
async function handleImportTemplateInDialog() {
  // 加载模版列表
  await loadTemplateList()
  // 打开模版选择对话框
  selectTemplateDialogVisible.value = true
}

const dialogVisible = ref(false)
const dialogMode = ref<'add' | 'edit' | 'insert'>('add')
const renumberDialogVisible = ref(false)
const renumberForm = ref({
  year: new Date().getFullYear(),
  period: new Date().getMonth() + 1,
  start_no: 1,
  voucher_type_id: null as string | null,
})

// 引入新增对话框
const importDialogVisible = ref(false)
const importForm = ref({
  voucher_type_id: '',
  year: new Date().getFullYear(),
  period: new Date().getMonth() + 1,
  voucher_no: '',
})

// 转模版对话框
const templateDialogVisible = ref(false)
const templateForm = ref({
  template_no: '',
  template_name: '',
})
const isConvertingFromDialog = ref(false) // 标记是否从对话框内转模版（未保存的凭证）

// 引模版对话框
const selectTemplateDialogVisible = ref(false)
const templateList = ref<any[]>([])
const templateListLoading = ref(false)
const templateSearchKeyword = ref('')

const filteredTemplateList = computed(() => {
  if (!templateSearchKeyword.value) return templateList.value
  const keyword = templateSearchKeyword.value.toLowerCase()
  return templateList.value.filter(
    t =>
      t.template_no.toLowerCase().includes(keyword) ||
      t.template_name.toLowerCase().includes(keyword)
  )
})

// ========== 导航相关状态 ==========
const currentVoucherIndex = ref(-1)
const insertTargetId = ref('')

// 排序配置
const sortConfig = ref({
  field: 'voucher_date' as 'voucher_no' | 'voucher_date' | 'created_at' | 'updated_at',
  order: 'asc' as 'asc' | 'desc',
})

// 提取凭证号序号（用于排序）
function extractVoucherSeq(voucherNo: string): number {
  if (!voucherNo) return 0
  const dashIndex = voucherNo.indexOf('-')
  if (dashIndex < 0) return parseInt(voucherNo, 10) || 0
  const seqStr = voucherNo.substring(dashIndex + 1)
  return parseInt(seqStr, 10) || 0
}

// 排序后的凭证列表
const sortedVouchers = computed(() => {
  const list = [...draftVouchers.value]
  const { field, order } = sortConfig.value

  // 创建凭证类型编码映射表（用于快速查找）
  const voucherTypeCodeMap = new Map<string, string>()
  voucherTypes.value.forEach(type => {
    voucherTypeCodeMap.set(type.id, type.code || '')
  })

  list.sort((a, b) => {
    // 1. 凭证类型编码（始终升序，与后端 ORDER BY 一致）
    const aTypeCode = voucherTypeCodeMap.get(a.voucher_type_id) || ''
    const bTypeCode = voucherTypeCodeMap.get(b.voucher_type_id) || ''
    const typeCompare = compareVoucherTypeCode(aTypeCode, bTypeCode)
    if (typeCompare !== 0) return typeCompare

    // 2. 用户选择的排序字段
    let aVal = a[field]
    let bVal = b[field]

    if (field === 'voucher_no') {
      aVal = extractVoucherSeq(aVal)
      bVal = extractVoucherSeq(bVal)
    }

    if (aVal < bVal) return order === 'asc' ? -1 : 1
    if (aVal > bVal) return order === 'asc' ? 1 : -1

    // 3. 凭证号兜底
    if (field !== 'voucher_no') {
      const aSeq = extractVoucherSeq(a.voucher_no)
      const bSeq = extractVoucherSeq(b.voucher_no)
      if (aSeq < bSeq) return -1
      if (aSeq > bSeq) return 1
    }

    return 0
  })

  return list
})

// 导航信息
const navigationInfo = computed(() => {
  if (sortedVouchers.value.length === 0) return null

  // 新增模式（currentVoucherIndex < 0）
  if (currentVoucherIndex.value < 0) {
    return {
      current: 0,
      total: sortedVouchers.value.length,
      isFirst: false, // 允许点击"上一张"跳转到最后一张
      isLast: true, // 禁用"下一张"
    }
  }

  // 编辑模式
  return {
    current: currentVoucherIndex.value + 1,
    total: sortedVouchers.value.length,
    isFirst: currentVoucherIndex.value === 0,
    isLast: currentVoucherIndex.value === sortedVouchers.value.length - 1,
  }
})

const {
  form,
  currentEntry,
  totalDebit,
  totalCredit,
  isBalanced,
  addEntry,
  removeEntry,
  setCurrentEntry,
  resetForm,
  loadVoucher,
  ensureAuxFields,
} = useVoucherForm(auxCategories)

const voucherAux = useVoucherAuxItems()

const {
  currentEntryAuxCategories,
  isParentAccount,
  getAuxItemNames,
  onAccountChange,
  onAmountChange,
  getAuxCategoryIds,
} = useAuxiliaryAccounting(accounts, auxCategories, currentEntry)

// 快速新增科目
const quickAccountAuxSelect = useVoucherAuxItems()

const tableRefForTree = ref<any>(null)
const {
  form: accountForm,
  parentUsage,
  getAvailableCats,
  onAuxCatChange,
  addAux,
  removeAux,
  onParentChange,
  createAddForm,
  buildSavePayload,
} = useAccountForm(auxCategories, createFlatAuxLookupRefs(auxItems))
const {
  treeData,
  getTreeSelectData,
  flattenRows: treeFlattenRows,
} = useAccountTree(accounts, tableRefForTree)
const treeSelectData = computed(() => getTreeSelectData(accountForm.value.id))
const quickAddAccountVisible = ref(false)
const quickAddRow = ref<any>(null)
const quickAccountSaving = ref(false)

function handleQuickParentChange(parentId: string) {
  onParentChange(parentId, treeData.value, treeFlattenRows)
}

function isQuickAccountAuxSelectLoading(catId: string) {
  return !!quickAccountAuxSelect.loadingByCategory.value[catId]
}

function handleQuickAuxCatChange(item: any, val: string) {
  onAuxCatChange(item, val)
  if (item.cat_id && item.item_id) {
    void quickAccountAuxSelect.ensureSelectedItems(item.cat_id, [item.item_id])
  }
}

// 操作历史记录
const { addRecord } = useOperationHistory()

async function loadVoucherData(voucher: any) {
  loadVoucher(voucher)
  // 加载附件
  if (voucher.id) {
    await fetchAttachments(voucher.id)
  } else {
    attachments.value = []
  }
}

async function fetchAttachments(voucherId: string) {
  try {
    const res = await request.get<any[]>(`/voucher/vouchers/${voucherId}/attachments`)
    attachments.value = res.data || []
  } catch (error) {
    console.error('Failed to fetch attachments:', error)
    attachments.value = []
  }
}

function updateAttachments(newAttachments: any[]) {
  attachments.value = newAttachments
}

function queuePendingUploads(files: File[]) {
  const next = { ...queuedUploads.value }
  files.forEach(file => {
    const fileKey = `${file.name}_${file.size}_${file.lastModified}`
    next[fileKey] = file
  })
  queuedUploads.value = next
}

function removeQueuedUpload(fileKey: string) {
  if (!queuedUploads.value[fileKey]) {
    return
  }
  const next = { ...queuedUploads.value }
  delete next[fileKey]
  queuedUploads.value = next
}

async function uploadQueuedAttachments(voucherId: string) {
  const files = Object.values(queuedUploads.value)
  if (files.length === 0) {
    return
  }

  const failedNames: string[] = []

  for (const file of files) {
    try {
      const formData = new FormData()
      formData.append('file', file)
      await request.post<any[]>(`/voucher/vouchers/${voucherId}/attachments`, formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      })
    } catch (error) {
      failedNames.push(file.name)
      console.error('Queued attachment upload failed:', error)
    }
  }

  queuedUploads.value = {}

  if (failedNames.length === 0) {
    showSuccess(`已自动上传 ${files.length} 个附件`)
  } else {
    showWarning(`凭证已保存，但以下附件上传失败：${failedNames.join('、')}`)
  }
}

async function prepareNewVoucherForm(preserve?: {
  voucher_date?: string
  voucher_type_id?: string
}) {
  const preservedDate = preserve?.voucher_date ?? form.value.voucher_date
  const preservedTypeId = preserve?.voucher_type_id ?? form.value.voucher_type_id
  dialogMode.value = 'add'
  resetForm()
  attachments.value = []
  queuedUploads.value = {}
  currentVoucherIndex.value = -1
  insertTargetId.value = ''
  form.value.voucher_date = preservedDate
  form.value.voucher_type_id = preservedTypeId
  const { effectiveTypeId, voucherNo } = await getNextVoucherNo(preservedTypeId, preservedDate)
  form.value.voucher_type_id = effectiveTypeId
  form.value.voucher_no = voucherNo
}

async function openVoucherDialog(
  mode: 'add' | 'edit' | 'insert' = 'add',
  voucher?: any,
  index?: number
) {
  dialogMode.value = mode
  if (mode === 'add' || mode === 'insert' || !voucher) {
    if (mode === 'add') {
      await prepareNewVoucherForm()
    } else {
      resetForm()
      attachments.value = []
      queuedUploads.value = {}
      currentVoucherIndex.value = -1
      if (mode === 'insert') insertTargetId.value = ''
    }
  } else {
    queuedUploads.value = {}

    // 编辑场景优先使用草稿列表中的完整凭证对象（而不是列表展平后的行数据）
    const sourceVoucher =
      mode === 'edit' ? sortedVouchers.value.find(v => v.id === voucher.id) || voucher : voucher

    loadVoucherData(sourceVoucher)

    const resolvedIndex =
      typeof index === 'number'
        ? index
        : sortedVouchers.value.findIndex(v => v.id === sourceVoucher.id)

    currentVoucherIndex.value = resolvedIndex
  }
  dialogVisible.value = true
}

function handleEdit(row: any) {
  const index = sortedVouchers.value.findIndex(v => v.id === row.id)
  const voucher = sortedVouchers.value[index] || row
  openVoucherDialog('edit', voucher, index)
}

// ========== 导航功能 ==========

// 加载指定索引的凭证
function loadVoucherAtIndex(index: number) {
  if (index < 0 || index >= sortedVouchers.value.length) return
  currentVoucherIndex.value = index
  const voucher = sortedVouchers.value[index]
  loadVoucherData(voucher)
}

// 导航到指定索引（带未保存检测）
async function navigateToVoucher(index: number) {
  if (index < 0 || index >= sortedVouchers.value.length) return

  // 简化版：直接导航，不检测未保存（后续可以增强）
  loadVoucherAtIndex(index)
}

// 首张
function goToFirst() {
  navigateToVoucher(0)
}

// 上一张
function goToPrevious() {
  // 如果在新增模式，跳转到最后一张凭证
  if (currentVoucherIndex.value < 0) {
    if (sortedVouchers.value.length > 0) {
      navigateToVoucher(sortedVouchers.value.length - 1)
    }
    return
  }

  // 编辑模式，跳转到上一张
  if (currentVoucherIndex.value > 0) {
    navigateToVoucher(currentVoucherIndex.value - 1)
  }
}

// 下一张
function goToNext() {
  if (currentVoucherIndex.value < sortedVouchers.value.length - 1) {
    navigateToVoucher(currentVoucherIndex.value + 1)
  }
}

// 末张
function goToLast() {
  navigateToVoucher(sortedVouchers.value.length - 1)
}

// 处理导航事件
function handleNavigate(direction: 'first' | 'previous' | 'next' | 'last') {
  switch (direction) {
    case 'first':
      goToFirst()
      break
    case 'previous':
      goToPrevious()
      break
    case 'next':
      goToNext()
      break
    case 'last':
      goToLast()
      break
  }
}

// 处理排序变化
function handleSortChange(config: { field: string; order: string }) {
  sortConfig.value.field = config.field as
    | 'voucher_no'
    | 'voucher_date'
    | 'created_at'
    | 'updated_at'
  sortConfig.value.order = config.order as 'asc' | 'desc'
  draftPagination.value.page = 1
  void fetchDraftVouchers()
}

// 复制当前凭证
function handleClearCurrentEntry() {
  currentEntry.value = null
}

function handleAddAuxItem(item: { id: string; name: string; type: string }, catCode: string) {
  voucherAux.cacheAuxItem(item.type, item)
  if (currentEntry.value) {
    currentEntry.value[`_${catCode}_id`] = item.id
    currentEntry.value[`_${catCode}_name`] = item.name
  }
}

function isAuxSelectLoading(catId: string) {
  return !!voucherAux.loadingByCategory.value[catId]
}

function ensureAuxSelectedForEntry(entry: any) {
  return voucherAux.ensureSelectedForEntry(entry, currentEntryAuxCategories.value)
}

async function handleQuickCreateAccount(row: any) {
  quickAddRow.value = row
  accountForm.value = createAddForm()
  if (!baseDataStore.auxItemsLoaded) {
    await baseDataStore.loadAuxItems()
  }
  quickAddAccountVisible.value = true
}

async function saveQuickAccount() {
  quickAccountSaving.value = true
  try {
    const payload = buildSavePayload()
    await request.post('/base/accounts', payload)
    quickAddAccountVisible.value = false
    // 刷新科目列表
    await fetchOptions()
    // 自动选中新科目
    const acc = accounts.value.find((a: any) => a.code === payload.code)
    if (acc && quickAddRow.value) {
      quickAddRow.value.account_id = acc.id
      quickAddRow.value.account_code = acc.code
      quickAddRow.value.account_name = acc.name
      onAccountChange(quickAddRow.value)
      setCurrentEntry(quickAddRow.value)
    }
    showSuccess('科目新增成功')
  } catch (error: any) {
    showOperationError('新增科目', error)
  } finally {
    quickAccountSaving.value = false
  }
}

async function handleAiSummary() {
  try {
    const res = await request.post<{ summary: string }>('/voucher/vouchers/ai/summary', {
      entries: form.value.entries,
    })
    form.value.entries.forEach((e: any) => {
      if (!e.summary) e.summary = res.data.summary
    })
    showSuccess('AI 摘要已生成')
  } catch {
    /* ignore */
  }
}

async function handleSubmit(options?: { keepOpen?: boolean }) {
  if (!form.value.voucher_date) {
    showWarning('请选择凭证日期')
    return
  }
  if (Math.abs(totalDebit.value - totalCredit.value) > 0.01) {
    showError('借贷不平衡')
    return
  }

  const validEntries = form.value.entries.filter(
    (e: any) => e.account_id && ((e.debit_amount || 0) !== 0 || (e.credit_amount || 0) !== 0)
  )

  if (validEntries.length === 0) {
    showError('请填写完整的分录')
    return
  }

  for (const entry of validEntries) {
    const acc = accounts.value.find(a => a.id === entry.account_id)
    if (!acc) continue

    if (enableCashFlow.value) {
      const needCashFlow = accountNeedsCashFlowItem(acc)
      if (needCashFlow && !String(entry.cash_flow_code || '').trim()) {
        showError(`科目「${entry.account_name}」须选择现金流量项目`)
        setCurrentEntry(entry)
        return
      }
    }

    if (!acc.is_aux) {
      continue
    }

    const requiredCategoryIds = getAuxCategoryIds(acc)
    const missingCategory = requiredCategoryIds.find(categoryId => {
      const category = auxCategories.value.find(cat => cat.id === categoryId)
      if (!category) {
        return false
      }
      return !entry[`_${category.code}_id`]
    })

    if (missingCategory) {
      const category = auxCategories.value.find(cat => cat.id === missingCategory)
      showError(
        `科目"${entry.account_name}"必须选择辅助核算项目：${category?.name || missingCategory}`
      )
      // 将焦点切换到出现问题的分录，便于用户修改
      setCurrentEntry(entry)
      return
    }

    // 校验自定义字段 required_in_voucher
    for (const categoryId of requiredCategoryIds) {
      const category = auxCategories.value.find(cat => cat.id === categoryId)
      if (!category || !entry[`_${category.code}_id`]) continue
      const requiredFields = (category.fields || []).filter(
        (f: any) => f.is_enabled !== 0 && f.show_in_voucher && f.required_in_voucher
      )
      for (const field of requiredFields) {
        const fvKey = `_${category.code}_fv_${field.field_key}`
        if (!entry[fvKey] || String(entry[fvKey]).trim() === '') {
          showError(`科目"${entry.account_name}"的${category.name}→"${field.field_name}"为必填项`)
          setCurrentEntry(entry)
          return
        }
      }
    }
  }

  const payload = {
    ...form.value,
    entries: validEntries.map((e: any) => {
      const debit = e.debit_amount || 0
      const credit = e.credit_amount || 0
      return {
        ...e,
        direction: debit !== 0 ? 'debit' : 'credit',
        amount: debit !== 0 ? debit : credit,
      }
    }),
  }

  const saveRequestConfig = { skipErrorToast: true }

  submitLoading.value = true
  try {
    if (dialogMode.value === 'insert' && insertTargetId.value) {
      // 插入模式
      const res = await request.post<{ id: string; voucher_no: string; updated_count: number }>(
        '/voucher/vouchers/insert',
        {
          target_voucher_id: insertTargetId.value,
          voucher: payload,
        },
        saveRequestConfig
      )
      const createdVoucherId = res.data?.id
      showSuccess(`插入成功，已更新 ${res.data?.updated_count || 0} 张凭证的编号`)
      addRecord('create', '凭证录入', `插入凭证：${form.value.voucher_date}`)
      if (createdVoucherId) {
        await uploadQueuedAttachments(createdVoucherId)
      }
    } else if (dialogMode.value === 'edit' && form.value.id) {
      // 编辑模式
      await request.put(`/voucher/vouchers/${form.value.id}`, payload, saveRequestConfig)
      showSuccess('凭证修改成功')
      addRecord('update', '凭证录入', `修改凭证：${form.value.voucher_date}`)
    } else {
      // 新增模式
      const created = await request.post<{ id: string; voucherNo: string; warning?: string }>(
        '/voucher/vouchers',
        payload,
        saveRequestConfig
      )
      const createdVoucherId = created.data?.id
      showSuccess('凭证保存成功')
      if (created.data?.warning) {
        showWarning(created.data.warning)
      }
      addRecord('create', '凭证录入', `新增凭证：${form.value.voucher_date}`)
      if (createdVoucherId) {
        await uploadQueuedAttachments(createdVoucherId)
      }
    }

    await fetchDraftVouchers()

    if (options?.keepOpen) {
      await prepareNewVoucherForm({
        voucher_date: form.value.voucher_date,
        voucher_type_id: form.value.voucher_type_id,
      })
    } else {
      dialogVisible.value = false
      resetForm()
      attachments.value = []
      queuedUploads.value = {}
      currentVoucherIndex.value = -1
      insertTargetId.value = ''
    }
  } catch (error: any) {
    const message = extractErrorMessage(error)
    // 特殊处理凭证时序错误
    if (error.response?.data?.code === 'VOUCHER_DATE_OUT_OF_ORDER') {
      const { maxDate, currentDate } = error.response.data
      ElMessageBox.alert(
        `系统已开启凭证时序控制，不允许录入早于已有凭证的日期。\n\n` +
          `最新凭证日期：${maxDate}\n` +
          `当前凭证日期：${currentDate}\n\n` +
          `建议：请修改凭证日期为 ${maxDate} 或之后的日期，或联系管理员关闭时序控制。`,
        '凭证日期不符合时序要求',
        {
          type: 'warning',
          confirmButtonText: '我知道了',
          closeOnClickModal: false,
          closeOnPressEscape: false,
        }
      )
    } else if (
      isNoNegativeBalanceMessage(message, error.response?.data?.codeType) ||
      error.response?.data?.violations?.length
    ) {
      await showNoNegativeBalanceAlert(error.response?.data?.violations, message)
    } else {
      showOperationError(dialogMode.value === 'edit' ? '修改凭证' : '保存凭证', error)
    }
  } finally {
    submitLoading.value = false
  }
}

async function handleSubmitAndAdd() {
  await handleSubmit({ keepOpen: true })
}

const duplicateWarnings = computed(() => {
  const seen = new Map<string, string>()
  const warnings: string[] = []
  for (const entry of form.value.entries) {
    if (!entry.account_id) continue
    const auxParts: string[] = []
    const deptId = (entry as any).dept_id
    const projectId = (entry as any).project_id
    const supplierId = (entry as any).supplier_id
    const personId = (entry as any).person_id
    const funcClassId = (entry as any).func_class_id
    if (deptId) auxParts.push(`部门:${deptId}`)
    if (projectId) auxParts.push(`项目:${projectId}`)
    if (supplierId) auxParts.push(`供应商:${supplierId}`)
    if (personId) auxParts.push(`个人:${personId}`)
    if (funcClassId) auxParts.push(`功能:${funcClassId}`)

    const direction =
      (entry.debit_amount || 0) > 0 ? '借方' : (entry.credit_amount || 0) > 0 ? '贷方' : ''
    const key = `${entry.account_id}|${direction}|${auxParts.join('|')}`
    if (!direction) continue

    const existing = seen.get(key)
    if (existing) {
      warnings.push(`科目"${entry.account_name}"${existing}出现了重复（${direction}）`)
    } else {
      seen.set(key, auxParts.length > 0 ? `[${auxParts.join(', ')}]` : '')
    }
  }
  return warnings
})

async function fetchDraftVouchers() {
  draftLoading.value = true
  try {
    await performanceMonitor.measure('fetchDraftVouchers', async () => {
      const params: any = {
        status: 'draft',
        page: draftPagination.value.page,
        pageSize: draftPagination.value.pageSize,
        sortField: sortConfig.value.field,
        sortOrder: sortConfig.value.order,
      }

      // 添加筛选条件
      if (draftFilters.value.keyword) {
        params.keyword = draftFilters.value.keyword
      }
      if (draftFilters.value.dateRange?.length === 2) {
        params.start_date = draftFilters.value.dateRange[0]
        params.end_date = draftFilters.value.dateRange[1]
      }
      if (draftFilters.value.voucherTypeIds?.length > 0) {
        params.voucher_type_ids = draftFilters.value.voucherTypeIds.join(',')
      }
      if (draftFilters.value.accountIds?.length > 0) {
        params.account_ids = draftFilters.value.accountIds.join(',')
      }
      if (draftFilters.value.minAmount) {
        params.min_amount = draftFilters.value.minAmount
      }
      if (draftFilters.value.maxAmount) {
        params.max_amount = draftFilters.value.maxAmount
      }

      const res = await request.get<any>('/voucher/vouchers', { params })
      const nextList = res.data?.list || res.data || []
      const nextTotal = res.data?.total || 0
      const maxPage = Math.max(1, Math.ceil(nextTotal / Math.max(1, draftPagination.value.pageSize)))
      if (nextList.length === 0 && nextTotal > 0 && draftPagination.value.page > maxPage) {
        draftPagination.value.page = maxPage
        await fetchDraftVouchers()
        return
      }
      draftVouchers.value = nextList
      draftPagination.value.total = nextTotal
    })
  } finally {
    draftLoading.value = false
  }
}

function handleFilterChange(filters: any) {
  draftFilters.value = filters
  draftPagination.value.page = 1
  fetchDraftVouchers()
}

async function loadAccounts() {
  await baseDataStore.loadAccounts()
}

function handlePageChange(page: number, pageSize: number) {
  draftPagination.value.page = page
  draftPagination.value.pageSize = pageSize
  fetchDraftVouchers()
}

async function handleDeleteDraft(row: any) {
  const confirmed = await useDeleteConfirm(`未审核凭证「${row.voucher_no}」`)
  if (!confirmed) return

  try {
    await request.delete(`/voucher/vouchers/${row.id}`)
    showSuccess('删除成功')
    addRecord('delete', '凭证录入', `删除凭证：${row.voucher_no}`)
    await fetchDraftVouchers()
  } catch (error) {
    showOperationError('删除', error)
  }
}

async function handleRenumber() {
  try {
    const res = await request.post<{ updated: number }>(
      '/voucher/vouchers/renumber',
      renumberForm.value
    )
    showSuccess(res.data ? `已完成 ${res.data.updated} 张凭证的重新排号` : '重新排号成功')
    renumberDialogVisible.value = false
    await fetchDraftVouchers()
    addRecord(
      'update',
      '凭证录入',
      `重新排号：${renumberForm.value.year}年${renumberForm.value.period}期`
    )
  } catch (error) {
    showOperationError('重新排号', error)
  }
}

async function cashFlowItemsFromAux(): Promise<Array<{ code: string; name: string }>> {
  const cat = auxCategories.value.find(c => c.code === 'cash_flow')
  if (!cat) return []
  const list = await voucherAux.fetchAuxItems(cat.id, { limit: 500 })
  return list.map(i => ({ code: i.code || '', name: i.name }))
}

async function loadCashFlowItems() {
  try {
    const res = await getCashFlowItems(userStore.accountSetId)
    let items = (res.data || []).map(item => ({
      code: item.code,
      name: item.name,
    }))
    if (items.length === 0) {
      items = await cashFlowItemsFromAux()
    }
    cashFlowItems.value = items
  } catch {
    cashFlowItems.value = await cashFlowItemsFromAux()
  }
}

async function fetchOptions(force = false) {
  await performanceMonitor.measure('fetchOptions', async () => {
    await systemParamsStore.load(force)
    await Promise.all([
      baseDataStore.loadVoucherTypes(force),
      baseDataStore.loadAccounts(force),
      baseDataStore.loadAuxCategories(force),
    ])
    await loadCashFlowItems()
    await loadAccountSetStartDate()
    // 加载完辅助核算类别后，为现有分录补充动态字段
    ensureAuxFields()
  })
}

async function loadAccountSetStartDate() {
  try {
    const res = await request.get<any[]>('/system/account-sets')
    const sets = res.data || []
    const current = sets.find((s: any) => s.id === userStore.accountSetId)
    if (current?.start_date) {
      accountSetStartDate.value = String(current.start_date)
    }
  } catch {
    // 获取失败时不阻塞
  }
}

const route = useRoute()
const router = useRouter()

function handleActionQuery() {
  if (route.query.action === 'add') {
    router.replace({ query: {} })
    nextTick(() => {
      openVoucherDialog('add')
    })
  } else if (route.query.templateId) {
    // 从模版创建凭证
    const templateId = route.query.templateId as string
    router.replace({ query: {} })
    nextTick(() => {
      loadTemplateAndCreate(templateId)
    })
  }
}

let openingEditFromRoute = false

/** 账簿等页面带 editVoucherId 跳转：直接打开编辑模态框 */
async function openEditVoucherFromRoute(voucherId: string) {
  if (openingEditFromRoute) return
  openingEditFromRoute = true
  try {
    if (route.query.editVoucherId) {
      const nextQuery: Record<string, string> = {}
      if (route.query.from === 'drill') nextQuery.from = 'drill'
      router.replace({ path: route.path, query: nextQuery })
    }
    await loadVoucherForEditFromRoute(voucherId)
  } finally {
    openingEditFromRoute = false
  }
}

function findEntryByKey(key?: string) {
  if (!key) return null
  for (const [index, entry] of form.value.entries.entries()) {
    if (buildEntryKey(entry, index) === key) return entry
  }
  if (key.startsWith('acc:')) {
    const accId = key.slice(4)
    return form.value.entries.find(e => e.account_id === accId) || null
  }
  if (key.startsWith('idx:')) {
    const index = Number(key.split(':')[1])
    if (Number.isFinite(index) && form.value.entries[index]) {
      return form.value.entries[index]
    }
  }
  return null
}

async function restoreVoucherModal(voucherId: string, options?: { currentEntryKey?: string }) {
  try {
    const res = await request.get<any>(`/voucher/vouchers/${voucherId}`)
    const voucher = res.data
    if (!voucher) {
      showWarning('凭证不存在')
      return
    }
    if (voucher.status !== 'draft') {
      showWarning('仅草稿凭证可编辑')
      return
    }
    await openVoucherDialog('edit', voucher)
    await nextTick()
    const entry = findEntryByKey(options?.currentEntryKey)
    if (entry) setCurrentEntry(entry)
  } catch (error) {
    showOperationError('恢复凭证', error)
  }
}

const { tryRestoreVoucherModal } = useVoucherModalRestore(undefined, restoreVoucherModal)

async function loadVoucherForEditFromRoute(voucherId: string) {
  try {
    const res = await request.get<any>(`/voucher/vouchers/${voucherId}`)
    const voucher = res.data
    if (!voucher) {
      showWarning('凭证不存在')
      return
    }
    if (voucher.status !== 'draft') {
      showWarning('仅草稿凭证可编辑')
      return
    }
    await openVoucherDialog('edit', voucher)
    if (!sortedVouchers.value.some(v => v.id === voucher.id)) {
      void fetchDraftVouchers()
    }
  } catch (error: any) {
    showOperationError(error, '加载凭证失败')
  }
}

async function bootstrapEntryPage(forceOptions = false) {
  const editId = route.query.editVoucherId as string | undefined
  pageLoading.value = !editId
  try {
    await fetchOptions(forceOptions)
    if (editId) {
      await openEditVoucherFromRoute(editId)
    } else {
      await tryRestoreVoucherModal()
    }
    await fetchDraftVouchers()
  } finally {
    pageLoading.value = false
  }
  handleActionQuery()
}

async function loadTemplateAndCreate(templateId: string) {
  try {
    // 加载模版详情
    const res = await request.get<any>(`/voucher-templates/${templateId}`)
    const template = res.data

    // 构造凭证数据格式
    const voucherData = {
      id: '',
      voucher_type_id: template.voucher_type_id || '',
      voucher_no: '',
      voucher_date: new Date().toISOString().split('T')[0],
      remark: template.remark || '',
      entries: template.entries || [],
    }

    // 加载到表单
    loadVoucher(voucherData)

    // 清除 ID（表示新增）
    form.value.id = ''

    // 智能生成凭证号
    const { effectiveTypeId, voucherNo } = await getNextVoucherNo(
      form.value.voucher_type_id,
      form.value.voucher_date
    )
    form.value.voucher_type_id = effectiveTypeId
    form.value.voucher_no = voucherNo

    // 清空附件
    attachments.value = []
    queuedUploads.value = {}

    // 设置对话框模式为新增
    dialogMode.value = 'add'
    currentVoucherIndex.value = -1

    // 打开对话框
    dialogVisible.value = true

    showSuccess('已加载模版，请修改后保存')
  } catch (error: any) {
    showOperationError(error, '加载模版失败')
  }
}

async function getNextVoucherNo(voucherTypeId: string, voucherDate: string) {
  try {
    const res = await request.get<any>('/voucher/next-voucher-no', {
      params: {
        voucher_type_id: voucherTypeId || null,
        voucher_date: voucherDate,
      },
    })
    return {
      effectiveTypeId: res.data.effective_type_id,
      voucherNo: res.data.voucher_no,
    }
  } catch {
    return {
      effectiveTypeId: voucherTypeId,
      voucherNo: '',
    }
  }
}

watch(
  () => route.query.editVoucherId,
  editId => {
    if (editId && typeof editId === 'string') {
      void openEditVoucherFromRoute(editId)
    }
  }
)

onMounted(() => {
  void bootstrapEntryPage(true)
})

onActivated(() => {
  void bootstrapEntryPage(false)
})

// 键盘快捷键（凭证表单内：Ctrl+S 保存、Ctrl+Enter 保存并新增，见 VoucherEntryForm）
useKeyboardShortcuts([commonShortcuts.refresh(() => fetchDraftVouchers())])
</script>

<style src="./voucher.styles.css"></style>
