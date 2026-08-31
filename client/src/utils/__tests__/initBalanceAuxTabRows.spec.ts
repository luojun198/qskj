import { describe, it, expect } from 'vitest'
import {
  buildTabGridRows,
  lineHasAmount,
  countCategoryFilled,
  sumCategoryTotals,
  totalsClose,
} from '@/utils/initBalanceAuxTabRows'
import type { AuxGridRow } from '@/utils/initBalanceAuxGrid'

describe('initBalanceAuxTabRows', () => {
  const catA = 'cat-dept'
  const catB = 'cat-project'
  const items = {
    [catA]: [
      { id: 'd1', code: '01', name: '部门一' },
      { id: 'd2', code: '02', name: '部门二' },
    ],
    [catB]: [
      { id: 'p1', code: 'P1', name: '项目甲' },
    ],
  }

  it('无已保存行时不预生成空行', () => {
    const rows = buildTabGridRows({
      activeCategoryId: catA,
      itemsByCategory: items,
      combinationStore: new Map(),
    })
    expect(rows).toHaveLength(0)
  })

  it('仅展示 combinationStore 中当前类目的行', () => {
    const store = new Map<string, AuxGridRow>()
    store.set('dept:d1', {
      key: 'dept:d1',
      selection: { [catA]: 'd1' },
      opening_debit: 0,
      opening_credit: 0,
      pre_book_debit: 0,
      pre_book_credit: 0,
    })
    const rows = buildTabGridRows({
      activeCategoryId: catA,
      itemsByCategory: items,
      combinationStore: store,
    })
    expect(rows).toHaveLength(1)
    expect(rows[0].selection).toEqual({ [catA]: 'd1' })
    expect(rows[0].selection[catB]).toBeUndefined()
  })

  it('按类目分别汇总', () => {
    const store = new Map<string, AuxGridRow>()
    store.set('dept:d1', {
      key: 'dept:d1',
      selection: { [catA]: 'd1' },
      opening_debit: 1000,
      opening_credit: 0,
      pre_book_debit: 0,
      pre_book_credit: 0,
    })
    store.set('proj:p1', {
      key: 'proj:p1',
      selection: { [catB]: 'p1' },
      opening_debit: 1000,
      opening_credit: 0,
      pre_book_debit: 0,
      pre_book_credit: 0,
    })
    expect(
      totalsClose('debit', sumCategoryTotals(catA, store, true), sumCategoryTotals(catB, store, true))
    ).toBe(true)
    expect(lineHasAmount(store.get('dept:d1')!)).toBe(true)
    const { filled, total } = countCategoryFilled(catA, items, store)
    expect(filled).toBe(1)
    expect(total).toBe(2)
  })
})
