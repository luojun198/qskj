import { describe, expect, it } from 'vitest'
import {
  accountMatchesQuickFilter,
  accountMatchesQuickFilters,
  filterAccountsWithAncestors,
} from '@/utils/accountQuickFilter'

describe('accountQuickFilter', () => {
  const rows = [
    { id: '1', parent_id: null, is_cash: 1, is_bank: 0, no_negative: 0, is_aux: 0 },
    {
      id: '2',
      parent_id: '1',
      is_cash: 0,
      is_bank: 1,
      no_negative: 1,
      is_aux: 1,
      aux_types: JSON.stringify({ dept: 'd1' }),
    },
    { id: '3', parent_id: '1', is_cash: 0, is_bank: 0, no_negative: 0, is_aux: 0 },
  ]

  it('accountMatchesQuickFilter 识别固定属性', () => {
    expect(accountMatchesQuickFilter(rows[0], 'cash')).toBe(true)
    expect(accountMatchesQuickFilter(rows[1], 'bank')).toBe(true)
    expect(accountMatchesQuickFilter(rows[1], 'no_negative')).toBe(true)
  })

  it('accountMatchesQuickFilter 识别辅助类别', () => {
    expect(accountMatchesQuickFilter(rows[1], 'aux:dept')).toBe(true)
    expect(accountMatchesQuickFilter(rows[1], 'aux:project')).toBe(false)
  })

  it('accountMatchesQuickFilters 多选为或关系', () => {
    expect(accountMatchesQuickFilters(rows[0], ['cash', 'bank'])).toBe(true)
    expect(accountMatchesQuickFilters(rows[3 - 1], ['cash', 'bank'])).toBe(false)
  })

  it('filterAccountsWithAncestors 保留上级科目', () => {
    const filtered = filterAccountsWithAncestors(rows, ['bank'])
    expect(filtered.map(row => row.id)).toEqual(['1', '2'])
  })
})
