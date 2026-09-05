<template>
  <section class="wb-card flow-card">
    <div class="wb-card__head">
      <div class="wb-card__heading">
        <h3 class="wb-card__title">核心业务流程</h3>
        <p class="wb-card__desc">按标准步骤完成日常业务流转</p>
      </div>
      <span class="wb-card__note">{{ config.mainNodes?.length || 0 }} 个步骤</span>
    </div>

    <div class="flow-track-wrap">
      <ol class="flow-track">
        <template v-for="(node, index) in config.mainNodes" :key="node.id">
          <li class="flow-step">
            <router-link
              :to="getRoutePath(node)"
              class="flow-node"
              :class="{ 'is-disabled': !canAccess(node) }"
              :aria-disabled="!canAccess(node)"
              @click.prevent="!canAccess(node) && $event.preventDefault()"
            >
              <span class="flow-node__index" :class="`is-${node.color || 'blue'}`">{{ index + 1 }}</span>
              <span class="flow-node__icon" :class="`is-${node.color || 'blue'}`">
                <component :is="getIcon(node)" :size="20" :stroke-width="1.8" />
              </span>
              <span class="flow-node__title">{{ getTitle(node) }}</span>
            </router-link>

            <!-- 分支节点 -->
            <div v-if="node.branches && node.branches.length > 0" class="flow-branches">
              <router-link
                v-for="branch in node.branches"
                :key="branch.id"
                :to="getRoutePath(branch)"
                class="flow-branch"
                :class="{ 'is-disabled': !canAccess(branch) }"
                :aria-disabled="!canAccess(branch)"
                @click.prevent="!canAccess(branch) && $event.preventDefault()"
              >
                <span class="flow-branch__icon" :class="`is-${branch.color || 'orange'}`">
                  <component :is="getIcon(branch)" :size="14" :stroke-width="1.8" />
                </span>
                <span class="flow-branch__title">{{ getTitle(branch) }}</span>
              </router-link>
            </div>
          </li>

          <li v-if="index < (config.mainNodes?.length || 0) - 1" class="flow-connector" aria-hidden="true">
            <span class="flow-connector__line"></span>
            <el-icon class="flow-connector__arrow"><ArrowRight /></el-icon>
          </li>
        </template>
      </ol>
    </div>

    <!-- 辅助操作 -->
    <div v-if="visibleAuxNodes.length > 0" class="flow-aux">
      <div class="flow-aux__head">
        <span class="flow-aux__title">辅助操作</span>
        <span class="wb-card__note">{{ visibleAuxNodes.length }} 项</span>
      </div>
      <div class="app-grid flow-aux__grid">
        <router-link
          v-for="(aux, aIndex) in visibleAuxNodes"
          :key="aux.id"
          :to="getRoutePath(aux)"
          class="app-tile"
          :class="[auxVariant(aux, aIndex), { 'is-disabled': !canAccess(aux) }]"
          :aria-disabled="!canAccess(aux)"
          @click.prevent="!canAccess(aux) && $event.preventDefault()"
        >
          <span class="app-tile__icon">
            <component :is="getIcon(aux)" :size="20" :stroke-width="1.8" />
          </span>
          <span class="app-tile__label">{{ getTitle(aux) }}</span>
        </router-link>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, type Component } from 'vue'
import { ArrowRight } from '@element-plus/icons-vue'
import type { ModuleFlowConfig, FlowNode } from '@/config/flowConfig'
import type { NavItem } from '@/config/navigation'
import { resolveNavIcon } from '@/config/navIcons'

const props = defineProps<{
  config: ModuleFlowConfig
  availableItems: NavItem[]
  iconResolver: (item: NavItem | string) => Component
}>()

function findMenuItem(node: FlowNode): NavItem | null {
  if (!node.path) return null
  const exactMatch = props.availableItems.find(item => item.path === node.path)
  if (exactMatch) return exactMatch
  return props.availableItems.find(item => item.path.split('?')[0] === node.path?.split('?')[0]) || null
}

function canAccess(node: FlowNode) {
  return !!findMenuItem(node)
}

/** 辅助操作只展示当前有权访问的节点；主流程节点保留占位以呈现完整业务链 */
const visibleAuxNodes = computed(() => (props.config.auxNodes || []).filter(canAccess))

function getTitle(node: FlowNode) {
  const item = findMenuItem(node)
  return node.title || item?.title || '未开放'
}

function getRoutePath(node: FlowNode) {
  const item = findMenuItem(node)
  return item?.path || node.path || ''
}

function getIcon(node: FlowNode): Component {
  if (node.icon) return resolveNavIcon(node.icon)
  const item = findMenuItem(node)
  return item ? props.iconResolver(item) : resolveNavIcon('FileText')
}

/** 流程配置里的语义色 → 宫格磁贴配色 */
const AUX_COLOR_VARIANT: Record<string, string> = {
  blue: 'blue',
  indigo: 'blue',
  green: 'mint',
  cyan: 'foam',
  orange: 'amber',
  yellow: 'amber',
  purple: 'lilac',
  red: 'rose',
  pink: 'rose',
}
const variants = ['mint', 'blue', 'lilac', 'amber', 'rose', 'foam']

function auxVariant(node: FlowNode, index: number) {
  const mapped = node.color ? AUX_COLOR_VARIANT[node.color] : undefined
  return `is-${mapped || variants[index % variants.length]}`
}
</script>

<style scoped>
.flow-card {
  min-width: 0;
}

/* ---- 主流程轨 ---- */
.flow-track-wrap {
  overflow-x: auto;
  padding: 6px 2px 10px;
  scrollbar-width: thin;
}

.flow-track {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  align-items: flex-start;
  min-width: max-content;
}

.flow-step {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.flow-node {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 10px 10px 8px;
  min-width: 96px;
  max-width: 112px;
  border: 1px solid var(--wb-line);
  border-radius: var(--wb-radius);
  background: var(--wb-card);
  color: inherit;
  text-decoration: none;
  cursor: pointer;
  transition: border-color 0.16s ease, box-shadow 0.16s ease, transform 0.16s ease;
}

.flow-node:hover:not(.is-disabled) {
  border-color: var(--mint-500);
  box-shadow: var(--wb-shadow-hover);
  transform: translateY(-1px);
}

.flow-node:focus-visible {
  outline: 2px solid var(--focus-ring);
  outline-offset: -2px;
}

.flow-node.is-disabled {
  opacity: 0.45;
  cursor: not-allowed;
  filter: grayscale(1);
}

.flow-node__index {
  position: absolute;
  top: -8px;
  left: 10px;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 999px;
  background: var(--wb-card);
  color: var(--wb-text-3);
  font-size: 11px;
  font-weight: 600;
  line-height: 18px;
  text-align: center;
}

.flow-node__icon,
.flow-branch__icon {
  width: 36px;
  height: 36px;
  border-radius: 10px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
}

.flow-node__icon svg,
.flow-branch__icon svg {
  fill: none;
  stroke: currentColor;
}

.flow-node__title {
  font-size: 12px;
  font-weight: 500;
  line-height: 1.3;
  color: var(--wb-text);
  text-align: center;
  width: 100%;
  white-space: normal;
  overflow-wrap: anywhere;
}

/* 连接线 */
.flow-connector {
  display: flex;
  align-items: center;
  width: 40px;
  margin: 34px 4px 0;
  flex-shrink: 0;
}

.flow-connector__line {
  flex: 1;
  height: 1px;
  background: var(--wb-line-strong);
}

.flow-connector__arrow {
  color: var(--wb-text-3);
  font-size: 13px;
  margin-left: -2px;
}

/* 分支节点 */
.flow-branches {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  margin-top: 18px;
  padding-top: 6px;
}

.flow-branches::before {
  content: '';
  position: absolute;
  top: -18px;
  left: 50%;
  height: 18px;
  border-left: 1px dashed var(--wb-line-strong);
}

.flow-branch {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 30px;
  padding: 0 10px 0 5px;
  border: 1px dashed var(--wb-line-strong);
  border-radius: var(--wb-radius-sm);
  background: var(--wb-card);
  color: inherit;
  text-decoration: none;
  transition: border-color 0.16s ease, background 0.16s ease;
}

.flow-branch:hover:not(.is-disabled) {
  border-color: var(--mint-500);
  background: var(--surface-brand-soft);
}

.flow-branch.is-disabled {
  opacity: 0.45;
  cursor: not-allowed;
  filter: grayscale(1);
}

.flow-branch__icon {
  width: 22px;
  height: 22px;
  border-radius: 6px;
  font-size: 14px;
}

.flow-branch__title {
  font-size: 12px;
  color: var(--wb-text-2);
  white-space: nowrap;
}

/* ---- 辅助操作 ---- */
.flow-aux {
  margin-top: 10px;
  padding-top: 12px;
  border-top: 1px solid var(--wb-line);
}

.flow-aux__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}

.flow-aux__title {
  font-size: 13px;
  font-weight: 600;
  color: var(--wb-text-2);
}

.flow-aux__grid {
  grid-template-columns: repeat(auto-fill, minmax(88px, 1fr));
}

/* ---- 流程配置语义色 ----
   必须挂在图标容器上，不能写成裸 .is-blue：
   辅助操作磁贴也带 is-blue/is-mint，裸选择器会把整块磁贴刷成大色块。 */
.flow-node__icon.is-blue,
.flow-node__icon.is-indigo,
.flow-branch__icon.is-blue,
.flow-branch__icon.is-indigo { background: var(--blue-100); color: var(--blue-700); }
.flow-node__icon.is-green,
.flow-branch__icon.is-green { background: var(--mint-100); color: var(--mint-700); }
.flow-node__icon.is-cyan,
.flow-branch__icon.is-cyan { background: var(--surface-brand-soft); color: var(--mint-600); }
.flow-node__icon.is-orange,
.flow-node__icon.is-yellow,
.flow-branch__icon.is-orange,
.flow-branch__icon.is-yellow { background: var(--warning-soft); color: #b97a14; }
.flow-node__icon.is-purple,
.flow-branch__icon.is-purple { background: #ede9ff; color: #6f5fd8; }
.flow-node__icon.is-red,
.flow-node__icon.is-pink,
.flow-branch__icon.is-red,
.flow-branch__icon.is-pink { background: var(--danger-soft); color: #d7434a; }

/* 步骤序号：无底色，仅文字随节点语义色变化 */
.flow-node__index.is-blue,
.flow-node__index.is-indigo { background: var(--wb-card); color: var(--blue-500); }
.flow-node__index.is-green { background: var(--wb-card); color: var(--mint-600); }
.flow-node__index.is-cyan { background: var(--wb-card); color: #2e9fb8; }
.flow-node__index.is-orange,
.flow-node__index.is-yellow { background: var(--wb-card); color: #d98a10; }
.flow-node__index.is-purple { background: var(--wb-card); color: #8a7cf0; }
.flow-node__index.is-red,
.flow-node__index.is-pink { background: var(--wb-card); color: var(--danger); }

@media (max-width: 760px) {
  .flow-node {
    min-width: 88px;
    max-width: 104px;
    padding: 10px 8px 8px;
  }

  .flow-connector {
    width: 28px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .flow-node,
  .flow-branch {
    transition: none;
  }

  .flow-node:hover:not(.is-disabled) {
    transform: none;
  }
}
</style>
