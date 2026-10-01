<template>
  <div class="page page-ledger aux-multi-column-page">
    <div class="page-header aux-multi-column-header">
      <div class="aux-multi-column-title-wrap">
        <h3>辅助项目多栏明细账</h3>
        <span v-if="category" class="main-account-label">{{ category.code }} {{ category.name }}</span>
      </div>
      <div class="filter-row">
        <el-radio-group v-model="filters.mode" size="small" @change="onModeChange">
          <el-radio-button label="counter">对方科目分栏</el-radio-button>
          <el-radio-button label="aux_item">辅助项目分栏</el-radio-button>
        </el-radio-group>
        <el-select v-model="filters.categoryId" placeholder="选择辅助类别" filterable clearable class="filter-ctl--sm" @change="onCategoryChange">
          <el-option v-for="item in auxCategories" :key="item.id" :label="`${item.code} ${item.name}`" :value="item.id" />
        </el-select>
        <el-select
          v-if="filters.mode === 'aux_item'"
          v-model="filters.accountId"
          placeholder="选择主科目"
          filterable
          clearable
          class="account-filter"
        >
          <el-option v-for="account in accounts" :key="account.id" :label="`${account.code} ${account.name}`" :value="account.id" />
        </el-select>
        <el-select
          v-model="filters.auxItemIds"
          multiple
          collapse-tags
          collapse-tags-tooltip
          :placeholder="auxItemPlaceholder"
          filterable
          clearable
          :loading="auxItemsLoading"
          class="aux-item-filter"
        >
          <el-option v-for="item in availableAuxItems" :key="item.id" :label="`${item.code} ${item.name}`" :value="item.id" />
        </el-select>
        <el-select v-model="filters.year" class="filter-ctl--xs" placeholder="年份">
          <el-option v-for="year in years" :key="year" :label="`${year}年`" :value="year" />
        </el-select>
        <el-select v-model="filters.startMonth" class="filter-ctl--xs" placeholder="起始月份">
          <el-option v-for="month in 12" :key="month" :label="`${month}月起`" :value="month" />
        </el-select>
        <el-select v-model="filters.endMonth" class="filter-ctl--xs" placeholder="结束月份">
          <el-option v-for="month in 12" :key="month" :label="`${month}月止`" :value="month" />
        </el-select>
        <el-input v-if="filters.mode === 'counter'" v-model="filters.accountCode" placeholder="对方科目编码前缀（可选）" clearable class="filter-ctl--sm" />
        <el-checkbox v-model="filters.includeUnposted">统计未记账凭证</el-checkbox>
        <el-button type="primary" :loading="loading" :disabled="!canQuery" @click="handleQuery"><el-icon><Search /></el-icon>查询</el-button>
        <FilterClearButton @clear="handleClearFilters" />
        <el-divider direction="vertical" />
        <el-button plain :disabled="loading || rows.length === 0" @click="exportData"><el-icon><Download /></el-icon>导出 Excel</el-button>
        <el-button plain :disabled="loading || rows.length === 0" @click="printPage"><el-icon><Printer /></el-icon>打印</el-button>
        <el-button plain :disabled="!canQuery || columns.length === 0" @click="openSettings">栏目设置</el-button>
      </div>
    </div>

    <div class="aux-multi-column-subtitle">
      <span>期间：{{ periodLabel }}</span>
      <span v-if="mainAccount">主科目：{{ mainAccount.code }} {{ mainAccount.name }}</span>
      <span v-if="auxItemTruncated" class="warning-text">该类别项目较多，仅列出前 {{ AUX_ITEM_PAGE_SIZE }} 个，可直接输入关键词筛选</span>
      <span v-if="canQuery && columns.length === 0 && initialLoaded && !loading" class="warning-text">{{ emptyColumnTip }}</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </div>

    <AccountScopeAlert />

    <EmptyState v-if="!filters.categoryId" type="account" description="请先选择辅助类别" />
    <EmptyState v-else-if="filters.mode === 'aux_item' && !filters.accountId" type="account" description="按辅助项目分栏时请先选择主科目" />
    <div v-else-if="!initialLoaded && loading" class="skeleton-table">
      <div v-for="i in 8" :key="i" class="skeleton skeleton-row" />
    </div>
    <EmptyState v-else-if="columns.length === 0" type="account" description="当前范围内没有可分栏的数据" />
    <div v-else ref="tableContainerRef" v-loading="loading" class="table-summary-scroll table-summary-scroll--wide table-summary-scroll--flow">
      <el-table
        ref="tableRef"
        :data="rows"
        :height="tableHeight"
        :style="{ width: `${ledgerTableWidth}px` }"
        :fit="false"
        border
        stripe
        size="small"
        class="compact-data-table aux-multi-column-table"
        :row-class-name="getRowClassName"
        @header-dragend="handleHeaderDragEnd"
        @row-dblclick="handleLedgerRowDblClick"
      >
        <el-table-column column-key="voucher_date" label="日期" :width="colWidth('voucher_date', 92)">
          <template #default="{ row }">{{ row.row_type === 'init' ? '' : row.voucher_date }}</template>
        </el-table-column>
        <el-table-column column-key="voucher_no" label="凭证号" :width="colWidth('voucher_no', 110)">
          <template #default="{ row }">{{ row.row_type === 'entry' ? row.voucher_no : '' }}</template>
        </el-table-column>
        <el-table-column column-key="summary" label="摘要" :width="colWidth('summary', 170)">
          <template #default="{ row }">{{ row.summary }}</template>
        </el-table-column>
        <el-table-column column-key="account_name" :label="subjectColumnLabel" :width="colWidth('account_name', 200)" show-overflow-tooltip>
          <template #default="{ row }">{{ subjectText(row) }}</template>
        </el-table-column>
        <el-table-column label="借方" align="center">
          <el-table-column v-for="column in debitColumns" :key="column.key" :column-key="column.key" :label="column.printName || column.label" :width="colWidth(column.key, 118)" align="right">
            <template #default="{ row }">{{ amountText(row.amounts?.[column.key]) }}</template>
          </el-table-column>
        </el-table-column>
        <el-table-column label="贷方" align="center">
          <el-table-column v-for="column in creditColumns" :key="column.key" :column-key="column.key" :label="column.printName || column.label" :width="colWidth(column.key, 118)" align="right">
            <template #default="{ row }">{{ amountText(row.amounts?.[column.key]) }}</template>
          </el-table-column>
        </el-table-column>
        <el-table-column column-key="debit_total" label="借方合计" :width="colWidth('debit_total', 125)" align="right">
          <template #default="{ row }">{{ amountText(row.debit_total) }}</template>
        </el-table-column>
        <el-table-column column-key="credit_total" label="贷方合计" :width="colWidth('credit_total', 125)" align="right">
          <template #default="{ row }">{{ amountText(row.credit_total) }}</template>
        </el-table-column>
        <el-table-column column-key="direction_label" label="方向" :width="colWidth('direction_label', 58)" align="center">
          <template #default="{ row }">{{ row.direction_label }}</template>
        </el-table-column>
        <el-table-column column-key="balance" label="余额" :width="colWidth('balance', 125)" align="right">
          <template #default="{ row }">{{ balanceText(row.balance) }}</template>
        </el-table-column>
        <template #empty><EmptyState type="data" description="暂无数据，请选择期间后查询" /></template>
      </el-table>
    </div>

    <div class="pagination"><span class="total-tip">共 {{ entryCount }} 条分录，{{ rows.length }} 行</span></div>

    <VoucherEntryDialogHost ref="entryDialogHostRef" @saved="fetchData" />
    <HiprintDialog v-model="hiprintVisible" template-type="ledger" template-key="ledger:aux-multi-column" title="辅助项目多栏明细账" :get-print-html="buildPrintHtml" default-paper="A4" default-orientation="landscape" :use-templates="false" />

    <el-drawer v-model="settingsVisible" title="辅助项目多栏明细账栏目设置" size="720px">
      <div class="settings-tip">{{ settingsTip }}</div>
      <el-table :data="settingsDraft" border size="small">
        <el-table-column label="方向" width="70" align="center"><template #default="{ row }">{{ row.side === 'debit' ? '借方' : '贷方' }}</template></el-table-column>
        <el-table-column prop="accountCode" label="编码" width="130" />
        <el-table-column prop="accountName" label="名称" width="180" />
        <el-table-column label="显示名称" min-width="160"><template #default="{ row }"><el-input v-model="row.printName" size="small" /></template></el-table-column>
        <el-table-column label="启用" width="70" align="center"><template #default="{ row }"><el-switch v-model="row.enabled" size="small" /></template></el-table-column>
        <el-table-column label="顺序" width="90"><template #default="{ row }"><el-input-number v-model="row.sortOrder" size="small" :min="0" :controls="false" /></template></el-table-column>
      </el-table>
      <template #footer><div class="drawer-footer"><el-button @click="settingsVisible = false">取消</el-button><el-button type="primary" :loading="savingSettings" @click="saveSettings">保存并刷新</el-button></div></template>
    </el-drawer>
  </div>
</template>

<script setup lang="ts">
import { computed, onActivated, onMounted, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { Download, Printer, Search } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import request from '@/api/request'
import { useUserStore } from '@/stores/user'
import { useBaseDataStore } from '@/stores/baseData'
import AccountScopeAlert from '@/components/AccountScopeAlert.vue'
import FilterClearButton from '@/components/common/FilterClearButton.vue'
import { useFilterClear } from '@/composables/useFilterClear'
import EmptyState from '@/components/EmptyState.vue'
import VoucherEntryDialogHost from '@/components/voucher/VoucherEntryDialogHost.vue'
import HiprintDialog from '@/components/print/HiprintDialog.vue'
import { useFillHeightTable } from '@/composables/useFillHeightTable'
import { useLedgerWideTable } from '@/composables/useLedgerWideTable'
import { useLedgerVoucherNavigate, resolveLedgerVoucherId } from '@/composables/useLedgerVoucherNavigate'
import { useVoucherModalRestore } from '@/composables/useVoucherModalRestore'
import { fetchAuxItemsPage } from '@/composables/useAuxItemsPage'
import { buildTablePrintHtml } from '@/utils/printTemplateHiprint'
import { exportStyledTable, type ExportColumnDef } from '@/utils/exportStyledExcel'
import { formatAmount } from '@/utils/format'
import { filterAuxCategoriesForAccount } from '@/utils/accountCashFlow'
import {
  getAuxMultiColumnLedger,
  getAuxMultiColumnSettings,
  saveAuxMultiColumnSettings,
  type AuxMultiColumnAccount,
  type AuxMultiColumnCategory,
  type AuxMultiColumnMainAccount,
  type AuxMultiColumnMode,
  type AuxMultiColumnQuery,
  type AuxMultiColumnRow,
  type AuxMultiColumnSetting,
} from '@/api/ledgerAuxMultiColumn'

/** 辅助项目下拉一次最多列出的条数，超出提示用关键词筛选 */
import { useRacedQuery } from '@/composables/useRacedQuery'
const AUX_ITEM_PAGE_SIZE = 500

const { accountSetName } = storeToRefs(useUserStore())
const baseDataStore = useBaseDataStore()
const currentYear = new Date().getFullYear()
const years = Array.from({ length: currentYear - 2000 + 1 }, (_, index) => currentYear - index)
const filters = ref<{
  mode: AuxMultiColumnMode
  categoryId: string
  accountId: string
  auxItemIds: string[]
  year: number
  startMonth: number
  endMonth: number
  includeUnposted: boolean
  accountCode: string
}>({
  mode: 'counter',
  categoryId: '',
  accountId: '',
  auxItemIds: [],
  year: currentYear,
  startMonth: 1,
  endMonth: 12,
  includeUnposted: true,
  accountCode: '',
})
const { clearFilters } = useFilterClear([filters])

/** 清空筛选条件并恢复默认查询 */
function handleClearFilters() {
  clearFilters()
  handleQuery()
}
const rows = ref<AuxMultiColumnRow[]>([])
const columns = ref<AuxMultiColumnAccount[]>([])
const category = ref<AuxMultiColumnCategory | null>(null)
const mainAccount = ref<AuxMultiColumnMainAccount | null>(null)
const auxCategories = ref<Array<{ id: string; code: string; name: string }>>([])
const availableAuxItems = ref<Array<{ id: string; code: string; name: string }>>([])
const auxItemsLoading = ref(false)
const auxItemTruncated = ref(false)
const settingsDraft = ref<AuxMultiColumnAccount[]>([])
// FIX-157：请求序号防竞态，loading 由 raced 统一维护
const raced = useRacedQuery()
const loading = raced.loading
const initialLoaded = ref(false)
const errorMessage = ref('')
const settingsVisible = ref(false)
const savingSettings = ref(false)
const hiprintVisible = ref(false)

const accounts = computed(() => baseDataStore.accounts)
const debitColumns = computed(() => columns.value.filter(column => column.side === 'debit'))
const creditColumns = computed(() => columns.value.filter(column => column.side === 'credit'))
const entryCount = computed(() => rows.value.filter(row => row.row_type === 'entry').length)
const periodLabel = computed(() => `${filters.value.year}年${filters.value.startMonth}月-${filters.value.endMonth}月`)
const canQuery = computed(() => !!filters.value.categoryId && (filters.value.mode === 'counter' || !!filters.value.accountId))
const auxItemPlaceholder = computed(() => (filters.value.categoryId ? '辅助项目（不选则按类别全部）' : '请先选择辅助类别'))
const subjectColumnLabel = computed(() => (filters.value.mode === 'counter' ? '对方科目' : '辅助项目'))
const emptyColumnTip = computed(() =>
  filters.value.mode === 'counter' ? '所选范围内没有可分栏的对方科目数据' : '所选范围内该科目没有带辅助核算的发生额'
)
const settingsTip = computed(() =>
  filters.value.mode === 'counter'
    ? '当前范围内出现过的对方科目会自动生成借、贷两栏，可调整启用、顺序和打印名称。'
    : '当前范围内有发生额的辅助项目会自动生成借、贷两栏，可调整启用、顺序和打印名称。'
)

const ledgerColumnDefs = computed(() => [
  { key: 'voucher_date', fallback: 92 }, { key: 'voucher_no', fallback: 110 }, { key: 'summary', fallback: 170 }, { key: 'account_name', fallback: 200 },
  ...columns.value.map(column => ({ key: column.key, fallback: 118 })),
  { key: 'debit_total', fallback: 125 }, { key: 'credit_total', fallback: 125 }, { key: 'direction_label', fallback: 58 }, { key: 'balance', fallback: 125 },
])
const { containerRef: tableContainerRef, tableHeight, relayoutAfterData } = useFillHeightTable({ flow: true })
const { tableRef, colWidth, ledgerTableWidth, handleHeaderDragEnd, afterTableLayout } = useLedgerWideTable('ledger_aux_multi_column', ledgerColumnDefs, { afterLayout: relayoutAfterData })
const entryDialogHostRef = ref<InstanceType<typeof VoucherEntryDialogHost> | null>(null)
const { tryRestoreVoucherModal } = useVoucherModalRestore(entryDialogHostRef)
const { handleLedgerRowDblClick } = useLedgerVoucherNavigate({
  returnLabel: '辅助项目多栏明细账',
  getReturnQuery: () => ({
    mode: filters.value.mode,
    category_id: filters.value.categoryId,
    year: String(filters.value.year),
    start_month: String(filters.value.startMonth),
    end_month: String(filters.value.endMonth),
  }),
  openVoucherModal: row => {
    if ((row as AuxMultiColumnRow).row_type !== 'entry') return
    const voucherId = resolveLedgerVoucherId(row)
    if (!voucherId) return
    entryDialogHostRef.value?.open({ _voucherId: voucherId, id: voucherId, status: row.voucher_status })
  },
})

function amountText(value: number | undefined) { const number = Number(value) || 0; return Math.abs(number) < 0.005 ? '' : formatAmount(number) }
function balanceText(value: number | undefined) { const number = Number(value) || 0; return Math.abs(number) < 0.005 ? '' : formatAmount(Math.abs(number)) }
function getRowClassName({ row }: { row: AuxMultiColumnRow }) { return row.row_type === 'init' ? 'aux-init-row' : row.row_type === 'month_total' ? 'aux-month-total-row' : row.row_type === 'year_total' ? 'aux-year-total-row' : '' }
/** 对方科目分栏时展示对方科目，辅助项目分栏时展示辅助项目 */
function subjectText(row: AuxMultiColumnRow) {
  if (row.row_type !== 'entry') return ''
  return filters.value.mode === 'counter' ? row.counter_label : row.aux_item_name
}

function currentQuery(): AuxMultiColumnQuery {
  return {
    mode: filters.value.mode,
    categoryId: filters.value.categoryId,
    auxItemIds: filters.value.auxItemIds,
    accountId: filters.value.mode === 'aux_item' ? filters.value.accountId : undefined,
    year: filters.value.year,
    startMonth: filters.value.startMonth,
    endMonth: filters.value.endMonth,
    includeUnposted: filters.value.includeUnposted,
    accountCode: filters.value.mode === 'counter' ? filters.value.accountCode : undefined,
  }
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

async function loadAuxItems(categoryId: string) {
  if (!categoryId) { availableAuxItems.value = []; auxItemTruncated.value = false; return }
  auxItemsLoading.value = true
  try {
    const { items, total } = await fetchAuxItemsPage({
      category_id: categoryId,
      status: 'active',
      page: 1,
      pageSize: AUX_ITEM_PAGE_SIZE,
    })
    availableAuxItems.value = items
    auxItemTruncated.value = total > items.length
  } catch (error) {
    console.error('加载辅助项目失败:', error)
    availableAuxItems.value = []
    auxItemTruncated.value = false
  } finally {
    auxItemsLoading.value = false
  }
}

async function loadSettings() {
  if (!canQuery.value) return
  const data = await getAuxMultiColumnSettings(currentQuery())
  category.value = data?.category || null
  mainAccount.value = data?.account || null
  columns.value = data?.columns || []
  settingsDraft.value = columns.value.map(column => ({ ...column }))
}

async function fetchData() {
  if (!canQuery.value) { rows.value = []; columns.value = []; initialLoaded.value = true; return }
  if (filters.value.startMonth > filters.value.endMonth) filters.value.endMonth = filters.value.startMonth
  errorMessage.value = ''
  try {
    const data = await raced.run(() => getAuxMultiColumnLedger(currentQuery()))
    if (!data) return
    category.value = data?.category || category.value
    mainAccount.value = data?.account || null
    columns.value = data?.columns || []
    rows.value = data?.rows || []
    initialLoaded.value = true
    await afterTableLayout()
  } catch (error: any) {
    rows.value = []; initialLoaded.value = true
    errorMessage.value = error?.response?.data?.message || error?.message || '辅助项目多栏明细账查询失败'
  }
}

function resetResult() {
  rows.value = []
  columns.value = []
  settingsDraft.value = []
  mainAccount.value = null
  initialLoaded.value = false
  errorMessage.value = ''
}

async function onCategoryChange() {
  filters.value.auxItemIds = []
  category.value = null
  resetResult()
  await loadAuxItems(filters.value.categoryId)
  await fetchData()
}

async function onModeChange() {
  resetResult()
  if (filters.value.mode === 'aux_item' && accounts.value.length === 0) {
    await baseDataStore.loadAccounts()
  }
  await fetchData()
}

async function handleQuery() { await fetchData() }

async function openSettings() {
  try {
    await loadSettings()
    settingsVisible.value = true
  } catch (error: any) {
    ElMessage.error(error?.response?.data?.message || error?.message || '读取栏目设置失败')
  }
}

function makeExportColumn(column: AuxMultiColumnAccount): ExportColumnDef<AuxMultiColumnRow> { return { label: column.printName || column.label, width: colWidth(column.key, 118), align: 'right', type: 'amount', value: row => row.amounts?.[column.key] || '' } }
function buildExportColumns(): ExportColumnDef<AuxMultiColumnRow>[] {
  return [
    { label: '日期', width: colWidth('voucher_date', 92), value: row => row.row_type === 'init' ? '' : row.voucher_date },
    { label: '凭证号', width: colWidth('voucher_no', 110), value: row => row.row_type === 'entry' ? row.voucher_no : '' },
    { label: '摘要', width: colWidth('summary', 170), value: row => row.summary },
    { label: subjectColumnLabel.value, width: colWidth('account_name', 200), value: row => subjectText(row) },
    { label: '借方', children: debitColumns.value.map(makeExportColumn) }, { label: '贷方', children: creditColumns.value.map(makeExportColumn) },
    { label: '借方合计', width: colWidth('debit_total', 125), align: 'right', type: 'amount', value: row => row.debit_total || '' },
    { label: '贷方合计', width: colWidth('credit_total', 125), align: 'right', type: 'amount', value: row => row.credit_total || '' },
    { label: '方向', width: colWidth('direction_label', 58), align: 'center', value: row => row.direction_label },
    { label: '余额', width: colWidth('balance', 125), align: 'right', type: 'amount', value: row => Math.abs(row.balance || 0) || '' },
  ]
}
function subtitleText() {
  const parts = [`账套: ${accountSetName.value || '未命名账套'}`]
  if (category.value) parts.push(`辅助类别: ${category.value.code} ${category.value.name}`)
  if (mainAccount.value) parts.push(`主科目: ${mainAccount.value.code} ${mainAccount.value.name}`)
  parts.push(`分栏: ${filters.value.mode === 'counter' ? '对方科目' : '辅助项目'}`)
  parts.push(`期间: ${periodLabel.value}`)
  return parts.join(' ')
}
function buildPrintHtml(ctx?: { fontSize?: number }) {
  const childColumns = [...debitColumns.value, ...creditColumns.value].map(column => ({ label: column.printName || column.label, align: 'right' as const, render: (row: AuxMultiColumnRow) => amountText(row.amounts?.[column.key]) }))
  return buildTablePrintHtml<AuxMultiColumnRow>({
    title: '辅助项目多栏明细账', subtitle: [subtitleText()], rows: rows.value, monochrome: true, fitToPage: true, fontSize: ctx?.fontSize ?? 11,
    headerRows: [
      [
        { label: '日期', rowspan: 2 }, { label: '凭证号', rowspan: 2 }, { label: '摘要', rowspan: 2 }, { label: subjectColumnLabel.value, rowspan: 2 },
        { label: '借方', colspan: debitColumns.value.length }, { label: '贷方', colspan: creditColumns.value.length },
        { label: '借方合计', rowspan: 2 }, { label: '贷方合计', rowspan: 2 }, { label: '方向', rowspan: 2 }, { label: '余额', rowspan: 2 },
      ],
      [...debitColumns.value, ...creditColumns.value].map(column => ({ label: column.printName || column.label })),
    ],
    rowStyle: row => row.row_type === 'entry' ? '' : 'font-weight:600;background:#f5f7fa;',
    columns: [
      { label: '日期', align: 'center', render: row => row.row_type === 'init' ? '' : row.voucher_date },
      { label: '凭证号', align: 'center', render: row => row.row_type === 'entry' ? row.voucher_no : '' },
      { label: '摘要', align: 'left', render: row => row.summary },
      { label: subjectColumnLabel.value, align: 'left', render: row => subjectText(row) },
      ...childColumns,
      { label: '借方合计', align: 'right', render: row => amountText(row.debit_total) },
      { label: '贷方合计', align: 'right', render: row => amountText(row.credit_total) },
      { label: '方向', align: 'center', render: row => row.direction_label },
      { label: '余额', align: 'right', render: row => balanceText(row.balance) },
    ],
  })
}
async function exportData() {
  if (!rows.value.length) return
  await exportStyledTable({
    fileName: `辅助项目多栏明细账_${filters.value.year}_${filters.value.startMonth}-${filters.value.endMonth}.xlsx`,
    sheetName: '辅助项目多栏明细账',
    title: '辅助项目多栏明细账',
    subtitle: subtitleText(),
    columns: buildExportColumns(),
    rows: rows.value,
  })
}
function printPage() { if (rows.value.length) hiprintVisible.value = true }
async function saveSettings() {
  if (!canQuery.value) return
  savingSettings.value = true
  try {
    const settings: AuxMultiColumnSetting[] = settingsDraft.value.map(column => ({ accountId: column.accountId, enabled: column.enabled, printName: column.printName, sortOrder: column.sortOrder }))
    const data = await saveAuxMultiColumnSettings({ ...currentQuery(), columns: settings })
    columns.value = data?.columns || []
    settingsDraft.value = columns.value.map(column => ({ ...column }))
    await fetchData(); settingsVisible.value = false; ElMessage.success('栏目设置已保存')
  } catch (error: any) { ElMessage.error(error?.response?.data?.message || error?.message || '保存栏目设置失败') } finally { savingSettings.value = false }
}

onMounted(async () => {
  try {
    await Promise.all([fetchAuxCategories(), baseDataStore.loadAccounts()])
    if (filters.value.categoryId) {
      await loadAuxItems(filters.value.categoryId)
      await fetchData()
    }
  } catch (error: any) {
    initialLoaded.value = true
    errorMessage.value = error?.message || '读取辅助项目多栏明细账失败'
  }
})
onActivated(() => { void tryRestoreVoucherModal() })
</script>

<style scoped>
.aux-multi-column-page { padding: var(--page-pad); min-width: 1180px; }
.aux-multi-column-header { align-items: flex-start; gap: 12px; margin-bottom: 8px; }
.aux-multi-column-title-wrap { display: flex; align-items: baseline; gap: 12px; flex: 0 0 auto; padding-top: 5px; }
.aux-multi-column-title-wrap h3 { margin: 0; white-space: nowrap; }
.main-account-label, .aux-multi-column-subtitle { color: var(--el-text-color-secondary); font-size: 12px; }
.aux-item-filter { width: 260px; }
.account-filter { width: 220px; }
.aux-multi-column-subtitle { display: flex; gap: 18px; margin: -2px 0 8px; flex-wrap: wrap; }
.warning-text { color: var(--el-color-warning); }
.error-text { color: var(--el-color-danger); }
.aux-multi-column-table :deep(.aux-init-row) { background: #fff8e8 !important; font-weight: 600; }
.aux-multi-column-table :deep(.aux-month-total-row) { background: #eef8ff !important; font-weight: 600; }
.aux-multi-column-table :deep(.aux-year-total-row) { background: #e6f4ea !important; font-weight: 700; }
.pagination { display: flex; justify-content: flex-end; min-height: 24px; padding-top: 4px; }
.total-tip { color: var(--el-text-color-secondary); font-size: 12px; }
.settings-tip { margin-bottom: 12px; padding: 10px 12px; color: var(--el-text-color-secondary); background: var(--el-fill-color-light); border-radius: 4px; font-size: 13px; line-height: 1.6; }
.drawer-footer { display: flex; justify-content: flex-end; gap: 8px; }
</style>
