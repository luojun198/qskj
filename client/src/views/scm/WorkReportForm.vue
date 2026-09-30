<template>
  <div class="page wr-form-page">
    <div class="wr-form-header">
      <div class="wr-form-header__left">
        <el-button link size="small" @click="goBack"><el-icon><ArrowLeft /></el-icon>返回</el-button>
        <span class="wr-form-header__sep">/</span>
        <span class="wr-form-header__title">{{ editId ? '编辑报工' : '新增报工' }}</span>
        <span v-if="planCode" class="wr-form-header__meta">工单 {{ planCode }}</span>
        <span v-if="form.report_no" class="wr-form-header__meta">{{ form.report_no }}</span>
      </div>
      <div class="wr-form-header__right">
        <el-button size="small" @click="goBack">取消</el-button>
        <el-button type="primary" size="small" :loading="saving" @click="handleSave">保存</el-button>
      </div>
    </div>

    <div v-loading="loading" class="wr-form-body">
      <el-form :model="form" label-width="90px" size="small">
        <el-row :gutter="16">
          <el-col :span="8">
            <el-form-item label="成品">
              <el-select v-model="form.product_id" placeholder="选择成品" style="width:100%" @change="onProduct">
                <el-option v-for="p in products" :key="p.id"
                  :label="`${p.item_code} ${p.item_name || ''}（计划 ${p.plan_qty}）`" :value="p.id" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="工序">
              <el-select v-model="form.process_name" filterable allow-create default-first-option
                placeholder="选择或直接输入工序" style="width:100%" @change="onProcess">
                <el-option v-for="p in processOptions" :key="p.process_name" :label="p.label" :value="p.process_name" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="工作中心">
              <el-select v-model="form.work_center_code" filterable placeholder="选择工作中心" style="width:100%">
                <el-option v-for="w in workCenters" :key="w.code"
                  :label="`${w.name}（人工 ${w.labor_rate}/工时，制费 ${w.overhead_rate}/工时）`" :value="w.code" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="6"><el-form-item label="工时">
            <el-input-number v-model="form.work_hours" :min="0" :precision="2" :controls="false" style="width:100%" />
          </el-form-item></el-col>
          <el-col :span="6"><el-form-item label="合格数">
            <el-input-number v-model="form.qty" :min="0" :precision="6" :controls="false" style="width:100%" />
          </el-form-item></el-col>
          <el-col :span="6"><el-form-item label="不良数">
            <el-input-number v-model="form.scrap_qty" :min="0" :precision="6" :controls="false" style="width:100%" />
          </el-form-item></el-col>
          <el-col :span="6"><el-form-item label="报工日期">
            <el-date-picker v-model="form.report_date" type="date" value-format="YYYY-MM-DD" style="width:100%" />
          </el-form-item></el-col>
          <el-col :span="24"><el-form-item label="备注">
            <el-input v-model="form.remark" placeholder="可留空" />
          </el-form-item></el-col>
        </el-row>
      </el-form>

      <div class="wr-cards">
        <div><span>人工金额</span><b>{{ fmt(preview.labor) }}</b><i>工时 × 人工费率</i></div>
        <div><span>制造费用</span><b>{{ fmt(preview.overhead) }}</b><i>工时 × 制费费率</i></div>
        <div :class="{ 'is-warn': overQuota }">
          <span>本成品{{ form.process_name ? `「${form.process_name}」工序` : '' }}累计（含本次）</span>
          <b>{{ num(reportedWithCurrent) }}</b>
          <i>计划 {{ num(currentPlanQty) }}，已报 {{ num(reportedForProduct) }}<template v-if="prevProcessDone">；前道「{{ prevProcessDone.name }}」已完成 {{ num(prevProcessDone.done) }}</template></i>
        </div>
      </div>

      <el-alert v-if="overQuota" type="warning" show-icon :closable="false"
        title="该工序 合格数 + 不良数 已超过该成品的计划数，保存时会被后端拦截（可在 系统参数 → 供应链 打开生产超额策略放宽）" />

      <div class="wr-hint">
        人工与制费在保存时按「工时 × 工作中心费率」算好存库；完工入库审核时按各成品报工进度分批结转进成品成本。<br>
        报工数量按「成品 × 工序」分别与计划数比对（多道工序各报一次不算超报）；完工入库默认数取末道工序的已审核合格数。
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { todayStr } from '@/utils/format'
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeft } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { scmApi } from '@/api/scm'

const route = useRoute()
const router = useRouter()
const editId = computed(() => (route.name === 'ScmWorkReportEdit' ? String(route.params.id || '') : ''))
const planId = ref(String(route.query.plan_id || ''))

const loading = ref(false)
const saving = ref(false)
const planCode = ref('')
const products = ref<any[]>([])
const workCenters = ref<any[]>([])
const routingLines = ref<any[]>([])
const existingReports = ref<any[]>([])
const form = reactive<any>({
  id: '', report_no: '', product_id: '', item_code: '', process_name: '', work_center_code: '',
  work_hours: 0, qty: 0, scrap_qty: 0, report_date: todayStr(), remark: '',
})

const fmt = (v: any) => (Number(v) || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const num = (v: any) => (Number(v) || 0).toLocaleString('zh-CN', { maximumFractionDigits: 6 })

const preview = computed(() => {
  const wc = workCenters.value.find(w => w.code === form.work_center_code)
  const h = Number(form.work_hours) || 0
  return {
    labor: Math.round(h * (Number(wc?.labor_rate) || 0) * 100) / 100,
    overhead: Math.round(h * (Number(wc?.overhead_rate) || 0) * 100) / 100,
  }
})
const currentPlanQty = computed(() => Number(products.value.find(p => p.id === form.product_id)?.plan_qty) || 0)
/** 该成品**同一工序**已报工（含草稿占用）合计，编辑时排除自己——与后端 validateWorkReportQty 同口径（P1-1） */
const procKey = (v: any) => String(v ?? '').trim()
const reportedForProduct = computed(() => existingReports.value
  .filter(r => r.product_id === form.product_id && r.id !== editId.value && procKey(r.process_name) === procKey(form.process_name))
  .reduce((sum, r) => sum + (Number(r.qty) || 0) + (Number(r.scrap_qty) || 0), 0))
const reportedWithCurrent = computed(() =>
  reportedForProduct.value + (Number(form.qty) || 0) + (Number(form.scrap_qty) || 0))
const overQuota = computed(() =>
  currentPlanQty.value > 0 && reportedWithCurrent.value > currentPlanQty.value + 1e-6)

/** 工序下拉：优先取工单下达时快照的工序行（带完成进度，C-2）；无工序行时退回成品工艺路线；选中后带出工作中心与标准工时 */
const planProcesses = ref<any[]>([])
const productProcesses = computed(() => planProcesses.value.filter(x => x.product_id === form.product_id))
const processOptions = computed(() => productProcesses.value.length
  ? productProcesses.value.map(x => ({
      process_name: x.process_name,
      label: `${x.seq}. ${x.process_name}${x.work_center_name ? ' · ' + x.work_center_name : ''}${x.std_hours ? ' · 标准 ' + x.std_hours + ' 工时' : ''} · 完成 ${num(x.done_qty)}/${num(x.plan_qty)}${Number(x.scrap_qty) ? ' 不良 ' + num(x.scrap_qty) : ''}`,
    }))
  : routingLines.value.map(l => ({
      process_name: l.process_name,
      label: `${l.process_name}${l.work_center_name ? ' · ' + l.work_center_name : ''}${l.std_hours ? ' · 标准 ' + l.std_hours + ' 工时' : ''}`,
    })))
/** 前道工序已审核完成数（流转上限提示） */
const prevProcessDone = computed(() => {
  const cur = productProcesses.value.find(x => x.process_name === String(form.process_name || '').trim())
  if (!cur || cur.seq <= 1) return null
  const prev = productProcesses.value.filter(x => x.seq < cur.seq).sort((a, b) => b.seq - a.seq)[0]
  return prev ? { name: prev.process_name, done: Number(prev.done_qty) || 0 } : null
})

function goBack() { router.push({ name: 'ScmWorkReport', query: planId.value ? { plan_id: planId.value } : {} }) }
function onProduct() {
  const p = products.value.find(x => x.id === form.product_id)
  form.item_code = p?.item_code || ''
  loadRouting()
}
function onProcess(name: string) {
  const line = productProcesses.value.find(x => x.process_name === name) || routingLines.value.find(l => l.process_name === name)
  if (!line) return
  if (!form.work_center_code) form.work_center_code = line.work_center_code || ''
  if (!Number(form.work_hours)) form.work_hours = Number(line.std_hours) || 0
}

async function loadRouting() {
  routingLines.value = []
  if (!form.item_code) return
  const r = await scmApi.getRoutings({ item_code: form.item_code })
  const active = (r.data || []).find((x: any) => x.status === 'active') || (r.data || [])[0]
  if (!active) return
  const detail = await scmApi.getRouting(active.id)
  if (detail.code === 0) routingLines.value = (detail.data as any).lines || []
}

async function init() {
  loading.value = true
  try {
    const [wc] = await Promise.all([scmApi.getWorkCenters()])
    if (wc.code === 0) workCenters.value = wc.data.filter((w: any) => w.enabled !== 0)

    if (editId.value) {
      const one = await scmApi.getWorkReport(editId.value)
      const row = one.code === 0 ? one.data : null
      if (!row) { ElMessage.error('报工单不存在'); return goBack() }
      if (row.status === 'audited') { ElMessage.warning('已审核报工不可修改'); return goBack() }
      planId.value = row.plan_id
      Object.assign(form, row)
    }
    if (!planId.value) { ElMessage.warning('请先选择工单'); return goBack() }

    const pd = await scmApi.getProductionPlan(planId.value)
    if (pd.code === 0) {
      planCode.value = (pd.data as any).code || ''
      products.value = (pd.data as any).products || []
      planProcesses.value = (pd.data as any).processes || []
      if (!form.product_id) form.product_id = products.value[0]?.id || ''
    }
    const reports = await scmApi.getWorkReports({ plan_id: planId.value })
    if (reports.code === 0) existingReports.value = reports.data
    onProduct()
  } finally { loading.value = false }
}

watch(() => form.product_id, () => { const p = products.value.find(x => x.id === form.product_id); form.item_code = p?.item_code || '' })

async function handleSave() {
  if (!form.product_id) return ElMessage.warning('请选择成品')
  if (!form.work_center_code) return ElMessage.warning('请选择工作中心（人工/制费按其费率计算）')
  if (!(Number(form.qty) > 0 || Number(form.scrap_qty) > 0)) return ElMessage.warning('合格数与不良数不能同时为 0')
  saving.value = true
  try {
    const payload = { ...form, plan_id: planId.value }
    const res: any = editId.value
      ? await scmApi.updateWorkReport(editId.value, payload)
      : await scmApi.createWorkReport(payload)
    if (res.code !== 0) return ElMessage.error(res.message || '保存失败')
    ElMessage.success('已保存')
    goBack()
  } finally { saving.value = false }
}

onMounted(init)
</script>

<style scoped>
.wr-form-page { display: flex; flex-direction: column; height: 100%; }
.wr-form-header { display: flex; align-items: center; justify-content: space-between; padding: 8px 16px; border-bottom: 1px solid var(--el-border-color-lighter); }
.wr-form-header__left { display: flex; align-items: center; gap: 8px; }
.wr-form-header__sep { color: var(--el-text-color-placeholder); }
.wr-form-header__title { font-weight: 600; }
.wr-form-header__meta { font-size: 12px; color: var(--el-text-color-secondary); }
.wr-form-header__right { display: flex; gap: 8px; }
.wr-form-body { flex: 1; min-height: 0; overflow: auto; padding: 12px 16px; display: flex; flex-direction: column; gap: 10px; }
.wr-cards { display: grid; grid-template-columns: repeat(3, minmax(180px, 320px)); gap: 10px; }
.wr-cards > div { padding: 10px 14px; border: 1px solid var(--el-border-color-light); border-radius: 8px; }
.wr-cards > div.is-warn { border-color: var(--el-color-warning-light-5); }
.wr-cards span { display: block; font-size: 12px; color: var(--el-text-color-secondary); }
.wr-cards b { font-size: 20px; }
.wr-cards i { display: block; font-style: normal; font-size: 12px; color: var(--el-text-color-secondary); }
.wr-hint { font-size: 12px; color: var(--el-text-color-secondary); line-height: 1.6; }
</style>
