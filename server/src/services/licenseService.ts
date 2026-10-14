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
  LICENSE_PAYLOAD_VERSIONS,
  normalizeLicenseCode,
  parseLicenseCode,
  verifyLicenseSignature,
} from './licenseCodec.js'
import {
  ALL_MODULE_KEYS,
  expandLicenseModules,
  getLicenseModuleName,
  hasLicensedModule,
  type LicenseModuleKey,
} from './licenseModules.js'

export const LICENSE_ERROR = {
  NOT_ACTIVATED: 40201,
  EXPIRED: 40202,
  INVALID: 40203,
  FORMAT: 40204,
  MACHINE_MISMATCH: 40205,
  MODULE_NOT_LICENSED: 40206,
  CONCURRENT_FULL: 40207,
} as const

export interface LicenseStatus {
  activated: boolean
  expired: boolean
  expiresAt: string | null
  daysRemaining: number
  machineId: string
  machineMismatch: boolean
  /** 已授权模块（已展开，不含 '*'）；未激活时为空 */
  modules: LicenseModuleKey[]
  /** 最大并发在线人数；0 = 不限制 */
  maxConcurrent: number
  /** 当前在线人数（按 用户+IP 去重） */
  onlineCount: number
}

/** 超过该时长无任何请求的会话不占并发名额 */
export const ONLINE_WINDOW_MINUTES = 30

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

/** 从已激活的注册码 token 里解出最大并发数；解码失败视为不限制（0） */
function readMaxConcurrentFromToken(token: string | undefined): number {
  if (!token) return 0
  try {
    const { payloadEncoded } = parseLicenseCode(token)
    return decodeLicensePayload(payloadEncoded).cc ?? 0
  } catch {
    return 0
  }
}

/** 从已激活的注册码 token 里解出模块列表；解码失败时视为 v1（全部模块），由验签环节兜底 */
function readModulesFromToken(token: string | undefined): LicenseModuleKey[] {
  if (!token) return []
  try {
    const { payloadEncoded } = parseLicenseCode(token)
    return expandLicenseModules(decodeLicensePayload(payloadEncoded).mods)
  } catch {
    return [...ALL_MODULE_KEYS]
  }
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
      modules: [...ALL_MODULE_KEYS],
      maxConcurrent: 0,
      onlineCount: countOnlineIdentities(db),
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
      modules: [],
      maxConcurrent: 0,
      onlineCount: countOnlineIdentities(db),
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
    modules: readModulesFromToken(row.license_token),
    maxConcurrent: readMaxConcurrentFromToken(row.license_token),
    onlineCount: countOnlineIdentities(db),
  }
}

export interface OnlineIdentity {
  userId: string
  username: string
  loginIp: string | null
  loginAt: string
  lastSeenAt: string
}

function hasLoginSessionTable(db: Database.Database): boolean {
  const row = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'user_login_sessions'`)
    .get() as { name: string } | undefined
  return !!row
}

/** 当前在线身份：active 且最近 ONLINE_WINDOW_MINUTES 内有活动，跨账套按 (用户, IP) 去重，取最近一次活动 */
export function listOnlineIdentities(
  db: Database.Database = getDb(),
  excludeSessionId?: string
): OnlineIdentity[] {
  if (!hasLoginSessionTable(db)) return []
  return db
    .prepare(
      `SELECT user_id AS userId, username, login_ip AS loginIp,
              MIN(login_at) AS loginAt, MAX(last_seen_at) AS lastSeenAt
       FROM user_login_sessions
       WHERE status = 'active' AND last_seen_at > datetime('now', ?) AND id <> ?
       GROUP BY user_id, COALESCE(login_ip, '')
       ORDER BY lastSeenAt DESC`
    )
    .all(`-${ONLINE_WINDOW_MINUTES} minutes`, excludeSessionId ?? '') as OnlineIdentity[]
}

export function countOnlineIdentities(db: Database.Database = getDb()): number {
  return listOnlineIdentities(db).length
}

/**
 * 登录前校验并发名额：已在线的 (用户, IP) 重复登录不占新名额；
 * 新身份且在线数已达上限时拒绝。调用点须在强制下线其它会话之后。
 */
export function assertConcurrencyAvailable(
  userId: string,
  loginIp: string | null | undefined,
  db: Database.Database = getDb(),
  excludeSessionId?: string
): LicenseAssertError | null {
  if (isLicenseCheckSkipped()) return null
  const row = readActivationRow(db)
  const max = readMaxConcurrentFromToken(row?.license_token)
  if (max <= 0) return null
  const online = listOnlineIdentities(db, excludeSessionId)
  const ip = loginIp || ''
  if (online.some(o => o.userId === userId && (o.loginIp || '') === ip)) return null
  if (online.length < max) return null
  return {
    code: LICENSE_ERROR.CONCURRENT_FULL,
    message: `并发授权已满（最多 ${max} 人同时在线），请稍后再试或联系管理员升级授权`,
  }
}

/** 当前已授权模块（LICENSE_SKIP 时为全部） */
export function getLicensedModules(db: Database.Database = getDb()): LicenseModuleKey[] {
  return getLicenseStatus(db).modules
}

export interface VerifyLicenseResult {
  ok: true
  payload: { mid: string; exp: string; iat: string; modules: LicenseModuleKey[]; maxConcurrent: number }
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

  if (!(LICENSE_PAYLOAD_VERSIONS as readonly number[]).includes(payload.v)) {
    return { ok: false, code: LICENSE_ERROR.INVALID, message: '注册码版本不支持' }
  }

  if (!isValidDateOnly(payload.exp)) {
    return { ok: false, code: LICENSE_ERROR.INVALID, message: '注册码有效期无效' }
  }

  const modules = expandLicenseModules(payload.mods)
  if (modules.length === 0) {
    return { ok: false, code: LICENSE_ERROR.INVALID, message: '注册码未包含任何可用模块' }
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
    payload: {
      mid: payload.mid.toUpperCase(),
      exp: payload.exp,
      iat: payload.iat,
      modules,
      maxConcurrent: payload.cc ?? 0,
    },
  }
}

export function activateLicense(
  code: string,
  db: Database.Database = getDb(),
  operator?: string
): { expiresAt: string; modules: LicenseModuleKey[]; maxConcurrent: number } | VerifyLicenseError {
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

  if (hasLicenseLogTable(db)) {
    db.prepare(
      `INSERT INTO license_activation_log (machine_id, expires_at, modules, max_concurrent, issued_at, operator)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      verified.payload.mid,
      verified.payload.exp,
      verified.payload.modules.join(','),
      verified.payload.maxConcurrent,
      verified.payload.iat,
      operator ?? null
    )
  }

  return {
    expiresAt: verified.payload.exp,
    modules: verified.payload.modules,
    maxConcurrent: verified.payload.maxConcurrent,
  }
}

function hasLicenseLogTable(db: Database.Database): boolean {
  const row = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'license_activation_log'`)
    .get() as { name: string } | undefined
  return !!row
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

export function listLicenseLog(db: Database.Database = getDb(), limit = 50): LicenseLogEntry[] {
  if (!hasLicenseLogTable(db)) return []
  const rows = db
    .prepare(
      `SELECT id, machine_id, expires_at, modules, max_concurrent, issued_at, operator, created_at
       FROM license_activation_log ORDER BY id DESC LIMIT ?`
    )
    .all(limit) as Array<{
    id: number
    machine_id: string
    expires_at: string
    modules: string
    max_concurrent: number
    issued_at: string | null
    operator: string | null
    created_at: string
  }>
  return rows.map(r => ({
    id: r.id,
    machineId: r.machine_id,
    expiresAt: r.expires_at,
    modules: r.modules.split(',').filter(Boolean) as LicenseModuleKey[],
    maxConcurrent: r.max_concurrent,
    issuedAt: r.issued_at,
    operator: r.operator,
    createdAt: r.created_at,
  }))
}

export interface LicenseAssertError {
  code: number
  message: string
}

/**
 * 校验所需模块（任一满足即可）是否在授权范围内。
 * 调用方应先通过 assertLicenseValid，这里只关心模块；LICENSE_SKIP 时直接放行。
 */
export function assertModuleLicensed(
  required: LicenseModuleKey | readonly LicenseModuleKey[],
  db: Database.Database = getDb()
): LicenseAssertError | null {
  if (isLicenseCheckSkipped()) return null
  const list = Array.isArray(required) ? required : [required as LicenseModuleKey]
  if (list.length === 0) return null
  if (hasLicensedModule(getLicensedModules(db), list)) return null
  const names = list.map(getLicenseModuleName).join(' / ')
  return {
    code: LICENSE_ERROR.MODULE_NOT_LICENSED,
    message: `当前授权未包含「${names}」模块，请联系供应商升级注册码`,
  }
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
