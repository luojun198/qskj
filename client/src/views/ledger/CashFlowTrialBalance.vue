<template>
  <div class="page page-ledger page-cf-trial">
    <div class="page-header">
      <h3>现金流量试算平衡表</h3>
      <div class="filter-row">
        <el-select v-model="filters.year" placeholder="年份" style="width: 100px" @change="fetchAll">
          <el-option v-for="y in years" :key="y" :label="`${y}年`" :value="y" />
        </el-select>
        <el-select v-model="filters.period" placeholder="月份" style="width: 100px" @change="fetchAll">
          <el-option v-for="m in 12" :key="m" :label="`${m}月`" :value="m" />
        </el-select>
        <el-select v-model="filters.scope" style="width: 130px" @change="fetchAll">
          <el-option label="本月" value="month" />
          <el-option label="本年累计" value="ytd" />
        </el-select>
        <el-checkbox v-model="filters.include_unposted" @change="fetchAll">统计未记账凭证</el-checkbox>
        <el-button type="primary" :loading="loading" @click="fetchAll"><el-icon><Search /></el-icon>查询</el-button>
        <FilterClearButton @clear="handleClearFilters" />
        <el-divider direction="vertical" />
        <el-button plain :disabled="!canExport" @click="exportCurrentTab"><el-icon><Download /></el-icon>导出 Excel</el-button>
        <el-button plain :disabled="!data && !checkData" @click="printPage"><el-icon><Printer /></el-icon>打印</el-button>
      </div>
    </div>
    <div v-if="!enabled" class="disabled-tip">
      <el-empty description="账套未启用现金流核算，请先在系统参数中开启" />
    </div>

    <template v-else>
      <el-tabs v-model="activeTab" class="main-tabs" @tab-change="onTabChange">
        <el-tab-pane label="试算平衡" name="trial">
          <div v-if="data" class="summary-section">
            <div class="meta-line">
              <span>{{ data.meta.scopeLabel }}</span>
              <span class="meta-sep">|</span>
              <span>{{ data.meta.accountingStandardName }}</span>
              <el-tag
                :type="data.summary.balanced ? 'success' : 'danger'"
                size="small"
                class="balance-tag"
              >
                {{ data.summary.balanced ? '平衡' : '不平衡' }}
              </el-tag>
            </div>

            <div class="summary-cards">
              <div class="summary-card">
                <div class="label">{{ data.meta.activityLabels.operating }}净额</div>
                <div class="value">{{ formatAmount(data.summary.operatingNet) }}</div>
              </div>
              <div class="summary-card">
                <div class="label">{{ data.meta.activityLabels.investing }}净额</div>
                <div class="value">{{ formatAmount(data.summary.investingNet) }}</div>
              </div>
              <div class="summary-card">
                <div class="label">{{ data.meta.activityLabels.financing }}净额</div>
                <div class="value">{{ formatAmount(data.summary.financingNet) }}</div>
              </div>
              <div class="summary-card highlight">
                <div class="label">现金流量净额</div>
                <div class="value">{{ formatAmount(data.summary.totalNet) }}</div>
              </div>
              <div class="summary-card">
                <div class="label">现金科目净变动</div>
                <div class="value">{{ formatAmount(data.summary.cashAccountNetChange) }}</div>
              </div>
              <div class="summary-card" :class="{ danger: Math.abs(data.summary.diff) >= 0.01 }">
                <div class="label">差额</div>
                <div class="value">{{ formatAmount(data.summary.diff) }}</div>
              </div>
            </div>
          </div>

          <div v-if="data?.balanceChecks?.length" class="checks-section">
            <h4>平衡校验</h4>
            <div
              v-for="check in data.balanceChecks"
              :key="check.id"
              class="check-row"
              :class="check.passed ? 'passed' : check.severity"
            >
              <el-icon v-if="check.passed"><CircleCheck /></el-icon>
              <el-icon v-else><Warning /></el-icon>
              <span class="check-label">{{ check.label }}</span>
              <span v-if="check.expected != null" class="check-detail">
                期望 {{ formatAmount(check.expected) }}，实际 {{ formatAmount(check.actual ?? 0) }}，差额
                {{ formatAmount(check.diff) }}
              </span>
              <span v-else class="check-detail">{{ check.actual ?? 0 }} 笔</span>
            </div>
          </div>

          <div v-if="data" class="table-section">
            <h4>现金流量项目试算</h4>
            <el-table ref="tableRef" :data="data.items" border stripe size="small" class="trial-table" @header-dragend="onDragEnd">
              <el-table-column prop="code" label="编码" :width="cw('code', 90)" />
              <el-table-column prop="name" label="项目名称" min-width="200" :width="widths.name" show-overflow-tooltip />
              <el-table-column prop="activityLabel" label="活动分类" :width="cw('activityLabel', 100)" />
              <el-table-column label="流向" column-key="direction" :width="cw('direction', 70)">
                <template #default="{ row }">{{ directionLabel(row.direction) }}</template>
              </el-table-column>
              <el-table-column label="借方发生" column-key="debitTotal" :width="cw('debitTotal', 120)" align="right">
                <template #default="{ row }">{{ formatAmount(row.debitTotal) }}</template>
              </el-table-column>
              <el-table-column label="贷方发生" column-key="creditTotal" :width="cw('creditTotal', 120)" align="right">
                <template #default="{ row }">{{ formatAmount(row.creditTotal) }}</template>
              </el-table-column>
              <el-table-column label="净额" column-key="signedNet" :width="cw('signedNet', 120)" align="right">
                <template #default="{ row }">
                  <span :class="amountClass(row.signedNet)">{{ formatAmount(row.signedNet) }}</span>
                </template>
              </el-table-column>
              <el-table-column prop="voucherCount" label="凭证笔数" :width="cw('voucherCount', 90)" align="center" />
            </el-table>
          </div>
        </el-tab-pane>

        <el-tab-pane name="check">
          <template #label>
            <span>凭证检查</span>
            <el-badge
              v-if="checkData && checkData.summary.issueCount > 0"
              :value="checkData.summary.issueCount"
              class="tab-badge"
            />
          </template>

          <div v-if="checkLoading" class="check-loading">
            <el-skeleton :rows="4" animated />
          </div>

          <template v-else-if="checkData">
            <div class="check-header">
              <div class="check-summary-line">
                <span>{{ checkData.meta.scopeLabel }}</span>
                <span class="meta-sep">|</span>
                <span>
                  共检查 {{ checkData.summary.totalCashEntries }} 笔现金/银行分录，
                  <template v-if="checkData.summary.passed">全部合格</template>
                  <template v-else>
                    发现 {{ checkData.summary.issueCount }} 笔问题
                    <span v-if="checkData.summary.missingCount">
                      （未指定 {{ checkData.summary.missingCount }}）
                    </span>
                    <span v-if="checkData.summary.invalidCodeCount">
                      （无效编码 {{ checkData.summary.invalidCodeCount }}）
                    </span>
                  </template>
                </span>
                <el-tag :type="checkData.summary.passed ? 'success' : 'danger'" size="small">
                  {{ checkData.summary.passed ? '检查通过' : '存在问题' }}
                </el-tag>
              </div>
              <div class="check-actions">
                <el-button plain size="small" @click="goVoucherQuery">在凭证查询中查看</el-button>
              </div>
            </div>

            <el-alert
              v-if="checkData.summary.passed"
              type="success"
              :closable="false"
              show-icon
              title="当前期间所有现金/银行分录均已正确指定有效的现金流量项目"
              class="check-pass-alert"
            />

            <div class="table-section">
              <h4>
                未指定现金流量项目
                <span class="count-tag">（{{ checkData.summary.missingCount }} 笔）</span>
              </h4>
              <el-empty
                v-if="checkData.summary.missingCount === 0"
                description="无此类问题"
                :image-size="64"
              />
              <el-table
                v-else
                :data="checkData.missingEntries"
                border
                stripe
                size="small"
                class="clickable-table"
                @row-dblclick="openVoucher"
              >
                <EntryColumns />
              </el-table>
            </div>

            <div class="table-section">
              <h4>
                无效现金流量项目编码
                <span class="count-tag">（{{ checkData.summary.invalidCodeCount }} 笔）</span>
              </h4>
              <el-empty
                v-if="checkData.summary.invalidCodeCount === 0"
                description="无此类问题"
                :image-size="64"
              />
              <el-table
                v-else
                :data="checkData.invalidCodeEntries"
                border
                stripe
                size="small"
                class="clickable-table"
                @row-dblclick="openVoucher"
              >
                <el-table-column prop="cashFlowCode" label="错误编码" width="100" />
                <EntryColumns />
              </el-table>
            </div>

            <div class="table-section">
              <h4>
                非现金科目误填现金流量项目
                <span class="count-tag hint">（{{ checkData.summary.orphanCount }} 笔，参考提示）</span>
              </h4>
              <el-empty
                v-if="checkData.summary.orphanCount === 0"
                description="无此类提示"
                :image-size="64"
              />
              <el-table
                v-else
                :data="checkData.orphanEntries"
                border
                stripe
                size="small"
                class="clickable-table"
                @row-dblclick="openVoucher"
              >
                <el-table-column prop="cashFlowCode" label="现金流量编码" width="110" />
                <EntryColumns />
              </el-table>
            </div>
          </template>
        </el-tab-pane>
      </el-tabs>
    </template>

    <VoucherEntryDialogHost ref="entryDialogHostRef" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, defineComponent, h } from 'vue'
import { useRouter } from 'vue-router'
import { Search, Download, Printer, CircleCheck, Warning } from '@element-plus/icons-vue'
import { ElTableColumn } from 'element-plus'
import request from '@/api/request'
import { formatAmount } from '@/utils/format'
import { showOperationError } from '@/composables/useMessage'
import { useSystemParamsStore } from '@/stores/systemParams'
import VoucherEntryDialogHost from '@/components/voucher/VoucherEntryDialogHost.vue'
import { exportStyledTable, exportStyledWorkbook, type ExportColumnDef } from '@/utils/exportStyledExcel'
import { useListColumnWidth } from '@/composables/useColumnWidthMemory'
import { useRacedQuery } from '@/composables/useRacedQuery'
import FilterClearButton from '@/components/common/FilterClearButton.vue'
import { useFilterClear } from '@/composables/useFilterClear'

const { tableRef, colWidth, onDragEnd, widths } = useListColumnWidth('ledger_cf_trial_balance')
function cw(key: string, fallback: number) { return colWidth(key, fallback) }

type VoucherCheckEntry = {
  voucherId: string
  voucherNo: string
  voucherDate: string
  accountCode: string
  accountName: string
  direction: string
  amount: number
  status: string
  cashFlowCode?: string | null
  issueLabel?: string
}

type TrialBalanceData = {
  meta: {
    scopeLabel: string
    accountingStandardName: string
    activityLabels: { operating: string; investing: string; financing: string }
  }
  summary: {
    operatingNet: number
    investingNet: number
    financingNet: number
    totalNet: number
    cashAccountNetChange: number
    diff: number
    balanced: boolean
  }
  items: Array<{
    code: string
    name: string
    activityLabel: string
    direction: string
    debitTotal: number
    creditTotal: number
    signedNet: number
    voucherCount: number
  }>
  balanceChecks: Array<{
    id: string
    label: string
    expected: number | null
    actual: number | null
    diff: number
    passed: boolean
    severity: string
  }>
}

type VoucherCheckData = {
  meta: { scopeLabel: string }
  summary: {
    totalCashEntries: number
    missingCount: number
    invalidCodeCount: number
    orphanCount: number
    issueCount: number
    passed: boolean
  }
  missingEntries: VoucherCheckEntry[]
  invalidCodeEntries: VoucherCheckEntry[]
  orphanEntries: VoucherCheckEntry[]
}

const EntryColumns = defineComponent({
  name: 'EntryColumns',
  setup() {
    return () => [
      h(ElTableColumn, { prop: 'voucherDate', label: '日期', width: '110' }),
      h(ElTableColumn, { prop: 'voucherNo', label: '凭证号', width: '120' }),
      h(ElTableColumn, { prop: 'accountCode', label: '科目编码', width: '100' }),
      h(ElTableColumn, { prop: 'accountName', label: '科目名称', minWidth: '140' }),
      // FIX-155：default 是插槽不是 prop，必须走 h() 第三参数，否则三列渲染为空
      h(
        ElTableColumn,
        { label: '方向', width: '70' },
        { default: ({ row }: { row: VoucherCheckEntry }) => (row.direction === 'debit' ? '借' : '贷') }
      ),
      h(
        ElTableColumn,
        { label: '金额', width: '120', align: 'right' },
        { default: ({ row }: { row: VoucherCheckEntry }) => formatAmount(row.amount) }
      ),
      h(
        ElTableColumn,
        { prop: 'status', label: '状态', width: '80' },
        { default: ({ row }: { row: VoucherCheckEntry }) => statusLabel(row.status) }
      ),
    ]
  },
})

const router = useRouter()
const systemParamsStore = useSystemParamsStore()
const enabled = computed(() => systemParamsStore.enableCashFlow)

// FIX-157：请求序号防竞态，loading 由 raced 统一维护
const raced = useRacedQuery()
const loading = raced.loading
const checkLoading = ref(false)
const activeTab = ref<'trial' | 'check'>('trial')
const data = ref<TrialBalanceData | null>(null)
const checkData = ref<VoucherCheckData | null>(null)
const entryDialogHostRef = ref<InstanceType<typeof VoucherEntryDialogHost> | null>(null)

const filters = ref({
  year: new Date().getFullYear(),
  period: new Date().getMonth() + 1,
  scope: 'month' as 'month' | 'ytd',
  include_unposted: false,
})
const { clearFilters } = useFilterClear([filters])

/** 清空筛选条件并恢复默认查询 */
function handleClearFilters() {
  clearFilters()
  fetchAll()
}

const years = Array.from(
  { length: new Date().getFullYear() - 2000 + 1 },
  (_, i) => new Date().getFullYear() - i
)

const canExport = computed(() => {
  if (activeTab.value === 'trial') return !!data.value
  return !!checkData.value
})

function buildParams() {
  return {
    year: filters.value.year,
    period: filters.value.period,
    scope: filters.value.scope,
    include_unposted: filters.value.include_unposted,
  }
}

function directionLabel(direction: string) {
  if (direction === 'inflow') return '流入'
  if (direction === 'outflow') return '流出'
  return '—'
}

function statusLabel(status: string) {
  if (status === 'posted') return '已记账'
  if (status === 'audited') return '已审核'
  return '草稿'
}

function amountClass(value: number) {
  if (value > 0) return 'amount-positive'
  if (value < 0) return 'amount-negative'
  return ''
}

async function fetchCheckData() {
  const res = await request.get<any>('/ledger/cash-flow-voucher-check', { params: buildParams() })
  checkData.value = res.data
}

async function fetchAll() {
  if (!enabled.value) return
  checkLoading.value = true
  try {
    const params = buildParams()
    const result = await raced.run(() =>
      Promise.all([
        request.get<any>('/ledger/cash-flow-trial-balance', { params }),
        request.get<any>('/ledger/cash-flow-voucher-check', { params }),
      ])
    )
    if (!result) return
    data.value = result[0].data
    checkData.value = result[1].data
  } catch (error) {
    showOperationError('查询现金流量试算平衡表', error)
  } finally {
    checkLoading.value = false
  }
}

function onTabChange(tab: string | number) {
  if (tab === 'check' && !checkData.value && enabled.value) {
    checkLoading.value = true
    fetchCheckData()
      .catch(error => showOperationError('凭证检查', error))
      .finally(() => {
        checkLoading.value = false
      })
  }
}

function openVoucher(row: VoucherCheckEntry) {
  entryDialogHostRef.value?.open({
    _voucherId: row.voucherId,
    id: row.voucherId,
    status: row.status,
  })
}

function goVoucherQuery() {
  router.push({
    path: '/voucher/query',
    query: {
      year: String(filters.value.year),
      period: String(filters.value.period),
    },
  })
}

const entryExportColumns: ExportColumnDef<VoucherCheckEntry>[] = [
  { label: '日期', width: 12, value: row => row.voucherDate },
  { label: '凭证号', width: 14, value: row => row.voucherNo },
  { label: '科目编码', width: 12, value: row => row.accountCode },
  { label: '科目名称', width: 20, value: row => row.accountName },
  { label: '方向', width: 8, value: row => (row.direction === 'debit' ? '借' : '贷') },
  { label: '金额', width: 14, align: 'right', type: 'amount', value: row => row.amount },
  { label: '状态', width: 10, value: row => statusLabel(row.status) },
]

function exportCurrentTab() {
  if (activeTab.value === 'trial') {
    exportTrialData()
  } else {
    exportCheckData()
  }
}

function exportTrialData() {
  if (!data.value) return
  const d = data.value
  const columns: ExportColumnDef[] = [
    { label: '编码', width: 12, value: row => row.code },
    { label: '项目名称', width: 28, value: row => row.name },
    { label: '活动分类', width: 14, value: row => row.activityLabel },
    { label: '借方发生', width: 14, align: 'right', type: 'amount', value: row => row.debitTotal },
    { label: '贷方发生', width: 14, align: 'right', type: 'amount', value: row => row.creditTotal },
    { label: '净额', width: 14, align: 'right', type: 'amount', value: row => row.signedNet },
    { label: '凭证笔数', width: 10, value: row => row.voucherCount },
  ]
  void exportStyledTable({
    fileName: `现金流量试算平衡表_${filters.value.year}_${filters.value.period}月.xlsx`,
    sheetName: '试算平衡',
    title: `现金流量试算平衡表（${d.meta.scopeLabel}）`,
    columns,
    rows: d.items,
  })
}

async function exportCheckData() {
  if (!checkData.value) return
  const d = checkData.value
  const codeColumn: ExportColumnDef<VoucherCheckEntry> = {
    label: '现金流量编码',
    width: 14,
    value: row => row.cashFlowCode || '',
  }
  await exportStyledWorkbook(`现金流量凭证检查_${filters.value.year}_${filters.value.period}月.xlsx`, [
    {
      sheetName: '未指定项目',
      title: `未指定现金流量项目（${d.meta.scopeLabel}）`,
      columns: entryExportColumns,
      rows: d.missingEntries,
    },
    {
      sheetName: '无效编码',
      title: `无效现金流量项目编码（${d.meta.scopeLabel}）`,
      columns: [codeColumn, ...entryExportColumns],
      rows: d.invalidCodeEntries,
    },
    {
      sheetName: '非现金误填',
      title: `非现金科目误填（${d.meta.scopeLabel}）`,
      columns: [codeColumn, ...entryExportColumns],
      rows: d.orphanEntries,
    },
  ])
}

function printPage() {
  window.print()
}

onMounted(async () => {
  await systemParamsStore.load()
  if (enabled.value) await fetchAll()
})
</script>

<style scoped>
.page-cf-trial .filter-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-top: 12px;
}

.main-tabs {
  margin-top: 8px;
}

.tab-badge {
  margin-left: 6px;
  vertical-align: middle;
}

.disabled-tip {
  margin-top: 48px;
}

.summary-section {
  margin: 16px 0;
}

.meta-line,
.check-summary-line {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  color: var(--el-text-color-secondary);
  font-size: var(--cw-text-base);
  margin-bottom: 12px;
}

.meta-sep {
  opacity: 0.5;
}

.balance-tag {
  margin-left: 4px;
}

.summary-cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 12px;
}

.summary-card {
  padding: 12px 14px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
  background: var(--el-fill-color-blank);
}

.summary-card.highlight {
  border-color: var(--el-color-primary-light-5);
  background: var(--el-color-primary-light-9);
}

.summary-card.danger {
  border-color: var(--el-color-danger-light-5);
  background: var(--el-color-danger-light-9);
}

.summary-card .label {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  margin-bottom: 4px;
}

.summary-card .value {
  font-size: 16px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.check-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
  margin: 12px 0;
}

.check-pass-alert {
  margin-bottom: 16px;
}

.check-loading {
  padding: 24px 0;
}

.checks-section,
.table-section {
  margin-bottom: 20px;
}

.checks-section h4,
.table-section h4 {
  margin: 0 0 10px;
  font-size: var(--cw-text-base);
  font-weight: 600;
}

.count-tag {
  font-weight: normal;
  color: var(--el-text-color-secondary);
  font-size: var(--cw-text-base);
}

.count-tag.hint {
  color: var(--el-color-info);
}

.check-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 6px;
  margin-bottom: 6px;
  font-size: var(--cw-text-base);
  background: var(--el-fill-color-light);
}

.check-row.passed {
  color: var(--el-color-success);
}

.check-row.error {
  color: var(--el-color-danger);
  background: var(--el-color-danger-light-9);
}

.check-row.warning {
  color: var(--el-color-warning-dark-2);
  background: var(--el-color-warning-light-9);
}

.check-row.info {
  color: var(--el-text-color-secondary);
}

.check-label {
  flex: 1;
}

.check-detail {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  font-variant-numeric: tabular-nums;
}

.amount-positive {
  color: var(--el-color-success);
}

.amount-negative {
  color: var(--el-color-danger);
}

.clickable-table :deep(.el-table__row) {
  cursor: pointer;
}

@media print {
  .el-button,
  .check-actions {
    display: none !important;
  }
}
</style>
