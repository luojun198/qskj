import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import axios from 'axios'
import { login, getUserInfo } from '@/api/auth'
import type { LoginForm } from '@/api/auth'
import type { ApiResponse, LoginResponse, UserInfo } from '@cw/shared-types'
import { useSystemParamsStore } from './systemParams'

function isAuthFailure(error: unknown): boolean {
  if (!axios.isAxiosError(error)) return false
  const status = error.response?.status
  if (status !== 401) return false
  const code = error.response?.data?.code as number | undefined
  const message = error.response?.data?.message as string | undefined
  if (code === 40101) return true
  if (message?.includes('密码错误') || message?.includes('用户名或密码') || message?.includes('操作员或密码')) {
    return false
  }
  return (
    code === 401 &&
    (!!message?.includes('未登录') ||
      !!message?.includes('登录已过期') ||
      !!message?.includes('登录已失效') ||
      !!message?.includes('Token') ||
      !!message?.includes('账号已在其他地方登录'))
  )
}

function extractUserInfo(res: ApiResponse<UserInfo>): UserInfo {
  if (res.data) return res.data
  const { code: _code, message: _message, total: _total, summary: _summary, ...rest } = res
  return rest as UserInfo
}

export const useUserStore = defineStore('user', () => {
  const token = ref(localStorage.getItem('token') || '')
  const userInfo = ref<UserInfo | null>(null)
  const accountSetId = ref<string>(localStorage.getItem('accountSetId') || '')
  const accountSetName = ref<string>(localStorage.getItem('accountSetName') || '')
  const currentYear = ref<number>(new Date().getFullYear())
  const rememberMe = ref(localStorage.getItem('rememberMe') === 'true')
  const permissions = ref<string[]>(JSON.parse(localStorage.getItem('permissions') || '[]'))
  const accountScopeRestricted = ref(
    localStorage.getItem('accountScopeRestricted') === 'true'
  )
  const allowedAccountIds = ref<string[]>(
    JSON.parse(localStorage.getItem('allowedAccountIds') || '[]')
  )
  const authBootstrapped = ref(false)

  const isLoggedIn = computed(() => !!token.value)

  function resetAccountContextStores() {
    useSystemParamsStore().reset()
  }

  function applyAccountScopeFromInfo(info: UserInfo) {
    accountScopeRestricted.value = !!info.account_scope_restricted
    allowedAccountIds.value = info.allowed_account_ids || []
    localStorage.setItem('accountScopeRestricted', String(accountScopeRestricted.value))
    localStorage.setItem('allowedAccountIds', JSON.stringify(allowedAccountIds.value))
  }

  function clearSession() {
    token.value = ''
    userInfo.value = null
    accountSetId.value = ''
    accountSetName.value = ''
    permissions.value = []
    accountScopeRestricted.value = false
    allowedAccountIds.value = []
    authBootstrapped.value = false
    localStorage.removeItem('token')
    localStorage.removeItem('accountSetId')
    localStorage.removeItem('accountSetName')
    localStorage.removeItem('permissions')
    localStorage.removeItem('accountScopeRestricted')
    localStorage.removeItem('allowedAccountIds')
    localStorage.removeItem('userInfo')
    resetAccountContextStores()
  }

  /** 启动时校验 token，避免无效 token 先进入主页再被 401 踢回登录页 */
  async function bootstrapAuth(): Promise<boolean> {
    if (authBootstrapped.value) {
      return !!token.value
    }
    if (!token.value) {
      authBootstrapped.value = true
      return false
    }
    try {
      const res = await getUserInfo({ skipAuthRedirect: true, skipErrorToast: true })
      const info = extractUserInfo(res)
      userInfo.value = info
      permissions.value = info.permissions || []
      localStorage.setItem('permissions', JSON.stringify(permissions.value))
      applyAccountScopeFromInfo(info)
      authBootstrapped.value = true
      return true
    } catch (error) {
      if (isAuthFailure(error)) {
        clearSession()
        authBootstrapped.value = true
        return false
      }
      // 网络抖动或后端重启：保留 token，使用本地缓存权限，避免 F5 误登出
      permissions.value = JSON.parse(localStorage.getItem('permissions') || '[]')
      authBootstrapped.value = true
      return true
    }
  }

  async function loginAction(form: LoginForm) {
    const res = (await login(form)) as LoginResponse
    applyLoginResponse(res)
    return res
  }

  function applyLoginResponse(res: LoginResponse) {
    token.value = res.token
    userInfo.value = res.user as UserInfo
    accountSetId.value = res.accountSetId || res.user.accountSetId || ''
    accountSetName.value = res.accountSetName || res.user.accountSetName || ''
    permissions.value = res.user.permissions || []
    applyAccountScopeFromInfo(res.user as UserInfo)
    localStorage.setItem('token', res.token)
    localStorage.setItem('permissions', JSON.stringify(res.user.permissions || []))
    if (res.accountSetId || res.user.accountSetId) {
      localStorage.setItem('accountSetId', res.accountSetId || res.user.accountSetId)
    }
    if (res.accountSetName || res.user.accountSetName) {
      localStorage.setItem('accountSetName', res.accountSetName || res.user.accountSetName)
    }
    resetAccountContextStores()
    // 登录响应已包含用户信息，避免切换账套后立即 bootstrap 再发一轮 /userinfo
    authBootstrapped.value = true
  }

  async function fetchUserInfo() {
    if (!token.value) return
    const res = await getUserInfo()
    const info = extractUserInfo(res)
    userInfo.value = info
    permissions.value = info.permissions || []
    localStorage.setItem('permissions', JSON.stringify(info.permissions || []))
    applyAccountScopeFromInfo(info)
  }

  function logout() {
    token.value = ''
    userInfo.value = null
    accountSetId.value = ''
    accountSetName.value = ''
    rememberMe.value = false
    permissions.value = []
    accountScopeRestricted.value = false
    allowedAccountIds.value = []
    authBootstrapped.value = false
    localStorage.removeItem('token')
    localStorage.removeItem('accountSetId')
    localStorage.removeItem('accountSetName')
    localStorage.removeItem('rememberMe')
    localStorage.removeItem('permissions')
    localStorage.removeItem('accountScopeRestricted')
    localStorage.removeItem('allowedAccountIds')
    resetAccountContextStores()
  }

  function setAccountSet(id: string, name: string, newToken?: string) {
    accountSetId.value = id
    accountSetName.value = name
    localStorage.setItem('accountSetId', id)
    localStorage.setItem('accountSetName', name)
    if (newToken) {
      token.value = newToken
      localStorage.setItem('token', newToken)
    }
  }

  return {
    token,
    userInfo,
    accountSetId,
    accountSetName,
    currentYear,
    rememberMe,
    permissions,
    accountScopeRestricted,
    allowedAccountIds,
    isLoggedIn,
    authBootstrapped,
    loginAction,
    applyLoginResponse,
    bootstrapAuth,
    fetchUserInfo,
    logout,
    setAccountSet,
  }
})
