<template>
  <div class="cashier-workspace">
    <!-- 左侧侧边栏：出纳工作（日常业务） -->
    <aside class="cashier-sidebar" aria-label="出纳导航">
      <div
        v-for="section in sidebarSections"
        :key="section.key"
        class="wb-card cashier-sidebar-section"
        :style="sidebarSections.length > 1
          ? { flex: `${Math.max(section.leftItems.length, section.rightItems.length)} 1 38px` }
          : { flex: '0 0 auto' }"
      >
        <div class="cashier-sidebar-section__header">
          <span class="cashier-sidebar-section__title">{{ section.title }}</span>
        </div>

        <div class="cashier-sidebar-section__body">
          <!-- 强调标签（日常业务） -->
          <div v-if="section.pillButton" class="cashier-sidebar-pill-wrap">
            <span class="cashier-sidebar-pill" :class="{ 'is-active': section.pillButton.active }">
              {{ section.pillButton.title }}
            </span>
          </div>

          <div class="cashier-sidebar-grid" :class="{ 'is-single': !section.rightItems.length }">
            <div class="cashier-sidebar-col">
              <template v-for="(item, index) in section.leftItems" :key="item.title || `spacer-${index}`">
                <span v-if="item.spacer" class="cashier-sidebar-btn cashier-sidebar-btn--spacer" aria-hidden="true" />
                <button
                  v-else-if="item.action"
                  type="button"
                  class="cashier-sidebar-btn"
                  @click="handleSidebarAction(item)"
                >
                  {{ item.title }}
                </button>
                <router-link v-else-if="item.status === 'ready'" class="cashier-sidebar-btn" :to="item.path!">
                  {{ item.title }}
                </router-link>
                <span
                  v-else
                  class="cashier-sidebar-btn cashier-sidebar-btn--placeholder"
                  :title="item.status === 'pending' ? '功能规划中，后续增加' : '当前无权限'"
                  @click="handlePlaceholder(item.title)"
                >
                  {{ item.title }}
                </span>
              </template>
            </div>

            <div v-if="section.rightItems.length" class="cashier-sidebar-col">
              <template v-for="(item, index) in section.rightItems" :key="item.title || `spacer-${index}`">
                <span v-if="item.spacer" class="cashier-sidebar-btn cashier-sidebar-btn--spacer" aria-hidden="true" />
                <button
                  v-else-if="item.action"
                  type="button"
                  class="cashier-sidebar-btn"
                  @click="handleSidebarAction(item)"
                >
                  {{ item.title }}
                </button>
                <router-link v-else-if="item.status === 'ready'" class="cashier-sidebar-btn" :to="item.path!">
                  {{ item.title }}
                </router-link>
                <span
                  v-else
                  class="cashier-sidebar-btn cashier-sidebar-btn--placeholder"
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
    <main class="wb-card cashier-stage">
      <div class="cashier-stage-header">
        <div class="cashier-stage-header__title-wrap">
          <span class="cashier-stage-header__icon" aria-hidden="true">
            <component :is="resolveNavIcon('Settings2')" :size="16" :stroke-width="2" />
          </span>
          <h2 class="cashier-stage-header__title">日常业务</h2>
        </div>
      </div>

      <section class="cashier-stage-flow">
        <div class="cashier-flow-wrap">
          <div class="cashier-flow" :style="{ gridTemplateColumns: gridColumns }">
            <template v-for="(node, index) in nodes" :key="node.id">
              <!-- 上方节点 + 向下箭头 -->
              <div
                v-if="node.above && canAccess(node.above)"
                class="cashier-cell cashier-cell--above"
                :style="{ gridColumn: index * 2 + 1, gridRow: 1 }"
              >
                <GlFlowTile :node="node.above" :enabled="true" @action="handleAction" />
                <svg class="cashier-arrow cashier-arrow--down" viewBox="0 0 28 56" aria-hidden="true">
                  <rect x="9" y="0" width="10" height="7" rx="1" />
                  <rect x="9" y="11" width="10" height="7" rx="1" />
                  <rect x="9" y="22" width="10" height="7" rx="1" />
                  <path d="M2 33 H26 L14 52 Z" />
                </svg>
              </div>

              <!-- 主干节点 -->
              <div class="cashier-cell cashier-cell--main" :style="{ gridColumn: index * 2 + 1, gridRow: 2 }">
                <GlFlowTile :node="node" main :enabled="canAccess(node)" @action="handleAction" />
              </div>

              <!-- 主干之间的横向箭头 -->
              <div
                v-if="index < nodes.length - 1"
                class="cashier-cell cashier-cell--connector"
                :style="{ gridColumn: index * 2 + 2, gridRow: 2 }"
              >
                <svg class="cashier-arrow cashier-arrow--right" viewBox="0 0 64 28" aria-hidden="true">
                  <path d="M0 9 H42 V1 L64 14 L42 27 V19 H0 Z" />
                </svg>
              </div>

              <!-- 向下箭头 + 下方节点 -->
              <div
                v-if="node.below && canAccess(node.below)"
                class="cashier-cell cashier-cell--below"
                :style="{ gridColumn: index * 2 + 1, gridRow: 3 }"
              >
                <svg class="cashier-arrow cashier-arrow--down" viewBox="0 0 28 56" aria-hidden="true">
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

      <div class="cashier-stage-divider" aria-hidden="true"></div>

      <section class="cashier-stage-links">
        <div class="cashier-links">
          <div
            v-for="column in linkColumns"
            :key="column.key"
            class="cashier-links__col"
            :aria-label="column.label"
          >
            <template v-for="link in column.items" :key="link.title">
              <router-link
                v-if="link.status === 'ready'"
                class="cashier-link"
                :to="link.path!"
              >
                {{ link.title }}
              </router-link>
              <span
                v-else
                class="cashier-link cashier-link--placeholder"
                :title="link.status === 'pending' ? '功能开发中，后续增加' : '当前无权限'"
                @click="handlePlaceholder(link.title)"
              >
                {{ link.title }}
              </span>
            </template>
          </div>
        </div>
      </section>

      <!-- 温馨提示 -->
      <section class="cashier-stage-tips">
        <div class="cashier-tips">
          <p class="cashier-tips__title">温馨提示：</p>
          <ol class="cashier-tips__list">
            <li>首次使用出纳模块须进行系统初始化（不会影响您原来账务系统的数据）</li>
            <li>如果您想设置操作员及权限，可进入账务系统【用户管理】进行设置</li>
            <li>出纳模块的数据备份，可进入账务系统点击【数据备份】进行操作（备份文件里包含了账务和出纳的数据）</li>
          </ol>
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
  CASHIER_FLOW_NODES,
  CASHIER_LINK_COLUMNS,
  CASHIER_SIDEBAR_SECTIONS,
} from '@/config/cashierWorkspace'
import type { GlFlowNode, GlSidebarItem, GlLinkItem } from '@/config/glWorkspace'
import GlFlowTile from './GlFlowTile.vue'

const props = defineProps<{
  availableItems: NavItem[]
}>()

const openSwitchOperator = inject<(() => void) | undefined>('layoutOpenSwitchOperator', undefined)

const nodes = CASHIER_FLOW_NODES

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
  return (
    itemsByPath.value.get(normalizeNavPath(path)) ||
    itemsByPath.value.get(normalizeNavPath(path.split('?')[0])) ||
    null
  )
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
  nodes.map((_, i) => (i < nodes.length - 1 ? 'var(--cashier-node-w) 56px' : 'var(--cashier-node-w)')).join(' ')
)

type CashierLinkStatus = 'ready' | 'pending' | 'denied'

type CashierLinkView = {
  path?: string
  title: string
  status: CashierLinkStatus
}

const linkColumns = computed(() =>
  CASHIER_LINK_COLUMNS.map(column => ({
    key: column.key,
    label: column.label,
    items: column.items.map((item): CashierLinkView => {
      if (!item.path) return { title: item.title, status: 'pending' }
      if (findMenuItem(item.path)) return { path: item.path, title: item.title, status: 'ready' }
      return { path: item.path, title: item.title, status: 'denied' }
    }),
  }))
)

type CashierSidebarView = GlSidebarItem & { status: CashierLinkStatus }

function resolveSidebarStatus(item: GlSidebarItem): CashierLinkStatus {
  if (item.spacer || item.action || !item.path) return 'pending'
  if (findMenuItem(item.path)) return 'ready'
  return 'denied'
}

const sidebarSections = computed(() =>
  CASHIER_SIDEBAR_SECTIONS.map(section => ({
    ...section,
    leftItems: section.leftItems.map((item): CashierSidebarView => ({
      ...item,
      status: resolveSidebarStatus(item),
    })),
    rightItems: section.rightItems.map((item): CashierSidebarView => ({
      ...item,
      status: resolveSidebarStatus(item),
    })),
  }))
)
</script>

<style scoped>
.cashier-workspace {
  --cashier-node-w: 96px;
  --cashier-arrow: #e0f2fe;
  --cashier-arrow-edge: #7dd3fc;
  display: flex;
  align-items: stretch;
  gap: var(--wb-gap);
  width: 100%;
  min-width: 0;
}

/* =========================================================
   左侧侧边栏：出纳工作（日常业务）
   ========================================================= */
.cashier-sidebar {
  width: 236px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.cashier-sidebar-section {
  border: 1px solid var(--wb-line);
  border-radius: var(--wb-radius);
  overflow: hidden;
  background: var(--wb-card);
  display: flex;
  flex-direction: column;
}

.cashier-sidebar-section__header {
  height: 26px;
  min-height: 26px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #e0f2fe;
  border-bottom: 1px solid var(--wb-line);
  user-select: none;
}

.cashier-sidebar-section__title {
  font-size: 12.5px;
  font-weight: 600;
  color: #075985;
  letter-spacing: 2px;
}

.cashier-sidebar-section__body {
  padding: 4px 10px 6px;
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

/* 强调标签（日常业务） */
.cashier-sidebar-pill-wrap {
  margin: 2px 0 10px;
  display: flex;
  justify-content: center;
}

.cashier-sidebar-pill {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 24px;
  padding: 0 8px;
  border-radius: var(--wb-radius-sm);
  background: #b8d4ee;
  border: 1px solid #7fb3dd;
  color: #0c4a6e;
  font-size: 12px;
  font-weight: 500;
  cursor: default;
  letter-spacing: 1px;
}

.cashier-sidebar-pill.is-active {
  background: #7fb3dd;
  border-color: #5a9bd0;
  color: #ffffff;
}

.cashier-sidebar-grid {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  flex: 1;
}

.cashier-sidebar-grid.is-single .cashier-sidebar-col {
  justify-content: flex-start;
  gap: 14px;
}

.cashier-sidebar-col {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 1px;
  flex: 1;
  min-width: 0;
}

.cashier-sidebar-btn {
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

.cashier-sidebar-btn:hover {
  color: #0284c7;
  text-decoration: underline;
  text-underline-offset: 2px;
}

.cashier-sidebar-btn--placeholder {
  color: var(--wb-text-3);
  cursor: pointer;
}

.cashier-sidebar-btn--placeholder:hover {
  color: #0284c7;
}

.cashier-sidebar-btn--spacer {
  min-height: 19px;
  cursor: default;
  pointer-events: none;
}

/* =========================================================
   右侧主区域
   ========================================================= */
.cashier-stage {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--wb-line);
  border-radius: var(--wb-radius);
  background: var(--wb-card);
  overflow: hidden;
}

.cashier-stage-header {
  height: 36px;
  display: flex;
  align-items: center;
  background: #e0f2fe;
  border-bottom: 1px solid var(--wb-line);
  padding: 0 16px;
  user-select: none;
}

.cashier-stage-header__title-wrap {
  display: flex;
  align-items: center;
  gap: 6px;
}

.cashier-stage-header__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #0284c7;
}

.cashier-stage-header__title {
  margin: 0;
  font-size: var(--cw-text-base);
  font-weight: 600;
  color: #075985;
  letter-spacing: 0.5px;
}

.cashier-stage-flow {
  padding: 20px 28px 18px;
  background:
    linear-gradient(180deg, rgba(224, 242, 254, 0.45), rgba(255, 255, 255, 0) 96px),
    var(--wb-card);
  overflow-x: auto;
}

.cashier-flow-wrap {
  display: flex;
  justify-content: flex-start;
  min-width: max-content;
}

.cashier-flow {
  display: grid;
  grid-template-rows: auto auto auto;
  align-items: center;
  justify-items: center;
}

.cashier-cell {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-width: 0;
}

.cashier-cell--above,
.cashier-cell--below {
  gap: 4px;
}

.cashier-cell--connector {
  width: 100%;
  padding: 0 4px;
  align-self: start;
  margin-top: 18px;
}

.cashier-arrow {
  fill: var(--cashier-arrow);
  stroke: var(--cashier-arrow-edge);
  stroke-width: 1;
  stroke-linejoin: round;
  flex-shrink: 0;
}

.cashier-arrow--right {
  width: 100%;
  height: 20px;
}

.cashier-arrow--down {
  width: 16px;
  height: 32px;
}

.cashier-stage-divider {
  width: 100%;
  height: 1px;
  background: var(--wb-line);
}

.cashier-stage-links {
  padding: 14px 28px 18px;
  background: var(--wb-card);
}

.cashier-links {
  display: grid;
  grid-template-columns: repeat(2, max-content);
  gap: 4px 120px;
}

.cashier-links__col {
  display: flex;
  flex-direction: column;
}

.cashier-link {
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

.cashier-link::before {
  content: '»';
  color: #0284c7;
  font-size: var(--cw-text-base);
  line-height: 1;
}

.cashier-link:hover {
  color: #0284c7;
  text-decoration: underline;
  text-underline-offset: 3px;
}

.cashier-link--placeholder,
.cashier-link--placeholder:hover {
  color: var(--wb-text-3);
  cursor: default;
  text-decoration: none;
}

.cashier-link--placeholder::before {
  color: var(--wb-line-strong);
}

/* 温馨提示 */
.cashier-stage-tips {
  padding: 12px 28px 16px;
  border-top: 1px solid var(--wb-line);
  background: var(--wb-card);
}

.cashier-tips__title {
  margin: 0 0 6px;
  font-size: var(--cw-text-sm);
  font-weight: 600;
  color: #dc2626;
}

.cashier-tips__list {
  margin: 0;
  padding: 0 0 0 18px;
  font-size: 12px;
  line-height: 1.7;
  color: #dc2626;
}

.cashier-tips__list li {
  margin-bottom: 2px;
}

@media (max-width: 768px) {
  .cashier-workspace {
    flex-direction: column;
  }
  .cashier-sidebar {
    width: 100%;
  }
  .cashier-links {
    grid-template-columns: max-content;
  }
}
</style>
