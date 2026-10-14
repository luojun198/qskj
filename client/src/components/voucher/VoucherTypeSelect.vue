<template>
  <el-select
    :model-value="modelValue"
    :placeholder="defaultLabel"
    clearable
    :size="size"
    :style="{ width }"
    @update:model-value="v => emit('update:modelValue', v || '')"
  >
    <el-option value="" :label="defaultLabel" />
    <el-option v-for="vt in baseData.voucherTypes" :key="vt.id" :value="String(vt.id)" :label="vt.name" />
  </el-select>
</template>

<script setup lang="ts">
/**
 * 凭证类型选择（业务凭证生成用）。空值 = 按默认：交给后端按模块默认参数 / 自动规则取类型。
 */
import { onMounted } from 'vue'
import { useBaseDataStore } from '@/stores/baseData'

withDefaults(defineProps<{
  modelValue: string
  /** 空选项的文字，说明「默认」指什么 */
  defaultLabel?: string
  size?: 'small' | 'default' | 'large'
  width?: string
}>(), { defaultLabel: '按默认设置', size: 'small', width: '220px' })

const emit = defineEmits<{ (e: 'update:modelValue', v: string): void }>()
const baseData = useBaseDataStore()
onMounted(() => { void baseData.loadVoucherTypes() })
</script>
