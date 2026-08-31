<template>
  <div class="page account-page">
    <div class="page-header account-header">
      <div class="account-title">
        <h3>会计科目</h3>
        <span>{{ accountCountLabel }}</span>
      </div>
      <div class="account-toolbar">
        <el-button-group class="level-actions">
          <el-button size="small" title="全部收拢 (Ctrl+\)" @click="collapseAll">顶层</el-button>
          <el-button size="small" title="上一级 (Ctrl+↑)" @click="goUpLevel">上级</el-button>
          <el-button size="small" title="下一级 (Ctrl+↓)" @click="goDownLevel">下级</el-button>
          <el-button size="small" title="全部展开 (Ctrl+Shift+\)" @click="expandAll">底层</el-button>
        </el-button-group>
        <el-input
          v-model="keyword"
          placeholder="搜索科目编码或名称"
          class="account-search"
          size="small"
          clearable
          @input="onSearchInput"
          @clear="onSearchClear"
        />
        <div
          class="account-quick-filter-wrap"
          :class="{ 'is-active': quickFilterValues.length > 0 }"
        >
          <span class="account-quick-filter-badge" aria-hidden="true">
            <el-icon><Filter /></el-icon>
            <em v-if="quickFilterValues.length > 0">{{ quickFilterValues.length }}</em>
          </span>
          <el-select
            v-model="quickFilterValues"
            multiple
            collapse-tags
            collapse-tags-tooltip
            :max-collapse-tags="1"
            clearable
            filterable
            placeholder="快速筛选"
            class="account-quick-filter"
            popper-class="account-quick-filter-popper"
            size="small"
            @change="handleQuickFilterChange"
          >
            <el-option
              v-for="option in ACCOUNT_QUICK_FILTER_OPTIONS"
              :key="option.value"
              :label="option.label"
              :value="option.value"
            >
              <div class="quick-filter-option">
                <span :class="['quick-filter-option__icon', `is-${option.tone}`]">
                  <el-icon>
                    <Money v-if="option.value === 'cash'" />
                    <CreditCard v-else-if="option.value === 'bank'" />
                    <WarningFilled v-else />
                  </el-icon>
                </span>
                <span class="quick-filter-option__label">{{ option.label }}</span>
              </div>
            </el-option>
            <el-option-group v-if="auxCategories.length > 0" label="辅助核算">
              <el-option
                v-for="cat in auxCategories"
                :key="cat.id"
                :label="cat.name"
                :value="buildAuxQuickFilterValue(cat.id)"
              >
                <div class="quick-filter-option">
                  <span class="quick-filter-option__icon is-aux">
                    <el-icon><CollectionTag /></el-icon>
                  </span>
                  <span class="quick-filter-option__label">{{ cat.name }}</span>
                </div>
              </el-option>
            </el-option-group>
          </el-select>
        </div>
        <el-dropdown trigger="click" @command="handleAddAccountCommand">
          <el-button type="primary" size="small">
            <el-icon><Plus /></el-icon>
            新增科目
            <el-icon class="el-icon--right"><ArrowDown /></el-icon>
          </el-button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="sibling">增加同级科目</el-dropdown-item>
              <el-dropdown-item command="child" :disabled="!canAddChildAccount">
                增加子科目
              </el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>

        <el-button plain size="small" :disabled="list.length === 0" @click="exportData">
          <el-icon><Download /></el-icon>
          导出
        </el-button>
        <el-button plain size="small" @click="openImportDialog">
          <el-icon><Upload /></el-icon>
          导入
        </el-button>
        <el-button plain size="small" @click="handleRepairHierarchy" :loading="repairingHierarchy">
          修复层级
        </el-button>
        <el-switch
          v-model="showDisabled"
          active-text="显示禁用"
          inactive-text=""
          class="disabled-switch"
          @change="fetchData"
        />
      </div>
    </div>

    <el-table
      ref="tableRef"
      :data="displayData"
      stripe
      border
      size="small"
      highlight-current-row
      height="100%"
      :row-style="{ height: '30px' }"
      :cell-style="{ padding: '0' }"
      :header-cell-style="{ padding: '4px 0' }"
      row-key="id"
      class="account-table"
      :tree-props="{ children: 'children', hasChildren: 'hasChildren' }"
      :expand-row-keys="expandedKeys"
      @current-change="handleCurrentChange"
      @row-click="handleRowClick"
      @row-dblclick="handleRowDblClick"
      @header-dragend="onDragEnd"
      @expand-change="handleExpandChange"
    >
      <el-table-column prop="code" label="科目编码" :width="getColumnWidth('code', 120)">
        <template #default="{ row }">
          <span
            :style="{
              paddingLeft: `${((row.level || row._depth || 1) - 1) * 14}px`,
              display: 'inline-block',
            }"
            class="account-code"
            >{{ getDisplayText(row.code) }}</span
          >
        </template>
      </el-table-column>
      <el-table-column prop="name" label="科目名称" :width="getColumnWidth('name')">
        <template #default="{ row }">
          <span
            :style="{
              paddingLeft: `${((row.level || row._depth || 1) - 1) * 14}px`,
              display: 'inline-block',
            }"
            class="account-name"
            >{{ getDisplayText(row.name) }}</span
          >
        </template>
      </el-table-column>
      <el-table-column label="方向" column-key="方向" :width="getColumnWidth('方向', 76)">
        <template #default="{ row }">
          <el-tag :type="row.direction === 'debit' ? 'primary' : 'warning'" size="small" effect="plain">
            {{ row.direction === 'debit' ? '借方' : '贷方' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="现金" column-key="现金" :width="getColumnWidth('现金', 52)" align="center">
        <template #default="{ row }">
          <span v-if="row.is_cash" class="mini-flag">是</span>
        </template>
      </el-table-column>
      <el-table-column label="银行" column-key="银行" :width="getColumnWidth('银行', 52)" align="center">
        <template #default="{ row }">
          <span v-if="row.is_bank" class="mini-flag bank">是</span>
        </template>
      </el-table-column>
      <el-table-column label="辅助核算" column-key="辅助核算" min-width="220" :width="getColumnWidth('辅助核算')">
        <template #default="{ row }">
          <div v-if="row.is_aux" class="aux-tags">
            <el-tag
              v-for="name in getAuxNames(row)"
              :key="name"
              type="info"
              size="small"
              >{{ name }}</el-tag
            >
          </div>
        </template>
      </el-table-column>
      <el-table-column label="状态" column-key="状态" :width="getColumnWidth('状态', 68)">
        <template #default="{ row }">
          <el-tag :type="row.is_enabled ? 'success' : 'info'" size="small" effect="plain">{{
            row.is_enabled ? '启用' : '禁用'
          }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" column-key="操作" :width="getColumnWidth('操作', 112)" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" size="small" @click="openDialog('edit', row)"
            >编辑</el-button
          >
          <el-button
            link
            type="danger"
            size="small"
            :disabled="!row.allow_delete"
            @click="handleDelete(row)"
            >删除</el-button
          >
        </template>
      </el-table-column>
    </el-table>

    <AccountDialog
      v-model="dialogVisible"
      :mode="dialogType"
      :title="dialogTitle"
      :form="form"
      :parent-usage="parentUsage"
      :children-count="childrenCount"
      :tree-select-data="treeSelectData"
      :get-available-cats="getAvailableCats"
      :get-aux-options="accountAuxSelect.getAuxOptions"
      :search-aux-items="accountAuxSelect.searchAuxItems"
      :on-aux-dropdown-open="accountAuxSelect.onDropdownOpen"
      :is-aux-select-loading="isAccountAuxSelectLoading"
      :on-aux-cat-change="handleAuxCatChange"
      :add-aux="addAux"
      :remove-aux="removeAux"
      :saving="saving"
      @parent-change="handleParentChange"
      @save="handleSave"
      @save-and-add="handleSaveAndAdd"
    />

    <!-- 批量导入对话框 -->
    <el-dialog
      v-model="importDialogVisible"
      title="批量导入会计科目"
      width="960px"
      class="spreadsheet-import-dialog"
      @closed="resetImportDialog"
    >
      <div class="import-tips">
        <p>
          1. 请先
          <el-link type="primary" @click="downloadTemplate">下载导入模板</el-link
          >，按模板格式填写数据
        </p>
        <p>2. 科目编码、名称、余额方向为必填；上级科目编码需已存在</p>
        <p>3. 每个辅助类别有独立列：辅助-XXX 填"是/否"标识是否启用，默认项目-XXX 填项目名称</p>
      </div>
      <el-upload
        ref="importUploadRef"
        :auto-upload="false"
        :limit="1"
        accept=".xlsx,.xls"
        :disabled="importParsing"
        :on-change="onImportFileChange"
        :on-exceed="() => showError('只能上传一个文件')"
        drag
      >
        <el-icon class="el-icon--upload"><Upload /></el-icon>
        <div class="el-upload__text">拖拽文件到此处，或<em>点击上传</em></div>
        <template #tip>
          <div class="el-upload__tip">仅支持 .xlsx / .xls 格式</div>
        </template>
      </el-upload>

      <div v-if="importParsing" class="import-parsing">
        <el-progress :percentage="importParseProgress" :stroke-width="16" />
        <p class="import-parsing__text">{{ importParseMessage }}</p>
      </div>

      <div v-if="importPreview.length > 0" class="import-preview">
        <SpreadsheetImportSummaryAlert
          :summary="importSummary"
          :issue-count="importIssueCount"
          @view-issues="openImportIssuesDialog"
        />
        <el-table :data="importPreview.slice(0, 15)" stripe border size="small" max-height="280">
          <el-table-column prop="rowIndex" label="行号" width="60" />
          <el-table-column prop="code" label="科目编码" width="100" />
          <el-table-column prop="name" label="科目名称" min-width="120" />
          <el-table-column label="余额方向" width="80">
            <template #default="{ row }">{{ row.direction === 'credit' ? '贷方' : '借方' }}</template>
          </el-table-column>
          <el-table-column prop="parent_code" label="上级编码" width="100" />
          <el-table-column prop="aux_desc" label="辅助核算" min-width="120" />
          <el-table-column prop="matched" label="状态" width="90" align="center">
            <template #default="{ row }">
              <el-tag :type="row.matched ? 'success' : 'danger'" size="small">
                {{ row.matched ? '有效' : row.error || '无效' }}
              </el-tag>
            </template>
          </el-table-column>
        </el-table>
        <div v-if="importPreview.length > 15" class="import-preview-more">
          预览仅显示前 15 行，共 {{ importPreview.length }} 行；异常明细请点「查看异常说明」
        </div>
      </div>

      <template #footer>
        <el-button @click="closeImportDialog">取消</el-button>
        <el-button
          v-if="importIssueCount > 0"
          @click="openImportIssuesDialog"
        >
          查看异常说明
        </el-button>
        <el-button
          type="primary"
          :disabled="importMatchedCount === 0"
          :loading="importing"
          @click="handleImport"
        >
          确认导入（{{ importMatchedCount }} 条）
        </el-button>
      </template>
    </el-dialog>

    <SpreadsheetImportIssuesDialog
      v-model:visible="importIssuesDialogVisible"
      :issues="importIssues"
      :loading="importIssuesLoading"
      :total-count="importIssueCount > 0 ? importIssueCount : null"
      intro="以下行未能通过校验，不会写入科目表。同类问题已合并展示；请按说明修正模板后重新上传。"
    />

    <TaskProgressDialog
      v-model="taskProgressVisible"
      :task-id="currentTaskId"
      :task-type="currentTaskType"
      @completed="handleTaskCompleted"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, shallowRef, onMounted, onActivated, onBeforeUnmount, nextTick } from 'vue'
import type { UploadFile } from 'element-plus'
import {
  Upload,
  Plus,
  Download,
  ArrowDown,
  Filter,
  Money,
  CreditCard,
  WarningFilled,
  CollectionTag,
} from '@element-plus/icons-vue'
import request from '@/api/request'
import { useAsyncBatchTask } from '@/composables/useAsyncBatchTask'
import { useVoucherAuxItems } from '@/composables/useVoucherAuxItems'
import TaskProgressDialog from '@/components/task/TaskProgressDialog.vue'
import AccountDialog from '@/components/base/AccountDialog.vue'
import SpreadsheetImportSummaryAlert from '@/components/common/SpreadsheetImportSummaryAlert.vue'
import SpreadsheetImportIssuesDialog from '@/components/common/SpreadsheetImportIssuesDialog.vue'
import {
  buildAccountImportSummary,
  collectAccountImportIssues,
  describeAccountRowIssue,
  parseAccountImportRowsAsync,
  type AccountImportRow,
} from '@/utils/accountImport'
import { aggregateImportIssuesAsync } from '@/utils/spreadsheetImportReport'
import { yieldToMain } from '@/utils/asyncChunk'
import { useAccountTree } from '@/composables/useAccountTree'
import { useAccountForm } from '@/composables/useAccountForm'
import { showSuccess, showError, showOperationError } from '@/composables/useMessage'
import { useDeleteConfirm } from '@/composables/useConfirm'
import { useColumnWidthMemory } from '@/composables/useColumnWidthMemory'
import { useOperationHistory } from '@/composables/useOperationHistory'
import { performanceMonitor } from '@/utils/performanceMonitor'
import { useBaseDataStore } from '@/stores/baseData'
import { normalizeImportCode } from '@/utils/textNormalize'
import { filterAuxCategoriesForAccount } from '@/utils/accountCashFlow'
import { exportStyledTable, type ExportColumnDef } from '@/utils/exportStyledExcel'
import {
  ACCOUNT_QUICK_FILTER_OPTIONS,
  buildAuxQuickFilterValue,
  filterAccountsWithAncestors,
} from '@/utils/accountQuickFilter'
import {
  collectImportAuxCategoryIds,
  collectReferencedAuxItemIds,
  fetchAuxItemsByCategory,
  fetchAuxItemsForImportDefaults,
  fetchAuxItemsByIds,
  findAuxItemByCategoryAndName,
} from '@/utils/accountAuxLookup'

const {
  taskProgressVisible,
  currentTaskId,
  currentTaskType,
  startAsyncTask,
} = useAsyncBatchTask()

const accountAuxSelect = useVoucherAuxItems()

const list = ref<any[]>([])
const keyword = ref('')
const quickFilterValues = ref<string[]>([])
const showDisabled = ref(false)
const tableRef = ref<any>(null)
const dialogVisible = ref(false)
const dialogType = ref<'add' | 'edit'>('add')
const saving = ref(false)
const repairingHierarchy = ref(false)
const auxCategories = ref<any[]>([])
const auxItemById = shallowRef(new Map<string, any>())
const auxItemsByCategory = shallowRef(new Map<string, any[]>())
const auxCategoriesLoaded = ref(false)
const auxCategoryLoading = new Set<string>()
const allAccountsForCode = ref<any[]>([])
const accountLevels = ref(6)
const accountCodeLengths = ref([4, 2, 2, 2, 2, 2, 2, 2, 2, 2])

type AddAccountCommand = 'sibling' | 'child'

const dialogTitle = computed(() => (dialogType.value === 'add' ? '新增科目' : '编辑科目'))

const effectiveList = computed(() => {
  let rows = list.value
  if (quickFilterValues.value.length > 0) {
    rows = filterAccountsWithAncestors(rows, quickFilterValues.value)
  }
  return rows
})

const {
  treeData,
  currentRow,
  expandedKeys,
  expandAll,
  collapseAll,
  goUpLevel,
  goDownLevel,
  handleCurrentChange,
  handleRowClick,
  restoreCurrentRow,
  flatList,
  getTreeSelectData,
  handleExpandChange,
} = useAccountTree(effectiveList, tableRef)

const {
  form,
  parentUsage,
  getAvailableCats,
  onAuxCatChange,
  addAux,
  removeAux,
  getAuxNames,
  createAddForm,
  createEditForm,
  buildSavePayload,
} = useAccountForm(auxCategories, {
  auxItemById,
  auxItemsByCategory,
})

const treeSelectData = computed(() => getTreeSelectData(form.value.id))

// 计算当前编辑科目的子科目数量
const childrenCount = computed(() => {
  if (!form.value?.id) return 0
  return flatList.value.filter(row => row.parent_id === form.value.id).length
})

// 搜索时直接用后端数据（扁平），非搜索时用树形结构
const displayData = computed(() => (keyword.value ? effectiveList.value : treeData.value))

const accountCountLabel = computed(() => {
  const total = list.value.length
  const filtered = keyword.value || quickFilterValues.value.length > 0
  if (!filtered) return `${total} 个科目`
  const shown = keyword.value ? effectiveList.value.length : flatList.value.length
  return `${shown} / ${total} 个科目`
})

const canAddChildAccount = computed(() => {
  const row = getCurrentAccountForCode()
  return Boolean(row && getAccountLevel(row) < accountLevels.value)
})

// 列宽记忆
const { getColumnWidth, onDragEnd, load, bindTable } = useColumnWidthMemory('account-table')
bindTable(tableRef)

// 搜索防抖
let searchTimer: ReturnType<typeof setTimeout> | null = null
let fetchDataSeq = 0

onBeforeUnmount(() => {
  if (searchTimer) clearTimeout(searchTimer)
})

function onSearchInput() {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    fetchData()
  }, 300)
}

function onSearchClear() {
  if (searchTimer) clearTimeout(searchTimer)
  keyword.value = ''
  fetchData()
}

function handleQuickFilterChange() {
  if (quickFilterValues.value.length > 0) {
    expandAll()
  }
}

// 操作历史
const { addRecord } = useOperationHistory()

// 搜索高亮（移除 v-html 以保持树形缩进）
function getDisplayText(text: string | number | null | undefined): string {
  if (text === null || text === undefined) return ''
  return String(text)
}

async function loadAuxCategoriesOnce() {
  if (auxCategoriesLoaded.value) return
  const catRes = await request.get<any[]>('/base/aux-categories')
  auxCategories.value = filterAuxCategoriesForAccount(catRes.data || [])
  auxCategoriesLoaded.value = true
}

function mergeAuxItemsIntoLookup(items: any[]) {
  if (items.length === 0) return
  const nextById = new Map(auxItemById.value)
  const nextByCategory = new Map(auxItemsByCategory.value)
  for (const item of items) {
    nextById.set(item.id, item)
    const catId = item.type
    if (!catId) continue
    const existing = nextByCategory.get(catId) || []
    if (!existing.some(row => row.id === item.id)) {
      nextByCategory.set(catId, [...existing, item])
    }
  }
  auxItemById.value = nextById
  auxItemsByCategory.value = nextByCategory
}

async function loadAuxItemsForCategory(categoryId: string) {
  if (!categoryId || auxItemsByCategory.value.has(categoryId) || auxCategoryLoading.has(categoryId)) {
    return
  }
  auxCategoryLoading.add(categoryId)
  try {
    const items = await fetchAuxItemsByCategory(categoryId)
    mergeAuxItemsIntoLookup(items)
  } finally {
    auxCategoryLoading.delete(categoryId)
  }
}

async function syncReferencedAuxItems(accounts: any[]) {
  const missingIds = collectReferencedAuxItemIds(accounts).filter(id => !auxItemById.value.has(id))
  if (missingIds.length === 0) return
  const items = await fetchAuxItemsByIds(missingIds)
  mergeAuxItemsIntoLookup(items)
}

async function ensureDialogAuxSelections() {
  for (const item of form.value.aux_list || []) {
    if (item.cat_id && item.item_id) {
      await accountAuxSelect.ensureSelectedItems(item.cat_id, [item.item_id])
    }
  }
}

function isAccountAuxSelectLoading(catId: string) {
  return !!accountAuxSelect.loadingByCategory.value[catId]
}

function handleAuxCatChange(item: any, val: string) {
  onAuxCatChange(item, val)
  if (item.cat_id && item.item_id) {
    void accountAuxSelect.ensureSelectedItems(item.cat_id, [item.item_id])
  }
}

function getLoadedAuxItemsFlat() {
  return [...auxItemsByCategory.value.values()].flat()
}

async function fetchData() {
  const currentSeq = ++fetchDataSeq
  // 每次整页刷新（含账套切换后重新进入）都重新加载辅助类别，避免跨账套缓存复用
  auxCategoriesLoaded.value = false
  await performanceMonitor.measure('fetchAccountData', async () => {
    const params: any = { is_enabled: showDisabled.value ? '' : 1, all: 1 }
    if (keyword.value) params.keyword = keyword.value
    const [accRes, allAccRes, paramRes] = await Promise.all([
      request.get<any[]>('/base/accounts', { params }),
      request.get<any[]>('/base/accounts', { params: { is_enabled: '', all: 1 } }),
      request.get<any[]>('/system/params'),
      loadAuxCategoriesOnce(),
    ])
    if (currentSeq !== fetchDataSeq) return
    list.value = accRes.data
    allAccountsForCode.value = allAccRes.data || []
    applyAccountCodeParams(paramRes.data || [])
    await syncReferencedAuxItems([...list.value, ...allAccountsForCode.value])
    await restoreCurrentRow()
  })
}

function applyAccountCodeParams(params: any[]) {
  for (const p of params) {
    if (p.param_key === 'account_levels') {
      accountLevels.value = parseInt(p.param_value) || 6
    } else if (p.param_key === 'account_code_lengths') {
      try {
        const lengths = JSON.parse(p.param_value)
        if (Array.isArray(lengths) && lengths.length > 0) {
          accountCodeLengths.value = lengths.map((len: any) => Number(len) || 2)
        }
      } catch {
        /* 保持默认级次长度 */
      }
    }
  }
}

function getCurrentAccountForCode() {
  const id = currentRow.value?.id
  if (!id) return null
  return allAccountsForCode.value.find(row => row.id === id) || currentRow.value
}

function normalizeParentId(parentId: any) {
  return parentId || null
}

function findAccountById(id: string | null | undefined) {
  if (!id) return null
  return allAccountsForCode.value.find(row => row.id === id) || null
}

function findParentByCodePrefix(account: any | null | undefined) {
  if (!account?.code) return null
  const code = String(account.code)
  let best: any = null
  for (const row of allAccountsForCode.value) {
    if (row.id === account.id) continue
    const parentCode = String(row.code || '')
    if (
      parentCode.length > 0 &&
      parentCode.length < code.length &&
      code.startsWith(parentCode) &&
      (!best || parentCode.length > String(best.code || '').length)
    ) {
      best = row
    }
  }
  return best
}

function getSegmentLength(level: number) {
  return accountCodeLengths.value[level - 1] || 2
}

function getCumulativeCodeLength(level: number) {
  return accountCodeLengths.value.slice(0, level).reduce((sum, len) => sum + (Number(len) || 0), 0)
}

function getLevelByCodeLength(code: string): number | null {
  for (let level = 1; level <= accountLevels.value; level++) {
    if (code.length === getCumulativeCodeLength(level)) return level
  }
  return null
}

function getCodeLengthDescription(level: number) {
  return accountCodeLengths.value.slice(0, level).join('-')
}

function validateAccountCodeByParams(): number | null {
  const code = String(form.value.code || '').trim()
  if (!code) {
    showError('请输入科目编码')
    return null
  }
  if (!/^\d+$/.test(code)) {
    showError('科目编码只能包含数字')
    return null
  }

  const parent = findAccountById(form.value.parent_id)
  const expectedLevel = parent ? getAccountLevel(parent) + 1 : getLevelByCodeLength(code)
  if (!expectedLevel || expectedLevel > accountLevels.value) {
    showError(`科目编码长度不符合当前科目长度设置（${accountCodeLengths.value.slice(0, accountLevels.value).join('-')}）`)
    return null
  }

  // 未选上级时，编码长度必须对应顶级科目，避免产生“无父的非顶级科目”
  if (!parent && expectedLevel !== 1) {
    showError(`该编码长度对应第${expectedLevel}级科目，请先选择上级科目（顶级科目编码应为${getSegmentLength(1)}位）`)
    return null
  }

  if (parent && !code.startsWith(String(parent.code || ''))) {
    showError('科目编码必须以上级科目编码开头')
    return null
  }

  const expectedLength = getCumulativeCodeLength(expectedLevel)
  if (code.length !== expectedLength) {
    showError(
      `第${expectedLevel}级科目编码长度应为${expectedLength}位（${getCodeLengthDescription(expectedLevel)}）`
    )
    return null
  }

  return expectedLevel
}

function getAccountLevel(row: any) {
  const code = String(row?.code || '').trim()
  const fromCode = getLevelByCodeLength(code)
  const explicitLevel = Number(row?.level)
  if (fromCode) {
    if (explicitLevel > 0 && explicitLevel !== fromCode) return fromCode
    return explicitLevel > 0 ? explicitLevel : fromCode
  }
  if (explicitLevel > 0) return explicitLevel

  const codeLength = code.length
  let cumulative = 0
  for (let index = 0; index < accountCodeLengths.value.length; index++) {
    cumulative += Number(accountCodeLengths.value[index]) || 0
    if (codeLength <= cumulative) return index + 1
  }
  return 1
}

function getSiblingAccounts(parentId: string | null, level: number) {
  const expectedLength = getCumulativeCodeLength(level)
  return allAccountsForCode.value.filter(row => {
    const sameParent = normalizeParentId(row.parent_id) === normalizeParentId(parentId)
    if (!sameParent) return false
    const code = String(row.code || '')
    return getAccountLevel(row) === level || code.length === expectedLength
  })
}

function buildNextCode(parent: any | null, level: number) {
  const segmentLength = getSegmentLength(level)
  const parentId = parent?.id || null
  const prefix = parent?.code ? String(parent.code) : ''
  const siblings = getSiblingAccounts(parentId, level)
  const maxNo = siblings.reduce((max, row) => {
    const code = String(row.code || '')
    if (!code.startsWith(prefix)) return max
    const suffixNo = parseInt(code.slice(prefix.length), 10)
    return Number.isFinite(suffixNo) ? Math.max(max, suffixNo) : max
  }, 0)
  const nextNo = maxNo + 1
  const maxNoInLevel = Math.pow(10, segmentLength) - 1
  if (nextNo > maxNoInLevel) return ''
  return `${prefix}${String(nextNo).padStart(segmentLength, '0')}`
}

function buildNextRootSiblingCode(currentAccount: any) {
  const segmentLength = getSegmentLength(1)
  const currentNo = parseInt(String(currentAccount?.code || ''), 10)
  if (!Number.isFinite(currentNo)) return buildNextCode(null, 1)

  const usedCodes = new Set(allAccountsForCode.value.map(row => String(row.code || '')))
  const maxNoInLevel = Math.pow(10, segmentLength) - 1
  for (let nextNo = currentNo + 1; nextNo <= maxNoInLevel; nextNo++) {
    const code = String(nextNo).padStart(segmentLength, '0')
    if (!usedCodes.has(code)) return code
  }
  return ''
}

function buildNextSiblingCode(currentAccount: any | null, parent: any | null, level: number) {
  if (currentAccount && !parent && getAccountLevel(currentAccount) === 1) {
    return buildNextRootSiblingCode(currentAccount)
  }
  return buildNextCode(parent, level)
}

async function loadParentUsage(parentId: string | null) {
  parentUsage.value = null
  if (!parentId) return
  // 迁移仅在新增「第一个子科目」时发生：父科目已有子科目则不提示
  const hasExistingChildren = allAccountsForCode.value.some(a => a.parent_id === parentId)
  if (hasExistingChildren) return
  try {
    const res = await request.get<any>(`/base/accounts/${parentId}/usage`)
    if (
      res.code === 0 &&
      (res.data.voucherCount > 0 || res.data.initBalanceCount > 0 || res.data.auxInitCount > 0)
    ) {
      parentUsage.value = res.data
    }
  } catch {
    /* 不阻塞新增科目 */
  }
}

async function handleAddAccountCommand(command: AddAccountCommand) {
  await openAddDialog(command)
}

async function openAddDialog(command: AddAccountCommand) {
  await loadAuxCategoriesOnce()
  dialogType.value = 'add'
  parentUsage.value = null

  const currentAccount = getCurrentAccountForCode()
  let parent: any | null = null
  let level = 1
  let direction = currentAccount?.direction || 'debit'

  if (command === 'child') {
    if (!currentAccount) {
      showError('请先选中一个科目')
      return
    }
    const currentLevel = getAccountLevel(currentAccount)
    if (currentLevel >= accountLevels.value) {
      showError('当前科目已经是最末级，不能再增加子科目')
      return
    }
    parent = currentAccount
    level = currentLevel + 1
    direction = currentAccount.direction || 'debit'
  } else if (currentAccount) {
    level = getAccountLevel(currentAccount)
    parent = findAccountById(currentAccount.parent_id) || findParentByCodePrefix(currentAccount)
    direction = currentAccount.direction || parent?.direction || 'debit'
  }

  const code =
    command === 'sibling'
      ? buildNextSiblingCode(currentAccount, parent, level)
      : buildNextCode(parent, level)
  if (!code) {
    showError('当前级次科目编码已用完')
    return
  }

  form.value = {
    ...createAddForm(parent?.id),
    parent_id: parent?.id || null,
    code,
    level,
    direction,
  }
  await loadParentUsage(parent?.id || null)
  dialogVisible.value = true
}

async function openDialog(type: 'edit', row?: any) {
  await loadAuxCategoriesOnce()
  dialogType.value = type
  parentUsage.value = null
  form.value = createEditForm(row)
  await ensureDialogAuxSelections()
  dialogVisible.value = true
}

function handleRowDblClick(row: any) {
  if (!row?.id) return
  currentRow.value = row
  tableRef.value?.setCurrentRow(row)
  openDialog('edit', row)
}

async function handleParentChange(parentId: string | null) {
  const parent = findAccountById(parentId)
  if (!parent) {
    form.value.parent_id = null
    form.value.code = buildNextCode(null, 1)
    form.value.level = 1
    await loadParentUsage(null)
    return
  }

  const parentLevel = getAccountLevel(parent)
  if (parentLevel >= accountLevels.value) {
    showError('当前科目已经是最末级，不能再增加子科目')
    form.value.parent_id = null
    return
  }

  const childLevel = parentLevel + 1
  const code = buildNextCode(parent, childLevel)
  if (!code) {
    showError('当前级次科目编码已用完')
    return
  }

  form.value.code = code
  form.value.direction = parent.direction || 'debit'
  form.value.level = childLevel
  await loadParentUsage(parent.id)
}

async function prepareNextAddFormAfterSave() {
  const savedParentId = form.value.parent_id || null
  const savedLevel = form.value.level
  const savedDirection = form.value.direction || 'debit'
  const savedCode = form.value.code
  const savedParent = findAccountById(savedParentId)

  const nextCode = buildNextSiblingCode(
    { code: savedCode, parent_id: savedParentId, level: savedLevel },
    savedParent,
    savedLevel
  )
  if (!nextCode) {
    showError('当前级次科目编码已用完')
    dialogVisible.value = false
    return
  }

  form.value = {
    ...createAddForm(savedParentId),
    parent_id: savedParentId,
    code: nextCode,
    level: savedLevel,
    direction: savedDirection,
    migrate_from_parent: false,
  }
  parentUsage.value = null
  await loadParentUsage(savedParentId)
}

async function handleSave(options?: { keepOpen?: boolean }) {
  saving.value = true
  try {
    const expectedLevel = dialogType.value === 'add' ? validateAccountCodeByParams() : null
    if (dialogType.value === 'add' && !expectedLevel) return

    const payload = buildSavePayload()
    if (dialogType.value === 'add' && expectedLevel) {
      payload.code = String(payload.code || '').trim()
      payload.level = expectedLevel
    }
    if (dialogType.value === 'add') {
      await request.post('/base/accounts', payload)
      showSuccess('科目新增成功')
      addRecord('create', '会计科目', `新增科目：${form.value.code} ${form.value.name}`)
      useBaseDataStore().invalidate()
      await fetchData()
      if (options?.keepOpen) {
        await prepareNextAddFormAfterSave()
      } else {
        dialogVisible.value = false
      }
    } else {
      await request.put(`/base/accounts/${form.value.id}`, payload)
      showSuccess('科目修改成功')
      addRecord('update', '会计科目', `修改科目：${form.value.code} ${form.value.name}`)
      useBaseDataStore().invalidate()
      dialogVisible.value = false
      await fetchData()
    }
  } catch (error) {
    showOperationError(dialogType.value === 'add' ? '新增科目' : '修改科目', error)
  } finally {
    saving.value = false
  }
}

async function handleSaveAndAdd() {
  if (dialogType.value !== 'add') return
  await handleSave({ keepOpen: true })
}

async function handleRepairHierarchy() {
  repairingHierarchy.value = true
  try {
    const res = await request.post<any>('/base/accounts/repair-hierarchy')
    if (res.code === 0) {
      showSuccess(res.message || '科目层级已修复')
      useBaseDataStore().invalidate()
      await fetchData()
    }
  } catch (error) {
    showOperationError('修复科目层级', error)
  } finally {
    repairingHierarchy.value = false
  }
}

async function handleDelete(row: any) {
  const confirmed = await useDeleteConfirm(`科目「${row.code} ${row.name}」`)
  if (!confirmed) return

  try {
    await request.delete(`/base/accounts/${row.id}`)
    showSuccess('删除成功')
    addRecord('delete', '会计科目', `删除科目：${row.code} ${row.name}`)
    fetchData()
  } catch (error) {
    showOperationError('删除科目', error)
  }
}

// ========== 导入导出 ==========
const importDialogVisible = ref(false)
const importPreview = ref<AccountImportRow[]>([])
const importUploadRef = ref<any>(null)
const importing = ref(false)
const importIssuesDialogVisible = ref(false)
const importBlankSkipped = ref(0)
const importTemplateWarning = ref<string | null>(null)
const importParsing = ref(false)
const importParseProgress = ref(0)
const importParseMessage = ref('')
const importIssues = ref<ReturnType<typeof collectAccountImportIssues>>([])
const importIssuesLoading = ref(false)
let importIssuesBuildToken = 0

const importMatchedCount = computed(() => importPreview.value.filter(r => r.matched).length)
const importIssueCount = computed(() => importPreview.value.filter(r => !r.matched).length)
const importSummary = computed(() =>
  buildAccountImportSummary({
    contentRowCount: importPreview.value.length,
    validCount: importMatchedCount.value,
    issueCount: importIssueCount.value,
    blankSkipped: importBlankSkipped.value,
    templateWarning: importTemplateWarning.value,
  })
)

function resetImportDialog() {
  importPreview.value = []
  importBlankSkipped.value = 0
  importTemplateWarning.value = null
  importIssuesDialogVisible.value = false
  importIssues.value = []
  importParsing.value = false
  importParseProgress.value = 0
  importParseMessage.value = ''
  importing.value = false
  importUploadRef.value?.clearFiles()
}

async function refreshImportIssuesAsync() {
  const token = ++importIssuesBuildToken
  importIssuesLoading.value = true
  importIssues.value = []
  try {
    await nextTick()
    await yieldToMain()
    importIssues.value = await aggregateImportIssuesAsync(
      importPreview.value,
      describeAccountRowIssue
    )
  } finally {
    if (token === importIssuesBuildToken) importIssuesLoading.value = false
  }
}

async function openImportIssuesDialog() {
  importIssuesDialogVisible.value = true
  await refreshImportIssuesAsync()
}

function openImportDialog() {
  resetImportDialog()
  importDialogVisible.value = true
}

function closeImportDialog() {
  importDialogVisible.value = false
}

// 辅助：根据上级科目编码找到 parent_id
function findParentId(parentCode: string, flatList: any[]): string | null {
  if (!parentCode) return null
  const parent = flatList.find(a => a.code === parentCode)
  return parent?.id || null
}

// 辅助：解析科目 aux_types，返回 { catId: itemId } 中 catId 对应的类别名和项目名
function parseAuxTypes(row: any): Record<string, string | null> {
  if (!row.aux_types) return {}
  try {
    const parsed = typeof row.aux_types === 'string' ? JSON.parse(row.aux_types) : row.aux_types
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

// 辅助：构建导出行的辅助类别列（每个类别一列"是/否" + 一列默认项目名）
function buildExportAuxCols(row: any): Record<string, string> {
  const auxMap = parseAuxTypes(row)
  const cols: Record<string, string> = {}
  for (const cat of auxCategories.value) {
    const enabled = cat.id in auxMap
    cols[`辅助-${cat.name}`] = enabled ? '是' : '否'
    if (enabled && auxMap[cat.id]) {
      const item = auxItemById.value.get(auxMap[cat.id]!)
      cols[`默认项目-${cat.name}`] = item ? item.name : ''
    } else {
      cols[`默认项目-${cat.name}`] = ''
    }
  }
  return cols
}

// 辅助：从导入行中解析辅助类别列为 aux_types 对象
function parseImportAuxCols(row: any): Record<string, any> | null {
  const result: Record<string, any> = {}
  for (const cat of auxCategories.value) {
    const auxKey = `辅助-${cat.name}`
    const defaultKey = `默认项目-${cat.name}`
    const val = String(row[auxKey] || '').trim()
    if (val === '是' || val === '1' || val === 'true') {
      const defaultItemName = String(row[defaultKey] || '').trim()
      if (defaultItemName) {
        const items = auxItemsByCategory.value.get(cat.id) || []
        const item = findAuxItemByCategoryAndName(items, defaultItemName)
        result[cat.id] = item?.id || cat.default_item_id || null
      } else {
        result[cat.id] = cat.default_item_id || null
      }
    }
  }
  return Object.keys(result).length > 0 ? result : null
}

async function exportData() {
  const allRes = await request.get<any[]>('/base/accounts', { params: { is_enabled: '', all: 1 } })
  const allAccounts = allRes.data
  await loadAuxCategoriesOnce()
  await syncReferencedAuxItems(allAccounts)

  const columns: ExportColumnDef[] = [
    {
      label: '科目编码',
      width: getColumnWidth('code', 120),
      value: row => row.code,
      indent: row => Math.max(0, (row.level || 1) - 1),
    },
    {
      label: '科目名称',
      width: getColumnWidth('name', 160),
      value: row => row.name,
      indent: row => Math.max(0, (row.level || 1) - 1),
    },
    {
      label: '方向',
      width: 76,
      align: 'center',
      value: row => (row.direction === 'debit' ? '借方' : '贷方'),
    },
    {
      label: '现金',
      width: 52,
      align: 'center',
      value: row => (row.is_cash ? '是' : ''),
    },
    {
      label: '银行',
      width: 52,
      align: 'center',
      value: row => (row.is_bank ? '是' : ''),
    },
    {
      label: '辅助核算',
      width: 220,
      value: row => getAuxNames(row).join('、'),
    },
    {
      label: '状态',
      width: 68,
      align: 'center',
      value: row => (row.is_enabled ? '启用' : '禁用'),
    },
  ]

  await exportStyledTable({
    fileName: '会计科目.xlsx',
    sheetName: '会计科目',
    title: '会计科目',
    columns,
    rows: allAccounts,
  })
}

async function downloadTemplate() {
  const { utils, writeFile } = await import('xlsx')
  // 基础列
  const baseCols: Record<string, string> = {
    科目编码: '1001',
    科目名称: '库存现金',
    余额方向: '借方',
    上级科目编码: '',
    现金: '是',
    银行: '',
  }
  // 动态辅助类别列
  for (const cat of auxCategories.value) {
    baseCols[`辅助-${cat.name}`] = '否'
    baseCols[`默认项目-${cat.name}`] = ''
  }
  baseCols['状态'] = '启用'

  const templateData = [baseCols]
  const ws = utils.json_to_sheet(templateData)
  const wb = utils.book_new()
  utils.book_append_sheet(wb, ws, '导入模板')
  writeFile(wb, '会计科目导入模板.xlsx')
}

function buildImportAuxDesc(row: Record<string, unknown>): string {
  const auxCatNames = auxCategories.value.map(c => c.name)
  return auxCatNames
    .filter(catName => {
      const val = String(row[`辅助-${catName}`] || '').trim()
      return val === '是' || val === '1' || val === 'true'
    })
    .map(catName => {
      const defaultItem = String(row[`默认项目-${catName}`] || '').trim()
      return defaultItem ? `${catName}:${defaultItem}` : catName
    })
    .join(', ')
}

async function onImportFileChange(file: UploadFile) {
  if (!file.raw || importParsing.value) return
  importParsing.value = true
  importParseProgress.value = 0
  importParseMessage.value = '正在读取 Excel 文件…'
  try {
    await nextTick()
    await yieldToMain()
    const arrayBuffer = await file.raw.arrayBuffer()
    await yieldToMain()
    importParseMessage.value = '正在解析工作表…'
    const { utils, read } = await import('xlsx')
    const workbook = read(arrayBuffer, { type: 'array' })
    const sheetName = workbook.SheetNames[0]
    const sheet = workbook.Sheets[sheetName]
    await yieldToMain()
    importParseMessage.value = '正在校验导入数据…'
    const rawData: Record<string, unknown>[] = utils.sheet_to_json(sheet, { defval: '' })

    if (rawData.length === 0) {
      showError('文件中没有数据')
      resetImportDialog()
      return
    }

    await loadAuxCategoriesOnce()
    importParseMessage.value = '正在匹配默认核算项目…'
    const auxItemByCatAndName = await fetchAuxItemsForImportDefaults(rawData, auxCategories.value)

    const existingCodes = new Set(flatList.value.map(a => normalizeImportCode(String(a.code))))
    const existingCodeToId = new Map(
      flatList.value.map(a => [normalizeImportCode(String(a.code)), a.id] as [string, string])
    )

    const { rows, blankSkipped, templateWarning } = await parseAccountImportRowsAsync(rawData, {
      existingCodes,
      existingCodeToId,
      auxCategories: auxCategories.value,
      auxItemByCatAndName,
      parseAuxCols: row => parseImportAuxCols(row),
      buildAuxDesc: buildImportAuxDesc,
    }, {
      onProgress: pct => {
        importParseProgress.value = pct
      },
    })
    importBlankSkipped.value = blankSkipped
    importTemplateWarning.value = templateWarning
    importPreview.value = rows
    importIssues.value = []
    if (rows.length > 0 && rows.every(r => !r.matched) && rows.some(r => r.error)) {
      void openImportIssuesDialog()
    }
  } catch (error) {
    showError('文件解析失败，请检查文件格式')
    console.error('Import parse error:', error)
    resetImportDialog()
  } finally {
    importParsing.value = false
    importParseMessage.value = ''
  }
}

async function handleImport() {
  const matched = importPreview.value.filter(r => r.matched)
  if (matched.length === 0) {
    if (importIssueCount.value > 0) void openImportIssuesDialog()
    return
  }
  importing.value = true
  const skipped = importPreview.value.length - matched.length

  try {
    await startAsyncTask('accounts-import', () =>
      request.post('/base/accounts/batch-import-async', {
        accounts: matched.map(({ rowIndex: _ri, matched: _m, error: _e, ...rest }) => rest),
      })
    )
    if (skipped > 0) {
      showSuccess(`已提交 ${matched.length} 条科目导入，另有 ${skipped} 行未通过校验已跳过`)
    }
    closeImportDialog()
  } catch (error) {
    showOperationError('批量导入', error)
    importUploadRef.value?.clearFiles()
  } finally {
    importing.value = false
  }
}

async function handleTaskCompleted() {
  await fetchData()
}

onMounted(fetchData)
onActivated(() => load())
</script>

<style scoped>
.page {
  height: calc(100vh - 60px);
  padding: 12px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--el-fill-color-lighter);
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  margin-bottom: 10px;
  flex-shrink: 0;
}

.page-header h3 {
  margin: 0;
  font-size: 18px;
  line-height: 1.2;
}

.account-title {
  display: flex;
  align-items: baseline;
  gap: 10px;
  min-width: 150px;
}

.account-title span {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.account-toolbar {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  flex-wrap: wrap;
}

.level-actions {
  flex-shrink: 0;
}

.account-search {
  width: 220px;
}

.account-quick-filter-wrap {
  position: relative;
  display: flex;
  align-items: center;
  width: 196px;
  flex-shrink: 0;
}

.account-quick-filter-badge {
  position: absolute;
  left: 7px;
  z-index: 2;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 5px;
  color: #007aff;
  background: rgba(0, 122, 255, 0.1);
  pointer-events: none;
  transition: all 0.2s ease;
}

.account-quick-filter-badge .el-icon {
  font-size: 11px;
}

.account-quick-filter-badge em {
  position: absolute;
  top: -4px;
  right: -6px;
  min-width: 14px;
  height: 14px;
  padding: 0 3px;
  border-radius: 999px;
  background: linear-gradient(135deg, #007aff 0%, #0056d6 100%);
  color: #fff;
  font-style: normal;
  font-size: 9px;
  font-weight: 700;
  line-height: 14px;
  text-align: center;
  box-shadow: 0 1px 4px rgba(0, 122, 255, 0.35);
}

.account-quick-filter-wrap.is-active .account-quick-filter-badge {
  color: #fff;
  background: linear-gradient(135deg, #007aff 0%, #0056d6 100%);
  box-shadow: 0 2px 8px rgba(0, 122, 255, 0.28);
}

.account-quick-filter {
  width: 100%;
}

.account-quick-filter :deep(.el-select__wrapper) {
  min-height: 28px !important;
  height: 28px !important;
  padding: 0 24px 0 30px !important;
  border-radius: 8px !important;
  background: rgba(255, 255, 255, 0.92) !important;
  border: 1px solid rgba(0, 0, 0, 0.08) !important;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.8);
  transition: all 0.2s ease;
  font-size: 12px !important;
  line-height: 26px !important;
}

.account-quick-filter :deep(.el-select__wrapper:hover) {
  border-color: rgba(0, 122, 255, 0.28) !important;
}

.account-quick-filter :deep(.el-select__wrapper.is-focused) {
  border-color: rgba(0, 122, 255, 0.45) !important;
  box-shadow:
    0 0 0 3px rgba(0, 122, 255, 0.12),
    inset 0 1px 0 rgba(255, 255, 255, 0.8) !important;
}

.account-quick-filter-wrap.is-active :deep(.el-select__wrapper) {
  background: linear-gradient(180deg, rgba(0, 122, 255, 0.06) 0%, rgba(255, 255, 255, 0.96) 100%) !important;
  border-color: rgba(0, 122, 255, 0.24) !important;
}

.account-quick-filter :deep(.el-select__placeholder) {
  color: #86868b;
  font-size: 11px;
}

.account-quick-filter :deep(.el-select__selected-item .el-tag) {
  height: 18px;
  padding: 0 5px;
  border: none;
  border-radius: 999px;
  background: rgba(0, 122, 255, 0.1);
  color: #007aff;
  font-size: 10px;
  font-weight: 600;
  line-height: 18px;
}

.account-quick-filter :deep(.el-select__selected-item .el-tag .el-tag__close) {
  color: #007aff;
}

.account-quick-filter :deep(.el-select__selection) {
  gap: 2px;
}

.quick-filter-option {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  min-height: 24px;
}

.quick-filter-option__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 6px;
  flex-shrink: 0;
}

.quick-filter-option__icon .el-icon {
  font-size: 12px;
}

.quick-filter-option__icon.is-success {
  background: rgba(52, 199, 89, 0.12);
  color: #34c759;
}

.quick-filter-option__icon.is-primary {
  background: rgba(0, 122, 255, 0.12);
  color: #007aff;
}

.quick-filter-option__icon.is-warning {
  background: rgba(255, 149, 0, 0.12);
  color: #ff9500;
}

.quick-filter-option__icon.is-aux {
  background: rgba(175, 82, 222, 0.12);
  color: #af52de;
}

.quick-filter-option__label {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  color: #1d1d1f;
  font-weight: 500;
}

.disabled-switch {
  margin-left: 2px;
}

.account-table {
  flex: 1;
  min-height: 0;
  border-radius: 6px;
  overflow: hidden;
}

.account-code {
  font-family: 'SF Mono', 'Menlo', 'Consolas', monospace;
  color: var(--el-color-primary);
  font-weight: 600;
  line-height: 1.2;
}

.account-name {
  color: var(--el-text-color-primary);
  font-weight: 500;
  line-height: 1.2;
}

.mini-flag {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 20px;
  height: 18px;
  padding: 0 5px;
  border-radius: 4px;
  background: var(--el-color-success-light-9);
  color: var(--el-color-success);
  font-size: 12px;
  line-height: 1;
}

.mini-flag.bank {
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
}

.aux-tags {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  overflow: hidden;
}

.import-tips {
  margin-bottom: 16px;
  font-size: 13px;
  color: #606266;
  line-height: 1.8;
}
.import-tips p {
  margin: 0;
}
.import-preview {
  margin-top: 16px;
}
.import-preview-more {
  margin-top: 8px;
  font-size: 12px;
  color: #909399;
}
.import-parsing {
  margin-top: 12px;
}
.import-parsing__text {
  margin: 8px 0 0;
  font-size: 12px;
  color: #909399;
  text-align: center;
}
.import-more-hint {
  text-align: center;
  color: #909399;
  font-size: 12px;
  margin-top: 8px;
}

:deep(.el-table .el-table__cell) {
  overflow: hidden;
}

:deep(.account-table .el-table__cell) {
  padding: 2px 0 !important;
}

:deep(.account-table th.el-table__cell) {
  padding: 5px 0 !important;
  background: var(--el-fill-color-light) !important;
  color: var(--cw-text-primary);
  font-family: var(--cw-table-header-font-family);
  font-size: var(--cw-table-header-font-size);
  font-weight: var(--cw-table-header-font-weight);
}

:deep(.account-table .el-table__row) {
  height: 30px;
}

:deep(.account-table .cell) {
  min-height: 24px;
  line-height: 24px;
  padding: 0 6px !important;
}

:deep(.account-table .el-tag) {
  height: 20px;
  padding: 0 6px;
  border-radius: 4px;
  font-size: 12px;
}

:deep(.account-table .el-button--small) {
  height: 22px;
  padding: 0 4px;
}

:deep(.account-table .el-table__expand-icon) {
  width: 18px;
  height: 18px;
  margin-right: 2px;
}

:deep(.el-table .cell) {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

@media (max-width: 1100px) {
  .page-header {
    align-items: flex-start;
  }

  .account-toolbar {
    justify-content: flex-start;
  }

  .account-search {
    width: 180px;
  }

  .account-quick-filter-wrap {
    width: 168px;
  }
}
</style>

<style>
.account-quick-filter-popper.el-popper {
  border: 1px solid rgba(0, 0, 0, 0.06) !important;
  border-radius: 10px !important;
  box-shadow: 0 12px 28px rgba(0, 0, 0, 0.1) !important;
  overflow: hidden;
  padding: 4px !important;
}

.account-quick-filter-popper .el-select-dropdown__list {
  padding: 0;
}

.account-quick-filter-popper .el-select-group__title {
  padding: 4px 8px 2px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: #86868b;
  line-height: 1.2;
}

.account-quick-filter-popper .el-select-dropdown__item {
  height: auto;
  min-height: 30px;
  padding: 2px 6px;
  margin: 1px 0;
  border-radius: 6px;
  line-height: 1.2;
}

.account-quick-filter-popper .el-select-dropdown__item.is-selected {
  background: rgba(0, 122, 255, 0.08) !important;
  color: inherit !important;
  font-weight: 500;
}

.account-quick-filter-popper .el-select-dropdown__item.is-selected::after {
  color: #007aff !important;
  font-size: 12px !important;
  right: 8px !important;
}

.account-quick-filter-popper .el-select-dropdown__item.hover,
.account-quick-filter-popper .el-select-dropdown__item:hover {
  background: rgba(0, 0, 0, 0.04) !important;
}

.account-quick-filter-popper .el-select-dropdown__item.is-selected.hover,
.account-quick-filter-popper .el-select-dropdown__item.is-selected:hover {
  background: rgba(0, 122, 255, 0.12) !important;
}
</style>
