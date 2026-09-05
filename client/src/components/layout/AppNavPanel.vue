<template>
  <div class="app-nav-panel" :class="{ 'is-floating': !pinned }">
    <div class="app-nav-panel__head">
      <div class="app-nav-panel__title-row">
        <span v-if="app" class="app-nav-panel__app-icon">
          <component :is="resolveNavIcon(app.icon)" :size="16" :stroke-width="1.9" />
        </span>
        <span class="app-nav-panel__title">{{ app ? app.title : '全部应用' }}</span>
        <button
          v-if="app"
          type="button"
          class="app-nav-panel__home"
          title="打开模块首页"
          @click="emit('open-home', app)"
        >
          <component :is="resolveNavIcon('LayoutDashboard')" :size="14" :stroke-width="1.9" />
        </button>
      </div>
      <p v-if="app?.description" class="app-nav-panel__desc">{{ app.description }}</p>
      <label class="app-nav-panel__search">
        <component :is="resolveNavIcon('Search')" :size="14" :stroke-width="2" class="app-nav-panel__search-icon" />
        <input
          ref="searchInputRef"
          v-model="keyword"
          type="text"
          class="app-nav-panel__search-input"
          placeholder="搜索功能  Ctrl+K"
          autocomplete="off"
          spellcheck="false"
          @keydown.down.prevent="moveHighlight(1)"
          @keydown.up.prevent="moveHighlight(-1)"
          @keydown.enter.prevent="confirmHighlight"
          @keydown.esc.prevent="clearSearch"
        />
        <button v-if="keyword" type="button" class="app-nav-panel__search-clear" title="清除" @click="clearSearch">
          <component :is="resolveNavIcon('X')" :size="12" :stroke-width="2.2" />
        </button>
      </label>
    </div>

    <div class="app-nav-panel__body">
      <!-- 搜索结果 -->
      <template v-if="keyword.trim()">
        <div v-if="searchResults.length" class="app-nav-panel__results">
          <button
            v-for="(hit, index) in searchResults"
            :key="hit.item.path"
            type="button"
            class="app-nav-panel__result"
            :class="{ 'is-highlight': index === highlightIndex }"
            @mouseenter="highlightIndex = index; emit('preload', hit.item.path)"
            @click="navigate(hit.item.path)"
          >
            <span class="app-nav-panel__result-icon">
              <component :is="resolveNavIcon(hit.item.icon)" :size="15" :stroke-width="1.9" />
            </span>
            <span class="app-nav-panel__result-text">
              <span class="app-nav-panel__result-title">{{ hit.item.title }}</span>
              <span class="app-nav-panel__result-crumb">{{ hit.app.title }} › {{ hit.section.label }}</span>
            </span>
          </button>
        </div>
        <div v-else class="app-nav-panel__empty">没有匹配「{{ keyword }}」的功能</div>
      </template>

      <!-- 当前应用的分组与页面 -->
      <template v-else-if="app">
        <section v-for="section in app.sections" :key="section.key" class="app-nav-panel__section">
          <h4 class="app-nav-panel__section-title">{{ section.label }}</h4>
          <ul class="app-nav-panel__items">
            <li v-for="item in section.items" :key="item.path">
              <button
                type="button"
                class="app-nav-panel__item"
                :class="{ 'is-active': item.path === activeMenu }"
                :title="item.title"
                @mouseenter="emit('preload', item.path)"
                @focus="emit('preload', item.path)"
                @click="navigate(item.path)"
              >
                <span class="app-nav-panel__item-icon">
                  <component :is="resolveNavIcon(item.icon)" :size="15" :stroke-width="1.9" />
                </span>
                <span class="app-nav-panel__item-label">{{ item.title }}</span>
              </button>
            </li>
          </ul>
        </section>
      </template>

      <!-- 未选择应用（工作台）：列出全部应用 -->
      <template v-else>
        <ul class="app-nav-panel__apps">
          <li v-for="entry in apps" :key="entry.key">
            <button type="button" class="app-nav-panel__app" @click="emit('open-home', entry)" @mouseenter="emit('preload-app', entry)">
              <span class="app-nav-panel__app-badge">
                <component :is="resolveNavIcon(entry.icon)" :size="16" :stroke-width="1.9" />
              </span>
              <span class="app-nav-panel__app-text">
                <span class="app-nav-panel__app-title">{{ entry.title }}</span>
                <span class="app-nav-panel__app-count">{{ countItems(entry) }} 项功能</span>
              </span>
              <component :is="resolveNavIcon('ChevronRight')" :size="14" :stroke-width="2" class="app-nav-panel__app-arrow" />
            </button>
          </li>
        </ul>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { NavApp, NavItem, NavSection } from '@/config/navigation'
import { resolveNavIcon } from '@/config/navIcons'

interface SearchHit {
  app: NavApp
  section: NavSection
  item: NavItem
  score: number
}

const props = defineProps<{
  /** 当前展示的应用；为空时展示全部应用列表 */
  app: NavApp | null
  /** 全部可见应用（用于搜索与「全部应用」列表） */
  apps: NavApp[]
  /** 当前高亮菜单路径（含查询串） */
  activeMenu: string
  pinned: boolean
}>()

const emit = defineEmits<{
  (e: 'navigate', path: string): void
  (e: 'open-home', app: NavApp): void
  (e: 'preload', path: string): void
  (e: 'preload-app', app: NavApp): void
}>()

const keyword = ref('')
const highlightIndex = ref(0)
const searchInputRef = ref<HTMLInputElement | null>(null)

const searchResults = computed<SearchHit[]>(() => {
  const raw = keyword.value.trim().toLowerCase()
  if (!raw) return []
  const hits: SearchHit[] = []
  for (const app of props.apps) {
    for (const section of app.sections) {
      for (const item of section.items) {
        const title = item.title.toLowerCase()
        let score = -1
        if (title === raw) score = 100
        else if (title.startsWith(raw)) score = 80
        else if (title.includes(raw)) score = 60
        else if (`${app.title}${section.label}`.toLowerCase().includes(raw)) score = 30
        else if (item.path.toLowerCase().includes(raw)) score = 10
        if (score >= 0) hits.push({ app, section, item, score })
      }
    }
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, 30)
})

watch(searchResults, () => {
  highlightIndex.value = 0
})

function moveHighlight(delta: number) {
  const total = searchResults.value.length
  if (!total) return
  highlightIndex.value = (highlightIndex.value + delta + total) % total
}

function confirmHighlight() {
  const hit = searchResults.value[highlightIndex.value]
  if (hit) navigate(hit.item.path)
}

function navigate(path: string) {
  emit('navigate', path)
  clearSearch()
}

function clearSearch() {
  keyword.value = ''
  highlightIndex.value = 0
}

function countItems(app: NavApp): number {
  return app.sections.reduce((n, s) => n + s.items.length, 0)
}

function focusSearch() {
  searchInputRef.value?.focus()
  searchInputRef.value?.select()
}

defineExpose({ focusSearch, clearSearch })
</script>

<style scoped>
.app-nav-panel {
  width: var(--app-nav-panel-width, 220px);
  flex: 0 0 var(--app-nav-panel-width, 220px);
  height: 100%;
  display: flex;
  flex-direction: column;
  background: #f6f8fa;
  border-right: 1px solid rgba(0, 0, 0, 0.06);
  color: #2b3038;
}

.app-nav-panel.is-floating {
  box-shadow: 12px 0 32px rgba(15, 61, 58, 0.16);
}

.app-nav-panel__head {
  flex-shrink: 0;
  padding: 12px 12px 10px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.05);
  background: #fff;
}

.app-nav-panel__title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 24px;
}

.app-nav-panel__app-icon {
  display: inline-flex;
  width: 24px;
  height: 24px;
  border-radius: 7px;
  align-items: center;
  justify-content: center;
  background: rgba(18, 199, 174, 0.14);
  color: #0f9f8c;
}

.app-nav-panel__title {
  font-size: 15px;
  font-weight: 700;
  color: #1a1f26;
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.app-nav-panel__home {
  width: 24px;
  height: 24px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: #8c939d;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

.app-nav-panel__home:hover {
  background: rgba(18, 199, 174, 0.12);
  color: #0f9f8c;
}

.app-nav-panel__desc {
  margin: 4px 0 0 32px;
  font-size: 11px;
  color: #8c939d;
  line-height: 1.4;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.app-nav-panel__search {
  margin-top: 10px;
  display: flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 8px;
  border-radius: 8px;
  background: #f1f4f7;
  border: 1px solid transparent;
  transition: border-color 0.18s ease, background 0.18s ease;
}

.app-nav-panel__search:focus-within {
  background: #fff;
  border-color: rgba(18, 199, 174, 0.55);
}

.app-nav-panel__search-icon {
  color: #8c939d;
  flex-shrink: 0;
}

.app-nav-panel__search-input {
  flex: 1;
  min-width: 0;
  border: none;
  background: transparent;
  font-size: 12px;
  color: #1a1f26;
  outline: none;
}

.app-nav-panel__search-input::placeholder {
  color: #a3aab4;
}

.app-nav-panel__search-clear {
  width: 18px;
  height: 18px;
  border: none;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.06);
  color: #6b7280;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

.app-nav-panel__body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: 8px 8px 16px;
}

.app-nav-panel__body::-webkit-scrollbar {
  width: 4px;
}

.app-nav-panel__body::-webkit-scrollbar-thumb {
  background: rgba(18, 199, 174, 0.25);
  border-radius: 2px;
}

.app-nav-panel__section + .app-nav-panel__section {
  margin-top: 10px;
}

.app-nav-panel__section-title {
  margin: 6px 8px 4px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.6px;
  color: #8c939d;
  text-transform: uppercase;
}

.app-nav-panel__items {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.app-nav-panel__item {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  height: 34px;
  padding: 0 8px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: #3a4048;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
  transition: background 0.16s ease, color 0.16s ease;
}

.app-nav-panel__item:hover {
  background: rgba(18, 199, 174, 0.1);
  color: #0f7f72;
}

.app-nav-panel__item.is-active {
  background: #fff;
  color: #0f9f8c;
  font-weight: 600;
  box-shadow: 0 1px 4px rgba(15, 61, 58, 0.08), inset 3px 0 0 #12c7ae;
}

.app-nav-panel__item:focus-visible {
  outline: 2px solid rgba(18, 199, 174, 0.6);
  outline-offset: -2px;
}

.app-nav-panel__item-icon {
  display: inline-flex;
  width: 18px;
  justify-content: center;
  color: inherit;
  opacity: 0.85;
  flex-shrink: 0;
}

.app-nav-panel__item-label {
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 搜索结果 */
.app-nav-panel__results {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.app-nav-panel__result {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 8px;
  border: none;
  border-radius: 8px;
  background: transparent;
  text-align: left;
  cursor: pointer;
  color: #3a4048;
}

.app-nav-panel__result:hover,
.app-nav-panel__result.is-highlight {
  background: #fff;
  box-shadow: 0 1px 4px rgba(15, 61, 58, 0.08);
}

.app-nav-panel__result-icon {
  display: inline-flex;
  width: 26px;
  height: 26px;
  border-radius: 7px;
  align-items: center;
  justify-content: center;
  background: rgba(18, 199, 174, 0.12);
  color: #0f9f8c;
  flex-shrink: 0;
}

.app-nav-panel__result-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.app-nav-panel__result-title {
  font-size: 13px;
  font-weight: 600;
  color: #1a1f26;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.app-nav-panel__result-crumb {
  font-size: 11px;
  color: #8c939d;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.app-nav-panel__empty {
  padding: 24px 12px;
  text-align: center;
  font-size: 12px;
  color: #8c939d;
}

/* 全部应用列表 */
.app-nav-panel__apps {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.app-nav-panel__app {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px;
  border: none;
  border-radius: 10px;
  background: transparent;
  text-align: left;
  cursor: pointer;
  color: #3a4048;
  transition: background 0.16s ease;
}

.app-nav-panel__app:hover {
  background: #fff;
  box-shadow: 0 1px 4px rgba(15, 61, 58, 0.08);
}

.app-nav-panel__app-badge {
  display: inline-flex;
  width: 32px;
  height: 32px;
  border-radius: 9px;
  align-items: center;
  justify-content: center;
  background: rgba(18, 199, 174, 0.14);
  color: #0f9f8c;
  flex-shrink: 0;
}

.app-nav-panel__app-text {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
}

.app-nav-panel__app-title {
  font-size: 13px;
  font-weight: 600;
  color: #1a1f26;
}

.app-nav-panel__app-count {
  font-size: 11px;
  color: #8c939d;
}

.app-nav-panel__app-arrow {
  color: #b5bcc6;
  flex-shrink: 0;
}
</style>
