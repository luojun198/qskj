// 系统统一使用省电模式（关闭毛玻璃 / 动画 / 大阴影），不再提供完整模式切换
const LEGACY_PERFORMANCE_MODE_KEY = 'cw-performance-mode'

function readDeviceMemory() {
  return Number((navigator as Navigator & { deviceMemory?: number }).deviceMemory || 0)
}

/** 视觉效果固定为省电模式 */
export function shouldUseLightMode() {
  return true
}

/** 低配电脑判断：仅用于决定标签页缓存个数等资源占用策略 */
export function isLowEndDevice() {
  const cores = Number(navigator.hardwareConcurrency || 0)
  const memoryGb = readDeviceMemory()
  return (cores > 0 && cores <= 4) || (memoryGb > 0 && memoryGb <= 4)
}

export function applyPerformanceMode() {
  const root = document.documentElement
  root.dataset.performanceMode = 'light'
  root.classList.add('cw-light-mode')
  try {
    localStorage.removeItem(LEGACY_PERFORMANCE_MODE_KEY)
  } catch {
    // 忽略存储不可用
  }
  return true
}
