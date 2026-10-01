/**
 * 升级部署后旧页面加载分块失败时自动刷新一次。
 *
 * 打包后的页面分块文件名带哈希（如 Entry-bLPRunki.js），升级会替换成新文件名。
 * 升级前就打开着的浏览器标签里还是旧的 index.html，切换菜单时去请求旧分块 → 404，
 * 表现为白屏 / 「Failed to fetch dynamically imported module」。开发环境没有哈希文件，遇不到。
 * 这里在识别到这类错误时整页刷新一次，拿到新的 index.html 与分块；
 * 用 sessionStorage 记录上次刷新时间，短时间内不重复刷新，避免真正缺文件时无限循环。
 */
import type { Router } from 'vue-router'

const RELOAD_AT_KEY = 'cw-chunk-reload-at'
const RELOAD_COOLDOWN_MS = 10_000

const CHUNK_ERROR_PATTERNS = [
  /Failed to fetch dynamically imported module/i, // Chrome / Edge
  /error loading dynamically imported module/i, // Firefox
  /Importing a module script failed/i, // Safari
  /Unable to preload CSS/i, // Vite 预加载 CSS 失败
  /Expected a JavaScript module script/i, // 旧分块被回成 HTML
]

export function isChunkLoadError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String((err as any)?.message ?? err ?? '')
  return CHUNK_ERROR_PATTERNS.some(re => re.test(message))
}

/** 刷新一次页面；冷却期内已刷新过则返回 false（交给原有错误处理） */
export function reloadOnceForChunkError(targetPath?: string): boolean {
  let last = 0
  try {
    last = Number(sessionStorage.getItem(RELOAD_AT_KEY)) || 0
  } catch {
    /* 隐私模式等读不到时按未刷新过处理 */
  }
  if (Date.now() - last < RELOAD_COOLDOWN_MS) return false
  try {
    sessionStorage.setItem(RELOAD_AT_KEY, String(Date.now()))
  } catch {
    /* 写不进去也照样刷新，最多多刷一次 */
  }
  if (targetPath) window.location.assign(targetPath)
  else window.location.reload()
  return true
}

export function setupChunkReload(router: Router) {
  // Vite 预加载依赖（JS/CSS）失败时派发；preventDefault 后不再向外抛错
  window.addEventListener('vite:preloadError', event => {
    if (reloadOnceForChunkError()) event.preventDefault()
  })
  // 路由页面分块 import() 失败：直接刷新到目标路由
  router.onError((err, to) => {
    if (isChunkLoadError(err)) reloadOnceForChunkError(to?.fullPath)
  })
}
