<template>
  <div class="bento-grid-container">
    <template v-if="group.subGroups && group.subGroups.length > 0">
      <div v-if="paginateSubGroups && group.subGroups?.length" class="subgroup-page">
        <el-tabs v-model="activeTabLabel" class="subgroup-tabs" @tab-change="onTabChange">
          <el-tab-pane
            v-for="tab in tabItems"
            :key="tab.label"
            :label="tab.label"
            :name="tab.label"
          >
            <div class="vertical-card-body--grid">
              <router-link
                v-for="item in tab.items"
                :key="item.path"
                :to="item.path"
                class="small-action-btn"
                :class="variantClass(getTabIndex(tab.label))"
              >
                <div class="small-action-icon-wrapper">
                  <el-icon class="small-action-icon">
                    <component :is="iconResolver(item.path)" />
                  </el-icon>
                </div>
                <span class="small-action-title">{{ item.title }}</span>
              </router-link>
            </div>
          </el-tab-pane>
        </el-tabs>
      </div>
      <div v-else-if="group.children.length > 0" class="vertical-cards-container">
        <div class="vertical-card animate-stagger" :style="{ animationDelay: `0s` }">
          <div class="vertical-card-header">
            <h3 class="vertical-card-title">常用功能</h3>
            <span class="vertical-card-count">{{ group.children.length }} 项</span>
          </div>
          <div class="vertical-card-body">
            <router-link
              v-for="item in group.children"
              :key="item.path"
              :to="item.path"
              class="small-action-btn"
              :class="variantClass(0)"
            >
              <div class="small-action-icon-wrapper">
                <el-icon class="small-action-icon">
                  <component :is="iconResolver(item.path)" />
                </el-icon>
              </div>
              <span class="small-action-title">{{ item.title }}</span>
            </router-link>
          </div>
        </div>
        <div
          v-for="(sg, index) in group.subGroups"
          :key="sg.label"
          class="vertical-card animate-stagger"
          :style="{ animationDelay: `${(index + 1) * 0.05}s` }"
        >
          <div class="vertical-card-header">
            <h3 class="vertical-card-title">{{ sg.label }}</h3>
            <span class="vertical-card-count">{{ sg.items.length }} 项</span>
          </div>
          <div class="vertical-card-body">
            <router-link
              v-for="item in sg.items"
              :key="item.path"
              :to="item.path"
              class="small-action-btn"
              :class="variantClass(index + 1)"
            >
              <div class="small-action-icon-wrapper">
                <el-icon class="small-action-icon">
                  <component :is="iconResolver(item.path)" />
                </el-icon>
              </div>
              <span class="small-action-title">{{ item.title }}</span>
            </router-link>
          </div>
        </div>
      </div>
      <div v-else class="vertical-cards-container">
        <div
          v-for="(sg, index) in group.subGroups"
          :key="sg.label"
          class="vertical-card animate-stagger"
          :style="{ animationDelay: `${index * 0.05}s` }"
        >
          <div class="vertical-card-header">
            <h3 class="vertical-card-title">{{ sg.label }}</h3>
            <span class="vertical-card-count">{{ sg.items.length }} 项</span>
          </div>
          <div class="vertical-card-body">
            <router-link
              v-for="item in sg.items"
              :key="item.path"
              :to="item.path"
              class="small-action-btn"
              :class="variantClass(index)"
            >
              <div class="small-action-icon-wrapper">
                <el-icon class="small-action-icon">
                  <component :is="iconResolver(item.path)" />
                </el-icon>
              </div>
              <span class="small-action-title">{{ item.title }}</span>
            </router-link>
          </div>
        </div>
      </div>
    </template>
    <template v-else-if="group.children && group.children.length > 0">
      <section class="bento-section">
        <div class="section-head">
          <div>
            <h2 class="section-title">常用入口</h2>
            <span class="section-subtitle">按日常处理顺序整理</span>
          </div>
        </div>
        <div class="bento-grid">
          <router-link
            v-for="(item, i) in group.children"
            :key="item.path"
            :to="item.path"
            class="bento-card animate-stagger"
            :class="[
              variantClass(i),
              { 'bento-card--featured': i === 0 && group.children.length >= 4 },
            ]"
            :style="{ animationDelay: `${i * 0.05}s` }"
          >
            <span class="bento-card__index">{{ formatIndex(i + 1) }}</span>
            <div class="bento-icon-wrapper">
              <el-icon class="bento-icon">
                <component :is="iconResolver(item.path)" />
              </el-icon>
            </div>
            <div class="bento-info">
              <span class="bento-title">{{ item.title }}</span>
              <span class="bento-desc">{{ getDescription(item.title, i) }}</span>
            </div>
            <el-icon class="bento-action-icon"><Right /></el-icon>
          </router-link>
        </div>
      </section>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Right } from '@element-plus/icons-vue'
import type { NavGroup, NavSubGroup } from '@/config/navigation'

const props = withDefaults(
  defineProps<{
    group: NavGroup
    iconResolver: (path: string) => string
    paginateSubGroups?: boolean
  }>(),
  {
    paginateSubGroups: false,
  }
)

interface TabItem {
  label: string
  items: NavSubGroup['items']
}

const activeTabLabel = ref('')

const tabItems = computed<TabItem[]>(() => {
  const result: TabItem[] = []
  if (props.group.children.length > 0) {
    result.push({ label: '常用功能', items: props.group.children })
  }
  if (props.group.subGroups) {
    for (const sg of props.group.subGroups) {
      result.push({ label: sg.label, items: sg.items })
    }
  }
  return result
})

watch(
  () => props.group.title,
  () => {
    activeTabLabel.value = tabItems.value[0]?.label || ''
  }
)

watch(
  tabItems,
  items => {
    if (!activeTabLabel.value || !items.some(t => t.label === activeTabLabel.value)) {
      activeTabLabel.value = items[0]?.label || ''
    }
  },
  { immediate: true }
)

function getTabIndex(label: string) {
  return tabItems.value.findIndex(t => t.label === label)
}

function onTabChange() {
  // placeholder for future needs
}

const variants = ['mint', 'blue', 'lilac', 'amber', 'rose', 'foam']

const descriptionMap: Record<string, string> = {
  科目余额表: '按科目汇总期初、本期发生和期末余额。',
  明细账: '穿透查看科目的逐笔凭证分录。',
  总分类账: '复核总账科目的借贷发生和方向。',
  日记账: '查看现金、银行账户日常流水。',
  现金流量试算平衡表: '检查现金流量项目与凭证数据是否平衡。',
  序时账: '按时间顺序浏览全部凭证流水。',
  标准报表: '查看常用财务报表和打印输出。',
  辅助项目余额表: '按辅助项目汇总余额。',
  辅助项目明细账: '追查辅助项目的逐笔发生记录。',
}

function variantClass(index: number) {
  return `is-${variants[index % variants.length]}`
}

function formatIndex(index: number) {
  return String(index).padStart(2, '0')
}

function getDescription(title: string, index: number) {
  return (
    descriptionMap[title] ||
    (index === 0 ? '高频入口，适合从这里开始处理。' : `进入 ${title} 相关页面。`)
  )
}
</script>

<style scoped>
@import '../Dashboard.styles.css';

.bento-grid-container {
  padding: 16px 0;
}

.bento-section {
  margin-bottom: 40px;
}

.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 24px;
}

.section-title {
  margin: 0;
  color: var(--text-strong);
  font-size: 20px;
  font-weight: 800;
  letter-spacing: -0.5px;
}

.section-subtitle {
  display: block;
  margin-top: 6px;
  color: var(--text-muted);
  font-size: 14px;
}

.bento-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  grid-auto-flow: dense;
  gap: 16px;
}

.bento-card {
  position: relative;
  display: flex;
  align-items: flex-start;
  gap: 16px;
  padding: 20px;
  border-radius: var(--radius-lg);
  border: 1px solid var(--border-subtle);
  background: var(--surface-card);
  box-shadow: var(--shadow-xs), var(--sheen);
  color: inherit;
  text-decoration: none;
  overflow: hidden;
  transition: all var(--dur-base) var(--ease-bubble);
}

.bento-card::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 3px;
  background: var(--grad-bubble);
  opacity: 0;
  transition: opacity var(--dur-base) var(--ease-out);
}

.bento-card:hover {
  transform: translateY(-3px);
  box-shadow: var(--shadow-md);
  border-color: var(--border-brand);
}

.bento-card:hover::before {
  opacity: 1;
}

.bento-card:focus-visible {
  outline: none;
  box-shadow:
    0 0 0 3px rgba(85, 102, 232, 0.4),
    var(--shadow-md);
}

.bento-card--featured {
  grid-column: span 2;
}

.bento-card__index {
  position: absolute;
  top: 12px;
  right: 16px;
  color: rgba(17, 24, 39, 0.04);
  font-size: 28px;
  font-weight: 900;
  line-height: 1;
  transition: color var(--dur-base) var(--ease-out);
  pointer-events: none;
}

.bento-card:hover .bento-card__index {
  color: rgba(17, 24, 39, 0.08);
}

.bento-icon-wrapper {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 44px;
  width: 44px;
  height: 44px;
  border-radius: var(--radius-pill);
  transition: transform var(--dur-base) var(--ease-bubble);
}

.bento-card:hover .bento-icon-wrapper {
  transform: scale(1.08) rotate(-2deg);
}

.bento-icon {
  font-size: 20px;
}

.bento-info {
  position: relative;
  z-index: 1;
  flex: 1;
  min-width: 0;
  padding-right: 16px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.bento-title {
  display: block;
  color: var(--text-strong);
  font-size: 16px;
  font-weight: 700;
  letter-spacing: -0.2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.bento-desc {
  font-size: 12px;
  color: var(--text-subtle);
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.bento-action-icon {
  margin-left: auto;
  color: var(--text-muted);
  font-size: 16px;
  opacity: 0;
  transform: translateX(-8px);
  transition: all var(--dur-base) var(--ease-bubble);
}

.bento-card:hover .bento-action-icon {
  opacity: 1;
  transform: translateX(0);
  color: var(--brand);
}

.is-mint .bento-icon-wrapper {
  background: var(--mint-100);
  color: var(--mint-700);
}
.is-blue .bento-icon-wrapper {
  background: var(--blue-100);
  color: var(--blue-700);
}
.is-lilac .bento-icon-wrapper {
  background: var(--lilac-100);
  color: var(--lilac-700);
}
.is-amber .bento-icon-wrapper {
  background: var(--amber-100);
  color: var(--amber-700);
}
.is-rose .bento-icon-wrapper {
  background: var(--rose-100);
  color: var(--rose-700);
}
.is-foam .bento-icon-wrapper {
  background: var(--foam-100);
  color: var(--foam-700);
}

/* Vertical cards layout for subGroups */
.vertical-cards-container {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 16px;
  padding: 16px 0;
}

.vertical-cards-container--single {
  grid-template-columns: minmax(0, 1fr);
}

.vertical-card {
  background: var(--el-bg-color-overlay, #ffffff);
  border-radius: var(--radius-lg);
  border: 1px solid var(--el-border-color, #ebeef5);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.06);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  transition: all var(--dur-base) var(--ease-bubble);
}

.vertical-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.1);
  border-color: var(--el-border-color-darker, var(--border-brand));
}

.vertical-card-header {
  padding: 14px 16px;
  border-bottom: 1px solid var(--el-border-color-lighter, #f2f6fc);
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: var(--el-fill-color-light, #f5f7fa);
}

.vertical-card-title {
  margin: 0;
  font-size: 15px;
  font-weight: 700;
  color: var(--text-strong);
}

.vertical-card-count {
  font-size: 12px;
  color: var(--text-muted);
  background: var(--surface-hover);
  padding: 2px 8px;
  border-radius: var(--radius-pill);
}

.vertical-card-body {
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1;
}

.vertical-card-body--grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 8px;
}

.subgroup-page {
  padding: 8px 0;
}

.subgroup-tabs :deep(.el-tabs__header) {
  margin: 0 0 16px;
}

.subgroup-tabs :deep(.el-tabs__item) {
  font-size: 14px;
  font-weight: 500;
  padding: 0 20px;
  height: 36px;
  line-height: 36px;
}

.subgroup-tabs .vertical-card-body--grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 8px;
  padding: 0;
}

.small-action-btn {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 10px;
  border-radius: var(--radius-md);
  text-decoration: none;
  color: var(--text-regular);
  background: transparent;
  transition: all var(--dur-base) var(--ease-out);
}

.small-action-btn:hover {
  background: var(--surface-hover);
}

.small-action-icon-wrapper {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: var(--radius-sm);
  transition: all var(--dur-base) var(--ease-out);
  background: var(--surface-brand-soft);
  color: var(--text-muted);
}

.small-action-btn.is-mint .small-action-icon-wrapper {
  background: var(--mint-100);
  color: var(--mint-700);
}
.small-action-btn.is-blue .small-action-icon-wrapper {
  background: var(--blue-100);
  color: var(--blue-700);
}
.small-action-btn.is-lilac .small-action-icon-wrapper {
  background: var(--lilac-100);
  color: var(--lilac-700);
}
.small-action-btn.is-amber .small-action-icon-wrapper {
  background: var(--amber-100);
  color: var(--amber-700);
}
.small-action-btn.is-rose .small-action-icon-wrapper {
  background: var(--rose-100);
  color: var(--rose-700);
}
.small-action-btn.is-foam .small-action-icon-wrapper {
  background: var(--foam-100);
  color: var(--foam-700);
}

.small-action-btn:hover .small-action-icon-wrapper {
  transform: scale(1.05);
}

.small-action-icon {
  font-size: 14px;
}

.small-action-title {
  font-size: 13px;
  font-weight: 500;
  transition: color var(--dur-base) var(--ease-out);
}

.small-action-btn:hover .small-action-title {
  color: var(--text-strong);
}

@media (max-width: 768px) {
  .bento-section {
    margin-bottom: 24px;
  }
  .bento-grid {
    display: flex;
    flex-direction: column;
    gap: 0;
    background: var(--surface-card);
    border-radius: var(--radius-lg);
    border: 1px solid var(--border-subtle);
    box-shadow: var(--shadow-sm);
    overflow: hidden;
  }
  .bento-card {
    border: none;
    border-bottom: 1px solid var(--border-subtle);
    border-radius: 0;
    padding: 14px 16px;
    box-shadow: none;
    gap: 12px;
    align-items: center;
  }
  .bento-card:last-child {
    border-bottom: none;
  }
  .bento-card::before {
    display: none;
  }
  .bento-card:hover {
    transform: none;
    box-shadow: none;
    background: var(--surface-brand-soft);
  }
  .bento-card--featured {
    grid-column: span 1;
  }
  .bento-card__index {
    display: none;
  }
  .bento-icon-wrapper {
    width: 36px;
    height: 36px;
    flex: 0 0 36px;
  }
  .bento-icon {
    font-size: 18px;
  }
  .bento-info {
    padding-right: 0;
    justify-content: center;
  }
  .bento-title {
    font-size: 15px;
    font-weight: 600;
  }
  .bento-desc {
    display: none;
  }
  .bento-action-icon {
    opacity: 1;
    transform: none;
    font-size: 16px;
    color: var(--text-muted);
  }

  /* Responsive for vertical cards */
  .vertical-cards-container {
    grid-template-columns: repeat(2, 1fr);
  }

  .vertical-card-body--grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 480px) {
  .vertical-cards-container {
    grid-template-columns: 1fr;
  }
}
</style>
