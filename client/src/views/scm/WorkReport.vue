<template>
  <div class="page wr-page">
    <div class="filter-row">
      <span class="title">生产报工</span>
      <el-select v-model="planId" filterable clearable placeholder="全部工单（可选）" style="width:260px" size="small" @change="onPlan">
        <el-option v-for="p in plans" :key="p.id" :label="`${p.code}  ${p.first_product_name || p.item_name || p.item_code}  (${statusName(p.status)})`" :value="p.id" />
      </el-select>
      <el-date-picker v-model="dateRange" type="daterange" value-format="YYYY-MM-DD" range-separator="至" start-placeholder="开始" end-placeholder="结束" size="small" style="width:230px" @change="query" />
      <el-select v-model="filters.work_center_code" clearable placeholder="工作中心" size="small" style="width:140px" @change="query">
        <el-option v-for="w in workCenters" :key="w.code" :label="w.name || w.code" :value="w.code" />
      </el-select>
      <el-select v-model="filters.status" clearable placeholder="状态" size="small" style="width:100px" @change="query">
        <el-option label="草稿" value="draft" /><el-option label="已审核" value="audited" />
      </el-select>
      <el-input v-model="filters.keyword" clearable placeholder="报工单号 / 工单号 / 成品" size="small" style="width:180px" @keyup.enter="query" @clear="query" />
      <el-button size="small" :loading="loading" @click="query">查询</el-button>
      <el-button type="primary" size="small" :disabled="!planId" :title="planId ? '' : '请先选择工单'" @click="openAdd"><el-icon><Plus /></el-icon>新增报工</el-button>
      <SaveAsButton title="生产报工" />
      <span class="hint">合格 <b>{{ num(summary.qty) }}</b>　不良 <b>{{ num(summary.scrap_qty) }}</b>　工时 <b>{{ num(summary.work_hours) }}</b>　人工 <b>{{ fmt(summary.labor_amount) }}</b>　制费 <b>{{ fmt(summary.overhead_amount) }}</b></span>
    </div>

    <el-table v-col-width="'scm_WorkReport_1'" :data="rows" v-loading="loading" border stripe size="small" height="100%">
      <el-table-column label="报工单号" prop="report_no" width="140" />
      <el-table-column label="日期" prop="report_date" width="105" />
      <el-table-column label="工单" min-width="130" show-overflow-tooltip><template #default="{ row }"><el-link type="primary" @click="openPlan(row)">{{ row.plan_code }}</el-link></template></el-table-column>
      <el-table-column label="成品" min-width="140" show-overflow-tooltip><template #default="{ row }">{{ row.item_code }}{{ row.item_name ? ' ' + row.item_name : '' }}</template></el-table-column>
      <el-table-column label="工序" prop="process_name" width="100" />
      <el-table-column label="工作中心" prop="work_center_name" width="110" show-overflow-tooltip />
      <el-table-column label="操作工" prop="operator" width="90" show-overflow-tooltip />
      <el-table-column label="工时" prop="work_hours" width="70" align="right" />
      <el-table-column label="合格" prop="qty" width="70" align="right" />
      <el-table-column label="不良" prop="scrap_qty" width="65" align="right" />
      <el-table-column label="人工" width="95" align="right"><template #default="{ row }">{{ fmt(row.labor_amount) }}</template></el-table-column>
      <el-table-column label="制费" width="95" align="right"><template #default="{ row }">{{ fmt(row.overhead_amount) }}</template></el-table-column>
      <el-table-column label="状态" width="75" align="center">
        <template #default="{ row }"><el-tag size="small" :type="row.status === 'audited' ? 'success' : 'info'" effect="plain">{{ row.status === 'audited' ? '已审核' : '草稿' }}</el-tag></template>
      </el-table-column>
      <el-table-column label="操作" width="150" align="center">
        <template #default="{ row }">
          <template v-if="row.status === 'draft'">
            <el-button link type="success" size="small" @click="audit(row)">审核</el-button>
            <el-button link type="primary" size="small" @click="openEdit(row)">编辑</el-button>
            <el-button link type="danger" size="small" @click="del(row)">删除</el-button>
          </template>
          <el-button v-else link type="warning" size="small" @click="unaudit(row)">反审核</el-button>
        </template>
      </el-table-column>
    </el-table>
    <el-pagination v-model:current-page="page" v-model:page-size="pageSize" :total="total" :page-sizes="[20,50,100,200]" layout="total, sizes, prev, pager, next" small @change="load" />
  </div>
</template>

<script setup lang="ts">
import { onActivated, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Plus } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { scmApi } from '@/api/scm'
import { scmProductionPlanOrderRoute } from '@/utils/scmDocNavigation'

const route = useRoute()
const router = useRouter()
const plans = ref<any[]>([]); const workCenters = ref<any[]>([])
const planId = ref(String(route.query.plan_id || ''))
const filters = ref({ work_center_code: '', status: '', keyword: '' })
const dateRange = ref<string[] | null>(null)
const rows = ref<any[]>([]); const total = ref(0); const page = ref(1); const pageSize = ref(50)
const summary = ref<Record<string, number>>({})
const loading = ref(false)

const fmt = (v: any) => (Number(v) || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const num = (v: any) => (Number(v) || 0).toLocaleString('zh-CN', { maximumFractionDigits: 6 })
const statusName = (s: string) => ({ draft: '草稿', released: '已审核', closed: '已关闭' } as any)[s] || s

async function loadRefs() {
  const [p, w] = await Promise.all([scmApi.getProductionPlans({ plan_type: 'self' }), scmApi.getWorkCenters()])
  if (p.code === 0) plans.value = p.data as any[]
  if (w.code === 0) workCenters.value = w.data
}
async function load() {
  loading.value = true
  try {
    const r = await scmApi.getWorkReportsPaged({
      plan_id: planId.value || undefined, ...filters.value,
      start_date: dateRange.value?.[0], end_date: dateRange.value?.[1], page: page.value, page_size: pageSize.value,
    })
    if (r.code === 0) { rows.value = r.data.list; total.value = r.data.total; summary.value = r.data.summary || {} }
  } finally { loading.value = false }
}
function query() { page.value = 1; load() }
function onPlan() {
  // 记在地址栏里，从报工表单返回时能回到同一张工单
  router.replace({ name: 'ScmWorkReport', query: planId.value ? { plan_id: planId.value } : {} })
  query()
}
function openAdd() { router.push({ name: 'ScmWorkReportNew', query: { plan_id: planId.value } }) }
function openEdit(row: any) { router.push({ name: 'ScmWorkReportEdit', params: { id: row.id } }) }
function openPlan(row: any) { if (row.plan_id) router.push(scmProductionPlanOrderRoute(row.plan_id, 'self')) }
async function audit(row: any) {
  const r = await scmApi.auditWorkReport(row.id) as any
  if (r.code === 0) { ElMessage.success('已审核'); load() } else ElMessage.error(r.message || '审核失败')
}
async function unaudit(row: any) {
  const r = await scmApi.unauditWorkReport(row.id) as any
  if (r.code === 0) { ElMessage.success('已反审核'); load() } else ElMessage.error(r.message || '反审核失败')
}
async function del(row: any) {
  await ElMessageBox.confirm(`确认删除报工单「${row.report_no}」？`, '提示', { type: 'warning' })
  await scmApi.deleteWorkReport(row.id); ElMessage.success('已删除'); load()
}
onMounted(async () => { await loadRefs(); load() })
// 从报工表单返回时刷新（keep-alive 下 onMounted 不会重跑）
onActivated(() => { load() })
</script>

<style scoped>
.wr-page { display: flex; flex-direction: column; height: 100%; padding: var(--page-pad); gap: var(--block-gap); }
.filter-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.filter-row .title { font-weight: 600; }
.filter-row .hint { margin-left: auto; font-size: var(--cw-text-base); color: var(--el-text-color-secondary); }
</style>
