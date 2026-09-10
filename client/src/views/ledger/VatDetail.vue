<template>
  <div class="page page-ledger vat-detail-page">
    <div class="page-header vat-detail-header">
      <div class="vat-title-wrap">
        <h3>增值税明细账</h3>
        <span v-if="parentLabel" class="vat-parent-label">{{ parentLabel }}</span>
      </div>
      <div class="filter-row">
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
        <el-button type="primary" :loading="loading" @click="handleQuery">
          <el-icon><Search /></el-icon>查询
        </el-button>
        <el-divider direction="vertical" />
        <el-button plain :disabled="loading || rows.length === 0" @click="exportData">
          <el-icon><Download /></el-icon>导出 Excel
        </el-button>
        <el-button plain :disabled="loading || rows.length === 0" @click="printPage">
          <el-icon><Printer /></el-icon>打印
        </el-button>
        <el-button plain @click="settingsVisible = true">栏目设置</el-button>
      </div>
    </div>

    <div class="vat-subtitle">
      <span>期间：{{ periodLabel }}</span>
      <span v-if="mappedCount < columns.length" class="vat-warning">
        已解析 {{ mappedCount }}/{{ columns.length }} 个栏目，请检查栏目设置
      </span>
      <span v-if="errorMessage" class="vat-error">{{ errorMessage }}</span>
    </div>

    <AccountScopeAlert />

    <div v-if="!initialLoaded && loading" class="skeleton-table">
      <div v-for="i in 8" :key="i" class="skeleton skeleton-row" />
    </div>

    <EmptyState
      v-else-if="columns.length > 0 && mappedCount === 0"
      type="account"
      description="尚未解析到增值税明细科目，请打开“栏目设置”维护科目编码"
    />

    <div
      v-else
      ref="tableContainerRef"
      v-loading="loading"
      class="table-summary-scroll table-summary-scroll--wide table-summary-scroll--flow"
    >
      <el-table
        ref="tableRef"
        :data="rows"
        :height="tableHeight"
        :style="{ width: `${ledgerTableWidth}px` }"
        :fit="false"
        border
        stripe
        size="small"
        class="compact-data-table vat-detail-table"
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
        <el-table-column column-key="summary" label="摘要" :width="colWidth('summary', 150)">
          <template #default="{ row }">{{ row.summary }}</template>
        </el-table-column>
        <el-table-column column-key="account_name" label="科目" :width="colWidth('account_name', 190)">
          <template #default="{ row }">
            <span v-if="row.row_type === 'entry'">{{ row.account_code }} {{ row.account_name }}</span>
          </template>
        </el-table-column>

        <el-table-column label="借方" align="center">
          <el-table-column
            v-for="column in debitColumns"
            :key="column.key"
            :column-key="column.key"
            :label="column.printName || column.label"
            :width="colWidth(column.key, 118)"
            align="right"
          >
            <template #default="{ row }">{{ amountText(row.amounts?.[column.key]) }}</template>
          </el-table-column>
        </el-table-column>
        <el-table-column label="贷方" align="center">
          <el-table-column
            v-for="column in creditColumns"
            :key="column.key"
            :column-key="column.key"
            :label="column.printName || column.label"
            :width="colWidth(column.key, 118)"
            align="right"
          >
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

        <template #empty>
          <EmptyState type="data" description="暂无数据，请选择期间后查询" />
        </template>
      </el-table>
    </div>

    <div class="pagination">
      <span class="total-tip">共 {{ entryCount }} 条分录，{{ rows.length }} 行</span>
    </div>

    <VoucherEntryDialogHost ref="entryDialogHostRef" @saved="fetchData" />

    <HiprintDialog
      v-model="hiprintVisible"
      template-type="ledger"
      template-key="ledger:vat-detail"
      title="增值税明细账"
      :get-print-html="buildPrintHtml"
      default-paper="A4"
      default-orientation="landscape"
      :use-templates="false"
    />

    <el-drawer v-model="settingsVisible" title="增值税明细账栏目设置" size="720px">
      <div class="settings-tip">
        每个栏目对应“应交增值税”下的明细科目。留空时系统会按默认编码和科目名称自动探测。
      </div>
      <el-table :data="settingsDraft" border size="small" class="settings-table">
        <el-table-column label="方向" width="70" align="center">
          <template #default="{ row }">{{ row.side === 'debit' ? '借方' : '贷方' }}</template>
        </el-table-column>
        <el-table-column prop="label" label="栏目" width="140" />
        <el-table-column label="科目编码" min-width="150">
          <template #default="{ row }">
            <el-input v-model="row.accountCode" size="small" placeholder="自动探测" />
          </template>
        </el-table-column>
        <el-table-column label="当前解析" min-width="210">
          <template #default="{ row }">
            <div class="resolved-account">
              <span :class="['source-dot', `source-dot--${row.source}`]" />
              <span>{{ row.accountPath || '未找到科目' }}</span>
            </div>
          </template>
        </el-table-column>
      </el-table>
      <template #footer>
        <div class="drawer-footer">
          <el-button @click="settingsVisible = false">取消</el-button>
          <el-button type="primary" :loading="savingSettings" @click="saveSettings">保存并刷新</el-button>
        </div>
      </template>
    </el-drawer>
  </div>
</template>

<script setup lang="ts">
import { computed, onActivated, onMounted, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { Download, Printer, Search } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { useUserStore } from '@/stores/user'
import AccountScopeAlert from '@/components/AccountScopeAlert.vue'
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
  getVatLedger,
  getVatLedgerSettings,
  saveVatLedgerSettings,
  type VatColumn,
  type VatColumnSetting,
  type VatLedgerRow,
} from '@/api/ledgerVat'

const { accountSetName } = storeToRefs(useUserStore())
const currentYear = new Date().getFullYear()
const years = Array.from({ length: currentYear - 2000 + 1 }, (_, index) => currentYear - index)
const filters = ref({
  year: currentYear,
  startMonth: 1,
  endMonth: 12,
  includeUnposted: true,
})
const columns = ref<VatColumn[]>([])
const rows = ref<VatLedgerRow[]>([])
const parent = ref<{ code: string; name: string } | null>(null)
const loading = ref(false)
const initialLoaded = ref(false)
const errorMessage = ref('')
const settingsVisible = ref(false)
const savingSettings = ref(false)
const settingsDraft = ref<Array<VatColumn & { accountCode: string }>>([])
const hiprintVisible = ref(false)

const debitColumns = computed(() => columns.value.filter(column => column.side === 'debit'))
const creditColumns = computed(() => columns.value.filter(column => column.side === 'credit'))
const mappedCount = computed(() => columns.value.filter(column => column.accountId).length)
const entryCount = computed(() => rows.value.filter(row => row.row_type === 'entry').length)
const parentLabel = computed(() => (parent.value ? `科目：${parent.value.code} ${parent.value.name}` : ''))
const periodLabel = computed(() => `${filters.value.year}年${filters.value.startMonth}月-${filters.value.endMonth}月`)

const ledgerColumnDefs = computed(() => [
  { key: 'voucher_date', fallback: 92 },
  { key: 'voucher_no', fallback: 110 },
  { key: 'summary', fallback: 150 },
  { key: 'account_name', fallback: 190 },
  ...columns.value.map(column => ({ key: column.key, fallback: 118 })),
  { key: 'debit_total', fallback: 125 },
  { key: 'credit_total', fallback: 125 },
  { key: 'direction_label', fallback: 58 },
  { key: 'balance', fallback: 125 },
])
const { containerRef: tableContainerRef, tableHeight, relayoutAfterData } = useFillHeightTable({ flow: true })
const { tableRef, colWidth, ledgerTableWidth, handleHeaderDragEnd, afterTableLayout } = useLedgerWideTable(
  'ledger_vat_detail',
  ledgerColumnDefs,
  { afterLayout: relayoutAfterData }
)

const entryDialogHostRef = ref<InstanceType<typeof VoucherEntryDialogHost> | null>(null)
const { tryRestoreVoucherModal } = useVoucherModalRestore(entryDialogHostRef)
const { handleLedgerRowDblClick } = useLedgerVoucherNavigate({
  returnLabel: '增值税明细账',
  getReturnQuery: () => ({
    year: String(filters.value.year),
    start_month: String(filters.value.startMonth),
    end_month: String(filters.value.endMonth),
  }),
  openVoucherModal: row => {
    if ((row as VatLedgerRow).row_type !== 'entry') return
    const voucherId = resolveLedgerVoucherId(row)
    if (!voucherId) return
    entryDialogHostRef.value?.open({ _voucherId: voucherId, id: voucherId, status: row.voucher_status })
  },
})

function amountText(value: number | undefined) {
  const number = Number(value) || 0
  return Math.abs(number) < 0.005 ? '' : formatAmount(number)
}

function balanceText(value: number | undefined) {
  const number = Number(value) || 0
  return Math.abs(number) < 0.005 ? '' : formatAmount(Math.abs(number))
}

function getRowClassName({ row }: { row: VatLedgerRow }) {
  if (row.row_type === 'init') return 'vat-init-row'
  if (row.row_type === 'month_total') return 'vat-month-total-row'
  if (row.row_type === 'year_total') return 'vat-year-total-row'
  return ''
}

function ensureMonthRange() {
  if (filters.value.startMonth > filters.value.endMonth) {
    filters.value.endMonth = filters.value.startMonth
  }
}

async function loadSettings() {
  const data = await getVatLedgerSettings()
  columns.value = data?.columns || []
  parent.value = data?.parent || null
  settingsDraft.value = columns.value.map(column => ({ ...column, accountCode: column.accountCode || '' }))
}

async function fetchData() {
  ensureMonthRange()
  loading.value = true
  errorMessage.value = ''
  try {
    const data = await getVatLedger({
      year: filters.value.year,
      startMonth: filters.value.startMonth,
      endMonth: filters.value.endMonth,
      includeUnposted: filters.value.includeUnposted,
    })
    columns.value = data?.columns || columns.value
    parent.value = data?.parent || parent.value
    rows.value = data?.rows || []
    initialLoaded.value = true
    await afterTableLayout()
  } catch (error: any) {
    rows.value = []
    initialLoaded.value = true
    errorMessage.value = error?.response?.data?.message || error?.message || '增值税明细账查询失败'
  } finally {
    loading.value = false
  }
}

async function handleQuery() {
  await fetchData()
}

function buildExportColumns(): ExportColumnDef<VatLedgerRow>[] {
  const base: ExportColumnDef<VatLedgerRow>[] = [
    { label: '日期', width: colWidth('voucher_date', 92), value: row => row.row_type === 'init' ? '' : row.voucher_date },
    { label: '凭证号', width: colWidth('voucher_no', 110), value: row => row.row_type === 'entry' ? row.voucher_no : '' },
    { label: '摘要', width: colWidth('summary', 150), value: row => row.summary },
    { label: '科目', width: colWidth('account_name', 190), value: row => row.row_type === 'entry' ? `${row.account_code} ${row.account_name}` : '' },
  ]
  const makeColumn = (column: VatColumn): ExportColumnDef<VatLedgerRow> => ({
    label: column.printName || column.label,
    width: colWidth(column.key, 118),
    align: 'right',
    type: 'amount',
    value: row => row.amounts?.[column.key] || '',
  })
  return [
    ...base,
    { label: '借方', children: debitColumns.value.map(makeColumn) },
    { label: '贷方', children: creditColumns.value.map(makeColumn) },
    { label: '借方合计', width: colWidth('debit_total', 125), align: 'right', type: 'amount', value: row => row.debit_total || '' },
    { label: '贷方合计', width: colWidth('credit_total', 125), align: 'right', type: 'amount', value: row => row.credit_total || '' },
    { label: '方向', width: colWidth('direction_label', 58), align: 'center', value: row => row.direction_label },
    { label: '余额', width: colWidth('balance', 125), align: 'right', type: 'amount', value: row => Math.abs(row.balance || 0) || '' },
  ]
}

function buildPrintHtml(ctx?: { fontSize?: number }) {
  const childColumns = [
    ...debitColumns.value.map(column => ({ label: column.printName || column.label, align: 'right' as const, render: (row: VatLedgerRow) => amountText(row.amounts?.[column.key]) })),
    ...creditColumns.value.map(column => ({ label: column.printName || column.label, align: 'right' as const, render: (row: VatLedgerRow) => amountText(row.amounts?.[column.key]) })),
  ]
  return buildTablePrintHtml<VatLedgerRow>({
    title: '增值税明细账',
    subtitle: [`账套: ${accountSetName.value || '未命名账套'} ${parentLabel.value} 期间: ${periodLabel.value}`],
    rows: rows.value,
    monochrome: true,
    fitToPage: true,
    fontSize: ctx?.fontSize ?? 11,
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
      [
        ...debitColumns.value.map(column => ({ label: column.printName || column.label })),
        ...creditColumns.value.map(column => ({ label: column.printName || column.label })),
      ],
    ],
    rowStyle: row => row.row_type === 'entry' ? '' : 'font-weight:600;background:#f5f7fa;',
    columns: [
      { label: '日期', align: 'center', render: row => row.row_type === 'init' ? '' : row.voucher_date },
      { label: '凭证号', align: 'center', render: row => row.row_type === 'entry' ? row.voucher_no : '' },
      { label: '摘要', align: 'left', render: row => row.summary },
      { label: '科目', align: 'left', render: row => row.row_type === 'entry' ? `${row.account_code} ${row.account_name}` : '' },
      ...childColumns,
      { label: '借方合计', align: 'right', render: row => amountText(row.debit_total) },
      { label: '贷方合计', align: 'right', render: row => amountText(row.credit_total) },
      { label: '方向', align: 'center', render: row => row.direction_label },
      { label: '余额', align: 'right', render: row => balanceText(row.balance) },
    ],
  })
}

async function exportData() {
  if (rows.value.length === 0) return
  const dateRange = `${filters.value.year}_${String(filters.value.startMonth).padStart(2, '0')}-${String(filters.value.endMonth).padStart(2, '0')}`
  await exportStyledTable({
    fileName: `增值税明细账_${dateRange}.xlsx`,
    sheetName: '增值税明细账',
    title: '增值税明细账',
    subtitle: `${parentLabel.value} period: ${periodLabel.value}`,
    columns: buildExportColumns(),
    rows: rows.value,
  })
}

function printPage() {
  if (rows.value.length > 0) hiprintVisible.value = true
}

async function saveSettings() {
  savingSettings.value = true
  try {
    const settings: VatColumnSetting[] = settingsDraft.value.map(column => ({
      key: column.key,
      accountCode: column.accountCode.trim(),
      printName: column.printName,
      printNameEn: column.printNameEn,
    }))
    await saveVatLedgerSettings(settings)
    await loadSettings()
    await fetchData()
    settingsVisible.value = false
    ElMessage.success('栏目设置已保存')
  } catch (error: any) {
    ElMessage.error(error?.response?.data?.message || error?.message || '保存栏目设置失败')
  } finally {
    savingSettings.value = false
  }
}

onMounted(async () => {
  try {
    await loadSettings()
    await fetchData()
  } catch (error: any) {
    initialLoaded.value = true
    errorMessage.value = error?.response?.data?.message || error?.message || '读取增值税明细账设置失败'
  }
})

onActivated(() => {
  void tryRestoreVoucherModal()
})
</script>

<style scoped>
.vat-detail-page {
  padding: 12px 16px 8px;
  min-width: 1180px;
}

.vat-detail-header {
  align-items: flex-start;
  gap: 12px;
  margin-bottom: 8px;
}

.vat-title-wrap {
  display: flex;
  align-items: baseline;
  gap: 12px;
  flex: 0 0 auto;
  padding-top: 5px;
}

.vat-title-wrap h3 {
  margin: 0;
  white-space: nowrap;
}

.vat-parent-label,
.vat-subtitle {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.vat-subtitle {
  display: flex;
  gap: 18px;
  margin: -2px 0 8px;
}

.vat-warning {
  color: var(--el-color-warning);
}

.vat-error {
  color: var(--el-color-danger);
}

.vat-detail-table :deep(.vat-init-row) {
  background: #fff8e8 !important;
  font-weight: 600;
}

.vat-detail-table :deep(.vat-month-total-row) {
  background: #eef8ff !important;
  font-weight: 600;
}

.vat-detail-table :deep(.vat-year-total-row) {
  background: #e6f4ea !important;
  font-weight: 700;
}

.pagination {
  display: flex;
  justify-content: flex-end;
  min-height: 24px;
  padding-top: 4px;
}

.total-tip {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.settings-tip {
  margin-bottom: 12px;
  padding: 10px 12px;
  color: var(--el-text-color-secondary);
  background: var(--el-fill-color-light);
  border-radius: 4px;
  font-size: 13px;
  line-height: 1.6;
}

.settings-table :deep(.el-input__inner) {
  font-size: 12px;
}

.resolved-account {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--el-text-color-secondary);
  font-size: 12px;
  line-height: 1.4;
}

.source-dot {
  width: 7px;
  height: 7px;
  flex: 0 0 7px;
  border-radius: 50%;
  background: var(--el-color-info);
}

.source-dot--param { background: var(--el-color-primary); }
.source-dot--code { background: var(--el-color-success); }
.source-dot--name { background: var(--el-color-warning); }
.source-dot--none { background: var(--el-color-danger); }

.drawer-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
