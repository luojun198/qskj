import axios from 'axios'
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import {
  activateLicense as activateLicenseApi,
  getLicenseStatus,
  type LicenseStatus,
} from '@/api/license'

const EMPTY_STATUS: LicenseStatus = {
  activated: false,
  expired: false,
  expiresAt: null,
  daysRemaining: 0,
  machineId: '',
  machineMismatch: false,
}

const LICENSE_STATUS_CACHE_KEY = 'cw_license_status_v1'
const LICENSE_FETCH_RETRIES = 3
const LICENSE_FETCH_RETRY_DELAY_MS = 400

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function isValidStatus(data: LicenseStatus) {
  return data.activated && !data.expired && !data.machineMismatch
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

  function apply(data: LicenseStatus) {
    status.value = { ...EMPTY_STATUS, ...data }
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
      return loadStatus(true)
    }
    if (isValid.value) {
      void loadStatus(true).catch(() => {})
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
    loadStatus,
    ensureStatus,
    activate,
    invalidate,
    apply,
  }
})
