import { describe, expect, it } from 'vitest'
import { buildStateErrorPayload } from '../utils/stateError.js'

describe('状态错误协议', () => {
  it('旧流程返回可跳转的 409 结构化错误', () => {
    expect(buildStateErrorPayload('workflow_replaced', {
      resourceType: 'MRP',
      resourceId: 'mrp-1',
      suggestedRoute: { name: 'ScmMrPushPreview', params: { id: 'mrp-1' } },
    })).toMatchObject({
      kind: 'workflow_replaced',
      resource_type: 'MRP',
      resource_id: 'mrp-1',
      refresh: false,
      suggested_route: { name: 'ScmMrPushPreview' },
    })
  })

  it('状态冲突要求刷新但不自动重试写操作', () => {
    expect(buildStateErrorPayload('state_changed', { currentStatus: 'audited' }))
      .toMatchObject({ kind: 'state_changed', current_status: 'audited', refresh: true })
  })
})
