<template>
  <div class="page prod-exec-page">
    <div class="report-header">
      <div class="report-header__left">
        <el-button link @click="router.back()"><el-icon><ArrowLeft /></el-icon>返回</el-button>
        <span>/</span><b>生产执行及在制结存表</b>
      </div>
      <span class="report-header__note">在制为工单级口径，同一工单的多个成品行显示同一个数</span>
    </div>

    <div class="toolbar">
      <el-input v-model="filters.plan_code" clearable placeholder="工单号" style="width:150px" />
      <el-input v-model="filters.item_code" clearable placeholder="成品编码/名称" style="width:170px" />
      <el-input v-model="filters.dept_code" clearable placeholder="部门编码" style="width:120px" />
      <el-date-picker v-model="dateRange" type="daterange" value-format="YYYY-MM-DD"
        start-placeholder="开工日期起" end-placeholder="开工日期止" style="width:240px" />
      <el-select v-model="filters.status" clearable placeholder="执行状态" style="width:130px">
        <el-option v-for="s in ['未完工', '部分完工', '已完工']" :key="s" :label="s" :value="s" />
      </el-select>
      <el-checkbox v-model="onlyWip" border>只看有在制</el-checkbox>
      <el-button type="primary" :loading="loading" @click="query">查询</el-button>
      <el-button type="success" plain :loading="exporting" @click="exportExcel">导出Excel</el-button>
    </div>

    <div class="cards">
      <div><span>工单数</span><b>{{ summary.plan_count || 0 }}</b></div>
      <div><span>计划数量</span><b>{{ num(summary.plan_qty) }}</b></div>
      <div><span>已完工</span><b>{{ num(summary.finished_qty) }}</b></div>
      <div><span>已报废</span><b>{{ num(summary.scrap_qty) }}</b></div>
      <div><span>已领料成本</span><b>{{ money(summary.issued_material_cost) }}</b></div>
      <div :class="{ 'is-warn': Math.abs(Number(summary.total_wip) || 0) > 0.005 }">
        <span>在制合计</span><b>{{ money(summary.total_wip) }}</b>
      </div>
    </div>

    <div class="table-wrap">
      <el-table v-loading="loading" :data="rows" border stripe height="100%">
        <el-table-column label="工单号" min-width="150" fixed="left">
          <template #default="{ row }"><el-link type="primary" @click="openPlan(row)">{{ row.plan_code }}</el-link></template>
        </el-table-column>
        <el-table-column prop="item_code" label="成品编码" width="120" />
        <el-table-column prop="item_name" label="成品名称" min-width="150" show-overflow-tooltip />
        <el-table-column prop="spec" label="规格" min-width="110" show-overflow-tooltip />
        <el-table-column label="计划数量" width="95" align="right"><template #default="{ row }">{{ num(row.plan_qty) }}</template></el-table-column>
        <el-table-column label="已完工" width="90" align="right"><template #default="{ row }">{{ num(row.finished_qty) }}</template></el-table-column>
        <el-table-column label="已报废" width="90" align="right"><template #default="{ row }">{{ num(row.scrap_qty) }}</template></el-table-column>
        <el-table-column label="未完工" width="90" align="right"><template #default="{ row }">{{ num(row.remaining_qty) }}</template></el-table-column>
        <el-table-column label="完成率" width="90" align="right"><template #default="{ row }">{{ row.completion_rate }}%</template></el-table-column>
        <el-table-column label="报废率" width="90" align="right"><template #default="{ row }">{{ row.scrap_rate }}%</template></el-table-column>
        <el-table-column label="净领料" width="95" align="right"><template #default="{ row }">{{ num(row.issued_material_qty) }}</template></el-table-column>
        <el-table-column label="已领料成本" width="115" align="right"><template #default="{ row }">{{ money(row.issued_material_cost) }}</template></el-table-column>
        <el-table-column label="每件料成本" width="110" align="right"><template #default="{ row }">{{ money(row.mat_unit_cost) }}</template></el-table-column>
        <el-table-column label="已消耗料成本" width="120" align="right"><template #default="{ row }">{{ money(row.consumed_cost) }}</template></el-table-column>
        <el-table-column label="料在制" width="105" align="right">
          <template #default="{ row }"><span :class="{ wip: Math.abs(row.material_wip) > 0.005 }">{{ money(row.material_wip) }}</span></template>
        </el-table-column>
        <el-table-column label="报工合格" width="95" align="right"><template #default="{ row }">{{ num(row.reported_good_qty) }}</template></el-table-column>
        <el-table-column label="报工人工" width="100" align="right"><template #default="{ row }">{{ money(row.labor_total) }}</template></el-table-column>
        <el-table-column label="报工制费" width="100" align="right"><template #default="{ row }">{{ money(row.overhead_total) }}</template></el-table-column>
        <el-table-column label="人工制费在制" width="120" align="right">
          <template #default="{ row }"><span :class="{ wip: Math.abs(row.labor_wip) > 0.005 }">{{ money(row.labor_wip) }}</span></template>
        </el-table-column>
        <el-table-column label="在制合计" width="110" align="right" fixed="right">
          <template #default="{ row }"><b :class="{ wip: Math.abs(row.total_wip) > 0.005 }">{{ money(row.total_wip) }}</b></template>
        </el-table-column>
        <el-table-column prop="execution_status" label="执行状态" width="100" fixed="right">
          <template #default="{ row }">
            <el-tag :type="row.execution_status === '已完工' ? 'success' : row.execution_status === '部分完工' ? 'warning' : 'info'" effect="plain">
              {{ row.execution_status }}
            </el-tag>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <div class="tip">
      料在制 ＝ 已领料成本 −Σ(已完工＋已报废)×每件料成本；人工制费在制 ＝ 已审核报工累计 − 各成品已吸收。
      末批完工会把剩余在制一次性吸收，正常收尾后在制应为 0。
    </div>
    <el-pagination v-model:current-page="page" v-model:page-size="pageSize" :total="total"
      :page-sizes="[20, 50, 100, 200]" layout="total, sizes, prev, pager, next" @change="load" />
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { scmApi } from '@/api/scm'
import { ArrowLeft } from '@element-plus/icons-vue'

const router = useRouter()
const loading = ref(false)
const exporting = ref(false)
const rows = ref<any[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(50)
const onlyWip = ref(false)
const summary = ref<Record<string, number>>({})
const dateRange = ref<[string, string] | []>([])
const filters = ref({ plan_code: '', item_code: '', status: '', dept_code: '' })

const params = () => ({
  ...filters.value,
  only_wip: onlyWip.value ? '1' : undefined,
  start_date: dateRange.value[0] || undefined,
  end_date: dateRange.value[1] || undefined,
  page: page.value,
  page_size: pageSize.value,
})
const num = (v: any) => (Number(v) || 0).toLocaleString('zh-CN', { maximumFractionDigits: 6 })
const money = (v: any) => (Number(v) || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

async function load() {
  loading.value = true
  try {
    const r = await scmApi.getProductionExecution(params())
    if (r.code === 0) { rows.value = r.data.rows; total.value = r.data.total; summary.value = r.data.summary }
  } finally { loading.value = false }
}
function query() { page.value = 1; load() }
function openPlan(row: any) { router.push({ name: 'ScmProductionOrder', params: { id: row.plan_id } }) }
async function exportExcel() {
  exporting.value = true
  try {
    const blob = await scmApi.exportProductionExecution(params())
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = '生产执行及在制结存表.xlsx'
    a.click()
    URL.revokeObjectURL(url)
  } finally { exporting.value = false }
}
onMounted(load)
</script>

<style scoped>
.prod-exec-page { height: 100%; display: flex; flex-direction: column; padding: var(--page-pad); gap: var(--block-gap); }
.report-header { display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid var(--el-border-color-lighter); padding-bottom: 8px; }
.report-header__left { display: flex; align-items: center; gap: 8px; }
.report-header__note { font-size: 12px; color: var(--el-text-color-secondary); }
.toolbar { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.cards { display: grid; grid-template-columns: repeat(6, minmax(130px, 1fr)); gap: 8px; }
.cards > div { padding: 10px 14px; border: 1px solid var(--el-border-color-light); border-radius: 8px; }
.cards > div.is-warn { border-color: var(--el-color-warning-light-5); }
.cards span { display: block; font-size: 12px; color: var(--el-text-color-secondary); }
.cards b { font-size: 18px; }
.table-wrap { flex: 1; min-height: 240px; }
.wip { color: var(--el-color-warning); }
.tip { font-size: 12px; color: var(--el-text-color-secondary); line-height: 1.6; }
</style>
