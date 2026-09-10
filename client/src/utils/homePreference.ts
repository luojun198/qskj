import { ref } from 'vue'

/**
 * 「默认主页」偏好：按用户 + 账套存 localStorage（与 stores/workbench.ts 的收藏一致的范式）。
 * 只存路径（如 /group/出纳管理 或 /dashboard），跳转前再按当前权限校验，
 * 权限/注册模块被收回后自动回退到系统默认落地页，不会把用户锁在无权限页。
 */
const STORAGE_PREFIX = 'cw-home-page'
/** 当前会话镜像：路由 redirect 等拿不到 store 的场景直接读它 */
const CURRENT_KEY = `${STORAGE_PREFIX}:current`

/** 当前用户 + 账套下的默认主页；'' 表示未自定义 */
export const homePagePath = ref('')

/** 当前生效的存储键，由 loadHomePage 写入 */
let activeKey = ''

function storageKey(userKey: string, accountSetId: string) {
  return `${STORAGE_PREFIX}:${userKey || 'anonymous'}:${accountSetId || 'none'}`
}

function readKey(key: string): string {
  try {
    return localStorage.getItem(key) || ''
  } catch {
    return ''
  }
}

function writeMirror(path: string) {
  try {
    if (path) localStorage.setItem(CURRENT_KEY, path)
    else localStorage.removeItem(CURRENT_KEY)
  } catch {
    /* localStorage 不可用时静默 */
  }
}

/** 同步读取当前会话的默认主页（供路由 redirect 使用），未设置返回 '' */
export function getStoredHomePage(): string {
  return readKey(CURRENT_KEY)
}

/** 载入指定用户 + 账套的偏好；登录成功、切换用户/账套后调用 */
export function loadHomePage(userKey: string, accountSetId: string): string {
  activeKey = storageKey(userKey, accountSetId)
  homePagePath.value = readKey(activeKey)
  writeMirror(homePagePath.value)
  return homePagePath.value
}

export function setHomePage(path: string) {
  homePagePath.value = path
  writeMirror(path)
  if (!activeKey) return
  try {
    localStorage.setItem(activeKey, path)
  } catch {
    /* localStorage 不可用时静默 */
  }
}

export function clearHomePage() {
  homePagePath.value = ''
  writeMirror('')
  if (!activeKey) return
  try {
    localStorage.removeItem(activeKey)
  } catch {
    /* localStorage 不可用时静默 */
  }
}

/** 退出登录/切换账套时重置会话镜像（不删除用户已保存的偏好） */
export function resetHomePageContext() {
  activeKey = ''
  homePagePath.value = ''
  writeMirror('')
}
