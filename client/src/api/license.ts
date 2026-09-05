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
}

export interface LicenseActivateResult {
  expiresAt: string
  modules: LicenseModuleKey[]
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
