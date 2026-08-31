import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { restoreMissingSourceLineIds, restorePlanProductLineage } from '../services/scmDocLineage.js'
import { computePushedQty } from '../services/scmProduction.js'

describe('草稿下游单编辑 · 来源行关联保护', () => {
  it('旧客户端漏传 source_line_id 时按原明细 id 恢复', () => {
    const incoming = [
      { id: 'PI-L1', item_code: 'M001', qty: 6 },
      { id: 'PI-L2', item_code: 'M002', qty: 3, source_line_id: undefined },
    ]
    const existing = [
      { id: 'PI-L1', source_line_id: 'PO-L1' },
      { id: 'PI-L2', source_line_id: 'PO-L2' },
    ]

    restoreMissingSourceLineIds(incoming, existing)

    expect(incoming.map(line => line.source_line_id)).toEqual(['PO-L1', 'PO-L2'])
  })

  it('已有明细始终恢复服务端来源，客户端不能改写；新加明细不错误继承', () => {
    const incoming = [
      { id: 'PI-L1', source_line_id: 'PO-NEW-L1' },
      { item_code: 'M003', qty: 1 },
    ]

    restoreMissingSourceLineIds(incoming, [{ id: 'PI-L1', source_line_id: 'PO-OLD-L1' }])

    expect(incoming[0].source_line_id).toBe('PO-OLD-L1')
    expect(incoming[1].source_line_id).toBeUndefined()
  })

  it('恢复关联并重建入库明细后，采购订单已下推数量保持不变', () => {
    const db = new Database(':memory:')
    db.exec(`
      CREATE TABLE scm_doc_line (id TEXT, qty REAL, source_line_id TEXT);
      CREATE TABLE scm_production_plan_product (id TEXT, plan_qty REAL, source_line_id TEXT);
    `)
    db.prepare('INSERT INTO scm_doc_line VALUES (?,?,?)').run('PI-OLD-L1', 6, 'PO-L1')
    const incoming = [{ id: 'PI-OLD-L1', qty: 6 }]

    restoreMissingSourceLineIds(incoming, [{ id: 'PI-OLD-L1', source_line_id: 'PO-L1' }])
    db.prepare('DELETE FROM scm_doc_line').run()
    db.prepare('INSERT INTO scm_doc_line VALUES (?,?,?)').run('PI-NEW-L1', incoming[0].qty, incoming[0].source_line_id)

    expect(computePushedQty(db, 'PO-L1')).toBe(6)
    db.close()
  })
})

describe('缺料单下推工单编辑 · 成品来源关联保护', () => {
  it('按成品行 id 恢复来源，且客户端不能改写来源', () => {
    const incoming = [{ id: 'PP-P1', item_code: 'M001', source_line_id: 'FAKE' }]
    const result = restorePlanProductLineage(incoming, [
      { id: 'PP-P1', item_code: 'M001', source_line_id: 'MR-L1', source_doc_id: 'MR-1' },
    ])

    expect(result.unmatchedSourceProductIds).toEqual([])
    expect(incoming[0]).toMatchObject({ source_line_id: 'MR-L1', source_doc_id: 'MR-1' })
  })

  it('兼容旧客户端：未回传 id 时仅按唯一物料恢复', () => {
    const incoming = [{ item_code: 'M001' }]
    const result = restorePlanProductLineage(incoming, [
      { id: 'PP-P1', item_code: 'M001', source_line_id: 'MR-L1', source_doc_id: 'MR-1' },
    ])

    expect(result.unmatchedSourceProductIds).toEqual([])
    expect(incoming[0]).toMatchObject({ source_line_id: 'MR-L1', source_doc_id: 'MR-1' })
  })

  it('重复物料无法唯一匹配或来源成品被删除时，标记为不可安全保存', () => {
    const incoming = [{ item_code: 'M001' }, { item_code: 'M001' }]
    const result = restorePlanProductLineage(incoming, [
      { id: 'PP-P1', item_code: 'M001', source_line_id: 'MR-L1' },
      { id: 'PP-P2', item_code: 'M001', source_line_id: 'MR-L2' },
    ])

    expect(result.unmatchedSourceProductIds).toEqual(['PP-P1', 'PP-P2'])
    expect(incoming.every(p => !p.source_line_id)).toBe(true)
  })

  it('已有来源成品改成其他物料时拒绝匹配', () => {
    const incoming = [{ id: 'PP-P1', item_code: 'M002' }]
    const result = restorePlanProductLineage(incoming, [
      { id: 'PP-P1', item_code: 'M001', source_line_id: 'MR-L1' },
    ])

    expect(result.unmatchedSourceProductIds).toEqual(['PP-P1'])
    expect(incoming[0].source_line_id).toBeUndefined()
  })
})
