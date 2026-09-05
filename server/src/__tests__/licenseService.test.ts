import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import Database from 'better-sqlite3'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { buildLicenseCode } from '../services/licenseCodec.js'
import { LICENSE_PUBLIC_KEY_PEM } from '../config/licensePublicKey.js'
import { isExpired } from '../services/licenseCodec.js'

const TEST_MACHINE_ID = 'A1B2C3D4E5F6'

const getMachineIdMock = vi.fn(() => TEST_MACHINE_ID)
const getMachineIdCandidatesMock = vi.fn(() => [getMachineIdMock()])

vi.mock('../services/machineId.js', () => ({
  getMachineId: () => getMachineIdMock(),
  getMachineIdCandidates: () => getMachineIdCandidatesMock(),
  computeMachineId: () => getMachineIdMock(),
  resetMachineIdCache: vi.fn(),
}))

import {
  activateLicense,
  assertLicenseValid,
  assertModuleLicensed,
  getLicenseStatus,
  getTodayDateString,
  LICENSE_ERROR,
  verifyLicenseCode,
} from '../services/licenseService.js'
import { ALL_MODULE_KEYS, expandLicenseModules, permissionToModules } from '../services/licenseModules.js'

function resolvePrivateKeyPath(): string {
  const candidates = [
    join(process.cwd(), 'tools', 'license-keys', 'license-private.pem'),
    join(process.cwd(), '..', 'tools', 'license-keys', 'license-private.pem'),
    join(process.cwd(), '..', '..', 'tools', 'license-keys', 'license-private.pem'),
  ]
  for (const path of candidates) {
    if (existsSync(path)) return path
  }
  throw new Error('未找到 license-private.pem，请先运行密钥生成步骤')
}

function loadPrivateKey(): string {
  return readFileSync(resolvePrivateKeyPath(), 'utf8')
}

function futureDate(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function pastDate(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() - days)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function makeCode(machineId: string, expires: string): string {
  const privateKey = loadPrivateKey()
  return buildLicenseCode(
    { v: 1, mid: machineId, exp: expires, iat: getTodayDateString() },
    privateKey
  )
}

function makeCodeV2(machineId: string, expires: string, mods: string[]): string {
  const privateKey = loadPrivateKey()
  return buildLicenseCode(
    { v: 2, mid: machineId, exp: expires, iat: getTodayDateString(), mods },
    privateKey
  )
}

describe('licenseService', () => {
  let db: Database.Database
  const originalSkip = process.env.LICENSE_SKIP

  beforeEach(() => {
    delete process.env.LICENSE_SKIP
    getMachineIdMock.mockClear()
    getMachineIdCandidatesMock.mockClear()
    getMachineIdMock.mockReturnValue(TEST_MACHINE_ID)
    getMachineIdCandidatesMock.mockImplementation(() => [getMachineIdMock()])
    db = new Database(':memory:')
    db.exec(`
      CREATE TABLE license_activation (
        id TEXT PRIMARY KEY DEFAULT 'default',
        machine_id TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        activated_at TEXT NOT NULL,
        license_token TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `)
  })

  afterEach(() => {
    if (originalSkip === undefined) delete process.env.LICENSE_SKIP
    else process.env.LICENSE_SKIP = originalSkip
  })

  it('未激活时状态应为未授权', () => {
    const status = getLicenseStatus(db)
    expect(status.activated).toBe(false)
    expect(status.expired).toBe(false)
    expect(status.machineId).toBe(TEST_MACHINE_ID)
  })

  it('有效注册码应激活成功', () => {
    const code = makeCode(TEST_MACHINE_ID, futureDate(30))
    const result = activateLicense(code, db)
    expect(result).toEqual({ expiresAt: expect.any(String), modules: ALL_MODULE_KEYS })

    getMachineIdCandidatesMock.mockClear()
    const status = getLicenseStatus(db)
    expect(status.activated).toBe(true)
    expect(status.expired).toBe(false)
    expect(status.daysRemaining).toBeGreaterThan(0)
    expect(getMachineIdCandidatesMock).not.toHaveBeenCalled()
    expect(assertLicenseValid(db)).toBeNull()
  })

  it('控制台复制产生换行和零宽字符时仍应激活成功', () => {
    const code = makeCode(TEST_MACHINE_ID, futureDate(30))
    const copiedCode = `${code.slice(0, 40)}\r\n${code.slice(40, 80)}\u200B${code.slice(80)}`
    const result = activateLicense(copiedCode, db)

    expect(result).toEqual({ expiresAt: expect.any(String), modules: ALL_MODULE_KEYS })
    const row = db
      .prepare(`SELECT license_token FROM license_activation WHERE id = 'default'`)
      .get() as { license_token: string }
    expect(row.license_token).toBe(code)
    expect(assertLicenseValid(db)).toBeNull()
  })

  it('机器码不匹配应拒绝', () => {
    const code = makeCode('FFFFFFFFFFFF', futureDate(30))
    const result = verifyLicenseCode(code, TEST_MACHINE_ID, LICENSE_PUBLIC_KEY_PEM)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe(LICENSE_ERROR.INVALID)
    }
  })

  it('过期注册码应拒绝', () => {
    const code = makeCode(TEST_MACHINE_ID, pastDate(1))
    const result = verifyLicenseCode(code, TEST_MACHINE_ID, LICENSE_PUBLIC_KEY_PEM)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe(LICENSE_ERROR.EXPIRED)
    }
  })

  it('格式错误注册码应返回 FORMAT 错误', () => {
    const result = verifyLicenseCode('invalid-code', TEST_MACHINE_ID, LICENSE_PUBLIC_KEY_PEM)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe(LICENSE_ERROR.FORMAT)
    }
  })

  it('续期应覆盖旧授权', () => {
    const code1 = makeCode(TEST_MACHINE_ID, futureDate(10))
    activateLicense(code1, db)
    const code2 = makeCode(TEST_MACHINE_ID, futureDate(60))
    activateLicense(code2, db)
    const status = getLicenseStatus(db)
    expect(status.daysRemaining).toBeGreaterThan(30)
  })

  it('硬件变更后 assert 应失败', () => {
    const code = makeCode(TEST_MACHINE_ID, futureDate(30))
    activateLicense(code, db)
    getMachineIdMock.mockReturnValue('BBBBBBBBBBBB')
    const err = assertLicenseValid(db)
    expect(err?.code).toBe(LICENSE_ERROR.MACHINE_MISMATCH)
  })

  it('同一机器采集权限变化时应兼容已签发的候选机器码', () => {
    const code = makeCode(TEST_MACHINE_ID, futureDate(30))
    activateLicense(code, db)

    getMachineIdMock.mockReturnValue('BBBBBBBBBBBB')
    getMachineIdCandidatesMock.mockReturnValue(['BBBBBBBBBBBB', TEST_MACHINE_ID])

    expect(getLicenseStatus(db).machineMismatch).toBe(false)
    expect(assertLicenseValid(db)).toBeNull()
  })

  it('LICENSE_SKIP 应跳过校验', () => {
    process.env.LICENSE_SKIP = 'true'
    expect(assertLicenseValid(db)).toBeNull()
    const status = getLicenseStatus(db)
    expect(status.activated).toBe(true)
    expect(status.modules).toEqual(ALL_MODULE_KEYS)
  })

  describe('模块授权', () => {
    it('未激活时模块列表为空', () => {
      expect(getLicenseStatus(db).modules).toEqual([])
    })

    it('v1 注册码（无 mods）视为授权全部模块', () => {
      activateLicense(makeCode(TEST_MACHINE_ID, futureDate(30)), db)
      expect(getLicenseStatus(db).modules).toEqual(ALL_MODULE_KEYS)
      expect(assertModuleLicensed('outsource', db)).toBeNull()
    })

    it('v2 注册码只解锁指定模块，未知 key 忽略', () => {
      const code = makeCodeV2(TEST_MACHINE_ID, futureDate(30), ['scm', 'gl', 'unknown-module'])
      const result = activateLicense(code, db)
      expect(result).toEqual({ expiresAt: expect.any(String), modules: ['gl', 'scm'] })
      expect(getLicenseStatus(db).modules).toEqual(['gl', 'scm'])
      expect(assertLicenseValid(db)).toBeNull()

      expect(assertModuleLicensed('gl', db)).toBeNull()
      expect(assertModuleLicensed(['production', 'outsource'], db)?.code).toBe(
        LICENSE_ERROR.MODULE_NOT_LICENSED
      )
      expect(assertModuleLicensed(['production', 'scm'], db)).toBeNull()
    })

    it('v2 注册码 mods 含 * 视为全部', () => {
      activateLicense(makeCodeV2(TEST_MACHINE_ID, futureDate(30), ['*']), db)
      expect(getLicenseStatus(db).modules).toEqual(ALL_MODULE_KEYS)
    })

    it('v2 注册码不含任何可用模块应拒绝', () => {
      const code = makeCodeV2(TEST_MACHINE_ID, futureDate(30), ['nope'])
      const result = verifyLicenseCode(code, TEST_MACHINE_ID, LICENSE_PUBLIC_KEY_PEM)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.code).toBe(LICENSE_ERROR.INVALID)
    })

    it('v2 注册码 mods 为空数组应视为格式错误', () => {
      const code = makeCodeV2(TEST_MACHINE_ID, futureDate(30), [])
      const result = verifyLicenseCode(code, TEST_MACHINE_ID, LICENSE_PUBLIC_KEY_PEM)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.code).toBe(LICENSE_ERROR.FORMAT)
    })

    it('不支持的版本号应拒绝', () => {
      const code = buildLicenseCode(
        { v: 9, mid: TEST_MACHINE_ID, exp: futureDate(30), iat: getTodayDateString(), mods: ['gl'] },
        loadPrivateKey()
      )
      const result = verifyLicenseCode(code, TEST_MACHINE_ID, LICENSE_PUBLIC_KEY_PEM)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.code).toBe(LICENSE_ERROR.INVALID)
    })

    it('LICENSE_SKIP 时模块校验直接放行', () => {
      process.env.LICENSE_SKIP = 'true'
      expect(assertModuleLicensed('cashier', db)).toBeNull()
    })
  })
})

describe('licenseModules', () => {
  it('expandLicenseModules 处理 v1 / * / 未知 key', () => {
    expect(expandLicenseModules(undefined)).toEqual(ALL_MODULE_KEYS)
    expect(expandLicenseModules(['*'])).toEqual(ALL_MODULE_KEYS)
    expect(expandLicenseModules(['outsource', 'gl', 'gl', 'x'])).toEqual(['gl', 'outsource'])
    expect(expandLicenseModules(['x'])).toEqual([])
  })

  it('permissionToModules 按权限前缀归属模块', () => {
    expect(permissionToModules('voucher:entry')).toEqual(['gl'])
    expect(permissionToModules('period:close')).toEqual(['gl'])
    expect(permissionToModules('cashier:journal')).toEqual(['cashier'])
    expect(permissionToModules('asset:view')).toEqual(['asset'])
    expect(permissionToModules('scm:purchase')).toEqual(['scm'])
    expect(permissionToModules('scm:production')).toEqual(['production'])
    expect(permissionToModules('scm:outsource')).toEqual(['outsource'])
    expect(permissionToModules('system:user')).toEqual([])
    expect(permissionToModules('*')).toEqual([])
  })

  it('供应链共享基础层权限对生产/委外开放', () => {
    // 物料/仓库/库存/期初/参数/报表 是三个模块共用的底座，只归进销存会让生产模块无法开工
    for (const code of ['scm:item', 'scm:category', 'scm:warehouse', 'scm:stock',
      'scm:opening', 'scm:param', 'scm:colscheme', 'scm:report', 'scm:audit', 'scm:delete']) {
      expect(permissionToModules(code)).toEqual(['scm', 'production', 'outsource'])
    }
    // 往来单位：委外要选委外厂
    expect(permissionToModules('scm:partner')).toEqual(['scm', 'outsource'])
    // 进销存专属不放宽
    expect(permissionToModules('scm:sale')).toEqual(['scm'])
    expect(permissionToModules('scm:inventory')).toEqual(['scm'])
    expect(permissionToModules('scm:arap')).toEqual(['scm'])
    expect(permissionToModules('scm:import')).toEqual(['scm'])
  })
})

describe('licenseCodec', () => {
  it('isExpired 应在截止日之后返回 true', () => {
    expect(isExpired(pastDate(1))).toBe(true)
    expect(isExpired(futureDate(1))).toBe(false)
  })
})
