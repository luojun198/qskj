/**
 * 挂载应用前等待后端 /api/health 就绪；等待期间在 #app 显示提示。
 * 后端重载或尚未启动完成时避免页面可见但导航/请求卡死。超时后放行。
 */
const POLL_MS = 800
const FETCH_TIMEOUT_MS = 3000
const MAX_WAIT_MS = 60_000

async function isReady(): Promise<boolean> {
  try {
    const res = await fetch('/api/health', { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
    if (!res.ok) return false
    const body = await res.json()
    return body?.status === 'ok'
  } catch {
    return false
  }
}

export async function waitBackendReady(): Promise<void> {
  if (await isReady()) return

  const el = document.getElementById('app')
  if (el) {
    el.innerHTML =
      '<div style="height:100vh;display:flex;align-items:center;justify-content:center;font:15px sans-serif;color:#666">后端服务启动中，请稍候…</div>'
  }
  const start = Date.now()
  while (Date.now() - start < MAX_WAIT_MS) {
    await new Promise(r => setTimeout(r, POLL_MS))
    if (await isReady()) return
  }
}
