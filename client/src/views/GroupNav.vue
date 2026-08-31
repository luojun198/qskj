<template>
  <div class="group-nav-container mint-dashboard" :class="{ 'is-ledger-home': isLedgerHome }">
    <div v-if="currentGroup && availableItems.length > 0" class="group-nav-shell">
      <!-- 借用 Dashboard 的 hero 样式 -->
      <section class="hero-section">
        <div class="hero-bg">
          <div class="hero-gradient"></div>
          <div class="hero-bubble hero-bubble--1"></div>
          <div class="hero-bubble hero-bubble--2"></div>
          <div class="hero-bubble hero-bubble--3"></div>
        </div>
        <div class="hero-content">
          <div class="hero-header">
            <div class="hero-eyebrow">
              <span class="eyebrow-icon">
                <el-icon><component :is="currentGroup.icon" v-if="currentGroup.icon" /></el-icon>
              </span>
              模块导航
            </div>
            <h1 class="hero-title">{{ currentGroup.title }}</h1>
            <div class="hero-meta-row">
              <p class="hero-subtitle">在此处理 {{ currentGroup.title }} 相关的业务操作</p>
            </div>
          </div>
          <div class="hero-shortcuts">
            <router-link v-if="primaryEntry" class="shortcut-card" :to="primaryEntry.path">
              <div class="shortcut-icon" style="background: rgba(255,255,255,0.2); color: #fff;">
                <el-icon><component :is="getIcon(primaryEntry.path)" /></el-icon>
              </div>
              <div class="shortcut-content">
                <span class="shortcut-label">{{ primaryEntry.title }}</span>
                <span class="shortcut-desc">主要操作</span>
              </div>
              <svg class="shortcut-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M9 18l6-6-6-6"/>
              </svg>
            </router-link>
            <router-link v-if="secondaryEntry" class="shortcut-card" :to="secondaryEntry.path">
              <div class="shortcut-icon" style="background: rgba(255,255,255,0.2); color: #fff;">
                <el-icon><component :is="getIcon(secondaryEntry.path)" /></el-icon>
              </div>
              <div class="shortcut-content">
                <span class="shortcut-label">{{ secondaryEntry.title }}</span>
                <span class="shortcut-desc">快捷入口</span>
              </div>
              <svg class="shortcut-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M9 18l6-6-6-6"/>
              </svg>
            </router-link>
          </div>
        </div>
      </section>

      <section v-if="isLedgerHome" class="metrics-section">
        <h3 class="section-heading">核心账簿</h3>
        <div class="metrics-grid" style="grid-template-columns: repeat(3, minmax(0, 1fr));">
          <router-link
            v-for="entry in ledgerHighlights"
            :key="entry.path"
            :to="entry.path"
            class="metric-card"
            style="text-decoration: none;"
          >
            <div class="metric-icon" style="background: rgba(46, 132, 245, 0.12); color: #2E84F5;">
              <el-icon><component :is="getIcon(entry.path)" /></el-icon>
            </div>
            <div class="metric-content">
              <span class="metric-value" style="font-size: 16px;">{{ entry.title }}</span>
              <span class="metric-hint" style="white-space: normal; line-height: 1.4; margin-top: 4px;">{{ entry.desc }}</span>
            </div>
          </router-link>
        </div>
      </section>

      <template v-if="currentFlowConfig && currentFlowConfig.layout === 'flow'">
        <ProcessFlow
          :config="currentFlowConfig"
          :availableItems="flowAvailableItems"
          :iconResolver="getIcon"
        />
      </template>
      <template v-else>
        <BentoGrid
          :group="currentGroup"
          :iconResolver="getIcon"
          :paginate-sub-groups="currentGroup.title === '基础设置'"
        />
      </template>
    </div>
    <div v-else class="empty-state-wrapper animate-stagger">
      <div class="empty-state-card">
        <div class="empty-icon-wrapper">
          <el-icon class="empty-icon"><Warning /></el-icon>
        </div>
        <h2 class="empty-title">当前模块暂无内容或未开放访问</h2>
        <p class="empty-subtitle">请联系管理员分配权限，或返回主页查看其他模块</p>
        <button class="empty-action-btn" @click="$router.push('/')">返回主页</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, inject, type Ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Warning } from '@element-plus/icons-vue'
import type { NavGroup, NavItem } from '@/config/navigation'
import { groupFlowMap } from '@/config/flowConfig'
import ProcessFlow from './components/ProcessFlow.vue'
import BentoGrid from './components/BentoGrid.vue'

interface HighlightEntry extends NavItem {
  desc: string
}

const route = useRoute()
const router = useRouter()

const menuGroups = inject('layoutMenuGroups') as Ref<NavGroup[]> | undefined

const currentGroup = computed(() => {
  if (!menuGroups?.value) return null
  const title = route.params.groupTitle
  return menuGroups.value.find(g => g.title === title) || null
})

const currentFlowConfig = computed(() => {
  if (!currentGroup.value) return null
  return groupFlowMap[currentGroup.value.title] || null
})

const availableItems = computed<NavItem[]>(() => {
  if (!currentGroup.value) return []
  const items: NavItem[] = []
  if (currentGroup.value.children) {
    items.push(...currentGroup.value.children)
  }
  if (currentGroup.value.subGroups) {
    currentGroup.value.subGroups.forEach(sg => items.push(...sg.items))
  }
  return items
})

const flowAvailableItems = computed(() => {
  if (!menuGroups?.value) return availableItems.value
  const items: NavItem[] = []
  menuGroups.value.forEach(group => {
    if (group.children) {
      items.push(...group.children)
    }
    if (group.subGroups) {
      group.subGroups.forEach(sg => items.push(...sg.items))
    }
  })
  return items
})

const isLedgerHome = computed(() => currentGroup.value?.title === '账簿管理')

const primaryEntry = computed(() => availableItems.value[0])
const secondaryEntry = computed(() => availableItems.value[1])

const ledgerHighlights = computed<HighlightEntry[]>(() => {
  const descMap: Record<string, string> = {
    '/ledger/general': '快速查看期初、本期发生和期末余额。',
    '/ledger/detail': '按科目追查凭证分录和余额变化。',
    '/ledger/balance': '查看总分类账的借贷发生和余额。',
  }
  return availableItems.value
    .filter(item => descMap[item.path])
    .map(item => ({ ...item, desc: descMap[item.path] }))
})

const routes = router.getRoutes()

function getIcon(path: string): string {
  const cleanPath = path.split('?')[0]
  const match = routes.find(r => r.path === cleanPath || r.path === path)
  return (match?.meta?.icon as string) || 'Menu'
}
</script>

<style scoped>
@import './Dashboard.styles.css';

.group-nav-container {
  width: 100%;
}

.group-nav-shell {
  width: 100%;
}

.section-heading {
  margin: 0 0 16px 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--text-strong);
}

.empty-state-wrapper {
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 100px 24px;
}

.empty-state-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 48px;
  background: var(--surface-card);
  border-radius: var(--radius-xl);
  border: 1px solid var(--border-subtle);
  box-shadow: var(--shadow-sm), var(--sheen);
  max-width: 480px;
  width: 100%;
}

.empty-icon-wrapper {
  width: 64px;
  height: 64px;
  border-radius: var(--radius-pill);
  background: var(--surface-brand-soft);
  color: var(--mint-600);
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 24px;
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.65);
}

.empty-icon {
  font-size: 32px;
}

.empty-title {
  margin: 0 0 12px;
  font-size: 18px;
  font-weight: 600;
  color: var(--text-strong);
}

.empty-subtitle {
  margin: 0 0 32px;
  font-size: 14px;
  color: var(--text-muted);
  line-height: 1.6;
}

.empty-action-btn {
  padding: 10px 24px;
  background: var(--brand);
  color: #fff;
  border: none;
  border-radius: var(--radius-md);
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  box-shadow: 0 2px 8px rgba(18,199,174,0.3);
  transition: all var(--dur-base) var(--ease-bubble);
}

.empty-action-btn:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(18,199,174,0.4);
  background: var(--mint-500);
}

@media (min-width: 1920px) {
  .group-nav-container {
    padding: 0 4vw;
  }
}

@media (max-width: 1024px) {
  .hero-shortcuts {
    grid-template-columns: 1fr;
    min-width: 240px;
  }
}

@media (max-width: 768px) {
  .hero-content {
    flex-direction: column;
    align-items: stretch;
  }
  
  .hero-shortcuts {
    width: 100%;
    margin-top: 16px;
  }

  .metrics-grid {
    grid-template-columns: 1fr !important;
  }

  .empty-state-wrapper {
    padding: 40px 16px;
  }

  .empty-state-card {
    padding: 32px 20px;
  }
}
</style>
