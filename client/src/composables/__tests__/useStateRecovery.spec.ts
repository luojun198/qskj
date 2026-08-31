import { describe, expect, it } from 'vitest'
import { shouldRefreshStateError } from '../useStateRecovery'

describe('状态错误刷新策略', () => {
  it('选中单据已不存在时，列表存在刷新回调也应刷新', () => {
    expect(shouldRefreshStateError({ kind: 'resource_missing' }, true)).toBe(true)
  })

  it('没有刷新回调时不应尝试刷新', () => {
    expect(shouldRefreshStateError({ kind: 'state_changed', refresh: true }, false)).toBe(false)
  })
})
