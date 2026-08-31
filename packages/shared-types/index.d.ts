export interface ApiResponse<T = unknown> {
  code: number
  message?: string
  data: T
  total?: number
  summary?: Record<string, unknown>
}

export interface LoginResponse {
  code: number
  token: string
  message?: string
  user: UserInfo
  accountSetId?: string
  accountSetName?: string
  lastLoginTime?: string | null
  lastLoginIp?: string | null
  currentLoginIp?: string
  forcedLogin?: boolean
  forcedOldLoginIp?: string | null
}

export interface UserInfo {
  id: string
  username: string
  nickname: string
  role: string
  roleName: string
  accountSetId: string
  accountSetName: string
  permissions?: string[]
  account_scope_restricted?: boolean
  allowed_account_ids?: string[]
}

export interface CaptchaResponse {
  code: number
  captchaId: string
  captchaUrl: string
}
