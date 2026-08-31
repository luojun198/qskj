import { describe, expect, it } from 'vitest'
import { flattenAuditDefaultWarehouseCandidates } from '../scmAuditDefaultWarehouseConfirm'

describe('审核默认仓库确认表格', () => {
  it('扁平化批量单据的待补仓库明细', () => {
    expect(flattenAuditDefaultWarehouseCandidates({
      docs: [
        { doc: { doc_no: 'PI-001' }, candidates: [{ seq: 1, item_code: 'I1', item_name: '物料一', warehouse_code: 'WH0002', warehouse_name: '配件专库' }] },
        { doc: { doc_no: 'PI-002' }, candidates: [{ seq: 2, item_code: 'I2', item_name: '物料二', warehouse_code: 'WH0001' }] },
      ],
    })).toEqual([
      { doc_no: 'PI-001', seq: 1, item_code: 'I1', item_name: '物料一', warehouse_code: 'WH0002', warehouse_name: '配件专库' },
      { doc_no: 'PI-002', seq: 2, item_code: 'I2', item_name: '物料二', warehouse_code: 'WH0001' },
    ])
  })
})
