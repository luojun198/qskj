import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('SCM 单据表单初始化顺序', () => {
  it('立即求值的列配置只能引用已初始化的下推进度状态', () => {
    const source = readFileSync(resolve(__dirname, '../DocForm.vue'), 'utf8')
    const showPushColIndex = source.indexOf('const showPushCol = computed')
    const lineColumnDefaultsIndex = source.indexOf('const lineColumnDefaults = computed')

    expect(showPushColIndex).toBeGreaterThan(-1)
    expect(lineColumnDefaultsIndex).toBeGreaterThan(-1)
    expect(showPushColIndex).toBeLessThan(lineColumnDefaultsIndex)
  })

  it('销售发货明细显示只读销售订单号列', () => {
    const source = readFileSync(resolve(__dirname, '../DocForm.vue'), 'utf8')

    expect(source).toContain('column-key="sales_order_no"')
    expect(source).toContain('label="销售订单号"')
    expect(source).toContain("available: () => form.value.doc_type === 'SO'")
    expect(source).toContain("row.sales_order_no || '—'")
    expect(source).toContain("sales_order_no: l.sales_order_no || ''")
  })
})
