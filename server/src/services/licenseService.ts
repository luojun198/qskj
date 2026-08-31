import type Database from 'better-sqlite3'
import { getDb } from '../db/index.js'
import { LICENSE_PUBLIC_KEY_PEM } from '../config/licensePublicKey.js'
import { getMachineId, getMachineIdCandidates } from './machineId.js'
import {
  daysRemaining,
  decodeLicensePayload,
  formatDateOnly,
  isExpired,
  isValidDateOnly,
  normalizeLicenseCode,
  parseLicenseCode,
  verifyLicenseSignature,
} from './licenseCodec.js'

export const LICENSE_ERROR = {
  NOT_ACTIVATED: 40201,
  EXPIRED: 40202,
  INVALID: 40203,
  FORMAT: 40204,
  MACHINE_MISMATCH: 40205,
} as const

export interface LicenseStatus {
  activated: boolean
  expired: boolean
  expiresAt: string | null
  daysRemaining: number
  machineId: string
  machineMismatch: boolean
}

interface LicenseRow {
  machine_id: string
  expires_at: string
  activated_at: string
  license_token: string
  updated_at: string
}

export function isLicenseCheckSkipped(): boolean {
  return process.env.LICENSE_SKIP === 'true'
}

function hasLicenseActivationTable(db: Database.Database): boolean {
  const row = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'license_activation'`)
    .get() as { name: string } | undefined
  return !!row
}

function readActivationRow(db: Database.Database): LicenseRow | undefined {
  if (!hasLicenseActivationTable(db)) return undefined
  return db
    .prepare(
      `SELECT machine_id, expires_at, activated_at, license_token, updated_at
       FROM license_activation WHERE id = 'default'`
    )
    .get() as LicenseRow | undefined
}

export function getLicenseStatus(db: Database.Database = getDb()): LicenseStatus {
  const machineId = getMachineId()
  if (isLicenseCheckSkipped()) {
    return {
      activated: true,
      expired: false,
      expiresAt: null,
      daysRemaining: 9999,
      machineId,
      machineMismatch: false,
    }
  }

  const row = readActivationRow(db)
  if (!row) {
    return {
      activated: false,
      expired: false,
      expiresAt: null,
      daysRemaining: 0,
      machineId,
      machineMismatch: false,
    }
  }

  const activatedMachineId = row.machine_id.toUpperCase()
  // 新版注册码使用稳定且快速的主机器码（Windows 为 MachineGuid）。只有旧注册码
  // 与主机器码不一致时才枚举磁盘候选，避免每次服务冷启动都阻塞 WMIC/Get-Disk。
  const machineMismatch = activatedMachineId !== machineId && !getMachineIdCandidates().includes(activatedMachineId)
  const expired = isExpired(row.expires_at)
  return {
    activated: true,
    expired,
    expiresAt: row.expires_at,
    daysRemaining: expired ? 0 : daysRemaining(row.expires_at),
    machineId,
    machineMismatch,
  }
}

export interface VerifyLicenseResult {
  ok: true
  payload: { mid: string; exp: string; iat: string }
}

export interface VerifyLicenseError {
  ok: false
  code: number
  message: string
}

export function verifyLicenseCode(
  code: string,
  machineId?: string,
  publicKeyPem: string = LICENSE_PUBLIC_KEY_PEM
): VerifyLicenseResult | VerifyLicenseError {
  let payloadEncoded: string
  let signatureEncoded: string
  try {
    ;({ payloadEncoded, signatureEncoded } = parseLicenseCode(code))
  } catch {
    return { ok: false, code: LICENSE_ERROR.FORMAT, message: '注册码格式错误' }
  }

  if (!verifyLicenseSignature(payloadEncoded, signatureEncoded, publicKeyPem)) {
    return { ok: false, code: LICENSE_ERROR.INVALID, message: '注册码无效或已被篡改' }
  }

  let payload
  try {
    payload = decodeLicensePayload(payloadEncoded)
  } catch {
    return { ok: false, code: LICENSE_ERROR.FORMAT, message: '注册码内容无效' }
  }

  if (payload.v !== 1) {
    return { ok: false, code: LICENSE_ERROR.INVALID, message: '注册码版本不支持' }
  }

  if (!isValidDateOnly(payload.exp)) {
    return { ok: false, code: LICENSE_ERROR.INVALID, message: '注册码有效期无效' }
  }

  const allowedMachineIds = machineId ? [machineId.toUpperCase()] : getMachineIdCandidates()
  if (!allowedMachineIds.includes(payload.mid.toUpperCase())) {
    return { ok: false, code: LICENSE_ERROR.INVALID, message: '注册码与当前机器码不匹配' }
  }

  if (isExpired(payload.exp)) {
    return { ok: false, code: LICENSE_ERROR.EXPIRED, message: '注册码已过期，请联系供应商续期' }
  }

  return {
    ok: true,
    payload: { mid: payload.mid.toUpperCase(), exp: payload.exp, iat: payload.iat },
  }
}

export function activateLicense(
  code: string,
  db: Database.Database = getDb()
): { expiresAt: string } | VerifyLicenseError {
  const verified = verifyLicenseCode(code)
  if (!verified.ok) return verified

  const now = new Date().toISOString()
  const normalizedCode = normalizeLicenseCode(code)
  db.prepare(
    `INSERT INTO license_activation (id, machine_id, expires_at, activated_at, license_token, updated_at)
     VALUES ('default', ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       machine_id = excluded.machine_id,
       expires_at = excluded.expires_at,
       license_token = excluded.license_token,
       updated_at = excluded.updated_at`
  ).run(verified.payload.mid, verified.payload.exp, now, normalizedCode, now)

  return { expiresAt: verified.payload.exp }
}

export interface LicenseAssertError {
  code: number
  message: string
}

export function assertLicenseValid(db: Database.Database = getDb()): LicenseAssertError | null {
  if (isLicenseCheckSkipped()) return null

  const status = getLicenseStatus(db)
  if (!status.activated) {
    return { code: LICENSE_ERROR.NOT_ACTIVATED, message: '软件未激活，请输入注册码' }
  }
  if (status.machineMismatch) {
    return {
      code: LICENSE_ERROR.MACHINE_MISMATCH,
      message: '检测到硬件变更，请使用新机器码重新获取注册码',
    }
  }
  if (status.expired) {
    return { code: LICENSE_ERROR.EXPIRED, message: '软件授权已过期，请重新输入注册码续期' }
  }

  const row = readActivationRow(db)
  if (row?.license_token) {
    const reverify = verifyLicenseCode(row.license_token)
    if (!reverify.ok) {
      return { code: reverify.code, message: reverify.message }
    }
  }

  return null
}

/** 供测试/CLI 使用 */
export function getTodayDateString(): string {
  return formatDateOnly(new Date())
}
