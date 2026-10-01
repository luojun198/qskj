<template>
  <div class="page fixed-report-page">
    <!-- 顶部单行：左侧报表切换，右侧操作（参照金蝶，去掉原深色横幅） -->
    <div class="rpt-topbar">
      <nav class="report-tabs">
        <button v-for="item in meta?.reports || fallbackReports" :key="item.code" :class="{ active: item.code === reportCode }" :title="item.code === reportCode ? reportDescription : item.title" @click="router.push(item.path)">
          {{ item.title }}
        </button>
        <button @click="router.push(`/scm/report/buysell?kind=${reportType}`)">自定义查询</button>
      </nav>
      <div class="header-actions">
        <el-button @click="resetFilters(); queryReport(true)">清空</el-button>
        <el-button :loading="exporting" @click="exportReport"><el-icon><Download /></el-icon>导出</el-button>
        <el-button type="primary" :loading="loading" @click="queryReport(true)"><el-icon><Search /></el-icon>查询</el-button>
      </div>
    </div>

    <!-- 筛选：常用条件一行；其余条件点「更多条件」在下方展开 -->
    <section class="filter-card">
      <div class="filter-line rpt-bar">
        <label class="filter-item wide"><span>{{ isOrderTracking ? '订单日期' : '业务日期' }}</span><el-date-picker v-model="dateRange" type="daterange" value-format="YYYY-MM-DD" start-placeholder="开始日期" end-placeholder="结束日期" style="width:240px" /></label>
        <label v-if="isOrderTracking" class="filter-item wide"><span>预计到货</span><el-date-picker v-model="expectDateRange" type="daterange" value-format="YYYY-MM-DD" start-placeholder="开始日期" end-placeholder="结束日期" style="width:240px" /></label>
        <label class="filter-item"><span>币种</span><el-select v-model="filters.currency" filterable><el-option value="ALL" label="全部币种（折本位币）" /><el-option v-for="o in options.currencies" :key="o.value" :label="o.label" :value="o.value" /></el-select></label>
        <label class="filter-item"><span>{{ partnerLabel }}</span><el-select v-model="filters.partner_codes" multiple filterable collapse-tags clearable><el-option v-for="o in options.partners" :key="o.value" :label="o.label" :value="o.value" /></el-select></label>
        <label class="filter-item"><span>产品</span><el-select v-model="filters.item_codes" multiple filterable collapse-tags clearable><el-option v-for="o in options.items" :key="o.value" :label="o.label" :value="o.value" /></el-select></label>
        <el-button link type="primary" class="more-toggle" @click="showMoreFilters = !showMoreFilters">
          更多条件<template v-if="moreFilterCount">（{{ moreFilterCount }}）</template>
          <el-icon><component :is="showMoreFilters ? ArrowUp : ArrowDown" /></el-icon>
        </el-button>
        <template v-if="['summary',analysisCode,'ranking'].includes(reportCode)">
          <span class="control-label">{{ reportCode === 'ranking' ? '排名对象' : '统计方式' }}</span>
          <el-select v-model="grouping" style="width:210px"><el-option v-for="o in groupingOptions" :key="o.value" :label="o.label" :value="o.value" /></el-select>
        </template>
        <template v-if="reportCode === 'ranking'">
          <span class="control-label">排名指标</span><el-select v-model="rankMetric" style="width:150px"><el-option v-for="o in meta?.rank_metrics || []" :key="o.value" :label="o.label" :value="o.value" /></el-select>
          <span class="control-label">显示</span><el-select v-model="topN" style="width:100px"><el-option v-for="n in [10,20,50,100]" :key="n" :label="`前 ${n} 名`" :value="n" /></el-select>
        </template>
        <template v-if="reportCode === 'trend'">
          <span class="control-label">时间粒度</span><el-select v-model="period" style="width:110px"><el-option v-for="o in meta?.periods || []" :key="o.value" :label="o.label" :value="o.value" /></el-select>
          <span class="control-label">趋势指标</span><el-select v-model="chartMetric" style="width:150px"><el-option v-for="o in meta?.rank_metrics || []" :key="o.value" :label="o.label" :value="o.value" /></el-select>
        </template>
        <template v-if="reportCode === analysisCode">
          <span class="control-label">{{ analysisAmountLabel }}区间</span><el-input-number v-model="analysisMin" :controls="false" placeholder="最小值" /><span>—</span><el-input-number v-model="analysisMax" :controls="false" placeholder="最大值" />
          <span class="control-label">{{ analysisRateLabel }}区间</span><el-input-number v-model="analysisRateMin" :controls="false" placeholder="最小%" /><span>—</span><el-input-number v-model="analysisRateMax" :controls="false" placeholder="最大%" />
        </template>
      </div>
      <div v-show="showMoreFilters" class="filter-line filter-line--more rpt-bar">
        <label class="filter-item"><span>产品分类</span><el-select v-model="filters.category_codes" multiple filterable collapse-tags clearable><el-option v-for="o in options.categories" :key="o.value" :label="o.label" :value="o.value" /></el-select></label>
        <label class="filter-item"><span>{{ personLabel }}</span><el-select v-model="filters.biz_persons" multiple filterable collapse-tags clearable><el-option v-for="o in options.biz_people" :key="o.value" :label="o.label" :value="o.value" /></el-select></label>
        <label class="filter-item"><span>部门</span><el-select v-model="filters.dept_codes" multiple filterable collapse-tags clearable><el-option v-for="o in options.departments" :key="o.value" :label="o.label" :value="o.value" /></el-select></label>
        <label class="filter-item"><span>仓库</span><el-select v-model="filters.warehouse_codes" multiple filterable collapse-tags clearable><el-option v-for="o in options.warehouses" :key="o.value" :label="o.label" :value="o.value" /></el-select></label>
        <label v-if="!isOrderTracking" class="filter-item"><span>批次</span><el-select v-model="filters.batch_nos" multiple filterable collapse-tags clearable><el-option v-for="o in options.batches" :key="o.value" :label="o.label" :value="o.value" /></el-select></label>
        <label v-if="!isOrderTracking" class="filter-item"><span>业务类型</span><el-select v-model="filters.source_types" multiple clearable><el-option v-for="o in options.source_types" :key="o.value" :label="o.label" :value="o.value" /></el-select></label>
        <label v-if="isOrderTracking" class="filter-item wide"><span>执行状态</span><el-select v-model="filters.order_statuses" multiple collapse-tags clearable><el-option v-for="o in options.order_statuses" :key="o.value" :label="o.label" :value="o.value" /></el-select></label>
      </div>
    </section>

    <section v-if="isOrderTracking" class="tracking-summary">
      <div><span>订单数</span><strong>{{ summaryNumber('order_count', 0) }}</strong></div>
      <div><span>订单数量</span><strong>{{ summaryNumber('order_qty') }}</strong></div>
      <div><span>净入库数量</span><strong>{{ summaryNumber('net_received_qty') }}</strong></div>
      <div><span>未入库数量</span><strong>{{ summaryNumber('unreceived_qty') }}</strong></div>
      <div><span>整体完成率</span><strong>{{ summaryNumber('overall_completion_rate', 2) }}%</strong></div>
      <div class="warning"><span>逾期行数</span><strong>{{ summaryNumber('overdue_line_count', 0) }}</strong></div>
    </section>

    <section class="result-card">
      <div v-if="reportCode === 'ranking' || reportCode === 'trend'" ref="chartEl" class="chart" />

      <div class="table-zone" :class="{ 'with-chart': reportCode === 'ranking' || reportCode === 'trend' }">
        <el-table :data="result.rows" v-loading="loading" border stripe size="small" height="100%" show-summary :summary-method="tableSummary" @row-dblclick="drillDetail" @sort-change="onSortChange" :row-key="isOrderTracking ? '_row_id' : '_doc_id'">
          <el-table-column v-for="column in result.columns" :key="column.key" :prop="column.key" :label="column.label" :min-width="columnWidth(column)" :align="numericType(column.type) ? 'right' : 'left'" :sortable="sortableColumn(column.key) ? 'custom' : false" show-overflow-tooltip>
            <template #default="{ row }">
              <el-link v-if="['doc_no','order_no'].includes(column.key) && row._doc_id" type="primary" @click.stop="openDocument(row._doc_id)">{{ row[column.key] }}</el-link>
              <span v-else-if="column.key === 'receipt_doc_nos'" class="receipt-links"><el-link v-for="doc in receiptDocs(row)" :key="doc.id" type="primary" @click.stop="openDocument(doc.id)">{{ doc.doc_no }}</el-link><span v-if="!receiptDocs(row).length">—</span></span>
              <el-tag v-else-if="column.key === 'execution_status'" size="small" :type="statusTagType(row.execution_status_code)">{{ row.execution_status }}</el-tag>
              <span v-else :class="{ negative: numericType(column.type) && Number(row[column.key]) < 0, 'rank-badge': column.key === 'rank' }">{{ formatSalesReportValue(row[column.key], column.type) }}</span>
            </template>
          </el-table-column>
        </el-table>
      </div>
      <footer class="result-footer">
        <span class="result-meta">
          <strong>{{ result.total.toLocaleString() }}</strong> {{ isOrderTracking ? '条订单明细' : reportCode === 'detail' ? '条明细' : '组结果' }}
          <span class="sep">·</span>{{ scopeText }}
          <span class="sep">·</span>合计按全部过滤结果计算，不受分页影响
          <template v-if="canDrill"><span class="sep">·</span>双击行查看{{ tradeName }}明细</template>
        </span>
        <el-pagination v-if="!['ranking','trend'].includes(reportCode)" v-model:current-page="page" v-model:page-size="pageSize" :page-sizes="[50,100,200,500]" :total="result.total" layout="total, sizes, prev, pager, next" @change="queryReport(false)" />
      </footer>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowDown, ArrowUp, Download, Search } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import * as echarts from 'echarts'
import { scmApi, type PurchaseFixedFilters, type PurchaseFixedReportCode, type PurchaseFixedReportMeta, type PurchaseFixedReportRequest, type PurchaseFixedReportResult, type SalesFixedFilters, type SalesFixedReportCode, type SalesFixedReportMeta, type SalesFixedReportRequest, type SalesFixedReportResult, type SalesTrendPeriod } from '@/api/scm'
import { scmDocumentRoute } from '@/utils/scmDocNavigation'
import { formatSalesReportValue } from '@/utils/scmSalesReport'

type FixedReportCode = SalesFixedReportCode | PurchaseFixedReportCode
type FixedFilters = SalesFixedFilters & PurchaseFixedFilters
type FixedMeta = SalesFixedReportMeta | PurchaseFixedReportMeta
type FixedResult = SalesFixedReportResult | PurchaseFixedReportResult
const props = withDefaults(defineProps<{ reportCode: FixedReportCode; reportType?: 'sales' | 'purchase' }>(), { reportType: 'sales' })
const route = useRoute()
const router = useRouter()
const meta = ref<FixedMeta | null>(null)
const loading = ref(false)
const exporting = ref(false)
const dateRange = ref<string[]>([])
const expectDateRange = ref<string[]>([])
const grouping = ref('customer')
const rankMetric = ref('sales_amount')
const topN = ref<10 | 20 | 50 | 100>(20)
const period = ref<SalesTrendPeriod>('month')
const chartMetric = ref('sales_amount')
const page = ref(1)
const pageSize = ref(100)
const sort = ref<Array<{ key: string; direction: 'asc' | 'desc' }>>([])
const filters = ref<FixedFilters>({ currency: 'CNY' })
// 「更多条件」展开状态及其中已生效的条件数（收起时也能看出有隐藏条件在起作用）
const showMoreFilters = ref(false)
const moreFilterCount = computed(() => {
  const f = filters.value
  const keys = ['category_codes', 'biz_persons', 'dept_codes', 'warehouse_codes', ...(isOrderTracking.value ? ['order_statuses'] : ['batch_nos', 'source_types'])] as const
  return keys.filter(k => ((f as Record<string, unknown>)[k] as unknown[] | undefined)?.length).length
})
const result = ref<FixedResult>({ report_code: props.reportCode as any, mode: 'summary', columns: [], rows: [], summary: {}, total: 0, page: 1, page_size: 100, ignored_fields: [] })
const chartEl = ref<HTMLElement | null>(null)
let chart: echarts.ECharts | null = null

const fallbackSalesReports = [
  { code: 'summary' as const, title: '销售汇总表', path: '/scm/report/sales/summary' }, { code: 'detail' as const, title: '销售明细表', path: '/scm/report/sales/detail' },
  { code: 'ranking' as const, title: '销售排行榜', path: '/scm/report/sales/ranking' }, { code: 'profit' as const, title: '销售毛利分析', path: '/scm/report/sales/profit' },
  { code: 'trend' as const, title: '销售趋势分析', path: '/scm/report/sales/trend' },
]
const fallbackPurchaseReports = [
  { code: 'summary' as const, title: '采购汇总表', path: '/scm/report/purchase/summary' }, { code: 'detail' as const, title: '采购明细表', path: '/scm/report/purchase/detail' },
  { code: 'order_tracking' as const, title: '采购订单执行表', path: '/scm/report/purchase/order-tracking' },
  { code: 'ranking' as const, title: '采购排行榜', path: '/scm/report/purchase/ranking' }, { code: 'cost' as const, title: '采购成本分析', path: '/scm/report/purchase/cost' },
  { code: 'trend' as const, title: '采购趋势分析', path: '/scm/report/purchase/trend' },
]
const salesDescriptions: Record<SalesFixedReportCode, string> = {
  summary: '按客户、产品、仓库、批次等常用组合快速汇总经营结果。', detail: '逐笔查看销售业务、成本与毛利，并可打开原始单据。',
  ranking: '按收入、数量、成本或毛利查看客户与产品等经营排名。', profit: '定位高毛利与负毛利业务，支持毛利和毛利率区间筛选。',
  trend: '按日、周、月、季度或年观察销售趋势，无业务期间自动补零。',
}
const purchaseDescriptions: Record<PurchaseFixedReportCode, string> = {
  summary: '按供应商、产品、仓库、批次等常用组合快速汇总采购结果。', detail: '逐笔查看采购业务、金额、入库成本与采购差额，并可打开原始单据。',
  order_tracking: '逐行追踪采购订单的待审核入库、实际入库、退货、未入库和逾期情况。',
  ranking: '按采购金额、数量、入库成本或采购差额查看供应商与产品排名。', cost: '对比采购金额与入库成本，定位异常采购差额。',
  trend: '按日、周、月、季度或年观察采购趋势，无业务期间自动补零。',
}
const isPurchase = computed(() => props.reportType === 'purchase')
const isOrderTracking = computed(() => isPurchase.value && props.reportCode === 'order_tracking')
const reportType = computed(() => props.reportType)
const tradeName = computed(() => isPurchase.value ? '采购' : '销售')
const scopeText = computed(() => isOrderTracking.value ? 'PO 采购订单 → PI 采购入库 → PR 采购退货' : isPurchase.value ? 'PI 采购入库 − PR 采购退货' : 'SO 销售出库 − SR 销售退货')
const partnerLabel = computed(() => isPurchase.value ? '供应商' : '客户')
const personLabel = computed(() => isPurchase.value ? '采购员' : '业务员')
const analysisCode = computed(() => isPurchase.value ? 'cost' : 'profit')
const analysisAmountLabel = computed(() => isPurchase.value ? '采购差额' : '毛利')
const analysisRateLabel = computed(() => isPurchase.value ? '差额率' : '毛利率')
const fallbackReports = computed(() => isPurchase.value ? fallbackPurchaseReports : fallbackSalesReports)
const currentTitle = computed(() => (meta.value?.reports || fallbackReports.value).find(item => item.code === props.reportCode)?.title || `${tradeName.value}报表`)
const reportDescription = computed(() => isPurchase.value ? purchaseDescriptions[props.reportCode as PurchaseFixedReportCode] : salesDescriptions[props.reportCode as SalesFixedReportCode])
const options = computed(() => meta.value?.options || { partners: [], items: [], categories: [], warehouses: [], biz_people: [], departments: [], batches: [], currencies: [], source_types: [], order_statuses: [] })
const groupingOptions = computed(() => meta.value?.groupings[props.reportCode] || [])
const canDrill = computed(() => ['summary', 'ranking', analysisCode.value].includes(props.reportCode))
const numericType = (type: string) => ['number', 'amount', 'percent', 'integer'].includes(type)
const columnWidth = (column: FixedResult['columns'][number]) => column.key === 'rank' ? 70 : numericType(column.type) ? 125 : column.type === 'date' ? 112 : 145
const sortableColumn = (key: string) => ['detail', 'order_tracking'].includes(props.reportCode) && !['_doc_id', '_row_id', 'profit_rate', 'receipt_doc_nos'].includes(key)

const analysisMin = computed<number | undefined>({ get: () => isPurchase.value ? filters.value.variance_min : filters.value.profit_min, set: value => { if (isPurchase.value) filters.value.variance_min = value; else filters.value.profit_min = value } })
const analysisMax = computed<number | undefined>({ get: () => isPurchase.value ? filters.value.variance_max : filters.value.profit_max, set: value => { if (isPurchase.value) filters.value.variance_max = value; else filters.value.profit_max = value } })
const analysisRateMin = computed<number | undefined>({ get: () => isPurchase.value ? filters.value.variance_rate_min : filters.value.profit_rate_min, set: value => { if (isPurchase.value) filters.value.variance_rate_min = value; else filters.value.profit_rate_min = value } })
const analysisRateMax = computed<number | undefined>({ get: () => isPurchase.value ? filters.value.variance_rate_max : filters.value.profit_rate_max, set: value => { if (isPurchase.value) filters.value.variance_rate_max = value; else filters.value.profit_rate_max = value } })

function requestData(): SalesFixedReportRequest | PurchaseFixedReportRequest {
  const [start_date, end_date] = dateRange.value || []
  const [expect_start_date, expect_end_date] = expectDateRange.value || []
  const data = {
    report_code: props.reportCode,
    filters: { ...filters.value, start_date, end_date, ...(isOrderTracking.value ? { expect_start_date, expect_end_date } : {}) },
    grouping: grouping.value,
    rank_metric: rankMetric.value, top_n: topN.value, period: period.value,
    chart_metric: chartMetric.value, sort: sort.value, page: page.value, page_size: pageSize.value,
  }
  return data as SalesFixedReportRequest | PurchaseFixedReportRequest
}

function applyRouteDrilldown() {
  const map: Array<[string, keyof FixedFilters]> = [['partner_code','partner_codes'], ['item_code','item_codes'], ['category_code','category_codes'], ['warehouse_code','warehouse_codes'], ['batch_no','batch_nos'], ['biz_person','biz_persons'], ['dept_code','dept_codes']]
  const empties: NonNullable<FixedFilters['empty_fields']> = []
  for (const [queryKey, filterKey] of map) {
    const value = route.query[queryKey]
    if (value === '__EMPTY__') empties.push(queryKey as any)
    else if (typeof value === 'string' && value) (filters.value[filterKey] as string[]) = [value]
  }
  filters.value.empty_fields = empties
  if (typeof route.query.currency === 'string') filters.value.currency = route.query.currency
  if (typeof route.query.start_date === 'string' && typeof route.query.end_date === 'string') dateRange.value = [route.query.start_date, route.query.end_date]
}

function resetFilters() {
  const d = meta.value?.defaults
  const defaults = d as any
  // P2-13：默认期间从 meta.defaults 回填（趋势表用 trend_dates），否则页面打开即提示「请选择业务日期」
  const dd = props.reportCode === 'trend' && defaults?.trend_dates ? defaults.trend_dates : defaults
  dateRange.value = dd?.start_date && dd?.end_date ? [String(dd.start_date), String(dd.end_date)] : []
  expectDateRange.value = []
  // 清空筛选的同时清空上一次结果，避免「清空」后仍显示旧数据
  result.value = { ...result.value, rows: [], summary: {}, total: 0 }
  filters.value = {
    currency: d?.currency || 'CNY', partner_codes: [], item_codes: [], category_codes: [], warehouse_codes: [],
    batch_nos: [], biz_persons: [], dept_codes: [], source_types: [], empty_fields: [],
    order_statuses: isOrderTracking.value ? [...(defaults?.order_tracking_statuses || ['not_received', 'pending', 'partial', 'over_received', 'overdue'])] : [],
  }
  const baseGrouping = isPurchase.value ? 'supplier' : 'customer'
  grouping.value = props.reportCode === analysisCode.value ? defaults?.[`${analysisCode.value}_grouping`] || baseGrouping : props.reportCode === 'ranking' ? defaults?.ranking_grouping || baseGrouping : defaults?.summary_grouping || baseGrouping
  rankMetric.value = defaults?.rank_metric || (isPurchase.value ? 'purchase_amount' : 'sales_amount'); topN.value = (defaults?.top_n || 20) as typeof topN.value
  period.value = defaults?.trend_period || 'month'; chartMetric.value = defaults?.chart_metric || (isPurchase.value ? 'purchase_amount' : 'sales_amount')
  page.value = 1; sort.value = []
  applyRouteDrilldown()
}

async function queryReport(resetPage = false) {
  if (!filters.value.currency) return ElMessage.warning('请选择币种')
  if (!isOrderTracking.value && !dateRange.value?.length) return ElMessage.warning('请选择业务日期')
  if (resetPage) page.value = 1
  loading.value = true
  try {
    const response = isPurchase.value
      ? await scmApi.queryPurchaseFixed(requestData() as PurchaseFixedReportRequest)
      : await scmApi.querySalesFixed(requestData() as SalesFixedReportRequest)
    if (response.code !== 0) return
    result.value = response.data
    await nextTick(); renderChart()
  } catch (error: any) { ElMessage.error(error?.message || '查询失败') } finally { loading.value = false }
}

function tableSummary({ columns }: { columns: any[] }) {
  return columns.map((column, index) => index === 0 ? '合计' : result.value.summary[column.property] == null ? '' : formatSalesReportValue(result.value.summary[column.property], result.value.columns.find(item => item.key === column.property)?.type || 'number'))
}

function onSortChange(data: { prop: string; order: 'ascending' | 'descending' | null }) {
  sort.value = data.order ? [{ key: data.prop, direction: data.order === 'ascending' ? 'asc' : 'desc' }] : []
  queryReport(true)
}

function openDocument(id: string) { router.push(scmDocumentRoute(id, '', 'draft')) }

function receiptDocs(row: Record<string, any>): Array<{ id: string; doc_no: string }> {
  try {
    const docs = JSON.parse(String(row._receipt_docs_json || '[]'))
    return Array.isArray(docs) ? docs.filter(doc => doc?.id && doc?.doc_no) : []
  } catch { return [] }
}

function statusTagType(status: string): 'success' | 'warning' | 'info' | 'danger' {
  if (status === 'completed') return 'success'
  if (status === 'overdue' || status === 'over_received') return 'danger'
  if (status === 'pending' || status === 'partial') return 'warning'
  return 'info'
}

function summaryNumber(key: string, digits = 6) {
  return Number(result.value.summary[key] || 0).toLocaleString('zh-CN', { maximumFractionDigits: digits })
}

function drillDetail(row: Record<string, any>) {
  if (!canDrill.value) return
  const query: Record<string, string> = { start_date: dateRange.value[0], end_date: dateRange.value[1], currency: filters.value.currency || 'CNY' }
  for (const key of ['partner_code', 'item_code', 'category_code', 'warehouse_code', 'batch_no', 'biz_person', 'dept_code']) {
    if (Object.prototype.hasOwnProperty.call(row, key)) query[key] = !row[key] || row[key] === '未指定' ? '__EMPTY__' : String(row[key])
  }
  router.push({ path: `/scm/report/${reportType.value}/detail`, query })
}

function renderChart() {
  if (!chartEl.value || !['ranking','trend'].includes(props.reportCode)) return
  chart ||= echarts.init(chartEl.value)
  const metric = props.reportCode === 'ranking' ? rankMetric.value : chartMetric.value
  const metricLabel = result.value.columns.find(column => column.key === metric)?.label || metric
  const dimensions = result.value.columns.filter(column => column.role === 'dimension' && column.key !== 'rank')
  const dimension = dimensions.find(column => column.key.endsWith('_name')) || dimensions.find(column => ['biz_person', 'dept_code', 'batch_no'].includes(column.key)) || dimensions[0]
  const labels = result.value.rows.map(row => String(row[dimension?.key || period.value] ?? '未指定'))
  const values = result.value.rows.map(row => row[metric] == null ? null : Number(row[metric]))
  chart.setOption({ grid: { left: 28, right: 24, top: 40, bottom: 28, containLabel: true }, tooltip: { trigger: 'axis' }, xAxis: { type: 'category', data: labels, axisLabel: { rotate: labels.length > 12 ? 30 : 0 } }, yAxis: { type: 'value', name: metricLabel }, series: [{ name: metricLabel, type: props.reportCode === 'ranking' ? 'bar' : 'line', smooth: props.reportCode === 'trend', data: values, itemStyle: { color: '#2563eb' }, areaStyle: props.reportCode === 'trend' ? { color: 'rgba(37,99,235,.12)' } : undefined }] }, true)
}

async function exportReport() {
  exporting.value = true
  try {
    const blob = isPurchase.value
      ? await scmApi.exportPurchaseFixed(requestData() as PurchaseFixedReportRequest)
      : await scmApi.exportSalesFixed(requestData() as SalesFixedReportRequest)
    const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${currentTitle.value}.xlsx`; anchor.click(); URL.revokeObjectURL(url)
    ElMessage.success('导出完成')
  } catch (error: any) { ElMessage.error(error?.message || '导出失败') } finally { exporting.value = false }
}

async function initialize() {
  try {
    if (!meta.value) {
      const response = isPurchase.value ? await scmApi.getPurchaseFixedMeta() : await scmApi.getSalesFixedMeta()
      if (response.code !== 0) return
      meta.value = response.data
    }
    resetFilters()
    await queryReport(true)
  } catch (error: any) { ElMessage.error(error?.message || '固定报表初始化失败') }
}

function resizeChart() { chart?.resize() }
watch(() => [props.reportType, props.reportCode], () => { meta.value = null; result.value = { report_code: props.reportCode as any, mode: 'summary', columns: [], rows: [], summary: {}, total: 0, page: 1, page_size: 100, ignored_fields: [] }; chart?.dispose(); chart = null; initialize() })
onMounted(() => { window.addEventListener('resize', resizeChart); initialize() })
onBeforeUnmount(() => { window.removeEventListener('resize', resizeChart); chart?.dispose() })
</script>

<style scoped>
/* 紧凑布局（参照金蝶）：报表切换 + 操作一行、常用筛选一行，表格填满剩余高度 */
.fixed-report-page { height: 100%; min-height: 0; display: flex; flex-direction: column; gap: var(--block-gap); padding: var(--page-pad); box-sizing: border-box; color: #172033; }

/* 顶部：报表切换页签 + 操作按钮 */
.rpt-topbar { display: flex; align-items: center; gap: 12px; min-width: 0; flex-shrink: 0; }
.report-tabs { display: flex; gap: 2px; min-width: 0; flex: 1 1 auto; overflow-x: auto; scrollbar-width: thin; }
.report-tabs button { height: 28px; padding: 0 12px; border: 0; border-radius: 6px; background: transparent; color: #526076; font-size: var(--cw-text-base); cursor: pointer; white-space: nowrap; }
.report-tabs button:hover { background: #eef4fb; color: #145da0; }
.report-tabs button.active { background: var(--mint-500, #12c7ae); color: #fff; font-weight: 600; }
.header-actions { display: flex; gap: 8px; flex-shrink: 0; --el-component-size: var(--ctl-row-height); }
.header-actions .el-button { height: var(--ctl-row-height); }
.header-actions .el-button + .el-button { margin-left: 0; }

/* 筛选区 */
.filter-card, .result-card { background: #fff; border: 1px solid #e2e8f0; border-radius: 8px; }
.filter-card { flex-shrink: 0; padding: var(--filter-row-pad); }
.filter-line { display: flex; align-items: center; flex-wrap: wrap; gap: 6px 12px; }
.filter-line--more { margin-top: 6px; padding-top: 6px; border-top: 1px dashed #dbe3ed; }
.filter-item { display: inline-flex; align-items: center; gap: 6px; font-size: var(--cw-text-sm); color: #68758a; white-space: nowrap; }
.filter-item .el-select { width: 160px; }
.filter-item.wide .el-select { width: 240px; }
.more-toggle { font-size: var(--cw-text-sm); }
.control-label { font-size: 12px; color: #66758b; }

/* 订单跟踪汇总：单行小卡 */
.tracking-summary { display: flex; flex-wrap: wrap; gap: 6px; flex-shrink: 0; }
.tracking-summary > div { display: flex; align-items: baseline; gap: 8px; padding: 4px 12px; background: #fff; border: 1px solid #e2e8f0; border-radius: 6px; }
.tracking-summary span { font-size: 12px; color: #718096; }
.tracking-summary strong { font-size: 15px; color: #173b61; }
.tracking-summary .warning strong { color: #dc2626; }

/* 结果区：表格填满，底栏合并条数 / 口径说明 / 分页 */
.result-card { min-height: 0; flex: 1; display: flex; flex-direction: column; overflow: hidden; }
.chart { height: 250px; border-bottom: 1px solid #e8edf4; }
.table-zone { min-height: 0; flex: 1; }
.table-zone.with-chart { min-height: 230px; }
.result-footer { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 4px 10px; border-top: 1px solid #e8edf4; color: #7c899b; font-size: 12px; }
.result-meta { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.result-meta strong { color: #172033; }
.result-meta .sep { margin: 0 6px; color: #c0c8d4; }
.negative { color: #dc2626; font-weight: 600; }
.receipt-links { display: flex; gap: 6px; flex-wrap: wrap; }
.rank-badge { display: inline-flex; justify-content: center; min-width: 26px; padding: 2px 7px; border-radius: 12px; background: #eaf2ff; color: #1d4ed8; font-weight: 700; }
.el-input-number { width: 110px; }

@media (max-width: 900px) {
  .fixed-report-page { height: auto; }
  .rpt-topbar { flex-direction: column; align-items: stretch; }
  .result-card { height: 650px; }
  .chart { height: 220px; }
}
</style>
