<template>
  <div class="page scm-cat-page">
    <div class="cat-bar">
      <span class="cat-title">物料分类</span>
      <el-button type="primary" size="small" @click="openAdd"><el-icon><Plus /></el-icon>新增分类</el-button>
      <el-button size="small" :loading="loading" @click="load"><el-icon><Refresh /></el-icon>刷新</el-button>
      <span class="cat-hint">共 {{ rows.length }} 个分类</span>
    </div>
    <div class="cat-body">
      <el-table :data="rows" v-loading="loading" border stripe size="small" height="100%">
        <el-table-column type="index" label="序号" width="48" align="center" />
        <el-table-column label="编码" prop="code" width="160" />
        <el-table-column label="名称" prop="name" min-width="200" show-overflow-tooltip />
        <el-table-column label="上级分类" min-width="180" show-overflow-tooltip>
          <template #default="{ row }">{{ parentName(row.parent_code) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="140" align="center">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="openEdit(row)">编辑</el-button>
            <el-button link type="danger" size="small" @click="onDelete(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <el-dialog v-model="dialogVisible" :title="editId ? '编辑分类' : '新增分类'" width="420px" append-to-body>
      <el-form label-width="90px" size="small">
        <el-form-item label="编码" required>
          <el-input v-model="form.code" :disabled="!!editId" placeholder="分类编码" />
        </el-form-item>
        <el-form-item label="名称" required>
          <el-input v-model="form.name" placeholder="分类名称" />
        </el-form-item>
        <el-form-item label="上级分类">
          <el-select v-model="form.parent_code" clearable filterable placeholder="顶级分类留空" style="width:100%">
            <el-option v-for="c in rows.filter(r => r.code !== form.code)" :key="c.id" :value="c.code" :label="`${c.code} ${c.name}`" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="onSave">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { Plus, Refresh } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { scmApi } from '@/api/scm'

const rows = ref<any[]>([])
const loading = ref(false)
const dialogVisible = ref(false)
const saving = ref(false)
const editId = ref<string | null>(null)
const form = ref<{ code: string; name: string; parent_code: string | null }>({ code: '', name: '', parent_code: null })

const parentName = (code: string) => {
  if (!code) return '-'
  const p = rows.value.find(r => r.code === code)
  return p ? `${p.code} ${p.name}` : code
}

async function load() {
  loading.value = true
  try { const r = await scmApi.getCategories(); if (r.code === 0) rows.value = r.data || [] }
  finally { loading.value = false }
}
function openAdd() { editId.value = null; form.value = { code: '', name: '', parent_code: null }; dialogVisible.value = true }
function openEdit(row: any) { editId.value = row.id; form.value = { code: row.code, name: row.name, parent_code: row.parent_code || null }; dialogVisible.value = true }
async function onSave() {
  if (!form.value.code || !form.value.name) return ElMessage.warning('编码和名称不能为空')
  saving.value = true
  try {
    const r = editId.value
      ? await scmApi.updateCategory(editId.value, { name: form.value.name, parent_code: form.value.parent_code })
      : await scmApi.createCategory(form.value)
    if (r.code === 0) { ElMessage.success('保存成功'); dialogVisible.value = false; load() }
    else ElMessage.error(r.message || '保存失败')
  } finally { saving.value = false }
}
async function onDelete(row: any) {
  try { await ElMessageBox.confirm(`确认删除分类「${row.name}」？`, '提示', { type: 'warning' }) } catch { return }
  try {
    const r = await scmApi.deleteCategory(row.id)
    if (r.code === 0) { ElMessage.success('已删除'); load() }
    else ElMessage.error(r.message || '删除失败')
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.message || e?.message || '删除失败')
  }
}
onMounted(load)
</script>

<style scoped>
.scm-cat-page { display: flex; flex-direction: column; height: 100%; padding: 12px 16px; }
.cat-bar { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
.cat-title { font-size: 15px; font-weight: 600; margin-right: 4px; }
.cat-hint { margin-left: auto; font-size: 13px; color: var(--el-text-color-secondary); }
.cat-body { flex: 1; min-height: 0; }
</style>
