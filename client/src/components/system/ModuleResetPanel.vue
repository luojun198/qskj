<template>
  <div class="module-reset">
    <el-alert type="error" :closable="false" show-icon class="module-reset__alert">
      <template #title>危险操作 · 不可恢复</template>
      <div class="module-reset__desc">{{ currentDesc }}</div>
    </el-alert>

    <div class="module-reset__bar">
      <el-radio-group v-if="twoMode" v-model="mode" size="small">
        <el-radio value="business">仅业务数据</el-radio>
        <el-radio value="all">全部清空（含基础档案）</el-radio>
      </el-radio-group>
      <el-button type="danger" plain size="small" :loading="loading" @click="handleReset">
        <el-icon><Delete /></el-icon>执行初始化
      </el-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { ElMessageBox, ElMessage } from 'element-plus'
import { Delete } from '@element-plus/icons-vue'

const props = defineProps<{
  moduleLabel: string
  twoMode?: boolean
  businessDesc: string
  allDesc?: string
  resetFn: (mode: 'business' | 'all') => Promise<any>
}>()
const emit = defineEmits<{ (e: 'done', mode: 'business' | 'all'): void }>()

const mode = ref<'business' | 'all'>('business')
const loading = ref(false)

const currentDesc = computed(() =>
  props.twoMode && mode.value === 'all'
    ? `${props.businessDesc}${props.allDesc ? '；' + props.allDesc : ''}`
    : props.businessDesc
)

async function handleReset() {
  const fn = props.resetFn
  if (!fn) return
  const modeText = props.twoMode ? (mode.value === 'all' ? '全部清空（含基础档案）' : '仅业务数据') : ''
  try {
    await ElMessageBox.confirm(
      `将对【${props.moduleLabel}】执行初始化${modeText ? '（' + modeText + '）' : ''}：${currentDesc.value}。\n执行前会先自动完整备份本账套（备份失败则不会清空）；操作不可恢复，确认继续？`,
      `${props.moduleLabel}初始化确认`,
      { type: 'warning', confirmButtonText: '备份并清空', cancelButtonText: '取消', confirmButtonClass: 'el-button--danger' }
    )
  } catch { return }
  loading.value = true
  try {
    const r = await fn(mode.value)
    if (!r || r.code === 0) {
      const backup = r?.data?.backup
      ElMessage.success(backup ? `${props.moduleLabel}数据已清空（已自动备份：${backup}）` : `${props.moduleLabel}数据已清空`)
      emit('done', mode.value)
    }
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.module-reset { display: flex; flex-direction: column; gap: 10px; }
.module-reset__alert :deep(.el-alert__content) { width: 100%; }
.module-reset__desc { font-size: 12px; line-height: 1.6; margin-top: 2px; }
.module-reset__bar { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px; }
</style>
