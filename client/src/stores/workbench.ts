import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { flattenNavApp, type NavApp, type NavItem } from '@/config/navigation'

const STORAGE_PREFIX = 'cw-workbench-favorites'
/** 默认常用功能：每个已授权应用取前 N 个页面 */
const DEFAULT_PER_APP = 2
/** 常用功能上限，避免磁贴区无限增长 */
export const MAX_FAVORITES = 16

function storageKey(userKey: string, accountSetId: string) {
  return `${STORAGE_PREFIX}:${userKey || 'anonymous'}:${accountSetId || 'none'}`
}

function readStored(key: string): string[] | null {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === 'string') : null
  } catch {
    return null
  }
}

/** 按应用顺序取每个应用前 N 个页面作为默认常用功能 */
export function buildDefaultFavorites(apps: NavApp[], perApp = DEFAULT_PER_APP): string[] {
  const result: string[] = []
  for (const app of apps) {
    const items = flattenNavApp(app).slice(0, perApp)
    for (const item of items) {
      if (!result.includes(item.path)) result.push(item.path)
    }
  }
  return result.slice(0, MAX_FAVORITES)
}

/**
 * 工作台「常用功能」偏好：按用户 + 账套存 localStorage。
 * 只存路径列表；渲染时再用当前可见导航树解析标题/图标，权限收回后自动消失。
 */
export const useWorkbenchStore = defineStore('workbench', () => {
  const currentKey = ref('')
  /** null 表示用户未自定义，使用默认推荐 */
  const customFavorites = ref<string[] | null>(null)

  function load(userKey: string, accountSetId: string) {
    const key = storageKey(userKey, accountSetId)
    if (key === currentKey.value) return
    currentKey.value = key
    customFavorites.value = readStored(key)
  }

  function persist() {
    if (!currentKey.value) return
    try {
      if (customFavorites.value === null) localStorage.removeItem(currentKey.value)
      else localStorage.setItem(currentKey.value, JSON.stringify(customFavorites.value))
    } catch {
      /* localStorage 不可用时静默 */
    }
  }

  function setFavorites(paths: string[]) {
    const unique: string[] = []
    for (const path of paths) {
      if (!unique.includes(path)) unique.push(path)
    }
    customFavorites.value = unique.slice(0, MAX_FAVORITES)
    persist()
  }

  function resetToDefault() {
    customFavorites.value = null
    persist()
  }

  const isCustomized = computed(() => customFavorites.value !== null)

  /** 解析为可见的导航项；默认模式下按应用推荐，自定义模式下按用户顺序 */
  function resolveFavorites(apps: NavApp[]): NavItem[] {
    const byPath = new Map<string, NavItem>()
    for (const app of apps) {
      for (const item of flattenNavApp(app)) {
        if (!byPath.has(item.path)) byPath.set(item.path, item)
      }
    }
    const paths = customFavorites.value ?? buildDefaultFavorites(apps)
    return paths.map(path => byPath.get(path)).filter((item): item is NavItem => !!item)
  }

  return {
    customFavorites,
    isCustomized,
    load,
    setFavorites,
    resetToDefault,
    resolveFavorites,
  }
})
