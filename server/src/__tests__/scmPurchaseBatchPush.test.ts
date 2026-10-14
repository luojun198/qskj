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

  it('行仓库 / 税率为空时按订单表头兜底，表头取组内公共值', () => {
    const groups = buildPurchaseReceiptDraftGroups([
      { id: 'L1', supplier_code: 'SUP-A', currency: 'CNY', qty: 5, pushed_qty: 0, item_code: 'A', warehouse_code: null, tax_rate: null, source_header_wh: 'WH1', source_header_tax: 13 },
      { id: 'L2', supplier_code: 'SUP-A', currency: 'CNY', qty: 5, pushed_qty: 0, item_code: 'B', warehouse_code: 'WH1', tax_rate: 0, source_header_wh: 'WH1', source_header_tax: 13 },
    ])
    expect(groups[0]).toMatchObject({ warehouse_code: 'WH1', tax_rate: 13 })
    expect(groups[0].lines[0]).toMatchObject({ warehouse_code: 'WH1', tax_rate: 13 })
    // 行上明确的 0% 不被表头覆盖
    expect(groups[0].lines[1]).toMatchObject({ warehouse_code: 'WH1', tax_rate: 0 })
  })

  it('组内仓库或表头税率不一致时表头留空', () => {
    const groups = buildPurchaseReceiptDraftGroups([
      { id: 'L1', supplier_code: 'SUP-A', currency: 'CNY', qty: 5, pushed_qty: 0, warehouse_code: 'WH1', source_header_tax: 13 },
      { id: 'L2', supplier_code: 'SUP-A', currency: 'CNY', qty: 5, pushed_qty: 0, warehouse_code: 'WH2', source_header_tax: 9 },
    ])
    expect(groups[0]).toMatchObject({ warehouse_code: null, tax_rate: null })
  })
})
