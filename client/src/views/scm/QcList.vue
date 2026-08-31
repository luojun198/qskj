<template>
  <div class="page qc-page">
    <div class="filter-row">
      <span class="title">质检管理</span>
      <el-radio-group v-model="qcType" size="small" @change="load">
        <el-radio-button value="">全部</el-radio-button>
        <el-radio-button value="IQC">到货检验</el-radio-button>
        <el-radio-button value="IPQC">过程检验</el-radio-button>
        <el-radio-button value="FQC">完工检验</el-radio-button>
      </el-radio-group>
      <el-button type="primary" size="small" @click="openAdd"><el-icon><Plus /></el-icon>新增质检单</el-button>
    </div>
    <el-table :data="rows" v-loading="loading" border stripe size="small" height="100%">
      <el-table-column label="质检单号" prop="qc_no" width="140" />
      <el-table-column label="类型" width="90" align="center"><template #default="{ row }">{{ qcTypeName(row.qc_type) }}</template></el-table-column>
      <el-table-column label="日期" prop="qc_date" width="110" />
      <el-table-column label="来源单据" min-width="140" show-overflow-tooltip><template #default="{ row }">{{ row.source_doc_no || '—' }}</template></el-table-column>
      <el-table-column label="供应商" min-width="120" show-overflow-tooltip><template #default="{ row }">{{ row.partner_name || '' }}</template></el-table-column>
      <el-table-column label="判定" width="100" align="center">
        <template #default="{ row }"><el-tag size="small" :type="resultTag(row.result)" effect="plain">{{ resultName(row.result) }}</el-tag></template>
      </el-table-column>
      <el-table-column label="不良合计" width="90" align="right"><template #default="{ row }"><span :class="{ bad: row.defect_total > 0 }">{{ row.defect_total }}</span></template></el-table-column>
      <el-table-column label="检验员" prop="inspector" width="100" />
      <el-table-column label="状态" width="80" align="center"><template #default="{ row }"><el-tag size="small" :type="row.status === 'audited' ? 'success' : 'info'" effect="plain">{{ row.status === 'audited' ? '已审核' : '草稿' }}</el-tag></template></el-table-column>
      <el-table-column label="操作" width="160" align="center">
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

    <el-dialog v-model="dlg" :title="form.id ? '编辑质检单' : '新增质检单'" width="760px" top="6vh">
      <el-form :model="form" label-width="80px" size="small">
        <el-row :gutter="10">
          <el-col :span="8"><el-form-item label="类型">
            <el-select v-model="form.qc_type" style="width:100%"><el-option label="到货检验(IQC)" value="IQC" /><el-option label="过程检验(IPQC)" value="IPQC" /><el-option label="完工检验(FQC)" value="FQC" /></el-select>
          </el-form-item></el-col>
          <el-col :span="8"><el-form-item label="日期"><el-date-picker v-model="form.qc_date" type="date" value-format="YYYY-MM-DD" style="width:100%" /></el-form-item></el-col>
          <el-col :span="8"><el-form-item label="判定">
            <el-select v-model="form.result" style="width:100%"><el-option label="合格" value="pass" /><el-option label="不合格" value="fail" /><el-option label="让步接收" value="concession" /></el-select>
          </el-form-item></el-col>
          <el-col :span="8"><el-form-item label="来源单号"><el-input v-model="form.source_doc_no" placeholder="采购入库/完工入库单号" /></el-form-item></el-col>
          <el-col :span="8"><el-form-item label="检验员"><el-input v-model="form.inspector" /></el-form-item></el-col>
          <el-col :span="8"><el-form-item label="备注"><el-input v-model="form.remark" /></el-form-item></el-col>
        </el-row>
      </el-form>
      <div class="lines-hd"><span>检验明细</span><el-button size="small" @click="addLine"><el-icon><Plus /></el-icon>加行</el-button></div>
      <el-table :data="form.lines" border size="small" max-height="300">
        <el-table-column type="index" label="序号" width="52" align="center" />
        <el-table-column label="物料" min-width="140"><template #default="{ row }"><ItemPicker v-model="row.item_code" @pick="(it:any)=>{row.item_code=it.code}" /></template></el-table-column>
        <el-table-column label="批号" width="120"><template #default="{ row }"><el-input v-model="row.batch_no" size="small" /></template></el-table-column>
        <el-table-column label="检验数" width="100"><template #default="{ row }"><el-input-number v-model="row.inspect_qty" :min="0" :controls="false" size="small" style="width:100%" @change="() => onQty(row)" /></template></el-table-column>
        <el-table-column label="合格" width="100"><template #default="{ row }"><el-input-number v-model="row.qualified_qty" :min="0" :controls="false" size="small" style="width:100%" @change="() => onQty(row)" /></template></el-table-column>
        <el-table-column label="不良" width="90" align="right"><template #default="{ row }"><span :class="{ bad: row.defect_qty > 0 }">{{ row.defect_qty }}</span></template></el-table-column>
        <el-table-column label="不良原因" min-width="130"><template #default="{ row }"><el-input v-model="row.defect_reason" size="small" placeholder="如 尺寸超差" /></template></el-table-column>
        <el-table-column label="操作" width="50" align="center"><template #default="{ $index }"><el-button link type="danger" size="small" @click="form.lines.splice($index, 1)">删</el-button></template></el-table-column>
      </el-table>
      <template #footer><el-button @click="dlg = false">取消</el-button><el-button type="primary" :loading="saving" @click="save">保存</el-button></template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { Plus } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { scmApi } from '@/api/scm'
import ItemPicker from '@/components/scm/ItemPicker.vue'

const rows = ref<any[]>([])
const qcType = ref('')
const loading = ref(false)
const dlg = ref(false)
const saving = ref(false)
const form = reactive<any>({ id: '', qc_type: 'IQC', qc_date: '', result: 'pass', source_doc_no: '', inspector: '', remark: '', lines: [] })

const qcTypeName = (t: string) => ({ IQC: '到货检验', IPQC: '过程检验', FQC: '完工检验' } as any)[t] || t
const resultName = (r: string) => ({ pass: '合格', fail: '不合格', concession: '让步接收' } as any)[r] || r
const resultTag = (r: string) => ({ pass: 'success', fail: 'danger', concession: 'warning' } as any)[r] || 'info'

async function load() {
  loading.value = true
  try { const r = await scmApi.getQcDocs({ qc_type: qcType.value || undefined }); if (r.code === 0) rows.value = r.data } finally { loading.value = false }
}
function onQty(row: any) { row.defect_qty = Math.max(0, Math.round(((Number(row.inspect_qty) || 0) - (Number(row.qualified_qty) || 0)) * 1000) / 1000) }
function addLine() { form.lines.push({ item_code: '', batch_no: '', inspect_qty: 0, qualified_qty: 0, defect_qty: 0, defect_reason: '' }) }
function openAdd() {
  Object.assign(form, { id: '', qc_type: 'IQC', qc_date: new Date().toISOString().slice(0, 10), result: 'pass', source_doc_no: '', inspector: '', remark: '', lines: [] })
  addLine(); dlg.value = true
}
async function openEdit(row: any) {
  const r = await scmApi.getQcDoc(row.id)
  if (r.code === 0) { Object.assign(form, { ...r.data, lines: (r.data as any).lines || [] }); dlg.value = true }
}
async function save() {
  const lines = form.lines.filter((l: any) => l.item_code)
  if (!lines.length) return ElMessage.warning('请至少录入一行检验物料')
  saving.value = true
  try {
    const payload = { ...form, lines }
    if (form.id) await scmApi.updateQcDoc(form.id, payload)
    else await scmApi.createQcDoc(payload)
    ElMessage.success('已保存'); dlg.value = false; load()
  } finally { saving.value = false }
}
async function audit(row: any) { await scmApi.auditQcDoc(row.id); ElMessage.success('已审核'); load() }
async function unaudit(row: any) { await scmApi.unauditQcDoc(row.id); ElMessage.success('已反审核'); load() }
async function del(row: any) {
  await ElMessageBox.confirm(`确认删除质检单「${row.qc_no}」？`, '提示', { type: 'warning' })
  await scmApi.deleteQcDoc(row.id); ElMessage.success('已删除'); load()
}
onMounted(load)
</script>

<style scoped>
.qc-page { display: flex; flex-direction: column; height: 100%; padding: 12px 16px; gap: 8px; }
.filter-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.filter-row .title { font-weight: 600; }
.lines-hd { display: flex; align-items: center; justify-content: space-between; margin: 6px 0; font-weight: 600; font-size: 13px; }
.bad { color: var(--el-color-danger); font-weight: 600; }
</style>
