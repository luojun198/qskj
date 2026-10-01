import { describe, expect, it } from 'vitest'
import { isChunkLoadError } from '../chunkReload'

describe('isChunkLoadError', () => {
  it('识别各浏览器的分块加载失败', () => {
    expect(isChunkLoadError(new TypeError('Failed to fetch dynamically imported module: http://x/assets/Entry-abc12345.js'))).toBe(true)
    expect(isChunkLoadError(new TypeError('error loading dynamically imported module'))).toBe(true)
    expect(isChunkLoadError(new TypeError('Importing a module script failed.'))).toBe(true)
    expect(isChunkLoadError(new Error('Unable to preload CSS for /assets/a-12345678.css'))).toBe(true)
  })

  it('普通业务错误不触发刷新', () => {
    expect(isChunkLoadError(new Error('凭证不存在'))).toBe(false)
    expect(isChunkLoadError(undefined)).toBe(false)
    expect(isChunkLoadError({ message: 'Request failed with status code 500' })).toBe(false)
  })
})
