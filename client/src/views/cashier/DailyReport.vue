<template>
  <div class="page page-daily">
    <CashierReportFilter
      ref="filterRef"
      v-model="filter"
      mode="balance"
      :loading="loading"
      @query="load"
      @clear="handleClear"
    />
    <div class="toolbar-row">
      <el-checkbox v-model="includeZero" @change="load">显示零发生额账户</el-checkbox>
      <el-button plain :disabled="!report?.rows.length" @click="handleExport"><el-icon><Download /></el-icon>导出</el-button>
      <el-button plain :disabled="!report?.rows.length" @click="handlePrint"><el-icon><Printer /></el-icon>打印</el-button>
      <span class="tip">双击一行可查看该账户的出纳流水账</span>
    </div>

    <div v-if="report" class="report-body">
      <h4 class="report-title">
        账户资金余额表
        <span class="subtitle">（{{ periodText }}　单位：{{ unitLabel }}）</span>
      </h4>

      <el-alert
        v-if="report.empty_accounts > 0 && !includeZero"
        type="info" :closable="false" show-icon class="report-alert"
        :title="`有 ${report.empty_accounts} 个账户在所选条件下没有数据，已隐藏；勾选「显示零发生额账户」可查看`"
      />
      <el-alert
        v-if="!report.rows.length"
        type="warning" :closable="false" show-icon class="report-alert"
        title="所选条件下没有数据。币种跟科目走：人民币科目不会出现在外币余额表里，可切换币种或选择「全部（折本位币）」"
      />

      <el-table
        v-if="report.rows.length"
        ref="tableRef"
        :data="report.rows"
        size="small" class="compact-data-table" border stripe
        style="cursor: pointer;"
        @row-dblclick="drillToJournal"
        @header-dragend="onDragEnd"
      >
        <el-table-column label="科目编码" prop="account_code" :width="cw('account_code', 110)" />
        <el-table-column label="科目名称" prop="account_name" min-width="150" :width="widths.account_name" show-overflow-tooltip />
        <el-table-column label="币种" prop="currency" :width="cw('currency', 70)" align="center" />
        <el-table-column label="期初余额" prop="opening" :width="cw('opening', 130)" align="right">
          <template #default="{ row }">{{ fmt(row.opening) }}</template>
        </el-table-column>
        <el-table-column label="本期收入" prop="income" :width="cw('income', 130)" align="right">
          <template #default="{ row }"><span v-if="row.income" class="debit">{{ fmt(row.income) }}</span></template>
        </el-table-column>
        <el-table-column label="本期支出" prop="expense" :width="cw('expense', 130)" align="right">
          <template #default="{ row }"><span v-if="row.expense" class="credit">{{ fmt(row.expense) }}</span></template>
        </el-table-column>
        <el-table-column label="期末余额" prop="closing" :width="cw('closing', 130)" align="right">
          <template #default="{ row }"><b>{{ fmt(row.closing) }}</b></template>
        </el-table-column>
        <template v-if="report.currency_mode === 'all'">
          <el-table-column label="收入（本位币）" prop="income_base" :width="cw('income_base', 130)" align="right">
            <template #default="{ row }">{{ row.income_base ? fmt(row.income_base) : '' }}</template>
          </el-table-column>
          <el-table-column label="支出（本位币）" prop="expense_base" :width="cw('expense_base', 130)" align="right">
            <template #default="{ row }">{{ row.expense_base ? fmt(row.expense_base) : '' }}</template>
          </el-table-column>
          <el-table-column label="期末（本位币）" prop="closing_base" :width="cw('closing_base', 140)" align="right">
            <template #default="{ row }">
              {{ fmt(row.closing_base) }}<el-tooltip v-if="row.base_estimated" content="外币期初余额按期初所在期间汇率折算，仅供参考"><span class="est">*</span></el-tooltip>
            </template>
          </el-table-column>
        </template>
        <el-table-column label="本期笔数" prop="count" :width="cw('count', 80)" align="right" />
        <el-table-column label="未对账笔数" prop="unreconciled_count" :width="cw('unreconciled_count', 90)" align="right">
          <template #default="{ row }"><span :class="{ warn: row.unreconciled_count }">{{ row.unreconciled_count || '' }}</span></template>
        </el-table-column>
        <el-table-column label="未对账净额" prop="unreconciled_net" :width="cw('unreconciled_net', 120)" align="right">
          <template #default="{ row }">{{ row.unreconciled_net ? fmt(row.unreconciled_net) : '' }}</template>
        </el-table-column>
      </el-table>

      <!-- 合计：不同币种原币不能直接相加，按币种分别合计；另给本位币折算合计 -->
      <div v-if="report.rows.length" class="summary-section">
        <div v-for="t in report.totals" :key="t.currency" class="summary-card">
          <span class="s-label">{{ t.currency }} 合计（{{ t.count }} 笔）</span>
          <span class="s-line">期初 {{ fmt(t.opening) }}　<span class="debit">收入 {{ fmt(t.income) }}</span>　<span class="credit">支出 {{ fmt(t.expense) }}</span>　期末 <b>{{ fmt(t.closing) }}</b></span>
        </div>
        <div v-if="report.totals.length > 1 || report.currency_mode === 'all'" class="summary-card summary-card--base">
          <span class="s-label">本位币（{{ report.base_currency }}）折算合计</span>
          <span class="s-line"><span class="debit">收入 {{ fmt(report.total_base.income) }}</span>　<span class="credit">支出 {{ fmt(report.total_base.expense) }}</span>　期末 <b>{{ fmt(report.total_base.closing) }}</b></span>
        </div>
      </div>
    </div>

    <el-empty v-else-if="!loading" description="请选择条件后查询" />

    <HiprintDialog
      v-model="printVisible"
      template-type="ledger"
      template-key="cashier:balance-report"
      title="账户资金余额表"
      :get-print-html="buildPrintHtml"
      default-paper="A4"
      default-orientation="landscape"
      :use-templates="false"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { Download, Printer } from '@element-plus/icons-vue'
import { cashierApi, type CashierBalanceReport, type CashierBalanceRow } from '@/api/cashier'
import CashierReportFilter from '@/components/cashier/CashierReportFilter.vue'
import HiprintDialog from '@/components/print/HiprintDialog.vue'
import { buildTablePrintHtml } from '@/utils/printTemplateHiprint'
import { exportStyledTableViaSource, type ExportColumnDef } from '@/utils/exportStyledExcel'
import { useListColumnWidth } from '@/composables/useColumnWidthMemory'
import {
  ALL_CURRENCIES,
  defaultCashierFilter,
  describeFilter,
  filterFromRouteQuery,
  toReportPayload,
  type CashierReportFilterState,
} from '@/utils/cashierReportFilter'

const { tableRef, colWidth, onDragEnd, widths } = useListColumnWidth('cashier_daily_report')
function cw(key: string, fallback: number) { return colWidth(key, fallback) }

const router = useRouter()
const filterRef = ref<InstanceType<typeof CashierReportFilter>>()
const filter = ref<CashierReportFilterState>(filterFromRouteQuery(router.currentRoute.value.query) || defaultCashierFilter())
const report = ref<CashierBalanceReport | null>(null)
const loading = ref(false)
const includeZero = ref(false)
const printVisible = ref(false)

const fmt = (v: number) => (v ?? 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const isAll = computed(() => filter.value.currency === ALL_CURRENCIES)
/** 单位标签：单币种显示币种；跨币种显示本位币（折算后） */
const unitLabel = computed(() => {
  const base = report.value?.base_currency || filterRef.value?.baseCurrency || 'RMB'
  if (isAll.value) return `${base}（本位币折算）`
  return filter.value.currency || base
})
const accountNames = computed(() => Object.fromEntries((filterRef.value?.accounts || []).map(a => [a.code, `${a.code} ${a.name}`])))
const periodText = computed(() => describeFilter(filter.value, { accounts: accountNames.value }) || '')

async function load() {
  if (!filter.value.dateRange?.[0] || !filter.value.dateRange?.[1]) return ElMessage.warning('请选择起止日期')
  loading.value = true
  try {
    const res = await cashierApi.reportBalance({ ...toReportPayload(filter.value), include_zero: includeZero.value })
    if (res.code === 0) report.value = res.data
  } finally { loading.value = false }
}

function handleClear() {
  filter.value = defaultCashierFilter()
  includeZero.value = false
  load()
}

/** 钻取：该账户 + 币种 + 期间的出纳流水账 */
function drillToJournal(row: CashierBalanceRow) {
  router.push({
    path: '/cashier/flow-query',
    query: {
      account_code: row.account_code,
      currency: row.currency,
      start_date: filter.value.dateRange?.[0] || '',
      end_date: filter.value.dateRange?.[1] || '',
    },
  })
}

function buildPrintHtml() {
  const r = report.value
  if (!r) return ''
  const all = r.currency_mode === 'all'
  const columns: any[] = [
    { label: '科目编码', render: (x: CashierBalanceRow) => x.account_code },
    { label: '科目名称', render: (x: CashierBalanceRow) => x.account_name },
    { label: '币种', align: 'center', render: (x: CashierBalanceRow) => x.currency },
    { label: '期初余额', align: 'right', render: (x: CashierBalanceRow) => fmt(x.opening) },
    { label: '本期收入', align: 'right', render: (x: CashierBalanceRow) => (x.income ? fmt(x.income) : '') },
    { label: '本期支出', align: 'right', render: (x: CashierBalanceRow) => (x.expense ? fmt(x.expense) : '') },
    { label: '期末余额', align: 'right', render: (x: CashierBalanceRow) => fmt(x.closing) },
  ]
  if (all) {
    columns.push(
      { label: '收入(本位币)', align: 'right', render: (x: CashierBalanceRow) => (x.income_base ? fmt(x.income_base) : '') },
      { label: '支出(本位币)', align: 'right', render: (x: CashierBalanceRow) => (x.expense_base ? fmt(x.expense_base) : '') },
      { label: '期末(本位币)', align: 'right', render: (x: CashierBalanceRow) => fmt(x.closing_base) },
    )
  }
  columns.push(
    { label: '本期笔数', align: 'right', render: (x: CashierBalanceRow) => String(x.count) },
    { label: '未对账净额', align: 'right', render: (x: CashierBalanceRow) => (x.unreconciled_net ? fmt(x.unreconciled_net) : '') },
  )
  const footerSubtotals = r.totals.map(t => columns.map((_, i) => {
    if (i === 0) return `${t.currency} 合计`
    if (i === 3) return fmt(t.opening)
    if (i === 4) return fmt(t.income)
    if (i === 5) return fmt(t.expense)
    if (i === 6) return fmt(t.closing)
    return ''
  }))
  return buildTablePrintHtml<CashierBalanceRow>({
    title: '账户资金余额表',
    subtitle: `${periodText.value}　单位：${unitLabel.value}`,
    rows: r.rows,
    columns,
    monochrome: true,
    fitToPage: true,
    footerSubtotals,
  })
}

function handlePrint() {
  if (!report.value?.rows.length) return ElMessage.warning('暂无数据可打印')
  printVisible.value = true
}

async function handleExport() {
  const r = report.value
  if (!r?.rows.length) return ElMessage.warning('暂无数据可导出')
  const all = r.currency_mode === 'all'
  const columns: ExportColumnDef<any>[] = [
    { key: 'account_code', label: '科目编码', width: 110 },
    { key: 'account_name', label: '科目名称', width: 170 },
    { key: 'currency', label: '币种', width: 70, align: 'center' },
    { key: 'opening', label: '期初余额', width: 130, align: 'right', type: 'amount' },
    { key: 'income', label: '本期收入', width: 130, align: 'right', type: 'amount' },
    { key: 'expense', label: '本期支出', width: 130, align: 'right', type: 'amount' },
    { key: 'closing', label: '期末余额', width: 130, align: 'right', type: 'amount' },
    ...(all ? [
      { key: 'income_base', label: '收入(本位币)', width: 130, align: 'right', type: 'amount' },
      { key: 'expense_base', label: '支出(本位币)', width: 130, align: 'right', type: 'amount' },
      { key: 'closing_base', label: '期末(本位币)', width: 130, align: 'right', type: 'amount' },
    ] as ExportColumnDef<any>[] : []),
    { key: 'count', label: '本期笔数', width: 80, align: 'right' },
    { key: 'unreconciled_count', label: '未对账笔数', width: 90, align: 'right' },
    { key: 'unreconciled_net', label: '未对账净额', width: 120, align: 'right', type: 'amount' },
  ]
  const [s, e] = filter.value.dateRange || ['', '']
  await exportStyledTableViaSource({
    fileName: `账户资金余额表_${s}_${e}.xlsx`,
    sheetName: '账户资金余额表',
    title: '账户资金余额表',
    subtitle: `${periodText.value}　（单位：${unitLabel.value}）`,
    columns,
    source: { type: 'cashierBalance', params: { ...toReportPayload(filter.value), include_zero: includeZero.value } },
  })
}

onMounted(load)
</script>

<style scoped>
.page-daily { display: flex; flex-direction: column; height: 100%; }
.toolbar-row { display: flex; align-items: center; gap: 12px; padding: 4px 16px 0; }
.tip { font-size: 12px; color: var(--el-text-color-placeholder); }
.report-body { flex: 1; overflow: auto; padding: 8px 16px 16px; }
.report-title { margin: 0 0 10px; font-size: var(--cw-text-xl); text-align: center; }
.subtitle { font-size: 12px; color: var(--el-text-color-secondary); font-weight: 400; }
.report-alert { margin-bottom: 8px; }
.summary-section { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 12px; justify-content: flex-end; }
.summary-card { padding: 8px 16px; border-radius: 6px; background: var(--el-fill-color-lighter); display: flex; flex-direction: column; gap: 4px; }
.summary-card--base { background: var(--el-color-primary-light-9); }
.s-label { font-size: 12px; color: var(--el-text-color-secondary); }
.s-line { font-size: 13px; }
.debit { color: #409eff; }
.credit { color: #f56c6c; }
.warn { color: var(--el-color-warning); font-weight: 600; }
.est { color: var(--el-color-warning); margin-left: 2px; cursor: help; }
</style>
