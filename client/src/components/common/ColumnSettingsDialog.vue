<template>
  <el-dialog
    :model-value="modelValue"
    title="列设置"
    width="560px"
    draggable
    append-to-body
    destroy-on-close
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div class="column-settings-dialog__list">
      <div v-for="(column, index) in columns" :key="column.key" class="column-settings-dialog__row">
        <el-checkbox
          class="column-settings-dialog__checkbox"
          :model-value="column.visible"
          :disabled="column.required"
          @update:model-value="setVisible(index, Boolean($event))"
        >
          <span class="column-settings-dialog__label">{{ column.label }}</span>
          <span v-if="column.group" class="column-settings-dialog__group">{{ column.group }}</span>
        </el-checkbox>
        <div class="column-settings-dialog__move">
          <el-button size="small" plain :disabled="index === 0" @click="move(index, 'top')">置顶</el-button>
          <el-button size="small" plain :disabled="index === 0" @click="move(index, 'up')">上移</el-button>
          <el-button size="small" plain :disabled="index === columns.length - 1" @click="move(index, 'down')">下移</el-button>
          <el-button size="small" plain :disabled="index === columns.length - 1" @click="move(index, 'bottom')">置尾</el-button>
        </div>
      </div>
      <el-empty v-if="!columns.length" description="暂无可设置列" :image-size="64" />
    </div>
    <template #footer>
      <el-button @click="emit('reset')">恢复默认</el-button>
      <el-button type="primary" @click="emit('update:modelValue', false)">关闭</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { moveColumnSetting, type ColumnMoveDirection, type ColumnSetting } from '@/utils/columnSettings'

const props = defineProps<{
  modelValue: boolean
  columns: ColumnSetting[]
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  'update:columns': [value: ColumnSetting[]]
  reset: []
}>()

function setVisible(index: number, visible: boolean) {
  const column = props.columns[index]
  if (!column || column.required) return
  emit('update:columns', props.columns.map((item, itemIndex) => itemIndex === index ? { ...item, visible } : { ...item }))
}

function move(index: number, direction: ColumnMoveDirection) {
  const moved = moveColumnSetting(props.columns, index, direction)
  if (moved !== props.columns) emit('update:columns', moved.map(column => ({ ...column })))
}
</script>

<style scoped>
.column-settings-dialog__list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 60vh;
  overflow-y: auto;
  padding: 2px 6px 2px 2px;
}

.column-settings-dialog__row {
  display: flex;
  align-items: center;
  min-height: 38px;
  padding: 4px 8px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
  background: var(--el-fill-color-blank);
}

.column-settings-dialog__row:hover {
  border-color: var(--el-border-color);
  background: var(--el-fill-color-light);
}

.column-settings-dialog__checkbox {
  flex: 1;
  min-width: 0;
  margin-right: 12px;
}

.column-settings-dialog__label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.column-settings-dialog__group {
  margin-left: 8px;
  color: var(--el-text-color-placeholder);
  font-size: 12px;
}

.column-settings-dialog__move {
  display: flex;
  flex: none;
  gap: 4px;
}

.column-settings-dialog__move :deep(.el-button + .el-button) {
  margin-left: 0;
}
</style>
