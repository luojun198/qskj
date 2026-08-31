import { describe, expect, it } from 'vitest'
import { getStateErrorMessage, readStateError } from '../stateRecovery'

describe('状态错误恢复', () => {
  it('识别后端结构化状态冲突并给出可执行提示', () => {
    const stateError = readStateError({
      response: { status: 409, data: { data: { state_error: { kind: 'state_changed', refresh: true } } } },
    })
    expect(stateError).toMatchObject({ kind: 'state_changed', refresh: true })
    expect(getStateErrorMessage(stateError!)).toBe('数据状态已变化，已刷新，请确认后重试')
  })

  it('兼容旧接口的不存在提示，不向用户暴露原始文案', () => {
    const stateError = readStateError({ response: { status: 404, data: { message: 'MRP计算单不存在' } } })
    expect(stateError).toMatchObject({ kind: 'resource_missing', legacy: true })
    expect(getStateErrorMessage(stateError!)).toBe('当前数据已删除、无权限访问或不属于当前账套')
  })
})
