<template>
  <el-alert
    :title="summary.message"
    :type="summary.alertType"
    :closable="false"
    show-icon
    class="import-summary-alert"
  >
    <template v-if="summary.hint || issueCount > 0" #default>
      <p v-if="summary.hint" class="import-summary-hint">{{ summary.hint }}</p>
      <p v-if="issueCount > 0" class="import-summary-actions">
        <el-link type="primary" :underline="false" @click="emit('view-issues')">
          查看异常说明（{{ issueCount }} 条）
        </el-link>
      </p>
    </template>
  </el-alert>
</template>

<script setup lang="ts">
defineProps<{
  summary: { alertType: 'success' | 'warning' | 'error'; message: string; hint: string }
  issueCount: number
}>()

const emit = defineEmits<{ 'view-issues': [] }>()
</script>

<style scoped>
.import-summary-alert :deep(.el-alert__content) {
  width: 100%;
}
.import-summary-alert :deep(.el-alert__title) {
  white-space: normal;
  word-break: break-word;
  line-height: 1.55;
}
.import-summary-hint {
  margin: 8px 0 0;
  font-size: 13px;
  color: #606266;
  line-height: 1.55;
}
.import-summary-actions {
  margin: 6px 0 0;
}
</style>
