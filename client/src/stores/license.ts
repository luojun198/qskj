import axios from 'axios'
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import {
  activateLicense as activateLicenseApi,
  getLicenseStatus,
  type LicenseStatus,
} from '@/api/license'
import { hasLicensedModule, type LicenseModuleKey } from '@/config/licenseModules'

const EMPTY_STATUS: LicenseStatus = {
  activated: false,
  expired: false,
  expiresAt: null,
  daysRemaining: 0,
  machineId: '',
  machineMismatch: false,
  modules: [],
  maxConcurrent: 0,
  onlineCount: 0,
}

const LICENSE_STATUS_CACHE_KEY = 'cw_license_status_v2'
const LICENSE_FETCH_RETRIES = 3
const LICENSE_FETCH_RETRY_DELAY_MS = 400
/** 已激活时后台刷新授权状态的最小间隔，避免每次路由切换都打一次接口 */
const BACKGROUND_REFRESH_INTERVAL_MS = 5 * 60 * 1000

let lastBackgroundRefreshAt = 0

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function isValidStatus(data: LicenseStatus) {
  return data.activated && !data.expired && !data.machineMismatch && Array.isArray(data.modules)
}

/** 后端重启/网络抖动等瞬时故障，不应误判为未激活 */
function isTransientLicenseFetchError(error: unknown) {
  if (!axios.isAxiosError(error)) return true
  if (!error.response) return true
  const status = error.response.status
  return status === 408 || status === 429 || status >= 500
}

function readCachedStatus(): LicenseStatus | null {
  try {
    const raw = sessionStorage.getItem(LICENSE_STATUS_CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as LicenseStatus
    return isValidStatus(parsed) ? parsed : null
  } catch {
    return null
  }
}

function writeCachedStatus(data: LicenseStatus) {
  if (!isValidStatus(data)) return
  try {
    sessionStorage.setItem(LICENSE_STATUS_CACHE_KEY, JSON.stringify(data))
  } catch {
    /* ignore quota / private mode */
  }
}

function clearCachedStatus() {
  try {
    sessionStorage.removeItem(LICENSE_STATUS_CACHE_KEY)
  } catch {
    /* ignore */
  }
}

export const useLicenseStore = defineStore('license', () => {
  const loaded = ref(false)
  const transientLoadError = ref(false)
  const status = ref<LicenseStatus>({ ...EMPTY_STATUS })

  const isValid = computed(() => isValidStatus(status.value))

  const needsActivation = computed(
    () => !status.value.activated || status.value.expired || status.value.machineMismatch
  )

  /** 已授权模块列表（未激活时为空） */
  const modules = computed<LicenseModuleKey[]>(() => status.value.modules || [])

  function hasModule(required: LicenseModuleKey | LicenseModuleKey[]): boolean {
    return hasLicensedModule(modules.value, required)
  }

  function apply(data: LicenseStatus) {
    status.value = { ...EMPTY_STATUS, ...data, modules: Array.isArray(data.modules) ? data.modules : [] }
    loaded.value = true
    transientLoadError.value = false
    if (isValidStatus(status.value)) {
      writeCachedStatus(status.value)
    } else if (!status.value.activated || status.value.expired || status.value.machineMismatch) {
      clearCachedStatus()
    }
  }

  function invalidate() {
    status.value = {
      ...status.value,
      expired: true,
    }
    loaded.value = true
    transientLoadError.value = false
    clearCachedStatus()
  }

  function restoreFromCacheOrMemory() {
    const cached = readCachedStatus()
    if (cached) {
      apply(cached)
      transientLoadError.value = true
      return true
    }
    if (loaded.value && isValid.value) {
      transientLoadError.value = true
      return true
    }
    return false
  }

  async function loadStatus(force = false) {
    if (loaded.value && !force) return status.value

    let lastError: unknown
    for (let attempt = 0; attempt < LICENSE_FETCH_RETRIES; attempt++) {
      try {
        const res = await getLicenseStatus()
        apply(res.data || { ...EMPTY_STATUS })
        return status.value
      } catch (error) {
        lastError = error
        if (isTransientLicenseFetchError(error) && attempt < LICENSE_FETCH_RETRIES - 1) {
          await sleep(LICENSE_FETCH_RETRY_DELAY_MS * (attempt + 1))
          continue
        }
        break
      }
    }

    if (isTransientLicenseFetchError(lastError) && restoreFromCacheOrMemory()) {
      return status.value
    }

    transientLoadError.value = false
    apply({ ...EMPTY_STATUS })
    return status.value
  }

  /** 路由守卫：已激活时不阻塞导航；仅在未加载或授权无效时强制拉取 */
  async function ensureStatus(options?: { force?: boolean }) {
    if (options?.force || !loaded.value) {
      lastBackgroundRefreshAt = Date.now()
      return loadStatus(true)
    }
    if (isValid.value) {
      // 后台刷新做节流：这个守卫每次导航都会跑，原来等于每切一个页面
      // 就打一次 /license/status，白白占着切换时最忙的那一段。
      const now = Date.now()
      if (now - lastBackgroundRefreshAt >= BACKGROUND_REFRESH_INTERVAL_MS) {
        lastBackgroundRefreshAt = now
        void loadStatus(true).catch(() => {})
      }
      return status.value
    }
    return loadStatus(true)
  }

  async function activate(code: string) {
    const res = await activateLicenseApi(code)
    await loadStatus(true)
    return res.data
  }

  return {
    loaded,
    transientLoadError,
    status,
    isValid,
    needsActivation,
    modules,
    hasModule,
    loadStatus,
    ensureStatus,
    activate,
    invalidate,
    apply,
  }
})
