<template>
  <div class="page wr-page">
    <div class="filter-row">
      <span class="title">生产报工</span>
      <el-select v-model="planId" filterable placeholder="选择工单" style="width:280px" size="small" @change="onPlan">
        <el-option v-for="p in plans" :key="p.id" :label="`${p.code}  ${p.item_name || p.item_code}  (${statusName(p.status)})`" :value="p.id" />
      </el-select>
      <el-button type="primary" size="small" :disabled="!planId" @click="openAdd"><el-icon><Plus /></el-icon>新增报工</el-button>
      <span class="hint" v-if="planId">合格合计 <b>{{ sum('qty') }}</b>　不良 <b>{{ sum('scrap_qty') }}</b>　人工 <b>{{ fmt(sumAmt('labor_amount')) }}</b>　制费 <b>{{ fmt(sumAmt('overhead_amount')) }}</b></span>
    </div>

    <el-empty v-if="!planId" description="请选择工单后报工" />
    <el-table v-else :data="rows" v-loading="loading" border stripe size="small" height="100%">
      <el-table-column label="报工单号" prop="report_no" width="140" />
      <el-table-column label="日期" prop="report_date" width="110" />
      <el-table-column label="成品" min-width="120" show-overflow-tooltip><template #default="{ row }">{{ row.item_code }}</template></el-table-column>
      <el-table-column label="工序" prop="process_name" width="110" />
      <el-table-column label="工作中心" prop="work_center_name" width="120" show-overflow-tooltip />
      <el-table-column label="工时" prop="work_hours" width="80" align="right" />
      <el-table-column label="合格" prop="qty" width="80" align="right" />
      <el-table-column label="不良" prop="scrap_qty" width="70" align="right" />
      <el-table-column label="人工" width="100" align="right"><template #default="{ row }">{{ fmt(row.labor_amount) }}</template></el-table-column>
      <el-table-column label="制费" width="100" align="right"><template #default="{ row }">{{ fmt(row.overhead_amount) }}</template></el-table-column>
      <el-table-column label="状态" width="80" align="center">
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

  </div>
</template>

<script setup lang="ts">
import { onActivated, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Plus } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { scmApi } from '@/api/scm'

const route = useRoute()
const router = useRouter()
const plans = ref<any[]>([])
const planId = ref(String(route.query.plan_id || ''))
const rows = ref<any[]>([])
const loading = ref(false)

const fmt = (v: any) => (Number(v) || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const statusName = (s: string) => ({ draft: '草稿', released: '已审核', closed: '已关闭' } as any)[s] || s
const sum = (k: string) => rows.value.reduce((s, r) => s + (Number(r[k]) || 0), 0)
const sumAmt = (k: string) => Math.round(rows.value.reduce((s, r) => s + (Number(r[k]) || 0), 0) * 100) / 100

async function loadPlans() {
  const r = await scmApi.getProductionPlans(); if (r.code === 0) plans.value = r.data
}
async function onPlan() {
  if (!planId.value) { rows.value = []; return }
  // 记在地址栏里，从报工表单返回时能回到同一张工单
  router.replace({ name: 'ScmWorkReport', query: { plan_id: planId.value } })
  loading.value = true
  try {
    const r = await scmApi.getWorkReports({ plan_id: planId.value }); if (r.code === 0) rows.value = r.data
  } finally { loading.value = false }
}
function openAdd() { router.push({ name: 'ScmWorkReportNew', query: { plan_id: planId.value } }) }
function openEdit(row: any) { router.push({ name: 'ScmWorkReportEdit', params: { id: row.id } }) }
async function audit(row: any) {
  const r = await scmApi.auditWorkReport(row.id) as any
  if (r.code === 0) { ElMessage.success('已审核'); onPlan() } else ElMessage.error(r.message || '审核失败')
}
async function unaudit(row: any) {
  const r = await scmApi.unauditWorkReport(row.id) as any
  if (r.code === 0) { ElMessage.success('已反审核'); onPlan() } else ElMessage.error(r.message || '反审核失败')
}
async function del(row: any) {
  await ElMessageBox.confirm(`确认删除报工单「${row.report_no}」？`, '提示', { type: 'warning' })
  await scmApi.deleteWorkReport(row.id); ElMessage.success('已删除'); onPlan()
}
onMounted(async () => { await loadPlans(); if (planId.value) onPlan() })
// 从报工表单返回时刷新（keep-alive 下 onMounted 不会重跑）
onActivated(() => { if (planId.value) onPlan() })
</script>

<style scoped>
.wr-page { display: flex; flex-direction: column; height: 100%; padding: 12px 16px; gap: 8px; }
.filter-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.filter-row .title { font-weight: 600; }
.filter-row .hint { margin-left: auto; font-size: var(--cw-text-base); color: var(--el-text-color-secondary); }
</style>
