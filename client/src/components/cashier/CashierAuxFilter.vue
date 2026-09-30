<template>
  <div class="cashier-aux-filter">
    <div class="aux-row">
      <span class="aux-label">辅助项目</span>
      <el-select
        :model-value="selectedCategoryIds"
        multiple
        collapse-tags
        collapse-tags-tooltip
        clearable
        placeholder="选择辅助类别（流水对方科目的辅助核算）"
        class="aux-category-select"
        :disabled="!categories.length"
        @update:model-value="onCategoriesChange"
      >
        <el-option
          v-for="c in categories"
          :key="c.id"
          :label="`${c.name}（${c.journal_count} 笔）`"
          :value="c.id"
        />
      </el-select>
      <span v-if="!categories.length" class="aux-hint">流水中暂无辅助项目数据</span>
    </div>

    <!-- 选中类别后才加载该类别的项目；大类别改关键词检索，不整表加载 -->
    <div v-for="sel in modelValue" :key="sel.categoryId" class="aux-row">
      <span class="aux-label aux-label--item">{{ categoryName(sel.categoryId) }}</span>
      <el-select
        :model-value="sel.itemIds"
        multiple
        filterable
        remote
        reserve-keyword
        collapse-tags
        collapse-tags-tooltip
        :max-collapse-tags="3"
        :remote-method="(kw: string) => search(sel.categoryId, kw)"
        :loading="!!loadingMap[sel.categoryId]"
        placeholder="不选 = 该类别任意项目；可输入编码 / 名称检索"
        class="aux-item-select"
        @visible-change="(v: boolean) => v && onOpen(sel.categoryId)"
        @update:model-value="(ids: string[]) => onItemsChange(sel.categoryId, ids)"
      >
        <el-option :value="AUX_NONE" label="（未指定）" />
        <el-option
          v-for="it in optionsOf(sel)"
          :key="it.id"
          :value="it.id"
          :label="it.label"
        />
      </el-select>
      <span v-if="totalMap[sel.categoryId] > PAGE_LIMIT" class="aux-hint">共 {{ totalMap[sel.categoryId] }} 项，请输入关键词检索</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, watch } from 'vue'
import { fetchAuxItemsPage } from '@/composables/useAuxItemsPage'
import { AUX_NONE, type AuxSelection } from '@/utils/cashierReportFilter'

interface Category { id: string; code: string; name: string; journal_count: number; item_count: number }
interface ItemOption { id: string; label: string }

const props = defineProps<{ modelValue: AuxSelection[]; categories: Category[] }>()
const emit = defineEmits<{ 'update:modelValue': [value: AuxSelection[]] }>()

/** 一次最多展示的项目数；超出提示用关键词检索（与总账辅助账筛选的检索上限同量级） */
const PAGE_LIMIT = 200

const itemsByCategory = reactive<Record<string, ItemOption[]>>({})
const loadingMap = reactive<Record<string, boolean>>({})
const totalMap = reactive<Record<string, number>>({})
/** id → 名称缓存：远程检索结果变化后，已选项仍能显示名称 */
const labelCache = reactive<Record<string, string>>({})

const selectedCategoryIds = computed(() => props.modelValue.map(s => s.categoryId))
const categoryName = (id: string) => props.categories.find(c => c.id === id)?.name || id

function toOption(item: any): ItemOption {
  const label = `${item.code || ''} ${item.name || ''}`.trim() || String(item.id)
  labelCache[item.id] = label
  return { id: item.id, label }
}

async function load(categoryId: string, keyword = '') {
  loadingMap[categoryId] = true
  try {
    const { items, total } = await fetchAuxItemsPage({ category_id: categoryId, keyword, pageSize: PAGE_LIMIT })
    itemsByCategory[categoryId] = items.map(toOption)
    if (!keyword) totalMap[categoryId] = total
  } finally {
    loadingMap[categoryId] = false
  }
}

/** 已选项（可能来自钻取 / 还原的筛选）在缓存里没有名称时，按 id 补取 */
async function ensureSelected(categoryId: string, ids: string[]) {
  const missing = ids.filter(id => id !== AUX_NONE && !labelCache[id])
  if (!missing.length) return
  const { items } = await fetchAuxItemsPage({ category_id: categoryId, ids: missing })
  items.forEach(toOption)
}

/** 下拉里展示：检索结果 + 已选项（保证已选项始终可见） */
function optionsOf(sel: AuxSelection): ItemOption[] {
  const list = itemsByCategory[sel.categoryId] || []
  const have = new Set(list.map(i => i.id))
  const selected = sel.itemIds
    .filter(id => id !== AUX_NONE && !have.has(id))
    .map(id => ({ id, label: labelCache[id] || id }))
  return [...selected, ...list]
}

function onCategoriesChange(ids: string[]) {
  const next: AuxSelection[] = ids.map(id => props.modelValue.find(s => s.categoryId === id) || { categoryId: id, itemIds: [] })
  emit('update:modelValue', next)
  ids.forEach(id => { if (!itemsByCategory[id]) void load(id) })
}

function onItemsChange(categoryId: string, itemIds: string[]) {
  emit('update:modelValue', props.modelValue.map(s => (s.categoryId === categoryId ? { ...s, itemIds } : s)))
}

let searchTimer: ReturnType<typeof setTimeout> | null = null
function search(categoryId: string, keyword: string) {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => { void load(categoryId, keyword.trim()) }, 300)
}

function onOpen(categoryId: string) {
  if (!itemsByCategory[categoryId]) void load(categoryId)
}

// 外部（钻取 / 清空 / 方案恢复）改动选择时，补齐项目列表和已选项名称
watch(
  () => props.modelValue,
  list => {
    for (const s of list) {
      if (!itemsByCategory[s.categoryId]) void load(s.categoryId)
      void ensureSelected(s.categoryId, s.itemIds)
    }
  },
  { immediate: true, deep: true }
)
</script>

<style scoped>
.cashier-aux-filter { display: flex; flex-direction: column; gap: 6px; }
.aux-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.aux-label { width: 64px; flex-shrink: 0; font-size: 12px; color: var(--el-text-color-secondary); text-align: right; }
.aux-label--item { color: var(--el-text-color-regular); font-weight: 600; }
.aux-category-select { width: 320px; max-width: 100%; }
.aux-item-select { width: 420px; max-width: 100%; }
.aux-hint { font-size: 12px; color: var(--el-text-color-placeholder); }
</style>
