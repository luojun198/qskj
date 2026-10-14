/**
 * 客户反馈（润衡云测试）：采购订单 / 销售订单不应生成凭证；BOM 全部选成副产品时计划无用料。
 */
import { describe, it, expect } from 'vitest'
import { docTypeGeneratesVoucher } from '../services/scmDocumentControls.js'
import { bomLinesError } from '../services/scmBom.js'

describe('订单类单据不生成凭证', () => {
  it('询价 / 订单 / 报价 / MRP 不制证', () => {
    for (const t of ['PQ', 'PO', 'SQ', 'SOa', 'MRP']) expect(docTypeGeneratesVoucher(t)).toBe(false)
  })
  it('出入库、发票、收付款、组装单照常制证', () => {
    for (const t of ['PI', 'PR', 'SO', 'SR', 'RP', 'RS', 'RCV', 'PAY', 'WO', 'WI', 'OP', 'AS', 'DS']) expect(docTypeGeneratesVoucher(t)).toBe(true)
  })
})

describe('BOM 至少一行主件', () => {
  it('组件全部为副产品 / 联产品时拒绝保存', () => {
    expect(bomLinesError([
      { item_code: '0102', qty: 2, line_type: 'by_product' },
      { item_code: '0103', qty: 2, line_type: 'co_product' },
    ])).toContain('主件')
  })
  it('有一行主件即可；未填行类型按主件处理；空行忽略', () => {
    expect(bomLinesError([{ item_code: '0102', qty: 2, line_type: 'by_product' }, { item_code: '0103', qty: 2 }])).toBeNull()
    expect(bomLinesError([{ item_code: '', line_type: 'by_product' }])).toBeNull()
    expect(bomLinesError(undefined)).toBeNull()
  })
})
