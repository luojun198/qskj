<template>
  <el-dialog v-model="visible" :title="row ? '编辑仓库' : '新增仓库'" width="600px" draggable @keydown="onDialogKeydown">
    <el-form :model="form" label-width="80px" size="small">
      <div class="form-sector">
        <div class="form-sector-title">基本资料</div>
        <el-row :gutter="16">
          <el-col :span="12"><el-form-item label="编号" required><el-input v-model="form.code" :disabled="!!row" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="名称" required><el-input v-model="form.name" /></el-form-item></el-col>
        </el-row>
      </div>

      <div class="form-sector">
        <div class="form-sector-title">管理属性</div>
        <el-row :gutter="16">
          <el-col :span="12"><el-form-item label="仓库属性"><el-input v-model="form.attr" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="负责人"><el-input v-model="form.keeper" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="联系电话"><el-input v-model="form.phone" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="对应往来单位"><el-input v-model="form.partner_code" placeholder="外仓可填供应商/客户编号" /></el-form-item></el-col>
          <el-col :span="24"><el-form-item label="仓库地址"><el-input v-model="form.address" /></el-form-item></el-col>
          <el-col :span="24"><el-form-item label="备注"><el-input v-model="form.remark" type="textarea" :rows="1" /></el-form-item></el-col>
        </el-row>
      </div>
    </el-form>
    <template #footer>
      <div style="display: flex; justify-content: flex-end; gap: 8px;">
        <el-button @click="visible = false">取消</el-button>
        <el-button v-if="!row" :loading="saving" @click="handleSave(true)">保存并新增 (Ctrl+Enter)</el-button>
        <el-button type="primary" :loading="saving" @click="handleSave(false)">确认保存 (Enter)</el-button>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { scmApi, type ScmWarehouse } from '@/api/scm'

const props = defineProps<{ modelValue: boolean; row?: ScmWarehouse | null }>()
const emit = defineEmits<{ (e: 'update:modelValue', v: boolean): void; (e: 'saved', warehouse: any): void }>()

const visible = ref(false)
const form = ref<Partial<ScmWarehouse>>({})
const saving = ref(false)

async function resetForNew() {
  form.value = {}
  try { const r = await scmApi.getWarehouseNextNo(); if (r.code === 0) form.value.code = r.data.next_no } catch { /* 取号失败可手填 */ }
}
watch(() => props.modelValue, v => { visible.value = v; if (v) { if (props.row) form.value = { ...props.row }; else resetForNew() } }, { immediate: true })
watch(visible, v => emit('update:modelValue', v))

async function handleSave(continueAdd = false) {
  if (!form.value.code || !form.value.name) return ElMessage.warning('编号和名称不能为空')
  saving.value = true
  try {
    if (props.row) await scmApi.updateWarehouse(props.row.id as string, form.value)
    else await scmApi.createWarehouse(form.value)
    ElMessage.success(continueAdd ? '保存成功，可继续新增' : '保存成功')
    emit('saved', { ...form.value })
    if (continueAdd) await resetForNew()
    else visible.value = false
  } finally { saving.value = false }
}

function onDialogKeydown(e: KeyboardEvent) {
  if (saving.value || e.key !== 'Enter') return
  const target = e.target as HTMLElement
  if (target.tagName === 'TEXTAREA' && !e.ctrlKey && !e.metaKey) return
  e.preventDefault()
  if (e.ctrlKey || e.metaKey) { if (!props.row) handleSave(true); else handleSave(false) }
  else handleSave(false)
}
</script>
