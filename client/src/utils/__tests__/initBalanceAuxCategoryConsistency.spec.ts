import { describe, it, expect } from 'vitest'
import {
  AUX_AMOUNT_FIELDS,
  categoryAmountTotalsClose,
  collectCategoryAmountMismatches,
  buildCategoryConsistencyMessage,
  checkAuxCategoryAmountConsistency,
} from '../initBalanceAuxCategoryConsistency'
import type { CategoryAmountTotals } from '../initBalanceAuxTabRows'

const categories = [
  { id: 'c1', name: '部门' },
  { id: 'c2', name: '项目' },
]

function totals(overrides: Partial<CategoryAmountTotals> = {}): CategoryAmountTotals {
  return {
    opening_debit: 0,
    opening_credit: 0,
    pre_book_debit: 0,
    pre_book_credit: 0,
    ...overrides,
  }
}

function totalsMap(entries: Record<string, CategoryAmountTotals>) {
  return new Map(Object.entries(entries))
}

describe('initBalanceAuxCategoryConsistency', () => {
  it('AUX_AMOUNT_FIELDS 包含四列分项', () => {
    expect(AUX_AMOUNT_FIELDS.map(f => f.key)).toEqual([
      'opening_debit',
      'opening_credit',
      'pre_book_debit',
      'pre_book_credit',
    ])
  })

  it('两类目四列完全一致时通过', () => {
    const map = totalsMap({
      c1: totals({ opening_debit: 5000 }),
      c2: totals({ opening_debit: 5000 }),
    })
    expect(checkAuxCategoryAmountConsistency(categories, map)).toBeNull()
  })

  it('仅 opening_debit 不同时拒绝并指出字段', () => {
    const map = totalsMap({
      c1: totals({ opening_debit: 3000 }),
      c2: totals({ opening_debit: 8000 }),
    })
    const result = checkAuxCategoryAmountConsistency(categories, map)
    expect(result).not.toBeNull()
    expect(result!.mismatchedFields.map(f => f.key)).toContain('opening_debit')
    expect(result!.message).toContain('年初借方')
    expect(result!.message).toContain('部门')
    expect(result!.message).toContain('项目')
  })

  it('净余额相同但 pre_book_debit 不同视为不一致', () => {
    const map = totalsMap({
      c1: totals({ opening_debit: 100, pre_book_credit: 30 }),
      c2: totals({ opening_debit: 70, pre_book_debit: 30, pre_book_credit: 30 }),
    })
    const result = checkAuxCategoryAmountConsistency(categories, map)
    expect(result).not.toBeNull()
    expect(result!.mismatchedFields.map(f => f.key)).toContain('opening_debit')
    expect(result!.mismatchedFields.map(f => f.key)).toContain('pre_book_debit')
  })

  it('一类目有数、另一类目全 0 视为不一致', () => {
    const map = totalsMap({
      c1: totals({ opening_debit: 91 }),
      c2: totals(),
    })
    const result = checkAuxCategoryAmountConsistency(categories, map)
    expect(result).not.toBeNull()
    expect(result!.message).toContain('91.00')
    expect(result!.message).toContain('0.00')
  })

  it('单类目时不校验', () => {
    const map = totalsMap({ c1: totals({ opening_debit: 100 }) })
    expect(checkAuxCategoryAmountConsistency([categories[0]], map)).toBeNull()
  })

  it('categoryAmountTotalsClose 在容差内视为相等', () => {
    expect(categoryAmountTotalsClose(totals({ opening_debit: 100 }), totals({ opening_debit: 100.01 }))).toBe(
      true
    )
    expect(categoryAmountTotalsClose(totals({ opening_debit: 100 }), totals({ opening_debit: 100.03 }))).toBe(
      false
    )
  })

  it('buildCategoryConsistencyMessage 格式化分项差异', () => {
    const mismatches = collectCategoryAmountMismatches(
      categories,
      totalsMap({
        c1: totals({ opening_debit: 100 }),
        c2: totals({ opening_debit: 80 }),
      })
    )
    const msg = buildCategoryConsistencyMessage(mismatches)
    expect(msg).toContain('各类目合计不一致')
    expect(msg).toContain('年初借方')
  })
})
