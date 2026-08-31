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

    <el-dialog v-model="dlg" :title="form.id ? '编辑报工' : '新增报工'" width="480px">
      <el-form :model="form" label-width="90px" size="small">
        <el-form-item label="成品">
          <el-select v-model="form.product_id" placeholder="选择成品" style="width:100%" @change="onProduct">
            <el-option v-for="p in products" :key="p.id" :label="`${p.item_code} ${p.item_name || ''} (计划${p.plan_qty})`" :value="p.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="工序"><el-input v-model="form.process_name" placeholder="如 总装/焊接" /></el-form-item>
        <el-form-item label="工作中心">
          <el-select v-model="form.work_center_code" placeholder="选择工作中心" style="width:100%" @change="calcPreview">
            <el-option v-for="w in workCenters" :key="w.code" :label="`${w.name}（人工${w.labor_rate}/制费${w.overhead_rate}）`" :value="w.code" />
          </el-select>
        </el-form-item>
        <el-form-item label="工时"><el-input-number v-model="form.work_hours" :min="0" :controls="false" style="width:140px" @change="calcPreview" /> 工时</el-form-item>
        <el-form-item label="合格数"><el-input-number v-model="form.qty" :min="0" :controls="false" style="width:140px" /></el-form-item>
        <el-form-item label="不良数"><el-input-number v-model="form.scrap_qty" :min="0" :controls="false" style="width:140px" /></el-form-item>
        <el-form-item label="日期"><el-date-picker v-model="form.report_date" type="date" value-format="YYYY-MM-DD" style="width:160px" /></el-form-item>
        <el-form-item label="预览"><span class="preview">人工 {{ fmt(preview.labor) }}　制费 {{ fmt(preview.overhead) }}</span></el-form-item>
      </el-form>
      <template #footer><el-button @click="dlg = false">取消</el-button><el-button type="primary" :loading="saving" @click="save">保存</el-button></template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { Plus } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { scmApi } from '@/api/scm'

const plans = ref<any[]>([])
const planId = ref('')
const rows = ref<any[]>([])
const products = ref<any[]>([])
const workCenters = ref<any[]>([])
const loading = ref(false)
const dlg = ref(false)
const saving = ref(false)
const form = reactive<any>({ id: '', product_id: '', item_code: '', process_name: '', work_center_code: '', work_hours: 0, qty: 0, scrap_qty: 0, report_date: '' })
const preview = reactive({ labor: 0, overhead: 0 })

const fmt = (v: any) => (Number(v) || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const statusName = (s: string) => ({ draft: '草稿', released: '已审核', closed: '已关闭' } as any)[s] || s
const sum = (k: string) => rows.value.reduce((s, r) => s + (Number(r[k]) || 0), 0)
const sumAmt = (k: string) => Math.round(rows.value.reduce((s, r) => s + (Number(r[k]) || 0), 0) * 100) / 100

async function loadPlans() {
  const r = await scmApi.getProductionPlans(); if (r.code === 0) plans.value = r.data
}
async function loadWorkCenters() {
  const r = await scmApi.getWorkCenters(); if (r.code === 0) workCenters.value = r.data.filter((w: any) => w.enabled !== 0)
}
async function onPlan() {
  if (!planId.value) return
  loading.value = true
  try {
    const r = await scmApi.getWorkReports({ plan_id: planId.value }); if (r.code === 0) rows.value = r.data
    const pd = await scmApi.getProductionPlan(planId.value); if (pd.code === 0) products.value = (pd.data as any).products || []
  } finally { loading.value = false }
}
function calcPreview() {
  const wc = workCenters.value.find(w => w.code === form.work_center_code)
  const h = Number(form.work_hours) || 0
  preview.labor = Math.round(h * (Number(wc?.labor_rate) || 0) * 100) / 100
  preview.overhead = Math.round(h * (Number(wc?.overhead_rate) || 0) * 100) / 100
}
function onProduct() { const p = products.value.find(x => x.id === form.product_id); form.item_code = p?.item_code || '' }
function openAdd() {
  Object.assign(form, { id: '', product_id: products.value[0]?.id || '', item_code: products.value[0]?.item_code || '', process_name: '', work_center_code: '', work_hours: 0, qty: 0, scrap_qty: 0, report_date: new Date().toISOString().slice(0, 10) })
  calcPreview(); dlg.value = true
}
function openEdit(row: any) { Object.assign(form, { ...row }); calcPreview(); dlg.value = true }
async function save() {
  if (!form.work_center_code) return ElMessage.warning('请选择工作中心')
  saving.value = true
  try {
    const payload = { ...form, plan_id: planId.value }
    if (form.id) await scmApi.updateWorkReport(form.id, payload)
    else await scmApi.createWorkReport(payload)
    ElMessage.success('已保存'); dlg.value = false; onPlan()
  } finally { saving.value = false }
}
async function audit(row: any) { await scmApi.auditWorkReport(row.id); ElMessage.success('已审核'); onPlan() }
async function unaudit(row: any) {
  const r = await scmApi.unauditWorkReport(row.id) as any
  if (r.code === 0) { ElMessage.success('已反审核'); onPlan() } else ElMessage.error(r.message || '反审核失败')
}
async function del(row: any) {
  await ElMessageBox.confirm(`确认删除报工单「${row.report_no}」？`, '提示', { type: 'warning' })
  await scmApi.deleteWorkReport(row.id); ElMessage.success('已删除'); onPlan()
}
onMounted(() => { loadPlans(); loadWorkCenters() })
</script>

<style scoped>
.wr-page { display: flex; flex-direction: column; height: 100%; padding: 12px 16px; gap: 8px; }
.filter-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.filter-row .title { font-weight: 600; }
.filter-row .hint { margin-left: auto; font-size: 13px; color: var(--el-text-color-secondary); }
.preview { color: var(--el-color-success); font-weight: 600; }
</style>
