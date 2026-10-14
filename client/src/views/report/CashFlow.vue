<template>
  <div class="page cash-flow-page">
    <div class="page-header">
      <h3>现金流量表（科目估算）</h3>
      <div class="report-toolbar-row">
        <el-select v-model="filters.year" size="small" style="width: 100px">
          <el-option v-for="y in years" :key="y" :label="`${y}年`" :value="y" />
        </el-select>
        <el-select v-model="filters.period" size="small" style="width: 100px">
          <el-option v-for="m in 12" :key="m" :label="`${m}月`" :value="m" />
        </el-select>
        <el-select v-model="filters.scope" size="small" style="width: 120px">
          <el-option label="本月" value="month" />
          <el-option label="本年累计" value="ytd" />
        </el-select>
        <el-button type="primary" size="small" @click="fetchData">查询</el-button>
        <FilterClearButton size="small" @clear="handleClearFilters" />
        <el-button size="small" @click="exportData">另存</el-button>
        <el-button size="small" @click="printData">打印</el-button>
      </div>
    </div>
    <AccountScopeAlert />

    <div v-if="reportData" v-loading="loading" class="report-body">
      <div class="report-title-area">
        <h2 class="report-title">现金流量表</h2>
        <p class="report-subtitle">
          {{ reportData.reportDate }} · {{ reportData.accountingStandardName }}
        </p>
        <p v-if="reportData.reportSourceNote" class="report-note">{{ reportData.reportSourceNote }}</p>
      </div>

      <div v-if="validationWarnings.length" class="validation-block">
        <el-alert
          v-for="(w, idx) in validationWarnings"
          :key="idx"
          :title="w.message"
          :type="alertType(w.severity)"
          :closable="false"
          show-icon
          style="margin-bottom: 8px"
        />
      </div>

      <table class="rpt-table">
        <thead>
          <tr>
            <th style="width: 45%">项目</th>
            <th style="width: 10%">行次</th>
            <th style="width: 20%">金额</th>
          </tr>
        </thead>
        <tbody>
          <tr class="section-header">
            <td colspan="3"><strong>一、经营活动产生的现金流量</strong></td>
          </tr>
          <tr v-for="item in opFlowItems" :key="item.key" class="data-row">
            <td style="padding-left: 24px">{{ item.label }}</td>
            <td class="center"></td>
            <td class="amount">{{ item.formatted }}</td>
          </tr>
          <tr class="subtotal-row">
            <td><strong>经营活动产生的现金流量净额</strong></td>
            <td class="center"></td>
            <td class="amount">
              <strong>{{ fmt(reportData.operatingActivities?.['净额']) }}</strong>
            </td>
          </tr>

          <tr class="section-header">
            <td colspan="3"><strong>二、投资活动产生的现金流量</strong></td>
          </tr>
          <tr v-for="item in invFlowItems" :key="item.key" class="data-row">
            <td style="padding-left: 24px">{{ item.label }}</td>
            <td class="center"></td>
            <td class="amount">{{ item.formatted }}</td>
          </tr>
          <tr class="subtotal-row">
            <td><strong>投资活动产生的现金流量净额</strong></td>
            <td class="center"></td>
            <td class="amount">
              <strong>{{ fmt(reportData.investingActivities?.['净额']) }}</strong>
            </td>
          </tr>

          <tr class="section-header">
            <td colspan="3"><strong>三、筹资活动产生的现金流量</strong></td>
          </tr>
          <tr v-for="item in finFlowItems" :key="item.key" class="data-row">
            <td style="padding-left: 24px">{{ item.label }}</td>
            <td class="center"></td>
            <td class="amount">{{ item.formatted }}</td>
          </tr>
          <tr class="subtotal-row">
            <td><strong>筹资活动产生的现金流量净额</strong></td>
            <td class="center"></td>
            <td class="amount">
              <strong>{{ fmt(reportData.financingActivities?.['净额']) }}</strong>
            </td>
          </tr>

          <tr class="total-row">
            <td><strong>四、现金及现金等价物净增加额</strong></td>
            <td class="center"></td>
            <td class="amount"><strong>{{ fmt(reportData.netCashChange) }}</strong></td>
          </tr>
          <tr class="data-row">
            <td>加：期初现金余额</td>
            <td class="center"></td>
            <td class="amount">{{ fmt(reportData.beginCash) }}</td>
          </tr>
          <tr class="data-row">
            <td>期末现金余额</td>
            <td class="center"></td>
            <td class="amount">{{ fmt(reportData.endCash) }}</td>
          </tr>
          <tr class="subtotal-row">
            <td><strong>平衡校验</strong></td>
            <td class="center"></td>
            <td class="amount">
              <el-tag :type="reportData.cashBalanceCheck ? 'success' : 'danger'" size="small">
                {{ reportData.cashBalanceCheck ? '√ 平衡' : '✗ 不平衡' }}
              </el-tag>
            </td>
          </tr>
        </tbody>
      </table>

      <el-tabs v-if="hasCompareTabs" v-model="activeCompareTab" class="cash-flow-tabs" type="border-card">
        <el-tab-pane
          v-if="reportData.indirectMethod"
          label="间接法附注"
          name="indirect"
        >
          <p v-if="reportData.indirectMethod.scopeNote" class="compare-note">
            {{ reportData.indirectMethod.scopeNote }}
          </p>
          <table class="compare-table">
            <thead>
              <tr>
                <th>调节项目</th>
                <th>金额</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>{{ reportData.indirectMethod.profitLabel }}</td>
                <td class="amount">{{ fmt(reportData.indirectMethod.netProfit) }}</td>
              </tr>
              <tr v-for="(line, idx) in reportData.indirectMethod.adjustments" :key="idx">
                <td style="padding-left: 16px">{{ line.label }}</td>
                <td class="amount">{{ fmt(line.amount) }}</td>
              </tr>
              <tr class="subtotal-row">
                <td><strong>经营活动产生的现金流量净额（间接法）</strong></td>
                <td class="amount">
                  <strong>{{ fmt(reportData.indirectMethod.operatingCashNet) }}</strong>
                </td>
              </tr>
            </tbody>
          </table>
          <table
            v-if="reportData.indirectComparison"
            class="compare-table"
            style="margin-top: 12px"
          >
            <thead>
              <tr>
                <th>对比项</th>
                <th>差异</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>与主表直接法（科目估算）经营净额</td>
                <td class="amount">
                  {{ fmtDiff(reportData.indirectComparison.staticOperatingDiff) }}
                </td>
              </tr>
              <tr v-if="reportData.directMethod">
                <td>与分录直接法（@xj_je）经营净额</td>
                <td class="amount">
                  {{ fmtDiff(reportData.indirectComparison.directOperatingDiff) }}
                </td>
              </tr>
            </tbody>
          </table>
          <p v-if="reportData.indirectComparison?.note" class="compare-note">
            {{ reportData.indirectComparison.note }}
          </p>
        </el-tab-pane>

        <el-tab-pane
          v-if="reportData.dynamicMethod"
          label="模板对比"
          name="dynamic"
        >
          <p class="compare-meta">
            模板：{{ reportData.dynamicMethod.templateName }} ·
            {{ reportData.dynamicMethod.columnLabel }}
          </p>
          <table class="compare-table">
            <thead>
              <tr>
                <th>项目</th>
                <th>本表（估算）</th>
                <th>动态模板</th>
                <th>差异</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>经营活动净额</td>
                <td class="amount">{{ fmt(reportData.operatingActivities?.['净额']) }}</td>
                <td class="amount">{{ fmt(reportData.dynamicMethod.operating) }}</td>
                <td class="amount">{{ fmtDiff(reportData.dynamicComparison?.operatingDiff) }}</td>
              </tr>
              <tr>
                <td>投资活动净额</td>
                <td class="amount">{{ fmt(reportData.investingActivities?.['净额']) }}</td>
                <td class="amount">{{ fmt(reportData.dynamicMethod.investing) }}</td>
                <td class="amount">{{ fmtDiff(reportData.dynamicComparison?.investingDiff) }}</td>
              </tr>
              <tr>
                <td>筹资活动净额</td>
                <td class="amount">{{ fmt(reportData.financingActivities?.['净额']) }}</td>
                <td class="amount">{{ fmt(reportData.dynamicMethod.financing) }}</td>
                <td class="amount">{{ fmtDiff(reportData.dynamicComparison?.financingDiff) }}</td>
              </tr>
              <tr>
                <td>现金净增加额</td>
                <td class="amount">{{ fmt(reportData.netCashChange) }}</td>
                <td class="amount">{{ fmt(reportData.dynamicMethod.net) }}</td>
                <td class="amount">{{ fmtDiff(reportData.dynamicComparison?.netDiff) }}</td>
              </tr>
            </tbody>
          </table>
          <p v-if="reportData.dynamicComparison?.note" class="compare-note">
            {{ reportData.dynamicComparison.note }}
          </p>
        </el-tab-pane>

        <el-tab-pane
          v-if="reportData.directMethod"
          label="直接法对比"
          name="direct"
        >
          <table class="compare-table">
            <thead>
              <tr>
                <th>项目</th>
                <th>本表（估算）</th>
                <th>直接法</th>
                <th>差异</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>经营活动净额</td>
                <td class="amount">{{ fmt(reportData.operatingActivities?.['净额']) }}</td>
                <td class="amount">{{ fmt(reportData.directMethod.operating) }}</td>
                <td class="amount">{{ fmtDiff(reportData.comparison?.operatingDiff) }}</td>
              </tr>
              <tr>
                <td>投资活动净额</td>
                <td class="amount">{{ fmt(reportData.investingActivities?.['净额']) }}</td>
                <td class="amount">{{ fmt(reportData.directMethod.investing) }}</td>
                <td class="amount">{{ fmtDiff(reportData.comparison?.investingDiff) }}</td>
              </tr>
              <tr>
                <td>筹资活动净额</td>
                <td class="amount">{{ fmt(reportData.financingActivities?.['净额']) }}</td>
                <td class="amount">{{ fmt(reportData.directMethod.financing) }}</td>
                <td class="amount">{{ fmtDiff(reportData.comparison?.financingDiff) }}</td>
              </tr>
              <tr>
                <td>现金净增加额</td>
                <td class="amount">{{ fmt(reportData.netCashChange) }}</td>
                <td class="amount">{{ fmt(reportData.directMethod.net) }}</td>
                <td class="amount">{{ fmtDiff(reportData.comparison?.netDiff) }}</td>
              </tr>
            </tbody>
          </table>
          <p v-if="reportData.comparison?.note" class="compare-note">{{ reportData.comparison.note }}</p>
          <p class="compare-meta">
            口径：{{ reportData.directMethod.scope === 'ytd' ? '本年累计' : '本月' }}
            （{{ reportData.directMethod.fromPeriod }}–{{ reportData.directMethod.toPeriod }} 月）·
            已有数据的分录项目：{{ reportData.directMethod.itemsWithData }} /
            {{ reportData.directMethod.itemCount }}
          </p>
        </el-tab-pane>
      </el-tabs>
    </div>

    <EmptyState v-else-if="!loading" type="data" description="请选择年月后点击查询" />
    <el-skeleton v-if="loading && !reportData" :rows="10" animated />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import request from '@/api/request'
import printJS from 'print-js'
import EmptyState from '@/components/EmptyState.vue'
import FilterClearButton from '@/components/common/FilterClearButton.vue'
import { useFilterClear } from '@/composables/useFilterClear'
import AccountScopeAlert from '@/components/AccountScopeAlert.vue'
import { showOperationError } from '@/composables/useMessage'
import { formatAmount } from '@/utils/format'
import { exportStyledAoa } from '@/utils/exportStyledExcel'
import './report.styles.css'

const route = useRoute()
const reportData = ref<any>(null)
const loading = ref(false)
const activeCompareTab = ref('indirect')
const filters = ref({
  year: new Date().getFullYear(),
  period: new Date().getMonth() + 1,
  scope: 'month' as 'month' | 'ytd',
})
const { clearFilters } = useFilterClear([filters])

/** 清空筛选条件并恢复默认查询 */
function handleClearFilters() {
  clearFilters()
  fetchData()
}
const years = Array.from({ length: new Date().getFullYear() - 2000 + 1 }, (_, i) => new Date().getFullYear() - i)

const validationWarnings = computed(() => reportData.value?.validation?.warnings || [])

const hasCompareTabs = computed(
  () =>
    Boolean(
      reportData.value?.indirectMethod ||
        reportData.value?.dynamicMethod ||
        reportData.value?.directMethod
    )
)

watch(reportData, data => {
  if (!data) return
  if (data.indirectMethod) activeCompareTab.value = 'indirect'
  else if (data.dynamicMethod) activeCompareTab.value = 'dynamic'
  else if (data.directMethod) activeCompareTab.value = 'direct'
})

function alertType(severity: string) {
  if (severity === 'error') return 'error'
  if (severity === 'warning') return 'warning'
  return 'info'
}

function fmt(val: number | null | undefined): string {
  if (val === null || val === undefined || val === 0) return '—'
  const prefix = val < 0 ? '-' : ''
  return prefix + formatAmount(Math.abs(val))
}

function fmtDiff(val: number | null | undefined): string {
  if (val === null || val === undefined) return '—'
  if (Math.abs(val) < 0.01) return '—'
  const prefix = val > 0 ? '+' : ''
  return prefix + formatAmount(val)
}

const toFlowItems = (obj: Record<string, number>) =>
  Object.entries(obj || {})
    .filter(([k]) => !k.includes('净额'))
    .map(([k, v]) => ({
      key: k,
      label: k.replace('流入_', '  ').replace('流出_', '  '),
      formatted: fmt(v),
    }))

const opFlowItems = computed(() => toFlowItems(reportData.value?.operatingActivities || {}))
const invFlowItems = computed(() => toFlowItems(reportData.value?.investingActivities || {}))
const finFlowItems = computed(() => toFlowItems(reportData.value?.financingActivities || {}))

async function fetchData() {
  loading.value = true
  try {
    const res = await request.get('/report/cash-flow', { params: filters.value })
    reportData.value = res.data
  } catch (error) {
    showOperationError('查询现金流量表', error)
  } finally {
    loading.value = false
  }
}

function activityRowsHtml(title: string, activities: Record<string, number> | undefined): string {
  let rows = `<tr><td colspan="2" style="font-weight:bold;background:#f0f0f0">${title}</td></tr>`
  for (const [key, val] of Object.entries(activities || {})) {
    if (key.includes('净额')) continue
    const label = key.replace(/^流入_/, '　').replace(/^流出_/, '　')
    rows += `<tr><td style="padding-left:16px">${label}</td><td style="text-align:right">${fmt(val)}</td></tr>`
  }
  rows += `<tr><td><strong>净额</strong></td><td style="text-align:right"><strong>${fmt(activities?.['净额'])}</strong></td></tr>`
  return rows
}

function printData() {
  if (!reportData.value) return
  const d = reportData.value
  let extra = ''
  if (d.indirectMethod) {
    extra += `<h3>附注：间接法调节</h3><table border="1" cellpadding="4" style="width:100%;border-collapse:collapse;font-size:12px">`
    extra += `<tr><td>${d.indirectMethod.profitLabel}</td><td style="text-align:right">${fmt(d.indirectMethod.netProfit)}</td></tr>`
    for (const line of d.indirectMethod.adjustments || []) {
      extra += `<tr><td>${line.label}</td><td style="text-align:right">${fmt(line.amount)}</td></tr>`
    }
    extra += `<tr><td><strong>经营活动净额（间接法）</strong></td><td style="text-align:right"><strong>${fmt(d.indirectMethod.operatingCashNet)}</strong></td></tr></table>`
  }
  const html = `
    <div style="font-family:SimSun,serif;padding:12px">
      <h1 style="text-align:center;margin:0 0 8px">现金流量表（科目估算）</h1>
      <p style="text-align:center;margin:0 0 12px">${d.reportDate} · ${d.accountingStandardName || ''}</p>
      <table border="1" cellpadding="4" style="width:100%;border-collapse:collapse;font-size:12px">
        ${activityRowsHtml('一、经营活动产生的现金流量', d.operatingActivities)}
        ${activityRowsHtml('二、投资活动产生的现金流量', d.investingActivities)}
        ${activityRowsHtml('三、筹资活动产生的现金流量', d.financingActivities)}
        <tr><td><strong>四、现金及现金等价物净增加额</strong></td><td style="text-align:right"><strong>${fmt(d.netCashChange)}</strong></td></tr>
        <tr><td>加：期初现金余额</td><td style="text-align:right">${fmt(d.beginCash)}</td></tr>
        <tr><td>期末现金余额</td><td style="text-align:right">${fmt(d.endCash)}</td></tr>
      </table>
      ${extra}
      <p style="font-size:11px;color:#666;margin-top:12px">${d.reportSourceNote || ''}</p>
    </div>`
  printJS({ printable: html, type: 'raw-html' })
}

function pushActivityRows(
  rows: (string | number)[][],
  title: string,
  activities: Record<string, number> | undefined
) {
  rows.push([title])
  for (const [key, val] of Object.entries(activities || {})) {
    if (key.includes('净额')) continue
    rows.push([key.replace(/^流入_/, '  流入：').replace(/^流出_/, '  流出：'), val])
  }
  rows.push(['净额', activities?.['净额'] || 0])
  rows.push([])
}

async function exportData() {
  try {
    const d = reportData.value
    const rows: (string | number)[][] = [
      ['现金流量表（科目估算）'],
      [d.reportDate, d.accountingStandardName],
      [d.reportSourceNote || ''],
      [],
    ]
    pushActivityRows(rows, '一、经营活动', d.operatingActivities)
    pushActivityRows(rows, '二、投资活动', d.investingActivities)
    pushActivityRows(rows, '三、筹资活动', d.financingActivities)
    rows.push(['四、现金净增加额', d.netCashChange || 0])
    rows.push(['期初现金', d.beginCash || 0])
    rows.push(['期末现金', d.endCash || 0])
    rows.push([])

    if (d.indirectMethod) {
      rows.push(['附注：间接法调节'])
      rows.push([d.indirectMethod.profitLabel, d.indirectMethod.netProfit])
      for (const line of d.indirectMethod.adjustments || []) {
        rows.push([line.label, line.amount])
      }
      rows.push(['经营活动净额（间接法）', d.indirectMethod.operatingCashNet])
      rows.push([])
    }

    if (d.directMethod) {
      rows.push(['分录直接法（@xj_je）'])
      rows.push(['经营活动', d.directMethod.operating, d.comparison?.operatingDiff || 0])
      rows.push(['投资活动', d.directMethod.investing, d.comparison?.investingDiff || 0])
      rows.push(['筹资活动', d.directMethod.financing, d.comparison?.financingDiff || 0])
      rows.push(['现金净增加额', d.directMethod.net, d.comparison?.netDiff || 0])
      rows.push([])
    }

    if (d.dynamicMethod) {
      rows.push(['动态模板对比', d.dynamicMethod.templateName, d.dynamicMethod.columnLabel])
      rows.push(['经营活动', d.dynamicMethod.operating, d.dynamicComparison?.operatingDiff || 0])
      rows.push(['投资活动', d.dynamicMethod.investing, d.dynamicComparison?.investingDiff || 0])
      rows.push(['筹资活动', d.dynamicMethod.financing, d.dynamicComparison?.financingDiff || 0])
      rows.push(['现金净增加额', d.dynamicMethod.net, d.dynamicComparison?.netDiff || 0])
    }

    const titleRowIndexes = [0]
    const sectionRowIndexes: number[] = []
    const emphasisRowIndexes: number[] = []
    rows.forEach((row, index) => {
      const label = String(row[0] || '')
      if (/^[一二三四]、/.test(label) || label.startsWith('附注：') || label.startsWith('分录直接法') || label.startsWith('动态模板对比')) {
        sectionRowIndexes.push(index)
      }
      if (label === '净额' || label.includes('净增加额') || label.includes('期末现金')) {
        emphasisRowIndexes.push(index)
      }
    })

    await exportStyledAoa({
      fileName: `现金流量表_${filters.value.year}_${filters.value.period}月.xlsx`,
      sheetName: '现金流量表',
      rows,
      columnWidths: [42, 18, 18],
      titleRowIndexes,
      sectionRowIndexes,
      emphasisRowIndexes,
      amountColumns: [2, 3],
    })
  } catch (error) {
    showOperationError('导出', error)
  }
}

onMounted(() => {
  const q = route.query
  if (q.year) filters.value.year = Number(q.year)
  if (q.period) filters.value.period = Number(q.period)
  if (q.scope === 'ytd' || q.scope === 'month') filters.value.scope = q.scope
  fetchData()
})
</script>

<style scoped>
.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
}

.page-header h2 {
  margin: 0;
}

.rpt-table .total-row td {
  background: var(--el-color-primary-light-9, #ecf5ff);
  font-weight: 600;
}
</style>
