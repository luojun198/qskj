import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useUserStore } from '@/stores/user'
import {
  LAST_ACCOUNT_SET_ID_KEY,
  REMEMBER_ME_KEY,
  REMEMBERED_PASSWORD_KEY,
  REMEMBERED_USERNAME_KEY,
  obfuscateSecret,
} from '@/utils/rememberedLogin'

function stubLocalStorage(initial: Record<string, string> = {}) {
  const store = { ...initial }
  vi.stubGlobal('localStorage', {
    getItem(key: string) {
      return store[key] ?? null
    },
    setItem(key: string, value: string) {
      store[key] = value
    },
    removeItem(key: string) {
      delete store[key]
    },
  })
}

describe('user store logout 保留记住密码', () => {
  beforeEach(() => {
    stubLocalStorage({
      token: 'token-1',
      accountSetId: 'set-1',
      [LAST_ACCOUNT_SET_ID_KEY]: 'set-1',
      [REMEMBER_ME_KEY]: 'true',
      [REMEMBERED_USERNAME_KEY]: 'admin',
      [REMEMBERED_PASSWORD_KEY]: obfuscateSecret('admin123'),
    })
    setActivePinia(createPinia())
  })

  it('退出登录只清会话，不丢记住的账号密码', () => {
    const store = useUserStore()
    expect(store.rememberMe).toBe(true)

    store.logout()

    expect(store.token).toBe('')
    expect(localStorage.getItem('token')).toBeNull()
    expect(localStorage.getItem('accountSetId')).toBeNull()
    expect(store.rememberMe).toBe(true)
    expect(localStorage.getItem(REMEMBER_ME_KEY)).toBe('true')
    expect(localStorage.getItem(REMEMBERED_USERNAME_KEY)).toBe('admin')
    expect(localStorage.getItem(REMEMBERED_PASSWORD_KEY)).toBeTruthy()
    expect(localStorage.getItem(LAST_ACCOUNT_SET_ID_KEY)).toBe('set-1')
  })
})
