<template>
  <div class="nav-search" :class="{ 'is-open': hasKeyword }">
    <label class="nav-search__box">
      <component :is="resolveNavIcon('Search')" :size="15" :stroke-width="2" class="nav-search__icon" />
      <input
        ref="inputRef"
        v-model="keyword"
        type="text"
        class="nav-search__input"
        :placeholder="placeholder"
        autocomplete="off"
        spellcheck="false"
        @keydown.down.prevent="moveHighlight(1)"
        @keydown.up.prevent="moveHighlight(-1)"
        @keydown.enter.prevent="confirmHighlight"
        @keydown.esc.prevent="clearSearch"
      />
      <button v-if="hasKeyword" type="button" class="nav-search__clear" title="清除" @click="clearSearch">
        <component :is="resolveNavIcon('X')" :size="12" :stroke-width="2.2" />
      </button>
    </label>

    <!-- 结果直接排在输入框下方（页面内联，不使用浮层/弹窗） -->
    <div v-if="hasKeyword" class="nav-search__panel">
      <div v-if="results.length" ref="listRef" class="nav-search__list">
        <router-link
          v-for="(hit, index) in results"
          :key="hit.item.path"
          :to="hit.item.path"
          class="nav-search__hit"
          :class="{ 'is-highlight': index === highlightIndex }"
          @mouseenter="highlightIndex = index"
          @click="onHitClick(hit.item.path)"
        >
          <span class="nav-search__hit-icon">
            <component :is="resolveNavIcon(hit.item.icon)" :size="15" :stroke-width="1.9" />
          </span>
          <span class="nav-search__hit-text">
            <span class="nav-search__hit-title">{{ hit.item.title }}</span>
            <span class="nav-search__hit-crumb">{{ hit.app.title }} › {{ hit.section.label }}</span>
          </span>
          <span v-if="hit.isCurrentApp" class="nav-search__hit-tag">本模块</span>
        </router-link>
      </div>
      <div v-else class="nav-search__empty">没有匹配「{{ keyword }}」的功能</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import type { NavApp, NavItem, NavSection } from '@/config/navigation'
import { resolveNavIcon } from '@/config/navIcons'

interface SearchHit {
  app: NavApp
  section: NavSection
  item: NavItem
  score: number
  isCurrentApp: boolean
}

const props = withDefaults(
  defineProps<{
    /** 全部可见应用（跨模块搜索） */
    apps: NavApp[]
    /** 当前所在模块的 key，命中时加权并标注「本模块」 */
    currentAppKey?: string
    placeholder?: string
    /** 结果条数上限 */
    limit?: number
  }>(),
  { currentAppKey: '', placeholder: '搜索功能  Ctrl+K', limit: 30 }
)

const emit = defineEmits<{ (e: 'navigate', path: string): void }>()

const keyword = ref('')
const highlightIndex = ref(0)
const inputRef = ref<HTMLInputElement | null>(null)
const listRef = ref<HTMLElement | null>(null)

const hasKeyword = computed(() => keyword.value.trim().length > 0)

/** 打分规则与原导航面板一致：完全匹配 > 前缀 > 包含 > 模块/分组名 > 路径；本模块再加 5 分 */
const results = computed<SearchHit[]>(() => {
  const raw = keyword.value.trim().toLowerCase()
  if (!raw) return []
  const hits: SearchHit[] = []
  for (const app of props.apps) {
    const isCurrentApp = !!props.currentAppKey && app.key === props.currentAppKey
    for (const section of app.sections) {
      for (const item of section.items) {
        const title = item.title.toLowerCase()
        let score = -1
        if (title === raw) score = 100
        else if (title.startsWith(raw)) score = 80
        else if (title.includes(raw)) score = 60
        else if (`${app.title}${section.label}`.toLowerCase().includes(raw)) score = 30
        else if (item.path.toLowerCase().includes(raw)) score = 10
        if (score >= 0) hits.push({ app, section, item, score: score + (isCurrentApp ? 5 : 0), isCurrentApp })
      }
    }
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, props.limit)
})

watch(results, () => {
  highlightIndex.value = 0
})

function moveHighlight(delta: number) {
  const total = results.value.length
  if (!total) return
  highlightIndex.value = (highlightIndex.value + delta + total) % total
}

/** 回车：直接点击高亮那条 router-link，避免组件自己依赖 router 实例 */
function confirmHighlight() {
  const hit = results.value[highlightIndex.value]
  if (!hit) return
  const el = listRef.value?.querySelectorAll<HTMLElement>('.nav-search__hit')[highlightIndex.value]
  if (el) {
    el.click()
    return
  }
  emit('navigate', hit.item.path)
  clearSearch()
}

function onHitClick(path: string) {
  emit('navigate', path)
  void nextTick(clearSearch)
}

function clearSearch() {
  keyword.value = ''
  highlightIndex.value = 0
}

function focus() {
  inputRef.value?.focus()
  inputRef.value?.select()
}

defineExpose({ focus, clearSearch })
</script>

<style scoped>
.nav-search {
  position: relative;
  width: 100%;
}

.nav-search__box {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 8px;
  border: 1px solid rgba(0, 0, 0, 0.1);
  border-radius: 8px;
  background: #fff;
  transition: border-color 0.18s ease, box-shadow 0.18s ease;
}

.nav-search__box:focus-within {
  border-color: #12c7ae;
  box-shadow: 0 0 0 3px rgba(18, 199, 174, 0.14);
}

.nav-search__icon {
  flex-shrink: 0;
  color: #8a929c;
}

.nav-search__input {
  flex: 1 1 auto;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  font-size: var(--cw-text-base);
  color: #2b3038;
}

.nav-search__clear {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border: none;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.06);
  color: #6b7280;
  cursor: pointer;
  padding: 0;
}

.nav-search__panel {
  margin-top: 8px;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 10px;
  background: #fff;
  overflow: hidden;
}

.nav-search__list {
  max-height: 320px;
  overflow-y: auto;
}

.nav-search__hit {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 10px;
  border: none;
  background: transparent;
  cursor: pointer;
  text-align: left;
}

.nav-search__hit + .nav-search__hit {
  border-top: 1px solid rgba(0, 0, 0, 0.04);
}

.nav-search__hit.is-highlight {
  background: rgba(18, 199, 174, 0.1);
}

.nav-search__hit-icon {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: 7px;
  background: rgba(18, 199, 174, 0.12);
  color: #0f9c8a;
}

.nav-search__hit-text {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.nav-search__hit-title {
  font-size: var(--cw-text-base);
  color: #2b3038;
  line-height: 1.2;
}

.nav-search__hit-crumb {
  font-size: var(--cw-text-xs);
  color: #8a929c;
  line-height: 1.2;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nav-search__hit-tag {
  flex-shrink: 0;
  font-size: var(--cw-text-xs);
  color: #0f9c8a;
  background: rgba(18, 199, 174, 0.12);
  border-radius: 4px;
  padding: 1px 5px;
}

.nav-search__empty {
  padding: 14px 10px;
  font-size: var(--cw-text-sm);
  color: #8a929c;
  text-align: center;
}
</style>
