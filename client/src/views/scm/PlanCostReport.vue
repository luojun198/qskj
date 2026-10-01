<template>
  <div class="page rpt-page">
    <div class="report-header">
      <div class="report-header__left"><el-button link @click="router.back()"><el-icon><ArrowLeft /></el-icon>返回</el-button><span>/</span><b>工单成本明细表</b></div>
      <span class="report-header__note">逐张自制工单：料成本 = 领料 + 补料 − 退料；人工 / 制费 = 已审核报工 + 工序委外加工费；已结转成品成本 = 完工 / 不良品 / 结案结转 + 已吸收人工制费；在制 = 投入 − 已结转</span>
    </div>
    <div class="toolbar">
      <el-input v-model="filters.plan_code" clearable placeholder="工单号" size="small" style="width:140px" @keyup.enter="query" />
      <el-input v-model="filters.item_code" clearable placeholder="成品编码 / 名称" size="small" style="width:150px" @keyup.enter="query" />
      <el-select v-model="filters.status" clearable placeholder="状态" size="small" style="width:110px" @change="query">
        <el-option label="已审核" value="released" /><el-option label="已关闭" value="closed" />
      </el-select>
      <el-date-picker v-model="dateRange" type="daterange" value-format="YYYY-MM-DD" range-separator="至" start-placeholder="开工从" end-placeholder="开工至" size="small" style="width:240px" @change="query" />
      <el-button type="primary" size="small" :loading="loading" @click="query">查询</el-button>
      <FilterClearButton size="small" @clear="clear" />
      <el-button type="success" plain size="small" :loading="exporting" @click="exportExcel">导出Excel</el-button>
    </div>
    <div class="summary-grid">
      <div><span>投入合计</span><b>{{ money(summary.total_cost) }}</b><i>料 {{ money(summary.material_cost) }} · 人工 {{ money(summary.labor_cost) }} · 制费 {{ money(summary.overhead_cost) }}</i></div>
      <div><span>已结转成品成本</span><b>{{ money(summary.output_cost) }}</b><i>其中结案结转 {{ money(summary.closeout_amount) }}</i></div>
      <div><span>在制合计</span><b>{{ money(summary.total_wip) }}</b><i>料 {{ money(summary.material_wip) }} · 人工制费 {{ money(summary.labor_wip) }}</i></div>
      <div><span>完工 / 报废</span><b>{{ num(summary.finished_qty) }} / {{ num(summary.scrap_qty) }}</b><i>报废料成本 {{ money(summary.scrap_cost) }}</i></div>
    </div>
    <div class="rpt-table">
      <el-table v-loading="loading" :data="rows" border stripe height="100%">
        <el-table-column label="工单号" width="150" fixed="left"><template #default="{ row }"><el-link type="primary" @click="openPlan(row)">{{ row.plan_code }}</el-link></template></el-table-column>
        <el-table-column label="状态" width="80" align="center"><template #default="{ row }"><el-tag size="small" :type="row.status === 'closed' ? 'success' : 'warning'" effect="plain">{{ row.status === 'closed' ? '已关闭' : '已审核' }}</el-tag></template></el-table-column>
        <el-table-column label="成品" min-width="160" show-overflow-tooltip><template #default="{ row }">{{ row.item_code }} {{ row.item_name }}</template></el-table-column>
        <el-table-column label="计划 / 实际" width="200"><template #default="{ row }"><div class="dates"><span>{{ row.start_date || '-' }} ~ {{ row.end_date || '-' }}</span><span class="muted">实际 {{ row.actual_start_date || '-' }} ~ {{ row.actual_end_date || '-' }}</span></div></template></el-table-column>
        <el-table-column label="计划数" width="85" align="right"><template #default="{ row }">{{ num(row.plan_qty) }}</template></el-table-column>
        <el-table-column label="完工数" width="85" align="right"><template #default="{ row }">{{ num(row.finished_qty) }}</template></el-table-column>
        <el-table-column label="报废数" width="80" align="right"><template #default="{ row }">{{ cell(row.scrap_qty) }}</template></el-table-column>
        <el-table-column label="投入" align="center">
          <el-table-column label="料" width="105" align="right"><template #default="{ row }">{{ money(row.material_cost) }}</template></el-table-column>
          <el-table-column label="人工" width="95" align="right"><template #default="{ row }">{{ cellMoney(row.labor_cost) }}</template></el-table-column>
          <el-table-column label="制费" width="95" align="right"><template #default="{ row }">{{ cellMoney(row.overhead_cost) }}</template></el-table-column>
          <el-table-column label="合计" width="110" align="right"><template #default="{ row }"><b>{{ money(row.total_cost) }}</b></template></el-table-column>
        </el-table-column>
        <el-table-column label="结转" align="center">
          <el-table-column label="报废料" width="90" align="right"><template #default="{ row }">{{ cellMoney(row.scrap_cost) }}</template></el-table-column>
          <el-table-column label="结案结转" width="95" align="right"><template #default="{ row }">{{ cellMoney(row.closeout_amount) }}</template></el-table-column>
          <el-table-column label="成品成本" width="110" align="right"><template #default="{ row }">{{ money(row.output_cost) }}</template></el-table-column>
        </el-table-column>
        <el-table-column label="在制" align="center">
          <el-table-column label="料" width="95" align="right"><template #default="{ row }"><span :class="{ warn: row.material_wip > 0.005 }">{{ cellMoney(row.material_wip) }}</span></template></el-table-column>
          <el-table-column label="人工制费" width="95" align="right"><template #default="{ row }"><span :class="{ warn: row.labor_wip > 0.005 }">{{ cellMoney(row.labor_wip) }}</span></template></el-table-column>
        </el-table-column>
        <el-table-column label="单位成本" align="center">
          <el-table-column label="合计" width="95" align="right"><template #default="{ row }"><b>{{ cellMoney(row.unit_cost) }}</b></template></el-table-column>
          <el-table-column label="料" width="85" align="right"><template #default="{ row }">{{ cellMoney(row.unit_material) }}</template></el-table-column>
          <el-table-column label="人工" width="85" align="right"><template #default="{ row }">{{ cellMoney(row.unit_labor) }}</template></el-table-column>
          <el-table-column label="制费" width="85" align="right"><template #default="{ row }">{{ cellMoney(row.unit_overhead) }}</template></el-table-column>
        </el-table-column>
      </el-table>
    </div>
    <el-pagination v-model:current-page="page" v-model:page-size="pageSize" :total="total" :page-sizes="[20,50,100,200]" layout="total, sizes, prev, pager, next" small @change="load" />
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
const filters = ref({ plan_code: '', item_code: '', status: '' })
const dateRange = ref<string[] | null>(null)
const rows = ref<any[]>([]); const total = ref(0); const page = ref(1); const pageSize = ref(50)
const summary = ref<Record<string, number>>({})
const loading = ref(false); const exporting = ref(false)
const num = (v: any) => (Number(v) || 0).toLocaleString('zh-CN', { maximumFractionDigits: 4 })
const money = (v: any) => (Number(v) || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const cell = (v: any) => Number(v) ? num(v) : ''
const cellMoney = (v: any) => Number(v) ? money(v) : ''
const params = () => ({ ...filters.value, start_date: dateRange.value?.[0], end_date: dateRange.value?.[1], page: page.value, page_size: pageSize.value })
async function load() {
  loading.value = true
  try { const r = await scmApi.getPlanCostDetail(params()); if (r.code === 0) { rows.value = r.data.rows; total.value = r.data.total; summary.value = r.data.summary } } finally { loading.value = false }
}
function query() { page.value = 1; load() }
function clear() { filters.value = { plan_code: '', item_code: '', status: '' }; dateRange.value = null; query() }
function openPlan(row: any) { router.push(scmProductionPlanOrderRoute(row.plan_id, 'self')) }
async function exportExcel() {
  exporting.value = true
  try { const blob = await scmApi.exportPlanCostDetail(params()); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = '工单成本明细表.xlsx'; a.click(); URL.revokeObjectURL(url) } finally { exporting.value = false }
}
onMounted(load)
</script>

<style scoped>
.rpt-page{height:100%;display:flex;flex-direction:column;padding:var(--page-pad);gap:var(--block-gap)}.report-header{display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--el-border-color-lighter);padding-bottom:4px;gap:16px}.report-header__left{display:flex;align-items:center;gap:8px;flex:none}.report-header__note{font-size:12px;color:var(--el-text-color-secondary)}.toolbar{display:flex;gap:8px;flex-wrap:wrap;align-items:center}.summary-grid{display:flex;flex-wrap:wrap;gap:6px}.summary-grid>div{display:flex;align-items:baseline;gap:8px;padding:3px 12px;border:1px solid var(--el-border-color-light);border-radius:6px;background:var(--el-bg-color)}.summary-grid span{font-size:12px;color:var(--el-text-color-secondary)}.summary-grid b{font-size:14px}.summary-grid i{font-style:normal;font-size:12px;color:var(--el-text-color-secondary)}.rpt-table{flex:1;min-height:220px}.dates{display:flex;flex-direction:column;font-size:12px;line-height:1.4}.muted{color:var(--el-text-color-secondary)}.warn{color:var(--el-color-warning)}
</style>
