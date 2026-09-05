/**
 * 登录页「记住账号密码」的本地存储。
 * 密码只做本地混淆，防止 localStorage 一眼看见明文，不是加密。
 */

export const REMEMBER_ME_KEY = 'rememberMe'
export const REMEMBERED_USERNAME_KEY = 'rememberedUsername'
export const REMEMBERED_PASSWORD_KEY = 'rememberedPassword'
export const LAST_ACCOUNT_SET_ID_KEY = 'lastAccountSetId'

const OBFUSCATE_KEY = 'rh-mini-remember-v1'

export interface RememberedLogin {
  rememberMe: boolean
  username: string
  password: string
  accountSetId: string
}

function xorBytes(input: Uint8Array): Uint8Array {
  const key = new TextEncoder().encode(OBFUSCATE_KEY)
  return input.map((byte, index) => byte ^ key[index % key.length])
}

export function obfuscateSecret(plain: string): string {
  if (!plain) return ''
  const encoded = xorBytes(new TextEncoder().encode(plain))
  let binary = ''
  encoded.forEach(byte => {
    binary += String.fromCharCode(byte)
  })
  return btoa(binary)
}

export function deobfuscateSecret(stored: string): string {
  if (!stored) return ''
  try {
    const binary = atob(stored)
    const bytes = Uint8Array.from(binary, char => char.charCodeAt(0))
    return new TextDecoder().decode(xorBytes(bytes))
  } catch {
    return ''
  }
}

export function saveRememberedLogin(payload: {
  username: string
  password: string
  accountSetId?: string
}): void {
  localStorage.setItem(REMEMBER_ME_KEY, 'true')
  localStorage.setItem(REMEMBERED_USERNAME_KEY, payload.username)
  localStorage.setItem(REMEMBERED_PASSWORD_KEY, obfuscateSecret(payload.password))
  if (payload.accountSetId) {
    localStorage.setItem(LAST_ACCOUNT_SET_ID_KEY, payload.accountSetId)
  }
}

export function loadRememberedLogin(): RememberedLogin {
  const rememberMe = localStorage.getItem(REMEMBER_ME_KEY) === 'true'
  return {
    rememberMe,
    username: rememberMe ? localStorage.getItem(REMEMBERED_USERNAME_KEY) || '' : '',
    password: rememberMe ? deobfuscateSecret(localStorage.getItem(REMEMBERED_PASSWORD_KEY) || '') : '',
    accountSetId: localStorage.getItem(LAST_ACCOUNT_SET_ID_KEY) || '',
  }
}

export function clearRememberedLogin(): void {
  localStorage.removeItem(REMEMBER_ME_KEY)
  localStorage.removeItem(REMEMBERED_USERNAME_KEY)
  localStorage.removeItem(REMEMBERED_PASSWORD_KEY)
}

export function readNativePassword(root?: HTMLElement | null): string {
  if (!root) return ''
  const input = root.querySelector<HTMLInputElement>(
    'input[name="password"], input[autocomplete="current-password"], input[type="password"]'
  )
  return input?.value || ''
}
