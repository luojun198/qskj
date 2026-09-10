<template>
  <div class="module-sections" :class="{ 'module-sections--grouped': !!heading }">
    <h3 v-if="heading" class="module-sections__heading">{{ heading }}</h3>

    <!-- 每个分组一张白卡：标题条 + 图标宫格 -->
    <div class="module-sections__grid" :class="`cols-${columnCount}`">
      <section
        v-for="(section, index) in app.sections"
        :key="section.key"
        class="wb-card module-section"
      >
        <div class="wb-card__head module-section__head">
          <h3 class="wb-card__title">{{ section.label }}</h3>
          <span class="wb-card__note">{{ section.items.length }} 项</span>
        </div>
        <div class="app-grid app-grid--roomy module-section__grid">
          <router-link
            v-for="(item, itemIndex) in section.items"
            :key="item.path"
            :to="item.path"
            class="app-tile"
            :class="variantClass(index, itemIndex)"
            :title="getDescription(item.title)"
          >
            <span class="app-tile__icon">
              <component :is="iconResolver(item)" :size="20" :stroke-width="1.8" />
            </span>
            <span class="app-tile__label">{{ item.title }}</span>
            <span v-if="getSub(item.title)" class="app-tile__sub">{{ getSub(item.title) }}</span>
          </router-link>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, type Component } from 'vue'
import type { NavApp, NavItem } from '@/config/navigation'

const props = defineProps<{
  app: NavApp
  iconResolver: (item: NavItem | string) => Component
  /** 可选的总标题（流程布局下去重后为「其他功能」） */
  heading?: string
}>()

const variants = ['mint', 'blue', 'lilac', 'amber', 'rose', 'foam']

/** 分组少时并排铺开，分组多时两列，避免单张卡片过宽 */
const columnCount = computed(() => {
  const n = props.app.sections.length
  if (n <= 1) return 1
  if (n === 2) return 2
  return n % 3 === 0 ? 3 : 2
})

const descriptionMap: Record<string, string> = {
  科目余额表: '按科目汇总期初、本期发生和期末余额',
  明细账: '穿透查看科目的逐笔凭证分录',
  总分类账: '复核总账科目的借贷发生和方向',
  日记账: '查看现金、银行账户日常流水',
  现金流量试算平衡表: '检查现金流量项目与凭证数据是否平衡',
  序时账: '按时间顺序浏览全部凭证流水',
  标准报表: '查看常用财务报表和打印输出',
  辅助项目余额表: '按辅助项目汇总余额',
  辅助项目明细账: '追查辅助项目的逐笔发生记录',
  委外计划: '安排委外加工任务与用料',
  委外发货: '把原料发往委外加工方',
  委外入库: '接收委外加工完成的成品',
  委外执行及结存表: '跟踪委外在途与结存数量',
}

/** 同一分组内按项轮换配色，分组之间错开起点，避免相邻卡片同色 */
function variantClass(sectionIndex: number, itemIndex: number) {
  return `is-${variants[(sectionIndex + itemIndex) % variants.length]}`
}

function getDescription(title: string) {
  return descriptionMap[title] || title
}

/** 磁贴副标：只有维护过说明的项才显示，避免和标题重复占位 */
function getSub(title: string) {
  return descriptionMap[title] || ''
}
</script>

<style scoped>
.module-sections {
  min-width: 0;
}

.module-sections__heading {
  margin: 2px 0 8px 2px;
  font-size: var(--cw-text-base);
  font-weight: 600;
  color: var(--wb-text-2);
}

.module-sections__grid {
  display: grid;
  gap: var(--wb-gap);
  grid-template-columns: minmax(0, 1fr);
}

.module-sections__grid.cols-2 {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.module-sections__grid.cols-3 {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.module-section {
  display: flex;
  flex-direction: column;
}

.module-section__head {
  margin-bottom: 8px;
}

/* 覆盖全局 app-grid 密度：模块首页磁贴带副标，需要更宽的格子 */
.module-section__grid {
  grid-template-columns: repeat(auto-fill, minmax(104px, 1fr));
}

@media (max-width: 1200px) {
  .module-sections__grid.cols-3 {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 760px) {
  .module-sections__grid.cols-2,
  .module-sections__grid.cols-3 {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
