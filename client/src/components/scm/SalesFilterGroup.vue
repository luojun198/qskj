<template>
  <div class="filter-group" :class="{ nested: depth > 0 }">
    <div class="group-head">
      <span class="group-label">{{ depth ? '条件组' : '筛选条件' }}</span>
      <el-radio-group v-model="group.logic" size="small">
        <el-radio-button v-for="option in logicOptions" :key="option.value" :value="option.value">{{ option.label }}</el-radio-button>
      </el-radio-group>
      <el-button text type="primary" size="small" @click="addCondition">+ 条件</el-button>
      <el-button v-if="depth < maxDepth - 1" text type="primary" size="small" @click="addGroup">+ 条件组</el-button>
      <el-button v-if="removable" text type="danger" size="small" @click="$emit('remove')">删除组</el-button>
    </div>
    <div v-if="!group.children.length" class="empty-group">未设置条件，默认查询全部数据</div>
    <div v-for="(child, index) in group.children" :key="index" class="condition-row">
      <SalesFilterGroup
        v-if="isGroup(child)"
        :group="child"
        :fields="fields"
        :operators="operators"
        :depth="depth + 1"
        :max-depth="maxDepth"
        removable
        @remove="group.children.splice(index, 1)"
      />
      <template v-else>
        <el-select v-model="child.field" filterable size="small" class="field-select" @change="resetCondition(child)">
          <el-option-group v-for="category in categories" :key="category" :label="category">
            <el-option v-for="field in groupedFields[category]" :key="field.key" :label="field.label" :value="field.key" />
          </el-option-group>
        </el-select>
        <el-select v-model="child.operator" size="small" class="operator-select" @change="resetOperatorValue(child)">
          <el-option v-for="operator in fieldOf(child)?.operators || []" :key="operator" :label="operators[operator] || operator" :value="operator" />
        </el-select>
        <template v-if="!noValue(child.operator)">
          <el-select
            v-if="fieldOf(child)?.options?.length"
            v-model="child.value"
            :multiple="['in', 'not_in'].includes(child.operator)"
            filterable collapse-tags size="small" class="value-input"
          >
            <el-option v-for="option in fieldOf(child)?.options" :key="option.value" :label="option.label" :value="option.value" />
          </el-select>
          <el-date-picker
            v-else-if="fieldOf(child)?.type === 'date'"
            v-model="child.value" type="date" value-format="YYYY-MM-DD" size="small" class="value-input" placeholder="日期"
          />
          <el-input-number
            v-else-if="numeric(child)"
            v-model="child.value" :controls="false" size="small" class="value-input" placeholder="数值"
          />
          <el-input v-else v-model="child.value" size="small" class="value-input" :placeholder="['in','not_in'].includes(child.operator) ? '多个值用逗号分隔' : '条件值'" />
          <template v-if="child.operator === 'between'">
            <span class="range-separator">至</span>
            <el-date-picker
              v-if="fieldOf(child)?.type === 'date'" v-model="child.value2" type="date" value-format="YYYY-MM-DD"
              size="small" class="value-input" placeholder="结束日期"
            />
            <el-input-number v-else v-model="child.value2" :controls="false" size="small" class="value-input" placeholder="最大值" />
          </template>
        </template>
        <el-button text type="danger" size="small" @click="group.children.splice(index, 1)">移除</el-button>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { SalesReportFieldMeta, SalesReportFilterCondition, SalesReportFilterGroup } from '@/api/scm'

const props = withDefaults(defineProps<{
  group: SalesReportFilterGroup
  fields: SalesReportFieldMeta[]
  operators: Record<string, string>
  depth?: number
  maxDepth?: number
  removable?: boolean
}>(), { depth: 0, maxDepth: 3, removable: false })
defineEmits<{ remove: [] }>()

const logicOptions = [{ label: '并且 AND', value: 'and' }, { label: '或者 OR', value: 'or' }]
const groupedFields = computed(() => props.fields.reduce<Record<string, SalesReportFieldMeta[]>>((result, field) => {
  ;(result[field.category || '其他'] ||= []).push(field)
  return result
}, {}))
const categories = computed(() => Object.keys(groupedFields.value))
const isGroup = (child: any): child is SalesReportFilterGroup => Array.isArray(child?.children)
const fieldOf = (condition: SalesReportFilterCondition) => props.fields.find(field => field.key === condition.field)
const noValue = (operator: string) => operator === 'is_empty' || operator === 'not_empty'
const numeric = (condition: SalesReportFilterCondition) => ['number', 'amount', 'integer', 'percent'].includes(fieldOf(condition)?.type || '')

function addCondition() {
  const field = props.fields[0]
  if (!field) return
  props.group.children.push({ field: field.key, operator: field.operators[0] || 'eq', value: undefined })
}
function addGroup() {
  props.group.children.push({ logic: 'and', children: [] })
}
function resetCondition(condition: SalesReportFilterCondition) {
  const field = fieldOf(condition)
  condition.operator = field?.operators[0] || 'eq'
  condition.value = undefined
  condition.value2 = undefined
}
function resetOperatorValue(condition: SalesReportFilterCondition) {
  condition.value = undefined
  condition.value2 = undefined
}
</script>

<style scoped>
.filter-group { width: 100%; }
.filter-group.nested { padding: 9px 10px; border: 1px dashed var(--el-border-color); border-radius: 7px; background: var(--el-fill-color-lighter); }
.group-head { display: flex; align-items: center; gap: 8px; min-height: 30px; }
.group-label { font-size: var(--cw-text-base); font-weight: 600; color: var(--el-text-color-primary); }
.condition-row { display: flex; align-items: center; gap: 8px; margin-top: 7px; width: 100%; }
.field-select { width: 190px; }
.operator-select { width: 126px; }
.value-input { width: 190px; }
.range-separator { color: var(--el-text-color-secondary); flex: none; }
.empty-group { padding: 8px 0 2px; font-size: 12px; color: var(--el-text-color-placeholder); }
</style>
