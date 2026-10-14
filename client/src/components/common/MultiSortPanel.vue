<template>
  <el-popover v-model:visible="visible" placement="bottom-end" trigger="click" :width="480" :show-arrow="false" popper-class="multi-sort-popper">
    <template #reference>
      <el-button size="small" plain :type="isCustom ? 'primary' : 'default'" :title="summary || '多条件排序'">
        <el-icon><Sort /></el-icon>排序<span v-if="modelValue.length" class="multi-sort__count">{{ modelValue.length }}</span>
      </el-button>
    </template>

    <div class="multi-sort">
      <div class="multi-sort__title">多条件排序<span class="multi-sort__hint">先按第一排序，相同时再按第二排序，依此类推</span></div>
      <div v-for="(level, index) in draft" :key="index" class="multi-sort__row">
        <span class="multi-sort__ordinal">{{ ordinal(index) }}排序</span>
        <el-select v-model="level.key" size="small" filterable placeholder="选择排序列" class="multi-sort__select">
          <el-option v-for="o in options" :key="o.key" :label="o.label" :value="o.key" :disabled="usedElsewhere(o.key, index)" />
        </el-select>
        <el-radio-group v-model="level.order" size="small" class="multi-sort__order">
          <el-radio-button value="asc">升序</el-radio-button>
          <el-radio-button value="desc">降序</el-radio-button>
        </el-radio-group>
        <el-button link size="small" :disabled="index === 0" title="上移" @click="move(index, -1)"><el-icon><ArrowUp /></el-icon></el-button>
        <el-button link size="small" :disabled="index === draft.length - 1" title="下移" @click="move(index, 1)"><el-icon><ArrowDown /></el-icon></el-button>
        <el-button link size="small" type="danger" title="删除此级" @click="draft.splice(index, 1)"><el-icon><Close /></el-icon></el-button>
      </div>
      <div v-if="!draft.length" class="multi-sort__empty">未设置排序条件，点击「添加排序级」</div>
      <div class="multi-sort__footer">
        <el-button size="small" :disabled="!canAdd" @click="addLevel"><el-icon><Plus /></el-icon>添加排序级</el-button>
        <span class="multi-sort__spacer" />
        <el-button size="small" @click="resetToDefault">恢复默认</el-button>
        <el-button size="small" type="primary" @click="apply">应用</el-button>
      </div>
    </div>
  </el-popover>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Sort, Plus, Close, ArrowUp, ArrowDown } from '@element-plus/icons-vue'
import { MAX_SORT_LEVELS, describeSortKeys, normalizeSortKeys, sameSortKeys, type SortKey, type SortOption } from '@/utils/multiSort'

const props = withDefaults(defineProps<{
  options: SortOption[]
  modelValue: SortKey[]
  /** 默认排序（「恢复默认」回到它；与默认相同时按钮不高亮） */
  defaultKeys?: SortKey[]
  maxLevels?: number
}>(), { defaultKeys: () => [], maxLevels: MAX_SORT_LEVELS })

const emit = defineEmits<{ 'update:modelValue': [value: SortKey[]]; change: [value: SortKey[]] }>()

const visible = ref(false)
const draft = ref<Array<{ key: string; order: 'asc' | 'desc' }>>([])

const ORDINALS = ['第一', '第二', '第三', '第四', '第五', '第六', '第七', '第八']
const ordinal = (i: number) => ORDINALS[i] || `第${i + 1}`
const optionKeys = computed(() => props.options.map(o => o.key))
const summary = computed(() => describeSortKeys(props.modelValue, props.options))
const isCustom = computed(() => props.modelValue.length > 0 && !sameSortKeys(props.modelValue, props.defaultKeys))
const canAdd = computed(() => draft.value.length < props.maxLevels && props.options.some(o => !draft.value.some(l => l.key === o.key)))

// 打开前先用当前设置填充草稿（watch 在渲染前执行，避免弹层闪现空内容）
watch(visible, v => { if (v) syncDraft() })
function syncDraft() {
  draft.value = normalizeSortKeys(props.modelValue, optionKeys.value, props.maxLevels).map(k => ({ ...k }))
}
const usedElsewhere = (key: string, index: number) => draft.value.some((l, i) => i !== index && l.key === key)

function addLevel() {
  const next = props.options.find(o => !draft.value.some(l => l.key === o.key))
  if (next) draft.value.push({ key: next.key, order: 'asc' })
}
function move(index: number, delta: number) {
  const target = index + delta
  if (target < 0 || target >= draft.value.length) return
  const [item] = draft.value.splice(index, 1)
  draft.value.splice(target, 0, item)
}
function commit(keys: SortKey[]) {
  emit('update:modelValue', keys)
  emit('change', keys)
  visible.value = false
}
function apply() {
  commit(normalizeSortKeys(draft.value.filter(l => l.key), optionKeys.value, props.maxLevels))
}
function resetToDefault() {
  draft.value = props.defaultKeys.map(k => ({ ...k }))
  commit(normalizeSortKeys(props.defaultKeys, optionKeys.value, props.maxLevels))
}
</script>

<style scoped>
.multi-sort__count {
  display: inline-block; min-width: 14px; margin-left: 4px; padding: 0 4px; border-radius: 8px;
  background: var(--el-color-primary); color: #fff; font-size: 11px; line-height: 14px; text-align: center;
}
.multi-sort__title { font-weight: 600; margin-bottom: 8px; }
.multi-sort__hint { margin-left: 8px; font-weight: 400; font-size: 12px; color: var(--el-text-color-placeholder); }
.multi-sort__row { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; }
.multi-sort__ordinal { flex: none; width: 56px; color: var(--el-text-color-regular); font-size: 13px; }
.multi-sort__select { flex: 1; min-width: 0; }
.multi-sort__order { flex: none; }
.multi-sort__empty { padding: 10px 0; color: var(--el-text-color-placeholder); font-size: 12px; }
.multi-sort__footer { display: flex; align-items: center; margin-top: 10px; padding-top: 8px; border-top: 1px solid var(--el-border-color-lighter); }
.multi-sort__spacer { flex: 1; }
</style>
