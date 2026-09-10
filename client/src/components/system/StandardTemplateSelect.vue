<template>
  <el-select
    :model-value="modelValue"
    :placeholder="placeholder"
    :size="size"
    :loading="loading"
    :clearable="clearable"
    :disabled="disabled"
    filterable
    popper-class="standard-template-select__popper"
    class="standard-template-select"
    @update:model-value="onUpdate"
  >
    <el-option-group
      v-for="group in groupedTemplates"
      :key="group.group"
      :label="group.retired ? `${group.group}（仅供沿用旧账的单位选择）` : group.group"
    >
      <el-option
        v-for="item in group.items"
        :key="item.id"
        :label="formatStandardTemplateLabel(item)"
        :value="item.id"
      >
        <!-- 一个会计准则占一行：序号 + 名称 + 概况 -->
        <span class="stpl-opt" :title="formatStandardTemplateLabel(item)">
          <span class="stpl-opt__code">{{ item.code || '—' }}</span>
          <span class="stpl-opt__name">{{ item.name }}</span>
          <span v-if="item.retired" class="stpl-opt__retired">停用</span>
          <span class="stpl-opt__meta">{{ formatStandardTemplateMeta(item) }}</span>
        </span>
      </el-option>
    </el-option-group>
  </el-select>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import {
  formatStandardTemplateLabel,
  formatStandardTemplateMeta,
  groupStandardTemplates,
  type StandardTemplateItem,
} from '@/utils/standardTemplateGroups'

const props = withDefaults(
  defineProps<{
    modelValue: string
    templates: StandardTemplateItem[]
    groups?: string[]
    placeholder?: string
    size?: 'large' | 'default' | 'small'
    loading?: boolean
    clearable?: boolean
    disabled?: boolean
  }>(),
  {
    groups: () => [],
    placeholder: '选择会计准则 / 科目体系模版',
    size: 'default',
    loading: false,
    clearable: false,
    disabled: false,
  }
)

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
}>()

const groupedTemplates = computed(() => groupStandardTemplates(props.templates, props.groups))

function onUpdate(value: string) {
  emit('update:modelValue', value ?? '')
}
</script>

<style scoped>
.standard-template-select {
  width: 100%;
}
</style>

<style>
/* 下拉面板：一条准则一行，紧凑排布 */
.standard-template-select__popper {
  min-width: 420px !important;
}

.standard-template-select__popper .el-select-dropdown__list {
  padding: 2px 0;
}

.standard-template-select__popper .el-select-group__title {
  height: 24px;
  line-height: 24px;
  padding-left: 12px;
  font-size: 12px;
}

.standard-template-select__popper .el-select-dropdown__item {
  height: 28px;
  line-height: 28px;
  padding: 0 12px;
}

.stpl-opt {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  overflow: hidden;
}

.stpl-opt__code {
  flex: 0 0 auto;
  min-width: 22px;
  text-align: right;
  font-family: var(--el-font-family-mono, Consolas, Menlo, monospace);
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.stpl-opt__name {
  flex: 0 1 auto;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.stpl-opt__retired {
  flex: 0 0 auto;
  font-size: 11px;
  line-height: 16px;
  padding: 0 4px;
  border-radius: 3px;
  color: var(--el-text-color-secondary);
  background: var(--el-fill-color);
}

.stpl-opt__meta {
  flex: 1 1 auto;
  text-align: right;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  color: var(--el-text-color-placeholder);
}
</style>
