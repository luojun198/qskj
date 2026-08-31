import { describe, expect, it } from 'vitest'
import type { ScmDoc } from '@/api/scm'
import {
  MAX_SCM_BATCH_SELECTION,
  getDocBatchActionState,
  getProductionPlanBatchActionState,
  isSelectableScmDoc,
} from '../scmBatchActions'

function doc(overrides: Partial<ScmDoc> = {}): ScmDoc {
  return {
    id: 'D1',
    doc_type: 'PO',
    doc_no: 'PO-001',
    status: 'draft',
    partner_code: 'SUP-1',
    currency: 'CNY',
    push_progress: 'none',
    ...overrides,
  }
}

describe('供应链列表批量选择规则', () => {
  it('合计行不可选择，且最多选择30张', () => {
    expect(isSelectableScmDoc({ __summary: true } as any)).toBe(false)
    expect(isSelectableScmDoc(doc())).toBe(true)
    expect(MAX_SCM_BATCH_SELECTION).toBe(30)
  })

  it('空选时不开放任何上下文动作', () => {
    const state = getDocBatchActionState([])
    expect(state.count).toBe(0)
    expect(state.view.enabled).toBe(false)
    expect(state.audit.enabled).toBe(false)
    expect(state.push.enabled).toBe(false)
  })

  it('单选草稿开放查看、编辑、审核和删除', () => {
    const state = getDocBatchActionState([doc()])
    expect(state.view.enabled).toBe(true)
    expect(state.edit.enabled).toBe(true)
    expect(state.audit.enabled).toBe(true)
    expect(state.delete.enabled).toBe(true)
    expect(state.unaudit.enabled).toBe(false)
  })

  it('多选要求全部单据满足动作条件', () => {
    const state = getDocBatchActionState([
      doc({ id: 'D1', status: 'draft' }),
      doc({ id: 'D2', status: 'audited' }),
    ])
    expect(state.audit.enabled).toBe(false)
    expect(state.audit.reason).toContain('草稿')
    expect(state.delete.enabled).toBe(false)
    expect(state.unaudit.enabled).toBe(false)
  })

  it('相同类型、往来单位和币别的已审核订单允许批量下推', () => {
    const state = getDocBatchActionState([
      doc({ id: 'D1', status: 'audited' }),
      doc({ id: 'D2', doc_no: 'PO-002', status: 'audited' }),
    ])
    expect(state.push.enabled).toBe(true)
    expect(state.push.targetType).toBe('PI')
  })

  it('可下推类型（PO/PQ/SOa/SQ）草稿状态均允许批量下推（含混合）', () => {
    // PO 草稿：允许
    expect(getDocBatchActionState([doc({ id: 'D1', status: 'draft' })]).push.enabled).toBe(true)
    // PO 草稿 + 已审核混合：允许
    expect(getDocBatchActionState([
      doc({ id: 'D1', status: 'draft' }),
      doc({ id: 'D2', doc_no: 'PO-002', status: 'audited' }),
    ]).push.enabled).toBe(true)
    // SOa 草稿：允许
    expect(getDocBatchActionState([
      doc({ id: 'D1', doc_type: 'SOa', status: 'draft' }),
    ]).push.enabled).toBe(true)
    // PQ 草稿：允许
    expect(getDocBatchActionState([
      doc({ id: 'D1', doc_type: 'PQ', status: 'draft' }),
    ]).push.enabled).toBe(true)
    // SQ 草稿：允许
    expect(getDocBatchActionState([
      doc({ id: 'D1', doc_type: 'SQ', status: 'draft' }),
    ]).push.enabled).toBe(true)
    // 异常状态（如 voided）：禁止
    expect(getDocBatchActionState([
      doc({ id: 'D1', status: 'voided' }),
    ]).push.enabled).toBe(false)
  })

  it('已关联草稿 MRP 的同客户销售订单仍允许合并出库', () => {
    const state = getDocBatchActionState([
      doc({ id: 'D1', doc_type: 'SOa', status: 'audited', partner_code: 'KH0002', mrp_source_count: 1, mrp_status: 'draft' }),
      doc({ id: 'D2', doc_type: 'SOa', status: 'audited', partner_code: 'KH0002', mrp_source_count: 1, mrp_status: 'draft' }),
    ])

    expect(state.push.enabled).toBe(true)
    expect(state.push.targetType).toBe('SO')
  })

  it('不同往来单位、币别或类型禁止合并下推并给出原因', () => {
    expect(getDocBatchActionState([
      doc({ id: 'D1', doc_type: 'PQ', status: 'audited' }),
      doc({ id: 'D2', doc_type: 'PQ', status: 'audited', partner_code: 'SUP-2' }),
    ]).push.reason).toContain('往来单位')

    expect(getDocBatchActionState([
      doc({ id: 'D1', doc_type: 'PQ', status: 'audited' }),
      doc({ id: 'D2', doc_type: 'PQ', status: 'audited', currency: 'USD' }),
    ]).push.reason).toContain('币别')

    expect(getDocBatchActionState([
      doc({ id: 'D1', status: 'audited' }),
      doc({ id: 'D2', status: 'audited', doc_type: 'SOa' }),
    ]).push.reason).toContain('类型')
  })

  it('多张销售订单进入同一张MRP时要求币别一致', () => {
    const base = { doc_type: 'SOa', status: 'audited' } as const
    expect(getDocBatchActionState([
      doc({ id: 'D1', ...base, partner_code: 'CUS-1', currency: 'CNY' }),
      doc({ id: 'D2', ...base, partner_code: 'CUS-1', currency: 'USD' }),
    ]).mrp.enabled).toBe(false)
  })

  it('合并MRP不要求销售订单的往来单位一致', () => {
    const state = getDocBatchActionState([
      doc({ id: 'D1', doc_type: 'SOa', status: 'audited', partner_code: 'CUS-1' }),
      doc({ id: 'D2', doc_type: 'SOa', status: 'audited', partner_code: 'CUS-2' }),
    ])

    expect(state.mrp.enabled).toBe(true)
  })

  it('MR和MRP保持单张专用下推', () => {
    for (const docType of ['MR', 'MRP']) {
      const state = getDocBatchActionState([
        doc({ id: 'D1', doc_type: docType, status: 'audited' }),
        doc({ id: 'D2', doc_type: docType, status: 'audited' }),
      ])
      expect(state.push.enabled).toBe(false)
      expect(state.push.reason).toContain('单张')
    }
  })

  it('锁定或已全部下推单据禁止再次批量下推', () => {
    const locked = getDocBatchActionState([
      doc({ id: 'D1', status: 'audited', push_progress: 'full' }),
      doc({ id: 'D2', status: 'audited' }),
    ])
    expect(locked.push.enabled).toBe(false)
    expect(locked.push.reason).toContain('全部下推')
  })

  it('生产/委外计划多选按草稿、已审核、已关闭分组开放批量动作', () => {
    expect(getProductionPlanBatchActionState([
      { id: 'P1', code: 'PP-001', status: 'draft' },
      { id: 'P2', code: 'PP-002', status: 'draft' },
    ]).delete.enabled).toBe(true)
    expect(getProductionPlanBatchActionState([
      { id: 'P1', code: 'PP-001', status: 'released', doc_count: 0 },
      { id: 'P2', code: 'PP-002', status: 'released', doc_count: 0 },
    ]).unrelease.enabled).toBe(true)
    expect(getProductionPlanBatchActionState([
      { id: 'P1', code: 'PP-001', status: 'closed' },
      { id: 'P2', code: 'PP-002', status: 'closed' },
    ]).reopen.enabled).toBe(true)
  })

  it('生产计划上下文动作仅单选，存在下游或MRP时禁止反审核', () => {
    const state = getProductionPlanBatchActionState([
      { id: 'P1', code: 'PP-001', status: 'released', doc_count: 1 },
      { id: 'P2', code: 'PP-002', status: 'released', doc_count: 0 },
    ])
    expect(state.order.enabled).toBe(false)
    expect(state.unrelease.enabled).toBe(false)
    expect(state.unrelease.reason).toContain('下游')
  })
})
