import { describe, expect, it } from 'vitest'
import { useRacedQuery } from '../useRacedQuery'

/** FIX-157：旧响应后到不能覆盖新响应 */
describe('useRacedQuery', () => {
  it('慢的旧请求后到时返回 undefined，只有最新请求生效', async () => {
    const raced = useRacedQuery()
    let resolveSlow!: (v: string) => void
    const slow = raced.run(() => new Promise<string>(resolve => (resolveSlow = resolve)))
    const fast = raced.run(() => Promise.resolve('fast'))
    expect(raced.loading.value).toBe(true)
    expect(await fast).toBe('fast')
    expect(raced.loading.value).toBe(false)
    resolveSlow('slow')
    expect(await slow).toBeUndefined()
    expect(raced.loading.value).toBe(false)
  })

  it('过期请求的异常被吞掉，最新请求的异常照常抛出', async () => {
    const raced = useRacedQuery()
    let rejectOld!: (e: Error) => void
    const old = raced.run(() => new Promise<string>((_, reject) => (rejectOld = reject)))
    const latest = raced.run(() => Promise.reject(new Error('boom')))
    await expect(latest).rejects.toThrow('boom')
    rejectOld(new Error('stale'))
    expect(await old).toBeUndefined()
  })
})
