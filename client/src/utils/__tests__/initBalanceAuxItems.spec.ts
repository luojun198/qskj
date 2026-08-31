import { describe, it, expect } from 'vitest'
import {
  buildAuxItemIdSetByCategory,
  buildAuxItemLookupIndex,
  findAuxItemInCategory,
  isAuxLineItemValid,
  lookupAuxItemInCategory,
  lookupAuxItemIndexed,
} from '../initBalanceAuxItems'
import type { AuxGridRow } from '@/utils/initBalanceAuxGrid'

describe('initBalanceAuxItems', () => {
  const catId = 'cat-1'
  const items = [
    {
      id: '694dff76-9b72-4963-9f62-d1c8fc3f3ed8',
      code: '000002',
      name: '(2021)渝8888执3975号',
    },
  ]

  it('findAuxItemInCategory 支持编码/id/数值编码/名称', () => {
    expect(findAuxItemInCategory(items, '000002')?.id).toBe(items[0].id)
    expect(findAuxItemInCategory(items, 2)?.id).toBe(items[0].id)
    expect(findAuxItemInCategory(items, items[0].id)?.id).toBe(items[0].id)
    expect(findAuxItemInCategory(items, '', items[0].name)?.id).toBe(items[0].id)
  })

  it('lookupAuxItemInCategory 全角括号名称可匹配', () => {
    const result = lookupAuxItemInCategory(items, '', '（2021）渝8888执3975号')
    expect(result.status).toBe('found')
    if (result.status === 'found') {
      expect(result.item.id).toBe(items[0].id)
    }
  })

  it('lookupAuxItemInCategory 名称多空格可匹配', () => {
    const spaced = [{ id: 'i2', code: '000003', name: '办公室财务' }]
    const result = lookupAuxItemInCategory(spaced, '', '办公室  财务')
    expect(result.status).toBe('found')
  })

  it('lookupAuxItemIndexed 与 lookupAuxItemInCategory 大批量结果一致', () => {
    const many = Array.from({ length: 5000 }, (_, i) => ({
      id: `id-${i}`,
      code: String(i + 1).padStart(6, '0'),
      name: `项目${i + 1}`,
    }))
    const index = buildAuxItemLookupIndex(many)
    const sample = many[4321]
    expect(lookupAuxItemIndexed(index, sample.code)).toEqual(
      lookupAuxItemInCategory(many, sample.code)
    )
    expect(lookupAuxItemIndexed(index, '', sample.name)).toEqual(
      lookupAuxItemInCategory(many, '', sample.name)
    )
  })

  it('isAuxLineItemValid 过滤已失效辅助项目', () => {
    const validLine: AuxGridRow = {
      key: 'k1',
      selection: { [catId]: items[0].id },
      opening_debit: 100,
      opening_credit: 0,
      pre_book_debit: 0,
      pre_book_credit: 0,
    }
    const orphanLine: AuxGridRow = {
      ...validLine,
      key: 'k2',
      selection: { [catId]: '0106f657-b734-496b-bf07-5e765c4981bb' },
    }
    const map = { [catId]: items }
    expect(isAuxLineItemValid(validLine, map)).toBe(true)
    expect(isAuxLineItemValid(orphanLine, map)).toBe(false)
  })

  it('buildAuxItemIdSetByCategory 支持大批量 O(1) 校验', () => {
    const catId = 'cat-big'
    const items = Array.from({ length: 10000 }, (_, i) => ({
      id: `id-${i}`,
      code: String(i),
      name: `n${i}`,
    }))
    const validIds = buildAuxItemIdSetByCategory({ [catId]: items })
    const line: AuxGridRow = {
      key: 'k',
      selection: { [catId]: 'id-9999' },
      opening_debit: 1,
      opening_credit: 0,
      pre_book_debit: 0,
      pre_book_credit: 0,
    }
    expect(isAuxLineItemValid(line, { [catId]: items }, validIds)).toBe(true)
  })
})
