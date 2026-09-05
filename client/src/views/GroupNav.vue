<template>
  <div class="group-nav-container mint-dashboard module-home">
    <div v-if="currentApp && availableItems.length > 0" class="group-nav-shell">
      <!-- 模块头部：图标 + 标题 + 说明 + 主入口；按模块着色建立识别度 -->
      <header class="wb-card wb-card--raised module-head" :class="accentClass">
        <div class="module-head__main">
          <span class="module-head__icon">
            <component :is="resolveNavIcon(currentApp.icon)" :size="20" :stroke-width="1.8" />
          </span>
          <div class="module-head__text">
            <h1 class="module-head__title">{{ currentApp.title }}</h1>
            <p class="module-head__desc">
              {{ currentApp.description || `在此处理 ${currentApp.title} 相关的业务操作` }}
            </p>
          </div>
        </div>
        <div class="module-head__side">
          <span class="module-head__stat">{{ currentApp.sections.length }} 个分组 · {{ availableItems.length }} 项功能</span>
          <div class="module-head__actions">
            <router-link v-if="primaryEntry" class="module-btn module-btn--primary" :to="primaryEntry.path">
              <component :is="getIcon(primaryEntry)" :size="14" :stroke-width="1.8" />
              {{ primaryEntry.title }}
            </router-link>
            <router-link v-if="secondaryEntry" class="module-btn" :to="secondaryEntry.path">
              <component :is="getIcon(secondaryEntry)" :size="14" :stroke-width="1.8" />
              {{ secondaryEntry.title }}
            </router-link>
          </div>
        </div>
      </header>

      <template v-if="currentFlowConfig && currentFlowConfig.layout === 'flow'">
        <ProcessFlow
          :config="currentFlowConfig"
          :availableItems="flowAvailableItems"
          :iconResolver="getIcon"
        />
        <BentoGrid
          v-if="remainderApp && remainderApp.sections.length"
          :app="remainderApp"
          :iconResolver="getIcon"
          heading="其他功能"
        />
      </template>
      <template v-else>
        <BentoGrid :app="currentApp" :iconResolver="getIcon" />
      </template>
    </div>

    <div v-else class="empty-state-wrapper">
      <div class="wb-card empty-state-card">
        <div class="empty-icon-wrapper">
          <el-icon class="empty-icon"><Warning /></el-icon>
        </div>
        <h2 class="empty-title">当前模块暂无内容或未开放访问</h2>
        <p class="empty-subtitle">请联系管理员分配权限，或返回主页查看其他模块</p>
        <button type="button" class="module-btn module-btn--primary" @click="$router.push('/')">返回主页</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, inject, type Component, type Ref } from 'vue'
import { useRoute } from 'vue-router'
import { Warning } from '@element-plus/icons-vue'
import { flattenNavApp, flattenNavApps, type NavApp, type NavItem } from '@/config/navigation'
import { resolveNavIcon } from '@/config/navIcons'
import { collectFlowCoveredPaths, groupFlowMap, normalizeNavPath } from '@/config/flowConfig'
import { resolveNavAppTitle } from '@/utils/groupNavigation'
import ProcessFlow from './components/ProcessFlow.vue'
import BentoGrid from './components/BentoGrid.vue'

const route = useRoute()

const navApps = inject('layoutNavApps') as Ref<NavApp[]> | undefined

const currentApp = computed<NavApp | null>(() => {
  if (!navApps?.value) return null
  const title = resolveNavAppTitle(String(route.params.groupTitle || ''))
  return navApps.value.find(app => app.title === title) || null
})

const currentFlowConfig = computed(() => {
  if (!currentApp.value) return null
  return groupFlowMap[currentApp.value.title] || null
})

/** 流程（主干 + 分支 + 辅助）已展示的入口，下方宫格不再重复 */
const remainderApp = computed<NavApp | null>(() => {
  if (!currentApp.value) return null
  const covered = collectFlowCoveredPaths(currentFlowConfig.value)
  if (!covered.size) return currentApp.value
  const sections = currentApp.value.sections
    .map(section => ({
      ...section,
      items: section.items.filter(item => !covered.has(normalizeNavPath(item.path))),
    }))
    .filter(section => section.items.length > 0)
  return { ...currentApp.value, sections }
})

const availableItems = computed<NavItem[]>(() => (currentApp.value ? flattenNavApp(currentApp.value) : []))

/** 流程图节点可能跨应用引用（如财务流程里的会计科目），因此用全部可见页面匹配 */
const flowAvailableItems = computed<NavItem[]>(() =>
  navApps?.value ? flattenNavApps(navApps.value) : availableItems.value
)

/** 模块头主按钮：财务总账指向「新增凭证」（打开录入弹窗），菜单/流程节点仍用原标题 */
function primaryCta(item: NavItem | undefined) {
  if (!item) return null
  if (normalizeNavPath(item.path) === '/voucher/entry') {
    return { ...item, title: '新增凭证', path: '/voucher/entry?action=add' }
  }
  return item
}

const primaryEntry = computed(() => primaryCta(availableItems.value[0]))
const secondaryEntry = computed(() => availableItems.value[1])

/** 模块识别色：左侧竖条 + 头部图标底色随模块变化，避免所有主页长一个样 */
const MODULE_ACCENTS: Record<string, string> = {
  finance: 'mint',
  cashier: 'foam',
  asset: 'lilac',
  purchase: 'amber',
  sales: 'rose',
  inventory: 'blue',
  arap: 'mint',
  production: 'lilac',
  outsource: 'amber',
  basedata: 'blue',
  system: 'foam',
}
const accentClass = computed(() => `module-head--${MODULE_ACCENTS[currentApp.value?.key || ''] || 'mint'}`)

const allItemsByPath = computed(() => {
  const map = new Map<string, NavItem>()
  for (const item of flowAvailableItems.value) map.set(item.path, item)
  return map
})

/** 页面图标：优先菜单项自带 icon；传路径时按路径（含查询串）查找 */
function getIcon(target: NavItem | string): Component {
  const item = typeof target === 'string' ? allItemsByPath.value.get(target) : target
  return resolveNavIcon(item?.icon)
}
</script>

<style scoped>
.group-nav-container {
  width: 100%;
  min-height: 100%;
  color: var(--wb-text);
  font-family: 'PingFang SC', 'Microsoft YaHei', -apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif;
  -webkit-font-smoothing: antialiased;
}

.group-nav-shell {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: var(--wb-gap);
}

/* ---- 模块头部卡：左侧 3px 识别色竖条 + 同色图标底 ---- */
.module-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 16px 12px 13px;
  border-left: 3px solid var(--mint-500);
}

.module-head--mint { border-left-color: var(--mint-500); }
.module-head--blue { border-left-color: var(--blue-500); }
.module-head--lilac { border-left-color: #9c8ff5; }
.module-head--amber { border-left-color: var(--warning); }
.module-head--rose { border-left-color: var(--danger); }
.module-head--foam { border-left-color: #2e9fb8; }

.module-head--mint .module-head__icon { background: var(--mint-100); color: var(--mint-700); }
.module-head--blue .module-head__icon { background: var(--blue-100); color: var(--blue-700); }
.module-head--lilac .module-head__icon { background: #ede9ff; color: #6f5fd8; }
.module-head--amber .module-head__icon { background: var(--warning-soft); color: #b97a14; }
.module-head--rose .module-head__icon { background: var(--danger-soft); color: #d7434a; }
.module-head--foam .module-head__icon { background: #e3f6fb; color: #1e7f9a; }

.module-head__main {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

/* 与应用栏同一图标语言：浅底 + 薄荷线条，20px */
.module-head__icon {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
  color: var(--mint-700);
  background: var(--mint-100);
  flex-shrink: 0;
}

.module-head__icon svg {
  fill: none;
  stroke: currentColor;
}

.module-head__text {
  min-width: 0;
}

.module-head__title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  line-height: 1.3;
  color: var(--wb-text);
}

.module-head__desc {
  margin: 3px 0 0;
  font-size: 12px;
  color: var(--wb-text-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.module-head__side {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-shrink: 0;
}

.module-head__stat {
  font-size: 12px;
  color: var(--wb-text-3);
  white-space: nowrap;
}

.module-head__actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.module-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 12px;
  border: 1px solid var(--wb-line-strong);
  border-radius: var(--wb-radius-sm);
  background: var(--wb-card);
  color: var(--wb-text);
  font-size: 12.5px;
  font-weight: 500;
  text-decoration: none;
  cursor: pointer;
  white-space: nowrap;
  transition: border-color 0.16s ease, background 0.16s ease, color 0.16s ease;
}

.module-btn:hover {
  border-color: var(--mint-500);
  color: var(--mint-700);
}

.module-btn svg {
  flex-shrink: 0;
  fill: none;
  stroke: currentColor;
}

.module-btn--primary {
  border-color: var(--mint-500);
  background: var(--mint-500);
  color: #fff;
}

.module-btn--primary:hover {
  border-color: var(--mint-600);
  background: var(--mint-600);
  color: #fff;
}

/* ---- 空状态 ---- */
.empty-state-wrapper {
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 80px 24px;
}

.empty-state-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 40px 32px;
  max-width: 440px;
  width: 100%;
}

.empty-icon-wrapper {
  width: 56px;
  height: 56px;
  border-radius: 14px;
  background: var(--surface-brand-soft);
  color: var(--mint-600);
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 18px;
}

.empty-icon {
  font-size: 28px;
}

.empty-title {
  margin: 0 0 8px;
  font-size: 16px;
  font-weight: 600;
  color: var(--wb-text);
}

.empty-subtitle {
  margin: 0 0 22px;
  font-size: 13px;
  color: var(--wb-text-3);
  line-height: 1.6;
}

@media (min-width: 1920px) {
  .group-nav-container {
    padding: 0 4vw;
  }
}

@media (max-width: 900px) {
  .module-head {
    flex-direction: column;
    align-items: flex-start;
  }

  .module-head__side {
    width: 100%;
    justify-content: space-between;
  }

  .module-head__desc {
    white-space: normal;
  }
}

@media (max-width: 600px) {
  .module-head__side {
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
  }

  .module-head__actions {
    flex-wrap: wrap;
  }
}
</style>
