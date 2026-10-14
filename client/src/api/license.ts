import request from './request'
import type { LicenseModuleKey } from '@/config/licenseModules'

export interface LicenseStatus {
  activated: boolean
  expired: boolean
  expiresAt: string | null
  daysRemaining: number
  machineId: string
  machineMismatch: boolean
  /** 已授权模块（后端已展开，不含 '*'） */
  modules: LicenseModuleKey[]
  /** 最大并发在线人数；0 = 不限制 */
  maxConcurrent: number
  /** 当前在线人数 */
  onlineCount: number
}

export interface LicenseActivateResult {
  expiresAt: string
  modules: LicenseModuleKey[]
  maxConcurrent: number
}

export interface LicenseOnlineUser {
  userId: string
  username: string
  loginIp: string | null
  loginAt: string
  lastSeenAt: string
}

export interface LicenseLogEntry {
  id: number
  machineId: string
  expiresAt: string
  modules: LicenseModuleKey[]
  maxConcurrent: number
  issuedAt: string | null
  operator: string | null
  createdAt: string
}

export interface LicenseInfo {
  status: LicenseStatus
  onlineWindowMinutes: number
  online: LicenseOnlineUser[]
  history: LicenseLogEntry[]
}

export function getLicenseStatus() {
  return request.get<LicenseStatus>('/license/status', { skipErrorToast: true })
}

export function getMachineId() {
  return request.get<{ machineId: string }>('/license/machine-id', { skipErrorToast: true })
}

export function activateLicense(code: string) {
  return request.post<LicenseActivateResult>(
    '/license/activate',
    { code },
    { skipErrorToast: true, skipLicenseRedirect: true }
  )
}

export function getLicenseInfo() {
  return request.get<LicenseInfo>('/license/info')
}
