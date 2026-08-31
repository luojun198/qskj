<template>
  <Teleport to="body">
    <div v-if="visible" class="export-progress-overlay" role="dialog" aria-modal="true">
      <div class="export-progress-panel">
        <h4 class="export-progress-panel__title">{{ title }}</h4>
        <p class="export-progress-panel__message">{{ message || '请稍候，请勿关闭或切换页面…' }}</p>
        <el-progress
          :percentage="percent"
          :stroke-width="18"
          striped
          striped-flow
        />
        <p class="export-progress-panel__hint">导出完成前界面已锁定，完成后将自动开始下载</p>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
defineProps<{
  visible: boolean
  title: string
  message: string
  percent: number
}>()
</script>

<style scoped>
.export-progress-overlay {
  position: fixed;
  inset: 0;
  z-index: 5000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(15, 23, 42, 0.45);
  backdrop-filter: blur(2px);
}

.export-progress-panel {
  width: min(440px, calc(100vw - 48px));
  padding: 28px 32px 24px;
  border-radius: 8px;
  background: #fff;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.18);
}

.export-progress-panel__title {
  margin: 0 0 12px;
  font-size: 18px;
  font-weight: 600;
  color: #303133;
}

.export-progress-panel__message {
  margin: 0 0 16px;
  font-size: 14px;
  line-height: 1.5;
  color: #606266;
  min-height: 21px;
}

.export-progress-panel__hint {
  margin: 14px 0 0;
  font-size: 12px;
  color: #909399;
  text-align: center;
}
</style>
