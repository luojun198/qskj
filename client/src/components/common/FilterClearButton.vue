<template>
  <el-button plain :size="size" @click="emit('clear')">
    <el-icon><RefreshLeft /></el-icon>清空
  </el-button>
</template>

<script setup lang="ts">
import { RefreshLeft } from '@element-plus/icons-vue'

withDefaults(
  defineProps<{
    /** 与页面查询按钮保持一致的尺寸 */
    size?: 'small' | 'default' | 'large'
  }>(),
  { size: undefined }
)

const emit = defineEmits<{
  /** 清空完成，页面在此回调中自动重新查询 */
  clear: []
}>()
</script>
