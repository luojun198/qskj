import { describe, it, expect, vi } from 'vitest'
import { createThrottledReporter } from '../utils/batchProgress.js'

describe('createThrottledReporter', () => {
  it('十万行最多约 200 次上报', () => {
    const report = vi.fn()
    const throttled = createThrottledReporter(report, 100_000, 200)
    throttled(0, 0, 0, true)
    for (let i = 1; i <= 100_000; i++) {
      throttled(i, i, 0)
    }
    throttled(100_000, 100_000, 0, true)
    expect(report.mock.calls.length).toBeLessThanOrEqual(202)
    expect(report.mock.calls.length).toBeGreaterThanOrEqual(100)
    expect(report.mock.calls[0]).toEqual([0, 100_000, 0, 0])
    expect(report.mock.calls.at(-1)).toEqual([100_000, 100_000, 100_000, 0])
  })
})
