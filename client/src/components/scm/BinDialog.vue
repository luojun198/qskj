<template>
  <el-dialog v-model="visible" :title="row ? '编辑库位' : '新增库位'" width="420px">
    <el-form label-width="90px" size="small">
      <el-form-item label="仓库" required>
        <el-select v-model="form.warehouse_code" :disabled="!!row" filterable placeholder="选择仓库" style="width:100%">
          <el-option v-for="w in warehouses" :key="w.code" :value="w.code" :label="w.name || w.code" />
        </el-select>
      </el-form-item>
      <el-form-item label="库位编码" required>
        <el-input v-model="form.code" :disabled="!!row" placeholder="如 A-01-01" />
      </el-form-item>
      <el-form-item label="库位名称" required>
        <el-input v-model="form.name" placeholder="库位名称" />
      </el-form-item>
      <el-form-item label="备注">
        <el-input v-model="form.remark" />
      </el-form-item>
      <el-form-item label="启用">
        <el-switch v-model="form.enabled" :active-value="1" :inactive-value="0" />
      </el-form-item>
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
import { scmApi } from '@/api/scm'

const props = defineProps<{ modelValue: boolean; row?: any | null; defaultWarehouse?: string }>()
const emit = defineEmits<{ (e: 'update:modelValue', v: boolean): void; (e: 'saved', bin: any): void }>()

const visible = ref(false)
const saving = ref(false)
const warehouses = ref<any[]>([])
const form = ref<{ warehouse_code: string; code: string; name: string; remark: string; enabled: number }>({ warehouse_code: '', code: '', name: '', remark: '', enabled: 1 })

async function loadWarehouses() {
  if (warehouses.value.length) return
  try { const w = await scmApi.getWarehouses(); if (w.code === 0) warehouses.value = w.data || [] } catch { /* ignore */ }
}
watch(() => props.modelValue, v => {
  visible.value = v
  if (!v) return
  loadWarehouses()
  if (props.row) form.value = { warehouse_code: props.row.warehouse_code, code: props.row.code, name: props.row.name, remark: props.row.remark || '', enabled: props.row.enabled ?? 1 }
  else form.value = { warehouse_code: props.defaultWarehouse || '', code: '', name: '', remark: '', enabled: 1 }
}, { immediate: true })
watch(visible, v => emit('update:modelValue', v))

async function onSave() {
  if (!form.value.warehouse_code || !form.value.code || !form.value.name) return ElMessage.warning('仓库、编码、名称不能为空')
  saving.value = true
  try {
    const r = props.row
      ? await scmApi.updateBin(props.row.id, { name: form.value.name, remark: form.value.remark, enabled: form.value.enabled })
      : await scmApi.createBin(form.value)
    if (r.code === 0) { ElMessage.success('保存成功'); emit('saved', { ...form.value }); visible.value = false }
    else ElMessage.error(r.message || '保存失败')
  } catch (e: any) { ElMessage.error(e?.response?.data?.message || '保存失败') }
  finally { saving.value = false }
}
</script>
