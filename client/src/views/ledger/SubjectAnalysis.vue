<template>
  <div class="page subject-analysis-page">
    <div class="page-header">
      <div class="page-title">
        <h3>{{ presetDef.dialogTitle }}</h3>
        <span v-if="resultMeta" class="page-subtitle">{{ resultSubtitle }}</span>
      </div>
      <div class="page-actions">
        <el-button size="small" @click="optionsVisible = true">
          <el-icon><Setting /></el-icon>重选
        </el-button>
        <el-button size="small" plain :disabled="!hasResult" @click="exportData">
          <el-icon><Download /></el-icon>另存
        </el-button>
        <el-button size="small" plain :disabled="!hasResult" @click="openChart">
          <el-icon><Histogram /></el-icon>图形
        </el-button>
        <el-button size="small" plain :disabled="!hasResult" @click="printVisible = true">
          <el-icon><Printer /></el-icon>打印
        </el-button>
        <el-button size="small" plain @click="handleReturn">
          <el-icon><Back /></el-icon>返回
        </el-button>
      </div>
    </div>

    <!-- 年度分析：1~12 月横向列 -->
    <div
      v-if="resultMeta?.mode === 'annual'"
      v-loading="loading"
      ref="tableContainerRef"
      class="table-summary-scroll table-summary-scroll--wide table-summary-scroll--flow"
    >
      <el-table
        ref="tableRef"
        :key="annualColumnsKey"
        :height="tableHeight"
        :data="annual.rows"
        :style="{ width: `${annualTableWidth}px` }"
        :fit="false"
        stripe
        border
        size="small"
        class="compact-data-table"
        highlight-current-row
        show-summary
        :summary-method="annualSummaries"
        @row-dblclick="handleRowDblClick"
      >
        <el-table-column column-key="account_code" prop="account_code" label="科目编码" :width="colWidth('account_code', 110)" />
        <el-table-column column-key="account_name" prop="account_name" label="科目名称" :width="colWidth('account_name', 150)" show-overflow-tooltip />
        <el-table-column
          v-for="m in 12"
          :key="m"
          :column-key="`month${m}`"
          :prop="`month${m}`"
          :label="`${m}月`"
          :width="colWidth(`month${m}`, 96)"
          align="right"
        >
          <template #default="{ row }">{{ formatMoney(row.months[m - 1]) }}</template>
        </el-table-column>
        <el-table-column column-key="total" prop="total" label="合计" :width="colWidth('total', 110)" align="right">
          <template #default="{ row }">{{ formatMoney(row.total) }}</template>
        </el-table-column>
        <el-table-column
          v-if="resultMeta.showAverage"
          column-key="average"
          prop="average"
          label="月均"
          :width="colWidth('average', 100)"
          align="right"
        >
          <template #default="{ row }">{{ formatMoney(row.average) }}</template>
        </el-table-column>
        <el-table-column
          v-if="resultMeta.showRatio"
          column-key="ratio"
          prop="ratio"
          label="比例(%)"
          :width="colWidth('ratio', 80)"
          align="right"
        >
          <template #default="{ row }">{{ formatRatio(row.ratio) }}</template>
        </el-table-column>
        <template #empty>
          <EmptyState type="data" description="所选科目在该年度没有发生额" />
        </template>
      </el-table>
    </div>

    <!-- 月度分析：本月数 / 本年累计 + 比例 -->
    <div
      v-else-if="resultMeta?.mode === 'monthly'"
      v-loading="loading"
      ref="tableContainerRef"
      class="table-summary-scroll table-summary-scroll--flow"
    >
      <el-table
        ref="tableRef"
        :height="tableHeight"
        :data="monthly.rows"
        stripe
        border
        size="small"
        class="compact-data-table"
        highlight-current-row
        show-summary
        :summary-method="monthlySummaries"
        @row-dblclick="handleRowDblClick"
      >
        <el-table-column prop="account_code" label="科目编码" width="140" />
        <el-table-column prop="account_name" label="科目名称" min-width="200" show-overflow-tooltip />
        <el-table-column prop="current" label="本月数" width="160" align="right">
          <template #default="{ row }">{{ formatMoney(row.current) }}</template>
        </el-table-column>
        <el-table-column prop="currentRatio" label="比例(%)" width="110" align="right">
          <template #default="{ row }">{{ formatRatio(row.currentRatio) }}</template>
        </el-table-column>
        <el-table-column prop="ytd" label="本年累计" width="160" align="right">
          <template #default="{ row }">{{ formatMoney(row.ytd) }}</template>
        </el-table-column>
        <el-table-column prop="ytdRatio" label="比例(%)" width="110" align="right">
          <template #default="{ row }">{{ formatRatio(row.ytdRatio) }}</template>
        </el-table-column>
        <template #empty>
          <EmptyState type="data" description="所选科目在该月份没有发生额" />
        </template>
      </el-table>
    </div>

    <div v-else class="subject-analysis-empty">
      <EmptyState type="data" description="请先设置分析条件" />
    </div>

    <!-- 条件弹窗：对应经典总账「××费用分析」选项窗口 -->
    <el-dialog
      v-model="optionsVisible"
      :title="presetDef.dialogTitle"
      width="460px"
      :close-on-click-modal="false"
      @close="handleDialogClose"
    >
      <el-form label-width="90px" class="analysis-form">
        <div class="mode-switch">
          <el-radio-group v-model="form.mode">
            <el-radio value="annual">年度分析</el-radio>
            <el-radio value="monthly">月度分析</el-radio>
          </el-radio-group>
        </div>

        <el-form-item v-if="form.mode === 'annual'" label="分析年份">
          <el-input-number v-model="form.year" :min="1900" :max="2100" controls-position="right" class="year-input" />
        </el-form-item>
        <el-form-item v-else label="分析年月">
          <div class="period-picker">
            <el-input-number v-model="form.year" :min="1900" :max="2100" :controls="false" class="period-picker__year" />
            <span class="period-picker__dot">-</span>
            <el-input-number v-model="form.period" :min="1" :max="12" controls-position="right" class="period-picker__month" />
          </div>
        </el-form-item>

        <el-form-item label="科目">
          <el-select
            v-model="form.accountCode"
            filterable
            clearable
            placeholder="选择要分析的科目（可选非末级）"
            :popper-class="ACCOUNT_SELECT_POPPER_CLASS"
            class="account-select"
          >
            <el-option
              v-for="a in analyzableAccounts"
              :key="a.id"
              :label="`${a.code} ${a.name}`"
              :value="a.code"
            >
              <span :style="{ paddingLeft: `${(a.level - 1) * 12}px` }">{{ a.code }} {{ a.name }}</span>
            </el-option>
          </el-select>
        </el-form-item>

        <template v-if="form.mode === 'annual'">
          <div class="form-fieldset">
            <el-radio-group v-model="form.valueMode">
              <el-radio value="balance">按余额</el-radio>
              <el-radio value="debit">按借方发生额</el-radio>
              <el-radio value="credit">按贷方发生额</el-radio>
            </el-radio-group>
          </div>
          <div class="checks-row">
            <el-checkbox v-model="form.includeUnposted">包含未记帐的凭证</el-checkbox>
            <el-checkbox v-model="form.showAverage">月均</el-checkbox>
            <el-checkbox v-model="form.showRatio">比例</el-checkbox>
          </div>
        </template>
        <div v-else class="checks-row checks-row--center">
          <el-checkbox v-model="form.includeUnposted">包含未记帐的凭证</el-checkbox>
        </div>
      </el-form>

      <template #footer>
        <div class="dialog-footer">
          <el-button type="primary" :loading="loading" @click="handleAnalyze">确定</el-button>
          <el-button @click="handleCancel">取消</el-button>
        </div>
        <div class="dialog-tip">温馨提示：财务分析的数据不包含损益结转</div>
      </template>
    </el-dialog>

    <!-- 图形 -->
    <el-dialog v-model="chartVisible" :title="`${presetDef.dialogTitle} - 图形`" width="860px" destroy-on-close @opened="renderChart" @closed="disposeChart">
      <div ref="chartRef" class="analysis-chart" />
    </el-dialog>

    <HiprintDialog
      v-model="printVisible"
      template-type="ledger"
      template-key="ledger:subject-analysis"
      :title="presetDef.dialogTitle"
      :get-print-html="buildPrintHtml"
      default-paper="A4"
      :default-orientation="resultMeta?.mode === 'annual' ? 'landscape' : 'portrait'"
      :use-templates="false"
      :show-font-size="true"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'
import { Back, Download, Histogram, Printer, Setting } from '@element-plus/icons-vue'
import { ElMessage, type TableColumnCtx } from 'element-plus'
import type { ECharts } from 'echarts/core'
import request from '@/api/request'
import { formatAmount } from '@/utils/format'
import { exportStyledTable } from '@/utils/exportStyledExcel'
import { buildTablePrintHtml } from '@/utils/printTemplateHiprint'
import { ACCOUNT_SELECT_POPPER_CLASS } from '@/utils/accountSelectDisplay'
import { getGroupNavigationPath } from '@/utils/groupNavigation'
import HiprintDialog from '@/components/print/HiprintDialog.vue'
import EmptyState from '@/components/EmptyState.vue'
import { useFillHeightTable } from '@/composables/useFillHeightTable'
import { useListColumnWidth } from '@/composables/useColumnWidthMemory'
import { useBaseDataStore } from '@/stores/baseData'
import { useSystemParamsStore } from '@/stores/systemParams'
import { useUserStore } from '@/stores/user'
import {
  SUBJECT_ANALYSIS_PRESETS,
  normalizeSubjectAnalysisPreset,
  resolvePresetAccount,
} from '@/config/subjectAnalysis'
import {
  buildAnnualRows,
  buildMonthlyRows,
  type AnnualAnalysisRow,
  type MonthlyAnalysisRow,
  type SubjectAnalysisRow,
  type SubjectAnalysisValueMode,
} from '@/utils/subjectAnalysis'

type AnalysisMode = 'annual' | 'monthly'

const route = useRoute()
const router = useRouter()
const baseDataStore = useBaseDataStore()
const systemParamsStore = useSystemParamsStore()
const userStore = useUserStore()
const { accounts } = storeToRefs(baseDataStore)
const { accountSetName } = storeToRefs(userStore)

const preset = computed(() => normalizeSubjectAnalysisPreset(route.query.preset))
const presetDef = computed(() => SUBJECT_ANALYSIS_PRESETS[preset.value])

const { containerRef: tableContainerRef, tableHeight, relayoutAfterData } = useFillHeightTable({ flow: true })
const { tableRef, colWidth } = useListColumnWidth('ledger_subject_analysis')

const loading = ref(false)
const optionsVisible = ref(true)
const printVisible = ref(false)
const chartVisible = ref(false)
const chartRef = ref<HTMLDivElement | null>(null)
let chart: ECharts | null = null

const form = ref({
  mode: 'annual' as AnalysisMode,
  year: new Date().getFullYear(),
  period: new Date().getMonth() + 1,
  accountCode: '',
  valueMode: 'balance' as SubjectAnalysisValueMode,
  includeUnposted: true,
  showAverage: true,
  showRatio: true,
})

const rawRows = ref<SubjectAnalysisRow[]>([])

/** 结果区只反映「上次确定」用的条件 */
const resultMeta = ref<{
  mode: AnalysisMode
  year: number
  period: number
  accountCode: string
  accountName: string
  valueMode: SubjectAnalysisValueMode
  showAverage: boolean
  showRatio: boolean
} | null>(null)

const annual = computed(() =>
  resultMeta.value?.mode === 'annual'
    ? buildAnnualRows(rawRows.value, resultMeta.value.valueMode)
    : { rows: [] as AnnualAnalysisRow[], totals: [] as number[], total: 0, average: 0 }
)
const monthly = computed(() =>
  resultMeta.value?.mode === 'monthly'
    ? buildMonthlyRows(rawRows.value, resultMeta.value.period, resultMeta.value.valueMode)
    : { rows: [] as MonthlyAnalysisRow[], currentTotal: 0, ytdTotal: 0 }
)
const hasResult = computed(() =>
  resultMeta.value?.mode === 'annual' ? annual.value.rows.length > 0 : monthly.value.rows.length > 0
)

const annualColumnsKey = computed(() => `${resultMeta.value?.showAverage}-${resultMeta.value?.showRatio}`)
const annualTableWidth = computed(() => {
  let w = colWidth('account_code', 110) + colWidth('account_name', 150) + colWidth('total', 110)
  for (let m = 1; m <= 12; m++) w += colWidth(`month${m}`, 96)
  if (resultMeta.value?.showAverage) w += colWidth('average', 100)
  if (resultMeta.value?.showRatio) w += colWidth('ratio', 80)
  return w
})

/** 科目下拉：全部启用科目（含非末级），按编码排序 */
const analyzableAccounts = computed(() =>
  [...accounts.value].sort((a, b) => String(a.code).localeCompare(String(b.code)))
)

const VALUE_MODE_LABEL: Record<SubjectAnalysisValueMode, string> = {
  balance: '按余额',
  debit: '按借方发生额',
  credit: '按贷方发生额',
}

const resultSubtitle = computed(() => {
  const meta = resultMeta.value
  if (!meta) return ''
  const periodText =
    meta.mode === 'annual' ? `${meta.year}年` : `${meta.year}-${String(meta.period).padStart(2, '0')}`
  return `${periodText}　科目：${meta.accountCode} ${meta.accountName}　${VALUE_MODE_LABEL[meta.valueMode]}`
})

function formatMoney(v: number | null | undefined) {
  const n = Number(v) || 0
  if (Math.abs(n) < 0.005) return ''
  return formatAmount(n)
}

function formatRatio(v: number) {
  if (!v) return ''
  return v.toFixed(2)
}

function annualSummaries(param: { columns: TableColumnCtx<AnnualAnalysisRow>[] }) {
  return param.columns.map((column, index) => {
    if (index === 0) return '合 计'
    const prop = column.property || ''
    const match = /^month(\d+)$/.exec(prop)
    if (match) return formatMoney(annual.value.totals[Number(match[1]) - 1])
    if (prop === 'total') return formatMoney(annual.value.total)
    if (prop === 'average') return formatMoney(annual.value.average)
    if (prop === 'ratio') return annual.value.total ? '100.00' : ''
    return ''
  })
}

function monthlySummaries(param: { columns: TableColumnCtx<MonthlyAnalysisRow>[] }) {
  return param.columns.map((column, index) => {
    if (index === 0) return '合 计'
    if (column.property === 'current') return formatMoney(monthly.value.currentTotal)
    if (column.property === 'ytd') return formatMoney(monthly.value.ytdTotal)
    return ''
  })
}

function applyPresetAccount() {
  if (preset.value === 'custom') return
  const hit = resolvePresetAccount(preset.value, accounts.value)
  if (hit) {
    form.value.accountCode = hit.code
  } else {
    form.value.accountCode = ''
    ElMessage.warning(`当前科目表中未找到「${presetDef.value.title}」科目，请手工选择`)
  }
}

async function handleAnalyze() {
  const code = form.value.accountCode.trim()
  if (!code) {
    ElMessage.warning('请选择要分析的科目')
    return
  }
  loading.value = true
  try {
    const res = await request.get<SubjectAnalysisRow[]>('/ledger/subject-analysis', {
      params: {
        year: form.value.year,
        account_code: code,
        include_unposted: form.value.includeUnposted ? 'true' : 'false',
      },
    })
    rawRows.value = res.data || []
    const account = accounts.value.find(a => a.code === code)
    resultMeta.value = {
      mode: form.value.mode,
      year: form.value.year,
      period: form.value.period,
      accountCode: code,
      accountName: account?.name || rawRows.value.find(r => r.account_code === code)?.account_name || '',
      // 月度分析示范图没有取数方式选项，沿用余额口径
      valueMode: form.value.mode === 'annual' ? form.value.valueMode : 'balance',
      showAverage: form.value.showAverage,
      showRatio: form.value.showRatio,
    }
    optionsVisible.value = false
    await relayoutAfterData()
  } finally {
    loading.value = false
  }
}

function handleReturn() {
  router.push(getGroupNavigationPath('财务总账'))
}

function handleCancel() {
  optionsVisible.value = false
  if (!resultMeta.value) handleReturn()
}

function handleDialogClose() {
  // 首屏点右上角关闭同样视为取消
  if (!resultMeta.value) handleReturn()
}

function handleRowDblClick(row: { account_code: string }) {
  const meta = resultMeta.value
  if (!meta) return
  const account = accounts.value.find(a => a.code === row.account_code)
  if (!account) return
  const y = meta.year
  const start = meta.mode === 'annual' ? `${y}-01-01` : `${y}-${String(meta.period).padStart(2, '0')}-01`
  const endMonth = meta.mode === 'annual' ? 12 : meta.period
  const lastDay = new Date(y, endMonth, 0).getDate()
  const end = `${y}-${String(endMonth).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
  router.push({ path: '/ledger/detail', query: { account_id: String(account.id), start_date: start, end_date: end } })
}

// ---------- 图形 ----------
function openChart() {
  chartVisible.value = true
}

async function renderChart() {
  await nextTick()
  if (!chartRef.value) return
  const echarts = (await import('@/utils/echartsTrendLoader')).default
  if (!chart) chart = echarts.init(chartRef.value)
  const isAnnual = resultMeta.value?.mode === 'annual'
  const rows = isAnnual ? annual.value.rows : monthly.value.rows
  const names = rows.map(r => r.account_name)
  const values = rows.map(r => (isAnnual ? (r as AnnualAnalysisRow).total : (r as MonthlyAnalysisRow).current))
  chart.setOption({
    tooltip: { trigger: 'axis', valueFormatter: (v: number) => formatAmount(v) },
    grid: { left: 80, right: 24, top: 24, bottom: 80 },
    xAxis: { type: 'category', data: names, axisLabel: { interval: 0, rotate: names.length > 6 ? 30 : 0 } },
    yAxis: { type: 'value' },
    series: [{ type: 'bar', data: values, barMaxWidth: 48, itemStyle: { color: '#409eff' } }],
  })
  chart.resize()
}

function disposeChart() {
  chart?.dispose()
  chart = null
}

// ---------- 打印 / 另存 ----------
function buildPrintHtml(ctx?: { fontSize?: number }): string {
  const meta = resultMeta.value
  const subtitle = [`账套：${accountSetName.value || '未命名账套'}`, resultSubtitle.value]
  if (meta?.mode === 'annual') {
    const columns: Array<{ label: string; width?: string; align: 'left' | 'right'; render: (r: AnnualAnalysisRow) => string }> = [
      { label: '科目编码', align: 'left', render: r => r.account_code },
      { label: '科目名称', align: 'left', render: r => r.account_name },
      ...Array.from({ length: 12 }, (_, i) => ({
        label: `${i + 1}月`,
        align: 'right' as const,
        render: (r: AnnualAnalysisRow) => formatMoney(r.months[i]),
      })),
      { label: '合计', align: 'right', render: r => formatMoney(r.total) },
    ]
    const footer = ['合 计', '', ...annual.value.totals.map(formatMoney), formatMoney(annual.value.total)]
    if (meta.showAverage) {
      columns.push({ label: '月均', align: 'right', render: r => formatMoney(r.average) })
      footer.push(formatMoney(annual.value.average))
    }
    if (meta.showRatio) {
      columns.push({ label: '比例(%)', align: 'right', render: r => formatRatio(r.ratio) })
      footer.push(annual.value.total ? '100.00' : '')
    }
    return buildTablePrintHtml<AnnualAnalysisRow>({
      title: presetDef.value.dialogTitle,
      subtitle,
      rows: annual.value.rows,
      monochrome: true,
      fitToPage: true,
      fontSize: ctx?.fontSize ?? 10,
      columns,
      footer,
    })
  }
  return buildTablePrintHtml<MonthlyAnalysisRow>({
    title: presetDef.value.dialogTitle,
    subtitle,
    rows: monthly.value.rows,
    monochrome: true,
    fitToPage: true,
    fontSize: ctx?.fontSize ?? 12,
    columns: [
      { label: '科目编码', width: '16%', align: 'left', render: r => r.account_code },
      { label: '科目名称', width: '28%', align: 'left', render: r => r.account_name },
      { label: '本月数', width: '18%', align: 'right', render: r => formatMoney(r.current) },
      { label: '比例(%)', width: '10%', align: 'right', render: r => formatRatio(r.currentRatio) },
      { label: '本年累计', width: '18%', align: 'right', render: r => formatMoney(r.ytd) },
      { label: '比例(%)', width: '10%', align: 'right', render: r => formatRatio(r.ytdRatio) },
    ],
    footer: ['合 计', '', formatMoney(monthly.value.currentTotal), '', formatMoney(monthly.value.ytdTotal), ''],
  })
}

async function exportData() {
  const meta = resultMeta.value
  if (!meta) return
  const title = presetDef.value.dialogTitle
  if (meta.mode === 'annual') {
    const columns: any[] = [
      { label: '科目编码', width: 120, value: (r: AnnualAnalysisRow) => r.account_code },
      { label: '科目名称', width: 180, value: (r: AnnualAnalysisRow) => r.account_name },
      ...Array.from({ length: 12 }, (_, i) => ({
        label: `${i + 1}月`,
        width: 110,
        align: 'right',
        type: 'amount',
        value: (r: AnnualAnalysisRow) => r.months[i] || 0,
      })),
      { label: '合计', width: 120, align: 'right', type: 'amount', value: (r: AnnualAnalysisRow) => r.total },
    ]
    const summaryValues: (string | number)[] = ['合 计', '', ...annual.value.totals, annual.value.total]
    if (meta.showAverage) {
      columns.push({ label: '月均', width: 110, align: 'right', type: 'amount', value: (r: AnnualAnalysisRow) => r.average })
      summaryValues.push(annual.value.average)
    }
    if (meta.showRatio) {
      columns.push({ label: '比例(%)', width: 90, align: 'right', value: (r: AnnualAnalysisRow) => r.ratio })
      summaryValues.push(annual.value.total ? 100 : '')
    }
    await exportStyledTable<AnnualAnalysisRow>({
      fileName: `${title}_${meta.year}.xlsx`,
      sheetName: title,
      title,
      subtitle: resultSubtitle.value,
      columns,
      rows: annual.value.rows,
      summaryValues,
    })
    return
  }
  await exportStyledTable<MonthlyAnalysisRow>({
    fileName: `${title}_${meta.year}-${String(meta.period).padStart(2, '0')}.xlsx`,
    sheetName: title,
    title,
    subtitle: resultSubtitle.value,
    columns: [
      { label: '科目编码', width: 120, value: r => r.account_code },
      { label: '科目名称', width: 200, value: r => r.account_name },
      { label: '本月数', width: 140, align: 'right', type: 'amount', value: r => r.current },
      { label: '比例(%)', width: 100, align: 'right', value: r => r.currentRatio },
      { label: '本年累计', width: 140, align: 'right', type: 'amount', value: r => r.ytd },
      { label: '比例(%)', width: 100, align: 'right', value: r => r.ytdRatio },
    ],
    rows: monthly.value.rows,
    summaryValues: ['合 计', '', monthly.value.currentTotal, '', monthly.value.ytdTotal, ''],
  })
}

onMounted(async () => {
  await systemParamsStore.load()
  form.value.year = systemParamsStore.currentYear || form.value.year
  form.value.period = systemParamsStore.currentPeriod || form.value.period
  try {
    await baseDataStore.loadAccounts()
  } catch {
    // 科目加载失败时弹窗仍可打开，由用户重试
  }
  applyPresetAccount()
})

// 同一页面在侧栏切换不同预置时（keep-alive 下不会重新 mounted），重置科目并重新弹条件窗
watch(preset, () => {
  rawRows.value = []
  resultMeta.value = null
  applyPresetAccount()
  optionsVisible.value = true
})
</script>

<style scoped>
.subject-analysis-page {
  display: flex;
  flex-direction: column;
  height: 100%;
  gap: 8px;
}
.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
}
.page-title {
  display: flex;
  align-items: baseline;
  gap: 12px;
  min-width: 0;
}
.page-title h3 {
  margin: 0;
  font-size: var(--cw-text-lg);
  font-weight: 600;
}
.page-subtitle {
  color: var(--el-text-color-secondary);
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.page-actions {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-shrink: 0;
}
.subject-analysis-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

.analysis-form :deep(.el-form-item) {
  margin-bottom: 14px;
}
.mode-switch {
  display: flex;
  justify-content: center;
  margin-bottom: 16px;
  padding: 8px;
  border: 1px solid var(--el-border-color);
  border-radius: 4px;
}
.year-input {
  width: 140px;
}
.period-picker {
  display: flex;
  align-items: center;
  gap: 4px;
}
.period-picker__year {
  width: 90px;
}
.period-picker__month {
  width: 90px;
}
.period-picker__dot {
  color: var(--el-text-color-secondary);
}
.account-select {
  width: 100%;
}
.form-fieldset {
  border: 1px solid var(--el-border-color);
  border-radius: 4px;
  padding: 8px 12px;
  margin-bottom: 12px;
  display: flex;
  justify-content: center;
}
.checks-row {
  display: flex;
  gap: 24px;
  justify-content: space-between;
  padding: 0 4px;
}
.checks-row--center {
  justify-content: center;
}
.dialog-footer {
  display: flex;
  justify-content: center;
  gap: 40px;
}
.dialog-tip {
  margin-top: 12px;
  text-align: center;
  color: var(--el-color-danger);
  font-size: 12px;
}
.analysis-chart {
  width: 100%;
  height: 420px;
}
</style>
