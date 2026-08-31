<template>
  <el-dialog
    :model-value="visible"
    title="导入异常说明"
    width="880px"
    class="spreadsheet-import-issues-dialog"
    append-to-body
    @update:model-value="emit('update:visible', $event)"
  >
    <p class="import-issues-intro">
      {{ intro }}
    </p>
    <p v-if="totalCount != null && totalCount > issues.length" class="import-issues-truncated">
      共 {{ totalCount }} 行异常，以下为 {{ issues.length }} 条汇总说明（同类问题已合并）。
    </p>
    <div v-loading="loading" class="import-issues-body">
      <el-empty v-if="!loading && issues.length === 0" description="暂无异常记录" />
      <ul v-else-if="issues.length > 0" class="import-issues-list">
      <li
        v-for="(issue, idx) in issues"
        :key="`${issue.rowIndex}-${idx}`"
        class="import-issue-item"
      >
        <div class="import-issue-title">{{ issue.title }}</div>
        <div class="import-issue-detail">{{ issue.detail }}</div>
      </li>
    </ul>
    </div>
    <template #footer>
      <el-button type="primary" @click="emit('update:visible', false)">知道了</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import type { SpreadsheetImportIssue } from '@/utils/spreadsheetImportReport'

withDefaults(
  defineProps<{
    visible: boolean
    issues: SpreadsheetImportIssue[]
    intro?: string
    loading?: boolean
    /** 原始异常行数（汇总展示时可能与 issues.length 不同） */
    totalCount?: number | null
  }>(),
  {
    intro:
      '以下行未能通过校验，不会写入。请按行号在 Excel 中修正后重新上传；已通过校验的行仍可正常导入。',
    loading: false,
    totalCount: null,
  }
)

const emit = defineEmits<{
  'update:visible': [value: boolean]
}>()
</script>

<style scoped>
.import-issues-intro {
  margin: 0 0 12px;
  font-size: 13px;
  color: #606266;
  line-height: 1.6;
}
.import-issues-truncated {
  margin: 0 0 10px;
  font-size: 12px;
  color: var(--el-color-warning);
  line-height: 1.5;
}
.import-issues-body {
  min-height: 120px;
}
.import-issues-list {
  margin: 0;
  padding: 0;
  list-style: none;
  max-height: 360px;
  overflow-y: auto;
}
.import-issue-item {
  padding: 10px 12px;
  margin-bottom: 8px;
  background: var(--el-fill-color-light);
  border-radius: 6px;
}
.import-issue-item:last-child {
  margin-bottom: 0;
}
.import-issue-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--el-text-color-primary);
  margin-bottom: 4px;
}
.import-issue-detail {
  font-size: 13px;
  color: #606266;
  line-height: 1.55;
}
</style>
