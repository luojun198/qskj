<template>
  <el-container class="layout-container apple-layout">
    <!-- 侧边栏 - 苹果风格 -->
    <el-aside :width="isCollapsed ? '72px' : '240px'" class="aside">
      <!-- Logo -->
      <div
        class="logo"
        :class="{ 'logo--collapsed': isCollapsed }"
        title="回到首页"
        @click="goToHome"
      >
        <div class="logo-brand">
          <div class="logo-icon">
            <img :src="brandingStore.logoSrc" :alt="brandingStore.title" class="logo-img" />
          </div>
          <div v-show="!isCollapsed" class="logo-text-wrap">
            <span class="logo-text">{{ brandingStore.title }}</span>
            <span class="logo-sub">
              {{ brandingStore.subtitle }}
              <span v-if="appVersion" class="logo-version">v{{ appVersion }}</span>
            </span>
          </div>
        </div>
      </div>

      <!-- 菜单 -->
      <el-menu
        :default-active="activeMenu"
        :collapse="isCollapsed"
        background-color="transparent"
        text-color="#4a4a4a"
        active-text-color="#12C7AE"
        popper-class="apple-menu-popper"
        popper-effect="light"
        router
        unique-opened
        class="apple-menu"
      >
        <el-sub-menu
          v-for="group in menuGroups"
          :key="group.title === '报表管理' ? `report-${reportMenuRevision}` : group.title"
          :index="group.title"
          :class="{ 'sub-menu-current': currentGroupTitle === group.title }"
        >
          <template #title>
            <div
              class="menu-title-inner"
              style="width: 100%; height: 100%; display: flex; align-items: center;"
              @mouseenter="preloadMenuGroup(group)"
              @click="handleGroupTitleClick(group)"
            >
              <div class="menu-icon-wrap">
                <component :is="group.icon" />
              </div>
              <span class="menu-title-label">{{ group.title }}</span>
            </div>
          </template>
          <template v-if="group.subGroups">
            <el-menu-item v-for="item in group.children" :key="item.path" :index="item.path" @mouseenter="preloadMenuPath(item.path)" @focus="preloadMenuPath(item.path)">
              <span class="menu-item-content"><span class="menu-item-label">{{ item.title }}</span></span>
            </el-menu-item>
            <el-sub-menu v-for="sg in group.subGroups" :key="sg.label" :index="`${group.title}__${sg.label}`">
              <template #title><span>{{ sg.label }}</span></template>
              <el-menu-item v-for="item in sg.items" :key="item.path" :index="item.path" @mouseenter="preloadMenuPath(item.path)" @focus="preloadMenuPath(item.path)">
                <span class="menu-item-content"><span class="menu-item-label">{{ item.title }}</span></span>
              </el-menu-item>
            </el-sub-menu>
          </template>
          <el-menu-item-group v-else class="menu-popup-group">
            <template #title>
              <span class="menu-popup-group-title">{{ group.title }}</span>
            </template>
            <el-menu-item v-for="item in group.children" :key="item.path" :index="item.path" @mouseenter="preloadMenuPath(item.path)" @focus="preloadMenuPath(item.path)">
              <span class="menu-item-content">
                <span class="menu-item-label">{{ item.title }}</span>
              </span>
            </el-menu-item>
          </el-menu-item-group>
        </el-sub-menu>
      </el-menu>

      <!-- 底部折叠按钮 -->
      <div class="aside-footer">
        <button
          class="collapse-btn"
          :title="isCollapsed ? '展开菜单' : '收起菜单'"
          @click="isCollapsed = !isCollapsed"
        >
          <svg v-if="isCollapsed" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M9 18l6-6-6-6"/>
          </svg>
          <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M15 18l-6-6 6-6"/>
          </svg>
        </button>
      </div>
    </el-aside>

    <el-container>
      <!-- 顶栏 - 苹果风格 -->
      <el-header class="header">
        <div class="header-left">
          <el-breadcrumb separator="/" class="apple-breadcrumb">
            <el-breadcrumb-item v-if="currentParent">
              <a class="breadcrumb-link" @click="navigateToModuleHome">{{ currentParent }}</a>
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
import { buildMenuGroups, canAccessRoute, getDefaultLandingPath, type NavGroup } from '@/config/navigation'
import { useBrandingStore } from '@/stores/branding'
import { useAppBuildInfo } from '@/composables/useAppBuildInfo'
import TabsBar from '@/components/layout/TabsBar.vue'
import { useTabsStore } from '@/stores/tabs'
import { getTabPolicy, getViewKey as getViewKeyUtil } from '@/utils/viewKey'
import { DOC_TITLE } from '@/utils/scmDoc'
import { shouldUseLightMode, setPerformanceMode } from '@/utils/performanceMode'
import { getGroupNavigationPath } from '@/utils/groupNavigation'

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
  if (!canAccessRoute('/scm/docs', userStore.permissions)) return null
  if (scmDocListPreload) return scmDocListPreload
  scmDocListPreload = import('@/views/scm/DocList.vue').catch(error => {
    scmDocListPreload = null
    console.warn('预加载供应链单据列表失败:', error)
  })
  return scmDocListPreload
}

function preloadScmDocForm() {
  if (!canAccessRoute('/scm/docs', userStore.permissions)) return null
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

function preloadMenuPath(path: string) {
  if (path.split('?')[0] !== '/scm/docs') return
  // 用户已经移到具体单据入口时，同时预取新增/编辑表单，消除第一次点“新增单据”的组件解析等待。
  preloadScmDocList()
  preloadScmDocForm()
}

function preloadMenuGroup(group: NavGroup) {
  const items = [
    ...group.children,
    ...(group.subGroups?.flatMap(subGroup => subGroup.items) || []),
  ]
  if (items.some(item => item.path.split('?')[0] === '/scm/docs')) preloadScmDocList()
}

onMounted(() => {
  // initTheme()
  void systemParamsStore.load()
  void brandingStore.load()
  const requestIdle = (window as any).requestIdleCallback as typeof window.requestIdleCallback | undefined
  if (typeof requestIdle === 'function') {
    requestIdle(preloadScmEntryChain, { timeout: 2000 })
  } else {
    globalThis.setTimeout(preloadScmEntryChain, 800)
  }
})

const dynamicReportMenuItems = ref<{ path: string; title: string }[]>([])
const reportMenuRevision = ref(0)

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
  reportMenuRevision.value += 1
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

const isCollapsed = ref(false)
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
    key: 'F12',
    shift: true,
    handler: () => {
      router.push('/base/keyboard-shortcuts')
    },
    description: 'Shift+F12 打开快捷键维护',
  },
])

function goToHome() {
  router.push(getDefaultLandingPath(userStore.permissions, systemParamsStore.enableCashFlow))
}

const landingPath = computed(() =>
  getDefaultLandingPath(userStore.permissions, systemParamsStore.enableCashFlow)
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

function handleGroupTitleClick(group: NavGroup) {
  preloadMenuGroup(group)
  const target = getGroupNavigationPath(group.title)
  if (route.path !== target) {
    void router.push(target)
  }
}

function navigateToModuleHome() {
  if (currentParent.value) {
    router.push(getGroupNavigationPath(currentParent.value))
  }
}

const menuGroups = computed(() =>
  buildMenuGroups(
    userStore.permissions,
    systemParamsStore.enableCashFlow,
    dynamicReportMenuItems.value.map(t => ({
      path: t.path,
      title: t.title,
      permission: 'report:view',
    }))
  )
)

provide('layoutMenuGroups', menuGroups)

/** 当前所在的分组导航页（/group/:groupTitle），用于让对应分组标题高亮为金色 + 👉 */
const currentGroupTitle = computed(() =>
  route.name === 'GroupNav' ? String(route.params.groupTitle || '') : ''
)
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
    const g = String(r.params?.groupTitle || '').trim()
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
  const all = menuGroups.value.flatMap(g => [
    ...g.children,
    ...(g.subGroups?.flatMap(sg => sg.items) ?? []),
  ].map(c => ({ ...c, group: g.title })))
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

// 菜单项可能通过查询参数承载不同业务入口（如预收/预付核销），
// 高亮必须使用匹配到的完整菜单地址，不能只使用 route.path。
const activeMenu = computed(() => currentListItem.value?.path || route.path)
const currentTitle = computed(() => currentListItem.value?.title || (route.meta?.title as string) || '')
const currentParent = computed(() => currentListItem.value?.group || '')

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
  const home = getDefaultLandingPath(userStore.permissions, systemParamsStore.enableCashFlow)
  const target = canAccessRoute(route.path, userStore.permissions) ? route.fullPath : home
  await router.replace(target)
}
</script>

<style>
@import './Layout.styles.css';
</style>
