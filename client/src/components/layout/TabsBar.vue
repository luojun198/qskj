<template>
  <div ref="barRef" class="tabs-bar">
    <div class="tabs-bar__primary">
      <div
        v-for="t in visibleTabs"
        :key="t.key"
        class="tab-item"
        :class="{ 'is-active': t.key === tabsStore.activeKey, 'is-pinned': t.pinned }"
        :title="t.title"
        @click="onClickTab(t)"
        @contextmenu.prevent="onContextMenu($event, t)"
        @mousedown.middle.prevent="!t.pinned && onClose(t)"
      >
        <span class="tab-item__dot" />
        <span class="tab-item__label">{{ t.title }}</span>
        <span v-if="!t.pinned" class="tab-item__close" title="关闭" @click.stop="onClose(t)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>
        </span>
      </div>
    </div>

    <!-- 当前页面可投递“列设置”等轻量操作。 -->
    <div id="tabbar-actions" class="tabs-bar__actions"></div>

    <el-popover v-model:visible="moreVisible" placement="bottom-end" :width="360" trigger="click">
      <template #reference>
        <button class="tabs-more-btn" :class="{ 'has-hidden': hiddenTabs.length > 0 }" type="button" :title="hiddenTabs.length ? `还有 ${hiddenTabs.length} 个标签` : '标签管理'">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></svg>
          <span>{{ hiddenTabs.length ? `更多 ${hiddenTabs.length}` : '标签' }}</span>
        </button>
      </template>

      <div class="tabs-more-panel">
        <div class="tabs-more-panel__head">
          <strong>{{ hiddenTabs.length ? `隐藏标签（${hiddenTabs.length}）` : '标签管理' }}</strong>
          <span>当前共 {{ tabsStore.tabs.length }} 个</span>
        </div>
        <el-input
          v-if="hiddenTabs.length > 4"
          v-model="searchText"
          size="small"
          clearable
          placeholder="搜索标签名称或地址"
          class="tabs-more-panel__search"
        />
        <div v-if="hiddenTabs.length" class="tabs-more-list">
          <div
            v-for="t in filteredHiddenTabs"
            :key="t.key"
            class="tabs-more-item"
            :title="t.fullPath"
            @click="onClickHiddenTab(t)"
          >
            <span class="tabs-more-item__dot" />
            <span class="tabs-more-item__content">
              <span class="tabs-more-item__title">{{ t.title }}</span>
              <span class="tabs-more-item__path">{{ t.fullPath }}</span>
            </span>
            <button v-if="!t.pinned" type="button" class="tabs-more-item__close" title="关闭标签" @click.stop="onClose(t)">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>
            </button>
          </div>
          <div v-if="!filteredHiddenTabs.length" class="tabs-more-empty">未找到匹配标签</div>
        </div>
        <div v-else class="tabs-more-empty">当前没有隐藏标签</div>

        <div class="tabs-more-actions">
          <el-button size="small" :disabled="!!tabsStore.activeTab?.pinned" @click="closeCurrent">关闭当前</el-button>
          <el-button size="small" @click="closeOthers">关闭其他</el-button>
          <el-button size="small" @click="closeAll">关闭全部</el-button>
        </div>
      </div>
    </el-popover>

    <!-- 右键菜单 -->
    <teleport to="body">
      <div v-if="ctx.visible" class="tab-ctx" :style="{ left: ctx.x + 'px', top: ctx.y + 'px' }">
        <div class="tab-ctx__item" @click="doRefresh">刷新当前</div>
        <div class="tab-ctx__item" :class="{ disabled: ctx.pinned }" @click="!ctx.pinned && doClose()">关闭</div>
        <div class="tab-ctx__item" @click="doCloseOthers">关闭其他</div>
        <div class="tab-ctx__item" @click="doCloseAll">关闭全部</div>
      </div>
    </teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { getVisibleTabKeys, useTabsStore, type TabItem } from '@/stores/tabs'

const tabsStore = useTabsStore()
const router = useRouter()
const barRef = ref<HTMLElement | null>(null)
const barWidth = ref(1024)
const moreVisible = ref(false)
const searchText = ref('')

const visibleLimit = computed(() => {
  if (barWidth.value >= 1200) return 7
  if (barWidth.value >= 900) return 5
  return 3
})
const visibleKeys = computed(() => getVisibleTabKeys(tabsStore.tabs, tabsStore.activeKey, visibleLimit.value))
const visibleTabs = computed(() => tabsStore.tabs.filter(t => visibleKeys.value.has(t.key)))
const hiddenTabs = computed(() => tabsStore.tabs.filter(t => !visibleKeys.value.has(t.key)))
const filteredHiddenTabs = computed(() => {
  const keyword = searchText.value.trim().toLowerCase()
  if (!keyword) return hiddenTabs.value
  return hiddenTabs.value.filter(t => t.title.toLowerCase().includes(keyword) || t.fullPath.toLowerCase().includes(keyword))
})

let resizeObserver: ResizeObserver | null = null
onMounted(() => {
  if (!barRef.value) return
  const updateWidth = () => { barWidth.value = barRef.value?.clientWidth || 1024 }
  updateWidth()
  resizeObserver = new ResizeObserver(updateWidth)
  resizeObserver.observe(barRef.value)
})

watch(moreVisible, visible => {
  if (!visible) searchText.value = ''
})

function onClickTab(t: TabItem) {
  if (t.key === tabsStore.activeKey) return
  router.push(t.fullPath)
}
function onClickHiddenTab(t: TabItem) {
  moreVisible.value = false
  onClickTab(t)
}
function onClose(t: TabItem) {
  const to = tabsStore.closeTab(t.key)
  if (to) router.push(to)
}
function closeCurrent() {
  const tab = tabsStore.activeTab
  if (!tab || tab.pinned) return
  const to = tabsStore.closeTab(tab.key)
  moreVisible.value = false
  if (to) router.push(to)
}
function closeOthers() {
  const to = tabsStore.closeOthers(tabsStore.activeKey)
  moreVisible.value = false
  if (to) router.push(to)
}
function closeAll() {
  const to = tabsStore.closeAll()
  moreVisible.value = false
  if (to) router.push(to)
}

const ctx = reactive({ visible: false, x: 0, y: 0, key: '', pinned: false })
function onContextMenu(e: MouseEvent, t: TabItem) {
  ctx.visible = true
  ctx.x = Math.min(e.clientX, window.innerWidth - 132)
  ctx.y = Math.min(e.clientY, window.innerHeight - 156)
  ctx.key = t.key
  ctx.pinned = t.pinned
  document.addEventListener('click', hideCtx, { once: true })
}
function hideCtx() { ctx.visible = false }
function doRefresh() { tabsStore.refreshTab(ctx.key); hideCtx() }
function doClose() {
  const to = tabsStore.closeTab(ctx.key)
  if (to) router.push(to)
  hideCtx()
}
function doCloseOthers() {
  const to = tabsStore.closeOthers(ctx.key)
  if (to) router.push(to)
  hideCtx()
}
function doCloseAll() {
  const to = tabsStore.closeAll()
  if (to) router.push(to)
  hideCtx()
}

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  document.removeEventListener('click', hideCtx)
})
</script>

<style scoped>
.tabs-bar {
  display: flex; align-items: center; gap: 8px; height: 38px; padding: 0 10px;
  background: var(--el-bg-color); border-bottom: 1px solid var(--el-border-color-light); flex-shrink: 0;
}
.tabs-bar__primary { display: flex; align-items: center; gap: 6px; overflow: hidden; height: 100%; flex: 1; min-width: 0; }
.tabs-bar__actions { flex-shrink: 0; display: flex; align-items: center; gap: 8px; }
.tabs-bar__actions:empty { display: none; }
.tab-item {
  display: inline-flex; align-items: center; gap: 6px; flex: 0 0 auto; min-width: 0; max-width: 180px;
  height: 28px; padding: 0 10px; border-radius: 14px; cursor: pointer; user-select: none;
  font-size: var(--cw-text-base); color: var(--el-text-color-regular); overflow: hidden;
  background: var(--el-fill-color-light); border: 1px solid transparent; transition: background .12s, color .12s, border-color .12s;
}
.tab-item.is-pinned { max-width: 120px; }
.tab-item:hover { background: var(--el-fill-color); }
.tab-item.is-active { color: #fff; background: var(--el-color-primary, #12C7AE); border-color: var(--el-color-primary, #12C7AE); }
.tab-item__dot, .tabs-more-item__dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; opacity: .55; flex-shrink: 0; }
.tab-item.is-active .tab-item__dot { opacity: 1; }
.tab-item__label { flex: 0 1 auto; white-space: nowrap; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.tab-item__close { display: inline-flex; width: 14px; height: 14px; border-radius: 50%; align-items: center; justify-content: center; opacity: .6; flex-shrink: 0; }
.tab-item__close:hover { opacity: 1; background: rgba(0,0,0,.12); }
.tab-item.is-active .tab-item__close:hover { background: rgba(255,255,255,.25); }
.tab-item__close svg, .tabs-more-item__close svg { width: 9px; height: 9px; }
.tabs-more-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 5px; flex-shrink: 0;
  height: 28px; padding: 0 10px; border: 1px solid var(--el-border-color); border-radius: 14px;
  background: var(--el-bg-color); color: var(--el-text-color-regular); font-size: 12px; cursor: pointer;
}
.tabs-more-btn:hover, .tabs-more-btn.has-hidden { color: var(--el-color-primary); border-color: var(--el-color-primary-light-5); background: var(--el-color-primary-light-9); }
.tabs-more-btn svg { width: 14px; height: 14px; }
.tabs-more-panel__head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
.tabs-more-panel__head strong { font-size: var(--cw-text-base); color: var(--el-text-color-primary); }
.tabs-more-panel__head span { font-size: 12px; color: var(--el-text-color-secondary); }
.tabs-more-panel__search { margin-bottom: 8px; }
.tabs-more-list { max-height: 300px; overflow-y: auto; margin: 0 -4px; padding: 0 4px; }
.tabs-more-item { display: flex; align-items: center; gap: 9px; min-height: 46px; padding: 5px 8px; border-radius: 7px; cursor: pointer; }
.tabs-more-item:hover { background: var(--el-fill-color-light); }
.tabs-more-item__dot { color: var(--el-color-primary); }
.tabs-more-item__content { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
.tabs-more-item__title, .tabs-more-item__path { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tabs-more-item__title { font-size: var(--cw-text-base); color: var(--el-text-color-primary); }
.tabs-more-item__path { font-size: 11px; color: var(--el-text-color-placeholder); }
.tabs-more-item__close { display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; padding: 0; border: 0; border-radius: 50%; background: transparent; color: var(--el-text-color-secondary); cursor: pointer; flex-shrink: 0; }
.tabs-more-item__close:hover { color: var(--el-color-danger); background: var(--el-color-danger-light-9); }
.tabs-more-empty { padding: 24px 0; text-align: center; font-size: 12px; color: var(--el-text-color-placeholder); }
.tabs-more-actions { display: flex; justify-content: flex-end; margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--el-border-color-lighter); }
.tab-ctx { position: fixed; z-index: 3000; min-width: 120px; padding: 4px; background: var(--el-bg-color); border: 1px solid var(--el-border-color-light); border-radius: 8px; box-shadow: 0 6px 24px rgba(0,0,0,.14); }
.tab-ctx__item { padding: 7px 12px; font-size: var(--cw-text-base); color: var(--el-text-color-regular); border-radius: 6px; cursor: pointer; }
.tab-ctx__item:hover { background: var(--el-fill-color-light); color: var(--el-color-primary); }
.tab-ctx__item.disabled { color: var(--el-text-color-placeholder); cursor: not-allowed; }
.tab-ctx__item.disabled:hover { background: transparent; color: var(--el-text-color-placeholder); }
</style>
