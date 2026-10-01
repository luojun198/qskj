<template>
  <div class="page rpt-page">
    <div class="report-header">
      <div class="report-header__left"><el-button link @click="router.back()"><el-icon><ArrowLeft /></el-icon>返回</el-button><span>/</span><b>工序在制表</b></div>
      <span class="report-header__note">按工单 × 成品 × 工序：转入 = 前道已审核完成数（首道 = 计划数）；在制 = 转入 − 完成 − 不良；剩余工时 = (计划 − 完成 − 不良) × 单件标准工时</span>
    </div>
    <div class="toolbar">
      <el-input v-model="filters.plan_code" clearable placeholder="工单号" size="small" style="width:140px" @keyup.enter="load" />
      <el-input v-model="filters.item_code" clearable placeholder="成品编码 / 名称" size="small" style="width:150px" @keyup.enter="load" />
      <el-select v-model="filters.work_center_code" clearable placeholder="工作中心" size="small" style="width:140px" @change="load">
        <el-option v-for="w in workCenters" :key="w.code" :label="w.name || w.code" :value="w.code" />
      </el-select>
      <el-select v-model="filters.status" placeholder="工单状态" size="small" style="width:110px" @change="load">
        <el-option label="已审核" value="released" /><el-option label="已关闭" value="closed" />
      </el-select>
      <el-checkbox v-model="onlyWip" size="small" @change="load">仅看有在制</el-checkbox>
      <el-button type="primary" size="small" :loading="loading" @click="load">查询</el-button>
      <FilterClearButton size="small" @clear="clear" />
    </div>
    <div class="summary-grid">
      <div><span>工序行</span><b>{{ rows.length }}</b></div>
      <div><span>在制合计</span><b>{{ num(sum('wip_qty')) }}</b></div>
      <div><span>剩余工时合计</span><b>{{ num(sum('remain_hours')) }}</b></div>
    </div>
    <div class="rpt-table">
      <el-table v-loading="loading" :data="rows" border stripe height="100%" :span-method="spanMethod">
        <el-table-column label="工单" width="140"><template #default="{ row }"><el-link type="primary" @click="openPlan(row)">{{ row.plan_code }}</el-link></template></el-table-column>
        <el-table-column label="成品" min-width="150" show-overflow-tooltip><template #default="{ row }">{{ row.item_code }} {{ row.item_name || '' }}</template></el-table-column>
        <el-table-column label="序" prop="seq" width="50" align="center" />
        <el-table-column label="工序" prop="process_name" min-width="110" />
        <el-table-column label="工作中心" width="120" show-overflow-tooltip><template #default="{ row }">{{ row.work_center_name || row.work_center_code || '-' }}</template></el-table-column>
        <el-table-column label="计划" width="80" align="right"><template #default="{ row }">{{ num(row.plan_qty) }}</template></el-table-column>
        <el-table-column label="转入" width="80" align="right"><template #default="{ row }">{{ num(row.in_qty) }}</template></el-table-column>
        <el-table-column label="完成" width="80" align="right"><template #default="{ row }">{{ num(row.done_qty) }}</template></el-table-column>
        <el-table-column label="不良" width="70" align="right"><template #default="{ row }">{{ cell(row.scrap_qty) }}</template></el-table-column>
        <el-table-column label="在制" width="80" align="right"><template #default="{ row }"><b :class="{ warn: row.wip_qty > 0 }">{{ cell(row.wip_qty) }}</b></template></el-table-column>
        <el-table-column label="剩余" width="80" align="right"><template #default="{ row }">{{ cell(row.remain_qty) }}</template></el-table-column>
        <el-table-column label="剩余工时" width="95" align="right"><template #default="{ row }">{{ cell(row.remain_hours) }}</template></el-table-column>
      </el-table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ArrowLeft } from '@element-plus/icons-vue'
import { scmApi } from '@/api/scm'
import { scmProductionPlanOrderRoute } from '@/utils/scmDocNavigation'
import FilterClearButton from '@/components/common/FilterClearButton.vue'

const router = useRouter()
const filters = ref({ plan_code: '', item_code: '', work_center_code: '', status: 'released' })
const onlyWip = ref(false)
const rows = ref<any[]>([]); const workCenters = ref<any[]>([])
const loading = ref(false)
const num = (v: any) => (Number(v) || 0).toLocaleString('zh-CN', { maximumFractionDigits: 4 })
const cell = (v: any) => Number(v) ? num(v) : ''
const sum = (k: string) => rows.value.reduce((s, r) => s + (Number(r[k]) || 0), 0)
async function load() {
  loading.value = true
  try { const r = await scmApi.getProcessWip({ ...filters.value, only_wip: onlyWip.value ? '1' : undefined }); if (r.code === 0) rows.value = r.data } finally { loading.value = false }
}
function clear() { filters.value = { plan_code: '', item_code: '', work_center_code: '', status: 'released' }; onlyWip.value = false; load() }
function openPlan(row: any) { router.push(scmProductionPlanOrderRoute(row.plan_id, 'self')) }
/** 同一成品的工序行合并「工单 / 成品」两列 */
function spanMethod({ row, rowIndex, columnIndex }: any) {
  if (columnIndex > 1) return
  const prev = rows.value[rowIndex - 1]
  if (prev && prev.product_id === row.product_id) return { rowspan: 0, colspan: 0 }
  let n = 1
  while (rows.value[rowIndex + n]?.product_id === row.product_id) n++
  return { rowspan: n, colspan: 1 }
}
onMounted(async () => { const w = await scmApi.getWorkCenters(); workCenters.value = w.data || []; load() })
</script>

<style scoped>
.rpt-page{height:100%;display:flex;flex-direction:column;padding:var(--page-pad);gap:var(--block-gap)}.report-header{display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--el-border-color-lighter);padding-bottom:4px;gap:16px}.report-header__left{display:flex;align-items:center;gap:8px;flex:none}.report-header__note{font-size:12px;color:var(--el-text-color-secondary)}.toolbar{display:flex;gap:8px;flex-wrap:wrap;align-items:center}.summary-grid{display:flex;flex-wrap:wrap;gap:6px}.summary-grid>div{display:flex;align-items:baseline;gap:8px;padding:3px 12px;border:1px solid var(--el-border-color-light);border-radius:6px;background:var(--el-bg-color)}.summary-grid span{font-size:12px;color:var(--el-text-color-secondary)}.summary-grid b{font-size:14px}.rpt-table{flex:1;min-height:220px}.warn{color:var(--el-color-warning)}
</style>
