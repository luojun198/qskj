<template>
  <el-autocomplete
    ref="autocompleteRef"
    :model-value="inputText"
    :fetch-suggestions="queryAccountSuggestions"
    :placeholder="placeholder"
    style="width: 100%"
    clearable
    @update:model-value="onInputChange"
    @select="handleSelect"
  >
    <!-- 下拉项自定义渲染 -->
    <template #default="{ item }">
      <div
        class="account-suggestion-item"
        :class="{ 'is-parent-account': item.isParent }"
        :style="{ cursor: item.isParent ? 'not-allowed' : 'pointer' }"
        @mousedown="onSuggestionPointer(item, $event)"
        @click="onSuggestionPointer(item, $event)"
      >
        <span
          :style="{
            color: item.isParent ? '#c0c4cc' : '#303133',
            fontStyle: item.isParent ? 'italic' : 'normal',
          }"
        >
          {{ item.code }} {{ item.name }}
        </span>
        <span
          v-if="item.isParent"
          style="color: #c0c4cc; font-size: 11px; margin-left: 4px"
        >
          (父科目)
        </span>
      </div>
    </template>

    <!-- 一键搜索按钮（仅在传入 searchKeyword 时显示） -->
    <template v-if="props.searchKeyword" #suffix>
      <el-icon
        class="account-select-search-btn"
        :title="`搜索「${props.searchKeyword}」`"
        @mousedown.prevent
        @click="triggerKeywordSearch"
      >
        <Search />
      </el-icon>
    </template>
  </el-autocomplete>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, nextTick } from 'vue'
import { Search } from '@element-plus/icons-vue'
import { useBaseDataStore } from '@/stores/baseData'

/**
 * 通用会计科目选择组件
 * 复用凭证录入页面的科目智能输入逻辑（叶子科目 + 父科目分组标题，仅可选叶子科目）。
 * v-model 绑定科目编码（string）。
 *
 * searchKeyword：传入后在输入框右侧显示搜索图标，点击可按关键字一键筛选候选科目。
 */
const props = withDefaults(
  defineProps<{
    modelValue?: string | null
    placeholder?: string
    /** 仅允许选择指定方向的叶子科目，可选 */
    direction?: 'debit' | 'credit'
    /** 一键搜索关键字；有值时在输入框右侧显示搜索按钮 */
    searchKeyword?: string
  }>(),
  {
    modelValue: '',
    placeholder: '输入科目编码或名称',
  }
)

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
  (e: 'change', account: any | null): void
}>()

const autocompleteRef = ref<any>(null)
/** 一键搜索时强制使用的查询词，优先于 el-autocomplete 传入的 queryString */
const forcedQuery = ref<string | null>(null)

const baseDataStore = useBaseDataStore()
const accounts = computed(() => baseDataStore.accounts)

// 父科目集合：凡是作为其它科目 parent_id 出现的，即为父科目
const parentIdSet = computed(
  () => new Set(accounts.value.filter((a: any) => a.parent_id).map((a: any) => String(a.parent_id)))
)
function isParentAccount(id: string | number) {
  return parentIdSet.value.has(String(id))
}

// 输入框显示文本
const inputText = ref('')

function resolveDisplayFromCode(code: string | null | undefined): string {
  if (!code) return ''
  const acc = accounts.value.find((a: any) => String(a.code) === String(code))
  return acc ? `${acc.code} ${acc.name}` : String(code)
}

// modelValue / accounts 变化时同步显示文本
watch(
  () => [props.modelValue, accounts.value.length] as const,
  () => {
    inputText.value = resolveDisplayFromCode(props.modelValue)
  },
  { immediate: true }
)

onMounted(async () => {
  await baseDataStore.loadAccounts()
  inputText.value = resolveDisplayFromCode(props.modelValue)
})

type AccountSuggestion = {
  value: string
  id: string | number
  code: string
  name: string
  isParent: boolean
}

function buildLeaf(acc: any): AccountSuggestion {
  return {
    value: `${acc.code} ${acc.name}`,
    id: acc.id,
    code: acc.code,
    name: acc.name,
    isParent: false,
  }
}

function buildParentHeader(acc: any): AccountSuggestion {
  return {
    value: `__parent__${acc.id}`,
    id: acc.id,
    code: acc.code,
    name: acc.name,
    isParent: true,
  }
}

function matchDirection(acc: any): boolean {
  if (!props.direction) return true
  return acc.direction === props.direction
}

function queryAccountSuggestions(
  queryString: string,
  cb: (items: AccountSuggestion[]) => void
) {
  // 一键搜索时优先使用 forcedQuery，用完即清空
  const rawQuery = forcedQuery.value !== null ? forcedQuery.value : queryString
  forcedQuery.value = null
  const query = (rawQuery || '').trim().toLowerCase()

  const leafAccounts = accounts.value.filter(
    (a: any) => !isParentAccount(a.id) && matchDirection(a)
  )
  const parentAccounts = accounts.value.filter((a: any) => isParentAccount(a.id))

  if (!query) {
    const result: AccountSuggestion[] = []
    const addedParents = new Set<string>()
    for (const leaf of leafAccounts) {
      const parent = parentAccounts.find(
        (p: any) =>
          String(leaf.code || '').startsWith(String(p.code || '')) && leaf.id !== p.id
      )
      if (parent && !addedParents.has(String(parent.id))) {
        result.push(buildParentHeader(parent))
        addedParents.add(String(parent.id))
      }
      result.push(buildLeaf(leaf))
    }
    cb(result)
    return
  }

  const matchedLeaf = leafAccounts.filter((a: any) => {
    const code = String(a.code || '').toLowerCase()
    const name = String(a.name || '').toLowerCase()
    return code.includes(query) || name.includes(query)
  })

  const matchedParent = parentAccounts.filter((a: any) => {
    const code = String(a.code || '').toLowerCase()
    const name = String(a.name || '').toLowerCase()
    return code.includes(query) || name.includes(query)
  })

  // 匹配到父科目时，把其下所有叶子科目也加入结果
  if (matchedParent.length > 0) {
    const matchedLeafIds = new Set(matchedLeaf.map((a: any) => a.id))
    for (const parent of matchedParent) {
      const parentCode = String(parent.code || '')
      for (const leaf of leafAccounts) {
        if (!matchedLeafIds.has(leaf.id) && String(leaf.code || '').startsWith(parentCode)) {
          matchedLeaf.push(leaf)
          matchedLeafIds.add(leaf.id)
        }
      }
    }
  }

  matchedLeaf.sort((a: any, b: any) => {
    const aCode = String(a.code || '').toLowerCase()
    const bCode = String(b.code || '').toLowerCase()
    const aName = String(a.name || '').toLowerCase()
    const bName = String(b.name || '').toLowerCase()

    const aCodeStarts = aCode.startsWith(query) ? 0 : 1
    const bCodeStarts = bCode.startsWith(query) ? 0 : 1
    if (aCodeStarts !== bCodeStarts) return aCodeStarts - bCodeStarts

    const aNameStarts = aName.startsWith(query) ? 0 : 1
    const bNameStarts = bName.startsWith(query) ? 0 : 1
    if (aNameStarts !== bNameStarts) return aNameStarts - bNameStarts

    return aCode.localeCompare(bCode, 'zh-CN')
  })

  const result: AccountSuggestion[] = []
  const addedParents = new Set<string>()
  for (const leaf of matchedLeaf) {
    const parent = parentAccounts.find(
      (p: any) => String(leaf.code || '').startsWith(String(p.code || '')) && leaf.id !== p.id
    )
    if (parent && !addedParents.has(String(parent.id))) {
      result.push(buildParentHeader(parent))
      addedParents.add(String(parent.id))
    }
    result.push(buildLeaf(leaf))
  }
  for (const parent of matchedParent) {
    if (!addedParents.has(String(parent.id))) {
      result.push(buildParentHeader(parent))
    }
  }
  cb(result)
}

function onInputChange(val: string | number) {
  inputText.value = String(val ?? '')
  const trimmed = inputText.value.trim()

  if (!trimmed) {
    emit('update:modelValue', '')
    emit('change', null)
    return
  }

  // 完全等于科目编码 → 自动选中
  const exactCode = accounts.value.find(
    (a: any) => String(a.code || '') === trimmed && !isParentAccount(a.id) && matchDirection(a)
  )
  if (exactCode) {
    applySelected(exactCode)
    return
  }

  // 完全等于科目名称且唯一 → 自动选中
  const exactNameMatches = accounts.value.filter(
    (a: any) => String(a.name || '') === trimmed && !isParentAccount(a.id) && matchDirection(a)
  )
  if (exactNameMatches.length === 1) {
    applySelected(exactNameMatches[0])
  }
}

function handleSelect(item: any) {
  if (!item) return
  if (item.isParent) return
  if (String(item.value).startsWith('__parent__')) return
  const acc = accounts.value.find((a: any) => a.id === item.id)
  if (!acc || isParentAccount(acc.id)) return
  applySelected(acc)
}

/** 阻止父科目标题行的点击冒泡，避免误选中 */
function onSuggestionPointer(item: any, e: MouseEvent) {
  if (!item?.isParent && !String(item?.value || '').startsWith('__parent__')) return
  e.preventDefault()
  e.stopPropagation()
}

function applySelected(acc: any) {
  inputText.value = `${acc.code} ${acc.name}`
  emit('update:modelValue', String(acc.code))
  emit('change', acc)
}

/**
 * 一键搜索：将 searchKeyword 填入输入框并触发过滤后的下拉候选列表。
 *
 * 原理：先更新 inputText（Vue 响应式），等 nextTick DOM 刷新完毕后再聚焦。
 * 此时 el-autocomplete 内部的 currentValue 已同步为关键字，
 * triggerOnFocus 机制调用 fetch-suggestions(keyword) 即可得到正确的过滤结果。
 */
/**
 * 一键搜索：
 * 1. 设置 forcedQuery，使下次 queryAccountSuggestions 调用强制使用关键字过滤
 * 2. 把输入框显示文本改为关键字
 * 3. 聚焦输入框 → el-autocomplete 的 triggerOnFocus 触发 fetch-suggestions
 *    → queryAccountSuggestions 读取 forcedQuery → 返回过滤后的候选列表
 */
/**
 * 一键搜索：
 * 1. 设置 forcedQuery，确保 queryAccountSuggestions 使用关键字而非空串过滤
 * 2. 更新 inputText（Vue 响应式，nextTick 后 DOM 会同步）
 * 3. 通过 .click() 触发 el-autocomplete 的 triggerOnFocus → queryAccountSuggestions(keyword)
 *    注：focus-trap 会抢回焦点，但 click() 已触发 suggestions 弹出，不影响下拉显示
 */
function triggerKeywordSearch() {
  if (!props.searchKeyword) return
  forcedQuery.value = props.searchKeyword
  inputText.value = props.searchKeyword
  
  // 手动触发搜索
  if (autocompleteRef.value) {
    // 强制触发 el-autocomplete 的建议查询
    nextTick(() => {
      autocompleteRef.value.handleInput(props.searchKeyword)
      // 聚焦以显示下拉列表
      const inputEl = autocompleteRef.value?.$el?.querySelector('input') as HTMLInputElement | null
      inputEl?.focus()
    })
  }
}
</script>

<style scoped>
.account-select-search-btn {
  cursor: pointer;
  color: var(--el-color-primary);
  font-size: 14px;
  transition: opacity 0.15s;
}
.account-select-search-btn:hover {
  opacity: 0.7;
}
</style>
