import { describe, it, expect } from 'vitest'
import { buildDeprQueryDisplayRows } from '../deprQuery'

const row = (year: number, month: number, asset_no: string, month_depr: number, month_workload: number | null = null) => ({
  year, month, asset_no, month_depr, month_workload, accum_depr: 0,
  ref_no: null, asset_name: asset_no, spec: null, category_name: null, dept_name: null, purpose_name: null,
  depr_method: '1', original_value: 0, voucher_no: null,
})

describe('折旧查询表格行', () => {
  it('单月：明细连续编号，末尾一行小计，不出合计', () => {
    const out = buildDeprQueryDisplayRows([row(2026, 8, '01', 81.81), row(2026, 8, '02', 21.38)])
    expect(out.map(r => r.kind)).toEqual(['data', 'data', 'subtotal'])
    expect(out.map(r => r.seq)).toEqual([1, 2, undefined])
    expect(out[2].month_depr).toBe(103.19)
  })

  it('跨月：每月一行小计，末尾合计；工作量只在有值时汇总', () => {
    const out = buildDeprQueryDisplayRows([
      row(2026, 7, '01', 10, 5),
      row(2026, 8, '01', 20),
      row(2026, 8, '02', 0.01),
    ])
    expect(out.map(r => r.kind)).toEqual(['data', 'subtotal', 'data', 'data', 'subtotal', 'total'])
    expect(out[1]).toMatchObject({ month_depr: 10, month_workload: 5 })
    expect(out[4]).toMatchObject({ month_depr: 20.01, month_workload: null })
    expect(out[5]).toMatchObject({ label: '合计', month_depr: 30.01 })
    expect(out[3].seq).toBe(3)
  })

  it('无数据时为空', () => {
    expect(buildDeprQueryDisplayRows([])).toEqual([])
  })
})
