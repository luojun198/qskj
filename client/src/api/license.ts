import request from './request'

export interface LicenseStatus {
  activated: boolean
  expired: boolean
  expiresAt: string | null
  daysRemaining: number
  machineId: string
  machineMismatch: boolean
}

export function getLicenseStatus() {
  return request.get<LicenseStatus>('/license/status', { skipErrorToast: true })
}

export function getMachineId() {
  return request.get<{ machineId: string }>('/license/machine-id', { skipErrorToast: true })
}

export function activateLicense(code: string) {
  return request.post<{ expiresAt: string }>(
    '/license/activate',
    { code },
    { skipErrorToast: true, skipLicenseRedirect: true }
  )
}
