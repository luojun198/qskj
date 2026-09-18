<template>
  <div class="page rpt-page">
    <div class="report-header">
      <div class="report-header__left"><el-button link @click="router.back()"><el-icon><ArrowLeft /></el-icon>返回</el-button><span>/</span><b>产能负荷表</b></div>
      <span class="report-header__note">已审核工单未完成工序的剩余工时（剩余量 × 单件标准工时），按工作中心 × 工单交期所在周分桶；周产能 = 日产能 × 5 天；负荷率 &gt; 100% 表示该周超负荷。工作中心的日产能在「工作中心」维护。</span>
    </div>
    <div class="toolbar">
      <el-date-picker v-model="dateRange" type="daterange" value-format="YYYY-MM-DD" range-separator="至" start-placeholder="周（从）" end-placeholder="周（至）" size="small" style="width:240px" @change="load" />
      <el-select v-model="workCenter" clearable placeholder="工作中心" size="small" style="width:140px" @change="load">
        <el-option v-for="w in workCenters" :key="w.code" :label="w.name || w.code" :value="w.code" />
      </el-select>
      <el-button type="primary" size="small" :loading="loading" @click="load">查询</el-button>
      <FilterClearButton size="small" @clear="clear" />
    </div>
    <div class="summary-grid">
      <div><span>负荷合计（工时）</span><b>{{ num(sum('load_hours')) }}</b></div>
      <div><span>超负荷周次</span><b :class="{ warn: overCount > 0 }">{{ overCount }}</b></div>
      <div><span>未排产工时</span><b>{{ num(unscheduled) }}</b><i>工序未指定工作中心 / 工单无交期</i></div>
    </div>
    <div class="rpt-table">
      <el-table v-loading="loading" :data="rows" border stripe height="100%">
        <el-table-column label="周（周一）" prop="week" width="120" />
        <el-table-column label="工作中心" min-width="140" show-overflow-tooltip><template #default="{ row }">{{ row.work_center_name || row.work_center_code }}</template></el-table-column>
        <el-table-column label="日产能" width="90" align="right"><template #default="{ row }">{{ Number(row.daily_capacity_hours) || '-' }}</template></el-table-column>
        <el-table-column label="周产能" width="90" align="right"><template #default="{ row }">{{ Number(row.capacity_hours) || '-' }}</template></el-table-column>
        <el-table-column label="负荷工时" width="100" align="right"><template #default="{ row }">{{ num(row.load_hours) }}</template></el-table-column>
        <el-table-column label="负荷率" width="200">
          <template #default="{ row }">
            <el-progress v-if="row.utilization != null" :percentage="Math.min(100, row.utilization)" :stroke-width="12" :status="row.utilization > 100 ? 'exception' : row.utilization > 85 ? 'warning' : 'success'" :format="() => row.utilization + '%'" />
            <span v-else class="muted">未维护产能</span>
          </template>
        </el-table-column>
        <el-table-column label="涉及工单" min-width="220" show-overflow-tooltip><template #default="{ row }">{{ row.plans.join('、') }}</template></el-table-column>
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
const dateRange = ref<string[] | null>(null)
const workCenter = ref('')
const rows = ref<any[]>([]); const unscheduled = ref(0); const workCenters = ref<any[]>([])
const loading = ref(false)
const num = (v: any) => (Number(v) || 0).toLocaleString('zh-CN', { maximumFractionDigits: 2 })
const sum = (k: string) => rows.value.reduce((s, r) => s + (Number(r[k]) || 0), 0)
const overCount = computed(() => rows.value.filter(r => r.utilization != null && r.utilization > 100).length)
async function load() {
  loading.value = true
  try {
    const r = await scmApi.getCapacityLoad({ start_date: dateRange.value?.[0], end_date: dateRange.value?.[1], work_center_code: workCenter.value || undefined })
    if (r.code === 0) { rows.value = r.data.rows; unscheduled.value = r.data.unscheduled_hours }
  } finally { loading.value = false }
}
function clear() { dateRange.value = null; workCenter.value = ''; load() }
onMounted(async () => { const w = await scmApi.getWorkCenters(); workCenters.value = w.data || []; load() })
</script>

<style scoped>
.rpt-page{height:100%;display:flex;flex-direction:column;padding:12px 16px;gap:10px}.report-header{display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--el-border-color-lighter);padding-bottom:8px;gap:16px}.report-header__left{display:flex;align-items:center;gap:8px;flex:none}.report-header__note{font-size:12px;color:var(--el-text-color-secondary)}.toolbar{display:flex;gap:8px;flex-wrap:wrap;align-items:center}.summary-grid{display:grid;grid-template-columns:repeat(3,minmax(140px,240px));gap:8px}.summary-grid>div{padding:10px 14px;border:1px solid var(--el-border-color-light);border-radius:8px;background:var(--el-bg-color)}.summary-grid span{display:block;font-size:12px;color:var(--el-text-color-secondary)}.summary-grid b{font-size:16px}.summary-grid i{display:block;font-style:normal;font-size:12px;color:var(--el-text-color-secondary)}.rpt-table{flex:1;min-height:220px}.warn{color:var(--el-color-danger)}.muted{color:var(--el-text-color-secondary);font-size:12px}
</style>
