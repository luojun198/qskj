<template>
  <div class="gl-workspace">
    <!-- 左侧侧边栏：3 大分组面板（账务报表、财务分析、基础档案） -->
    <aside class="gl-sidebar" aria-label="账务导航">
      <div
        v-for="section in sidebarSections"
        :key="section.key"
        class="wb-card gl-sidebar-section"
        :style="{ flex: `${Math.max(section.leftItems.length, section.rightItems.length)} 1 38px` }"
      >
        <!-- 面板标题条 -->
        <div class="gl-sidebar-section__header">
          <span class="gl-sidebar-section__title">{{ section.title }}</span>
        </div>

        <div class="gl-sidebar-section__body">
          <!-- 强调大按钮（日常业务） -->
          <div v-if="section.pillButton" class="gl-sidebar-pill-wrap">
            <router-link
              v-if="section.pillButton.path"
              :to="section.pillButton.path"
              class="gl-sidebar-pill"
              :class="{ 'is-active': section.pillButton.active }"
            >
              {{ section.pillButton.title }}
            </router-link>
            <button
              v-else
              type="button"
              class="gl-sidebar-pill"
              :class="{ 'is-active': section.pillButton.active }"
              @click="handleSidebarAction(section.pillButton)"
            >
              {{ section.pillButton.title }}
            </button>
          </div>

          <!-- 双列按钮列表 -->
          <div class="gl-sidebar-grid">
            <!-- 左列 -->
            <div class="gl-sidebar-col">
              <template v-for="(item, index) in section.leftItems" :key="item.title || `spacer-${index}`">
                <span v-if="item.spacer" class="gl-sidebar-btn gl-sidebar-btn--spacer" aria-hidden="true" />
                <!-- action 项（修改密码 / 切换操作员）没有路由，必须排在 status 判定之前 -->
                <button
                  v-else-if="item.action"
                  type="button"
                  class="gl-sidebar-btn"
                  @click="handleSidebarAction(item)"
                >
                  {{ item.title }}
                </button>
                <router-link v-else-if="item.status === 'ready'" class="gl-sidebar-btn" :to="item.path!">
                  {{ item.title }}
                </router-link>
                <span
                  v-else-if="item.status === 'module-off'"
                  class="gl-sidebar-btn gl-sidebar-btn--module-off"
                  :title="moduleOffTitle(item.requires)"
                  @click="handleModuleOff(item)"
                >
                  {{ item.title }}
                </span>
                <span
                  v-else
                  class="gl-sidebar-btn gl-sidebar-btn--placeholder"
                  :title="item.status === 'pending' ? '功能规划中，后续增加' : '当前无权限'"
                  @click="handlePlaceholder(item.title)"
                >
                  {{ item.title }}
                </span>
              </template>
            </div>

            <!-- 右列 -->
            <div class="gl-sidebar-col">
              <template v-for="(item, index) in section.rightItems" :key="item.title || `spacer-${index}`">
                <span v-if="item.spacer" class="gl-sidebar-btn gl-sidebar-btn--spacer" aria-hidden="true" />
                <!-- action 项（修改密码 / 切换操作员）没有路由，必须排在 status 判定之前 -->
                <button
                  v-else-if="item.action"
                  type="button"
                  class="gl-sidebar-btn"
                  @click="handleSidebarAction(item)"
                >
                  {{ item.title }}
                </button>
                <router-link v-else-if="item.status === 'ready'" class="gl-sidebar-btn" :to="item.path!">
                  {{ item.title }}
                </router-link>
                <span
                  v-else-if="item.status === 'module-off'"
                  class="gl-sidebar-btn gl-sidebar-btn--module-off"
                  :title="moduleOffTitle(item.requires)"
                  @click="handleModuleOff(item)"
                >
                  {{ item.title }}
                </span>
                <span
                  v-else
                  class="gl-sidebar-btn gl-sidebar-btn--placeholder"
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

    <!-- 右侧主区域：顶部业务条 + 流程图 + 分隔线 + 底部 4 列账簿 -->
    <main class="wb-card gl-stage">
      <!-- 顶部横条：左侧齿轮图标 + 日常业务 -->
      <div class="gl-stage-header">
        <div class="gl-stage-header__title-wrap">
          <span class="gl-stage-header__icon" aria-hidden="true">
            <component :is="resolveNavIcon('Settings2')" :size="16" :stroke-width="2" />
          </span>
          <h2 class="gl-stage-header__title">日常业务</h2>
        </div>
      </div>

      <!-- 上半部：业务流程图 -->
      <section class="gl-stage-flow">
        <div class="gl-flow-wrap">
          <div class="gl-flow" :style="{ gridTemplateColumns: gridColumns }">
            <template v-for="(node, index) in nodes" :key="node.id">
              <!-- 上方节点 + 向下箭头 -->
              <div
                v-if="node.above && canAccess(node.above)"
                class="gl-cell gl-cell--above"
                :style="{ gridColumn: index * 2 + 1, gridRow: 1 }"
              >
                <GlFlowTile :node="node.above" :enabled="true" @action="handleAction" />
                <svg class="gl-arrow gl-arrow--down" viewBox="0 0 28 56" aria-hidden="true">
                  <rect x="9" y="0" width="10" height="7" rx="1" />
                  <rect x="9" y="11" width="10" height="7" rx="1" />
                  <rect x="9" y="22" width="10" height="7" rx="1" />
                  <path d="M2 33 H26 L14 52 Z" />
                </svg>
              </div>

              <!-- 主干节点 -->
              <div class="gl-cell gl-cell--main" :style="{ gridColumn: index * 2 + 1, gridRow: 2 }">
                <GlFlowTile :node="node" main :enabled="canAccess(node)" @action="handleAction" />
              </div>

              <!-- 主干之间的横向箭头 -->
              <div
                v-if="index < nodes.length - 1"
                class="gl-cell gl-cell--connector"
                :style="{ gridColumn: index * 2 + 2, gridRow: 2 }"
              >
                <svg class="gl-arrow gl-arrow--right" viewBox="0 0 64 28" aria-hidden="true">
                  <path d="M0 9 H42 V1 L64 14 L42 27 V19 H0 Z" />
                </svg>
              </div>

              <!-- 向下箭头 + 下方节点 -->
              <div
                v-if="node.below && canAccess(node.below)"
                class="gl-cell gl-cell--below"
                :style="{ gridColumn: index * 2 + 1, gridRow: 3 }"
              >
                <svg class="gl-arrow gl-arrow--down" viewBox="0 0 28 56" aria-hidden="true">
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

      <!-- 中间水平分割线 -->
      <div class="gl-stage-divider" aria-hidden="true"></div>

      <!-- 下半部：严格按参考图排列的 4 列账簿 / 报表链接列表 -->
      <section class="gl-stage-links">
        <div class="gl-links">
          <div
            v-for="column in linkColumns"
            :key="column.key"
            class="gl-links__col"
            :aria-label="column.label"
          >
            <template v-for="link in column.items" :key="link.title">
              <router-link
                v-if="link.status === 'ready'"
                class="gl-link"
                :to="link.path!"
              >
                {{ link.title }}
              </router-link>
              <span
                v-else-if="link.status === 'module-off'"
                class="gl-link gl-link--module-off"
                :title="moduleOffTitle(link.requires)"
                @click="handleModuleOff(link)"
              >
                {{ link.title }}
              </span>
              <span
                v-else
                class="gl-link gl-link--placeholder"
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
import { ElMessage, ElMessageBox } from 'element-plus'
import { useRouter } from 'vue-router'
import { useSystemParamsStore } from '@/stores/systemParams'
import type { NavItem } from '@/config/navigation'
import { normalizeNavPath } from '@/config/flowConfig'
import { resolveNavIcon } from '@/config/navIcons'
import {
  GL_FLOW_NODES,
  GL_LINK_COLUMNS,
  GL_SIDEBAR_SECTIONS,
  type GlFlowNode,
  type GlSidebarItem,
  type GlLinkItem,
} from '@/config/glWorkspace'
import GlFlowTile from './GlFlowTile.vue'

const props = defineProps<{
  /** 全部可见页面：流程图与链接列据此判断权限；流程图可跨应用引用（如系统管理的备份恢复） */
  availableItems: NavItem[]
}>()

/** Layout 注入的「切换操作员」弹窗；不在 Layout 内（如单测）时该节点隐藏 */
const openSwitchOperator = inject<(() => void) | undefined>('layoutOpenSwitchOperator', undefined)

const router = useRouter()
const systemParams = useSystemParamsStore()

const nodes = GL_FLOW_NODES

const itemsByPath = computed(() => {
  const map = new Map<string, NavItem>()
  for (const item of props.availableItems) {
    map.set(normalizeNavPath(item.path), item)
    const bare = normalizeNavPath(item.path.split('?')[0])
    if (!map.has(bare)) map.set(bare, item)
  }
  return map
})

/** 先按完整路径（含查询串）找，找不到再按路径部分找 */
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
  if (item.action === 'switch-user') {
    openSwitchOperator?.()
    return
  }
  handlePlaceholder(item.title)
}

function handlePlaceholder(title: string) {
  ElMessage.info(`【${title}】功能规划中，后续增加`)
}

/** 节点列与箭头列均为固定宽度，流程图整体宽度由内容决定（卡片不铺满，右侧留白） */
const gridColumns = computed(() =>
  nodes.map((_, i) => (i < nodes.length - 1 ? 'var(--gl-node-w) 56px' : 'var(--gl-node-w)')).join(' ')
)

/**
 * 链接状态：
 *  - `ready` 可点击；
 *  - `pending` 功能未实现（占位）；
 *  - `module-off` 账套业务开关没开——可点击，引导去账套参数打开；
 *  - `denied` 真的没有权限（占位）。
 *
 * `module-off` 与 `denied` 都表现为「菜单里找不到这条路径」，靠 `item.requires` 区分：
 * 开关关掉时 `navigation.getStaticNavApps` 压根不会生成这条菜单，此前一律提示
 * 「功能规划中，后续增加」，让人以为功能没做。
 */
type GlLinkStatus = 'ready' | 'pending' | 'module-off' | 'denied'

type GlLinkView = {
  path?: string
  title: string
  status: GlLinkStatus
  requires?: GlLinkItem['requires']
}

const moduleSwitches = computed<Record<NonNullable<GlLinkItem['requires']>, boolean>>(() => ({
  foreign: systemParams.enableForeignCurrency,
  cashflow: systemParams.enableCashFlow,
}))

const MODULE_LABELS: Record<NonNullable<GlLinkItem['requires']>, string> = {
  foreign: '外币核算',
  cashflow: '现金流核算',
}

function moduleOffTitle(requires?: GlLinkItem['requires']): string {
  return requires ? `账套未启用${MODULE_LABELS[requires]}` : '模块未启用'
}

/** 链接列与左侧面板共用：确认后跳账套参数页 */
async function handleModuleOff(item: { title: string; requires?: GlLinkItem['requires'] }) {
  if (!item.requires) return
  const label = MODULE_LABELS[item.requires]
  try {
    await ElMessageBox.confirm(
      `【${item.title}】需要先启用「${label}」。是否前往「账套参数」开启？`,
      '模块未启用',
      { confirmButtonText: '前往设置', cancelButtonText: '取消', type: 'info' }
    )
  } catch {
    return
  }
  router.push('/system/param')
}

const linkColumns = computed(() =>
  GL_LINK_COLUMNS.map(column => ({
    key: column.key,
    label: column.label,
    items: column.items.map((item): GlLinkView => {
      if (!item.path) return { title: item.title, status: 'pending' }
      if (findMenuItem(item.path)) return { path: item.path, title: item.title, status: 'ready' }
      const status: GlLinkStatus =
        item.requires && !moduleSwitches.value[item.requires] ? 'module-off' : 'denied'
      return { path: item.path, title: item.title, status, requires: item.requires }
    }),
  }))
)

type GlSidebarView = GlSidebarItem & { status: GlLinkStatus }

/**
 * 左侧面板同样要区分「模块未启用」与「无权限」。
 * 左右两列的模板此前逐字重复，状态判定统一放到这里，模板只按 status 分支。
 */
function resolveSidebarStatus(item: GlSidebarItem): GlLinkStatus {
  // spacer 与 action 项在模板里先被拦下，状态取值对它们没有意义
  if (item.spacer || item.action || !item.path) return 'pending'
  if (findMenuItem(item.path)) return 'ready'
  return item.requires && !moduleSwitches.value[item.requires] ? 'module-off' : 'denied'
}

const sidebarSections = computed(() =>
  GL_SIDEBAR_SECTIONS.map(section => ({
    ...section,
    leftItems: section.leftItems.map((item): GlSidebarView => ({
      ...item,
      status: resolveSidebarStatus(item),
    })),
    rightItems: section.rightItems.map((item): GlSidebarView => ({
      ...item,
      status: resolveSidebarStatus(item),
    })),
  }))
)
</script>

<style scoped>
.gl-workspace {
  --gl-node-w: 96px;
  --gl-arrow: #b9dcf0;
  --gl-arrow-edge: #93c4e3;
  display: flex;
  align-items: stretch;
  gap: var(--wb-gap);
  width: 100%;
  min-width: 0;
}

/* =========================================================
   左侧侧边栏：3 大分组面板（日常业务、财务分析、基础档案）
   压缩排版，与右侧主工作台模块严格等高
   ========================================================= */
.gl-sidebar {
  width: 236px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.gl-sidebar-section {
  border: 1px solid var(--wb-line);
  border-radius: var(--wb-radius);
  overflow: hidden;
  background: var(--wb-card);
  display: flex;
  flex-direction: column;
}

/* 各卡片 flex 高度由模板按实际功能行数（maxRows 1 38px）动态分配，扣除固定头部与外框后各卡片行距完全均等，并与右侧主区域总高度严格对齐 */

.gl-sidebar-section__header {
  height: 26px;
  min-height: 26px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--surface-brand-soft, #f0fdf4);
  border-bottom: 1px solid var(--wb-line);
  user-select: none;
}

.gl-sidebar-section__title {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--mint-800, #065f46);
  letter-spacing: 2px;
}

.gl-sidebar-section__body {
  padding: 4px 10px 6px;
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: space-around;
  min-height: 0;
}

/* 强调大按钮（如日常业务） */
.gl-sidebar-pill-wrap {
  margin-bottom: 4px;
  display: flex;
  justify-content: center;
}

.gl-sidebar-pill {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 24px;
  padding: 0 8px;
  border-radius: var(--wb-radius-sm);
  background: var(--mint-500);
  border: 1px solid var(--mint-500);
  color: #ffffff;
  font-size: 12px;
  font-weight: 500;
  text-decoration: none;
  cursor: pointer;
  letter-spacing: 0.5px;
  box-shadow: 0 1px 2px rgba(16, 185, 129, 0.2);
  transition: background 0.16s ease, border-color 0.16s ease;
}

.gl-sidebar-pill:hover {
  background: var(--mint-600);
  border-color: var(--mint-600);
}

/* 双列功能按钮：紧凑排布，留足文字宽度 */
.gl-sidebar-grid {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  height: 100%;
}

.gl-sidebar-col {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 1px;
  flex: 1;
  min-width: 0;
}

.gl-sidebar-btn {
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

.gl-sidebar-btn:hover {
  color: var(--mint-700);
  text-decoration: underline;
  text-underline-offset: 2px;
}

.gl-sidebar-btn--placeholder {
  color: var(--wb-text-3);
  cursor: pointer;
}

.gl-sidebar-btn--placeholder:hover {
  color: var(--mint-600);
}

/* 模块未启用：功能已做好，只是账套开关没开——比无权限占位更醒目，点了会引导去账套参数 */
.gl-sidebar-btn--module-off {
  color: var(--wb-text-2);
  cursor: pointer;
  text-decoration: underline dashed;
  text-underline-offset: 2px;
}

.gl-sidebar-btn--module-off:hover {
  color: var(--mint-700);
}

.gl-sidebar-btn--spacer {
  min-height: 19px;
  cursor: default;
  pointer-events: none;
}


/* =========================================================
   右侧主区域：日常业务横条 + 流程图 + 分隔线 + 4列账簿列表
   ========================================================= */
.gl-stage {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--wb-line);
  border-radius: var(--wb-radius);
  background: var(--wb-card);
  overflow: hidden;
}

/* 顶部横条：左侧图标 + 日常业务 */
.gl-stage-header {
  height: 36px;
  display: flex;
  align-items: center;
  background: var(--surface-brand-soft, #f0fdf4);
  border-bottom: 1px solid var(--wb-line);
  padding: 0 16px;
  user-select: none;
}

.gl-stage-header__title-wrap {
  display: flex;
  align-items: center;
  gap: 6px;
}

.gl-stage-header__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--mint-600);
}

.gl-stage-header__title {
  margin: 0;
  font-size: var(--cw-text-base);
  font-weight: 600;
  color: var(--mint-800, #065f46);
  letter-spacing: 0.5px;
}

/* 上半部：业务流程图 */
.gl-stage-flow {
  padding: 20px 28px 18px;
  background:
    linear-gradient(180deg, rgba(232, 243, 250, 0.45), rgba(255, 255, 255, 0) 96px),
    var(--wb-card);
  overflow-x: auto;
}

.gl-flow-wrap {
  display: flex;
  justify-content: flex-start;
  min-width: max-content;
}

.gl-flow {
  display: grid;
  grid-template-rows: auto auto auto;
  align-items: center;
  justify-items: center;
}

.gl-cell {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-width: 0;
}

.gl-cell--above,
.gl-cell--below {
  gap: 4px;
}

.gl-cell--connector {
  width: 100%;
  padding: 0 4px;
  /* 与主干节点 44px 图标的中心对齐（tile 顶部 padding 6px + 图标半高 22px - 箭头半高 10px） */
  align-self: start;
  margin-top: 18px;
}

/* ---- 箭头 ---- */
.gl-arrow {
  fill: var(--gl-arrow);
  stroke: var(--gl-arrow-edge);
  stroke-width: 1;
  stroke-linejoin: round;
  flex-shrink: 0;
}

.gl-arrow--right {
  width: 100%;
  height: 20px;
}

.gl-arrow--down {
  width: 16px;
  height: 32px;
}

/* ---- 中间水平分割线 ---- */
.gl-stage-divider {
  width: 100%;
  height: 1px;
  background: var(--wb-line);
}

/* =========================================================
   下半部：4 列账簿链接
   ========================================================= */
.gl-stage-links {
  padding: 14px 28px 18px;
  background: var(--wb-card);
}

.gl-links {
  display: grid;
  grid-template-columns: repeat(4, max-content);
  gap: 4px 64px;
}

.gl-links__col {
  display: flex;
  flex-direction: column;
}

.gl-link {
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

.gl-link::before {
  content: '»';
  color: var(--mint-600);
  font-size: var(--cw-text-base);
  line-height: 1;
}

.gl-link:hover {
  color: var(--mint-700);
  text-decoration: underline;
  text-underline-offset: 3px;
}

/* 占位项：功能未实现或无权限，灰显不可点 */
.gl-link--placeholder,
.gl-link--placeholder:hover {
  color: var(--wb-text-3);
  cursor: default;
  text-decoration: none;
}

.gl-link--placeholder::before {
  color: var(--wb-line-strong);
}

/* 模块未启用：功能已做好，只是账套开关没开——保持可点，点了引导去账套参数 */
.gl-link--module-off {
  color: var(--wb-text-2);
  cursor: pointer;
  text-decoration: none;
  text-decoration-style: dashed;
}

.gl-link--module-off:hover {
  color: var(--mint-700);
  text-decoration: underline dashed;
  text-underline-offset: 3px;
}

@media (max-width: 1100px) {
  .gl-links {
    grid-template-columns: repeat(2, max-content);
    column-gap: 48px;
  }
}

@media (max-width: 768px) {
  .gl-workspace {
    flex-direction: column;
  }
  .gl-sidebar {
    width: 100%;
  }
  .gl-links {
    grid-template-columns: max-content;
  }
}
</style>


