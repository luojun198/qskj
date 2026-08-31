import { describe, expect, it } from 'vitest'
import { getDocBatchActionState } from '../scmBatchActions'

describe('采购订单批量下推操作状态', () => {
  it('允许混合供应商和币别的采购订单', () => {
    const state = getDocBatchActionState([
      { id: 'PO-1', doc_type: 'PO', status: 'draft', partner_code: 'SUP-A', currency: 'CNY', push_progress: 'none' },
      { id: 'PO-2', doc_type: 'PO', status: 'audited', partner_code: 'SUP-B', currency: 'USD', push_progress: 'none' },
    ])
    expect(state.push).toMatchObject({ enabled: true, targetType: 'PI' })
  })
})
