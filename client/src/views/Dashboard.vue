<template>
  <div class="dashboard mint-dashboard">
    <!-- 登录安全提示卡片 -->
    <transition name="security-notice">
      <div v-if="loginSecurityNotice.visible" class="security-notice">
        <div class="security-notice__icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
            <path d="M9 12l2 2 4-4"/>
          </svg>
        </div>
        <div class="security-notice__content">
          <div class="security-notice__title">欢迎回来，请确认上次登录信息</div>
          <div class="security-notice__info">
            <span>上次登录：{{ loginSecurityNotice.time }}</span>
            <span>IP：{{ loginSecurityNotice.ip }}</span>
          </div>
        </div>
        <button class="security-notice__close" @click="hideLastLoginNotice">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M18 6L6 18M6 6l12 12"/>
          </svg>
        </button>
      </div>
    </transition>

    <!-- Hero 区域 - 薄荷泡泡渐变横幅 -->
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
              <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 3c1.93 0 3.5 1.57 3.5 3.5S13.93 13 12 13s-3.5-1.57-3.5-3.5S10.07 6 12 6zm7 13H5v-.23c0-.62.28-1.2.77-1.58C7.53 15.9 9.68 15 12 15s4.47.9 6.23 2.19c.49.38.77.96.77 1.58V19z"/>
              </svg>
            </span>
            财务驾驶舱 · {{ brandingStore.title }}
          </div>
          <h1 class="hero-title">{{ greeting }}</h1>
          <div class="hero-meta-row">
            <p class="hero-subtitle">{{ currentDateTimeText }}</p>
            <div class="hero-context">
              <div class="context-item">
                <span class="context-label">当前账套</span>
                <span class="context-value">{{ accountSetName }}</span>
              </div>
              <div class="context-item">
                <span class="context-label">当前用户</span>
                <span class="context-value">{{ userName || '未识别' }}</span>
              </div>
              <div class="context-item">
                <span class="context-label">会计区间</span>
                <span class="context-value">{{ currentYear }} 年第 {{ currentPeriod }} 期</span>
              </div>
            </div>
          </div>
        </div>
        <div v-if="visibleHeroShortcuts.length" class="hero-shortcuts">
          <button v-for="item in visibleHeroShortcuts" :key="item.label" class="shortcut-card" @click="router.push(item.path)">
            <div class="shortcut-icon" :style="{ background: item.bg, color: item.color }">
              <el-icon><component :is="item.icon" /></el-icon>
            </div>
            <div class="shortcut-content">
              <span class="shortcut-label">{{ item.label }}</span>
              <span class="shortcut-desc">{{ item.desc }}</span>
            </div>
            <svg class="shortcut-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M9 18l6-6-6-6"/>
            </svg>
          </button>
        </div>
      </div>
    </section>

    <!-- 统计指标卡片 -->
    <section v-if="visibleStatCards.length" class="metrics-section">
      <div class="metrics-grid">
        <button v-for="card in visibleStatCards" :key="card.label" class="metric-card" @click="goMetric(card.path)">
          <div class="metric-icon" :style="{ background: card.bg, color: card.color }">
            <el-icon><component :is="card.icon" /></el-icon>
          </div>
          <div class="metric-content">
            <span class="metric-label">{{ card.label }}</span>
            <span class="metric-value">{{ card.value }}</span>
            <span class="metric-hint">{{ card.hint }}</span>
          </div>
          <div class="metric-badge" v-if="card.badge">{{ card.badge }}</div>
        </button>
      </div>
    </section>

    <!-- 主内容：趋势图 + 右侧栏（风险 / 活跃度） -->
    <section class="content-section">
      <!-- 趋势分析 -->
      <div class="content-panel panel-trend">
        <div class="panel-header">
          <div class="panel-title">
            <div class="panel-icon trend-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M3 3v18h18"/><path d="M18.7 8l-5.1 5.2-2.4-2.4-4.3 4.3"/>
              </svg>
            </div>
            <div>
              <span class="panel-eyebrow">趋势分析</span>
              <h3>近 6 期{{ trendMode === 'budget' ? '预算' : '财务' }}收支结构</h3>
              <p v-if="dashboardRuleLabel" class="panel-rule-hint">
                取数口径：{{ dashboardRuleLabel }}
                <router-link
                  v-if="canConfigureDashboardRules"
                  class="panel-rule-link"
                  to="/system/dashboard-rules"
                >配置取数规则</router-link>
              </p>
            </div>
          </div>
          <div class="chart-legend">
            <el-radio-group v-if="hasBudgetAccounting" v-model="trendMode" size="small">
              <el-radio-button value="financial">财务会计</el-radio-button>
              <el-radio-button value="budget">预算会计</el-radio-button>
            </el-radio-group>
            <template v-if="trendMode === 'financial'">
              <span class="legend-item"><i class="legend-dot income"></i>财务收入</span>
              <span class="legend-item"><i class="legend-dot expense"></i>财务支出</span>
              <span class="legend-item"><i class="legend-dot fee"></i>费用</span>
              <span class="legend-item"><i class="legend-dot cost"></i>成本</span>
              <span class="legend-item"><i class="legend-dot surplus"></i>本期盈余</span>
            </template>
            <template v-else>
              <span class="legend-item"><i class="legend-dot income"></i>预算收入</span>
              <span class="legend-item"><i class="legend-dot expense"></i>预算支出</span>
              <span class="legend-item"><i class="legend-dot surplus"></i>预算结余</span>
            </template>
          </div>
        </div>
        <div ref="trendChartRef" class="chart-container"></div>
      </div>

      <!-- 右侧栏 -->
      <div class="side-column">
        <!-- 待办风险 -->
        <div class="content-panel panel-todo">
          <div class="panel-header">
            <div class="panel-title">
              <div class="panel-icon todo-icon" :class="{ 'has-warning': riskSummaryCount > 0 }">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                </svg>
              </div>
              <div><span class="panel-eyebrow">待办风险</span><h3>处理提醒</h3></div>
            </div>
            <span class="risk-badge" :class="riskSummaryType">{{ riskSummaryText }}</span>
          </div>
          <div class="risk-list">
            <component
              v-for="item in insights.riskItems"
              :key="item.key"
              :is="isAccessiblePath(item.actionPath) ? 'button' : 'div'"
              class="risk-item"
              :class="[`risk-${item.level}`, { 'risk-clickable': isAccessiblePath(item.actionPath) }]"
              @click="goRisk(item)"
            >
              <span class="risk-status"></span>
              <span class="risk-name">{{ item.title }}</span>
              <span class="risk-count">{{ item.count }}</span>
            </component>
            <div v-if="!insights.riskItems.length" class="empty-state">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
              </svg>
              <span>暂无待办提醒</span>
            </div>
          </div>
        </div>

        <!-- 科目活跃度 -->
        <div class="content-panel panel-activity">
          <div class="panel-header">
            <div class="panel-title">
              <div class="panel-icon activity-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M18 20V10"/><path d="M12 20V4"/><path d="M6 20v-6"/>
                </svg>
              </div>
              <div><span class="panel-eyebrow">科目活跃度</span><h3>本期发生额 Top 5</h3></div>
            </div>
          </div>
          <div class="activity-list">
            <div v-for="item in activityTopWithRatio" :key="item.code" class="activity-item">
              <div class="activity-header">
                <span class="activity-name">{{ item.code }} {{ item.name }}</span>
                <span class="activity-amount">{{ formatMoney(item.amount) }}</span>
              </div>
              <div class="activity-bar">
                <span class="activity-bar-fill" :style="{ width: `${item.ratio}%` }"></span>
              </div>
            </div>
            <div v-if="!activityTopWithRatio.length" class="empty-state">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <path d="M18 20V10"/><path d="M12 20V4"/><path d="M6 20v-6"/>
              </svg>
              <span>暂无本期发生额数据</span>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- 底部两栏：近期凭证 + 现金银行结构 -->
    <section class="bottom-section">
      <!-- 近期凭证 -->
      <div class="content-panel panel-recent">
        <div class="panel-header">
          <div class="panel-title">
            <div class="panel-icon recent-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>
              </svg>
            </div>
            <div><span class="panel-eyebrow">业务流水</span><h3>近期凭证</h3></div>
          </div>
          <button class="view-all-btn" @click="router.push('/voucher/query')">
            查看全部<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>
          </button>
        </div>
        <div class="voucher-list">
          <div v-if="recentVouchers.length" class="voucher-table-head">
            <span>日期</span>
            <span>凭证号</span>
            <span>摘要</span>
            <span>状态</span>
            <span>金额</span>
          </div>
          <button
            v-for="row in recentVouchers"
            :key="row.id"
            class="voucher-item"
            @click="router.push('/voucher/query')"
          >
            <span class="voucher-date">{{ formatShortDate(row.voucherDate) }}</span>
            <span class="voucher-no">{{ row.voucherNo }}</span>
            <span class="voucher-abstract" :title="row.abstract || ''">{{ row.abstract || '—' }}</span>
            <span class="voucher-status" :class="row.status">{{ getStatusText(row.status) }}</span>
            <span class="voucher-amount">{{ formatMoney(row.totalAmount) }}</span>
          </button>
          <div v-if="!recentVouchers.length" class="empty-state">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
            </svg>
            <span>暂无近期凭证</span>
          </div>
        </div>
      </div>

      <!-- 现金银行结构 -->
      <div class="content-panel panel-cash">
        <div class="panel-header">
          <div class="panel-title">
            <div class="panel-icon cash-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="1" y="4" width="22" height="16" rx="2" ry="2"/>
                <circle cx="12" cy="12" r="3"/>
              </svg>
            </div>
            <div><span class="panel-eyebrow">资金洞察</span><h3>现金银行结构</h3></div>
          </div>
        </div>
        <div class="cash-structure">
          <div v-for="item in cashStructureWithRatio" :key="item.name" class="cash-group">
            <div class="cash-header">
              <span class="cash-name">{{ item.name }}</span>
              <span class="cash-total">{{ formatMoney(item.balance) }}</span>
            </div>
            <div class="cash-body">
              <div class="cash-pie-wrap">
                <div :ref="el => setCashPieRef(el, item.name)" class="cash-pie"></div>
              </div>
              <div class="cash-children">
                <div v-for="child in item.children" :key="child.code" class="cash-row">
                  <span class="cash-row-name">
                    <i class="cash-row-dot" :style="{ background: child.color }"></i>
                    <span :title="`${child.code} ${child.name}`">{{ child.code }} {{ child.name }}</span>
                  </span>
                  <span class="cash-row-value" :class="{ negative: child.balance < 0 }">
                    <strong>{{ formatMoney(child.balance) }}</strong>
                    <em>{{ formatSignedPercent(child.ratio) }}</em>
                  </span>
                </div>
                <div v-if="!item.children.length" class="cash-empty">暂无{{ item.name }}子科目</div>
              </div>
            </div>
          </div>
          <div v-if="!cashStructureWithRatio.length" class="empty-state">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <rect x="1" y="4" width="22" height="16" rx="2" ry="2"/>
              <circle cx="12" cy="12" r="3"/>
            </svg>
            <span>暂无现金/银行数据</span>
          </div>
        </div>
      </div>
    </section>

    <!-- 底部装饰 -->
    <div class="footer-decoration">
      <div class="footer-pattern"></div>
      <div class="footer-text">
        <span class="footer-brand">{{ brandingStore.title }} · {{ brandingStore.subtitle }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onActivated, onDeactivated, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { CircleCheck, DataAnalysis, Document, EditPen, List, Money, Tickets, Wallet } from '@element-plus/icons-vue'
import type { ECharts } from 'echarts/core'
import { useUserStore } from '@/stores/user'
import request from '@/api/request'
import { formatAmount } from '@/utils/format'
import { canAccessRoute } from '@/config/navigation'
import { useBrandingStore } from '@/stores/branding'
import { shouldUseLightMode } from '@/utils/performanceMode'

interface TrendItem {
  month: string
  income: number
  pureExpense: number
  fee: number
  cost: number
  expense?: number
  budgetIncome?: number
  budgetExpense?: number
  budgetBalance?: number
}
interface RiskItem { key: string; title: string; count: number; level: 'normal' | 'warning' | 'danger'; actionPath: string }
interface CashStructureItem { name: string; balance: number; children: Array<{ code: string; name: string; balance: number }> }
interface CashStructureDisplayItem extends CashStructureItem { totalAbs: number; palette: string[]; children: Array<{ code: string; name: string; balance: number; ratio: number; absRatio: number; color: string }> }
interface ActivityTopItem { code: string; name: string; amount: number }

const router = useRouter()
const userStore = useUserStore()
const brandingStore = useBrandingStore()
const userName = computed(() => userStore.userInfo?.nickname || userStore.userInfo?.username || '')
const accountSetName = computed(() => userStore.accountSetName || '未选账套')

const stats = ref({
  currentYear: 0,
  currentPeriod: 0,
  voucherCount: 0,
  unpostedVoucherCount: 0,
  pendingVoucherCount: 0,
  auditPending: 0,
  cashBalance: 0,
  monthlyIncome: 0,
  monthlyExpense: 0,
  monthlySurplus: 0,
  budgetIncome: 0,
  budgetExpense: 0,
  budgetBalance: 0,
  accountingStandard: '',
  accountingStandardName: '',
  dashboardRuleMode: '',
  financialResultReportPath: '',
  financialResultReportName: '',
})
const dashboardRuleLabel = computed(() => {
  const name = stats.value.accountingStandardName
  if (!name) return ''
  if (stats.value.dashboardRuleMode === 'custom') return `${name}（可在系统参数中调整）`
  return name
})
const recentVouchers = ref<any[]>([])
const trend = ref<TrendItem[]>([])
const trendMode = ref<'financial' | 'budget'>('financial')
const hasBudgetAccounting = computed(
  () =>
    stats.value.accountingStandard === 'government' ||
    trend.value.some(item => (item.budgetIncome || 0) !== 0 || (item.budgetExpense || 0) !== 0)
)
const insights = ref({ riskItems: [] as RiskItem[], cashStructure: [] as CashStructureItem[], activityTop: [] as ActivityTopItem[] })
const loginSecurityNotice = ref({ visible: false, time: '', ip: '' })
let loginSecurityNoticeTimer: number | null = null
let clockTimer: number | null = null

const trendChartRef = ref<HTMLElement>()
const cashPieRefs = new Map<string, HTMLElement>()
let trendChart: ECharts | null = null
const cashPieCharts = new Map<string, ECharts>()
let trendEchartsApi: typeof import('@/utils/echartsTrendLoader')['default'] | null = null
let trendEchartsLoading: Promise<typeof import('@/utils/echartsTrendLoader')['default']> | null = null
let pieEchartsApi: typeof import('@/utils/echartsPieLoader')['default'] | null = null
let pieEchartsLoading: Promise<typeof import('@/utils/echartsPieLoader')['default']> | null = null
let chartObserver: IntersectionObserver | null = null
let chartsVisible = false
const lightMode = shouldUseLightMode()
let dashboardRequestSeq = 0
let lastLoadedAccountSetId = ''
let lastLoadedAt = 0

const currentTime = ref(new Date())
const currentYear = computed(() => stats.value.currentYear || currentTime.value.getFullYear())
const currentPeriod = computed(() => stats.value.currentPeriod || currentTime.value.getMonth() + 1)

const greeting = computed(() => {
  const h = currentTime.value.getHours()
  if (h < 6) return '夜深了，注意休息'
  if (h < 9) return '早上好，新的一天开始了'
  if (h < 12) return '上午好，工作顺利'
  if (h < 14) return '中午好，记得休息'
  if (h < 18) return '下午好，继续加油'
  if (h < 22) return '晚上好，辛苦了'
  return '夜深了，注意休息'
})

const currentDateTimeText = computed(() => {
  const date = currentTime.value
  const pad = (v: number) => String(v).padStart(2, '0')
  const weekdays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六']
  return `${date.getFullYear()}年${pad(date.getMonth() + 1)}月${pad(date.getDate())}日 ${weekdays[date.getDay()]} ${pad(date.getHours())}:${pad(date.getMinutes())}`
})

const canConfigureDashboardRules = computed(() =>
  canAccessRoute('/system/param', userStore.permissions)
)

function isAccessiblePath(path?: string) {
  if (!path) return false
  return canAccessRoute(path.split('?')[0], userStore.permissions)
}

/* 快捷入口配色 — 财务洗头膏设计令牌（薄荷 / 泡沫蓝 / 虹彩淡紫 / 暖橙） */
const heroShortcutsBase = [
  { label: '凭证录入', desc: '新增凭证', path: '/voucher/entry?action=add', icon: EditPen, color: '#0A8576', bg: 'rgba(159, 237, 223, 0.9)' },
  { label: '凭证管理', desc: '审核与记账', path: '/voucher/audit', icon: CircleCheck, color: '#1A54A8', bg: 'rgba(169, 208, 255, 0.9)' },
  { label: '余额表', desc: '打开科目余额表', path: '/ledger/general', icon: DataAnalysis, color: '#6F5FD8', bg: 'rgba(212, 204, 255, 0.9)' },
  { label: '日记账', desc: '现金银行流水', path: '/ledger/cash-journal', icon: List, color: '#9A6311', bg: 'rgba(252, 239, 215, 0.95)' },
]

const visibleHeroShortcuts = computed(() =>
  heroShortcutsBase.filter(item => isAccessiblePath(item.path))
)

/* 指标卡配色 — 语义化令牌 */
const statCards = computed(() => [
  { label: '本期凭证', value: stats.value.voucherCount, hint: `${currentYear.value} 年第 ${currentPeriod.value} 期`, color: '#0AA694', bg: 'rgba(18, 199, 174, 0.14)', icon: Tickets, path: '/voucher/query' },
  { label: '未记账凭证', value: stats.value.unpostedVoucherCount, hint: '草稿 + 已审核', color: '#F2545B', bg: 'rgba(242, 84, 91, 0.12)', icon: Document, path: '/voucher/audit', badge: stats.value.unpostedVoucherCount > 0 ? `${stats.value.unpostedVoucherCount}` : undefined },
  { label: '货币资金', value: formatMoney(stats.value.cashBalance), hint: '现金与银行余额', color: '#2E84F5', bg: 'rgba(46, 132, 245, 0.12)', icon: Wallet, path: '/ledger/cash-journal' },
  { label: '财务收入', value: formatMoney(stats.value.monthlyIncome), hint: '本期已记账发生额', color: '#0FB57E', bg: 'rgba(15, 181, 126, 0.12)', icon: Money, path: '/ledger/detail' },
  { label: '财务支出', value: formatMoney(stats.value.monthlyExpense), hint: '本期已记账发生额', color: '#F4A52E', bg: 'rgba(244, 165, 46, 0.14)', icon: DataAnalysis, path: '/ledger/detail' },
  { label: '本期盈余', value: formatMoney(stats.value.monthlySurplus), hint: stats.value.monthlySurplus >= 0 ? '财务收入减财务支出' : '财务支出大于收入', color: stats.value.monthlySurplus >= 0 ? '#0AA694' : '#F2545B', bg: stats.value.monthlySurplus >= 0 ? 'rgba(18, 199, 174, 0.14)' : 'rgba(242, 84, 91, 0.12)', icon: CircleCheck, path: stats.value.financialResultReportPath || '/report/dynamic' },
  ...(hasBudgetAccounting.value ? [
    { label: '预算收入', value: formatMoney(stats.value.budgetIncome), hint: '本期已记账预算口径', color: '#0FB57E', bg: 'rgba(15, 181, 126, 0.12)', icon: Money, path: '/ledger/detail' },
    { label: '预算支出', value: formatMoney(stats.value.budgetExpense), hint: '本期已记账预算口径', color: '#F4A52E', bg: 'rgba(244, 165, 46, 0.14)', icon: DataAnalysis, path: '/ledger/detail' },
    { label: '预算结余', value: formatMoney(stats.value.budgetBalance), hint: '预算收入减预算支出', color: stats.value.budgetBalance >= 0 ? '#0AA694' : '#F2545B', bg: stats.value.budgetBalance >= 0 ? 'rgba(18, 199, 174, 0.14)' : 'rgba(242, 84, 91, 0.12)', icon: CircleCheck, path: '/ledger/detail' },
  ] : []),
])

const visibleStatCards = computed(() =>
  statCards.value.filter(card => isAccessiblePath(card.path))
)

const cashStructure = computed(() => insights.value.cashStructure)
const cashStructureWithRatio = computed<CashStructureDisplayItem[]>(() => {
  /* 饼图色板 — 薄荷 / 泡沫蓝 / 虹彩淡紫为主，语义色补充 */
  const palettes = [['#12C7AE', '#2E84F5', '#9C8FF5', '#F4A52E', '#F2545B', '#66E0CB'], ['#2E84F5', '#12C7AE', '#B8AEFF', '#F4A52E', '#F2545B', '#79B4FF']]
  return cashStructure.value.map((group, gi) => {
    const palette = palettes[gi % palettes.length]
    const totalAbs = group.children.reduce((s, c) => s + Math.abs(c.balance || 0), 0)
    return { ...group, totalAbs, palette, children: group.children.map((c, ci) => ({ ...c, ratio: totalAbs > 0 ? (c.balance || 0) / totalAbs : 0, absRatio: totalAbs > 0 ? Math.abs(c.balance || 0) / totalAbs : 0, color: palette[ci % palette.length] })) }
  })
})

const activityTopWithRatio = computed(() => {
  const max = Math.max(...insights.value.activityTop.map(i => Math.abs(i.amount)), 1)
  return insights.value.activityTop.map(i => ({ ...i, ratio: Math.round((Math.abs(i.amount) / max) * 100) }))
})

const riskSummaryCount = computed(() => insights.value.riskItems.filter(i => i.count > 0).length)
const riskSummaryType = computed(() => riskSummaryCount.value > 0 ? 'warning' : 'success')
const riskSummaryText = computed(() => riskSummaryCount.value > 0 ? `${riskSummaryCount.value} 项需关注` : '运行平稳')

function goMetric(path?: string) { if (path) router.push(path) }
function goRisk(item: RiskItem) { if (isAccessiblePath(item.actionPath)) router.push(item.actionPath) }
function formatMoney(val: number) { return '¥' + formatAmount(val || 0) }
function formatSignedPercent(v: number) { if (!v) return '0%'; const a = `${Math.round(Math.abs(v) * 1000) / 10}%`; return v < 0 ? `-${a}` : a }
function setCashPieRef(el: unknown, name: string) { if (el instanceof HTMLElement) cashPieRefs.set(name, el); else cashPieRefs.delete(name) }
function formatShortDate(d?: string) { return d ? d.slice(5) : '--' }
function getStatusText(s: string) { return ({ draft: '草稿', audited: '已审核', posted: '已记账' } as any)[s] || s }

function showLastLoginNotice() {
  const raw = sessionStorage.getItem('lastLoginNotice')
  if (!raw) return
  sessionStorage.removeItem('lastLoginNotice')
  try {
    const data = JSON.parse(raw)
    loginSecurityNotice.value = { visible: true, time: data.lastLoginTime || '无记录', ip: data.lastLoginIp || '无记录' }
    if (loginSecurityNoticeTimer) window.clearTimeout(loginSecurityNoticeTimer)
    loginSecurityNoticeTimer = window.setTimeout(() => { loginSecurityNotice.value.visible = false }, 5000)
  } catch { sessionStorage.removeItem('lastLoginNotice') }
}

function hideLastLoginNotice() {
  loginSecurityNotice.value.visible = false
  if (loginSecurityNoticeTimer) { window.clearTimeout(loginSecurityNoticeTimer); loginSecurityNoticeTimer = null }
}

function getTrendSurplus(item: TrendItem) {
  if (trendMode.value === 'budget') {
    return item.budgetBalance ?? (item.budgetIncome || 0) - (item.budgetExpense || 0)
  }
  return item.income - item.pureExpense - item.fee - item.cost
}

async function ensureTrendEcharts() {
  if (trendEchartsApi) return trendEchartsApi
  if (!trendEchartsLoading) {
    trendEchartsLoading = import('@/utils/echartsTrendLoader').then(module => module.default)
  }
  trendEchartsApi = await trendEchartsLoading
  return trendEchartsApi
}

async function ensurePieEcharts() {
  if (pieEchartsApi) return pieEchartsApi
  if (!pieEchartsLoading) {
    pieEchartsLoading = import('@/utils/echartsPieLoader').then(module => module.default)
  }
  pieEchartsApi = await pieEchartsLoading
  return pieEchartsApi
}

function disposeCharts() {
  trendChart?.dispose()
  trendChart = null
  cashPieCharts.forEach(chart => chart.dispose())
  cashPieCharts.clear()
}

async function renderTrendChart() {
  if (!chartsVisible) return
  if (!trendChartRef.value) return
  const echarts = await ensureTrendEcharts()
  if (!chartsVisible || !trendChartRef.value) return
  if (!trendChart) trendChart = echarts.init(trendChartRef.value)
  const isBudget = trendMode.value === 'budget'
  trendChart.setOption({
    animation: !lightMode,
    /* 收入薄荷 / 支出暖橙 / 费用珊瑚 / 成本淡紫 / 结余泡沫蓝 */
    color: ['#12C7AE', '#F4A52E', '#F2545B', '#9C8FF5', '#2E84F5'],
    tooltip: {
      trigger: 'axis',
      backgroundColor: 'rgba(255,255,255,0.96)',
      borderColor: 'rgba(12,42,46,0.08)',
      borderWidth: 1,
      borderRadius: 12,
      padding: [12, 16],
      textStyle: { color: '#0C2A2E', fontSize: 13 },
      formatter: (params: any) => {
        const items = Array.isArray(params) ? params : [params]
        const lines = items.map((item: any) => `${item.marker}${item.seriesName}：${formatMoney(item.value)}`)
        const monthIndex = items[0]?.dataIndex
        if (monthIndex != null && trend.value[monthIndex]) {
          const row = trend.value[monthIndex]
          const surplus = getTrendSurplus(row)
          const balanceName = isBudget ? '预算结余' : '本期盈余'
          if (!items.some((item: any) => item.seriesName === balanceName)) {
            lines.push(`${balanceName}：${formatMoney(surplus)}`)
          }
        }
        return lines.join('<br/>')
      },
    },
    grid: { left: 48, right: 24, top: 56, bottom: 32 },
    xAxis: {
      type: 'category',
      data: trend.value.map(i => i.month.slice(5) + '期'),
      axisLine: { lineStyle: { color: 'rgba(12,42,46,0.10)' } },
      axisLabel: { color: '#62858A', fontSize: 12 },
      axisTick: { show: false },
    },
    yAxis: {
      type: 'value',
      axisLabel: {
        color: '#62858A',
        fontSize: 12,
        formatter: (v: number) => `${Math.round(v / 10000)}万`,
      },
      splitLine: { lineStyle: { color: 'rgba(12,42,46,0.06)', type: 'dashed' } },
      axisTick: { show: false },
      axisLine: { show: false },
    },
    series: isBudget ? [
      {
        name: '预算收入',
        type: 'bar',
        data: trend.value.map(i => i.budgetIncome || 0),
        barWidth: 20,
        itemStyle: { borderRadius: [6, 6, 0, 0] },
      },
      {
        name: '预算支出',
        type: 'bar',
        data: trend.value.map(i => i.budgetExpense || 0),
        barWidth: 20,
        itemStyle: { borderRadius: [6, 6, 0, 0] },
      },
      {
        name: '预算结余',
        type: 'line',
        data: trend.value.map(i => getTrendSurplus(i)),
        smooth: true,
        symbolSize: 8,
        lineStyle: { width: 3, type: 'dashed' },
      },
    ] : [
      {
        name: '财务收入',
        type: 'bar',
        data: trend.value.map(i => i.income),
        barWidth: 14,
        itemStyle: { borderRadius: [6, 6, 0, 0] },
      },
      {
        name: '财务支出',
        type: 'bar',
        data: trend.value.map(i => i.pureExpense),
        barWidth: 14,
        itemStyle: { borderRadius: [6, 6, 0, 0] },
      },
      {
        name: '费用',
        type: 'bar',
        data: trend.value.map(i => i.fee),
        barWidth: 14,
        itemStyle: { borderRadius: [6, 6, 0, 0] },
      },
      {
        name: '成本',
        type: 'bar',
        data: trend.value.map(i => i.cost),
        barWidth: 14,
        itemStyle: { borderRadius: [6, 6, 0, 0] },
      },
      {
        name: '本期盈余',
        type: 'line',
        data: trend.value.map(i => getTrendSurplus(i)),
        smooth: true,
        symbolSize: 8,
        lineStyle: { width: 3, type: 'dashed' },
        areaStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: 'rgba(46,132,245,0.12)' },
            { offset: 1, color: 'rgba(46,132,245,0)' },
          ]),
        },
      },
    ],
  }, true)
}

async function renderCashPieCharts() {
  if (!chartsVisible) return
  const echarts = await ensurePieEcharts()
  if (!chartsVisible) return
  cashStructureWithRatio.value.forEach(group => {
    const el = cashPieRefs.get(group.name)
    if (!el) return
    let chart = cashPieCharts.get(group.name)
    if (!chart) { chart = echarts.init(el); cashPieCharts.set(group.name, chart) }
    const data = group.children.filter(c => Math.abs(c.balance) > 0).map(c => ({ name: `${c.code} ${c.name}`, value: Math.abs(c.balance), rawBalance: c.balance, signedRatio: c.ratio, itemStyle: { color: c.color } }))
    chart.setOption({
      animation: !lightMode,
      color: group.palette,
      tooltip: { trigger: 'item', backgroundColor: 'rgba(255,255,255,0.96)', borderColor: 'rgba(12,42,46,0.08)', borderWidth: 1, borderRadius: 12, padding: [10, 14], textStyle: { color: '#0C2A2E', fontSize: 12 }, formatter: (p: any) => `${p.name}<br/>${formatMoney(p.data?.rawBalance || 0)} · ${formatSignedPercent(p.data?.signedRatio || 0)}` },
      title: { text: group.name, subtext: formatMoney(group.balance), left: 'center', top: 'center', textStyle: { color: '#0C2A2E', fontSize: 13, fontWeight: 600 }, subtextStyle: { color: '#62858A', fontSize: 11, fontWeight: 500 }, itemGap: 4 },
      series: [{ type: 'pie', radius: ['60%', '80%'], center: ['50%', '50%'], minAngle: 6, avoidLabelOverlap: true, label: { show: false }, itemStyle: { borderColor: '#fff', borderWidth: 3, borderRadius: 8 }, emphasis: { scaleSize: 6, itemStyle: { shadowBlur: 20, shadowColor: 'rgba(12,42,46,0.18)' } }, data: data.length ? data : [{ name: '暂无数据', value: 1, itemStyle: { color: '#ECF6F4' } }] }],
    })
  })
}

async function renderAllCharts() {
  await nextTick()
  await Promise.all([renderTrendChart(), renderCashPieCharts()])
}

function resizeCharts() { trendChart?.resize(); cashPieCharts.forEach(c => c.resize()) }

async function loadDashboard() {
  if (!userStore.token || !userStore.accountSetId) return
  const requestSeq = ++dashboardRequestSeq
  const accountSetId = userStore.accountSetId
  const response = await request.get<any>('/dashboard/overview')
  if (requestSeq !== dashboardRequestSeq || userStore.accountSetId !== accountSetId) return
  const data = response.data || {}
  Object.assign(stats.value, data.stats || {})
  recentVouchers.value = data.recentVouchers || []
  trend.value = data.trend || []
  const insight = data.insights || {}
  insights.value = {
    riskItems: insight.riskItems || [],
    cashStructure: insight.cashStructure || [],
    activityTop: insight.activityTop || insight.expenseTop || [],
  }
  lastLoadedAccountSetId = accountSetId
  lastLoadedAt = Date.now()
}

watch(
  () => userStore.accountSetId,
  (accountSetId, prevId) => {
    if (accountSetId && accountSetId !== prevId) {
      void loadDashboard()
    }
  }
)

onMounted(() => {
  clockTimer = window.setInterval(() => { currentTime.value = new Date() }, 30000)
  showLastLoginNotice()
  window.addEventListener('resize', resizeCharts)
  chartObserver = new IntersectionObserver(entries => {
    if (!entries.some(entry => entry.isIntersecting)) return
    chartsVisible = true
    chartObserver?.disconnect()
    void renderAllCharts()
  }, { rootMargin: '160px 0px' })
  if (trendChartRef.value) chartObserver.observe(trendChartRef.value)
})

onActivated(() => {
  if (userStore.token && userStore.accountSetId) {
    const stale = Date.now() - lastLoadedAt > 60000
    if (lastLoadedAccountSetId !== userStore.accountSetId || stale) void loadDashboard()
    if (trendChartRef.value && !chartsVisible) chartObserver?.observe(trendChartRef.value)
  }
})

onDeactivated(() => {
  chartsVisible = false
  disposeCharts()
})

onUnmounted(() => {
  if (clockTimer) { window.clearInterval(clockTimer); clockTimer = null }
  window.removeEventListener('resize', resizeCharts)
  chartObserver?.disconnect()
  chartObserver = null
  disposeCharts()
})

watch([trend, cashStructureWithRatio], () => {
  if (chartsVisible) void renderAllCharts()
})

watch(trendMode, () => {
  if (chartsVisible) void renderTrendChart()
})
</script>

<style scoped>
@import './Dashboard.styles.css';
</style>
