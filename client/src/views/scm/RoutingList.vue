<template>
  <div class="page rt-page">
    <div class="filter-row">
      <span class="title">工艺路线</span>
      <el-button type="primary" size="small" @click="openAdd"><el-icon><Plus /></el-icon>新增</el-button>
      <span class="hint">定义成品的工序/工作中心/标准工时，供报工时选择工序</span>
    </div>
    <el-table :data="rows" v-loading="loading" border stripe size="small" height="100%">
      <el-table-column label="编码" prop="code" width="140" />
      <el-table-column label="名称" prop="name" min-width="150" show-overflow-tooltip />
      <el-table-column label="成品" min-width="160" show-overflow-tooltip>
        <template #default="{ row }">{{ row.item_code }} {{ row.item_name || '' }}</template>
      </el-table-column>
      <el-table-column label="状态" width="80" align="center"><template #default="{ row }">{{ row.status === 'active' ? '启用' : '停用' }}</template></el-table-column>
      <el-table-column label="操作" width="120" align="center">
        <template #default="{ row }">
          <el-button link type="primary" size="small" @click="openEdit(row)">编辑</el-button>
          <el-button link type="danger" size="small" @click="del(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog v-model="dlg" :title="form.id ? '编辑工艺路线' : '新增工艺路线'" width="720px" top="6vh">
      <el-form :model="form" label-width="70px" size="small">
        <el-row :gutter="10">
          <el-col :span="8"><el-form-item label="编码" required><el-input v-model="form.code" :disabled="!!form.id" /></el-form-item></el-col>
          <el-col :span="8"><el-form-item label="名称"><el-input v-model="form.name" /></el-form-item></el-col>
          <el-col :span="8"><el-form-item label="成品" required>
            <el-select v-model="form.item_code" filterable placeholder="选择成品" style="width:100%">
              <el-option v-for="i in items" :key="i.code" :label="`${i.code} ${i.name}`" :value="i.code" />
            </el-select>
          </el-form-item></el-col>
        </el-row>
      </el-form>
      <div class="lines-hd"><span>工序明细</span><el-button size="small" @click="addLine"><el-icon><Plus /></el-icon>加工序</el-button></div>
      <el-table :data="form.lines" border size="small" max-height="320">
        <el-table-column type="index" label="序号" width="54" align="center" />
        <el-table-column label="工序名" min-width="130">
          <template #default="{ row }"><el-input v-model="row.process_name" size="small" placeholder="如 总装" /></template>
        </el-table-column>
        <el-table-column label="工作中心" width="180">
          <template #default="{ row }">
            <el-select v-model="row.work_center_code" size="small" clearable placeholder="选择" style="width:100%">
              <el-option v-for="w in workCenters" :key="w.code" :label="w.name" :value="w.code" />
            </el-select>
          </template>
        </el-table-column>
        <el-table-column label="标准工时" width="120">
          <template #default="{ row }"><el-input-number v-model="row.std_hours" :min="0" :controls="false" size="small" style="width:100%" /></template>
        </el-table-column>
        <el-table-column label="委外" width="70" align="center">
          <template #default="{ row }"><el-switch v-model="row.is_outsource" :active-value="1" :inactive-value="0" size="small" /></template>
        </el-table-column>
        <el-table-column label="操作" width="60" align="center">
          <template #default="{ $index }"><el-button link type="danger" size="small" @click="form.lines.splice($index, 1)">删</el-button></template>
        </el-table-column>
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

const rows = ref<any[]>([])
const items = ref<any[]>([])
const workCenters = ref<any[]>([])
const loading = ref(false)
const dlg = ref(false)
const saving = ref(false)
const form = reactive<any>({ id: '', code: '', name: '', item_code: '', status: 'active', lines: [] })

async function load() {
  loading.value = true
  try { const r = await scmApi.getRoutings(); if (r.code === 0) rows.value = r.data } finally { loading.value = false }
}
async function loadRefs() {
  const [it, wc] = await Promise.all([scmApi.getItems({ all: '1' }), scmApi.getWorkCenters()])
  if (it.code === 0) items.value = ((it.data as any).list || []).filter((i: any) => i.is_leaf !== 0)
  if (wc.code === 0) workCenters.value = wc.data.filter((w: any) => w.enabled !== 0)
}
function addLine() { form.lines.push({ process_name: '', work_center_code: '', std_hours: 0, is_outsource: 0 }) }
async function openAdd() {
  const no = await scmApi.getRoutingNextNo()
  Object.assign(form, { id: '', code: no.code === 0 ? no.data.next_no : '', name: '', item_code: '', status: 'active', lines: [] })
  dlg.value = true
}
async function openEdit(row: any) {
  const r = await scmApi.getRouting(row.id)
  if (r.code === 0) { Object.assign(form, { ...r.data, lines: (r.data as any).lines || [] }); dlg.value = true }
}
async function save() {
  if (!form.code || !form.item_code) return ElMessage.warning('编码和成品不能为空')
  saving.value = true
  try {
    if (form.id) await scmApi.updateRouting(form.id, form)
    else await scmApi.createRouting(form)
    ElMessage.success('已保存'); dlg.value = false; load()
  } finally { saving.value = false }
}
async function del(row: any) {
  await ElMessageBox.confirm(`确认删除工艺路线「${row.code}」？`, '提示', { type: 'warning' })
  await scmApi.deleteRouting(row.id); ElMessage.success('已删除'); load()
}
onMounted(() => { load(); loadRefs() })
</script>

<style scoped>
.rt-page { display: flex; flex-direction: column; height: 100%; padding: 12px 16px; gap: 8px; }
.filter-row { display: flex; align-items: center; gap: 10px; }
.filter-row .title { font-weight: 600; }
.filter-row .hint { margin-left: auto; font-size: 12px; color: var(--el-text-color-secondary); }
.lines-hd { display: flex; align-items: center; justify-content: space-between; margin: 6px 0; font-weight: 600; font-size: 13px; }
</style>
