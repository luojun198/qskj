<template>
  <div class="page pcl-page">
    <div class="filter-row">
      <span class="title">工单变更单</span>
      <el-input v-model="filters.keyword" clearable placeholder="变更单号 / 工单号 / 原因" size="small" style="width:200px" @keyup.enter="query" @clear="query" />
      <el-select v-model="filters.status" clearable placeholder="状态" size="small" style="width:100px" @change="query">
        <el-option label="草稿" value="draft" /><el-option label="已审核" value="audited" />
      </el-select>
      <el-date-picker v-model="dateRange" type="daterange" value-format="YYYY-MM-DD" range-separator="至" start-placeholder="开始" end-placeholder="结束" size="small" style="width:230px" @change="query" />
      <el-button size="small" :loading="loading" @click="query">查询</el-button>
      <span class="hint">变更单从「工单详情 → 变更」发起；审核后写回工单并留痕，不可反审核</span>
    </div>
    <el-table :data="rows" v-loading="loading" border stripe size="small" height="100%" @row-dblclick="open">
      <el-table-column label="变更单号" width="150"><template #default="{ row }"><el-link type="primary" :underline="false" @click="open(row)">{{ row.change_no }}</el-link></template></el-table-column>
      <el-table-column label="日期" prop="change_date" width="105" />
      <el-table-column label="工单" width="150"><template #default="{ row }"><el-link type="primary" :underline="false" @click="openPlan(row)">{{ row.plan_code }}</el-link></template></el-table-column>
      <el-table-column label="原因" prop="reason" min-width="160" show-overflow-tooltip />
      <el-table-column label="变更内容" min-width="300" show-overflow-tooltip><template #default="{ row }">{{ row.diff_summary }}{{ row.diff_count > 4 ? ` … 共 ${row.diff_count} 项` : '' }}</template></el-table-column>
      <el-table-column label="状态" width="80" align="center"><template #default="{ row }"><el-tag size="small" :type="row.status === 'audited' ? 'success' : 'info'" effect="plain">{{ row.status === 'audited' ? '已审核' : '草稿' }}</el-tag></template></el-table-column>
      <el-table-column label="制单 / 审核" width="150" show-overflow-tooltip><template #default="{ row }">{{ row.maker }}{{ row.auditor ? ' / ' + row.auditor : '' }}</template></el-table-column>
      <el-table-column label="操作" width="130" align="center">
        <template #default="{ row }">
          <template v-if="row.status === 'draft'">
            <el-button link type="success" size="small" @click="audit(row)">审核</el-button>
            <el-button link type="danger" size="small" @click="del(row)">删除</el-button>
          </template>
          <el-button v-else link type="primary" size="small" @click="open(row)">查看</el-button>
        </template>
      </el-table-column>
    </el-table>
    <el-pagination v-model:current-page="page" v-model:page-size="pageSize" :total="total" :page-sizes="[20,50,100]" layout="total, sizes, prev, pager, next" small @change="load" />
  </div>
</template>

<script setup lang="ts">
import { onActivated, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { scmApi } from '@/api/scm'
import { scmProductionPlanOrderRoute } from '@/utils/scmDocNavigation'

const router = useRouter()
const filters = ref({ keyword: '', status: '' })
const dateRange = ref<string[] | null>(null)
const rows = ref<any[]>([]); const total = ref(0); const page = ref(1); const pageSize = ref(50)
const loading = ref(false)
async function load() {
  loading.value = true
  try {
    const r = await scmApi.getPlanChanges({ ...filters.value, start_date: dateRange.value?.[0], end_date: dateRange.value?.[1], page: page.value, page_size: pageSize.value })
    if (r.code === 0) { rows.value = r.data.list; total.value = r.data.total }
  } finally { loading.value = false }
}
function query() { page.value = 1; load() }
function open(row: any) { router.push({ name: 'ScmPlanChangeForm', params: { id: row.id } }) }
function openPlan(row: any) { router.push(scmProductionPlanOrderRoute(row.plan_id, row.plan_type === 'outsource' ? 'outsource' : 'self')) }
async function audit(row: any) {
  try { await ElMessageBox.confirm(`审核变更单「${row.change_no}」后立即写回工单 ${row.plan_code}，不可反审核。继续？`, '审核', { type: 'warning' }) } catch { return }
  const r: any = await scmApi.auditPlanChange(row.id)
  if (r.code === 0) { ElMessage.success('变更已生效'); load() } else ElMessage.error(r.message || '审核失败')
}
async function del(row: any) {
  try { await ElMessageBox.confirm(`删除草稿变更单「${row.change_no}」？`, '提示', { type: 'warning' }) } catch { return }
  const r: any = await scmApi.deletePlanChange(row.id)
  if (r.code === 0) { ElMessage.success('已删除'); load() } else ElMessage.error(r.message || '删除失败')
}
onMounted(load)
onActivated(load)
</script>

<style scoped>
.pcl-page { display: flex; flex-direction: column; height: 100%; padding: var(--page-pad); gap: var(--block-gap); }
.filter-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.filter-row .title { font-weight: 600; }
.filter-row .hint { margin-left: auto; font-size: 12px; color: var(--el-text-color-secondary); }
</style>
