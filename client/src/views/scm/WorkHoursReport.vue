<template>
  <div class="page rpt-page">
    <div class="report-header">
      <div class="report-header__left"><el-button link @click="router.back()"><el-icon><ArrowLeft /></el-icon>返回</el-button><span>/</span><b>工时统计</b></div>
      <span class="report-header__note">已审核报工按分组汇总；标准工时 = 成品工艺路线里该工序的标准工时 × (合格 + 不良)；效率 = 标准 ÷ 实际</span>
    </div>
    <div class="toolbar">
      <el-radio-group v-model="groupBy" size="small" @change="load">
        <el-radio-button value="work_center">工作中心</el-radio-button>
        <el-radio-button value="operator">操作工</el-radio-button>
        <el-radio-button value="date">日期</el-radio-button>
        <el-radio-button value="plan">工单</el-radio-button>
        <el-radio-button value="process">工序</el-radio-button>
        <el-radio-button value="item">成品</el-radio-button>
      </el-radio-group>
      <el-date-picker v-model="dateRange" type="daterange" value-format="YYYY-MM-DD" range-separator="至" start-placeholder="开始日期" end-placeholder="结束日期" size="small" style="width:240px" />
      <el-select v-model="filters.work_center_code" clearable placeholder="工作中心" size="small" style="width:140px">
        <el-option v-for="w in workCenters" :key="w.code" :label="w.name || w.code" :value="w.code" />
      </el-select>
      <el-input v-model="filters.operator" clearable placeholder="操作工" size="small" style="width:120px" @keyup.enter="load" />
      <el-button type="primary" size="small" :loading="loading" @click="load">查询</el-button>
      <FilterClearButton size="small" @clear="clear" />
      <el-button type="success" plain size="small" :loading="exporting" @click="exportExcel">另存</el-button>
    </div>
    <div class="summary-grid">
      <div><span>报工单数</span><b>{{ summary.report_count || 0 }}</b></div>
      <div><span>合格 / 不良</span><b>{{ num(summary.qty) }} / {{ num(summary.scrap_qty) }}</b></div>
      <div><span>实际工时</span><b>{{ num(summary.work_hours) }}</b></div>
      <div><span>标准工时</span><b>{{ num(summary.std_hours) }}</b></div>
      <div><span>效率</span><b>{{ summary.efficiency != null ? summary.efficiency + '%' : '-' }}</b></div>
      <div><span>人工 / 制费</span><b>{{ money(summary.labor_amount) }} / {{ money(summary.overhead_amount) }}</b></div>
    </div>
    <div class="rpt-table">
      <el-table v-loading="loading" :data="rows" border stripe height="100%" show-summary :summary-method="sumRow">
        <el-table-column prop="group_label" :label="groupLabel" min-width="180" show-overflow-tooltip />
        <el-table-column label="报工单数" width="95" align="right"><template #default="{ row }">{{ row.report_count }}</template></el-table-column>
        <el-table-column label="合格数" width="100" align="right"><template #default="{ row }">{{ num(row.qty) }}</template></el-table-column>
        <el-table-column label="不良数" width="90" align="right"><template #default="{ row }">{{ num(row.scrap_qty) }}</template></el-table-column>
        <el-table-column label="实际工时" width="100" align="right"><template #default="{ row }">{{ num(row.work_hours) }}</template></el-table-column>
        <el-table-column label="标准工时" width="100" align="right"><template #default="{ row }">{{ num(row.std_hours) }}</template></el-table-column>
        <el-table-column label="工时差异" width="100" align="right"><template #default="{ row }"><span :class="{ neg: row.var_hours > 0, pos: row.var_hours < 0 }">{{ signed(row.var_hours) }}</span></template></el-table-column>
        <el-table-column label="效率" width="90" align="right"><template #default="{ row }">{{ row.efficiency != null ? row.efficiency + '%' : '-' }}</template></el-table-column>
        <el-table-column label="人工金额" width="110" align="right"><template #default="{ row }">{{ money(row.labor_amount) }}</template></el-table-column>
        <el-table-column label="制造费用" width="110" align="right"><template #default="{ row }">{{ money(row.overhead_amount) }}</template></el-table-column>
      </el-table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ArrowLeft } from '@element-plus/icons-vue'
import { scmApi } from '@/api/scm'
import FilterClearButton from '@/components/common/FilterClearButton.vue'

const router = useRouter()
const now = new Date(); const first = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
const dateRange = ref<string[] | null>([first, today])
const groupBy = ref('work_center')
const filters = ref({ work_center_code: '', operator: '' })
const rows = ref<any[]>([]); const summary = ref<Record<string, any>>({})
const workCenters = ref<any[]>([])
const loading = ref(false); const exporting = ref(false)
const LABELS: Record<string, string> = { work_center: '工作中心', operator: '操作工', date: '日期', plan: '工单', process: '工序', item: '成品' }
const groupLabel = computed(() => LABELS[groupBy.value] || '分组')
const num = (v: any) => (Number(v) || 0).toLocaleString('zh-CN', { maximumFractionDigits: 4 })
const money = (v: any) => (Number(v) || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const signed = (v: any) => { const n = Number(v) || 0; return (n > 0 ? '+' : '') + num(n) }
const params = () => ({ group_by: groupBy.value, start_date: dateRange.value?.[0], end_date: dateRange.value?.[1], ...filters.value })
function sumRow() {
  const s = summary.value
  return ['合计', String(s.report_count || 0), num(s.qty), num(s.scrap_qty), num(s.work_hours), num(s.std_hours), signed(s.var_hours), s.efficiency != null ? s.efficiency + '%' : '-', money(s.labor_amount), money(s.overhead_amount)]
}
async function load() {
  loading.value = true
  try { const r = await scmApi.getWorkHoursStat(params()); if (r.code === 0) { rows.value = r.data.rows; summary.value = r.data.summary } } finally { loading.value = false }
}
function clear() { filters.value = { work_center_code: '', operator: '' }; dateRange.value = [first, today]; load() }
async function exportExcel() {
  exporting.value = true
  try { const blob = await scmApi.exportWorkHoursStat(params()); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = '工时统计.xlsx'; a.click(); URL.revokeObjectURL(url) } finally { exporting.value = false }
}
onMounted(async () => { const w = await scmApi.getWorkCenters(); workCenters.value = w.data || []; load() })
</script>

<style scoped>
.rpt-page{height:100%;display:flex;flex-direction:column;padding:var(--page-pad);gap:var(--block-gap)}.report-header{display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--el-border-color-lighter);padding-bottom:4px;gap:16px}.report-header__left{display:flex;align-items:center;gap:8px;flex:none}.report-header__note{font-size:12px;color:var(--el-text-color-secondary)}.toolbar{display:flex;gap:8px;flex-wrap:wrap;align-items:center}.summary-grid{display:flex;flex-wrap:wrap;gap:6px}.summary-grid>div{display:flex;align-items:baseline;gap:8px;padding:3px 12px;border:1px solid var(--el-border-color-light);border-radius:6px;background:var(--el-bg-color)}.summary-grid span{font-size:12px;color:var(--el-text-color-secondary)}.summary-grid b{font-size:14px}.rpt-table{flex:1;min-height:220px}.neg{color:var(--el-color-danger)}.pos{color:var(--el-color-success)}
</style>
