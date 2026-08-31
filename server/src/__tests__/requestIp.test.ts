import { describe, expect, it } from 'vitest'
import { isLoopbackIp, isClashFakeIp, isSameLoginIp, normalizeIp, toDisplayIp } from '../utils/requestIp.js'

describe('requestIp', () => {
  it('应该规范化 IPv6 映射地址', () => {
    expect(normalizeIp('::ffff:192.168.0.25')).toBe('192.168.0.25')
  })

  it('应该识别回环地址', () => {
    expect(isLoopbackIp('127.0.0.1')).toBe(true)
    expect(isLoopbackIp('::1')).toBe(true)
    expect(isLoopbackIp('192.168.0.25')).toBe(false)
  })

  it('显示 IP 不应该返回回环地址', () => {
    expect(isLoopbackIp(toDisplayIp('127.0.0.1'))).toBe(false)
  })

  it('真实局域网 IP 应该原样返回', () => {
    expect(toDisplayIp('192.168.0.25')).toBe('192.168.0.25')
  })

  it('同机回环与局域网 IP 应视为同一登录来源', () => {
    const lanIp = toDisplayIp('127.0.0.1')
    expect(isSameLoginIp('127.0.0.1', lanIp)).toBe(true)
    expect(isSameLoginIp('192.168.0.25', '192.168.0.25')).toBe(true)
    expect(isSameLoginIp('192.168.0.25', '192.168.0.26')).toBe(false)
  })

  it('Clash/Mihomo fake-ip 应视为本机来源', () => {
    expect(isClashFakeIp('198.18.0.1')).toBe(true)
    expect(isClashFakeIp('198.19.255.1')).toBe(true)
    expect(isClashFakeIp('192.168.0.25')).toBe(false)
    const lanIp = toDisplayIp('127.0.0.1')
    expect(isSameLoginIp('198.18.0.1', lanIp)).toBe(true)
    expect(isLoopbackIp(toDisplayIp('198.18.0.1'))).toBe(false)
  })
})
