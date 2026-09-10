import { ref } from 'vue'

/**
 * 凭证界面「科目显示方式」偏好：按用户 + 账套存 localStorage
 * （与 utils/homePreference.ts 同一范式）。
 * full = 显示完整路径（编码 + 各级名称），leaf = 只显示末级科目名称。
 */
export type AccountDisplayMode = 'full' | 'leaf'

const STORAGE_PREFIX = 'cw-account-display-mode'

/** 当前用户 + 账套下的科目显示方式；默认末级，保持原有观感 */
export const accountDisplayMode = ref<AccountDisplayMode>('leaf')

/** 当前生效的存储键，由 loadAccountDisplayMode 写入 */
let activeKey = ''

function storageKey(userKey: string, accountSetId: string) {
  return `${STORAGE_PREFIX}:${userKey || 'anonymous'}:${accountSetId || 'none'}`
}

function normalize(value: string | null): AccountDisplayMode {
  return value === 'full' ? 'full' : 'leaf'
}

/** 载入指定用户 + 账套的偏好；进入凭证页、切换用户/账套后调用 */
export function loadAccountDisplayMode(
  userKey: string,
  accountSetId: string
): AccountDisplayMode {
  activeKey = storageKey(userKey, accountSetId)
  try {
    accountDisplayMode.value = normalize(localStorage.getItem(activeKey))
  } catch {
    accountDisplayMode.value = 'leaf'
  }
  return accountDisplayMode.value
}

export function setAccountDisplayMode(mode: AccountDisplayMode) {
  accountDisplayMode.value = mode
  if (!activeKey) return
  try {
    localStorage.setItem(activeKey, mode)
  } catch {
    /* localStorage 不可用时静默 */
  }
}

/** 退出登录/切换账套时重置会话状态（不删除用户已保存的偏好） */
export function resetAccountDisplayMode() {
  activeKey = ''
  accountDisplayMode.value = 'leaf'
}
