<template>
  <div class="page scm-unit-page">
    <div class="list-toolbar" style="margin-bottom:var(--block-gap)">
      <el-button type="primary" size="small" @click="openAdd"><el-icon><Plus /></el-icon>新增计量单位</el-button>
      <SaveAsButton title="计量单位" />
    </div>
    <div class="page-table-fill">
      <el-table ref="tableRef" :data="list" v-loading="loading" border stripe size="small" height="100%" class="compact-data-table" @header-dragend="onDragEnd">
        <el-table-column label="编号" prop="code" :width="cw('code', 120)" />
        <el-table-column label="名称" prop="name" min-width="160" :width="widths.name" />
        <el-table-column label="状态" column-key="status" :width="cw('status', 80)" align="center">
          <template #default="{ row }">
            <el-tag :type="row.enabled ? 'success' : 'info'" size="small">
              {{ row.enabled ? '启用' : '停用' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="备注" prop="remark" min-width="160" :width="widths.remark" show-overflow-tooltip />
        <el-table-column label="操作" column-key="操作" :width="cw('操作', 120)" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="openEdit(row)">编辑</el-button>
            <el-button link type="danger" size="small" @click="handleDelete(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <el-dialog v-model="dialogVisible" :title="editId ? '编辑计量单位' : '新增计量单位'" width="440px" draggable @keydown="onDialogKeydown">
      <el-form :model="form" label-width="80px" size="small">
        <el-form-item label="编号" required>
          <el-input v-model="form.code" :disabled="!!editId" />
        </el-form-item>
        <el-form-item label="名称" required>
          <el-input v-model="form.name" placeholder="如：个、箱、公斤" />
        </el-form-item>
        <el-form-item label="状态">
          <el-switch v-model="form.enabled" :active-value="1" :inactive-value="0" active-text="启用" inactive-text="停用" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="form.remark" type="textarea" :rows="2" />
        </el-form-item>
      </el-form>
      <template #footer>
        <div style="display: flex; justify-content: flex-end; gap: 8px; flex-wrap: nowrap;">
          <el-button @click="dialogVisible = false">取消</el-button>
          <el-button v-if="!editId" :loading="saving" @click="handleSave(true)">保存并新增 (Ctrl+Enter)</el-button>
          <el-button type="primary" :loading="saving" @click="handleSave(false)">保存 (Enter)</el-button>
        </div>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus } from '@element-plus/icons-vue'
import { scmApi, type ScmUnit } from '@/api/scm'
import { useListColumnWidth } from '@/composables/useColumnWidthMemory'

const { tableRef, colWidth, onDragEnd, widths } = useListColumnWidth('scm_unit')
function cw(key: string, fallback: number) { return colWidth(key, fallback) }

const list = ref<ScmUnit[]>([])
const loading = ref(false)
async function load() {
  loading.value = true
  try { const res = await scmApi.getUnits(); if (res.code === 0) list.value = res.data } finally { loading.value = false }
}

const dialogVisible = ref(false)
const editId = ref<string | null>(null)
const saving = ref(false)
const form = ref<Partial<ScmUnit>>({ code: '', name: '', enabled: 1, remark: '' })

async function openAdd() {
  editId.value = null
  form.value = { code: '', name: '', enabled: 1, remark: '' }
  dialogVisible.value = true
  try { const r = await scmApi.getUnitNextNo(); if (r.code === 0) form.value.code = r.data.next_no } catch {}
}
function openEdit(row: ScmUnit) {
  editId.value = row.id
  form.value = { ...row }
  dialogVisible.value = true
}
async function handleSave(continueAdd = false) {
  if (!form.value.code || !form.value.name) return ElMessage.warning('编号和名称不能为空')
  saving.value = true
  try {
    if (editId.value) await scmApi.updateUnit(editId.value, form.value)
    else await scmApi.createUnit(form.value)
    ElMessage.success(continueAdd ? '保存成功，可继续新增' : '保存成功')
    load()
    if (continueAdd) {
      await openAdd()
    } else {
      dialogVisible.value = false
    }
  } catch { /* error handled by interceptor */ }
  finally { saving.value = false }
}

function onDialogKeydown(e: KeyboardEvent) {
  if (!dialogVisible.value || saving.value) return
  if (e.key !== 'Enter') return
  const target = e.target as HTMLElement
  if (target.tagName === 'TEXTAREA' && !e.ctrlKey && !e.metaKey) return
  e.preventDefault()
  if (e.ctrlKey || e.metaKey) {
    if (!editId.value) handleSave(true)
    else handleSave(false)
  } else {
    handleSave(false)
  }
}

async function handleDelete(row: ScmUnit) {
  await ElMessageBox.confirm(`确认删除单位「${row.name}」？`, '提示', { type: 'warning' })
  await scmApi.deleteUnit(row.id); ElMessage.success('已删除'); load()
}
onMounted(load)
</script>

<style scoped>
.scm-unit-page { padding: var(--page-pad); height: 100%; }
.filter-row { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
</style>
