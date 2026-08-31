import { describe, expect, it } from 'vitest'
import { createSalesReportConfig, formatSalesReportValue, normalizeSalesReportScheme } from '../scmSalesReport'

const meta: any = {
  fields: [{ key: 'doc_no' }, { key: 'sales_amount' }],
  dimensions: [{ key: 'month' }, { key: 'partner_name' }],
  metrics: [{ key: 'sales_amount' }, { key: 'profit_rate' }],
  defaults: { detail_fields: ['doc_no'], dimensions: ['month'], metrics: ['sales_amount'] },
  limits: { filters: 50, filter_depth: 3, dimensions: 6, page_size: 500 },
}

describe('销售自定义报表前端配置', () => {
  it('建立默认配置', () => {
    expect(createSalesReportConfig(meta)).toMatchObject({ mode: 'summary', fields: ['doc_no'], dimensions: ['month'], metrics: ['sales_amount'], page_size: 100 })
  })

  it('加载方案时忽略已失效字段并保留空维度', () => {
    const result = normalizeSalesReportScheme({ fields: ['doc_no', 'old'], dimensions: [], metrics: ['sales_amount'] } as any, meta)
    expect(result.config.fields).toEqual(['doc_no'])
    expect(result.config.dimensions).toEqual([])
    expect(result.ignored).toEqual(['old'])
  })

  it('正确格式化毛利率空值和金额', () => {
    expect(formatSalesReportValue(null, 'percent')).toBe('—')
    expect(formatSalesReportValue(12.3, 'percent')).toBe('12.3%')
    expect(formatSalesReportValue(1234.5, 'amount')).toBe('1,234.50')
  })
})
