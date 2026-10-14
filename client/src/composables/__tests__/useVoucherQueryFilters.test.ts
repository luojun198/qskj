import { describe, expect, it } from 'vitest'
import {
  applyVoucherFilters,
  cloneVoucherFilters,
  DEFAULT_VOUCHER_SORTS,
  resolveVoucherSorts,
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

describe('凭证多级排序（sorts）', () => {
  it('resolveVoucherSorts：优先 sorts；没有时由旧 sortField/sortOrder 转换（凭证类型恒为第一级）；非法 key 被忽略', () => {
    expect(resolveVoucherSorts({ sorts: [{ key: 'voucher_no', order: 'desc' }, { key: 'bogus', order: 'asc' }] })).toEqual([{ key: 'voucher_no', order: 'desc' }])
    expect(resolveVoucherSorts({ sortField: 'voucher_no', sortOrder: 'desc' })).toEqual([{ key: 'voucher_type', order: 'asc' }, { key: 'voucher_no', order: 'desc' }])
    expect(resolveVoucherSorts({ sortField: 'voucher_date', sortOrder: 'asc' })).toEqual(DEFAULT_VOUCHER_SORTS)
    expect(resolveVoucherSorts(undefined)).toEqual(DEFAULT_VOUCHER_SORTS)
  })

  it('cloneVoucherFilters 深拷贝 sorts；applyVoucherFilters 新方案带 sorts 直接覆盖、旧方案（只有 sortField）自动转换', () => {
    const source = { ...baseFilters(), sorts: [{ key: 'debit_amount' as const, order: 'desc' as const }] }
    const cloned = cloneVoucherFilters(source)
    expect(cloned.sorts).toEqual(source.sorts)
    expect(cloned.sorts).not.toBe(source.sorts)

    const target = baseFilters()
    applyVoucherFilters(target, { sorts: [{ key: 'created_at', order: 'asc' }] })
    expect(target.sorts).toEqual([{ key: 'created_at', order: 'asc' }])
    applyVoucherFilters(target, { sortField: 'voucher_no', sortOrder: 'desc' })
    expect(target.sorts).toEqual([{ key: 'voucher_type', order: 'asc' }, { key: 'voucher_no', order: 'desc' }])
  })
})
