<template>
  <el-container class="layout-container apple-layout">
    <!-- 侧边栏：只保留应用栏；点应用图标直接进模块主页（二级导航面板与模块主页功能完全重复，已取消） -->
    <aside class="aside app-shell-aside" :style="{ width: asideWidth }">
      <AppRail
        :apps="navApps"
        :active-app-key="activeAppKey"
        :logo-src="brandingStore.logoSrc"
        :brand-title="brandingStore.title"
        :version="appVersion || undefined"
        :home-path="homePagePath"
        @home="goToHome"
        @select="handleAppSelect"
        @preload="preloadNavApp"
        @context="openHomeMenu"
      />
    </aside>

    <!-- 应用栏右键：设置/取消「默认主页」 -->
    <teleport to="body">
      <div v-if="homeMenu.visible" class="rail-context-mask" @click="closeHomeMenu" @contextmenu.prevent="closeHomeMenu">
        <ul class="rail-context-menu" :style="{ left: `${homeMenu.x}px`, top: `${homeMenu.y}px` }" @click.stop>
          <li v-if="!homeMenuIsCurrent" class="rail-context-menu__item" @click="applyHomeMenu">
            设为默认主页
          </li>
          <li v-else class="rail-context-menu__item" @click="resetHomeMenu">取消默认主页</li>
        </ul>
      </div>
    </teleport>

    <el-container>
      <!-- 顶栏 - 苹果风格 -->
      <el-header class="header">
        <div class="header-left">
          <el-breadcrumb separator="/" class="apple-breadcrumb">
            <el-breadcrumb-item v-if="currentParent">
              <a class="breadcrumb-link" @click="navigateToModuleHome">{{ currentParent }}</a>
            </el-breadcrumb-item>
            <el-breadcrumb-item v-if="currentSectionLabel">
              <span class="breadcrumb-section">{{ currentSectionLabel }}</span>
            </el-breadcrumb-item>
            <el-breadcrumb-item>
              <a v-if="currentListItem" class="breadcrumb-link" title="回到列表" @click="navigateToList">{{ currentTitle }}</a>
              <span v-else>{{ currentTitle }}</span>
            </el-breadcrumb-item>
          </el-breadcrumb>
        </div>
        <div class="header-right">
          <div class="info-chip info-chip--account">
            <span class="info-chip__label">当前账套：</span>
            <span class="info-chip__icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
                <polyline points="9 22 9 12 15 12 15 22"/>
              </svg>
            </span>
            <span class="info-chip__text">{{ userStore.accountSetName || '未选账套' }}</span>
          </div>
          <div class="info-chip info-chip--user">
            <span class="info-chip__label">当前用户：</span>
            <span class="info-chip__icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                <circle cx="12" cy="7" r="4"/>
              </svg>
            </span>
            <span class="info-chip__text">{{ userStore.userInfo?.nickname || userStore.userInfo?.username }}</span>
          </div>

          <div class="header-actions header-actions--switch">
            <button class="header-action-btn header-action-btn--operator" title="切换操作员" @click="openSwitchOperatorDialog">
              <span class="header-action-btn__icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                  <circle cx="8.5" cy="7" r="4"/>
                  <line x1="20" y1="8" x2="20" y2="14"/>
                  <line x1="23" y1="11" x2="17" y2="11"/>
                </svg>
              </span>
              <span class="header-action-btn__label">切换操作员</span>
            </button>
            <button class="header-action-btn header-action-btn--account" title="切换账套" @click="handleChangeAccount">
              <span class="header-action-btn__icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <rect x="3" y="3" width="7" height="7"/>
                  <rect x="14" y="3" width="7" height="7"/>
                  <rect x="14" y="14" width="7" height="7"/>
                  <rect x="3" y="14" width="7" height="7"/>
                </svg>
              </span>
              <span class="header-action-btn__label">切换账套</span>
            </button>
          </div>

          <div class="header-actions header-actions--right">
            <!-- 性能模式切换按钮 -->
            <button
              class="header-action-btn header-action-btn--perf"
              :title="isLightMode ? '当前：省电模式（点击恢复完整视觉效果）' : '当前：完整模式（点击开启省电模式，低配电脑推荐）'"
              @click="togglePerfMode"
            >
              <span class="header-action-btn__icon">
                <svg v-if="isLightMode" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <!-- 闪电图标：省电模式激活中 -->
                  <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
                </svg>
                <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <!-- 仪表盘图标：完整模式激活中 -->
                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z"/>
                  <path d="M12 6v6l4 2"/>
                </svg>
              </span>
              <span class="header-action-btn__label">{{ isLightMode ? '省电模式' : '完整模式' }}</span>
            </button>
            <button class="header-action-btn header-action-btn--home" title="回到首页" @click="goToHome">
              <span class="header-action-btn__icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
                  <polyline points="9 22 9 12 15 12 15 22"/>
                </svg>
              </span>
              <span class="header-action-btn__label">首页</span>
            </button>
            <button
              class="header-action-btn header-action-btn--back"
              title="返回上一页"
              :disabled="!canGoBack"
              @click="goBack"
            >
              <span class="header-action-btn__icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <line x1="19" y1="12" x2="5" y2="12"/>
                  <polyline points="12 19 5 12 12 5"/>
                </svg>
              </span>
              <span class="header-action-btn__label">返回</span>
            </button>
            <button class="header-action-btn header-action-btn--logout" title="退出登录" @click="handleLogout">
              <span class="header-action-btn__icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
                  <polyline points="16 17 21 12 16 7"/>
                  <line x1="21" y1="12" x2="9" y2="12"/>
                </svg>
              </span>
              <span class="header-action-btn__label">退出</span>
            </button>
          </div>

          <!-- 主题切换（已停用）
          <button class="theme-btn" @click="toggleTheme" :title="currentTheme === 'light' ? '切换到暗色模式' : '切换到浅色模式'">
            <svg v-if="currentTheme === 'light'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
            </svg>
            <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="5"/>
              <line x1="12" y1="1" x2="12" y2="3"/>
              <line x1="12" y1="21" x2="12" y2="23"/>
              <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/>
              <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
              <line x1="1" y1="12" x2="3" y2="12"/>
              <line x1="21" y1="12" x2="23" y2="12"/>
              <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/>
              <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
            </svg>
          </button>
          -->
        </div>
      </el-header>

      <!-- 多标签栏 -->
      <TabsBar />

      <!-- 主内容 -->
      <el-main class="main">
        <div class="main-view">
          <router-view v-slot="{ Component }">
            <keep-alive :key="viewCacheKey" :max="keepAliveMax">
              <component :is="Component" :key="tabsStore.activeKey" />
            </keep-alive>
          </router-view>
        </div>
      </el-main>
    </el-container>

    <!-- 切换操作员对话框 -->
    <el-dialog
      v-model="switchOperatorVisible"
      title="切换操作员"
      width="420px"
      :close-on-click-modal="false"
      class="apple-dialog"
      @closed="resetSwitchOperatorForm"
    >
      <el-form
        ref="switchOperatorFormRef"
        :model="switchOperatorForm"
        :rules="switchOperatorRules"
        label-width="84px"
        @submit.prevent
      >
        <el-form-item label="当前账套">
          <el-input :model-value="userStore.accountSetName || '未选账套'" disabled />
        </el-form-item>
        <el-form-item label="操作员" prop="username">
          <el-select
            v-model="switchOperatorForm.username"
            filterable
            placeholder="请选择操作员"
            style="width: 100%"
            :loading="operatorLoading"
          >
            <el-option
              v-for="item in operatorUsers"
              :key="item.username"
              :label="`${item.nickname || item.username}（${item.username}）`"
              :value="item.username"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="密码" prop="password">
          <el-input
            v-model="switchOperatorForm.password"
            type="password"
            placeholder="请输入密码"
            show-password
            @keyup.enter="confirmSwitchOperator"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="switchOperatorVisible = false">取消</el-button>
        <el-button type="primary" :loading="switchOperatorLoading" @click="confirmSwitchOperator">
          登录
        </el-button>
      </template>
    </el-dialog>
  </el-container>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch, provide } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useUserStore } from '@/stores/user'
import { getUsersByAccountSet, logout, switchOperator } from '@/api/auth'
import type { UserItem } from '@/api/auth'
import { ElMessage, ElMessageBox, ElNotification } from 'element-plus'
import type { FormInstance, FormRules } from 'element-plus'
import request from '@/api/request'
import { useKeyboardShortcuts } from '@/composables/useKeyboardShortcuts'
// import { useTheme } from '@/composables/useTheme'
import { useGlobalPageTableHeight } from '@/composables/useGlobalPageTableHeight'
import { useSystemParamsStore } from '@/stores/systemParams'
import { useNavigationReturnStore } from '@/stores/navigationReturn'
import { useVoucherModalReturnStore } from '@/stores/voucherModalReturn'
import {
  buildNavApps,
  canAccessRoute,
  flattenNavApp,
  flattenNavApps,
  getDefaultLandingPath,
  locateNavItem,
  navAppToGroup,
  WORKBENCH_APP_KEY,
  type NavApp,
} from '@/config/navigation'
import { useBrandingStore } from '@/stores/branding'
import { useLicenseStore } from '@/stores/license'
import { useAppBuildInfo } from '@/composables/useAppBuildInfo'
import TabsBar from '@/components/layout/TabsBar.vue'
import AppRail from '@/components/layout/AppRail.vue'
import { useTabsStore } from '@/stores/tabs'
import { getTabPolicy, getViewKey as getViewKeyUtil } from '@/utils/viewKey'
import { DOC_TITLE } from '@/utils/scmDoc'
import { shouldUseLightMode, setPerformanceMode } from '@/utils/performanceMode'
import { getGroupNavigationPath, resolveNavAppTitle } from '@/utils/groupNavigation'
import { preloadRoutePathsWhenIdle } from '@/utils/routePreload'
import {
  clearHomePage,
  homePagePath,
  loadHomePage,
  resetHomePageContext,
  setHomePage,
} from '@/utils/homePreference'
import {
  loadAccountDisplayMode,
  resetAccountDisplayMode,
} from '@/utils/accountDisplayPreference'

const keepAliveMax = shouldUseLightMode() ? 6 : 14

// ── 性能模式切换 ───────────────────────────────────────────────────────────
const isLightMode = ref(shouldUseLightMode())

function togglePerfMode() {
  const next = isLightMode.value ? 'full' : 'light'
  const nowLight = setPerformanceMode(next)
  isLightMode.value = nowLight
  ElMessage.success(nowLight
    ? '已开启省电模式：关闭毛玻璃/动画，提升流畅度'
    : '已恢复完整模式：视觉特效已开启'
  )
}

// const { currentTheme, toggleTheme, initTheme } = useTheme()

const systemParamsStore = useSystemParamsStore()
const brandingStore = useBrandingStore()
const { version: appVersion, mismatch: buildVersionMismatch } = useAppBuildInfo()
watch(buildVersionMismatch, mismatch => {
  if (!mismatch) return
  ElNotification.warning({
    title: '发现新流程版本',
    message: '客户端与服务端版本不一致，请刷新页面后继续操作。',
    duration: 0,
    onClick: () => window.location.reload(),
  })
})
useGlobalPageTableHeight()

const route = useRoute()
const router = useRouter()
const userStore = useUserStore()
const licenseStore = useLicenseStore()
const navigationReturnStore = useNavigationReturnStore()
const voucherModalReturnStore = useVoucherModalReturnStore()
const tabsStore = useTabsStore()

let scmDocListPreload: Promise<unknown> | null = null
let scmDocFormPreload: Promise<unknown> | null = null
let scmDocFormPreloadScheduled = false

/**
 * 供应链各类单据共用 DocList。登录后空闲预取，并在用户靠近相关菜单时立即预取，
 * 避免第一次点击销售订单时才让 Vite/浏览器解析整棵列表组件依赖。
 */
function preloadScmDocList() {
  if (!canAccessRoute('/scm/docs', userStore.permissions, licenseStore.modules)) return null
  if (scmDocListPreload) return scmDocListPreload
  scmDocListPreload = import('@/views/scm/DocList.vue').catch(error => {
    scmDocListPreload = null
    console.warn('预加载供应链单据列表失败:', error)
  })
  return scmDocListPreload
}

function preloadScmDocForm() {
  if (!canAccessRoute('/scm/docs', userStore.permissions, licenseStore.modules)) return null
  if (scmDocFormPreload) return scmDocFormPreload
  scmDocFormPreload = import('@/views/scm/DocForm.vue').catch(error => {
    scmDocFormPreload = null
    console.warn('预加载供应链单据表单失败:', error)
  })
  return scmDocFormPreload
}

function scheduleScmDocFormPreload() {
  if (scmDocFormPreloadScheduled || scmDocFormPreload) return
  scmDocFormPreloadScheduled = true
  const preload = () => { void preloadScmDocForm() }
  const requestIdle = (window as any).requestIdleCallback as typeof window.requestIdleCallback | undefined
  if (typeof requestIdle === 'function') {
    requestIdle(preload, { timeout: 3000 })
  } else {
    globalThis.setTimeout(preload, 1200)
  }
}

function preloadScmEntryChain() {
  const listTask = preloadScmDocList()
  if (listTask) void listTask.finally(scheduleScmDocFormPreload)
}

/** 移到应用图标上：整个应用低优先级排队预取 */
function preloadNavApp(app: NavApp) {
  preloadRoutePathsWhenIdle(router, flattenNavApp(app).map(item => item.path))
}

/** 登录后空闲时按应用顺序把各模块铺开预取，不与首屏抢资源 */
function preloadMenusWhenIdle() {
  preloadRoutePathsWhenIdle(router, flattenNavApps(navApps.value).map(item => item.path))
}

onMounted(() => {
  // initTheme()
  void systemParamsStore.load()
  void brandingStore.load()
  const requestIdle = (window as any).requestIdleCallback as typeof window.requestIdleCallback | undefined
  const warmUp = () => {
    preloadScmEntryChain()
    preloadMenusWhenIdle()
  }
  if (typeof requestIdle === 'function') {
    requestIdle(warmUp, { timeout: 2000 })
  } else {
    globalThis.setTimeout(warmUp, 800)
  }
})

const dynamicReportMenuItems = ref<{ path: string; title: string }[]>([])

function isReportEnabledFlag(value: unknown) {
  return value === true || value === 1 || value === '1'
}

function buildDynamicReportMenuItems(raw: any[]) {
  return raw
    .filter((t: any) => isReportEnabledFlag(t.is_enabled))
    .sort(
      (a: any, b: any) =>
        Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0) ||
        String(a.code).localeCompare(String(b.code))
    )
    .map((t: any) => ({
      path: `/report/dynamic/${t.code}?view=1`,
      title: t.name,
    }))
}

function syncDynamicReportMenuItems(nextItems: { path: string; title: string }[]) {
  const prev = JSON.stringify(dynamicReportMenuItems.value)
  const next = JSON.stringify(nextItems)
  if (prev === next) return
  dynamicReportMenuItems.value = nextItems
}

async function fetchReportTemplates() {
  if (!userStore.token || !userStore.accountSetId) return
  try {
    const res = await request.get<any[]>('/report/templates')
    if (res.data && Array.isArray(res.data)) {
      syncDynamicReportMenuItems(buildDynamicReportMenuItems(res.data))
    }
  } catch (error) {
    console.error('获取报表模板列表失败:', error)
    syncDynamicReportMenuItems([])
  }
}

watch(
  () => [userStore.token, userStore.accountSetId] as const,
  ([token, accountSetId]) => {
    if (token && accountSetId) {
      void fetchReportTemplates()
    } else {
      syncDynamicReportMenuItems([])
    }
  },
  { immediate: true }
)

// 报表模板增删改后，由 DynamicReport 触发该事件 → 刷新导航栏
function handleReportTemplatesChanged() {
  fetchReportTemplates()
}
window.addEventListener('report-templates-changed', handleReportTemplatesChanged)
onBeforeUnmount(() => {
  window.removeEventListener('report-templates-changed', handleReportTemplatesChanged)
})

const switchOperatorVisible = ref(false)
const switchOperatorLoading = ref(false)
const operatorLoading = ref(false)
const operatorUsers = ref<UserItem[]>([])
const switchOperatorFormRef = ref<FormInstance>()
const switchOperatorForm = ref({
  username: '',
  password: '',
})
const switchOperatorRules: FormRules = {
  username: [{ required: true, message: '请选择操作员', trigger: 'change' }],
  password: [{ required: true, message: '请输入密码', trigger: 'blur' }],
}

useKeyboardShortcuts([
  {
    key: 'l',
    ctrl: true,
    shift: true,
    handler: () => {
      if (route.path === '/system/param') {
        const open = route.query.openBrandSettings === '1'
        router.replace({
          path: '/system/param',
          query: open ? {} : { openBrandSettings: '1' },
        })
        return
      }
      router.push({ path: '/system/param', query: { openBrandSettings: '1' } })
    },
    description: 'Ctrl+Shift+L 打开品牌设置',
  },
  {
    key: 'k',
    ctrl: true,
    handler: () => {
      focusNavSearch()
    },
    description: 'Ctrl+K 搜索功能菜单',
  },
  {
    key: 'F12',
    shift: true,
    handler: () => {
      router.push('/base/keyboard-shortcuts')
    },
    description: 'Shift+F12 打开快捷键维护',
  },
])

function goToHome() {
  selectedAppKey.value = null
  router.push(
    getDefaultLandingPath(userStore.permissions, systemParamsStore.enableCashFlow, licenseStore.modules)
  )
}

const landingPath = computed(() =>
  getDefaultLandingPath(userStore.permissions, systemParamsStore.enableCashFlow, licenseStore.modules)
)

const canGoBack = computed(() => {
  if (route.query.from === 'drill' && navigationReturnStore.peek()) return true
  if (route.query.from === 'voucher' && voucherModalReturnStore.peek()) return true
  return route.path !== landingPath.value
})

function goBack() {
  if (route.query.from === 'voucher') {
    const state = voucherModalReturnStore.peek()
    if (state?.sourcePath && state.voucherId) {
      router.push({
        path: state.sourcePath,
        query: { openVoucherId: state.voucherId },
      })
      return
    }
  }

  const drillState = navigationReturnStore.peek()
  if (route.query.from === 'drill' && drillState?.path) {
    router.push({
      path: drillState.path,
      query: drillState.query || {},
    })
    return
  }

  if (window.history.length > 1) {
    router.back()
    return
  }
  goToHome()
}

async function handleLogout() {
  try {
    await logout()
  } catch (error) {
    console.error('退出登录失败:', error)
  }
  userStore.logout()
  await router.push('/login')
}

async function handleChangeAccount() {
  try {
    await logout()
  } catch (error) {
    console.error('退出登录失败:', error)
  }
  userStore.logout()
  await router.push('/login')
}

// ── 应用栏 ─────────────────────────────────────────────────────────────────
const APP_RAIL_WIDTH = 64

/** 用户在应用栏上点选（而非按路由推导）的应用键；路由切到别的应用时自动清空 */
const selectedAppKey = ref<string | null>(null)

const navApps = computed(() =>
  buildNavApps(
    userStore.permissions,
    systemParamsStore.enableCashFlow,
    dynamicReportMenuItems.value.map(t => ({
      path: t.path,
      title: t.title,
      permission: 'report:view',
    })),
    licenseStore.modules,
    systemParamsStore.enableForeignCurrency
  )
)

/** 兼容旧消费方（GroupNav / BentoGrid 等）的分组结构 */
const menuGroups = computed(() => navApps.value.map(navAppToGroup))

provide('layoutNavApps', navApps)
provide('layoutMenuGroups', menuGroups)
/** 财务总账工作页面「切换用户」节点复用顶栏的切换操作员弹窗（函数声明会提升，此处引用安全） */
provide('layoutOpenSwitchOperator', () => openSwitchOperatorDialog())

/** 当前路由归属（应用 › 分组 › 页面） */
const currentLocation = computed(() => {
  if (route.name === 'GroupNav') {
    const title = resolveNavAppTitle(String(route.params.groupTitle || ''))
    const app = navApps.value.find(a => a.title === title)
    return app ? { app, section: null, item: null } : null
  }
  const located = locateNavItem(navApps.value, route.fullPath)
  return located ? { app: located.app, section: located.section, item: located.item } : null
})

/** 应用栏高亮：优先用户点选，其次按路由归属；工作台落到 workbench */
const activeAppKey = computed(() => {
  if (selectedAppKey.value) return selectedAppKey.value
  if (currentLocation.value) return currentLocation.value.app.key
  return route.path === HOME_PATH ? WORKBENCH_APP_KEY : ''
})

const asideWidth = computed(() => `${APP_RAIL_WIDTH}px`)

/** 点击应用图标：直接进入该模块主页（模块主页已列出该模块全部功能） */
function openAppPanel(app: NavApp) {
  selectedAppKey.value = app.key
  preloadNavApp(app)
  const target = getGroupNavigationPath(app.title)
  if (route.path !== target) {
    void router.push(target)
  }
}

function handleAppSelect(app: NavApp) {
  openAppPanel(app)
}

/**
 * Ctrl+K：功能搜索框现在在模块主页 / 工作台上（原二级导航面板已取消），
 * 因此先跳到当前模块主页（无模块归属时回工作台），再由目标页按 ?focus=search 聚焦。
 */
function focusNavSearch() {
  const app = currentLocation.value?.app
  const target = app ? getGroupNavigationPath(app.title) : HOME_PATH
  const query = { ...route.query, focus: 'search' }
  if (route.path === target) {
    if (route.query.focus !== 'search') void router.replace({ path: target, query })
    else void router.replace({ path: target, query: { ...route.query, focus: `search-${Date.now()}` } })
    return
  }
  void router.push({ path: target, query: { focus: 'search' } })
}

// 路由切换到其它应用（或工作台）时，放弃手动点选状态，让高亮跟随路由
watch(
  () => route.fullPath,
  () => {
    const located = currentLocation.value
    if (!located || located.app.key !== selectedAppKey.value) {
      selectedAppKey.value = null
    }
  }
)

// ── 默认主页偏好 ───────────────────────────────────────────────────────────
const homeMenu = ref<{ visible: boolean; x: number; y: number; app: NavApp | null }>({
  visible: false,
  x: 0,
  y: 0,
  app: null,
})

/** 右键项对应的主页路径：工作台为 /dashboard，应用为其模块主页 */
const homeMenuPath = computed(() =>
  homeMenu.value.app ? getGroupNavigationPath(homeMenu.value.app.title) : '/dashboard'
)
const homeMenuIsCurrent = computed(() => homePagePath.value === homeMenuPath.value)

function openHomeMenu(payload: { app: NavApp | null; event: MouseEvent }) {
  homeMenu.value = {
    visible: true,
    x: Math.min(payload.event.clientX + 4, window.innerWidth - 160),
    y: Math.min(payload.event.clientY + 4, window.innerHeight - 60),
    app: payload.app,
  }
}

function closeHomeMenu() {
  homeMenu.value.visible = false
}

function applyHomeMenu() {
  const label = homeMenu.value.app?.title || '工作台'
  setHomePage(homeMenuPath.value)
  closeHomeMenu()
  ElMessage.success(`已将「${label}」设为默认主页`)
}

function resetHomeMenu() {
  clearHomePage()
  closeHomeMenu()
  ElMessage.success('已取消默认主页，登录后回到工作台')
}

watch(
  () => [userStore.userInfo?.username, userStore.accountSetId] as const,
  ([username, accountSetId]) => {
    if (accountSetId) {
      loadHomePage(username || '', accountSetId)
      loadAccountDisplayMode(username || '', accountSetId)
    } else {
      resetHomePageContext()
      resetAccountDisplayMode()
    }
  },
  { immediate: true }
)

function navigateToModuleHome() {
  const app = currentLocation.value?.app
  if (app) {
    router.push(getGroupNavigationPath(app.title))
  }
}
/** 仅在成功登录/切换账套后更新，logout 清空 accountSetId 时不变化，避免 keep-alive 重挂载当前页触发无效请求 */
const viewCacheKey = ref(userStore.accountSetId || 'no-account-set')

watch(
  () => userStore.accountSetId,
  id => {
    if (id) {
      viewCacheKey.value = id
      // 切换账套：只保留新账套当前会话所需标签，不恢复历史标签。
      tabsStore.reset()
      ensureHomeTab()
      openTabForRoute(route)
    } else {
      // 关闭账套/退出登录后立即释放标签及其 KeepAlive 引用。
      tabsStore.reset()
    }
  }
)

function getViewKey(fullPath: string, routeName?: string | symbol | null) {
  return getViewKeyUtil(fullPath, viewCacheKey.value, routeName)
}

// ── 多标签页 ─────────────────────────────────────────────────────────────
const HOME_PATH = '/dashboard'
function resolveTabTitle(r: { path: string; name?: any; meta?: any; query?: any; params?: any }): string {
  let base = (r.meta?.title as string) || ''
  const dt = (r.query?.doc_type as string) || ''
  // 预收/预付款单列表页（/scm/docs?doc_type=RCV&payment_mode=advance）→ 「预收款单/预付款单」
  if (r.path === '/scm/docs' && r.query?.payment_mode === 'advance' && dt === 'RCV') base = '预收款单'
  else if (r.path === '/scm/docs' && r.query?.payment_mode === 'advance' && dt === 'PAY') base = '预付款单'
  else if (r.path === '/scm/docs' && dt) base = DOC_TITLE[dt] || base
  else if (r.name === 'ScmDocNew' && r.query?.payment_mode === 'advance' && dt === 'RCV') base = '新增预收款单'
  else if (r.name === 'ScmDocNew' && r.query?.payment_mode === 'advance' && dt === 'PAY') base = '新增预付款单'
  else if (r.name === 'ScmDocNew' && dt) base = '新增' + (DOC_TITLE[dt] || '单据')
  else if (r.name === 'GroupNav') {
    // 模块导航页按所属分组命名，避免多个「模块导航」标签无法区分（采购管理→采购导航）
    const g = resolveNavAppTitle(String(r.params?.groupTitle || '').trim())
    if (g) base = g.endsWith('管理') ? g.slice(0, -2) + '导航' : g + '导航'
  }
  return base || '页面'
}
// 仅 Layout('/') 下的内容路由进标签；登录/激活等顶级路由不进
function isTabRoute(r: any): boolean { return !!(r?.matched?.[0] && r.matched[0].path === '/') }
function openTabForRoute(r: any) {
  if (!isTabRoute(r)) return
  const policy = getTabPolicy(r.name)
  tabsStore.openOrActivate({
    identity: getViewKey(r.fullPath, r.name),
    fullPath: r.fullPath,
    title: resolveTabTitle(r),
    pinned: r.name === 'Dashboard',
    kind: policy.kind,
    evictable: policy.evictable,
  })
}
function ensureHomeTab() {
  tabsStore.ensureHome({ identity: getViewKey(HOME_PATH, 'Dashboard'), fullPath: HOME_PATH, title: '工作台' })
}

// 一次性清理旧版本遗留的标签持久化数据；标签仅在当前运行会话中存在。
try {
  for (let i = localStorage.length - 1; i >= 0; i -= 1) {
    const key = localStorage.key(i)
    if (key?.startsWith('scm_tabs_')) localStorage.removeItem(key)
  }
} catch { /* localStorage 不可用时忽略 */ }

// 初始化（setup 同步执行，确保首帧 activeKey 正确）：首页 + 当前路由
ensureHomeTab()
openTabForRoute(route)

// 路由变化（菜单/标签/编程跳转）→ 建或聚焦标签。afterEach 在路由确认后、视图 flush 前更新 activeKey，避免缓存错位
const unregisterTabGuard = router.afterEach(to => openTabForRoute(to))
onBeforeUnmount(() => unregisterTabGuard())

function matchesRoute(menuPath: string, routePath: string, routeQuery: any): boolean {
  const [mPath, mQueryStr] = menuPath.split('?')
  if (mPath !== routePath) return false
  
  if (mQueryStr) {
    const mParams = new URLSearchParams(mQueryStr)
    for (const [key, value] of mParams.entries()) {
      if (routeQuery[key] !== value) return false
    }
  }
  return true
}

/**
 * 当前路由对应的「列表」菜单项（用于面包屑标题点击回列表）。
 * 1) 精确匹配 → 当前页本身就是列表页；
 * 2) 子页（新增/编辑/详情等）→ 取 path 为当前路径前缀、且 doc_type/plan_type 等 query 一致的菜单项，
 *    无完全一致时退化为最长前缀匹配（如工单详情无 plan_type，回到生产计划列表）。
 */
const currentListItem = computed(() => {
  const all = navApps.value.flatMap(app =>
    app.sections.flatMap(section =>
      section.items.map(c => ({ ...c, group: app.title, section: section.label }))
    )
  )
  const exact = all.find(c => matchesRoute(c.path, route.path, route.query))
  if (exact) return exact
  const byPrefix = all.filter(c => {
    const mPath = c.path.split('?')[0]
    return route.path === mPath || route.path.startsWith(mPath + '/')
  })
  if (!byPrefix.length) return null
  const queryMatch = byPrefix.filter(c => {
    const mq = c.path.split('?')[1]
    if (!mq) return true
    const mp = new URLSearchParams(mq)
    for (const [k, v] of mp.entries()) if (String((route.query as any)?.[k] ?? '') !== v) return false
    return true
  })
  const pool = (queryMatch.length ? queryMatch : byPrefix)
    .slice()
    .sort((a, b) => b.path.split('?')[0].length - a.path.split('?')[0].length)
  return pool[0] || null
})

const currentTitle = computed(() => currentListItem.value?.title || (route.meta?.title as string) || '')
/** 面包屑一级：应用名（模块导航页本身只显示应用名） */
const currentParent = computed(() => {
  if (route.name === 'GroupNav') return ''
  return currentListItem.value?.group || currentLocation.value?.app.title || ''
})
/** 面包屑二级：分组名 */
const currentSectionLabel = computed(() => {
  if (route.name === 'GroupNav') return ''
  return currentListItem.value?.section || currentLocation.value?.section?.label || ''
})

/** 点击面包屑标题：回到该模块列表页 */
function navigateToList() {
  const item = currentListItem.value
  if (item && item.path !== route.fullPath) router.push(item.path)
}

async function openSwitchOperatorDialog() {
  if (!userStore.accountSetId) {
    ElMessage.warning('当前未选择账套，无法切换操作员')
    return
  }
  switchOperatorVisible.value = true
  switchOperatorForm.value.username = userStore.userInfo?.username || ''
  switchOperatorForm.value.password = ''
  await loadOperatorUsers()
}

async function loadOperatorUsers() {
  if (!userStore.accountSetId) return
  operatorLoading.value = true
  try {
    const res = await getUsersByAccountSet(userStore.accountSetId)
    operatorUsers.value = res.data || []
  } catch (error) {
    console.error('加载操作员列表失败:', error)
    ElMessage.error('加载操作员列表失败')
  } finally {
    operatorLoading.value = false
  }
}

function resetSwitchOperatorForm() {
  switchOperatorForm.value.password = ''
  switchOperatorFormRef.value?.clearValidate()
}

async function confirmSwitchOperator() {
  await switchOperatorFormRef.value?.validate()
  switchOperatorLoading.value = true
  try {
    const res = await switchOperator({
      username: switchOperatorForm.value.username,
      password: switchOperatorForm.value.password,
    })
    userStore.applyLoginResponse(res)
    switchOperatorVisible.value = false
    ElMessage.success(`已切换为操作员：${res.user.nickname || res.user.username}`)
    await reloadCurrentView()
  } catch (error: any) {
    const response = error?.response?.data
    if (response?.code === 40901) {
      const ip = response.data?.activeLoginIp || response.data?.activeLoginAt || '其他终端'
      try {
        await ElMessageBox.confirm(
          `该操作员已在 ${ip} 登录，是否强制登录并切换到当前电脑？`,
          '确认强制登录',
          {
            confirmButtonText: '强制登录',
            cancelButtonText: '取消',
            type: 'warning',
          }
        )
        const forced = await switchOperator({
          username: switchOperatorForm.value.username,
          password: switchOperatorForm.value.password,
          forceLogin: true,
        })
        userStore.applyLoginResponse(forced)
        switchOperatorVisible.value = false
        ElMessage.success(`已切换为操作员：${forced.user.nickname || forced.user.username}`)
        await reloadCurrentView()
      } catch (confirmError: any) {
        if (confirmError !== 'cancel') {
          ElMessage.error(confirmError?.response?.data?.message || confirmError?.message || '切换操作员失败')
        }
      }
    } else {
      ElMessage.error(response?.message || error?.message || '切换操作员失败')
    }
  } finally {
    switchOperatorLoading.value = false
  }
}

async function reloadCurrentView() {
  await systemParamsStore.load()
  await fetchReportTemplates()
  const home = getDefaultLandingPath(
    userStore.permissions,
    systemParamsStore.enableCashFlow,
    licenseStore.modules,
    loadHomePage(userStore.userInfo?.username || '', userStore.accountSetId || '')
  )
  const target = canAccessRoute(route.fullPath, userStore.permissions, licenseStore.modules)
    ? route.fullPath
    : home
  await router.replace(target)
}
</script>

<style scoped>
.rail-context-mask {
  position: fixed;
  inset: 0;
  z-index: 3000;
}

.rail-context-menu {
  position: fixed;
  min-width: 148px;
  margin: 0;
  padding: 4px 0;
  list-style: none;
  background: var(--el-bg-color-overlay, #fff);
  border: 1px solid var(--el-border-color-light, #e4e7ed);
  border-radius: 6px;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.12);
  font-size: 13px;
}

.rail-context-menu__item {
  padding: 7px 14px;
  cursor: pointer;
  color: var(--el-text-color-primary, #303133);
  white-space: nowrap;
}

.rail-context-menu__item:hover {
  background: var(--el-fill-color-light, #f5f7fa);
}
</style>

<style>
@import './Layout.styles.css';
</style>
