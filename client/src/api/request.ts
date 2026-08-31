import axios, { type AxiosRequestConfig } from 'axios'
import { ElMessage } from 'element-plus'
import { ApiResponse } from '@cw/shared-types'
import { getStateErrorMessage, readStateError } from '@/utils/stateRecovery'

export type RequestConfig = AxiosRequestConfig & {
  /** 为 true 时不弹出全局错误提示（由调用方自行处理） */
  skipErrorToast?: boolean
  /** 为 true 时收到 401 不自动跳登录页（如切换操作员场景，密码错误应停留在当前对话框） */
  skipAuthRedirect?: boolean
  /** 为 true 时收到 402 不自动跳激活页（激活页自身请求） */
  skipLicenseRedirect?: boolean
}

const instance = axios.create({
  baseURL: '/api',
  timeout: 120_000,
})

instance.interceptors.request.use(
  config => {
    const token = localStorage.getItem('token')
    if (token) {
      config.headers.Authorization = `Bearer ${token}`
    }
    const accountSetId = localStorage.getItem('accountSetId')
    if (accountSetId) {
      config.headers['X-AccountSet-Id'] = accountSetId
    }
    return config
  },
  error => Promise.reject(error)
)

// 防止重复跳转
let isRedirecting = false
let isPermissionRedirecting = false
let isLicenseRedirecting = false

/** 401 中属于「会话失效需重新登录」的场景（排除登录页凭据错误） */
function isSessionAuthFailure(code: number | undefined, responseMessage: string | undefined): boolean {
  if (code === 40101) return true
  const msg = responseMessage ?? ''
  if (msg.includes('密码错误') || msg.includes('用户名或密码') || msg.includes('操作员或密码')) {
    return false
  }
  return (
    code === 401 &&
    (msg.includes('未登录') ||
      msg.includes('登录已过期') ||
      msg.includes('登录已失效') ||
      msg.includes('Token') ||
      msg.includes('账号已在其他地方登录'))
  )
}

// 错误码映射
const ERROR_MESSAGES: Record<number, string> = {
  400: '请求参数错误',
  401: '未授权，请重新登录',
  403: '无权限访问',
  404: '请求的资源不存在',
  413: '请求数据过大',
  500: '服务器内部错误',
  502: '网关错误',
  503: '服务暂时不可用',
  504: '网关超时',
}

instance.interceptors.response.use(
  response => response.data as any,
  error => {
    const config = (error.config || {}) as RequestConfig
    const status = error.response?.status
    const code = error.response?.data?.code
    const responseMessage = error.response?.data?.message
    const skipErrorToast = config.skipErrorToast === true
    const skipLicenseRedirect = config.skipLicenseRedirect === true
    const stateError = readStateError(error)

    if (stateError) {
      if (!skipErrorToast) ElMessage.warning(getStateErrorMessage(stateError))
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('cw:state-error', { detail: stateError }))
      }
      return Promise.reject(error)
    }

    // 请求超时（大批量操作常见）
    if (error.code === 'ECONNABORTED') {
      if (!skipErrorToast) {
        ElMessage.error('请求超时，数据量较大时请稍候刷新页面查看结果')
      }
      return Promise.reject(error)
    }

    // 402 软件授权失效（排除后端重启等瞬时 5xx/网络错误）
    if (status === 402 || code === 40201 || code === 40202 || code === 40205) {
      if (!skipLicenseRedirect && !isLicenseRedirecting) {
        isLicenseRedirecting = true
        const licenseMsg = responseMessage || '软件未授权或授权已过期'
        ElMessage.warning(licenseMsg)
        void import('@/stores/license').then(({ useLicenseStore }) => {
          useLicenseStore().invalidate()
        })
        void import('@/router').then(({ default: router }) => {
          if (router.currentRoute.value.path !== '/activate') {
            router.replace('/activate')
          }
          isLicenseRedirecting = false
        })
      }
      return Promise.reject(error)
    }

    // 401 未授权 - 仅真正的认证失败才清除登录信息并跳转
    if (status === 401) {
      // 调用方显式声明 skipAuthRedirect 时，由调用方自行处理（如切换操作员密码错误不踢到登录页）
      if (config.skipAuthRedirect) {
        return Promise.reject(error)
      }
      // 数据库繁忙等瞬时错误不应踢出登录（auth 中间件已改为 503，此处保留防御）
      const isAuthFailure = isSessionAuthFailure(code, responseMessage)
      if (!isAuthFailure) {
        if (!skipErrorToast) {
          ElMessage.error(responseMessage || ERROR_MESSAGES[401])
        }
        return Promise.reject(error)
      }
      if (!isRedirecting) {
        isRedirecting = true
        ElMessage.warning(code === 40101 ? responseMessage || '账号已在其他地方登录，请重新登录' : '登录已过期，请重新登录')
        void import('@/stores/user').then(({ useUserStore }) => {
          useUserStore().logout()
        })
        void import('@/router').then(({ default: router }) => {
          const redirect = router.currentRoute.value.path
          if (redirect !== '/login') {
            router.replace('/login')
          }
          isRedirecting = false
        })
      }
      return Promise.reject(error)
    }

    if (status === 409 && code === 40901) {
      return Promise.reject(error)
    }

    // 403：路由/功能权限不足时静默跳转可访问首页；业务类 403（如科目授权）仍提示
    if (status === 403) {
      void (async () => {
        const { isApiRoutePermissionDenied } = await import('@/config/navigation')
        if (!isApiRoutePermissionDenied(responseMessage)) {
          if (!skipErrorToast) {
            ElMessage.error(responseMessage || ERROR_MESSAGES[403])
          }
          return
        }
        if (isPermissionRedirecting) return
        isPermissionRedirecting = true
        try {
          const { useUserStore } = await import('@/stores/user')
          const { useSystemParamsStore } = await import('@/stores/systemParams')
          const { getDefaultLandingPath, canAccessRoute } = await import('@/config/navigation')
          const router = (await import('@/router')).default
          const userStore = useUserStore()
          const systemParamsStore = useSystemParamsStore()
          // 跳转前用最新权限复核：前端权限快照可能因 bootstrap/切换账套竞态而过期，
          // 直接拿旧快照判断会把正在进入的页面误踢回首页（第一次失败第二次成功）。
          // 先刷新一次权限，确认确实无权限再跳转。
          try {
            await userStore.fetchUserInfo()
          } catch {
            /* 刷新失败（网络抖动等）则沿用现有权限判断，不阻断跳转逻辑 */
          }
          await systemParamsStore.load()
          const landing = getDefaultLandingPath(
            userStore.permissions,
            systemParamsStore.enableCashFlow
          )
          const current = router.currentRoute.value.path
          if (!canAccessRoute(current, userStore.permissions) && current !== landing) {
            await router.replace(landing)
          }
        } finally {
          isPermissionRedirecting = false
        }
      })()
      return Promise.reject(error)
    }

    // 404 资源不存在
    if (status === 404) {
      if (!skipErrorToast) {
        ElMessage.error(responseMessage || ERROR_MESSAGES[404])
      }
      return Promise.reject(error)
    }

    // 413 请求体过大
    if (status === 413) {
      if (!skipErrorToast) {
        ElMessage.error(responseMessage || ERROR_MESSAGES[413])
      }
      return Promise.reject(error)
    }

    // 500+ 服务器错误
    if (status && status >= 500) {
      if (!skipErrorToast) {
        ElMessage.error(responseMessage || ERROR_MESSAGES[status] || '服务器错误')
      }
      return Promise.reject(error)
    }

    // 其他错误（包括 400）
    const msg = responseMessage || ERROR_MESSAGES[status || 0] || error.message || '网络错误'
    if (!skipErrorToast) {
      ElMessage.error(msg)
    }
    return Promise.reject(error)
  }
)

// 通用请求方法（返回 code/data/total/summary）
const request = {
  get<T = unknown>(url: string, config?: RequestConfig): Promise<ApiResponse<T>> {
    return instance.get(url, config as never) as unknown as Promise<ApiResponse<T>>
  },
  post<T = unknown>(url: string, data?: unknown, config?: RequestConfig): Promise<ApiResponse<T>> {
    return instance.post(url, data, config as never) as unknown as Promise<ApiResponse<T>>
  },
  put<T = unknown>(url: string, data?: unknown, config?: RequestConfig): Promise<ApiResponse<T>> {
    return instance.put(url, data, config as never) as unknown as Promise<ApiResponse<T>>
  },
  patch<T = unknown>(url: string, data?: unknown, config?: RequestConfig): Promise<ApiResponse<T>> {
    return instance.patch(url, data, config as never) as unknown as Promise<ApiResponse<T>>
  },
  delete<T = unknown>(url: string, config?: RequestConfig): Promise<ApiResponse<T>> {
    return instance.delete(url, config as never) as unknown as Promise<ApiResponse<T>>
  },
  /** 下载二进制文件（如 Excel 导出），返回 Blob */
  download(url: string, config?: { params?: Record<string, unknown> }): Promise<Blob> {
    return instance.get(url, { ...config, responseType: 'blob' } as never) as unknown as Promise<Blob>
  },
  /** POST 方式下载二进制文件（大数据量导出，参数体较大时使用），返回 Blob */
  downloadPost(url: string, data?: unknown, config?: RequestConfig): Promise<Blob> {
    return instance.post(url, data, {
      ...(config as object),
      responseType: 'blob',
    } as never) as unknown as Promise<Blob>
  },
}

export default request
