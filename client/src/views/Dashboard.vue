<template>
  <div class="dashboard mint-dashboard workbench">
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

    <!-- 问候条 -->
    <header class="wb-greet">
      <div class="wb-greet__main">
        <span class="wb-greet__avatar" aria-hidden="true">{{ userInitial }}</span>
        <div class="wb-greet__text">
          <h1 class="wb-greet__title">{{ greeting }}<template v-if="userName">，{{ userName }}</template></h1>
          <p class="wb-greet__sub">{{ currentDateTimeText }}</p>
        </div>
      </div>
      <div class="wb-greet__meta">
        <span class="wb-chip" :title="accountSetName">
          <el-icon><component :is="resolveNavIcon('Building2')" /></el-icon>
          <span class="wb-chip__label">账套</span>
          <span class="wb-chip__value">{{ accountSetName }}</span>
        </span>
        <span class="wb-chip">
          <el-icon><component :is="resolveNavIcon('CalendarRange')" /></el-icon>
          <span class="wb-chip__label">会计期间</span>
          <span class="wb-chip__value">{{ currentYear }} 年第 {{ currentPeriod }} 期</span>
        </span>
      </div>
    </header>

    <!-- 常用功能 -->
    <section class="wb-card wb-quick">
      <div class="wb-card__head">
        <h3 class="wb-card__title">常用功能</h3>
        <div class="wb-card__actions">
          <span v-if="workbenchStore.isCustomized" class="wb-card__note">已自定义</span>
          <button type="button" class="wb-link-btn" @click="openFavoriteEditor">
            <el-icon><component :is="resolveNavIcon('SlidersHorizontal')" /></el-icon>
            自定义
          </button>
        </div>
      </div>
      <div v-if="quickItems.length" class="app-grid">
        <button
          v-for="(item, index) in quickItems"
          :key="item.path"
          type="button"
          class="app-tile"
          :class="`is-${quickVariants[index % quickVariants.length]}`"
          :title="item.desc || item.title"
          @click="router.push(item.path)"
        >
          <span class="app-tile__icon"><component :is="resolveNavIcon(item.icon)" :size="20" :stroke-width="1.8" /></span>
          <span class="app-tile__label">{{ item.title }}</span>
        </button>
      </div>
      <div v-else class="wb-empty">还没有常用功能，点击右上角「自定义」添加</div>
    </section>

    <!-- 待办 + 经营数据 -->
    <div class="wb-row">
      <section class="wb-card wb-todo">
        <div class="wb-card__head">
          <h3 class="wb-card__title">
            我的待办
            <span v-if="todoAttentionCount > 0" class="wb-count-badge">{{ todoAttentionCount }}</span>
          </h3>
          <span class="wb-card__note" :class="{ 'is-warning': todoAttentionCount > 0 }">
            {{ todoAttentionCount > 0 ? `${todoAttentionCount} 项需要处理` : '暂无需要处理的事项' }}
          </span>
        </div>
        <ul v-if="visibleTodos.length" class="todo-list">
          <li
            v-for="item in visibleTodos"
            :key="item.key"
            class="todo-row"
            :class="[`is-${item.level}`, { 'is-empty': item.count <= 0 }]"
            @click="router.push(item.actionPath)"
          >
            <span class="todo-row__dot"></span>
            <span class="todo-row__body">
              <span class="todo-row__title">{{ item.title }}</span>
              <span v-if="item.hint" class="todo-row__hint">{{ item.hint }}</span>
            </span>
            <span class="todo-row__count">{{ item.count }}</span>
            <span class="todo-row__go">
              去处理
              <el-icon><component :is="resolveNavIcon('ChevronRight')" /></el-icon>
            </span>
          </li>
        </ul>
        <div v-else class="wb-empty">当前账套没有可显示的待办</div>
      </section>

      <section v-if="visibleBoardTabs.length" class="wb-card wb-card--raised wb-card--accent-blue wb-kpi">
        <div class="wb-card__head">
          <h3 class="wb-card__title">经营数据</h3>
          <div class="wb-tabs" role="tablist">
            <button
              v-for="tab in visibleBoardTabs"
              :key="tab.key"
              type="button"
              class="wb-tab"
              :class="{ 'is-active': boardTab === tab.key }"
              role="tab"
              :aria-selected="boardTab === tab.key"
              @click="boardTab = tab.key"
            >
              {{ tab.label }}
            </button>
          </div>
        </div>
        <div v-if="activeBoardCards.length" class="kpi-grid">
          <button v-for="card in activeBoardCards" :key="card.label" type="button" class="kpi-card" @click="goMetric(card.path)">
            <span class="kpi-card__icon" :style="{ background: card.bg, color: card.color }">
              <el-icon><component :is="card.icon" :stroke-width="1.8" /></el-icon>
            </span>
            <span class="kpi-card__body">
              <span class="kpi-card__label">
                {{ card.label }}
                <span v-if="card.badge" class="kpi-card__badge">{{ card.badge }}</span>
              </span>
              <span class="kpi-card__value">{{ card.value }}</span>
              <span class="kpi-card__hint">{{ card.hint }}</span>
            </span>
          </button>
        </div>
        <div v-else class="wb-empty">暂无可展示的指标</div>
      </section>
    </div>

    <!-- 财务数据组件（保留图表 DOM，用 v-show 以便 ECharts 复用） -->
    <div v-show="financeWidgetsVisible" class="wb-widgets">
      <section class="wb-card wb-trend">
        <div class="wb-card__head">
          <div class="wb-card__heading">
            <h3 class="wb-card__title">近 6 期{{ trendMode === 'budget' ? '预算' : '财务' }}收支结构</h3>
            <p v-if="dashboardRuleLabel" class="wb-card__desc">
              取数口径：{{ dashboardRuleLabel }}
              <router-link v-if="canConfigureDashboardRules" class="wb-inline-link" to="/system/dashboard-rules">配置取数规则</router-link>
            </p>
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
      </section>

      <section class="wb-card wb-activity">
        <div class="wb-card__head">
          <h3 class="wb-card__title">本期发生额 Top 5</h3>
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
          <div v-if="!activityTopWithRatio.length" class="wb-empty">暂无本期发生额数据</div>
        </div>
      </section>

      <section class="wb-card wb-recent">
        <div class="wb-card__head">
          <h3 class="wb-card__title">近期凭证</h3>
          <button type="button" class="wb-link-btn" @click="router.push('/voucher/query')">
            查看全部
            <el-icon><component :is="resolveNavIcon('ChevronRight')" /></el-icon>
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
            type="button"
            class="voucher-item"
            @click="router.push('/voucher/query')"
          >
            <span class="voucher-date">{{ formatShortDate(row.voucherDate) }}</span>
            <span class="voucher-no">{{ row.voucherNo }}</span>
            <span class="voucher-abstract" :title="row.abstract || ''">{{ row.abstract || '—' }}</span>
            <span class="voucher-status" :class="row.status">{{ getStatusText(row.status) }}</span>
            <span class="voucher-amount">{{ formatMoney(row.totalAmount) }}</span>
          </button>
          <div v-if="!recentVouchers.length" class="wb-empty">暂无近期凭证</div>
        </div>
      </section>

      <section class="wb-card wb-cash">
        <div class="wb-card__head">
          <h3 class="wb-card__title">现金银行结构</h3>
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
          <div v-if="!cashStructureWithRatio.length" class="wb-empty">暂无现金/银行数据</div>
        </div>
      </section>
    </div>

    <!-- 自定义常用功能 -->
    <el-dialog
      v-model="favoriteEditorVisible"
      title="自定义常用功能"
      width="720px"
      class="apple-dialog"
      :close-on-click-modal="false"
    >
      <p class="fav-editor__hint">勾选要放在工作台上的功能，最多 {{ MAX_FAVORITES }} 项（已选 {{ favoriteDraft.length }} 项）。</p>
      <el-checkbox-group v-model="favoriteDraft" class="fav-editor">
        <div v-for="app in navApps" :key="app.key" class="fav-editor__app">
          <div class="fav-editor__app-title">
            <el-icon><component :is="resolveNavIcon(app.icon)" /></el-icon>
            {{ app.title }}
          </div>
          <div class="fav-editor__items">
            <el-checkbox
              v-for="item in flattenNavApp(app)"
              :key="item.path"
              :value="item.path"
              :disabled="!favoriteDraft.includes(item.path) && favoriteDraft.length >= MAX_FAVORITES"
            >
              {{ item.title }}
            </el-checkbox>
          </div>
        </div>
      </el-checkbox-group>
      <template #footer>
        <el-button text @click="resetFavoriteDraft">恢复默认推荐</el-button>
        <el-button @click="favoriteEditorVisible = false">取消</el-button>
        <el-button type="primary" @click="saveFavorites">保存</el-button>
      </template>
    </el-dialog>

    <footer class="wb-footer">
      <span>{{ brandingStore.title }}<template v-if="brandingStore.subtitle"> · {{ brandingStore.subtitle }}</template></span>
    </footer>
  </div>
</template>

<script setup lang="ts">
import { computed, inject, nextTick, onActivated, onDeactivated, onMounted, onUnmounted, ref, watch, type Component, type Ref } from 'vue'
import { useRouter } from 'vue-router'
import type { ECharts } from 'echarts/core'
import { useUserStore } from '@/stores/user'
import { useLicenseStore } from '@/stores/license'
import { useWorkbenchStore, MAX_FAVORITES, buildDefaultFavorites } from '@/stores/workbench'
import request from '@/api/request'
import { formatAmount } from '@/utils/format'
import { canAccessRoute, flattenNavApp, matchPermissions, type NavApp, type NavItem } from '@/config/navigation'
import { NAV_ICONS, resolveNavIcon } from '@/config/navIcons'
import { hasLicensedModule, type LicenseModuleKey } from '@/config/licenseModules'
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

interface WorkbenchTodo {
  key: string
  title: string
  count: number
  level: 'normal' | 'warning' | 'danger'
  actionPath: string
  module?: LicenseModuleKey
  permission?: string[]
  hint?: string
}
interface WorkbenchData {
  currentYear: number
  currentPeriod: number
  todos: WorkbenchTodo[]
  cashier: { accountCount: number; totalBalance: number; unreconciledCount: number } | null
  asset: { assetCount: number; undepreciatedCount: number } | null
  scm: {
    draftDocCount: number
    monthSalesAmount: number
    monthPurchaseAmount: number
    stockAlertCount: number
    openReceivable: number
    openPayable: number
    dueSoonCount: number
  } | null
}
interface MetricCard {
  label: string
  value: string | number
  hint: string
  color: string
  bg: string
  icon: Component
  path: string
  badge?: string
}
type BoardTabKey = 'finance' | 'cashier' | 'scm'

const router = useRouter()
const userStore = useUserStore()
const licenseStore = useLicenseStore()
const brandingStore = useBrandingStore()
const workbenchStore = useWorkbenchStore()
const injectedNavApps = inject('layoutNavApps') as Ref<NavApp[]> | undefined
const navApps = computed<NavApp[]>(() => injectedNavApps?.value ?? [])
const userName = computed(() => userStore.userInfo?.nickname || userStore.userInfo?.username || '')
const userInitial = computed(() => (userName.value ? userName.value.trim().slice(0, 1).toUpperCase() : '客'))
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
const workbench = ref<WorkbenchData>({ currentYear: 0, currentPeriod: 0, todos: [], cashier: null, asset: null, scm: null })
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
const currentYear = computed(() => stats.value.currentYear || workbench.value.currentYear || currentTime.value.getFullYear())
const currentPeriod = computed(() => stats.value.currentPeriod || workbench.value.currentPeriod || currentTime.value.getMonth() + 1)

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
  canAccessRoute('/system/param', userStore.permissions, licenseStore.modules)
)

function isAccessiblePath(path?: string) {
  if (!path) return false
  return canAccessRoute(path, userStore.permissions, licenseStore.modules)
}

function hasModule(module?: LicenseModuleKey | LicenseModuleKey[]) {
  if (!module) return true
  return hasLicensedModule(licenseStore.modules, module)
}

/* ── 主操作：按授权模块生成，排在常用功能宫格最前 ── */
interface QuickItem {
  title: string
  path: string
  icon?: string
  desc?: string
}

const primaryActionsBase: QuickItem[] = [
  { title: '新增凭证', desc: '录入记账凭证', path: '/voucher/entry?action=add', icon: 'FilePen' },
  { title: '出纳录单', desc: '登记现金银行流水', path: '/cashier/journal', icon: 'Banknote' },
  { title: '新增销售订单', desc: '开一张销售订单', path: '/scm/docs/new?doc_type=SOa', icon: 'ClipboardList' },
  { title: '新增采购订单', desc: '开一张采购订单', path: '/scm/docs/new?doc_type=PO', icon: 'ShoppingCart' },
  { title: '生产计划', desc: '安排生产任务', path: '/scm/production-plans?plan_type=self', icon: 'CalendarRange' },
]

const visiblePrimaryActions = computed(() =>
  primaryActionsBase.filter(item => isAccessiblePath(item.path)).slice(0, 4)
)

/* ── 待办中心：接口待办（按模块 + 权限过滤）+ 总账风险项 ── */
const visibleTodos = computed<WorkbenchTodo[]>(() => {
  const fromApi = workbench.value.todos.filter(item =>
    hasModule(item.module) &&
    (!item.permission || matchPermissions(userStore.permissions, item.permission)) &&
    isAccessiblePath(item.actionPath)
  )
  const extras = insights.value.riskItems
    .filter(item => !['draft', 'audited'].includes(item.key) && isAccessiblePath(item.actionPath))
    .map<WorkbenchTodo>(item => ({ ...item, module: 'gl' }))
  const merged = [...fromApi, ...extras]
  // 有数量的排前面，其余保持原顺序
  return merged
    .map((item, index) => ({ item, index }))
    .sort((a, b) => Number(b.item.count > 0) - Number(a.item.count > 0) || a.index - b.index)
    .map(entry => entry.item)
})
const todoAttentionCount = computed(() => visibleTodos.value.filter(item => item.count > 0).length)

/* ── 常用功能：主操作 + 用户收藏，按路径去重 ── */
const quickVariants = ['mint', 'blue', 'lilac', 'amber', 'rose', 'foam']
const favoriteItems = computed<NavItem[]>(() => workbenchStore.resolveFavorites(navApps.value))
const quickItems = computed<QuickItem[]>(() => {
  const seen = new Set<string>()
  const result: QuickItem[] = []
  const push = (item: QuickItem) => {
    if (seen.has(item.path)) return
    seen.add(item.path)
    result.push(item)
  }
  visiblePrimaryActions.value.forEach(push)
  favoriteItems.value.forEach(item => push({ title: item.title, path: item.path, icon: item.icon }))
  return result
})
const favoriteEditorVisible = ref(false)
const favoriteDraft = ref<string[]>([])

function openFavoriteEditor() {
  favoriteDraft.value = favoriteItems.value.map(item => item.path)
  favoriteEditorVisible.value = true
}
function resetFavoriteDraft() {
  favoriteDraft.value = buildDefaultFavorites(navApps.value)
}
function saveFavorites() {
  // 保持导航树顺序（应用 › 分组 › 页面），避免勾选顺序打乱磁贴
  const ordered = navApps.value.flatMap(flattenNavApp).map(item => item.path).filter(path => favoriteDraft.value.includes(path))
  workbenchStore.setFavorites(ordered)
  favoriteEditorVisible.value = false
}

watch(
  () => [userStore.userInfo?.username, userStore.accountSetId] as const,
  ([username, accountSetId]) => {
    workbenchStore.load(username || '', accountSetId || '')
  },
  { immediate: true }
)

/* ── 数据看板页签 ── */
const boardTabs: Array<{ key: BoardTabKey; label: string; icon: string; visible: () => boolean }> = [
  { key: 'finance', label: '财务', icon: 'BookOpenCheck', visible: () => hasModule('gl') && (isAccessiblePath('/voucher/query') || isAccessiblePath('/ledger/general') || isAccessiblePath('/ledger/detail')) },
  { key: 'cashier', label: '资金', icon: 'Landmark', visible: () => hasModule('cashier') && workbench.value.cashier !== null && isAccessiblePath('/cashier/journal') },
  { key: 'scm', label: '供应链', icon: 'Warehouse', visible: () => hasModule(['scm', 'production', 'outsource']) && workbench.value.scm !== null && (isAccessiblePath('/scm/stock') || isAccessiblePath('/scm/docs?doc_type=SOa') || isAccessiblePath('/scm/docs?doc_type=PO') || isAccessiblePath('/scm/arap')) },
]
const visibleBoardTabs = computed(() => boardTabs.filter(tab => tab.visible()))
const boardTab = ref<BoardTabKey>('finance')
/** 财务图表组件与页签无关，只看财务模块是否可见 */
const financeWidgetsVisible = computed(() => visibleBoardTabs.value.some(tab => tab.key === 'finance'))
watch(visibleBoardTabs, tabs => {
  if (tabs.length && !tabs.some(tab => tab.key === boardTab.value)) boardTab.value = tabs[0].key
}, { immediate: true })
watch(financeWidgetsVisible, visible => {
  if (visible) nextTick(() => resizeCharts())
})

/* 指标卡配色 — 语义化令牌 */
const statCards = computed<MetricCard[]>(() => [
  { label: '本期凭证', value: stats.value.voucherCount, hint: `${currentYear.value} 年第 ${currentPeriod.value} 期`, color: '#0AA694', bg: 'rgba(18, 199, 174, 0.14)', icon: NAV_ICONS.FileText, path: '/voucher/query' },
  { label: '未记账凭证', value: stats.value.unpostedVoucherCount, hint: '草稿 + 已审核', color: '#F2545B', bg: 'rgba(242, 84, 91, 0.12)', icon: NAV_ICONS.FileCheck2, path: '/voucher/audit', badge: stats.value.unpostedVoucherCount > 0 ? `${stats.value.unpostedVoucherCount}` : undefined },
  { label: '货币资金', value: formatMoney(stats.value.cashBalance), hint: '现金与银行余额', color: '#2E84F5', bg: 'rgba(46, 132, 245, 0.12)', icon: NAV_ICONS.Wallet, path: '/ledger/cash-journal' },
  { label: '财务收入', value: formatMoney(stats.value.monthlyIncome), hint: '本期已记账发生额', color: '#0FB57E', bg: 'rgba(15, 181, 126, 0.12)', icon: NAV_ICONS.ArrowDownToLine, path: '/ledger/detail' },
  { label: '财务支出', value: formatMoney(stats.value.monthlyExpense), hint: '本期已记账发生额', color: '#F4A52E', bg: 'rgba(244, 165, 46, 0.14)', icon: NAV_ICONS.ArrowUpFromLine, path: '/ledger/detail' },
  { label: '本期盈余', value: formatMoney(stats.value.monthlySurplus), hint: stats.value.monthlySurplus >= 0 ? '财务收入减财务支出' : '财务支出大于收入', color: stats.value.monthlySurplus >= 0 ? '#0AA694' : '#F2545B', bg: stats.value.monthlySurplus >= 0 ? 'rgba(18, 199, 174, 0.14)' : 'rgba(242, 84, 91, 0.12)', icon: NAV_ICONS.BadgeCheck, path: stats.value.financialResultReportPath || '/report/dynamic' },
  ...(hasBudgetAccounting.value ? [
    { label: '预算收入', value: formatMoney(stats.value.budgetIncome), hint: '本期已记账预算口径', color: '#0FB57E', bg: 'rgba(15, 181, 126, 0.12)', icon: NAV_ICONS.ArrowDownToLine, path: '/ledger/detail' },
    { label: '预算支出', value: formatMoney(stats.value.budgetExpense), hint: '本期已记账预算口径', color: '#F4A52E', bg: 'rgba(244, 165, 46, 0.14)', icon: NAV_ICONS.ArrowUpFromLine, path: '/ledger/detail' },
    { label: '预算结余', value: formatMoney(stats.value.budgetBalance), hint: '预算收入减预算支出', color: stats.value.budgetBalance >= 0 ? '#0AA694' : '#F2545B', bg: stats.value.budgetBalance >= 0 ? 'rgba(18, 199, 174, 0.14)' : 'rgba(242, 84, 91, 0.12)', icon: NAV_ICONS.BadgeCheck, path: '/ledger/detail' },
  ] : []),
])

const visibleStatCards = computed(() =>
  statCards.value.filter(card => isAccessiblePath(card.path))
)

const cashierCards = computed<MetricCard[]>(() => {
  const data = workbench.value.cashier
  if (!data) return []
  return [
    { label: '资金余额合计', value: formatMoney(data.totalBalance), hint: '出纳账户期初 + 流水净额', color: '#2E84F5', bg: 'rgba(46, 132, 245, 0.12)', icon: NAV_ICONS.Wallet, path: '/cashier/daily-report' },
    { label: '出纳账户', value: data.accountCount, hint: '有期初或流水的账户数', color: '#0AA694', bg: 'rgba(18, 199, 174, 0.14)', icon: NAV_ICONS.Landmark, path: '/cashier/daily-report' },
    { label: '未勾对流水', value: data.unreconciledCount, hint: '尚未与银行对账的记录', color: data.unreconciledCount > 0 ? '#F4A52E' : '#0AA694', bg: data.unreconciledCount > 0 ? 'rgba(244, 165, 46, 0.14)' : 'rgba(18, 199, 174, 0.14)', icon: NAV_ICONS.ListChecks, path: '/cashier/flow-query' },
  ].filter(card => isAccessiblePath(card.path))
})

const scmCards = computed<MetricCard[]>(() => {
  const data = workbench.value.scm
  if (!data) return []
  return [
    { label: '本期销售', value: formatMoney(data.monthSalesAmount), hint: '已审核发货减退货', color: '#0FB57E', bg: 'rgba(15, 181, 126, 0.12)', icon: NAV_ICONS.Store, path: '/scm/report/sales/summary' },
    { label: '本期采购', value: formatMoney(data.monthPurchaseAmount), hint: '已审核入库减退货', color: '#F4A52E', bg: 'rgba(244, 165, 46, 0.14)', icon: NAV_ICONS.ShoppingCart, path: '/scm/report/purchase/summary' },
    { label: '待审核单据', value: data.draftDocCount, hint: '全部供应链草稿单据', color: data.draftDocCount > 0 ? '#F2545B' : '#0AA694', bg: data.draftDocCount > 0 ? 'rgba(242, 84, 91, 0.12)' : 'rgba(18, 199, 174, 0.14)', icon: NAV_ICONS.FileCheck2, path: '/scm/docs?doc_type=SOa&status=draft', badge: data.draftDocCount > 0 ? `${data.draftDocCount}` : undefined },
    { label: '库存预警', value: data.stockAlertCount, hint: '低于安全库存的物料', color: data.stockAlertCount > 0 ? '#F2545B' : '#0AA694', bg: data.stockAlertCount > 0 ? 'rgba(242, 84, 91, 0.12)' : 'rgba(18, 199, 174, 0.14)', icon: NAV_ICONS.AlertTriangle, path: '/scm/report/stock-alert' },
    { label: '未收应收', value: formatMoney(data.openReceivable), hint: '未核销应收余额', color: '#2E84F5', bg: 'rgba(46, 132, 245, 0.12)', icon: NAV_ICONS.ArrowDownToLine, path: '/scm/arap' },
    { label: '未付应付', value: formatMoney(data.openPayable), hint: '未核销应付余额', color: '#9C8FF5', bg: 'rgba(156, 143, 245, 0.16)', icon: NAV_ICONS.ArrowUpFromLine, path: '/scm/arap' },
  ].filter(card => isAccessiblePath(card.path))
})

const activeBoardCards = computed<MetricCard[]>(() => {
  if (boardTab.value === 'cashier') return cashierCards.value
  if (boardTab.value === 'scm') return scmCards.value
  return visibleStatCards.value
})

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

function goMetric(path?: string) { if (path) router.push(path) }
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
  // 待办/分模块汇总与财务总览并行拉取；任一失败不影响另一半渲染
  const [overviewResult, todosResult] = await Promise.allSettled([
    request.get<any>('/dashboard/overview'),
    request.get<WorkbenchData>('/dashboard/todos'),
  ])
  if (requestSeq !== dashboardRequestSeq || userStore.accountSetId !== accountSetId) return
  if (overviewResult.status === 'fulfilled') {
    const data = overviewResult.value.data || {}
    Object.assign(stats.value, data.stats || {})
    recentVouchers.value = data.recentVouchers || []
    trend.value = data.trend || []
    const insight = data.insights || {}
    insights.value = {
      riskItems: insight.riskItems || [],
      cashStructure: insight.cashStructure || [],
      activityTop: insight.activityTop || insight.expenseTop || [],
    }
  } else {
    console.warn('工作台财务总览加载失败:', overviewResult.reason)
  }
  if (todosResult.status === 'fulfilled') {
    const data = todosResult.value.data
    workbench.value = {
      currentYear: Number(data?.currentYear || 0),
      currentPeriod: Number(data?.currentPeriod || 0),
      todos: Array.isArray(data?.todos) ? data.todos : [],
      cashier: data?.cashier ?? null,
      asset: data?.asset ?? null,
      scm: data?.scm ?? null,
    }
  } else {
    console.warn('工作台待办加载失败:', todosResult.reason)
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
@import './Workbench.styles.css';
</style>
