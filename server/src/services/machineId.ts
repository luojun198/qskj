import { createHash } from 'crypto'
import { execSync } from 'child_process'
import { existsSync, readFileSync } from 'fs'
import os from 'os'
import { log } from '../utils/logger.js'

let cachedMachineIds: string[] | null = null
let cachedPrimaryMachineId: string | null = null

function safeExec(command: string): string {
  try {
    return execSync(command, { encoding: 'utf8', timeout: 5000, windowsHide: true }).trim()
  } catch {
    return ''
  }
}

/** os.hostname() 在某些 Windows 配置下可能抛出 ENOTFOUND，包装为安全调用 */
function safeHostname(): string {
  try {
    return os.hostname()
  } catch {
    return ''
  }
}

function parseSerialLines(output: string): string[] {
  return output
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && line.toLowerCase() !== 'serialnumber')
}

/** Windows MachineGuid 普通用户可读，且不受硬盘枚举权限和顺序影响。 */
function getWindowsMachineGuid(): string {
  if (process.platform !== 'win32') return ''
  const output = safeExec(
    'reg query "HKLM\\SOFTWARE\\Microsoft\\Cryptography" /v MachineGuid'
  )
  return output.match(/MachineGuid\s+REG_SZ\s+([^\r\n]+)/i)?.[1]?.trim() || ''
}

/** 获取全部可用硬盘标识，兼容历史上按首块硬盘生成的注册码。 */
function getDiskSerials(): string[] {
  if (process.platform === 'win32') {
    const serials: string[] = []
    const output = safeExec('wmic diskdrive get SerialNumber')
    if (output) serials.push(...parseSerialLines(output))

    // wmic 在新版 Windows 11 中已被弃用；PowerShell 结果显式按磁盘号排序。
    const psOutput = safeExec(
      'powershell -NoProfile -Command "Get-Disk | Sort-Object Number | Select-Object -ExpandProperty SerialNumber"'
    )
    if (psOutput) serials.push(...parseSerialLines(psOutput))
    return [...new Set(serials)]
  }
  if (process.platform === 'linux') {
    const paths = ['/etc/machine-id', '/var/lib/dbus/machine-id']
    for (const path of paths) {
      try {
        if (existsSync(path)) {
          return [readFileSync(path, 'utf8').trim()]
        }
      } catch {
        // try next
      }
    }
  }
  if (process.platform === 'darwin') {
    const serial = safeExec('ioreg -rd1 -c IOPlatformExpertDevice | awk \'/IOPlatformUUID/ { print $3; }\'').replace(
      /"/g,
      ''
    )
    return serial ? [serial] : []
  }
  return []
}

/**
 * 首选稳定的系统标识，同时保留全部硬盘序列号和 hostname 作为历史兼容候选。
 * 这样服务即使在不同权限下启动，也不会把同一台机器误判为硬件变更。
 */
function collectFingerprintValues(): string[] {
  const values = [getWindowsMachineGuid(), ...getDiskSerials(), safeHostname()]
    .map(value => value.trim())
    .filter(Boolean)
  if (values.length > 0) return [...new Set(values)]

  log.warn('机器码采集失败，使用固定兜底标识')
  const hostname = safeHostname() || 'unknown-host'
  return [hostname]
}

function hashMachineValue(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 12).toUpperCase()
}

export function computeMachineIdCandidates(): string[] {
  return collectFingerprintValues().map(hashMachineValue)
}

export function computeMachineId(): string {
  const primaryValue = getWindowsMachineGuid()
  if (primaryValue) return hashMachineValue(primaryValue)

  const diskSerial = getDiskSerials()[0]
  if (diskSerial) return hashMachineValue(diskSerial)

  return hashMachineValue(safeHostname() || 'unknown-host')
}

export function getMachineIdCandidates(): string[] {
  if (!cachedMachineIds) cachedMachineIds = computeMachineIdCandidates()
  return cachedMachineIds
}

export function getMachineId(): string {
  if (!cachedPrimaryMachineId) cachedPrimaryMachineId = computeMachineId()
  return cachedPrimaryMachineId
}

/** 测试用：重置缓存 */
export function resetMachineIdCache(): void {
  cachedMachineIds = null
  cachedPrimaryMachineId = null
}
