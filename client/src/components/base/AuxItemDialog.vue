<template>
  <el-dialog v-model="visible" :title="(row ? '编辑' : '新增') + entityName" width="420px">
    <el-form :model="form" label-width="80px" size="small">
      <el-form-item label="编码" required><el-input v-model="form.code" :disabled="!!row" placeholder="自动生成，可修改" /></el-form-item>
      <el-form-item :label="nameLabel" required><el-input v-model="form.name" /></el-form-item>
      <el-form-item label="备注"><el-input v-model="form.remark" type="textarea" :rows="2" /></el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" :loading="saving" @click="onSave">保存</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import request from '@/api/request'

const props = withDefaults(defineProps<{ modelValue: boolean; entityType: string; entityName: string; nameLabel?: string; row?: any | null; defaultCode?: string }>(), { nameLabel: '名称' })
const emit = defineEmits<{ (e: 'update:modelValue', v: boolean): void; (e: 'saved', item: any): void }>()

const visible = ref(false)
const saving = ref(false)
const form = ref<any>({ type: props.entityType, status: 'active', code: '', name: '', remark: '' })

watch(() => props.modelValue, v => {
  visible.value = v
  if (!v) return
  form.value = props.row
    ? { ...props.row }
    : { type: props.entityType, status: 'active', code: props.defaultCode || '', name: '', remark: '' }
}, { immediate: true })
watch(visible, v => emit('update:modelValue', v))

async function onSave() {
  if (!form.value.code?.trim() || !form.value.name?.trim()) return ElMessage.warning('编码和名称不能为空')
  saving.value = true
  try {
    if (props.row) await request.put(`/base/aux-items/${props.row.id}`, form.value)
    else await request.post('/base/aux-items', { ...form.value, type: props.entityType })
    ElMessage.success('保存成功')
    emit('saved', { ...form.value })
    visible.value = false
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.message || e?.message || '保存失败')
  } finally { saving.value = false }
}
</script>
