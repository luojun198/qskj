<template>
  <el-tooltip placement="top" :show-after="150" popper-class="param-tip-popper">
    <template #content><div class="param-tip__content">{{ content }}</div></template>
    <el-icon class="param-tip" :class="{ 'param-tip--danger': danger }"><InfoFilled /></el-icon>
  </el-tooltip>
</template>

<script setup lang="ts">
/** 参数说明气泡：替代页面上的大段灰色说明文字，悬停查看 */
import { InfoFilled } from '@element-plus/icons-vue'

defineProps<{ content: string; danger?: boolean }>()
</script>

<style scoped>
.param-tip {
  flex-shrink: 0;
  margin-left: 4px;
  font-size: 13px;
  color: var(--el-text-color-placeholder);
  vertical-align: -2px;
  cursor: help;
  transition: color 120ms ease;
}
.param-tip:hover { color: var(--el-color-primary); }
.param-tip--danger:hover { color: var(--el-color-danger); }
.param-tip__content { max-width: 360px; line-height: 1.6; white-space: pre-line; }
</style>
