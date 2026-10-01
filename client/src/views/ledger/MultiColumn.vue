<template>
  <div class="page page-ledger multi-column-page">
    <div class="page-header multi-column-header">
      <div class="multi-column-title-wrap">
        <h3>多栏账</h3>
        <span v-if="mainAccount" class="main-account-label">{{ mainAccount.code }} {{ mainAccount.name }}</span>
      </div>
      <div class="filter-row">
        <el-select v-model="filters.accountId" filterable clearable class="account-filter" placeholder="选择主科目" @change="onAccountChange">
          <el-option-group v-for="group in accountGroups" :key="group.code" :label="group.label">
            <el-option v-for="account in group.accounts" :key="account.id" :label="`${account.code} ${account.name}`" :value="account.id" />
          </el-option-group>
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
        <el-checkbox v-model="filters.includeUnposted">统计未记账凭证</el-checkbox>
        <el-button type="primary" :loading="loading" @click="handleQuery"><el-icon><Search /></el-icon>查询</el-button>
        <FilterClearButton @clear="handleClearFilters" />
        <el-divider direction="vertical" />
        <el-button plain :disabled="loading || rows.length === 0" @click="exportData"><el-icon><Download /></el-icon>导出 Excel</el-button>
        <el-button plain :disabled="loading || rows.length === 0" @click="printPage"><el-icon><Printer /></el-icon>打印</el-button>
        <el-button plain :disabled="!filters.accountId || columns.length === 0" @click="settingsVisible = true">栏目设置</el-button>
      </div>
    </div>

    <div class="multi-column-subtitle">
      <span>期间：{{ periodLabel }}</span>
      <span v-if="filters.accountId && columns.length === 0" class="warning-text">当前主科目没有可分栏的末级子科目</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </div>

    <AccountScopeAlert />

    <EmptyState v-if="!filters.accountId" type="account" description="请选择主科目后查询多栏账" />
    <div v-else-if="!initialLoaded && loading" class="skeleton-table">
      <div v-for="i in 8" :key="i" class="skeleton skeleton-row" />
    </div>
    <EmptyState v-else-if="columns.length === 0" type="account" description="当前主科目没有可分栏的末级科目" />
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
        class="compact-data-table multi-column-table"
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
        <el-table-column column-key="account_name" label="科目" :width="colWidth('account_name', 190)">
          <template #default="{ row }">{{ row.row_type === 'entry' ? `${row.account_code} ${row.account_name}` : '' }}</template>
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
    <HiprintDialog v-model="hiprintVisible" template-type="ledger" template-key="ledger:multi-column" title="多栏账" :get-print-html="buildPrintHtml" default-paper="A4" default-orientation="landscape" :use-templates="false" />

    <el-drawer v-model="settingsVisible" title="多栏账栏目设置" size="720px">
      <div class="settings-tip">当前主科目下的末级子科目会自动生成栏目，可调整启用状态、顺序和打印名称。</div>
      <el-table :data="settingsDraft" border size="small">
        <el-table-column label="方向" width="70" align="center"><template #default="{ row }">{{ row.side === 'debit' ? '借方' : '贷方' }}</template></el-table-column>
        <el-table-column prop="accountCode" label="科目编码" width="130" />
        <el-table-column prop="accountName" label="科目名称" width="150" />
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
import { buildTablePrintHtml } from '@/utils/printTemplateHiprint'
import { exportStyledTable, type ExportColumnDef } from '@/utils/exportStyledExcel'
import { formatAmount } from '@/utils/format'
import {
  getMultiColumnLedger,
  getMultiColumnSettings,
  saveMultiColumnSettings,
  type MultiColumnAccount,
  type MultiColumnLedgerRow,
  type MultiColumnSetting,
  type MultiColumnMainAccount,
} from '@/api/ledgerMultiColumn'

import { useRacedQuery } from '@/composables/useRacedQuery'
const { accountSetName } = storeToRefs(useUserStore())
const baseDataStore = useBaseDataStore()
const currentYear = new Date().getFullYear()
const years = Array.from({ length: currentYear - 2000 + 1 }, (_, index) => currentYear - index)
const filters = ref({ accountId: '', year: currentYear, startMonth: 1, endMonth: 12, includeUnposted: true })
const { clearFilters } = useFilterClear([filters])

/** 清空筛选条件并恢复默认查询 */
function handleClearFilters() {
  clearFilters()
  handleQuery()
}
const rows = ref<MultiColumnLedgerRow[]>([])
const columns = ref<MultiColumnAccount[]>([])
const mainAccount = ref<MultiColumnMainAccount | null>(null)
const settingsDraft = ref<MultiColumnAccount[]>([])
// FIX-157：请求序号防竞态，loading 由 raced 统一维护
const raced = useRacedQuery()
const loading = raced.loading
const initialLoaded = ref(false)
const errorMessage = ref('')
const settingsVisible = ref(false)
const savingSettings = ref(false)
const hiprintVisible = ref(false)

// 多栏账按下级科目分栏，只有带子科目的科目才有意义
const accountGroups = computed(() => {
  const all = baseDataStore.accounts as any[]
  const codes = all.map(a => String(a.code))
  const accounts = all.filter(a => {
    const code = String(a.code)
    return a.id && codes.some(c => c.length > code.length && c.startsWith(code))
  })
  return [{ code: 'all', label: '可选科目', accounts }]
})
const debitColumns = computed(() => columns.value.filter(column => column.side === 'debit'))
const creditColumns = computed(() => columns.value.filter(column => column.side === 'credit'))
const entryCount = computed(() => rows.value.filter(row => row.row_type === 'entry').length)
const periodLabel = computed(() => `${filters.value.year}年${filters.value.startMonth}月-${filters.value.endMonth}月`)
const ledgerColumnDefs = computed(() => [
  { key: 'voucher_date', fallback: 92 }, { key: 'voucher_no', fallback: 110 }, { key: 'summary', fallback: 170 }, { key: 'account_name', fallback: 190 },
  ...columns.value.map(column => ({ key: column.key, fallback: 118 })),
  { key: 'debit_total', fallback: 125 }, { key: 'credit_total', fallback: 125 }, { key: 'direction_label', fallback: 58 }, { key: 'balance', fallback: 125 },
])
const { containerRef: tableContainerRef, tableHeight, relayoutAfterData } = useFillHeightTable({ flow: true })
const { tableRef, colWidth, ledgerTableWidth, handleHeaderDragEnd, afterTableLayout } = useLedgerWideTable('ledger_multi_column', ledgerColumnDefs, { afterLayout: relayoutAfterData })
const entryDialogHostRef = ref<InstanceType<typeof VoucherEntryDialogHost> | null>(null)
const { tryRestoreVoucherModal } = useVoucherModalRestore(entryDialogHostRef)
const { handleLedgerRowDblClick } = useLedgerVoucherNavigate({
  returnLabel: '多栏账',
  getReturnQuery: () => ({ account_id: filters.value.accountId, year: String(filters.value.year), start_month: String(filters.value.startMonth), end_month: String(filters.value.endMonth) }),
  openVoucherModal: row => {
    if ((row as MultiColumnLedgerRow).row_type !== 'entry') return
    const voucherId = resolveLedgerVoucherId(row)
    if (!voucherId) return
    entryDialogHostRef.value?.open({ _voucherId: voucherId, id: voucherId, status: row.voucher_status })
  },
})

function ensureMonthRange() { if (filters.value.startMonth > filters.value.endMonth) filters.value.endMonth = filters.value.startMonth }
function amountText(value: number | undefined) { const number = Number(value) || 0; return Math.abs(number) < 0.005 ? '' : formatAmount(number) }
function balanceText(value: number | undefined) { const number = Number(value) || 0; return Math.abs(number) < 0.005 ? '' : formatAmount(Math.abs(number)) }
function getRowClassName({ row }: { row: MultiColumnLedgerRow }) { return row.row_type === 'init' ? 'multi-init-row' : row.row_type === 'month_total' ? 'multi-month-total-row' : row.row_type === 'year_total' ? 'multi-year-total-row' : '' }

async function loadAccounts() { await baseDataStore.loadAccounts() }
async function loadSettings() {
  if (!filters.value.accountId) return
  const data = await getMultiColumnSettings(filters.value.accountId)
  mainAccount.value = data?.main || null
  columns.value = data?.columns || []
  settingsDraft.value = columns.value.map(column => ({ ...column }))
}
async function fetchData() {
  ensureMonthRange()
  if (!filters.value.accountId) { rows.value = []; initialLoaded.value = true; return }
  errorMessage.value = ''
  try {
    const data = await raced.run(() => getMultiColumnLedger({ accountId: filters.value.accountId, year: filters.value.year, startMonth: filters.value.startMonth, endMonth: filters.value.endMonth, includeUnposted: filters.value.includeUnposted }))
    if (!data) return
    mainAccount.value = data?.main || mainAccount.value
    columns.value = data?.columns || columns.value
    rows.value = data?.rows || []
    initialLoaded.value = true
    await afterTableLayout()
  } catch (error: any) {
    rows.value = []; initialLoaded.value = true; errorMessage.value = error?.response?.data?.message || error?.message || '多栏账查询失败'
  }
}
async function onAccountChange() { rows.value = []; initialLoaded.value = false; await loadSettings(); await fetchData() }
async function handleQuery() { await fetchData() }

function makeExportColumn(column: MultiColumnAccount): ExportColumnDef<MultiColumnLedgerRow> { return { label: column.printName || column.label, width: colWidth(column.key, 118), align: 'right', type: 'amount', value: row => row.amounts?.[column.key] || '' } }
function buildExportColumns(): ExportColumnDef<MultiColumnLedgerRow>[] {
  return [
    { label: '日期', width: colWidth('voucher_date', 92), value: row => row.row_type === 'init' ? '' : row.voucher_date },
    { label: '凭证号', width: colWidth('voucher_no', 110), value: row => row.row_type === 'entry' ? row.voucher_no : '' },
    { label: '摘要', width: colWidth('summary', 170), value: row => row.summary },
    { label: '科目', width: colWidth('account_name', 190), value: row => row.row_type === 'entry' ? `${row.account_code} ${row.account_name}` : '' },
    { label: '借方', children: debitColumns.value.map(makeExportColumn) }, { label: '贷方', children: creditColumns.value.map(makeExportColumn) },
    { label: '借方合计', width: colWidth('debit_total', 125), align: 'right', type: 'amount', value: row => row.debit_total || '' },
    { label: '贷方合计', width: colWidth('credit_total', 125), align: 'right', type: 'amount', value: row => row.credit_total || '' },
    { label: '方向', width: colWidth('direction_label', 58), align: 'center', value: row => row.direction_label },
    { label: '余额', width: colWidth('balance', 125), align: 'right', type: 'amount', value: row => Math.abs(row.balance || 0) || '' },
  ]
}
function buildPrintHtml(ctx?: { fontSize?: number }) {
  const childColumns = [...debitColumns.value, ...creditColumns.value].map(column => ({ label: column.printName || column.label, align: 'right' as const, render: (row: MultiColumnLedgerRow) => amountText(row.amounts?.[column.key]) }))
  return buildTablePrintHtml<MultiColumnLedgerRow>({
    title: '多栏账', subtitle: [`账套: ${accountSetName.value || '未命名账套'} 主科目: ${mainAccount.value ? `${mainAccount.value.code} ${mainAccount.value.name}` : ''} 期间: ${periodLabel.value}`], rows: rows.value, monochrome: true, fitToPage: true, fontSize: ctx?.fontSize ?? 11,
    headerRows: [
      [
        { label: '日期', rowspan: 2 },
        { label: '凭证号', rowspan: 2 },
        { label: '摘要', rowspan: 2 },
        { label: '科目', rowspan: 2 },
        { label: '借方', colspan: debitColumns.value.length },
        { label: '贷方', colspan: creditColumns.value.length },
        { label: '借方合计', rowspan: 2 },
        { label: '贷方合计', rowspan: 2 },
        { label: '方向', rowspan: 2 },
        { label: '余额', rowspan: 2 },
      ],
      [...debitColumns.value, ...creditColumns.value].map(column => ({ label: column.printName || column.label })),
    ],
    rowStyle: row => row.row_type === 'entry' ? '' : 'font-weight:600;background:#f5f7fa;',
    columns: [{ label: '日期', align: 'center', render: row => row.row_type === 'init' ? '' : row.voucher_date }, { label: '凭证号', align: 'center', render: row => row.row_type === 'entry' ? row.voucher_no : '' }, { label: '摘要', align: 'left', render: row => row.summary }, { label: '科目', align: 'left', render: row => row.row_type === 'entry' ? `${row.account_code} ${row.account_name}` : '' }, ...childColumns, { label: '借方合计', align: 'right', render: row => amountText(row.debit_total) }, { label: '贷方合计', align: 'right', render: row => amountText(row.credit_total) }, { label: '方向', align: 'center', render: row => row.direction_label }, { label: '余额', align: 'right', render: row => balanceText(row.balance) }],
  })
}
async function exportData() { if (!rows.value.length) return; await exportStyledTable({ fileName: `多栏账_${filters.value.year}_${filters.value.startMonth}-${filters.value.endMonth}.xlsx`, sheetName: '多栏账', title: '多栏账', subtitle: `${mainAccount.value?.code || ''} ${mainAccount.value?.name || ''} 期间: ${periodLabel.value}`, columns: buildExportColumns(), rows: rows.value }) }
function printPage() { if (rows.value.length) hiprintVisible.value = true }
async function saveSettings() {
  if (!filters.value.accountId) return
  savingSettings.value = true
  try {
    const settings: MultiColumnSetting[] = settingsDraft.value.map(column => ({ accountId: column.accountId, enabled: column.enabled, printName: column.printName, printNameEn: column.printNameEn, sortOrder: column.sortOrder }))
    const data = await saveMultiColumnSettings(filters.value.accountId, settings)
    columns.value = data?.columns || []
    settingsDraft.value = columns.value.map(column => ({ ...column }))
    await fetchData(); settingsVisible.value = false; ElMessage.success('栏目设置已保存')
  } catch (error: any) { ElMessage.error(error?.response?.data?.message || error?.message || '保存栏目设置失败') } finally { savingSettings.value = false }
}
onMounted(async () => { try { await loadAccounts(); if (filters.value.accountId) await loadSettings(); await fetchData() } catch (error: any) { initialLoaded.value = true; errorMessage.value = error?.message || '读取多栏账失败' } })
onActivated(() => { void tryRestoreVoucherModal() })
</script>

<style scoped>
.multi-column-page { padding: var(--page-pad); min-width: 1180px; }
.multi-column-header { align-items: flex-start; gap: 12px; margin-bottom: 8px; }
.multi-column-title-wrap { display: flex; align-items: baseline; gap: 12px; flex: 0 0 auto; padding-top: 5px; }
.multi-column-title-wrap h3 { margin: 0; white-space: nowrap; }
.main-account-label, .multi-column-subtitle { color: var(--el-text-color-secondary); font-size: 12px; }
.account-filter { width: 220px; }
.multi-column-subtitle { display: flex; gap: 18px; margin: -2px 0 8px; }
.warning-text { color: var(--el-color-warning); }
.error-text { color: var(--el-color-danger); }
.multi-column-table :deep(.multi-init-row) { background: #fff8e8 !important; font-weight: 600; }
.multi-column-table :deep(.multi-month-total-row) { background: #eef8ff !important; font-weight: 600; }
.multi-column-table :deep(.multi-year-total-row) { background: #e6f4ea !important; font-weight: 700; }
.pagination { display: flex; justify-content: flex-end; min-height: 24px; padding-top: 4px; }
.total-tip { color: var(--el-text-color-secondary); font-size: 12px; }
.settings-tip { margin-bottom: 12px; padding: 10px 12px; color: var(--el-text-color-secondary); background: var(--el-fill-color-light); border-radius: 4px; font-size: 13px; line-height: 1.6; }
.drawer-footer { display: flex; justify-content: flex-end; gap: 8px; }
</style>
