import { describe, expect, it } from 'vitest'
import { buildMultiSourceRemainingLines, commonSourceHeaderValue, sourceFieldValues } from '../scmMultiSource'

describe('多来源下游单据', () => {
  it('只有全部来源表头一致时才自动带出', () => {
    const docs = [{ payment_type: 'cash' }, { payment_type: 'cash' }]
    expect(commonSourceHeaderValue(docs, 'payment_type')).toBe('cash')
    expect(commonSourceHeaderValue([{ currency: 'CNY' }, { currency: 'USD' }], 'currency')).toBe('')
  })

  it('不同来源行不合并并保留各自source_line_id', () => {
    const rows = buildMultiSourceRemainingLines([
      { id: 'D1', doc_no: 'PO-001', lines: [{ id: 'L1', item_code: 'A', qty: 5, pushed_qty: 2, price: 10 }] },
      { id: 'D2', doc_no: 'PO-002', lines: [{ id: 'L2', item_code: 'A', qty: 4, pushed_qty: 0, price: 10 }] },
    ])
    expect(rows).toHaveLength(2)
    expect(rows.map(row => [row.source_line_id, row.qty])).toEqual([['L1', 3], ['L2', 4]])
    expect(rows.map(row => row.source_doc_no)).toEqual(['PO-001', 'PO-002'])
  })

  it('汇总来源单据的对方订单号并去重', () => {
    const docs = [
      { field_values: { external_order_no: 'CUST-001' } },
      { field_values: JSON.stringify({ external_order_no: 'CUST-002' }) },
      { field_values: { external_order_no: 'CUST-001' } },
    ]
    expect(sourceFieldValues(docs, 'external_order_no')).toBe('CUST-001、CUST-002')
  })
})
