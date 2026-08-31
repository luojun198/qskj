export type PerformanceModeSetting = 'auto' | 'light' | 'full'

export const PERFORMANCE_MODE_KEY = 'cw-performance-mode'

function readDeviceMemory() {
  return Number((navigator as Navigator & { deviceMemory?: number }).deviceMemory || 0)
}

export function getPerformanceModeSetting(): PerformanceModeSetting {
  const value = localStorage.getItem(PERFORMANCE_MODE_KEY)
  return value === 'light' || value === 'full' ? value : 'auto'
}

export function shouldUseLightMode(setting = getPerformanceModeSetting()) {
  if (setting === 'light') return true
  if (setting === 'full') return false
  const cores = Number(navigator.hardwareConcurrency || 0)
  const memoryGb = readDeviceMemory()
  return (cores > 0 && cores <= 4) || (memoryGb > 0 && memoryGb <= 4)
}

export function applyPerformanceMode(setting = getPerformanceModeSetting()) {
  const light = shouldUseLightMode(setting)
  const root = document.documentElement
  root.dataset.performanceMode = light ? 'light' : 'full'
  root.classList.toggle('cw-light-mode', light)
  return light
}

export function setPerformanceMode(setting: PerformanceModeSetting) {
  localStorage.setItem(PERFORMANCE_MODE_KEY, setting)
  return applyPerformanceMode(setting)
}
