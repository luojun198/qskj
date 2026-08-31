<template>
  <div class="page wc-page">
    <div class="filter-row">
      <span class="title">工作中心 / 工位</span>
      <el-button type="primary" size="small" @click="openAdd"><el-icon><Plus /></el-icon>新增</el-button>
      <span class="hint">报工按「工时 × 人工/制费费率」归集人工与制造费用到工单成本</span>
    </div>
    <el-table :data="rows" v-loading="loading" border stripe size="small" height="100%">
      <el-table-column label="编码" prop="code" width="120" />
      <el-table-column label="名称" prop="name" min-width="160" show-overflow-tooltip />
      <el-table-column label="类别" width="90" align="center">
        <template #default="{ row }">{{ row.category === 'outsource' ? '委外' : '自制' }}</template>
      </el-table-column>
      <el-table-column label="人工费率(元/工时)" width="150" align="right"><template #default="{ row }">{{ fmt(row.labor_rate) }}</template></el-table-column>
      <el-table-column label="制费费率(元/工时)" width="150" align="right"><template #default="{ row }">{{ fmt(row.overhead_rate) }}</template></el-table-column>
      <el-table-column label="启用" width="70" align="center"><template #default="{ row }">{{ row.enabled ? '是' : '否' }}</template></el-table-column>
      <el-table-column label="备注" prop="remark" min-width="140" show-overflow-tooltip />
      <el-table-column label="操作" width="120" align="center">
        <template #default="{ row }">
          <el-button link type="primary" size="small" @click="openEdit(row)">编辑</el-button>
          <el-button link type="danger" size="small" @click="del(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog v-model="dlg" :title="form.id ? '编辑工作中心' : '新增工作中心'" width="460px">
      <el-form :model="form" label-width="110px" size="small">
        <el-form-item label="编码" required><el-input v-model="form.code" :disabled="!!form.id" /></el-form-item>
        <el-form-item label="名称" required><el-input v-model="form.name" /></el-form-item>
        <el-form-item label="类别">
          <el-radio-group v-model="form.category"><el-radio value="inhouse">自制</el-radio><el-radio value="outsource">委外</el-radio></el-radio-group>
        </el-form-item>
        <el-form-item label="人工费率"><el-input-number v-model="form.labor_rate" :min="0" :controls="false" style="width:140px" /> 元/工时</el-form-item>
        <el-form-item label="制费费率"><el-input-number v-model="form.overhead_rate" :min="0" :controls="false" style="width:140px" /> 元/工时</el-form-item>
        <el-form-item label="启用"><el-switch v-model="form.enabled" :active-value="1" :inactive-value="0" /></el-form-item>
        <el-form-item label="备注"><el-input v-model="form.remark" type="textarea" :rows="2" /></el-form-item>
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

const rows = ref<any[]>([])
const loading = ref(false)
const dlg = ref(false)
const saving = ref(false)
const form = reactive<any>({ id: '', code: '', name: '', category: 'inhouse', labor_rate: 0, overhead_rate: 0, enabled: 1, remark: '' })
const fmt = (v: any) => (Number(v) || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

async function load() {
  loading.value = true
  try { const r = await scmApi.getWorkCenters(); if (r.code === 0) rows.value = r.data } finally { loading.value = false }
}
function openAdd() { Object.assign(form, { id: '', code: '', name: '', category: 'inhouse', labor_rate: 0, overhead_rate: 0, enabled: 1, remark: '' }); dlg.value = true }
function openEdit(row: any) { Object.assign(form, { ...row }); dlg.value = true }
async function save() {
  if (!form.code || !form.name) return ElMessage.warning('编码和名称不能为空')
  saving.value = true
  try {
    if (form.id) await scmApi.updateWorkCenter(form.id, form)
    else await scmApi.createWorkCenter(form)
    ElMessage.success('已保存'); dlg.value = false; load()
  } finally { saving.value = false }
}
async function del(row: any) {
  await ElMessageBox.confirm(`确认删除工作中心「${row.name}」？`, '提示', { type: 'warning' })
  await scmApi.deleteWorkCenter(row.id); ElMessage.success('已删除'); load()
}
onMounted(load)
</script>

<style scoped>
.wc-page { display: flex; flex-direction: column; height: 100%; padding: 12px 16px; gap: 8px; }
.filter-row { display: flex; align-items: center; gap: 10px; }
.filter-row .title { font-weight: 600; }
.filter-row .hint { margin-left: auto; font-size: 12px; color: var(--el-text-color-secondary); }
</style>
