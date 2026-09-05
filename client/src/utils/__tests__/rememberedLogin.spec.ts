import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  LAST_ACCOUNT_SET_ID_KEY,
  REMEMBER_ME_KEY,
  REMEMBERED_PASSWORD_KEY,
  REMEMBERED_USERNAME_KEY,
  clearRememberedLogin,
  deobfuscateSecret,
  loadRememberedLogin,
  obfuscateSecret,
  readNativePassword,
  saveRememberedLogin,
} from '../rememberedLogin'

function stubLocalStorage() {
  const store: Record<string, string> = {}
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

describe('rememberedLogin', () => {
  beforeEach(() => {
    stubLocalStorage()
  })

  it('混淆后不是明文，并能还原中英文密码', () => {
    const secret = 'admin123中文!'
    const stored = obfuscateSecret(secret)
    expect(stored).not.toBe('')
    expect(stored).not.toContain('admin123')
    expect(deobfuscateSecret(stored)).toBe(secret)
  })

  it('勾选记住后能读回账套、用户名和密码', () => {
    saveRememberedLogin({
      username: 'admin',
      password: 'admin123',
      accountSetId: 'set-1',
    })

    expect(localStorage.getItem(REMEMBER_ME_KEY)).toBe('true')
    expect(localStorage.getItem(REMEMBERED_PASSWORD_KEY)).not.toBe('admin123')

    const remembered = loadRememberedLogin()
    expect(remembered).toEqual({
      rememberMe: true,
      username: 'admin',
      password: 'admin123',
      accountSetId: 'set-1',
    })
  })

  it('未勾选记住时不回填用户名密码', () => {
    localStorage.setItem(REMEMBERED_USERNAME_KEY, 'admin')
    localStorage.setItem(REMEMBERED_PASSWORD_KEY, obfuscateSecret('admin123'))
    localStorage.setItem(LAST_ACCOUNT_SET_ID_KEY, 'set-1')

    expect(loadRememberedLogin()).toEqual({
      rememberMe: false,
      username: '',
      password: '',
      accountSetId: 'set-1',
    })
  })

  it('取消记住只清凭证，不影响上次账套', () => {
    saveRememberedLogin({
      username: 'admin',
      password: 'admin123',
      accountSetId: 'set-1',
    })
    clearRememberedLogin()

    expect(localStorage.getItem(REMEMBER_ME_KEY)).toBeNull()
    expect(localStorage.getItem(REMEMBERED_USERNAME_KEY)).toBeNull()
    expect(localStorage.getItem(REMEMBERED_PASSWORD_KEY)).toBeNull()
    expect(localStorage.getItem(LAST_ACCOUNT_SET_ID_KEY)).toBe('set-1')
  })

  it('损坏的密码串读成空字符串', () => {
    expect(deobfuscateSecret('%%%not-base64%%%')).toBe('')
  })

  it('能从原生密码框读出浏览器回填值', () => {
    const root = document.createElement('form')
    const input = document.createElement('input')
    input.type = 'password'
    input.name = 'password'
    input.value = 'autofilled'
    root.appendChild(input)
    expect(readNativePassword(root)).toBe('autofilled')
    expect(readNativePassword(null)).toBe('')
  })
})
