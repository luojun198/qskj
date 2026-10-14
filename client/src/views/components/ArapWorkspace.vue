<template>
  <div class="arap-workspace">
    <!-- 应收 / 应付：左右镜像分区 -->
    <div class="arap-sides">
      <section
        v-for="side in sides"
        :key="side.key"
        class="wb-card arap-side"
        :class="`arap-side--${side.accent}`"
        :aria-label="side.title"
      >
        <header class="arap-side__head">
          <span class="arap-side__icon" aria-hidden="true">
            <component :is="resolveNavIcon(side.key === 'ar' ? 'ArrowDownToLine' : 'ArrowUpFromLine')" :size="15" :stroke-width="2" />
          </span>
          <h2 class="arap-side__title">{{ side.title }}</h2>
        </header>

        <div class="arap-side__flow">
          <div class="arap-flow" :style="{ gridTemplateColumns: gridColumns(side.nodes.length) }">
            <template v-for="(node, index) in side.nodes" :key="node.id">
              <div class="arap-cell" :style="{ gridColumn: index * 2 + 1, gridRow: 1 }">
                <GlFlowTile :node="node" main :enabled="canAccess(node)" />
              </div>

              <div
                v-if="index < side.nodes.length - 1"
                class="arap-cell arap-cell--connector"
                :style="{ gridColumn: index * 2 + 2, gridRow: 1 }"
              >
                <svg class="arap-arrow arap-arrow--right" viewBox="0 0 64 28" aria-hidden="true">
                  <path d="M0 9 H42 V1 L64 14 L42 27 V19 H0 Z" />
                </svg>
              </div>

              <div
                v-if="node.below"
                class="arap-cell arap-cell--below"
                :style="{ gridColumn: index * 2 + 1, gridRow: 2 }"
              >
                <svg class="arap-arrow arap-arrow--down" viewBox="0 0 28 56" aria-hidden="true">
                  <rect x="9" y="0" width="10" height="7" rx="1" />
                  <rect x="9" y="11" width="10" height="7" rx="1" />
                  <rect x="9" y="22" width="10" height="7" rx="1" />
                  <path d="M2 33 H26 L14 52 Z" />
                </svg>
                <GlFlowTile :node="node.below" :enabled="canAccess(node.below)" />
              </div>
            </template>
          </div>
        </div>

        <div class="arap-side__links">
          <template v-for="link in side.links" :key="link.title">
            <router-link v-if="link.ready" class="arap-link" :to="link.path!">{{ link.title }}</router-link>
            <span v-else class="arap-link arap-link--disabled" title="当前无权限">{{ link.title }}</span>
          </template>
        </div>
      </section>
    </div>

    <!-- 报表查询分区 -->
    <section class="wb-card arap-reports" aria-label="报表查询">
      <header class="arap-reports__head">
        <span class="arap-reports__icon" aria-hidden="true">
          <component :is="resolveNavIcon('Table2')" :size="15" :stroke-width="2" />
        </span>
        <h2 class="arap-reports__title">报表查询</h2>
      </header>
      <div class="arap-reports__grid">
        <template v-for="link in reportLinks" :key="link.title">
          <router-link v-if="link.ready" class="arap-report" :to="link.path!">
            <span class="arap-report__icon"><component :is="resolveNavIcon(link.icon)" :size="16" :stroke-width="1.8" /></span>
            <span class="arap-report__title">{{ link.title }}</span>
          </router-link>
          <span v-else class="arap-report is-disabled" title="当前无权限">
            <span class="arap-report__icon"><component :is="resolveNavIcon(link.icon)" :size="16" :stroke-width="1.8" /></span>
            <span class="arap-report__title">{{ link.title }}</span>
          </span>
        </template>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { NavItem } from '@/config/navigation'
import { normalizeNavPath } from '@/config/flowConfig'
import { resolveNavIcon } from '@/config/navIcons'
import { ARAP_REPORT_LINKS, ARAP_SIDES } from '@/config/arapWorkspace'
import type { GlFlowNode } from '@/config/glWorkspace'
import GlFlowTile from './GlFlowTile.vue'

const props = defineProps<{
  availableItems: NavItem[]
}>()

const itemsByPath = computed(() => {
  const map = new Map<string, NavItem>()
  for (const item of props.availableItems) {
    map.set(normalizeNavPath(item.path), item)
    const bare = normalizeNavPath(item.path.split('?')[0])
    if (!map.has(bare)) map.set(bare, item)
  }
  return map
})

/** 先精确匹配（含查询串），再退回裸路径（side / arap_type 只是预置筛选，不影响权限） */
function hasMenu(path?: string) {
  if (!path) return false
  return itemsByPath.value.has(normalizeNavPath(path)) || itemsByPath.value.has(normalizeNavPath(path.split('?')[0]))
}

/** 单据节点按 doc_type 区分权限（RS/RP 属销售/采购），必须精确命中 */
function canAccess(node: GlFlowNode) {
  if (!node.path) return false
  if (node.path.startsWith('/scm/docs')) return itemsByPath.value.has(normalizeNavPath(node.path))
  return hasMenu(node.path)
}

const sides = computed(() =>
  ARAP_SIDES.map(side => ({
    ...side,
    links: side.links.map(link => ({ ...link, ready: hasMenu(link.path) })),
  }))
)

const reportLinks = computed(() => ARAP_REPORT_LINKS.map(link => ({ ...link, ready: hasMenu(link.path) })))

function gridColumns(count: number) {
  return Array.from({ length: count }, (_, i) => (i < count - 1 ? 'var(--arap-node-w) minmax(28px, 48px)' : 'var(--arap-node-w)')).join(' ')
}
</script>

<style scoped>
.arap-workspace {
  --arap-node-w: 88px;
  --arap-arrow: #e0f2fe;
  --arap-arrow-edge: #7dd3fc;
  display: flex;
  flex-direction: column;
  gap: var(--wb-gap);
  width: 100%;
  min-width: 0;
}

.arap-sides {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--wb-gap);
}

/* ---- 镜像分区卡 ---- */
.arap-side {
  --side-head-bg: var(--mint-100);
  --side-head-fg: var(--mint-700);
  display: flex;
  flex-direction: column;
  min-width: 0;
  border: 1px solid var(--wb-line);
  border-radius: var(--wb-radius);
  background: var(--wb-card);
  overflow: hidden;
}

.arap-side--amber {
  --side-head-bg: var(--warning-soft);
  --side-head-fg: #b97a14;
}

.arap-side__head,
.arap-reports__head {
  height: 34px;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 14px;
  border-bottom: 1px solid var(--wb-line);
  user-select: none;
}

.arap-side__head {
  background: var(--side-head-bg);
  color: var(--side-head-fg);
}

.arap-side__icon,
.arap-reports__icon {
  display: inline-flex;
  align-items: center;
}

.arap-side__icon svg,
.arap-reports__icon svg,
.arap-report__icon svg {
  fill: none;
  stroke: currentColor;
}

.arap-side__title,
.arap-reports__title {
  margin: 0;
  font-size: var(--cw-text-base);
  font-weight: 600;
  letter-spacing: 0.5px;
}

.arap-side__flow {
  padding: 18px 20px 12px;
  overflow-x: auto;
}

.arap-flow {
  display: grid;
  grid-template-rows: auto auto;
  align-items: center;
  justify-items: center;
  justify-content: center;
}

.arap-cell {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-width: 0;
}

.arap-cell--below {
  gap: 4px;
}

.arap-cell--connector {
  width: 100%;
  padding: 0 4px;
  align-self: start;
  margin-top: 18px;
}

.arap-arrow {
  fill: var(--arap-arrow);
  stroke: var(--arap-arrow-edge);
  stroke-width: 1;
  stroke-linejoin: round;
  flex-shrink: 0;
}

.arap-arrow--right {
  width: 100%;
  height: 20px;
}

.arap-arrow--down {
  width: 16px;
  height: 32px;
}

.arap-side__links {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 28px;
  padding: 10px 20px 12px;
  border-top: 1px solid var(--wb-line);
  margin-top: auto;
}

.arap-link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  line-height: 24px;
  font-size: var(--cw-text-sm);
  color: var(--wb-text);
  text-decoration: none;
  white-space: nowrap;
  transition: color 0.14s ease;
}

.arap-link::before {
  content: '»';
  color: var(--side-head-fg);
  font-size: var(--cw-text-base);
  line-height: 1;
}

.arap-link:hover {
  color: var(--side-head-fg);
  text-decoration: underline;
  text-underline-offset: 3px;
}

.arap-link--disabled,
.arap-link--disabled:hover {
  color: var(--wb-text-3);
  cursor: default;
  text-decoration: none;
}

/* ---- 报表查询分区 ---- */
.arap-reports {
  border: 1px solid var(--wb-line);
  border-radius: var(--wb-radius);
  background: var(--wb-card);
  overflow: hidden;
}

.arap-reports__head {
  background: var(--blue-100);
  color: var(--blue-700);
}

.arap-reports__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(168px, 1fr));
  gap: 8px;
  padding: 12px 14px 14px;
}

.arap-report {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 38px;
  padding: 0 10px;
  border: 1px solid var(--wb-line);
  border-radius: var(--wb-radius-sm);
  color: var(--wb-text);
  font-size: var(--cw-text-sm);
  text-decoration: none;
  transition: border-color 0.16s ease, color 0.16s ease, background 0.16s ease;
}

.arap-report:hover:not(.is-disabled) {
  border-color: var(--blue-500);
  color: var(--blue-700);
  background: var(--blue-100);
}

.arap-report__icon {
  display: inline-flex;
  color: var(--blue-700);
}

.arap-report__title {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.arap-report.is-disabled {
  color: var(--wb-text-3);
  cursor: default;
}

.arap-report.is-disabled .arap-report__icon {
  color: var(--wb-text-3);
}

@media (max-width: 1100px) {
  .arap-sides {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
