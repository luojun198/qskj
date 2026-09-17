<template>
  <div class="asset-workspace">
    <!-- 左侧侧边栏：日常业务 + 基础档案 -->
    <aside class="asset-sidebar" aria-label="固定资产导航">
      <div
        v-for="section in sidebarSections"
        :key="section.key"
        class="wb-card asset-sidebar-section"
        :style="{ flex: `${Math.max(section.leftItems.length, section.rightItems.length)} 1 38px` }"
      >
        <div class="asset-sidebar-section__header">
          <span class="asset-sidebar-section__title">{{ section.title }}</span>
        </div>

        <div class="asset-sidebar-section__body">
          <div class="asset-sidebar-grid">
            <div class="asset-sidebar-col">
              <template v-for="(item, index) in section.leftItems" :key="item.title || `spacer-${index}`">
                <span v-if="item.spacer" class="asset-sidebar-btn asset-sidebar-btn--spacer" aria-hidden="true" />
                <button
                  v-else-if="item.action"
                  type="button"
                  class="asset-sidebar-btn"
                  @click="handleSidebarAction(item)"
                >
                  {{ item.title }}
                </button>
                <router-link v-else-if="item.status === 'ready'" class="asset-sidebar-btn" :to="item.path!">
                  {{ item.title }}
                </router-link>
                <span
                  v-else
                  class="asset-sidebar-btn asset-sidebar-btn--placeholder"
                  :title="item.status === 'pending' ? '功能规划中，后续增加' : '当前无权限'"
                  @click="handlePlaceholder(item.title)"
                >
                  {{ item.title }}
                </span>
              </template>
            </div>

            <div class="asset-sidebar-col">
              <template v-for="(item, index) in section.rightItems" :key="item.title || `spacer-${index}`">
                <span v-if="item.spacer" class="asset-sidebar-btn asset-sidebar-btn--spacer" aria-hidden="true" />
                <button
                  v-else-if="item.action"
                  type="button"
                  class="asset-sidebar-btn"
                  @click="handleSidebarAction(item)"
                >
                  {{ item.title }}
                </button>
                <router-link v-else-if="item.status === 'ready'" class="asset-sidebar-btn" :to="item.path!">
                  {{ item.title }}
                </router-link>
                <span
                  v-else
                  class="asset-sidebar-btn asset-sidebar-btn--placeholder"
                  :title="item.status === 'pending' ? '功能规划中，后续增加' : '当前无权限'"
                  @click="handlePlaceholder(item.title)"
                >
                  {{ item.title }}
                </span>
              </template>
            </div>
          </div>
        </div>
      </div>
    </aside>

    <!-- 右侧主区域：顶部业务条 + 流程图 + 分隔线 + 底部链接列 -->
    <main class="wb-card asset-stage">
      <div class="asset-stage-header">
        <div class="asset-stage-header__title-wrap">
          <span class="asset-stage-header__icon" aria-hidden="true">
            <component :is="resolveNavIcon('Settings2')" :size="16" :stroke-width="2" />
          </span>
          <h2 class="asset-stage-header__title">日常业务</h2>
        </div>
      </div>

      <section class="asset-stage-flow">
        <div class="asset-flow-wrap">
          <div class="asset-flow" :style="{ gridTemplateColumns: gridColumns }">
            <template v-for="(node, index) in nodes" :key="node.id">
              <!-- 上方节点 + 向下箭头 -->
              <div
                v-if="node.above && canAccess(node.above)"
                class="asset-cell asset-cell--above"
                :style="{ gridColumn: index * 2 + 1, gridRow: 1 }"
              >
                <GlFlowTile :node="node.above" :enabled="true" @action="handleAction" />
                <svg class="asset-arrow asset-arrow--down" viewBox="0 0 28 56" aria-hidden="true">
                  <rect x="9" y="0" width="10" height="7" rx="1" />
                  <rect x="9" y="11" width="10" height="7" rx="1" />
                  <rect x="9" y="22" width="10" height="7" rx="1" />
                  <path d="M2 33 H26 L14 52 Z" />
                </svg>
              </div>

              <!-- 主干节点 -->
              <div class="asset-cell asset-cell--main" :style="{ gridColumn: index * 2 + 1, gridRow: 2 }">
                <GlFlowTile :node="node" main :enabled="canAccess(node)" @action="handleAction" />
              </div>

              <!-- 主干之间的横向箭头 -->
              <div
                v-if="index < nodes.length - 1"
                class="asset-cell asset-cell--connector"
                :style="{ gridColumn: index * 2 + 2, gridRow: 2 }"
              >
                <svg class="asset-arrow asset-arrow--right" viewBox="0 0 64 28" aria-hidden="true">
                  <path d="M0 9 H42 V1 L64 14 L42 27 V19 H0 Z" />
                </svg>
              </div>

              <!-- 向下箭头 + 下方节点 -->
              <div
                v-if="node.below && canAccess(node.below)"
                class="asset-cell asset-cell--below"
                :style="{ gridColumn: index * 2 + 1, gridRow: 3 }"
              >
                <svg class="asset-arrow asset-arrow--down" viewBox="0 0 28 56" aria-hidden="true">
                  <rect x="9" y="0" width="10" height="7" rx="1" />
                  <rect x="9" y="11" width="10" height="7" rx="1" />
                  <rect x="9" y="22" width="10" height="7" rx="1" />
                  <path d="M2 33 H26 L14 52 Z" />
                </svg>
                <GlFlowTile :node="node.below" :enabled="true" @action="handleAction" />
              </div>
            </template>
          </div>
        </div>
      </section>

      <div class="asset-stage-divider" aria-hidden="true"></div>

      <section class="asset-stage-links">
        <div class="asset-links">
          <div
            v-for="column in linkColumns"
            :key="column.key"
            class="asset-links__col"
            :aria-label="column.label"
          >
            <template v-for="link in column.items" :key="link.title">
              <router-link
                v-if="link.status === 'ready'"
                class="asset-link"
                :to="link.path!"
              >
                {{ link.title }}
              </router-link>
              <span
                v-else
                class="asset-link asset-link--placeholder"
                :title="link.status === 'pending' ? '功能开发中，后续增加' : '当前无权限'"
                @click="handlePlaceholder(link.title)"
              >
                {{ link.title }}
              </span>
            </template>
          </div>
        </div>
      </section>
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, inject } from 'vue'
import { ElMessage } from 'element-plus'
import type { NavItem } from '@/config/navigation'
import { normalizeNavPath } from '@/config/flowConfig'
import { resolveNavIcon } from '@/config/navIcons'
import {
  ASSET_FLOW_NODES,
  ASSET_LINK_COLUMNS,
  ASSET_SIDEBAR_SECTIONS,
} from '@/config/assetWorkspace'
import type { GlFlowNode, GlSidebarItem, GlLinkItem } from '@/config/glWorkspace'
import GlFlowTile from './GlFlowTile.vue'

const props = defineProps<{
  availableItems: NavItem[]
}>()

const openSwitchOperator = inject<(() => void) | undefined>('layoutOpenSwitchOperator', undefined)

const nodes = ASSET_FLOW_NODES

const itemsByPath = computed(() => {
  const map = new Map<string, NavItem>()
  for (const item of props.availableItems) {
    map.set(normalizeNavPath(item.path), item)
    const bare = normalizeNavPath(item.path.split('?')[0])
    if (!map.has(bare)) map.set(bare, item)
  }
  return map
})

function findMenuItem(path?: string): NavItem | null {
  if (!path) return null
  const bare = normalizeNavPath(path.split('?')[0])
  const direct = itemsByPath.value.get(normalizeNavPath(path)) || itemsByPath.value.get(bare)
  if (direct) return direct
  // 子页面（如 /asset/depreciation/reverse）没有独立菜单项，按最长菜单前缀归属
  let parent = bare
  while (parent.includes('/')) {
    parent = parent.slice(0, parent.lastIndexOf('/'))
    if (!parent) break
    const hit = itemsByPath.value.get(parent)
    if (hit) return hit
  }
  return null
}

function canAccess(node: GlFlowNode) {
  if (node.action === 'switch-user') return !!openSwitchOperator
  return !!findMenuItem(node.path)
}

function handleAction(node: GlFlowNode) {
  if (node.action === 'switch-user') openSwitchOperator?.()
}

function handleSidebarAction(item: GlSidebarItem) {
  if (item.action === 'change-password') {
    ElMessage.info('请在右上角个人设置中修改密码')
    return
  }
  handlePlaceholder(item.title)
}

function handlePlaceholder(title: string) {
  ElMessage.info(`【${title}】功能规划中，后续增加`)
}

const gridColumns = computed(() =>
  nodes.map((_, i) => (i < nodes.length - 1 ? 'var(--asset-node-w) 56px' : 'var(--asset-node-w)')).join(' ')
)

type AssetLinkStatus = 'ready' | 'pending' | 'denied'

type AssetLinkView = {
  path?: string
  title: string
  status: AssetLinkStatus
}

const linkColumns = computed(() =>
  ASSET_LINK_COLUMNS.map(column => ({
    key: column.key,
    label: column.label,
    items: column.items.map((item): AssetLinkView => {
      if (!item.path) return { title: item.title, status: 'pending' }
      if (findMenuItem(item.path)) return { path: item.path, title: item.title, status: 'ready' }
      return { path: item.path, title: item.title, status: 'denied' }
    }),
  }))
)

type AssetSidebarView = GlSidebarItem & { status: AssetLinkStatus }

function resolveSidebarStatus(item: GlSidebarItem): AssetLinkStatus {
  if (item.spacer || item.action || !item.path) return 'pending'
  if (findMenuItem(item.path)) return 'ready'
  return 'denied'
}

const sidebarSections = computed(() =>
  ASSET_SIDEBAR_SECTIONS.map(section => ({
    ...section,
    leftItems: section.leftItems.map((item): AssetSidebarView => ({
      ...item,
      status: resolveSidebarStatus(item),
    })),
    rightItems: section.rightItems.map((item): AssetSidebarView => ({
      ...item,
      status: resolveSidebarStatus(item),
    })),
  }))
)
</script>

<style scoped>
.asset-workspace {
  --asset-node-w: 96px;
  --asset-arrow: #d1fae5;
  --asset-arrow-edge: #6ee7b7;
  display: flex;
  align-items: stretch;
  gap: var(--wb-gap);
  width: 100%;
  min-width: 0;
}

/* =========================================================
   左侧侧边栏：日常业务 + 基础档案
   ========================================================= */
.asset-sidebar {
  width: 236px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.asset-sidebar-section {
  border: 1px solid var(--wb-line);
  border-radius: var(--wb-radius);
  overflow: hidden;
  background: var(--wb-card);
  display: flex;
  flex-direction: column;
}

.asset-sidebar-section__header {
  height: 26px;
  min-height: 26px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #ecfdf5;
  border-bottom: 1px solid var(--wb-line);
  user-select: none;
}

.asset-sidebar-section__title {
  font-size: 12.5px;
  font-weight: 600;
  color: #065f46;
  letter-spacing: 2px;
}

.asset-sidebar-section__body {
  padding: 4px 10px 6px;
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: space-around;
  min-height: 0;
}

.asset-sidebar-grid {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  height: 100%;
}

.asset-sidebar-col {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 1px;
  flex: 1;
  min-width: 0;
}

.asset-sidebar-btn {
  display: block;
  font-size: 12px;
  line-height: 19px;
  min-height: 19px;
  flex-shrink: 0;
  color: var(--wb-text);
  text-decoration: none;
  background: transparent;
  border: none;
  padding: 0 1px;
  margin: 0;
  cursor: pointer;
  text-align: left;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-family: inherit;
  transition: color 0.14s ease;
}

.asset-sidebar-btn:hover {
  color: var(--mint-700);
  text-decoration: underline;
  text-underline-offset: 2px;
}

.asset-sidebar-btn--placeholder {
  color: var(--wb-text-3);
  cursor: pointer;
}

.asset-sidebar-btn--placeholder:hover {
  color: var(--mint-600);
}

.asset-sidebar-btn--spacer {
  min-height: 19px;
  cursor: default;
  pointer-events: none;
}

/* =========================================================
   右侧主区域
   ========================================================= */
.asset-stage {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--wb-line);
  border-radius: var(--wb-radius);
  background: var(--wb-card);
  overflow: hidden;
}

.asset-stage-header {
  height: 36px;
  display: flex;
  align-items: center;
  background: #ecfdf5;
  border-bottom: 1px solid var(--wb-line);
  padding: 0 16px;
  user-select: none;
}

.asset-stage-header__title-wrap {
  display: flex;
  align-items: center;
  gap: 6px;
}

.asset-stage-header__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--mint-600);
}

.asset-stage-header__title {
  margin: 0;
  font-size: var(--cw-text-base);
  font-weight: 600;
  color: #065f46;
  letter-spacing: 0.5px;
}

.asset-stage-flow {
  padding: 20px 28px 18px;
  background:
    linear-gradient(180deg, rgba(209, 250, 229, 0.45), rgba(255, 255, 255, 0) 96px),
    var(--wb-card);
  overflow-x: auto;
}

.asset-flow-wrap {
  display: flex;
  justify-content: flex-start;
  min-width: max-content;
}

.asset-flow {
  display: grid;
  grid-template-rows: auto auto auto;
  align-items: center;
  justify-items: center;
}

.asset-cell {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-width: 0;
}

.asset-cell--above,
.asset-cell--below {
  gap: 4px;
}

.asset-cell--connector {
  width: 100%;
  padding: 0 4px;
  align-self: start;
  margin-top: 18px;
}

.asset-arrow {
  fill: var(--asset-arrow);
  stroke: var(--asset-arrow-edge);
  stroke-width: 1;
  stroke-linejoin: round;
  flex-shrink: 0;
}

.asset-arrow--right {
  width: 100%;
  height: 20px;
}

.asset-arrow--down {
  width: 16px;
  height: 32px;
}

.asset-stage-divider {
  width: 100%;
  height: 1px;
  background: var(--wb-line);
}

.asset-stage-links {
  padding: 14px 28px 18px;
  background: var(--wb-card);
}

.asset-links {
  display: grid;
  grid-template-columns: repeat(4, max-content);
  gap: 4px 64px;
}

.asset-links__col {
  display: flex;
  flex-direction: column;
}

.asset-link {
  display: flex;
  align-items: center;
  gap: 6px;
  line-height: 26px;
  font-size: var(--cw-text-sm);
  color: var(--wb-text);
  text-decoration: none;
  transition: color 0.14s ease;
  white-space: nowrap;
}

.asset-link::before {
  content: '»';
  color: var(--mint-600);
  font-size: var(--cw-text-base);
  line-height: 1;
}

.asset-link:hover {
  color: var(--mint-700);
  text-decoration: underline;
  text-underline-offset: 3px;
}

.asset-link--placeholder,
.asset-link--placeholder:hover {
  color: var(--wb-text-3);
  cursor: default;
  text-decoration: none;
}

.asset-link--placeholder::before {
  color: var(--wb-line-strong);
}

@media (max-width: 1100px) {
  .asset-links {
    grid-template-columns: repeat(2, max-content);
    column-gap: 48px;
  }
}

@media (max-width: 768px) {
  .asset-workspace {
    flex-direction: column;
  }
  .asset-sidebar {
    width: 100%;
  }
  .asset-links {
    grid-template-columns: max-content;
  }
}
</style>
