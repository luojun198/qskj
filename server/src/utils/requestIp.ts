import type { Request } from 'express'
import { networkInterfaces } from 'os'

const loopbackIps = new Set(['127.0.0.1', '::1', '0:0:0:0:0:0:0:1'])

/** Clash / Mihomo 等代理的 fake-ip 段，本机访问时常被识别为「另一 IP」 */
export function isClashFakeIp(ip?: string | null): boolean {
  const normalized = normalizeIp(ip)
  if (normalized === 'unknown') return false
  const parts = normalized.split('.').map(Number)
  if (parts.length !== 4 || parts.some(n => Number.isNaN(n))) return false
  return parts[0] === 198 && parts[1] >= 18 && parts[1] <= 19
}

export function isLocalClientIp(ip?: string | null): boolean {
  const normalized = normalizeIp(ip)
  return isLoopbackIp(normalized) || isClashFakeIp(normalized)
}

export function normalizeIp(ip?: string | string[] | null): string {
  const value = Array.isArray(ip) ? ip[0] : ip
  const first = (value || '').split(',')[0]?.trim() || ''
  const withoutMappedPrefix = first.replace(/^::ffff:/, '')

  if (withoutMappedPrefix === '::1' || withoutMappedPrefix === '0:0:0:0:0:0:0:1') {
    return '127.0.0.1'
  }

  return withoutMappedPrefix || 'unknown'
}

export function isLoopbackIp(ip?: string | null): boolean {
  return loopbackIps.has(normalizeIp(ip))
}

export function getLocalLanIp(): string {
  const interfaces = networkInterfaces()
  const candidates = Object.entries(interfaces).flatMap(([name, items]) =>
    (items || [])
      .filter(item => item.family === 'IPv4' && !item.internal && item.address)
      .map(item => ({ name, address: item.address }))
  )

  const physicalCandidates = candidates.filter(
    item => !/(vmware|virtualbox|vbox|wsl|hyper-v|vethernet|docker|loopback|mihomo|clash|meta)/i.test(item.name)
  )
  const preferred = physicalCandidates.length > 0 ? physicalCandidates : candidates
  const privateIp = preferred.find(item => /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[0-1])\.)/.test(item.address))
  const nonFakeIp = preferred.find(item => !isClashFakeIp(item.address))
  return privateIp?.address || nonFakeIp?.address || preferred[0]?.address || '127.0.0.1'
}

export function toDisplayIp(ip?: string | string[] | null): string {
  const normalized = normalizeIp(ip)
  if (normalized === 'unknown') return normalized
  return isLocalClientIp(normalized) ? getLocalLanIp() : normalized
}

export function getRequestIp(req: Request): string {
  const forwardedFor = req.headers['x-forwarded-for']
  const realIp = req.headers['x-real-ip']
  const headerIp = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor
  const realIpValue = Array.isArray(realIp) ? realIp[0] : realIp

  return toDisplayIp(headerIp || realIpValue || req.ip || req.socket.remoteAddress)
}

/** 判断两次登录是否来自同一终端（本机多开/多标签视为同 IP） */
export function isSameLoginIp(
  a?: string | string[] | null,
  b?: string | string[] | null
): boolean {
  return toDisplayIp(a) === toDisplayIp(b)
}
