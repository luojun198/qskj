import { describe, expect, it } from 'vitest'
import type { Account } from '@/types/base'
import {
  buildAccountTree,
  collapseCheckedCodesToRoots,
  expandCodeRootsToCheckedCodes,
  fuzzyMatchAccount,
} from '../dashboardAccountSelection'

const accounts: Account[] = [
  { id: '1', code: '4001', name: '财政拨款收入', level: 1, is_parent: 1, is_enabled: 1 },
  { id: '2', code: '400101', name: '基本拨款', level: 2, is_parent: 0, is_enabled: 1, parent_id: '1' },
  { id: '3', code: '4101', name: '事业收入', level: 1, is_parent: 0, is_enabled: 1 },
]

describe('dashboardAccountSelection', () => {
  it('fuzzyMatchAccount supports multi-token search', () => {
    expect(fuzzyMatchAccount('4001 拨款', accounts[0])).toBe(true)
    expect(fuzzyMatchAccount('事业', accounts[2])).toBe(true)
    expect(fuzzyMatchAccount('成本', accounts[0])).toBe(false)
  })

  it('expandCodeRootsToCheckedCodes includes descendants by code prefix', () => {
    expect(expandCodeRootsToCheckedCodes(['4001'], accounts).sort()).toEqual(['4001', '400101'])
  })

  it('collapseCheckedCodesToRoots keeps minimal roots only', () => {
    expect(collapseCheckedCodesToRoots(['4001', '400101', '4101']).sort()).toEqual(['4001', '4101'])
  })

  it('buildAccountTree nests by parent_id', () => {
    const tree = buildAccountTree(accounts)
    expect(tree).toHaveLength(2)
    expect(tree[0].children).toHaveLength(1)
    expect(tree[0].children[0].code).toBe('400101')
  })
})
