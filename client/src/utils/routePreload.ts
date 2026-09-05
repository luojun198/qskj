import type { Router, RouteRecordNormalized } from 'vue-router'

/**
 * 通用路由预加载。
 *
 * 133 个路由全部是 `component: () => import('@/views/xxx.vue')` 的懒加载写法，
 * 点下菜单那一刻才开始拉整棵组件树——开发环境还要 Vite 现场编译，
 * 于是「第一次进某个模块特别卡，再进就快了」。
 *
 * 这里直接复用路由表自己的懒加载函数：`router.resolve(path).matched` 里
 * 每条记录在未解析前，`components.default` 就是那个 `() => import(...)`，
 * 调用它即可提前把组件拉好，不必为每个模块手写一遍 import。
 */

/** path → 正在进行/已完成的预加载任务，避免重复触发 */
const preloadTasks = new Map<string, Promise<unknown>>()

function normalizeKey(path: string) {
  return path.split('?')[0]
}

/** 取出该路由记录里尚未解析的懒加载函数 */
function collectLazyLoaders(matched: RouteRecordNormalized[]) {
  const loaders: Array<() => Promise<unknown>> = []
  for (const record of matched) {
    for (const component of Object.values(record.components || {})) {
      // 已解析过的记录里放的是组件对象，不是函数，跳过
      if (typeof component === 'function') {
        loaders.push(component as () => Promise<unknown>)
      }
    }
  }
  return loaders
}

/**
 * 预加载某个路径对应的路由组件。
 * 只解析组件，不做导航、不碰任何 store。
 *
 * @returns 预加载任务；路径无法匹配或已全部解析时返回 null
 */
export function preloadRoutePath(router: Router, path: string): Promise<unknown> | null {
  const key = normalizeKey(path)
  const cached = preloadTasks.get(key)
  if (cached) return cached

  let matched: RouteRecordNormalized[]
  try {
    matched = router.resolve(path).matched
  } catch {
    // 传进来的路径不合法：静默跳过，预加载失败不该影响正常使用
    return null
  }
  if (matched.length === 0) return null

  const loaders = collectLazyLoaders(matched)
  if (loaders.length === 0) return null

  const task = Promise.all(loaders.map(load => load())).catch(error => {
    // 失败就把缓存清掉，下次悬停/点击还能重试
    preloadTasks.delete(key)
    console.warn(`预加载路由失败: ${key}`, error)
  })

  preloadTasks.set(key, task)
  return task
}

/** 低优先级批量预加载：排到浏览器空闲时再做，不与首屏抢资源 */
export function preloadRoutePathsWhenIdle(router: Router, paths: string[]) {
  const pending = paths.map(normalizeKey).filter(path => !preloadTasks.has(path))
  if (pending.length === 0) return

  const requestIdle = (window as any).requestIdleCallback as
    | typeof window.requestIdleCallback
    | undefined

  let index = 0
  const step = () => {
    if (index >= pending.length) return
    preloadRoutePath(router, pending[index++])
    schedule()
  }
  const schedule = () => {
    if (typeof requestIdle === 'function') requestIdle(step, { timeout: 3000 })
    else globalThis.setTimeout(step, 200)
  }
  schedule()
}

/** 仅供测试使用：清空预加载缓存 */
export function resetRoutePreloadCache() {
  preloadTasks.clear()
}
