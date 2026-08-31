import { describe, expect, it } from 'vitest'
import {
  applyVoucherFilters,
  cloneVoucherFilters,
  type VoucherFilters,
} from '../useVoucherQuery'

const baseFilters = (): VoucherFilters => ({
  keyword: '测试',
  status: 'audited',
  year: 2026,
  period: 5,
  dateRange: ['2026-05-01', '2026-05-31'],
  voucherTypeIds: ['1'],
  accountIds: [100],
  auxItems: { dept: [1, 2] },
  auxFields: { '1_code': 'A' },
  sortField: 'voucher_no',
  sortOrder: 'desc',
  makerName: '张三',
  auditorName: '',
  posterName: '',
})

describe('cloneVoucherFilters', () => {
  it('应深拷贝嵌套字段', () => {
    const source = baseFilters()
    const cloned = cloneVoucherFilters(source)

    cloned.auxItems.dept.push(3)
    cloned.dateRange.push('2026-06-01')
    cloned.auxFields['1_code'] = 'B'

    expect(source.auxItems.dept).toEqual([1, 2])
    expect(source.dateRange).toEqual(['2026-05-01', '2026-05-31'])
    expect(source.auxFields['1_code']).toBe('A')
  })
})

describe('applyVoucherFilters', () => {
  it('应覆盖嵌套筛选条件而非浅合并残留', () => {
    const target = baseFilters()
    target.auxItems = { dept: [1], project: [9] }
    target.auxFields = { old: 'x' }

    applyVoucherFilters(target, {
      auxItems: { supplier: [5] },
      auxFields: { newField: 'y' },
      makerName: '李四',
    })

    expect(target.auxItems).toEqual({ supplier: [5] })
    expect(target.auxFields).toEqual({ newField: 'y' })
    expect(target.makerName).toBe('李四')
    expect(target.keyword).toBe('测试')
  })
})
