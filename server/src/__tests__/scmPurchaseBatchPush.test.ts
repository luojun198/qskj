import { describe, expect, it } from 'vitest'
import { buildPurchaseReceiptDraftGroups } from '../services/scmPurchaseBatchPush.js'
import { purchaseOrderPushSourceSql } from '../services/scmPurchaseBatchPush.js'

describe('采购订单批量下推', () => {
  it('来源单查询不依赖列表计算字段 push_progress', () => {
    expect(purchaseOrderPushSourceSql()).not.toContain('push_progress')
  })

  it('按供应商和币别拆分，并仅保留订单剩余量', () => {
    const groups = buildPurchaseReceiptDraftGroups([
      { id: 'L1', supplier_code: 'SUP-A', currency: 'CNY', qty: 10, pushed_qty: 3, item_code: 'A' },
      { id: 'L2', supplier_code: 'SUP-A', currency: 'CNY', qty: 5, pushed_qty: 0, item_code: 'B' },
      { id: 'L3', supplier_code: 'SUP-B', currency: 'USD', qty: 8, pushed_qty: 2, item_code: 'C' },
    ])

    expect(groups).toHaveLength(2)
    expect(groups[0]).toMatchObject({ partner_code: 'SUP-A', currency: 'CNY' })
    expect(groups[0].lines.map(line => ({ source_line_id: line.source_line_id, qty: line.qty }))).toEqual([
      { source_line_id: 'L1', qty: 7 }, { source_line_id: 'L2', qty: 5 },
    ])
    expect(groups[1]).toMatchObject({ partner_code: 'SUP-B', currency: 'USD' })
    expect(groups[1].lines[0]).toMatchObject({ source_line_id: 'L3', qty: 6 })
  })

  it('跳过已全部下推的订单行', () => {
    const groups = buildPurchaseReceiptDraftGroups([
      { id: 'L1', supplier_code: 'SUP-A', currency: 'CNY', qty: 5, pushed_qty: 5, item_code: 'A' },
    ])
    expect(groups).toEqual([])
  })
})
