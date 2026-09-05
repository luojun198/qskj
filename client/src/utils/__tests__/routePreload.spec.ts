import { beforeEach, describe, expect, it, vi } from 'vitest'
import { preloadRoutePath, resetRoutePreloadCache } from '../routePreload'

type FakeRouter = Parameters<typeof preloadRoutePath>[0]

function makeRouter(map: Record<string, any[]>): FakeRouter {
  return {
    resolve(path: string) {
      const matched = map[path.split('?')[0]]
      if (!matched) return { matched: [] }
      return { matched }
    },
  } as unknown as FakeRouter
}

describe('preloadRoutePath', () => {
  beforeEach(() => {
    resetRoutePreloadCache()
    vi.restoreAllMocks()
  })

  it('调用路由自己的懒加载函数', async () => {
    const loader = vi.fn().mockResolvedValue({ default: {} })
    const router = makeRouter({ '/voucher/entry': [{ components: { default: loader } }] })

    await preloadRoutePath(router, '/voucher/entry')
    expect(loader).toHaveBeenCalledTimes(1)
  })

  it('同一路径重复调用只加载一次', async () => {
    const loader = vi.fn().mockResolvedValue({ default: {} })
    const router = makeRouter({ '/ledger/detail': [{ components: { default: loader } }] })

    await Promise.all([
      preloadRoutePath(router, '/ledger/detail'),
      preloadRoutePath(router, '/ledger/detail'),
      preloadRoutePath(router, '/ledger/detail'),
    ])
    expect(loader).toHaveBeenCalledTimes(1)
  })

  it('忽略 query，按路径去重', async () => {
    const loader = vi.fn().mockResolvedValue({ default: {} })
    const router = makeRouter({ '/report/dynamic': [{ components: { default: loader } }] })

    await preloadRoutePath(router, '/report/dynamic?view=1')
    await preloadRoutePath(router, '/report/dynamic?view=2')
    expect(loader).toHaveBeenCalledTimes(1)
  })

  it('加载失败后清掉缓存，下次可以重试', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const loader = vi
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ default: {} })
    const router = makeRouter({ '/scm/docs': [{ components: { default: loader } }] })

    await preloadRoutePath(router, '/scm/docs')
    expect(loader).toHaveBeenCalledTimes(1)

    await preloadRoutePath(router, '/scm/docs')
    expect(loader).toHaveBeenCalledTimes(2)
  })

  it('加载失败不向外抛错', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const router = makeRouter({
      '/x': [{ components: { default: vi.fn().mockRejectedValue(new Error('boom')) } }],
    })
    await expect(preloadRoutePath(router, '/x')).resolves.toBeUndefined()
  })

  it('已解析过的路由记录不再调用', () => {
    const router = makeRouter({ '/dashboard': [{ components: { default: { name: 'Resolved' } } }] })
    expect(preloadRoutePath(router, '/dashboard')).toBeNull()
  })

  it('嵌套路由会把父子两层的懒加载都拉上', async () => {
    const layout = vi.fn().mockResolvedValue({ default: {} })
    const page = vi.fn().mockResolvedValue({ default: {} })
    const router = makeRouter({
      '/base/account': [{ components: { default: layout } }, { components: { default: page } }],
    })

    await preloadRoutePath(router, '/base/account')
    expect(layout).toHaveBeenCalledTimes(1)
    expect(page).toHaveBeenCalledTimes(1)
  })

  it('路径匹配不到时返回 null，不抛错', () => {
    const router = makeRouter({})
    expect(preloadRoutePath(router, '/not-exist')).toBeNull()
  })

  it('resolve 抛错时返回 null', () => {
    const router = {
      resolve() {
        throw new Error('bad path')
      },
    } as unknown as FakeRouter
    expect(preloadRoutePath(router, '://bad')).toBeNull()
  })
})
