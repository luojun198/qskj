<template>
  <div class="sales-workbench">
    <header class="workbench-header">
      <div>
        <div class="title-row">
          <h2>{{ reportName }}自定义查询</h2>
          <el-tag :type="isPurchase ? 'warning' : 'success'" effect="plain">{{ reportScope }}</el-tag>
        </div>
        <p>筛选、字段、维度、指标和图表均可按当前分析目标组合。</p>
      </div>
      <div class="header-actions">
        <el-button @click="resetConfig">重置</el-button>
        <el-button :loading="exporting" @click="exportExcel"><el-icon><Download /></el-icon>导出完整结果</el-button>
        <el-button type="primary" :loading="loading" @click="runQuery(true)"><el-icon><Search /></el-icon>执行查询</el-button>
      </div>
    </header>

    <section class="scheme-bar">
      <el-radio-group v-model="config.mode" size="small" @change="onModeChange">
        <el-radio-button value="detail">明细查询</el-radio-button>
        <el-radio-button value="summary">汇总分析</el-radio-button>
      </el-radio-group>
      <span class="bar-divider" />
      <span class="bar-label">个人方案</span>
      <el-select v-model="selectedSchemeId" clearable placeholder="未选择方案" size="small" style="width: 220px" @change="loadScheme">
        <el-option v-for="scheme in schemes" :key="scheme.id" :label="scheme.name" :value="scheme.id">
          <span>{{ scheme.name }}</span><el-tag v-if="scheme.is_default" size="small" type="success" class="default-tag">默认</el-tag>
        </el-option>
      </el-select>
      <el-button size="small" @click="saveAsScheme">另存方案</el-button>
      <el-button size="small" :disabled="!selectedSchemeId" @click="overwriteScheme()">覆盖</el-button>
      <el-button size="small" :disabled="!selectedSchemeId" @click="setDefaultScheme">设为默认</el-button>
      <el-button size="small" type="danger" plain :disabled="!selectedSchemeId" @click="deleteScheme">删除</el-button>
      <span class="scheme-tip">方案仅当前账套、当前用户可见</span>
    </section>

    <el-collapse v-model="openPanels" class="designer">
      <el-collapse-item name="filters">
        <template #title><span class="panel-title">① 查询条件</span><span class="panel-note">支持 AND / OR 条件组，日期留空表示全部历史</span></template>
        <SalesFilterGroup :group="config.filters" :fields="meta?.fields || []" :operators="meta?.operators || {}" :max-depth="meta?.limits.filter_depth || 3" />
      </el-collapse-item>
      <el-collapse-item name="layout">
        <template #title><span class="panel-title">② {{ config.mode === 'detail' ? '展示字段' : '统计维度与指标' }}</span><span class="panel-note">选择顺序就是结果列顺序</span></template>
        <div class="design-grid">
          <div class="design-block" v-if="config.mode === 'detail'">
            <label>明细展示字段（最多 30 个）</label>
            <el-select v-model="config.fields" multiple filterable collapse-tags collapse-tags-tooltip placeholder="选择展示字段" style="width:100%">
              <el-option-group v-for="group in detailFieldGroups" :key="group.category" :label="group.category">
                <el-option v-for="field in group.fields" :key="field.key" :label="field.label" :value="field.key" />
              </el-option-group>
            </el-select>
            <SelectedOrder :keys="config.fields" :labels="fieldLabels" @move="moveKey(config.fields, $event.index, $event.direction)" />
          </div>
          <template v-else>
            <div class="design-block">
              <label>统计维度（最多 {{ meta?.limits.dimensions || 6 }} 个，可不选）</label>
              <el-select v-model="config.dimensions" multiple filterable collapse-tags collapse-tags-tooltip placeholder="选择统计维度" style="width:100%">
                <el-option-group v-for="group in dimensionGroups" :key="group.category" :label="group.category">
                  <el-option v-for="field in group.fields" :key="field.key" :label="field.label" :value="field.key" :disabled="!config.dimensions.includes(field.key) && config.dimensions.length >= (meta?.limits.dimensions || 6)" />
                </el-option-group>
              </el-select>
              <SelectedOrder :keys="config.dimensions" :labels="dimensionLabels" @move="moveKey(config.dimensions, $event.index, $event.direction)" />
            </div>
            <div class="design-block">
              <label>统计指标</label>
              <el-select v-model="config.metrics" multiple filterable collapse-tags collapse-tags-tooltip placeholder="选择统计指标" style="width:100%">
                <el-option v-for="metric in meta?.metrics || []" :key="metric.key" :label="metric.label" :value="metric.key" />
              </el-select>
              <SelectedOrder :keys="config.metrics" :labels="metricLabels" @move="moveKey(config.metrics, $event.index, $event.direction)" />
            </div>
          </template>
        </div>
      </el-collapse-item>
      <el-collapse-item name="sort">
        <template #title><span class="panel-title">③ 排序与结果过滤</span><span class="panel-note">最多 3 个排序字段；汇总模式可对指标结果二次过滤</span></template>
        <div class="sort-panel">
          <div class="sort-list">
            <div v-for="(sort, index) in config.sort" :key="index" class="sort-row">
              <el-select v-model="sort.key" placeholder="排序字段" size="small" style="width:190px">
                <el-option v-for="field in sortFields" :key="field.key" :label="field.label" :value="field.key" />
              </el-select>
              <el-select v-model="sort.direction" size="small" style="width:100px"><el-option label="升序" value="asc" /><el-option label="降序" value="desc" /></el-select>
              <el-button text type="danger" @click="config.sort.splice(index, 1)">移除</el-button>
            </div>
            <el-button v-if="config.sort.length < 3" text type="primary" :disabled="!sortFields.length" @click="addSort">+ 排序字段</el-button>
          </div>
          <SalesFilterGroup
            v-if="config.mode === 'summary' && config.result_filters"
            :group="config.result_filters" :fields="metricFilterFields" :operators="meta?.operators || {}"
            :max-depth="meta?.limits.filter_depth || 3"
          />
        </div>
      </el-collapse-item>
    </el-collapse>

    <section class="result-card">
      <div class="result-head">
        <div><strong>查询结果</strong><span class="result-count">共 {{ result.total.toLocaleString() }} {{ config.mode === 'summary' ? '组' : '行' }}</span></div>
        <div class="result-switch">
          <el-radio-group v-model="resultView" size="small" @change="renderChart">
            <el-radio-button value="table">表格</el-radio-button>
            <el-radio-button value="chart" :disabled="config.mode !== 'summary'">图表</el-radio-button>
          </el-radio-group>
          <template v-if="resultView === 'chart' && config.mode === 'summary'">
            <el-select v-model="chartType" size="small" style="width:100px" @change="renderChart"><el-option label="柱状图" value="bar" /><el-option label="折线图" value="line" /><el-option label="饼图" value="pie" /></el-select>
            <el-select v-model="chartDimension" size="small" placeholder="分类维度" style="width:150px" @change="renderChart"><el-option v-for="column in result.columns.filter(c => c.role === 'dimension')" :key="column.key" :label="column.label" :value="column.key" /></el-select>
            <el-select v-model="chartMetric" size="small" placeholder="指标" style="width:150px" @change="renderChart"><el-option v-for="column in result.columns.filter(c => c.role === 'metric')" :key="column.key" :label="column.label" :value="column.key" /></el-select>
          </template>
        </div>
      </div>
      <div v-show="resultView === 'table'" class="table-wrap">
        <el-table :data="result.rows" v-loading="loading" border stripe size="small" height="100%" show-summary :summary-method="tableSummary" empty-text="请设置条件并执行查询">
          <el-table-column type="index" label="序号" width="54" align="center" :index="rowIndex" />
          <el-table-column v-for="column in result.columns" :key="column.key" :prop="column.key" :label="column.label" :min-width="columnWidth(column)" :align="numericType(column.type) ? 'right' : 'left'" show-overflow-tooltip>
            <template #default="{ row }">
              <el-link v-if="column.key === 'doc_no' && row._doc_id" type="primary" @click="openDocument(row._doc_id)">{{ row[column.key] }}</el-link>
              <span v-else :class="{ negative: numericType(column.type) && Number(row[column.key]) < 0 }">{{ formatSalesReportValue(row[column.key], column.type) }}</span>
            </template>
          </el-table-column>
        </el-table>
      </div>
      <div v-show="resultView === 'chart'" class="chart-wrap"><div ref="chartEl" class="chart" /></div>
      <div class="result-footer">
        <span>合计基于全部过滤结果，不受当前分页影响</span>
        <el-pagination v-model:current-page="config.page" v-model:page-size="config.page_size" :page-sizes="[50,100,200,500]" :total="result.total" layout="total, sizes, prev, pager, next" @change="runQuery(false)" />
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, defineComponent, h, nextTick, onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { Download, Search } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import * as echarts from 'echarts'
import { scmApi, type SalesReportFieldMeta, type SalesReportMeta, type SalesReportQueryConfig, type SalesReportResult, type SalesReportScheme } from '@/api/scm'
import { scmDocumentRoute } from '@/utils/scmDocNavigation'
import SalesFilterGroup from '@/components/scm/SalesFilterGroup.vue'
import { countSalesFilters, createSalesReportConfig, formatSalesReportValue, getDefaultSalesScheme, normalizeSalesReportScheme } from '@/utils/scmSalesReport'

const props = withDefaults(defineProps<{ reportType?: 'sales' | 'purchase' }>(), { reportType: 'sales' })
const isPurchase = computed(() => props.reportType === 'purchase')
const reportName = computed(() => isPurchase.value ? '采购' : '销售')
const reportScope = computed(() => isPurchase.value ? 'PI 采购入库 − PR 采购退货' : 'SO 销售出库 − SR 销售退货')

const SelectedOrder = defineComponent({
  props: { keys: { type: Array as () => string[], required: true }, labels: { type: Object as () => Record<string, string>, required: true } },
  emits: ['move'],
  setup(props, { emit }) {
    return () => h('div', { class: 'selected-order' }, props.keys.map((key, index) => h('span', { class: 'selected-chip' }, [
      h('b', `${index + 1}`), h('span', props.labels[key] || key),
      h('button', { disabled: index === 0, onClick: () => emit('move', { index, direction: -1 }) }, '↑'),
      h('button', { disabled: index === props.keys.length - 1, onClick: () => emit('move', { index, direction: 1 }) }, '↓'),
    ])))
  },
})

const router = useRouter()
const meta = ref<SalesReportMeta | null>(null)
const config = ref<SalesReportQueryConfig>({ mode: 'summary', filters: { logic: 'and', children: [] }, result_filters: { logic: 'and', children: [] }, fields: [], dimensions: [], metrics: [], sort: [], page: 1, page_size: 100 })
const result = ref<SalesReportResult>({ mode: 'summary', columns: [], rows: [], summary: {}, total: 0, page: 1, page_size: 100, ignored_fields: [] })
const schemes = ref<SalesReportScheme[]>([])
const selectedSchemeId = ref('')
const loading = ref(false)
const exporting = ref(false)
const openPanels = ref(['filters', 'layout'])
const resultView = ref<'table' | 'chart'>('table')
const chartType = ref<'bar' | 'line' | 'pie'>('bar')
const chartDimension = ref('')
const chartMetric = ref('')
const chartEl = ref<HTMLElement | null>(null)
let chart: echarts.ECharts | null = null

const groups = (fields: SalesReportFieldMeta[]) => Object.entries(fields.reduce<Record<string, SalesReportFieldMeta[]>>((map, field) => {
  ;(map[field.category || '其他'] ||= []).push(field); return map
}, {})).map(([category, list]) => ({ category, fields: list }))
const detailFieldGroups = computed(() => groups((meta.value?.fields || []).filter(field => field.detail)))
const dimensionGroups = computed(() => groups(meta.value?.dimensions || []))
const fieldLabels = computed(() => Object.fromEntries((meta.value?.fields || []).map(field => [field.key, field.label])))
const dimensionLabels = computed(() => Object.fromEntries((meta.value?.dimensions || []).map(field => [field.key, field.label])))
const metricLabels = computed(() => Object.fromEntries((meta.value?.metrics || []).map(field => [field.key, field.label])))
const metricFilterFields = computed<SalesReportFieldMeta[]>(() => (meta.value?.metrics || []).map(metric => ({ ...metric, category: '汇总指标' })))
const sortFields = computed(() => config.value.mode === 'detail'
  ? (meta.value?.fields || []).filter(field => config.value.fields.includes(field.key))
  : [...(meta.value?.dimensions || []).filter(field => config.value.dimensions.includes(field.key)), ...metricFilterFields.value.filter(field => config.value.metrics.includes(field.key))])

function moveKey(keys: string[], index: number, direction: number) {
  const target = index + direction
  if (target < 0 || target >= keys.length) return
  ;[keys[index], keys[target]] = [keys[target], keys[index]]
}
function addSort() {
  const first = sortFields.value.find(field => !config.value.sort.some(sort => sort.key === field.key)) || sortFields.value[0]
  if (first) config.value.sort.push({ key: first.key, direction: 'desc' })
}
function onModeChange() {
  config.value.page = 1
  config.value.sort = []
  resultView.value = 'table'
}
function resetConfig() {
  if (!meta.value) return
  config.value = createSalesReportConfig(meta.value)
  selectedSchemeId.value = ''
  result.value = { mode: config.value.mode, columns: [], rows: [], summary: {}, total: 0, page: 1, page_size: config.value.page_size, ignored_fields: [] }
}
function validateConfig() {
  if (!meta.value) return false
  if (countSalesFilters(config.value.filters) > meta.value.limits.filters) return ElMessage.warning(`筛选条件最多 ${meta.value.limits.filters} 条`), false
  if (config.value.mode === 'detail' && !config.value.fields.length) return ElMessage.warning('请至少选择一个展示字段'), false
  if (config.value.mode === 'summary' && !config.value.metrics.length) return ElMessage.warning('请至少选择一个统计指标'), false
  if (config.value.dimensions.length > meta.value.limits.dimensions) return ElMessage.warning(`统计维度最多 ${meta.value.limits.dimensions} 个`), false
  return true
}
async function runQuery(resetPage = false) {
  if (!validateConfig()) return
  if (resetPage) config.value.page = 1
  loading.value = true
  try {
    const response = await (isPurchase.value ? scmApi.queryPurchaseCustom(config.value) : scmApi.querySalesCustom(config.value))
    if (response.code !== 0) return
    result.value = response.data
    if (response.data.ignored_fields.length) ElMessage.warning(`已忽略失效字段：${response.data.ignored_fields.join('、')}`)
    prepareChartSelection()
    if (resultView.value === 'chart') renderChart()
  } finally { loading.value = false }
}
function prepareChartSelection() {
  const dimensions = result.value.columns.filter(column => column.role === 'dimension')
  const metrics = result.value.columns.filter(column => column.role === 'metric')
  if (!dimensions.some(column => column.key === chartDimension.value)) chartDimension.value = dimensions[0]?.key || ''
  if (!metrics.some(column => column.key === chartMetric.value)) chartMetric.value = metrics[0]?.key || ''
}
function renderChart() {
  if (resultView.value !== 'chart') return
  nextTick(() => {
    if (!chartEl.value) return
    chart ||= echarts.init(chartEl.value)
    const dim = result.value.columns.find(column => column.key === chartDimension.value)
    const metric = result.value.columns.find(column => column.key === chartMetric.value)
    if (!dim || !metric) { chart.clear(); return }
    const limit = chartType.value === 'pie' ? 20 : 50
    const rows = result.value.rows.slice(0, limit)
    const labels = rows.map(row => String(row[dim.key] ?? '未分类'))
    const values = rows.map(row => Number(row[metric.key]) || 0)
    chart.setOption(chartType.value === 'pie' ? {
      tooltip: { trigger: 'item' }, legend: { type: 'scroll', bottom: 0 },
      series: [{ name: metric.label, type: 'pie', radius: ['32%', '68%'], data: labels.map((name, index) => ({ name, value: values[index] })) }],
    } : {
      color: ['#3a7afe'], tooltip: { trigger: 'axis' }, grid: { left: 70, right: 24, top: 35, bottom: 75 },
      xAxis: { type: 'category', data: labels, axisLabel: { rotate: labels.length > 10 ? 35 : 0 } },
      yAxis: { type: 'value', name: metric.label }, dataZoom: labels.length > 15 ? [{ type: 'inside' }, { type: 'slider', bottom: 20 }] : [],
      series: [{ name: metric.label, type: chartType.value, smooth: chartType.value === 'line', data: values, barMaxWidth: 38 }],
    }, true)
  })
}
function tableSummary({ columns }: { columns: any[] }) {
  return columns.map((column, index) => index === 0 ? '合计' : result.value.summary[column.property] == null ? '' : formatSalesReportValue(result.value.summary[column.property], result.value.columns.find(item => item.key === column.property)?.type))
}
const numericType = (type: string) => ['number', 'amount', 'integer', 'percent'].includes(type)
const columnWidth = (column: SalesReportResult['columns'][number]) => numericType(column.type) ? 130 : column.type === 'date' ? 120 : 150
const rowIndex = (index: number) => (config.value.page - 1) * config.value.page_size + index + 1
function openDocument(id: string) { router.push(scmDocumentRoute(id, '', 'draft')) }

async function refreshSchemes() {
  const response = await (isPurchase.value ? scmApi.getPurchaseReportSchemes() : scmApi.getSalesReportSchemes())
  if (response.code === 0) schemes.value = response.data || []
}
async function loadScheme(id: string) {
  if (!id || !meta.value) return
  const scheme = schemes.value.find(item => item.id === id)
  if (!scheme) return
  const normalized = normalizeSalesReportScheme(scheme.config, meta.value)
  config.value = normalized.config
  if (normalized.ignored.length) ElMessage.warning(`方案中 ${normalized.ignored.length} 个失效字段已自动忽略：${normalized.ignored.join('、')}`)
  await runQuery(true)
}
async function saveAsScheme() {
  if (!validateConfig()) return
  const { value } = await ElMessageBox.prompt('方案仅当前账套、当前用户可见', '保存查询方案', { inputPlaceholder: '请输入方案名称', inputValidator: value => !!value.trim() || '请输入方案名称' })
  const response = await (isPurchase.value
    ? scmApi.createPurchaseReportScheme({ name: value.trim(), config: config.value })
    : scmApi.createSalesReportScheme({ name: value.trim(), config: config.value }))
  if (response.code === 0) { selectedSchemeId.value = response.data.id; await refreshSchemes(); ElMessage.success('方案已保存') }
}
async function overwriteScheme(isDefault?: boolean) {
  const scheme = schemes.value.find(item => item.id === selectedSchemeId.value)
  if (!scheme || !validateConfig()) return
  const data = { name: scheme.name, config: config.value, is_default: isDefault ?? scheme.is_default }
  const response = await (isPurchase.value ? scmApi.updatePurchaseReportScheme(scheme.id, data) : scmApi.updateSalesReportScheme(scheme.id, data))
  if (response.code === 0) { await refreshSchemes(); ElMessage.success(isDefault ? '已设为个人默认方案' : '方案已覆盖') }
}
function setDefaultScheme() { overwriteScheme(true) }
async function deleteScheme() {
  const scheme = schemes.value.find(item => item.id === selectedSchemeId.value)
  if (!scheme) return
  await ElMessageBox.confirm(`确定删除方案“${scheme.name}”吗？`, '删除方案', { type: 'warning' })
  const response = await (isPurchase.value ? scmApi.deletePurchaseReportScheme(scheme.id) : scmApi.deleteSalesReportScheme(scheme.id))
  if (response.code === 0) { selectedSchemeId.value = ''; await refreshSchemes(); ElMessage.success('方案已删除') }
}
async function exportExcel() {
  if (!validateConfig()) return
  exporting.value = true
  try {
    const blob = await (isPurchase.value ? scmApi.exportPurchaseCustom(config.value) : scmApi.exportSalesCustom(config.value))
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a'); link.href = url; link.download = `${reportName.value}自定义报表_${new Date().toISOString().slice(0, 10)}.xlsx`; link.click()
    URL.revokeObjectURL(url)
  } finally { exporting.value = false }
}
async function initialize() {
  loading.value = true
  try {
    const [metaResponse, schemeResponse] = await Promise.all(isPurchase.value
      ? [scmApi.getPurchaseCustomMeta(), scmApi.getPurchaseReportSchemes()]
      : [scmApi.getSalesCustomMeta(), scmApi.getSalesReportSchemes()])
    if (metaResponse.code !== 0) return
    meta.value = metaResponse.data
    schemes.value = schemeResponse.code === 0 ? schemeResponse.data || [] : []
    resetConfig()
    const defaultScheme = getDefaultSalesScheme(schemes.value)
    if (defaultScheme) { selectedSchemeId.value = defaultScheme.id; await loadScheme(defaultScheme.id) }
    else await runQuery(true)
  } finally { loading.value = false }
}
function resizeChart() { chart?.resize() }
onMounted(() => { window.addEventListener('resize', resizeChart); initialize() })
onUnmounted(() => { window.removeEventListener('resize', resizeChart); chart?.dispose() })
</script>

<style scoped>
.sales-workbench { height: 100%; padding: 14px 18px 18px; overflow: auto; background: #f4f7fb; }
.workbench-header { display:flex; justify-content:space-between; align-items:center; gap:20px; padding:16px 18px; background:linear-gradient(120deg,#f5fbff,#f8fff9); border:1px solid #dce8f5; border-radius:10px; }
.title-row { display:flex; align-items:center; gap:10px; } h2 { margin:0; font-size:20px; } .workbench-header p { margin:5px 0 0; color:var(--el-text-color-secondary); font-size:13px; }
.header-actions,.scheme-bar,.result-head,.result-switch { display:flex; align-items:center; gap:8px; }
.scheme-bar { margin-top:10px; padding:10px 12px; background:#fff; border:1px solid var(--el-border-color-lighter); border-radius:8px; }
.bar-divider { width:1px; height:24px; background:var(--el-border-color); margin:0 4px; }.bar-label { font-size:13px; font-weight:600; }.scheme-tip { margin-left:auto; color:var(--el-text-color-secondary); font-size:12px; }.default-tag { margin-left:8px; }
.designer { margin-top:10px; padding:0 16px; background:#fff; border:1px solid var(--el-border-color-lighter); border-radius:8px; --el-collapse-border-color:transparent; }
.panel-title { font-weight:600; color:var(--el-text-color-primary); }.panel-note { margin-left:12px; color:var(--el-text-color-secondary); font-size:12px; font-weight:400; }
.design-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:14px; }.design-block { min-width:0; padding:12px; background:var(--el-fill-color-lighter); border-radius:8px; }.design-block label { display:block; margin-bottom:8px; font-size:13px; font-weight:600; }
:deep(.selected-order) { display:flex; gap:6px; flex-wrap:wrap; margin-top:9px; }:deep(.selected-chip) { display:inline-flex; align-items:center; gap:5px; padding:4px 6px; border:1px solid #d8e4f2; border-radius:5px; background:#fff; font-size:12px; }:deep(.selected-chip b) { color:#3578e5; }:deep(.selected-chip button) { border:0; background:transparent; padding:0 2px; color:#3578e5; cursor:pointer; }:deep(.selected-chip button:disabled) { color:#c0c4cc; cursor:not-allowed; }
.sort-panel { display:grid; grid-template-columns:minmax(320px,.75fr) minmax(520px,1.25fr); gap:18px; }.sort-row { display:flex; gap:8px; margin-bottom:7px; }
.result-card { margin-top:10px; background:#fff; border:1px solid var(--el-border-color-lighter); border-radius:8px; overflow:hidden; }.result-head { justify-content:space-between; padding:10px 12px; border-bottom:1px solid var(--el-border-color-lighter); }.result-count { margin-left:10px; color:var(--el-text-color-secondary); font-size:12px; }
.table-wrap { height:430px; padding:10px 12px 0; }.chart-wrap { height:430px; padding:10px 12px; }.chart { width:100%; height:100%; }.result-footer { display:flex; align-items:center; justify-content:space-between; padding:9px 12px; color:var(--el-text-color-secondary); font-size:12px; border-top:1px solid var(--el-border-color-lighter); }.negative { color:var(--el-color-danger); }
@media (max-width:1100px) { .design-grid,.sort-panel { grid-template-columns:1fr; }.scheme-tip { display:none; }.workbench-header { align-items:flex-start; }.header-actions { flex-wrap:wrap; justify-content:flex-end; } }
</style>
