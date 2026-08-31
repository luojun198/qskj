/**
 * 性能监控工具
 */

export interface PerformanceMetrics {
  name: string
  duration: number
  timestamp: number
}

class PerformanceMonitor {
  private metrics: PerformanceMetrics[] = []
  private marks: Map<string, number[]> = new Map()

  /**
   * 开始计时
   */
  start(name: string) {
    const stack = this.marks.get(name) || []
    stack.push(performance.now())
    this.marks.set(name, stack)
  }

  /**
   * 结束计时并记录
   */
  end(name: string) {
    const stack = this.marks.get(name)
    const startTime = stack?.pop()
    if (!startTime) {
      console.warn(`Performance mark "${name}" not found`)
      return
    }
    if (stack && stack.length > 0) {
      this.marks.set(name, stack)
    } else {
      this.marks.delete(name)
    }

    const duration = performance.now() - startTime
    this.metrics.push({
      name,
      duration,
      timestamp: Date.now(),
    })

    // 如果耗时超过阈值，输出警告
    if (duration > 1000) {
      console.warn(`⚠️ Performance warning: "${name}" took ${duration.toFixed(2)}ms`)
    }

    return duration
  }

  /**
   * 测量函数执行时间
   */
  async measure<T>(name: string, fn: () => T | Promise<T>): Promise<T> {
    this.start(name)
    try {
      const result = await fn()
      this.end(name)
      return result
    } catch (error) {
      this.end(name)
      throw error
    }
  }

  /**
   * 获取所有性能指标
   */
  getMetrics(): PerformanceMetrics[] {
    return [...this.metrics]
  }

  /**
   * 获取指定名称的性能指标
   */
  getMetricsByName(name: string): PerformanceMetrics[] {
    return this.metrics.filter(m => m.name === name)
  }

  /**
   * 获取平均耗时
   */
  getAverageDuration(name: string): number {
    const metrics = this.getMetricsByName(name)
    if (metrics.length === 0) return 0

    const total = metrics.reduce((sum, m) => sum + m.duration, 0)
    return total / metrics.length
  }

  /**
   * 清除所有指标
   */
  clear() {
    this.metrics = []
    this.marks.clear()
  }

  /**
   * 导出性能报告
   */
  exportReport(): string {
    const report = {
      timestamp: new Date().toISOString(),
      metrics: this.metrics,
      summary: this.getSummary(),
    }
    return JSON.stringify(report, null, 2)
  }

  /**
   * 获取性能摘要
   */
  private getSummary() {
    const names = [...new Set(this.metrics.map(m => m.name))]
    return names.map(name => ({
      name,
      count: this.getMetricsByName(name).length,
      average: this.getAverageDuration(name),
      min: Math.min(...this.getMetricsByName(name).map(m => m.duration)),
      max: Math.max(...this.getMetricsByName(name).map(m => m.duration)),
    }))
  }
}

// 全局单例
const performanceMonitor = new PerformanceMonitor()

export { performanceMonitor }

/**
 * 性能监控装饰器
 * 用于监控函数执行时间
 *
 * @example
 * @measurePerformance('fetchData')
 * async function fetchData() {
 *   // ...
 * }
 */
export function measurePerformance(name: string) {
  return function (_target: any, _propertyKey: string, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value

    descriptor.value = async function (...args: any[]) {
      return await performanceMonitor.measure(name, () => originalMethod.apply(this, args))
    }

    return descriptor
  }
}

/**
 * 页面性能指标
 */
export interface PagePerformance {
  // 首次内容绘制
  FCP?: number
  // 最大内容绘制
  LCP?: number
  // 首次输入延迟
  FID?: number
  // 累积布局偏移
  CLS?: number
  // 首次字节时间
  TTFB?: number
  // DOM 内容加载完成
  DOMContentLoaded?: number
  // 页面完全加载
  Load?: number
}

/**
 * 获取页面性能指标
 */
export function getPagePerformance(): PagePerformance {
  const performance = window.performance
  const timing = performance.timing
  const navigationStart = timing.navigationStart

  const metrics: PagePerformance = {
    TTFB: timing.responseStart - navigationStart,
    DOMContentLoaded: timing.domContentLoadedEventEnd - navigationStart,
    Load: timing.loadEventEnd - navigationStart,
  }

  // 获取 FCP
  const fcpEntry = performance.getEntriesByName('first-contentful-paint')[0] as PerformanceEntry
  if (fcpEntry) {
    metrics.FCP = fcpEntry.startTime
  }

  // 获取 LCP
  try {
    const observer = new PerformanceObserver(list => {
      const entries = list.getEntries()
      const lastEntry = entries[entries.length - 1] as any
      metrics.LCP = lastEntry.renderTime || lastEntry.loadTime
    })
    observer.observe({ entryTypes: ['largest-contentful-paint'] })
  } catch (e) {
    // LCP not supported
  }

  return metrics
}

/**
 * 监控长任务
 */
export function monitorLongTasks(callback: (duration: number) => void) {
  if (!('PerformanceObserver' in window)) return

  try {
    const observer = new PerformanceObserver(list => {
      for (const entry of list.getEntries()) {
        if (entry.duration > 50) {
          // 超过 50ms 的任务被认为是长任务
          callback(entry.duration)
          console.warn(`⚠️ Long task detected: ${entry.duration.toFixed(2)}ms`)
        }
      }
    })

    observer.observe({ entryTypes: ['longtask'] })
  } catch (e) {
    console.warn('Long task monitoring not supported')
  }
}

/**
 * 内存使用监控
 */
export function getMemoryUsage(): { used: number; total: number; percentage: number } | null {
  const memory = (performance as any).memory
  if (!memory) return null

  return {
    used: memory.usedJSHeapSize,
    total: memory.totalJSHeapSize,
    percentage: (memory.usedJSHeapSize / memory.totalJSHeapSize) * 100,
  }
}

/**
 * 监控内存泄漏
 */
export function monitorMemoryLeak(interval: number = 5000) {
  let lastUsed = 0

  setInterval(() => {
    const usage = getMemoryUsage()
    if (!usage) return

    if (lastUsed > 0) {
      const increase = usage.used - lastUsed
      const increasePercentage = (increase / lastUsed) * 100

      if (increasePercentage > 10) {
        console.warn(
          `⚠️ Potential memory leak: Memory increased by ${increasePercentage.toFixed(2)}%`
        )
      }
    }

    lastUsed = usage.used
  }, interval)
}
