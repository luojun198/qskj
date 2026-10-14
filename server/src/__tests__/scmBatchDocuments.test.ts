import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import {
  executeBatchAtomically,
  normalizeBatchIds,
  validateProductionPlanBatchAction,
  validateBatchPushDocuments,
  type BatchPushDocument,
} from '../services/scmBatchDocuments.js'

function doc(overrides: Partial<BatchPushDocument> = {}): BatchPushDocument {
  return {
    id: 'D1',
    doc_no: 'PO-001',
    doc_type: 'PO',
    status: 'audited',
    partner_code: 'SUP-1',
    currency: 'CNY',
    push_progress: 'none',
    ...overrides,
  }
}

describe('供应链批量单据预校验', () => {
  it('拒绝空集合、重复ID和超过30张', () => {
    expect(() => normalizeBatchIds([])).toThrow('至少选择')
    expect(() => normalizeBatchIds(['D1', 'D1'])).toThrow('重复')
    expect(() => normalizeBatchIds(Array.from({ length: 31 }, (_, i) => `D${i}`))).toThrow('30')
  })

  it('相同来源类型、往来单位和币别可以合并', () => {
    const result = validateBatchPushDocuments([
      doc(),
      doc({ id: 'D2', doc_no: 'PO-002' }),
    ])
    expect(result).toEqual({ sourceType: 'PO', targetType: 'PI' })
  })

  it('采购订单允许混合供应商与币别，由批量入库按表头拆分', () => {
    expect(validateBatchPushDocuments([
      doc(), doc({ id: 'D2', partner_code: 'SUP-2', currency: 'USD' }),
    ])).toEqual({ sourceType: 'PO', targetType: 'PI' })
    expect(() => validateBatchPushDocuments([
      doc({ doc_type: 'PQ' }), doc({ id: 'D2', doc_type: 'PQ', partner_code: 'SUP-2' }),
    ])).toThrow('往来单位')
  })

  it('完全下推、混合类型和MR/MRP批量下推均拒绝', () => {
    expect(() => validateBatchPushDocuments([doc({ push_progress: 'full' })])).toThrow('全部下推')
    expect(() => validateBatchPushDocuments([doc(), doc({ id: 'D2', doc_type: 'SOa' })])).toThrow('来源类型')
    expect(() => validateBatchPushDocuments([doc({ doc_type: 'MR' })])).toThrow('单张')
    expect(() => validateBatchPushDocuments([doc({ doc_type: 'MRP' })])).toThrow('单张')
  })

  it('可下推类型（PO/PQ/SOa/SQ）草稿状态均允许批量下推（含混合）', () => {
    // PO 草稿：允许
    expect(validateBatchPushDocuments([doc({ status: 'draft' })])).toEqual({ sourceType: 'PO', targetType: 'PI' })
    // PO 草稿 + 已审核混合：允许
    expect(validateBatchPushDocuments([doc({ status: 'draft' }), doc({ id: 'D2', status: 'audited' })])).toEqual({ sourceType: 'PO', targetType: 'PI' })
    // SOa 草稿：允许
    expect(validateBatchPushDocuments([doc({ doc_type: 'SOa', status: 'draft' })])).toEqual({ sourceType: 'SOa', targetType: 'SO' })
    // PQ 草稿：允许
    expect(validateBatchPushDocuments([doc({ doc_type: 'PQ', status: 'draft' })])).toEqual({ sourceType: 'PQ', targetType: 'PO' })
    // SQ 草稿：允许
    expect(validateBatchPushDocuments([doc({ doc_type: 'SQ', status: 'draft' })])).toEqual({ sourceType: 'SQ', targetType: 'SOa' })
    // 异常状态（如 voided）：禁止
    expect(() => validateBatchPushDocuments([doc({ status: 'voided' })])).toThrow('草稿或已审核')
  })

  it('任一动作失败时回滚整批数据库修改', () => {
    const db = new Database(':memory:')
    db.exec('CREATE TABLE test_doc (id TEXT PRIMARY KEY, status TEXT)')
    db.prepare('INSERT INTO test_doc (id,status) VALUES (?,?)').run('D1', 'draft')
    db.prepare('INSERT INTO test_doc (id,status) VALUES (?,?)').run('D2', 'draft')

    expect(() => executeBatchAtomically(db, ['D1', 'D2'], id => {
      db.prepare("UPDATE test_doc SET status='audited' WHERE id=?").run(id)
      if (id === 'D2') throw new Error('第二张失败')
      return id
    })).toThrow('第二张失败')

    const statuses = db.prepare('SELECT status FROM test_doc ORDER BY id').all() as Array<{ status: string }>
    expect(statuses.map(row => row.status)).toEqual(['draft', 'draft'])
  })

  it('生产计划批量动作要求全部状态和依赖条件一致', () => {
    const draft = [{ id: 'P1', code: 'PP-001', status: 'draft', doc_count: 0, mrp_status: null }]
    expect(() => validateProductionPlanBatchAction('delete', draft)).not.toThrow()
    // 列表批量审核（客户反馈）：只接受草稿
    expect(() => validateProductionPlanBatchAction('release', draft)).not.toThrow()
    expect(() => validateProductionPlanBatchAction('release', [{ ...draft[0], status: 'released' }])).toThrow('草稿')
    expect(() => validateProductionPlanBatchAction('unrelease', draft)).toThrow('已审核')
    expect(() => validateProductionPlanBatchAction('reopen', [{ ...draft[0], status: 'closed' }])).not.toThrow()
    expect(() => validateProductionPlanBatchAction('unrelease', [{ ...draft[0], status: 'released', doc_count: 1 }])).toThrow('下游')
    expect(() => validateProductionPlanBatchAction('unrelease', [{ ...draft[0], status: 'released', mrp_status: 'draft' }])).toThrow('MRP')
  })
})
