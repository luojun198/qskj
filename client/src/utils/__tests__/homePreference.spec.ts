import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  clearHomePage,
  getStoredHomePage,
  homePagePath,
  loadHomePage,
  resetHomePageContext,
  setHomePage,
} from '@/utils/homePreference'

/** happy-dom 的 localStorage 无 clear，沿用 stores/__tests__/userLogout.spec.ts 的桩 */
function stubLocalStorage() {
  const store: Record<string, string> = {}
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value
    },
    removeItem: (key: string) => {
      delete store[key]
    },
  })
}

describe('homePreference', () => {
  beforeEach(() => {
    stubLocalStorage()
    resetHomePageContext()
  })

  it('按用户 + 账套隔离偏好', () => {
    loadHomePage('alice', 'set-1')
    setHomePage('/group/出纳管理')
    expect(homePagePath.value).toBe('/group/出纳管理')

    // 同一用户换账套：互不影响
    expect(loadHomePage('alice', 'set-2')).toBe('')
    setHomePage('/dashboard')
    expect(loadHomePage('alice', 'set-1')).toBe('/group/出纳管理')

    // 换用户：互不影响
    expect(loadHomePage('bob', 'set-1')).toBe('')
  })

  it('getStoredHomePage 反映当前会话，取消后清空', () => {
    loadHomePage('alice', 'set-1')
    setHomePage('/group/库存管理')
    expect(getStoredHomePage()).toBe('/group/库存管理')

    clearHomePage()
    expect(getStoredHomePage()).toBe('')
    expect(loadHomePage('alice', 'set-1')).toBe('')
  })

  it('退出登录重置会话镜像但保留已保存的偏好', () => {
    loadHomePage('alice', 'set-1')
    setHomePage('/dashboard')
    resetHomePageContext()
    expect(getStoredHomePage()).toBe('')
    expect(loadHomePage('alice', 'set-1')).toBe('/dashboard')
  })
})
