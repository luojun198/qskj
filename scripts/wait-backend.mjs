// 开发启动：等待后端 /api/health 就绪后再放行（前端 vite 在此之后才启动）
const port = process.env.PORT || '3105'
const url = `http://127.0.0.1:${port}/api/health`
const maxMs = 120_000
const start = Date.now()
let announced = false

async function ready() {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(2000) })
    if (!res.ok) return false
    const body = await res.json()
    return body?.status === 'ok'
  } catch {
    return false
  }
}

while (Date.now() - start < maxMs) {
  if (await ready()) {
    console.log(`[wait-backend] 后端已就绪（${((Date.now() - start) / 1000).toFixed(1)}s），启动前端`)
    process.exit(0)
  }
  if (!announced) {
    console.log(`[wait-backend] 等待后端启动 ${url} ...`)
    announced = true
  }
  await new Promise(r => setTimeout(r, 500))
}
console.warn('[wait-backend] 等待后端超过 120s，仍继续启动前端，请检查后端窗口日志')
process.exit(0)
