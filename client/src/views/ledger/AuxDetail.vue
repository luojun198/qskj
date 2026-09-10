<template>
  <div class="page page-ledger page-ledger-aux">
    <div class="page-header">
      <div class="header-left">
        <h3>辅助项目明细账</h3>
        <div class="filter-hint">
          <span class="filter-hint-label">当前筛选：</span>
          <span class="filter-hint-text">{{ filterHintText }}</span>
        </div>
      </div>
      <div class="header-right">
        <DrillDownReturnButton />
        <el-button type="primary" @click="drawerVisible = true">
          <el-icon><Filter /></el-icon>
          筛选
        </el-button>
        <el-divider direction="vertical" />
        <el-button plain size="small" @click="columnDialogVisible = true"><el-icon><Setting /></el-icon>列设置</el-button>
        <el-button plain :loading="loadingAll" @click="handleLoadAll">全部加载</el-button>
        <el-button
          plain
          :loading="exportProgress.visible"
          :disabled="exportProgress.visible"
          @click="exportData"
        >
          <el-icon><Download /></el-icon>
          导出 Excel
        </el-button>
        <el-button plain :disabled="list.length === 0" @click="printPage">
          <el-icon><Printer /></el-icon>
          打印
        </el-button>
      </div>
    </div>
    <AccountScopeAlert />

    <!-- 筛选抽屉 -->
    <el-drawer
      v-model="drawerVisible"
      title="筛选条件"
      direction="rtl"
      size="480px"
      :close-on-click-modal="false"
    >
      <div class="drawer-content">
        <div class="filter-item">
          <label>辅助类别</label>
          <el-select
            v-model="filters.aux_category_ids"
            multiple
            filterable
            clearable
            placeholder="选择辅助类别（可多选）"
            style="width: 100%"
            @change="onAuxCategoryChange"
          >
            <el-option
              v-for="cat in auxCategories"
              :key="cat.id"
              :label="cat.name"
              :value="cat.id"
            />
          </el-select>
        </div>

        <div class="filter-item">
          <label>辅助项目</label>
          <el-input
            v-if="hasAuxCategorySelected"
            v-model="auxItemSearchKeyword"
            placeholder="快速检索项目（编码/名称）"
            clearable
            style="margin-bottom: 8px"
          >
            <template #prefix>
              <el-icon><Search /></el-icon>
            </template>
          </el-input>
          <div
            v-if="hasAuxCategorySelected"
            v-loading="auxItemsLoading || auxItemSearching"
            class="checkbox-list"
          >
            <template v-for="catGroup in filteredAuxItemsByCategory" :key="catGroup.categoryId">
              <div class="category-group" v-if="catGroup.needsSearch">
                <div class="category-header">
                  <div class="category-label">{{ catGroup.categoryName }}</div>
                </div>
                <div class="empty-hint">
                  共 {{ catGroup.totalCount.toLocaleString() }} 个项目，请输入上方关键词检索后勾选
                </div>
              </div>
              <div class="category-group" v-else-if="catGroup.items.length > 0">
                <div class="category-header">
                  <div class="category-label">{{ catGroup.categoryName }}</div>
                  <div class="category-actions">
                    <el-button link size="small" @click="selectCategoryItems(catGroup.categoryId)"
                      >全选</el-button
                    >
                    <el-button
                      link
                      size="small"
                      @click="invertCategorySelection(catGroup.categoryId)"
                      >反选</el-button
                    >
                    <el-button
                      link
                      size="small"
                      @click="clearCategorySelection(catGroup.categoryId)"
                      >清空</el-button
                    >
                  </div>
                </div>
                <div
                  class="category-items cw-grouped-checkbox-items cw-grouped-checkbox-items--stack"
                >
                  <el-checkbox
                    v-for="item in catGroup.items"
                    :key="item.id"
                    v-model="itemCheckMap[item.id]"
                    @change="onItemCheckChange"
                  >
                    {{ item.code }} {{ item.name }}
                  </el-checkbox>
                </div>
                <div v-if="catGroup.truncated" class="empty-hint">
                  匹配结果较多，仅显示前 {{ AUX_FILTER_SEARCH_LIMIT }} 项，请输入更精确的关键词
                </div>
              </div>
              <div class="category-group" v-else>
                <div class="category-header">
                  <div class="category-label">{{ catGroup.categoryName }}</div>
                </div>
                <div class="empty-hint">无匹配项目</div>
              </div>
            </template>
          </div>
          <div v-else class="empty-hint">请先选择辅助类别</div>
        </div>

        <div class="filter-item">
          <label>日期范围</label>
          <div class="date-range">
            <el-date-picker
              v-model="filters.start_date"
              type="date"
              value-format="YYYY-MM-DD"
              placeholder="开始日期"
              style="width: 48%"
            />
            <span class="date-separator">至</span>
            <el-date-picker
              v-model="filters.end_date"
              type="date"
              value-format="YYYY-MM-DD"
              placeholder="结束日期"
              style="width: 48%"
            />
          </div>
        </div>

        <el-divider>高级筛选</el-divider>

        <div class="filter-item">
          <label>科目编码</label>
          <el-input v-model="filters.account_code" placeholder="科目编码" clearable />
        </div>

        <div class="filter-item">
          <label>摘要关键词</label>
          <el-input v-model="filters.summary_keyword" placeholder="摘要关键词" clearable />
        </div>

        <div class="filter-item">
          <label>金额范围</label>
          <div class="amount-range">
            <el-input
              v-model="filters.min_amount"
              placeholder="最小金额"
              clearable
              style="width: 48%"
            />
            <span class="amount-separator">至</span>
            <el-input
              v-model="filters.max_amount"
              placeholder="最大金额"
              clearable
              style="width: 48%"
            />
          </div>
        </div>

        <div class="filter-item">
          <label>制单人</label>
          <el-input v-model="filters.maker_name" placeholder="制单人" clearable />
        </div>

        <div class="filter-item">
          <label>审核人</label>
          <el-input v-model="filters.auditor_name" placeholder="审核人" clearable />
        </div>

        <div class="filter-item">
          <el-checkbox v-model="filters.include_unposted"> 统计未记账凭证 </el-checkbox>
        </div>
      </div>

      <template #footer>
        <div class="drawer-footer">
          <el-button @click="resetFilters">重置</el-button>
          <el-button type="primary" @click="handleQuery">查询</el-button>
        </div>
      </template>
    </el-drawer>

    <div
      v-loading="loading"
      ref="tableContainerRef"
      class="table-summary-scroll table-summary-scroll--wide table-summary-scroll--flow"
    >
      <el-table
        :key="auxTableColumnKey"
        ref="tableRef"
        :height="tableHeight"
        :data="list"
        :style="{ width: `${auxTableWidth}px` }"
        :fit="false"
        border
        size="small"
        class="compact-data-table"
        highlight-current-row
        show-summary
        :summary-method="getSummaries"
        :row-class-name="getRowClassName"
        @header-dragend="onDragEnd"
        @row-dblclick="handleLedgerRowDblClick"
      >
        <el-table-column v-for="column in visibleCols.filter(item => item.visible)" :key="column.prop"
          :column-key="column.prop" :prop="column.dynamic ? undefined : column.prop" :label="column.label"
          :width="colWidth(column.prop, AUX_DETAIL_COL_FALLBACK[column.prop] ?? 120)" :align="auxColumnAlign(column.prop)">
          <template #default="{ row }">{{ auxColumnCellText(row, column) }}</template>
        </el-table-column>
      </el-table>
    </div>
    <ColumnSettingsDialog v-model="columnDialogVisible" :columns="columnDialogSettings" @update:columns="updateColumnSettings" @reset="resetColumnSettings" />

    <!-- 分页 -->
    <div class="pagination">
      <el-pagination
        v-model:current-page="currentPage"
        v-model:page-size="pageSize"
        :page-sizes="[10, 20, 50, 100, 200, 500]"
        :total="total"
        layout="total, sizes, prev, pager, next, jumper"
        @size-change="handleSizeChange"
        @current-change="handlePageChange"
      />
    </div>

    <VoucherEntryDialogHost ref="entryDialogHostRef" @saved="fetchData" />

    <ExportProgressOverlay
      :visible="exportProgress.visible"
      :title="exportProgress.title"
      :message="exportProgress.message"
      :percent="exportProgress.percentDisplay"
    />

    <HiprintDialog
      v-model="hiprintVisible"
      template-type="ledger"
      template-key="ledger:aux-detail"
      title="辅助项目明细账"
      :get-print-html="buildPrintHtml"
      default-paper="A4"
      default-orientation="landscape"
      :use-templates="false"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onActivated } from 'vue'
import { useRoute } from 'vue-router'
import { storeToRefs } from 'pinia'
import { Filter, Search, Download, Setting, Printer } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import request from '@/api/request'
import type { TableColumnCtx } from 'element-plus'
import DrillDownReturnButton from '@/components/common/DrillDownReturnButton.vue'
import AccountScopeAlert from '@/components/AccountScopeAlert.vue'
import VoucherEntryDialogHost from '@/components/voucher/VoucherEntryDialogHost.vue'
import { useAuxWideTable } from '@/composables/useColumnWidthMemory'
import { useFillHeightTable } from '@/composables/useFillHeightTable'
import {
  useLedgerVoucherNavigate,
  resolveLedgerVoucherId,
} from '@/composables/useLedgerVoucherNavigate'
import { useVoucherModalRestore } from '@/composables/useVoucherModalRestore'
import { formatAmount } from '@/utils/format'
import { filterAuxCategoriesForAccount } from '@/utils/accountCashFlow'
import { fetchAuxItemsPage } from '@/composables/useAuxItemsPage'
import { useDebounce } from '@/composables/useDebounceThrottle'
import { useConfirm } from '@/composables/useConfirm'
import { useExportProgress } from '@/composables/useExportProgress'
import ExportProgressOverlay from '@/components/export/ExportProgressOverlay.vue'
import { exportStyledTableViaServer, type ExportColumnDef } from '@/utils/exportStyledExcel'
import { buildAuxDetailExportSummaryValues } from '@/utils/ledgerExportBuilders'
import { yieldToMain } from '@/utils/asyncChunk'
import {
  applyEntryToSignedBalance,
  formatEndBalanceDirection,
  formatSignedBalanceAmount,
  formatSignedBalanceDisplay,
  splitBalanceToDebitCredit,
} from '@/utils/exportLedgerHelpers'
import HiprintDialog from '@/components/print/HiprintDialog.vue'
import { buildTablePrintHtml } from '@/utils/printTemplateHiprint'
import { useUserStore } from '@/stores/user'
import ColumnSettingsDialog from '@/components/common/ColumnSettingsDialog.vue'
import { loadColumnSettings, saveColumnSettings, type ColumnSetting } from '@/utils/columnSettings'

const exportProgress = useExportProgress('正在导出辅助项目明细账')

const route = useRoute()
const VIS_COL_KEY = 'ledger-aux-detail-cols-visible'

interface ColSetting {
  prop: string
  label: string
  visible: boolean
  dynamic?: boolean
  group?: string
}

const baseVisibleCols: ColSetting[] = [
  { prop: 'category_name', label: '辅助类别', visible: true },
  { prop: 'aux_name', label: '辅助项目', visible: true },
  { prop: 'voucher_date', label: '日期', visible: true },
  { prop: 'voucher_no', label: '凭证号', visible: true },
  { prop: 'account_code', label: '科目编码', visible: true },
  { prop: 'account_name', label: '科目名称', visible: true },
  { prop: 'summary', label: '摘要', visible: true },
  { prop: '借方', label: '借方', visible: true },
  { prop: '贷方', label: '贷方', visible: true },
  { prop: '方向', label: '方向', visible: true },
  { prop: '余额', label: '余额', visible: true },
]

function toColumnSettings(columns: ColSetting[]): ColumnSetting[] {
  return columns.map(column => ({ key: column.prop, label: column.label, visible: column.visible, group: column.group }))
}
function fromColumnSettings(columns: ColumnSetting[]): ColSetting[] {
  return columns.map(column => ({ prop: column.key, label: column.label, visible: column.visible, group: column.group, dynamic: visibleCols.value?.find(current => current.prop === column.key)?.dynamic }))
}
const initialColumns = loadColumnSettings(VIS_COL_KEY, toColumnSettings(baseVisibleCols))
const visibleCols = ref<ColSetting[]>(initialColumns.map(column => ({ prop: column.key, label: column.label, visible: column.visible, group: column.group })))
const columnDialogVisible = ref(false)
const columnDialogSettings = computed(() => toColumnSettings(visibleCols.value))

function restoreVisibleCols() {
  visibleCols.value = fromColumnSettings(loadColumnSettings(VIS_COL_KEY, toColumnSettings(visibleCols.value)))
}

function saveVisibleCols() {
  saveColumnSettings(VIS_COL_KEY, toColumnSettings(visibleCols.value))
}

function updateColumnSettings(columns: ColumnSetting[]) { visibleCols.value = fromColumnSettings(columns); saveVisibleCols() }
function resetColumnSettings() {
  const dynamic = visibleCols.value.filter(column => column.dynamic).map(column => ({ ...column, visible: true }))
  updateColumnSettings(toColumnSettings([...baseVisibleCols.map(column => ({ ...column })), ...dynamic]))
}

function getColVisible(prop: string) {
  return visibleCols.value.find(c => c.prop === prop)?.visible ?? true
}

function auxColumnAlign(prop: string) { return ['借方', '贷方', '余额'].includes(prop) ? 'right' : prop === '方向' ? 'center' : undefined }
function auxColumnCellText(row: any, column: ColSetting) {
  if (column.dynamic) {
    const cat = activeCategoryColumns.value.find(item => column.prop.startsWith(`${item.code}_`))
    if (!cat || row.category_code !== cat.code) return ''
    return row.field_values?.[column.prop.slice(cat.code.length + 1)] ?? ''
  }
  if (column.prop === '借方') {
    if (row.is_monthly_subtotal) return formatAmount(row.monthly_debit)
    if (row.is_yearly_subtotal) return formatAmount(row.yearly_debit)
    return row.direction === 'debit' ? formatAmount(row.amount) : ''
  }
  if (column.prop === '贷方') {
    if (row.is_monthly_subtotal) return formatAmount(row.monthly_credit)
    if (row.is_yearly_subtotal) return formatAmount(row.yearly_credit)
    return row.direction === 'credit' ? formatAmount(row.amount) : ''
  }
  if (column.prop === '方向') return formatRunningBalanceDirection(row)
  if (column.prop === '余额') return formatSignedBalanceDisplay(row.running_balance)
  return row[column.prop] ?? ''
}

const {
  containerRef: tableContainerRef,
  tableHeight,
  relayoutAfterData,
} = useFillHeightTable({ flow: true })
const list = ref<any[]>([])
const auxCategories = ref<any[]>([])
const auxItemsMap = ref<Record<string, any[]>>({})
const drawerVisible = ref(false)
const itemCheckMap = ref<Record<string, boolean>>({})
const categoryFields = ref<Record<string, { fields: { field_key: string; field_name: string }[] }>>(
  {}
)
// 辅助项目搜索关键词
const auxItemSearchKeyword = ref('')
/** 大类别检索时最多渲染的匹配项数，避免一次性渲染海量复选框卡死 */
const AUX_FILTER_SEARCH_LIMIT = 200
/** 单类别加载到内存做客户端过滤的项目上限（超过则改用服务端检索） */
const AUX_FILTER_CLIENT_LOAD_LIMIT = 500
/** 每个类别的项目总数 */
const auxItemTotals = ref<Record<string, number>>({})
/** 大类别服务端检索结果（按关键词） */
const auxItemSearchResults = ref<Record<string, any[]>>({})
/** 检索结果是否被截断 */
const auxItemSearchTruncated = ref<Record<string, boolean>>({})
/** 项目加载/检索中标志 */
const auxItemsLoading = ref(false)
const auxItemSearching = ref(false)
/** 防抖关键词：客户端过滤与服务端检索都基于它 */
const debouncedAuxKeyword = useDebounce(auxItemSearchKeyword, 300)
// 分页状态
const total = ref(0)
const currentPage = ref(1)
const pageSize = ref(50)
// 加载状态
const loading = ref(false)
const loadingAll = ref(false)
const queryAccountDirection = ref<'debit' | 'credit'>('debit')

/** 明细账一次拉取上限（与导出一致） */
const LOAD_ALL_PAGE_SIZE = 1000

const year = new Date().getFullYear()

const filters = ref<any>({
  aux_category_ids: [],
  aux_ids: [],
  start_date: `${year}-01-01`,
  end_date: `${year}-12-31`,
  account_code: '',
  summary_keyword: '',
  min_amount: '',
  max_amount: '',
  maker_name: '',
  auditor_name: '',
  include_unposted: true,
})

const entryDialogHostRef = ref<InstanceType<typeof VoucherEntryDialogHost> | null>(null)
const { tryRestoreVoucherModal } = useVoucherModalRestore(entryDialogHostRef)

const { handleLedgerRowDblClick } = useLedgerVoucherNavigate({
  returnLabel: '辅助项目明细账',
  getReturnQuery: () => ({
    aux_category_ids: (filters.value.aux_category_ids || []).join(','),
    aux_ids: (filters.value.aux_ids || []).join(','),
    account_code: filters.value.account_code || '',
    start_date: filters.value.start_date || '',
    end_date: filters.value.end_date || '',
  }),
  openVoucherModal: row => {
    // 忽略小计行和期初余额行
    if (row.is_monthly_subtotal || row.is_yearly_subtotal || row.is_opening_balance) {
      return
    }

    const voucherId = resolveLedgerVoucherId(row)
    if (!voucherId) return
    entryDialogHostRef.value?.open({
      _voucherId: voucherId,
      id: voucherId,
      status: row.voucher_status,
    })
  },
})

// 当前查询结果中实际出现的类别，按选择顺序排列，用于动态列
// 筛选摘要（打印副标题等复用）
const filterSummaryText = computed(() => buildAuxDetailFilterParts().join('；'))

const filterHintText = computed(() => {
  if (!filters.value.aux_category_ids?.length) {
    return '未设置筛选条件，请点击右侧「筛选」'
  }
  return filterSummaryText.value
})

function buildAuxDetailFilterParts(): string[] {
  const parts: string[] = []
  const catIds = filters.value.aux_category_ids as string[] | undefined
  if (catIds?.length) {
    const catNames = catIds
      .map(id => auxCategories.value.find(c => c.id === id)?.name)
      .filter(Boolean) as string[]
    if (catNames.length) {
      const label =
        catNames.length <= 3
          ? catNames.join('、')
          : `${catNames.slice(0, 3).join('、')} 等 ${catNames.length} 类`
      parts.push(`类别：${label}`)
    }
  }
  const auxIds = filters.value.aux_ids as string[] | undefined
  if (auxIds?.length) {
    parts.push(`项目：已选 ${auxIds.length} 个`)
  } else if (catIds?.length) {
    parts.push('项目：未选择')
  }
  if (filters.value.start_date || filters.value.end_date) {
    parts.push(`日期：${filters.value.start_date || '…'} 至 ${filters.value.end_date || '…'}`)
  }
  if (filters.value.account_code) {
    parts.push(`科目：${filters.value.account_code}`)
  }
  if (filters.value.summary_keyword) {
    parts.push(`摘要：${filters.value.summary_keyword}`)
  }
  if (filters.value.min_amount || filters.value.max_amount) {
    parts.push(
      `金额：${filters.value.min_amount || '不限'} 至 ${filters.value.max_amount || '不限'}`
    )
  }
  if (filters.value.maker_name) {
    parts.push(`制单人：${filters.value.maker_name}`)
  }
  if (filters.value.auditor_name) {
    parts.push(`审核人：${filters.value.auditor_name}`)
  }
  parts.push(filters.value.include_unposted ? '含未记账凭证' : '仅已记账凭证')
  return parts
}

// 是否已选辅助类别（控制筛选输入框/列表显示）
const hasAuxCategorySelected = computed(() => (filters.value.aux_category_ids?.length || 0) > 0)

// 按类别分组的项目列表（含检索）：
// 小类别（≤ AUX_FILTER_CLIENT_LOAD_LIMIT）内存过滤；大类别未输入关键词时提示「请检索」，
// 输入后用服务端检索结果（已截断到 AUX_FILTER_SEARCH_LIMIT）。
const filteredAuxItemsByCategory = computed(() => {
  const keyword = debouncedAuxKeyword.value.trim().toLowerCase()
  const catIds: string[] = filters.value.aux_category_ids || []
  return catIds.map((catId: string) => {
    const cat = auxCategories.value.find(c => c.id === catId)
    const categoryName = cat ? cat.name : catId
    const totalCount = auxItemTotals.value[catId] ?? (auxItemsMap.value[catId]?.length || 0)
    const isLarge = totalCount > AUX_FILTER_CLIENT_LOAD_LIMIT

    if (isLarge) {
      if (!keyword) {
        return {
          categoryId: catId,
          categoryName,
          items: [] as any[],
          totalCount,
          needsSearch: true,
          truncated: false,
        }
      }
      return {
        categoryId: catId,
        categoryName,
        items: auxItemSearchResults.value[catId] || [],
        totalCount,
        needsSearch: false,
        truncated: !!auxItemSearchTruncated.value[catId],
      }
    }

    const loaded = auxItemsMap.value[catId] || []
    const items = keyword
      ? loaded.filter((item: any) => {
          const code = (item.code || '').toLowerCase()
          const name = (item.name || '').toLowerCase()
          return code.includes(keyword) || name.includes(keyword)
        })
      : loaded
    return {
      categoryId: catId,
      categoryName,
      items,
      totalCount,
      needsSearch: false,
      truncated: false,
    }
  })
})

/** 大类别：按关键词到服务端检索匹配项目（防抖触发，结果有上限） */
async function searchLargeAuxItems(keyword: string) {
  const catIds: string[] = filters.value.aux_category_ids || []
  const largeCatIds = catIds.filter(
    id => (auxItemTotals.value[id] ?? 0) > AUX_FILTER_CLIENT_LOAD_LIMIT
  )
  if (!keyword || largeCatIds.length === 0) {
    auxItemSearchResults.value = {}
    auxItemSearchTruncated.value = {}
    return
  }
  auxItemSearching.value = true
  try {
    const results: Record<string, any[]> = {}
    const truncated: Record<string, boolean> = {}
    for (const categoryId of largeCatIds) {
      const { items, total } = await fetchAuxItemsPage({
        category_id: categoryId,
        keyword,
        status: 'active',
        page: 1,
        pageSize: AUX_FILTER_SEARCH_LIMIT,
      })
      results[categoryId] = items
      truncated[categoryId] = total > items.length
    }
    auxItemSearchResults.value = results
    auxItemSearchTruncated.value = truncated
  } catch (error) {
    console.error('检索辅助项目失败:', error)
  } finally {
    auxItemSearching.value = false
  }
}

watch(debouncedAuxKeyword, kw => {
  void searchLargeAuxItems(String(kw || '').trim())
})

const activeCategoryColumns = computed(() => {
  const selectedCatIds = filters.value.aux_category_ids as string[]
  const result: {
    code: string
    name: string
    fields: { field_key: string; field_name: string }[]
  }[] = []
  for (const catId of selectedCatIds) {
    const cat = auxCategories.value.find(c => c.id === catId)
    if (!cat) continue
    const meta = categoryFields.value[cat.code]
    result.push({
      code: cat.code,
      name: cat.name,
      fields: meta?.fields || [],
    })
  }
  return result
})

const discoveredDynamicCols = computed<ColSetting[]>(() => {
  const result: ColSetting[] = []
  for (const cat of activeCategoryColumns.value) {
    for (const field of cat.fields) {
      const prop = `${cat.code}_${field.field_key}`
      result.push({
        prop,
        label: field.field_name,
        visible: true,
        dynamic: true,
        group: cat.name,
      })
    }
  }
  return result
})

watch(
  discoveredDynamicCols,
  dynamic => {
    const defaults = [...baseVisibleCols.map(column => ({ ...column })), ...dynamic.map(column => ({ ...column }))]
    const defaultsByKey = new Map(defaults.map(column => [column.prop, column]))
    visibleCols.value = loadColumnSettings(VIS_COL_KEY, toColumnSettings(defaults)).map(column => ({
      ...defaultsByKey.get(column.key)!,
      visible: column.visible,
    }))
  },
  { immediate: true }
)

const auxTableColumnKey = computed(() => {
  const visibleKeys = visibleCols.value.filter(c => c.visible).map(c => c.prop)
  const parts = activeCategoryColumns.value.map(
    c => `${c.code}:${c.fields.map(f => f.field_key).join(',')}`
  )
  return `${parts.join('|') || 'none'}:${visibleKeys.join(',')}`
})

const AUX_DETAIL_COL_FALLBACK: Record<string, number> = {
  category_name: 120,
  aux_name: 140,
  voucher_date: 100,
  voucher_no: 130,
  account_code: 100,
  account_name: 160,
  summary: 180,
  借方: 120,
  贷方: 120,
  方向: 60,
  余额: 120,
}

const auxColumnDefs = computed(() => {
  const defs: Array<{ key: string; fallback: number }> = []
  for (const col of visibleCols.value) {
    if (!col.visible) continue
    defs.push({ key: col.prop, fallback: AUX_DETAIL_COL_FALLBACK[col.prop] ?? 120 })
  }
  return defs
})

const {
  tableRef,
  colWidth,
  tableWidth: auxTableWidth,
  onDragEnd,
  afterTableLayout,
} = useAuxWideTable('ledger_aux_detail', auxColumnDefs, {
  columnKey: auxTableColumnKey,
  afterLayout: relayoutAfterData,
})

function getRowClassName({ row }: { row: any }) {
  if (row.is_monthly_subtotal) return 'monthly-subtotal-row'
  if (row.is_yearly_subtotal) return 'yearly-subtotal-row'
  if (row.is_opening_balance) return 'carry-forward-row'
  return ''
}

function getSummaries(param: { columns: TableColumnCtx<any>[]; data: any[] }) {
  const { columns, data } = param
  const sums: string[] = []

  const normalEntries = data.filter(
    row => !row.is_monthly_subtotal && !row.is_yearly_subtotal && !row.is_opening_balance
  )

  columns.forEach((column, index) => {
    const key = String(column.columnKey ?? column.property ?? '')

    if (index === 0) {
      sums[index] = '合计'
      return
    }

    if (key === '借方') {
      const total = normalEntries.reduce(
        (sum, row) => sum + (row.direction === 'debit' ? row.amount : 0),
        0
      )
      sums[index] = formatAmount(total)
      return
    }

    if (key === '贷方') {
      const total = normalEntries.reduce(
        (sum, row) => sum + (row.direction === 'credit' ? row.amount : 0),
        0
      )
      sums[index] = formatAmount(total)
      return
    }

    if (key === '方向') {
      sums[index] =
        normalEntries.length > 0
          ? formatRunningBalanceDirection(normalEntries[normalEntries.length - 1])
          : ''
      return
    }

    if (key === '余额') {
      sums[index] =
        normalEntries.length > 0
          ? formatSignedBalanceDisplay(normalEntries[normalEntries.length - 1].running_balance)
          : formatSignedBalanceDisplay(0)
      return
    }

    sums[index] = ''
  })

  return sums
}

function getOpeningBalanceDate() {
  const startDate = filters.value.start_date
  if (!startDate) return ''

  if (/^\d{4}-01-01$/.test(startDate)) return startDate

  const d = new Date(`${startDate}T00:00:00`)
  if (Number.isNaN(d.getTime())) return startDate
  d.setDate(d.getDate() - 1)
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

type CategoryInitBalance = { category_name: string; init_balance: number }

function buildOpeningBalanceBase() {
  return {
    aux_name: '',
    field_values: {},
    voucher_date: getOpeningBalanceDate(),
    voucher_no: '',
    account_code: '',
    account_name: '',
    summary: '期初余额',
    direction: '',
    amount: 0,
    is_opening_balance: true,
  }
}

function fillOpeningBalanceAmount(
  row: Record<string, any>,
  balance: number,
  accountDirection: 'debit' | 'credit'
) {
  const { debit, credit } = splitBalanceToDebitCredit(balance, accountDirection)
  if (debit > 0) {
    row.direction = 'debit'
    row.amount = debit
  } else if (credit > 0) {
    row.direction = 'credit'
    row.amount = credit
  } else {
    row.direction = ''
    row.amount = 0
  }
  return row
}

/** 按辅助类别分开展示期初行，每行「辅助类别」仅显示当前类目 */
function buildOpeningBalanceRows(
  categoryInits: CategoryInitBalance[] | undefined,
  totalBalance: number,
  accountDirection: 'debit' | 'credit' = 'debit'
) {
  const base = buildOpeningBalanceBase()
  const directionFields = { account_direction: accountDirection }
  const items = (categoryInits || []).filter(c => c.init_balance !== 0)
  if (items.length === 0) {
    return [
      fillOpeningBalanceAmount(
        {
          ...base,
          ...directionFields,
          id: '__opening_balance__',
          category_name: '',
          running_balance: totalBalance,
        },
        totalBalance,
        accountDirection
      ),
    ]
  }
  if (items.length === 1) {
    return [
      fillOpeningBalanceAmount(
        {
          ...base,
          ...directionFields,
          id: '__opening_balance__',
          category_name: items[0].category_name,
          running_balance: totalBalance,
        },
        totalBalance,
        accountDirection
      ),
    ]
  }
  let running = 0
  const rows = items.map((cat, index) => {
    running += cat.init_balance
    return fillOpeningBalanceAmount(
      {
        ...base,
        ...directionFields,
        id: `__opening_balance__${index}`,
        category_name: cat.category_name,
        running_balance: running,
      },
      cat.init_balance,
      accountDirection
    )
  })
  if (rows.length > 0 && running !== totalBalance) {
    rows[rows.length - 1].running_balance = totalBalance
  }
  return rows
}

function insertMonthlySubtotals(entries: any[], account: any): any[] {
  if (entries.length === 0) return entries

  const result: any[] = []
  let currentMonth = ''
  let monthlyDebit = 0
  let monthlyCredit = 0
  let yearlyDebit = 0
  let yearlyCredit = 0
  let currentYear = ''

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]
    const entryMonth = entry.voucher_date.substring(0, 7)
    const entryYear = entry.voucher_date.substring(0, 4)

    if (entryYear !== currentYear) {
      currentYear = entryYear
      yearlyDebit = 0
      yearlyCredit = 0
    }

    if (currentMonth && entryMonth !== currentMonth) {
      result.push({
        id: `__monthly_subtotal_${currentMonth}__`,
        voucher_date: currentMonth + '-31',
        voucher_no: '',
        summary: '本月合计',
        direction: '',
        amount: 0,
        running_balance: result[result.length - 1].running_balance,
        is_monthly_subtotal: true,
        monthly_debit: monthlyDebit,
        monthly_credit: monthlyCredit,
      })

      result.push({
        id: `__yearly_subtotal_${currentMonth}__`,
        voucher_date: currentMonth + '-31',
        voucher_no: '',
        summary: '本年累计',
        direction: '',
        amount: 0,
        running_balance: result[result.length - 1].running_balance,
        is_yearly_subtotal: true,
        yearly_debit: yearlyDebit,
        yearly_credit: yearlyCredit,
      })

      monthlyDebit = 0
      monthlyCredit = 0
    }

    if (entry.direction === 'debit') {
      monthlyDebit += entry.amount
      yearlyDebit += entry.amount
    } else if (entry.direction === 'credit') {
      monthlyCredit += entry.amount
      yearlyCredit += entry.amount
    }

    currentMonth = entryMonth
    result.push(entry)
  }

  if (currentMonth && entries.length > 0) {
    result.push({
      id: `__monthly_subtotal_${currentMonth}__`,
      voucher_date: currentMonth + '-31',
      voucher_no: '',
      summary: '本月合计',
      direction: '',
      amount: 0,
      running_balance: result[result.length - 1].running_balance,
      is_monthly_subtotal: true,
      monthly_debit: monthlyDebit,
      monthly_credit: monthlyCredit,
    })

    result.push({
      id: `__yearly_subtotal_${currentMonth}__`,
      voucher_date: currentMonth + '-31',
      voucher_no: '',
      summary: '本年累计',
      direction: '',
      amount: 0,
      running_balance: result[result.length - 1].running_balance,
      is_yearly_subtotal: true,
      yearly_debit: yearlyDebit,
      yearly_credit: yearlyCredit,
    })
  }

  return result
}

async function fetchAuxCategories() {
  try {
    const res = await request.get<any[]>('/base/aux-categories')
    // 现金流量项目本质是凭证级标签而非辅助核算项目，不应出现在辅助账簿筛选项中
    auxCategories.value = filterAuxCategoriesForAccount(res.data || [])
  } catch (error) {
    console.error('加载辅助类别失败:', error)
  }
}

async function fetchAuxItems() {
  if (!filters.value.aux_category_ids || filters.value.aux_category_ids.length === 0) {
    auxItemsMap.value = {}
    auxItemTotals.value = {}
    auxItemSearchResults.value = {}
    auxItemSearchTruncated.value = {}
    return
  }

  auxItemsLoading.value = true
  try {
    const map: Record<string, any[]> = {}
    const totals: Record<string, number> = {}
    // 每类别仅取首页（≤AUX_FILTER_CLIENT_LOAD_LIMIT）+ 总数：
    // 小类别一次性载入做客户端过滤；大类别仅凭总数提示「请检索」，输入关键词后走服务端检索。
    for (const categoryId of filters.value.aux_category_ids) {
      const { items, total } = await fetchAuxItemsPage({
        category_id: categoryId,
        status: 'active',
        page: 1,
        pageSize: AUX_FILTER_CLIENT_LOAD_LIMIT,
      })
      totals[categoryId] = total
      map[categoryId] = total > AUX_FILTER_CLIENT_LOAD_LIMIT ? [] : items
    }
    auxItemsMap.value = map
    auxItemTotals.value = totals
    auxItemSearchResults.value = {}
    auxItemSearchTruncated.value = {}
  } catch (error) {
    console.error('加载辅助项目失败:', error)
  } finally {
    auxItemsLoading.value = false
  }
}

function resolveAccountDirection(entry: { account_direction?: string }): 'debit' | 'credit' {
  return entry.account_direction === 'credit' ? 'credit' : 'debit'
}

function resolveRowAccountDirection(row: { account_direction?: string }): 'debit' | 'credit' {
  if (row.account_direction === 'credit' || row.account_direction === 'debit') {
    return row.account_direction
  }
  return queryAccountDirection.value
}

function formatRunningBalanceDirection(row: {
  running_balance?: number
  account_direction?: string
}): string {
  const balance = row.running_balance ?? 0
  if (Math.abs(balance) < 0.005) return '平'
  return formatEndBalanceDirection({
    end_balance: balance,
    direction: resolveRowAccountDirection(row),
  })
}

async function fetchData(options?: { loadAll?: boolean }) {
  if (!filters.value.aux_category_ids || filters.value.aux_category_ids.length === 0) {
    ElMessage.warning('请先选择辅助类别')
    return
  }

  // 限制选择数量，避免请求过大（全部加载时不传 aux_ids，不受此限）
  const MAX_AUX_ITEMS = 500000
  if (!options?.loadAll && filters.value.aux_ids && filters.value.aux_ids.length > MAX_AUX_ITEMS) {
    ElMessage.warning(`最多只能选择 ${MAX_AUX_ITEMS} 个辅助项目，请缩小筛选范围`)
    return
  }

  loading.value = true
  try {
    const params: any = {
      aux_category_ids: filters.value.aux_category_ids.join(','),
      page: options?.loadAll ? 1 : currentPage.value,
      pageSize: options?.loadAll ? LOAD_ALL_PAGE_SIZE : pageSize.value,
    }
    // aux_ids 可选：不传时后端查类别下所有项目
    if (filters.value.aux_ids && filters.value.aux_ids.length > 0) {
      params.aux_ids = filters.value.aux_ids.join(',')
    }

    if (filters.value.start_date) params.start_date = filters.value.start_date
    if (filters.value.end_date) params.end_date = filters.value.end_date
    if (filters.value.account_code) params.account_code = filters.value.account_code
    if (filters.value.summary_keyword) params.summary_keyword = filters.value.summary_keyword
    if (filters.value.min_amount) params.min_amount = filters.value.min_amount
    if (filters.value.max_amount) params.max_amount = filters.value.max_amount
    if (filters.value.maker_name) params.maker_name = filters.value.maker_name
    if (filters.value.auditor_name) params.auditor_name = filters.value.auditor_name
    if (filters.value.include_unposted) params.include_unposted = true

    const res = await request.post<any>('/ledger/aux-detail', params)

    const entries = res.data || []
    const initBalance = (res as any).initBalance || 0
    const categoryInitBalances = (res as any).categoryInitBalances as
      | CategoryInitBalance[]
      | undefined
    const pageStartBalance = (res as any).pageStartBalance ?? initBalance
    total.value = (res as any).total || 0

    // 保存自定义字段定义
    const cf = (res as any).categoryFields as typeof categoryFields.value | undefined
    if (cf) {
      categoryFields.value = cf
    }

    if (entries.length > 0) {
      queryAccountDirection.value = resolveAccountDirection(entries[0])
    }

    // 计算运行余额
    // 注意：后端返回的是分页后的数据，但 initBalance 是整个查询的期初余额
    // 前端需要基于 initBalance 计算当前页每条数据的余额
    let balance = pageStartBalance
    for (const entry of entries) {
      balance = applyEntryToSignedBalance(
        balance,
        entry.amount,
        entry.direction,
        resolveAccountDirection(entry)
      )
      entry.running_balance = balance
    }

    const entriesWithSubtotals = insertMonthlySubtotals(entries, queryAccountDirection.value)
    const showOpeningRow = options?.loadAll || currentPage.value === 1
    list.value = showOpeningRow
      ? [
          ...buildOpeningBalanceRows(
            categoryInitBalances,
            initBalance,
            queryAccountDirection.value
          ),
          ...entriesWithSubtotals,
        ]
      : entriesWithSubtotals

    if (options?.loadAll) {
      currentPage.value = 1
      if (total.value > 0) {
        pageSize.value = total.value
      }
    }
    await afterTableLayout()
  } catch (error: any) {
    console.error('查询辅助项目明细账失败:', error)
    ElMessage.error(`查询失败：${error.message || '未知错误'}`)
  } finally {
    loading.value = false
  }
}

// 分页事件处理
function handleSizeChange(size: number) {
  pageSize.value = size
  currentPage.value = 1 // 切换每页数量时重置到第一页
  fetchData()
}

function handlePageChange(page: number) {
  currentPage.value = page
  fetchData()
}

function buildVisibleExportColumns(): ExportColumnDef[] {
  const columns: ExportColumnDef[] = []

  if (getColVisible('category_name')) {
    columns.push({
      label: '辅助类别',
      width: colWidth('category_name', 120),
      value: row => row.category_name || '',
    })
  }
  if (getColVisible('aux_name')) {
    columns.push({
      label: '辅助项目',
      width: colWidth('aux_name', 140),
      value: row => row.aux_name || '',
    })
  }

  for (const cat of activeCategoryColumns.value) {
    for (const field of cat.fields) {
      const key = `${cat.code}_${field.field_key}`
      if (!getColVisible(key)) continue
      columns.push({
        label: field.field_name,
        width: colWidth(key, 120),
        value: row =>
          row.category_code === cat.code ? (row.field_values?.[field.field_key] ?? '') : '',
      })
    }
  }

  if (getColVisible('voucher_date')) {
    columns.push({
      label: '日期',
      width: colWidth('voucher_date', 100),
      value: row => row.voucher_date || '',
    })
  }
  if (getColVisible('voucher_no')) {
    columns.push({
      label: '凭证号',
      width: colWidth('voucher_no', 130),
      value: row => row.voucher_no || '',
    })
  }
  if (getColVisible('account_code')) {
    columns.push({
      label: '科目编码',
      width: colWidth('account_code', 100),
      value: row => row.account_code || '',
    })
  }
  if (getColVisible('account_name')) {
    columns.push({
      label: '科目名称',
      width: colWidth('account_name', 160),
      value: row => row.account_name || '',
    })
  }
  if (getColVisible('summary')) {
    columns.push({
      label: '摘要',
      width: colWidth('summary', 180),
      value: row => row.summary || '',
    })
  }
  if (getColVisible('借方')) {
    columns.push({
      label: '借方',
      width: colWidth('借方', 120),
      align: 'right',
      type: 'amount',
      value: row => {
        if (row.is_monthly_subtotal) return row.monthly_debit
        if (row.is_yearly_subtotal) return row.yearly_debit
        return row.direction === 'debit' ? row.amount : ''
      },
    })
  }
  if (getColVisible('贷方')) {
    columns.push({
      label: '贷方',
      width: colWidth('贷方', 120),
      align: 'right',
      type: 'amount',
      value: row => {
        if (row.is_monthly_subtotal) return row.monthly_credit
        if (row.is_yearly_subtotal) return row.yearly_credit
        return row.direction === 'credit' ? row.amount : ''
      },
    })
  }
  if (getColVisible('方向')) {
    columns.push({
      label: '方向',
      width: colWidth('方向', 60),
      align: 'center',
      value: row => formatRunningBalanceDirection(row),
    })
  }
  if (getColVisible('余额')) {
    columns.push({
      label: '余额',
      width: colWidth('余额', 120),
      align: 'right',
      type: 'amount',
      value: row => formatSignedBalanceAmount(row.running_balance ?? 0, false),
    })
  }

  return columns
}

async function exportData() {
  if (total.value <= 0) {
    ElMessage.warning('请先查询后再导出')
    return
  }

  if (!filters.value.aux_category_ids || filters.value.aux_category_ids.length === 0) {
    ElMessage.warning('请先选择辅助类别')
    return
  }

  const EXPORT_WARNING_THRESHOLD = 5000

  if (total.value > EXPORT_WARNING_THRESHOLD) {
    const confirmed = await useConfirm({
      title: '数据量较大',
      message: `当前共 ${total.value.toLocaleString()} 条明细，将由服务端生成 Excel，可能需要较长时间，是否继续？`,
      confirmButtonText: '继续导出',
      cancelButtonText: '取消',
    })
    if (!confirmed) return
  }

  exportProgress.start()

  const dateRange =
    filters.value.start_date && filters.value.end_date
      ? `${filters.value.start_date}_${filters.value.end_date}`
      : new Date().toISOString().split('T')[0]

  const baseParams: any = {
    aux_category_ids: filters.value.aux_category_ids.join(','),
  }
  if (filters.value.aux_ids && filters.value.aux_ids.length > 0) {
    baseParams.aux_ids = filters.value.aux_ids.join(',')
  }
  if (filters.value.start_date) baseParams.start_date = filters.value.start_date
  if (filters.value.end_date) baseParams.end_date = filters.value.end_date
  if (filters.value.account_code) baseParams.account_code = filters.value.account_code
  if (filters.value.summary_keyword) baseParams.summary_keyword = filters.value.summary_keyword
  if (filters.value.min_amount) baseParams.min_amount = filters.value.min_amount
  if (filters.value.max_amount) baseParams.max_amount = filters.value.max_amount
  if (filters.value.maker_name) baseParams.maker_name = filters.value.maker_name
  if (filters.value.auditor_name) baseParams.auditor_name = filters.value.auditor_name
  if (filters.value.include_unposted) baseParams.include_unposted = true

  const EXPORT_PAGE_SIZE = 1000

  try {
    let entries: any[] = []
    let exportInitBalance = 0
    let exportCategoryInits: CategoryInitBalance[] | undefined
    let page = 1
    let serverTotal = 0
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const res = await request.post<any>('/ledger/aux-detail', {
        ...baseParams,
        page,
        pageSize: EXPORT_PAGE_SIZE,
      })
      const batch = res.data || []
      if (page === 1) {
        serverTotal = (res as any).total ?? batch.length
        exportInitBalance = (res as any).initBalance || 0
        exportCategoryInits = (res as any).categoryInitBalances as CategoryInitBalance[] | undefined
      }
      entries.push(...batch)
      exportProgress.setFetchProgress(entries.length, serverTotal)
      if (batch.length === 0 || entries.length >= serverTotal) break
      page++
      await yieldToMain()
    }

    if (entries.length === 0) {
      ElMessage.warning('没有可导出的数据')
      return
    }

    queryAccountDirection.value = resolveAccountDirection(entries[0])

    let balance = exportInitBalance
    for (const entry of entries) {
      balance = applyEntryToSignedBalance(
        balance,
        entry.amount,
        entry.direction,
        resolveAccountDirection(entry)
      )
      entry.running_balance = balance
    }

    const entriesWithSubtotals = insertMonthlySubtotals(entries, queryAccountDirection.value)
    const exportRows = [
      ...buildOpeningBalanceRows(
        exportCategoryInits,
        exportInitBalance,
        queryAccountDirection.value
      ),
      ...entriesWithSubtotals,
    ]

    const exportColumns = buildVisibleExportColumns()
    const summaryValues = buildAuxDetailExportSummaryValues(
      exportColumns,
      exportRows,
      formatRunningBalanceDirection,
      formatSignedBalanceDisplay
    )

    await exportStyledTableViaServer({
      fileName: `辅助项目明细账_${dateRange}.xlsx`,
      sheetName: '辅助项目明细账',
      title: '辅助项目明细账',
      subtitle: filterSummaryText.value,
      columns: exportColumns,
      rows: exportRows,
      summaryValues,
      onProgress: info => exportProgress.report(info),
    })

    ElMessage.success('导出完成，文件已开始下载')
  } catch (error: any) {
    console.error('导出辅助项目明细账失败:', error)
    ElMessage.error(error?.response?.data?.error || error?.message || '导出失败')
  } finally {
    exportProgress.finish()
  }
}

// ===================== 打印（HiprintDialog 预览）=====================
const { accountSetName } = storeToRefs(useUserStore())
const hiprintVisible = ref(false)
const printData = ref<any[]>([])

/** 与导出一致：分页拉取全部明细 → 计算余额 → 插入小计/累计 → 补期初行 */
async function fetchAllAuxDetailRows(): Promise<any[]> {
  const baseParams: any = {
    aux_category_ids: filters.value.aux_category_ids.join(','),
  }
  if (filters.value.aux_ids && filters.value.aux_ids.length > 0) {
    baseParams.aux_ids = filters.value.aux_ids.join(',')
  }
  if (filters.value.start_date) baseParams.start_date = filters.value.start_date
  if (filters.value.end_date) baseParams.end_date = filters.value.end_date
  if (filters.value.account_code) baseParams.account_code = filters.value.account_code
  if (filters.value.summary_keyword) baseParams.summary_keyword = filters.value.summary_keyword
  if (filters.value.min_amount) baseParams.min_amount = filters.value.min_amount
  if (filters.value.max_amount) baseParams.max_amount = filters.value.max_amount
  if (filters.value.maker_name) baseParams.maker_name = filters.value.maker_name
  if (filters.value.auditor_name) baseParams.auditor_name = filters.value.auditor_name
  if (filters.value.include_unposted) baseParams.include_unposted = true

  const entries: any[] = []
  let initBalance = 0
  let categoryInits: CategoryInitBalance[] | undefined
  let page = 1
  let serverTotal = 0
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const res = await request.post<any>('/ledger/aux-detail', {
      ...baseParams,
      page,
      pageSize: 1000,
    })
    const batch = res.data || []
    if (page === 1) {
      serverTotal = (res as any).total ?? batch.length
      initBalance = (res as any).initBalance || 0
      categoryInits = (res as any).categoryInitBalances as CategoryInitBalance[] | undefined
    }
    entries.push(...batch)
    if (batch.length === 0 || entries.length >= serverTotal) break
    page++
    await yieldToMain()
  }
  if (entries.length === 0) return []

  queryAccountDirection.value = resolveAccountDirection(entries[0])
  let balance = initBalance
  for (const entry of entries) {
    balance = applyEntryToSignedBalance(
      balance,
      entry.amount,
      entry.direction,
      resolveAccountDirection(entry)
    )
    entry.running_balance = balance
  }
  const entriesWithSubtotals = insertMonthlySubtotals(entries, queryAccountDirection.value)
  return [
    ...buildOpeningBalanceRows(categoryInits, initBalance, queryAccountDirection.value),
    ...entriesWithSubtotals,
  ]
}

async function printPage() {
  if (total.value <= 0) {
    ElMessage.warning('请先查询后再打印')
    return
  }
  if (!filters.value.aux_category_ids || filters.value.aux_category_ids.length === 0) {
    ElMessage.warning('请先选择辅助类别')
    return
  }
  exportProgress.start()
  try {
    const rows = await fetchAllAuxDetailRows()
    if (rows.length === 0) {
      ElMessage.warning('没有可打印的数据')
      return
    }
    printData.value = rows
    hiprintVisible.value = true
  } catch (error: any) {
    console.error('加载打印数据失败:', error)
    ElMessage.error(error?.response?.data?.error || error?.message || '加载打印数据失败')
  } finally {
    exportProgress.finish()
  }
}

function buildPrintHtml(): string {
  type PrintCol = { label: string; align: 'left' | 'center' | 'right'; render: (r: any) => string }
  const columns: PrintCol[] = []
  if (getColVisible('category_name')) {
    columns.push({ label: '辅助类别', align: 'left', render: r => r.category_name || '' })
  }
  if (getColVisible('aux_name')) {
    columns.push({ label: '辅助项目', align: 'left', render: r => r.aux_name || '' })
  }
  for (const cat of activeCategoryColumns.value) {
    for (const field of cat.fields) {
      const key = `${cat.code}_${field.field_key}`
      if (!getColVisible(key)) continue
      columns.push({
        label: field.field_name,
        align: 'left',
        render: r =>
          r.category_code === cat.code ? (r.field_values?.[field.field_key] ?? '') : '',
      })
    }
  }
  if (getColVisible('voucher_date')) {
    columns.push({
      label: '日期',
      align: 'center',
      render: r => (r.is_monthly_subtotal || r.is_yearly_subtotal ? '' : r.voucher_date || ''),
    })
  }
  if (getColVisible('voucher_no')) {
    columns.push({ label: '凭证号', align: 'center', render: r => r.voucher_no || '' })
  }
  if (getColVisible('account_code')) {
    columns.push({ label: '科目编码', align: 'left', render: r => r.account_code || '' })
  }
  if (getColVisible('account_name')) {
    columns.push({ label: '科目名称', align: 'left', render: r => r.account_name || '' })
  }
  if (getColVisible('summary')) {
    columns.push({
      label: '摘要',
      align: 'left',
      render: r =>
        r.summary ||
        (r.is_monthly_subtotal
          ? '本月合计'
          : r.is_yearly_subtotal
            ? '本年累计'
            : r.is_opening_balance
              ? '期初余额'
              : ''),
    })
  }
  if (getColVisible('借方')) {
    columns.push({
      label: '借方',
      align: 'right',
      render: r => {
        if (r.is_monthly_subtotal) return r.monthly_debit ? formatAmount(r.monthly_debit) : ''
        if (r.is_yearly_subtotal) return r.yearly_debit ? formatAmount(r.yearly_debit) : ''
        return r.direction === 'debit' && r.amount ? formatAmount(r.amount) : ''
      },
    })
  }
  if (getColVisible('贷方')) {
    columns.push({
      label: '贷方',
      align: 'right',
      render: r => {
        if (r.is_monthly_subtotal) return r.monthly_credit ? formatAmount(r.monthly_credit) : ''
        if (r.is_yearly_subtotal) return r.yearly_credit ? formatAmount(r.yearly_credit) : ''
        return r.direction === 'credit' && r.amount ? formatAmount(r.amount) : ''
      },
    })
  }
  if (getColVisible('方向')) {
    columns.push({ label: '方向', align: 'center', render: r => formatRunningBalanceDirection(r) })
  }
  if (getColVisible('余额')) {
    columns.push({
      label: '余额',
      align: 'right',
      render: r => (r.running_balance ? formatSignedBalanceDisplay(r.running_balance) : ''),
    })
  }

  return buildTablePrintHtml<any>({
    title: '辅助项目明细账',
    subtitle: `账套：${accountSetName.value || '未命名账套'}　${filterSummaryText.value}`,
    rows: printData.value,
    monochrome: true,
    fitToPage: true,
    rowStyle: (r: any) => (r.is_monthly_subtotal || r.is_yearly_subtotal ? 'font-weight:600;' : ''),
    columns,
  })
}

// 查询按钮点击
function handleQuery() {
  syncFiltersFromCheckMap()
  if (!filters.value.aux_ids?.length) {
    ElMessage.warning('请至少选择一个辅助项目，可使用「全选」选中当前列表')
    return
  }
  currentPage.value = 1
  drawerVisible.value = false
  fetchData()
}

/** 选中全部辅助类别，一次查询全部明细分录 */
async function handleLoadAll() {
  loadingAll.value = true
  try {
    if (auxCategories.value.length === 0) {
      await fetchAuxCategories()
    }
    if (auxCategories.value.length === 0) {
      ElMessage.warning('暂无辅助类别')
      return
    }
    filters.value.aux_category_ids = auxCategories.value.map((c: any) => c.id)
    auxItemsMap.value = {}
    await fetchAuxItems()
    filters.value.aux_ids = []
    itemCheckMap.value = {}
    currentPage.value = 1
    await fetchData({ loadAll: true })
    const rowCount = list.value.filter((r: any) => !r.is_opening_balance).length
    ElMessage.success(`已加载 ${rowCount} 条明细（共 ${total.value} 条）`)
  } catch (error: any) {
    console.error('全部加载失败:', error)
    ElMessage.error(error?.message || '全部加载失败')
  } finally {
    loadingAll.value = false
  }
}

// 重置筛选条件
function resetFilters() {
  const year = new Date().getFullYear()
  filters.value = {
    aux_category_ids: [],
    aux_ids: [],
    start_date: `${year}-01-01`,
    end_date: `${year}-12-31`,
    account_code: '',
    summary_keyword: '',
    min_amount: '',
    max_amount: '',
    maker_name: '',
    auditor_name: '',
    include_unposted: true,
  }
  list.value = []
}

/** 全选/反选/清空：仅作用于当前列表可见项（大类别即检索命中的项），避免一次性勾选海量项目 */
function getCategoryItemsForBulkAction(categoryId: string) {
  const group = filteredAuxItemsByCategory.value.find(g => g.categoryId === categoryId)
  return group?.items || []
}

// 全选某个类别的项目
function selectCategoryItems(categoryId: string) {
  getCategoryItemsForBulkAction(categoryId).forEach(item => {
    itemCheckMap.value[item.id] = true
  })
  syncFiltersFromCheckMap()
}

// 反选某个类别的项目
function invertCategorySelection(categoryId: string) {
  getCategoryItemsForBulkAction(categoryId).forEach(item => {
    itemCheckMap.value[item.id] = !itemCheckMap.value[item.id]
  })
  syncFiltersFromCheckMap()
}

// 清空某个类别的选择
function clearCategorySelection(categoryId: string) {
  getCategoryItemsForBulkAction(categoryId).forEach(item => {
    itemCheckMap.value[item.id] = false
  })
  syncFiltersFromCheckMap()
}

// 单个项目勾选变化
function onItemCheckChange() {
  syncFiltersFromCheckMap()
}

// 从 checkMap 同步到 filters.aux_ids
function syncFiltersFromCheckMap() {
  filters.value.aux_ids = Object.keys(itemCheckMap.value).filter(id => itemCheckMap.value[id])
}

async function onAuxCategoryChange() {
  // 切换辅助类别时清空已选项目（不再默认全选，避免检索后误以为只查了可见项）
  filters.value.aux_ids = []
  itemCheckMap.value = {}
  auxItemSearchKeyword.value = ''
  list.value = []
  if (!filters.value.aux_category_ids || filters.value.aux_category_ids.length === 0) return
  await fetchAuxItems()
}

function resolveCategoryIds(raw: string): string[] {
  return raw
    .split(',')
    .filter(Boolean)
    .map(part => {
      const byId = auxCategories.value.find(c => c.id === part)
      if (byId) return byId.id
      const byCode = auxCategories.value.find(c => c.code === part)
      return byCode?.id ?? part
    })
}

/** 从路由 query 同步筛选并查询（keep-alive 下 query 变化不会触发 onMounted） */
async function applyRouteFromQuery() {
  const hasDrillDown = !!(
    route.query.aux_category_ids ||
    route.query.aux_ids ||
    route.query.account_code
  )
  if (!hasDrillDown) return

  list.value = []
  currentPage.value = 1
  itemCheckMap.value = {}
  filters.value.aux_category_ids = []
  filters.value.aux_ids = []
  filters.value.account_code = ''

  if (route.query.aux_category_ids) {
    filters.value.aux_category_ids = resolveCategoryIds(route.query.aux_category_ids as string)
  }
  if (route.query.aux_ids) {
    const ids = (route.query.aux_ids as string).split(',').filter(Boolean)
    filters.value.aux_ids = ids
    ids.forEach(id => {
      itemCheckMap.value[id] = true
    })
  }
  if (route.query.account_code) {
    filters.value.account_code = route.query.account_code as string
  }
  if (route.query.start_date) {
    filters.value.start_date = route.query.start_date as string
  }
  if (route.query.end_date) {
    filters.value.end_date = route.query.end_date as string
  }

  await fetchAuxItems()
  if (filters.value.aux_category_ids.length > 0 && filters.value.aux_ids.length > 0) {
    await fetchData()
  }
}

watch(
  () => route.fullPath,
  async (newPath, oldPath) => {
    if (!newPath.startsWith('/ledger/aux-detail')) return
    if (!oldPath || oldPath === newPath) return
    if (auxCategories.value.length === 0) {
      await fetchAuxCategories()
    }
    await applyRouteFromQuery()
  }
)

onMounted(async () => {
  restoreVisibleCols()
  await fetchAuxCategories()
  await applyRouteFromQuery()
})

onActivated(() => {
  restoreVisibleCols()
  void tryRestoreVoucherModal()
})
</script>

<style scoped>
:deep(.monthly-subtotal-row) {
  background-color: #e0f2fe !important;
  font-weight: 600;
}

:deep(.yearly-subtotal-row) {
  background-color: #fef9c3 !important;
  font-weight: 600;
}

:deep(.carry-forward-row) {
  background-color: #f3f4f6 !important;
  font-weight: 500;
}

.page {
  padding: 16px;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
  padding: 12px 16px;
  background-color: #fff;
  border-radius: 4px;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
}

.header-left {
  display: flex;
  align-items: center;
  gap: 16px;
  flex: 1;
  min-width: 0;
}

.header-left h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
}

.filter-hint {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  flex: 1;
  min-width: 0;
  padding: 6px 12px;
  background-color: #f5f7fa;
  border-radius: 4px;
  font-size: var(--cw-text-base);
  line-height: 1.5;
  color: #606266;
}

.filter-hint-label {
  flex-shrink: 0;
  color: #303133;
  font-weight: 500;
}

.filter-hint-text {
  flex: 1;
  min-width: 0;
  word-break: break-all;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

/* 抽屉内容样式 */
.drawer-content {
  padding: 0 20px 20px;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.filter-item {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.filter-item label {
  font-size: var(--cw-text-base);
  font-weight: 500;
  color: #303133;
}

.date-range,
.amount-range {
  display: flex;
  align-items: center;
  gap: 8px;
}

.date-separator,
.amount-separator {
  color: #909399;
  font-size: var(--cw-text-base);
}

.drawer-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  padding: 16px 20px;
  border-top: 1px solid #e4e7ed;
}

.filter-item-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.batch-actions {
  display: flex;
  gap: 4px;
}

.checkbox-list {
  max-height: 400px;
  overflow-y: auto;
  border: 1px solid #dcdfe6;
  border-radius: 4px;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.category-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.category-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 8px;
  background-color: #f5f7fa;
  border-radius: 4px;
}

.category-label {
  font-size: var(--cw-text-base);
  font-weight: 600;
  color: #606266;
}

.category-actions {
  display: flex;
  gap: 4px;
}

.empty-hint {
  padding: 12px;
  text-align: center;
  color: #909399;
  font-size: var(--cw-text-base);
  background-color: #f5f7fa;
  border-radius: 4px;
}
</style>
