<template>
  <div class="page qc-form-page">
    <div class="qc-form-header">
      <div class="qc-form-header__left">
        <el-button link size="small" @click="goBack"><el-icon><ArrowLeft /></el-icon>返回</el-button>
        <span class="qc-form-header__sep">/</span>
        <span class="qc-form-header__title">{{ editId ? '编辑质检单' : '新增质检单' }}</span>
        <span v-if="form.qc_no" class="qc-form-header__meta">{{ form.qc_no }}</span>
        <el-tag v-if="editId" size="small" :type="form.status === 'audited' ? 'success' : 'info'" effect="plain">
          {{ form.status === 'audited' ? '已审核' : '草稿' }}
        </el-tag>
        <span class="qc-form-header__meta">不良合计 {{ num(defectTotal) }}</span>
      </div>
      <div class="qc-form-header__right">
        <SaveAsButton doc title="质检单" />
        <el-button size="small" @click="goBack">取消</el-button>
        <el-button type="primary" size="small" :loading="saving" :disabled="readonly" @click="handleSave">保存</el-button>
      </div>
    </div>

    <el-alert v-if="readonly" type="warning" :closable="false" show-icon
      title="该质检单已审核，不可修改；如需改动请先在列表页反审核" style="margin: 8px 16px 0;" />

    <div v-loading="loading" class="qc-form-body">
      <el-form :model="form" label-width="80px" size="small" :disabled="readonly">
        <el-row :gutter="16">
          <el-col :span="6"><el-form-item label="类型">
            <el-select v-model="form.qc_type" style="width:100%" @change="reloadStandards">
              <el-option label="到货检验(IQC)" value="IQC" />
              <el-option label="过程检验(IPQC)" value="IPQC" />
              <el-option label="完工检验(FQC)" value="FQC" />
            </el-select>
          </el-form-item></el-col>
          <el-col :span="6"><el-form-item label="检验日期">
            <el-date-picker v-model="form.qc_date" type="date" value-format="YYYY-MM-DD" style="width:100%" />
          </el-form-item></el-col>
          <el-col :span="6"><el-form-item label="判定">
            <el-select v-model="form.result" style="width:100%" @change="() => { form.qc_type && reloadStandards() }">
              <el-option label="合格" value="pass" />
              <el-option label="不合格" value="fail" />
              <el-option label="让步接收" value="concession" />
            </el-select>
            <div v-if="autoResult" class="qc-type-hint">按检验标准自动判定：<b :class="autoResult === 'fail' ? 'bad' : 'good'">{{ autoResult === 'pass' ? '合格' : autoResult === 'fail' ? '不合格' : '待检（有关键项未填）' }}</b>{{ autoResult === 'fail' && form.result === 'concession' ? '，已人工改判让步接收' : '（保存时以自动判定为准）' }}</div>
          </el-form-item></el-col>
          <el-col :span="6"><el-form-item label="检验员"><el-input v-model="form.inspector" /></el-form-item></el-col>

          <el-col v-if="form.qc_type === 'FQC'" :span="12"><el-form-item label="来源工单">
            <el-select v-model="form.source_doc_id" clearable filterable placeholder="选择工单（完工入库校验与不良品下推都靠它）"
              style="width:100%" @change="onPlanChange">
              <el-option v-for="p in plans" :key="p.id" :label="`${p.code} ${p.item_name || p.item_code}`" :value="p.id" />
            </el-select>
          </el-form-item></el-col>
          <el-col v-else :span="12"><el-form-item label="来源单号">
            <el-input v-model="form.source_doc_no" :placeholder="form.qc_type === 'IQC' ? '采购/委外入库单号（参数开启「入库须到货检验」时，入库单按此单号找合格 IQC）' : '来源单号，仅作记录'" />
            <div class="qc-type-hint">{{ form.qc_type === 'IQC' ? '到货检验：系统参数「入库须先到货检验」开启后，采购入库 / 委外入库单审核须有挂本单号、判定合格且合格数覆盖入库数的已审核 IQC。' : '过程检验：仅作质量记录，不拦截工序。' }}</div>
          </el-form-item></el-col>
          <el-col :span="12"><el-form-item label="备注"><el-input v-model="form.remark" placeholder="可留空" /></el-form-item></el-col>
        </el-row>
      </el-form>

      <div class="qc-lines-hd">
        <span>检验明细</span>
        <span class="qc-lines-hd__hint">不良数 = 检验数 − 合格数，自动计算</span>
        <el-button size="small" :disabled="readonly" @click="addLine"><el-icon><Plus /></el-icon>加行</el-button>
      </div>
      <div class="qc-lines">
        <el-table v-col-width="'scm_QcForm_1'" :data="form.lines" border stripe size="small" height="100%" row-key="_key">
          <el-table-column type="expand" width="36">
            <template #default="{ row }">
              <div class="qc-results">
                <div v-if="!row.results?.length" class="qc-results__empty">
                  该物料在「{{ typeLabel }}」下没有检验标准，本行按人工判定。<el-button link type="primary" size="small" @click="router.push({ path: '/scm/qc-standards/new', query: { item_code: row.item_code } })">去维护检验标准</el-button>
                </div>
                <el-table v-col-width="'scm_QcForm_2'" v-else :data="row.results" size="small" border>
                  <el-table-column label="检验项" prop="name" min-width="140" />
                  <el-table-column label="标准" min-width="160">
                    <template #default="{ row: r }">{{ standardText(r) }}<el-tag v-if="r.is_key" size="small" type="danger" effect="plain" style="margin-left:4px">关键</el-tag></template>
                  </el-table-column>
                  <el-table-column label="实测值" width="150">
                    <template #default="{ row: r }">
                      <el-input-number v-if="r.value_type === 'numeric'" v-model="r.value_num" :controls="false" size="small" :disabled="readonly" style="width:100%" @change="() => onResultChange(row)" />
                      <el-select v-else v-model="r.value_bool" size="small" :disabled="readonly" style="width:100%" clearable placeholder="未填" @change="() => onResultChange(row)">
                        <el-option label="合格" :value="1" /><el-option label="不合格" :value="0" />
                      </el-select>
                    </template>
                  </el-table-column>
                  <el-table-column label="判定" width="80" align="center">
                    <template #default="{ row: r }"><span :class="judgeItem(r) === false ? 'bad' : judgeItem(r) === true ? 'good' : 'text-muted'">{{ judgeItem(r) === null ? '待检' : judgeItem(r) ? '合格' : '不合格' }}</span></template>
                  </el-table-column>
                  <el-table-column label="备注" min-width="120"><template #default="{ row: r }"><el-input v-model="r.remark" size="small" :disabled="readonly" /></template></el-table-column>
                </el-table>
              </div>
            </template>
          </el-table-column>
          <el-table-column type="index" label="序号" width="60" align="center" />
          <el-table-column label="物料" min-width="180">
            <template #default="{ row }">
              <ItemPicker v-model="row.item_code" :disabled="readonly" @pick="(it:any) => { row.item_code = it.code; loadStandard(row) }" />
            </template>
          </el-table-column>
          <el-table-column label="抽样/允收" width="120" align="center">
            <template #default="{ row }"><span v-if="row._std" class="text-muted" :title="samplingText(row._std)">抽 {{ sampleOf(row) }} / 允 {{ row._std.accept_defects }}</span><span v-else class="text-muted">—</span></template>
          </el-table-column>
          <el-table-column label="行判定" width="80" align="center">
            <template #default="{ row }"><span :class="lineJudge(row) === false ? 'bad' : lineJudge(row) === true ? 'good' : 'text-muted'">{{ lineJudge(row) === null ? (row.results?.length ? '待检' : '人工') : lineJudge(row) ? '合格' : '不合格' }}</span></template>
          </el-table-column>
          <el-table-column label="批号" width="140">
            <template #default="{ row }"><el-input v-model="row.batch_no" size="small" :disabled="readonly" /></template>
          </el-table-column>
          <el-table-column label="检验数" width="120">
            <template #default="{ row }">
              <el-input-number v-model="row.inspect_qty" :min="0" :controls="false" size="small" style="width:100%"
                :disabled="readonly" @change="() => onQty(row)" />
            </template>
          </el-table-column>
          <el-table-column label="合格数" width="120">
            <template #default="{ row }">
              <el-input-number v-model="row.qualified_qty" :min="0" :controls="false" size="small" style="width:100%"
                :disabled="readonly" @change="() => onQty(row)" />
            </template>
          </el-table-column>
          <el-table-column label="不良数" width="100" align="right">
            <template #default="{ row }"><span :class="{ bad: row.defect_qty > 0 }">{{ num(row.defect_qty) }}</span></template>
          </el-table-column>
          <el-table-column label="不良原因" min-width="180">
            <template #default="{ row }">
              <el-input v-model="row.defect_reason" size="small" :disabled="readonly" placeholder="如 尺寸超差" />
            </template>
          </el-table-column>
          <el-table-column label="操作" width="70" align="center" fixed="right">
            <template #default="{ $index }">
              <el-button link type="danger" size="small" :disabled="readonly" @click="form.lines.splice($index, 1)">删除</el-button>
            </template>
          </el-table-column>
          <template #empty><div class="qc-empty">还没有检验行，点右上角「加行」开始</div></template>
        </el-table>
      </div>

      <div class="qc-hint">
        点行首箭头展开逐项检验结果（按「检验标准」自动载入，填实测值后自动判定；无标准的物料按人工判定）。
        完工检验(FQC) 选好来源工单后：参数「完工入库须质检」开启时，完工入库审核校验本单合格且合格数覆盖；到货检验(IQC) 同理对采购入库生效。
        本单审核后还可在列表页把不良数一键下推成不良品入库单(PS)。
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { todayStr } from '@/utils/format'
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeft, Plus } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { scmApi } from '@/api/scm'
import ItemPicker from '@/components/scm/ItemPicker.vue'

const route = useRoute()
const router = useRouter()
const editId = computed(() => (route.name === 'ScmQcEdit' ? String(route.params.id || '') : ''))

const loading = ref(false)
const saving = ref(false)
const plans = ref<any[]>([])
const form = reactive<any>({
  qc_no: '', qc_type: 'IQC', qc_date: todayStr(), result: 'pass',
  source_doc_type: '', source_doc_id: '', source_doc_no: '', inspector: '', remark: '', status: 'draft', lines: [],
})

const readonly = computed(() => form.status === 'audited')
const num = (v: any) => (Number(v) || 0).toLocaleString('zh-CN', { maximumFractionDigits: 6 })
const defectTotal = computed(() => form.lines.reduce((s: number, l: any) => s + (Number(l.defect_qty) || 0), 0))

function goBack() { router.push({ name: 'ScmQc' }) }
function onQty(row: any) {
  row.defect_qty = Math.max(0, Math.round(((Number(row.inspect_qty) || 0) - (Number(row.qualified_qty) || 0)) * 1000) / 1000)
}
let lineKey = 0
function addLine() { form.lines.push({ _key: ++lineKey, item_code: '', batch_no: '', inspect_qty: 0, qualified_qty: 0, defect_qty: 0, defect_reason: '', results: [], _std: null }) }

// ── 检验标准 / 逐项结果 / 判定（与服务端 scmQcStandard 同规则的前端预判） ──
const typeLabel = computed(() => ({ IQC: '到货检验', IPQC: '过程检验', FQC: '完工检验' } as Record<string, string>)[form.qc_type] || form.qc_type)
function standardText(r: any) {
  if (r.value_type === 'bool') return '判定：合格/不合格'
  const lo = r.lower_limit ?? null, hi = r.upper_limit ?? null
  const range = lo != null && hi != null ? `${lo} ~ ${hi}` : lo != null ? `≥ ${lo}` : hi != null ? `≤ ${hi}` : '不限'
  return `${range}${r.unit ? ' ' + r.unit : ''}${r.target != null ? `（目标 ${r.target}）` : ''}`
}
function samplingText(s: any) { return s.sampling_mode === 'percent' ? `按比例 ${s.sampling_value}%（最少 ${s.min_sample}）` : s.sampling_mode === 'fixed' ? `固定 ${s.sampling_value} 件` : '全检' }
function sampleOf(row: any) {
  const s = row._std; const q = Number(row.inspect_qty) || 0
  if (!s || q <= 0) return q
  let n = q
  if (s.sampling_mode === 'percent') n = Math.ceil(q * (Number(s.sampling_value) || 100) / 100)
  else if (s.sampling_mode === 'fixed') n = Number(s.sampling_value) || q
  return Math.min(q, Math.max(Math.min(q, Math.max(1, Number(s.min_sample) || 1)), n))
}
function judgeItem(r: any): boolean | null {
  if (r.value_type === 'bool') return r.value_bool == null || r.value_bool === '' ? null : Number(r.value_bool) === 1
  if (r.value_num == null || r.value_num === '' || !Number.isFinite(Number(r.value_num))) return null
  const v = Number(r.value_num)
  if (r.lower_limit != null && v < Number(r.lower_limit) - 1e-9) return false
  if (r.upper_limit != null && v > Number(r.upper_limit) + 1e-9) return false
  return true
}
function lineJudge(row: any): boolean | null {
  const results = row.results || []
  if (!results.length) return null
  let pending = false
  for (const r of results) {
    const p = judgeItem(r)
    if (p === null) { if (r.is_key) pending = true; continue }
    if (!p && r.is_key) return false
  }
  if ((Number(row.defect_qty) || 0) > (Number(row._std?.accept_defects) || 0)) return false
  return pending ? null : true
}
const autoResult = computed<'pass' | 'fail' | null | 'pending'>(() => {
  let judged = false
  for (const l of form.lines) {
    if (!l.results?.length) continue
    judged = true
    const j = lineJudge(l)
    if (j === false) return 'fail'
    if (j === null) return 'pending'
  }
  return judged ? 'pass' : null
})
function onResultChange(_row: any) { /* 触发响应式重算即可 */ }
/** 按物料 + 检验类型载入标准：生成逐项结果行（保留已填的实测值） */
async function loadStandard(row: any) {
  if (!row.item_code) { row.results = []; row._std = null; return }
  try {
    const r = await scmApi.resolveQcStandard({ item_code: row.item_code, qc_type: form.qc_type, qty: Number(row.inspect_qty) || 0 })
    if (r.code !== 0 || !r.data) { row._std = null; row.results = []; return }
    const std = r.data
    row._std = { sampling_mode: std.sampling_mode, sampling_value: std.sampling_value, min_sample: std.min_sample, accept_defects: std.accept_defects }
    const old = new Map((row.results || []).map((x: any) => [x.standard_item_id || x.name, x]))
    row.results = (std.items || []).map((it: any, i: number) => {
      const prev: any = old.get(it.id) || old.get(it.name)
      return { standard_item_id: it.id, seq: i + 1, name: it.name, value_type: it.value_type, target: it.target, lower_limit: it.lower_limit, upper_limit: it.upper_limit, unit: it.unit, is_key: it.is_key,
        value_num: prev?.value_num ?? null, value_bool: prev?.value_bool ?? null, remark: prev?.remark || '' }
    })
  } catch { row._std = null }
}
async function reloadStandards() { for (const l of form.lines) if (l.item_code) await loadStandard(l) }
function onPlanChange(planId: string) {
  const plan = plans.value.find(p => p.id === planId)
  form.source_doc_type = planId ? 'production_plan' : ''
  form.source_doc_no = plan?.code || ''
}

async function init() {
  loading.value = true
  try {
    const pl = await scmApi.getProductionPlans()
    if (pl.code === 0) plans.value = pl.data
    if (editId.value) {
      const r = await scmApi.getQcDoc(editId.value)
      if (r.code !== 0) { ElMessage.error('质检单不存在'); return goBack() }
      Object.assign(form, { ...r.data, lines: ((r.data as any).lines || []).map((l: any) => ({ ...l, _key: ++lineKey, results: l.results || [], _std: l.accept_defects != null ? { sampling_mode: 'full', sampling_value: 0, min_sample: 1, accept_defects: l.accept_defects } : null })) })
      for (const l of form.lines) if (l.item_code && !l.results.length) await loadStandard(l)
    } else {
      const type = String(route.query.qc_type || 'IQC')
      form.qc_type = ['IQC', 'IPQC', 'FQC'].includes(type) ? type : 'IQC'
      const no = await scmApi.getQcNextNo(form.qc_type)
      if (no.code === 0) form.qc_no = no.data.next_no
      addLine()
    }
  } finally { loading.value = false }
}

async function handleSave() {
  const lines = form.lines.filter((l: any) => l.item_code)
  if (!lines.length) return ElMessage.warning('请至少录入一行检验物料')
  if (form.qc_type === 'FQC' && !form.source_doc_id) {
    return ElMessage.warning('完工检验请选择来源工单，否则无法与完工入库、不良品下推联动')
  }
  saving.value = true
  try {
    const payload = { ...form, lines: lines.map((l: any) => ({ ...l, results: (l.results || []).map((r: any) => ({ ...r })) })) }
    const res: any = editId.value ? await scmApi.updateQcDoc(editId.value, payload) : await scmApi.createQcDoc(payload)
    if (res.code !== 0) return ElMessage.error(res.message || '保存失败')
    ElMessage.success('已保存')
    goBack()
  } finally { saving.value = false }
}

onMounted(init)
</script>

<style scoped>
.qc-type-hint { font-size: 12px; color: var(--el-text-color-secondary); line-height: 1.5; margin-top: 2px; }
.qc-form-page { display: flex; flex-direction: column; height: 100%; }
.qc-form-header { display: flex; align-items: center; justify-content: space-between; padding: 8px 16px; border-bottom: 1px solid var(--el-border-color-lighter); }
.qc-form-header__left { display: flex; align-items: center; gap: 8px; }
.qc-form-header__sep { color: var(--el-text-color-placeholder); }
.qc-form-header__title { font-weight: 600; }
.qc-form-header__meta { font-size: 12px; color: var(--el-text-color-secondary); }
.qc-form-header__right { display: flex; gap: 8px; }
.qc-form-body { flex: 1; min-height: 0; display: flex; flex-direction: column; padding: 12px 16px; gap: 6px; }
.qc-lines-hd { display: flex; align-items: center; gap: 12px; font-weight: 600; font-size: var(--cw-text-base); }
.qc-lines-hd__hint { margin-left: auto; font-weight: 400; font-size: 12px; color: var(--el-text-color-secondary); }
.qc-lines { flex: 1; min-height: 200px; }
.qc-empty { padding: 24px 0; color: var(--el-text-color-secondary); font-size: var(--cw-text-base); }
.qc-hint { font-size: 12px; color: var(--el-text-color-secondary); line-height: 1.6; }
.bad { color: var(--el-color-danger); font-weight: 600; }
.good { color: var(--el-color-success); font-weight: 600; }
.qc-results { padding: 6px 12px 6px 40px; }
.qc-results__empty { font-size: 12px; color: var(--el-text-color-secondary); }
</style>
