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
            <el-select v-model="form.qc_type" style="width:100%">
              <el-option label="到货检验(IQC)" value="IQC" />
              <el-option label="过程检验(IPQC)" value="IPQC" />
              <el-option label="完工检验(FQC)" value="FQC" />
            </el-select>
          </el-form-item></el-col>
          <el-col :span="6"><el-form-item label="检验日期">
            <el-date-picker v-model="form.qc_date" type="date" value-format="YYYY-MM-DD" style="width:100%" />
          </el-form-item></el-col>
          <el-col :span="6"><el-form-item label="判定">
            <el-select v-model="form.result" style="width:100%">
              <el-option label="合格" value="pass" />
              <el-option label="不合格" value="fail" />
              <el-option label="让步接收" value="concession" />
            </el-select>
          </el-form-item></el-col>
          <el-col :span="6"><el-form-item label="检验员"><el-input v-model="form.inspector" /></el-form-item></el-col>

          <el-col v-if="form.qc_type === 'FQC'" :span="12"><el-form-item label="来源工单">
            <el-select v-model="form.source_doc_id" clearable filterable placeholder="选择工单（完工入库校验与不良品下推都靠它）"
              style="width:100%" @change="onPlanChange">
              <el-option v-for="p in plans" :key="p.id" :label="`${p.code} ${p.item_name || p.item_code}`" :value="p.id" />
            </el-select>
          </el-form-item></el-col>
          <el-col v-else :span="12"><el-form-item label="来源单号">
            <el-input v-model="form.source_doc_no" placeholder="采购入库单号等（仅作记录）" />
            <div class="qc-type-hint">{{ form.qc_type === 'IQC' ? '来料检验' : '过程检验' }}目前为<b>质量记录</b>：不校验检验项/抽样方案，不拦截入库或工序；只有 FQC 参与完工入库校验与不良品下推。</div>
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
        <el-table :data="form.lines" border stripe size="small" height="100%">
          <el-table-column type="index" label="序号" width="60" align="center" />
          <el-table-column label="物料" min-width="180">
            <template #default="{ row }">
              <ItemPicker v-model="row.item_code" :disabled="readonly" @pick="(it:any) => { row.item_code = it.code }" />
            </template>
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
        完工检验(FQC) 选好来源工单后：系统参数开启「完工入库须质检」时，该工单的完工入库审核会校验本单是否判定合格并已审核；
        本单审核后还可在列表页把不良数一键下推成不良品入库单(PS)。
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
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
  qc_no: '', qc_type: 'IQC', qc_date: new Date().toISOString().slice(0, 10), result: 'pass',
  source_doc_type: '', source_doc_id: '', source_doc_no: '', inspector: '', remark: '', status: 'draft', lines: [],
})

const readonly = computed(() => form.status === 'audited')
const num = (v: any) => (Number(v) || 0).toLocaleString('zh-CN', { maximumFractionDigits: 6 })
const defectTotal = computed(() => form.lines.reduce((s: number, l: any) => s + (Number(l.defect_qty) || 0), 0))

function goBack() { router.push({ name: 'ScmQc' }) }
function onQty(row: any) {
  row.defect_qty = Math.max(0, Math.round(((Number(row.inspect_qty) || 0) - (Number(row.qualified_qty) || 0)) * 1000) / 1000)
}
function addLine() { form.lines.push({ item_code: '', batch_no: '', inspect_qty: 0, qualified_qty: 0, defect_qty: 0, defect_reason: '' }) }
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
      Object.assign(form, { ...r.data, lines: (r.data as any).lines || [] })
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
    const payload = { ...form, lines }
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
</style>
