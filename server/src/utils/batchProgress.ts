export type BatchProgressReporter = (
  processed: number,
  total: number,
  success: number,
  failed: number
) => void

/** 让出事件循环，使 HTTP 轮询与进度查询得以响应 */
export function yieldEventLoop(): Promise<void> {
  return new Promise(resolve => setImmediate(resolve))
}

/**
 * 节流进度上报：大数据量时最多约 maxUpdates 次，避免每行更新阻塞事件循环
 */
export function createThrottledReporter(
  report: BatchProgressReporter,
  total: number,
  maxUpdates = 200
) {
  const step = Math.max(1, Math.ceil(total / maxUpdates))
  let lastReported = -1

  return (processed: number, success: number, failed: number, force = false) => {
    const isFirst = processed === 0
    const isLast = total > 0 && processed >= total
    if (!force && !isFirst && !isLast && processed % step !== 0) return
    if (!force && processed === lastReported) return
    lastReported = processed
    report(processed, total, success, failed)
  }
}

/** 大数据量循环中周期性让出 CPU，默认每 2000 行 */
export function shouldYieldEventLoop(processed: number, every = 2000): boolean {
  return processed > 0 && processed % every === 0
}
