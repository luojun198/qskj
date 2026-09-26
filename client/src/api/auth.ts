import request, { type RequestConfig } from './request'
import type { ApiResponse, LoginResponse, CaptchaResponse, UserInfo } from '@cw/shared-types'

export interface AccountSetItem {
  id: string
  name: string
  code: string
}

export function getAccountSets(config?: {
  silent?: boolean
}): Promise<ApiResponse<AccountSetItem[]>> {
  return request.get('/auth/account-sets', {
    skipErrorToast: config?.silent,
  })
}

export interface UserItem {
  username: string
  nickname: string
}

export function getUsersByAccountSet(
  accountSetId: string,
  config?: { silent?: boolean }
): Promise<ApiResponse<UserItem[]>> {
  return request.get(`/auth/users-by-account-set/${encodeURIComponent(accountSetId)}`, {
    skipErrorToast: config?.silent,
  })
}

export interface LoginForm {
  username: string
  password: string
  captcha?: string
  captchaId?: string
  targetAccountSetId?: string
  forceLogin?: boolean
  /** 记住登录：JWT 与 Session 有效期延长至 7 天 */
  rememberMe?: boolean
}

export function login(data: LoginForm): Promise<LoginResponse> {
  return request.post('/auth/login', data) as unknown as Promise<LoginResponse>
}

export function getUserInfo(config?: RequestConfig): Promise<ApiResponse<UserInfo>> {
  return request.get('/auth/userinfo', config)
}

export function getCaptcha(): Promise<CaptchaResponse> {
  return request.get('/auth/captcha') as unknown as Promise<CaptchaResponse>
}

export function logout(): Promise<ApiResponse<null>> {
  return request.post('/auth/logout')
}

export interface SwitchAccountSetResponse {
  code: number
  message: string
  username: string
  accountSetId: string
  accountSetName: string
}

export function switchAccountSet(accountSetId: string): Promise<SwitchAccountSetResponse> {
  return request.post('/auth/switch-account-set', {
    account_set_id: accountSetId,
  }) as unknown as Promise<SwitchAccountSetResponse>
}

export interface SwitchOperatorForm {
  username: string
  password: string
  forceLogin?: boolean
}

export function switchOperator(data: SwitchOperatorForm): Promise<LoginResponse> {
  // 密码错误时后端返回 401，但此场景应停留在切换对话框由调用方提示错误，不应跳登录页
  return request.post('/auth/switch-operator', data, {
    skipAuthRedirect: true,
    skipErrorToast: true,
  }) as unknown as Promise<LoginResponse>
}

export interface BackupImportResult {
  id: string
  name: string
  code: string
  fiscal_year: number
  backupAccountSetName: string | null
  imported: {
    accounts: number
    vouchers: number
    entries: number
    initBalances?: number
    users?: number
  }
}

export function backupImport(
  file: File,
  name: string
): Promise<ApiResponse<BackupImportResult>> {
  const formData = new FormData()
  formData.append('file', file)
  formData.append('name', name)
  return request.post('/auth/backup-import', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    // 大账套（10 万级凭证）导入需数十秒
    timeout: 600_000,
  })
}

export interface AcdImportResult {
  id: string
  name: string
  code: string
  fiscal_year: number
  imported: {
    accounts: number
    initBalances: number
    transferTypes: number
    transferItems: number
    vouchers: number
    voucherEntries: number
    reportDefinitions: number
    standardReports: number
  }
  warnings: string[]
}

export function acdImport(
  file: File,
  name: string
): Promise<ApiResponse<AcdImportResult>> {
  const formData = new FormData()
  formData.append('file', file)
  formData.append('name', name)
  return request.post('/auth/acd-import', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
}
