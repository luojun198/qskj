import { describe, it, expect } from 'vitest'
import { describeSortKeys, normalizeSortKeys, parseSortKeys, sameSortKeys, serializeSortKeys, sortRows, MAX_SORT_LEVELS } from '../multiSort'

describe('序列化 / 解析（与后端 sort 参数互通）', () => {
  it('序列化多级并可还原', () => {
    const keys = [{ key: 'partner', order: 'asc' as const }, { key: 'total_amount', order: 'desc' as const }, { key: 'cf:level', order: 'asc' as const }]
    const text = serializeSortKeys(keys)
    expect(text).toBe('partner:asc,total_amount:desc,cf:level:asc')
    expect(parseSortKeys(text)).toEqual(keys)
  })
  it('缺省方向为升序；空值得空数组', () => {
    expect(parseSortKeys('a,b:desc')).toEqual([{ key: 'a', order: 'asc' }, { key: 'b', order: 'desc' }])
    expect(parseSortKeys('')).toEqual([])
    expect(parseSortKeys(undefined)).toEqual([])
  })
})

describe('normalizeSortKeys', () => {
  it('去掉不允许的列、重复列，限制最大级数，非法方向按升序', () => {
    const out = normalizeSortKeys([
      { key: 'a', order: 'desc' }, { key: 'x', order: 'asc' }, { key: 'a', order: 'asc' }, { key: 'b', order: 'bogus' as any },
    ], ['a', 'b'])
    expect(out).toEqual([{ key: 'a', order: 'desc' }, { key: 'b', order: 'asc' }])
    const many = normalizeSortKeys(Array.from({ length: 9 }, (_, i) => ({ key: `k${i}`, order: 'asc' as const })), Array.from({ length: 9 }, (_, i) => `k${i}`))
    expect(many).toHaveLength(MAX_SORT_LEVELS)
  })
  it('sameSortKeys / describeSortKeys', () => {
    const a = [{ key: 'doc_date', order: 'desc' as const }, { key: 'doc_no', order: 'asc' as const }]
    expect(sameSortKeys(a, a.map(k => ({ ...k })))).toBe(true)
    expect(sameSortKeys(a, [a[0]])).toBe(false)
    expect(describeSortKeys(a, [{ key: 'doc_date', label: '日期' }, { key: 'doc_no', label: '单据号' }])).toBe('日期↓ › 单据号↑')
  })
})

describe('sortRows（前端多级排序）', () => {
  const rows = [
    { id: 1, wh: 'B仓', qty: 5, name: '螺丝10' },
    { id: 2, wh: 'A仓', qty: 9, name: '螺丝2' },
    { id: 3, wh: 'A仓', qty: 3, name: '螺母' },
    { id: 4, wh: '', qty: null as number | null, name: '垫片' },
    { id: 5, wh: 'B仓', qty: 5, name: '螺丝1' },
  ]
  const acc = (k: string) => (r: any) => r[k]
  const ids = (keys: Array<{ key: string; order: 'asc' | 'desc' }>) => sortRows(rows, keys, acc).map(r => r.id)

  it('第一排序仓库升序、第二排序数量降序；空值始终最后', () => {
    expect(ids([{ key: 'wh', order: 'asc' }, { key: 'qty', order: 'desc' }])).toEqual([2, 3, 1, 5, 4])
    expect(ids([{ key: 'wh', order: 'desc' }, { key: 'qty', order: 'asc' }])).toEqual([1, 5, 3, 2, 4])   // 空仓库降序时也在最后
  })
  it('同值保持原顺序（稳定）；第三排序生效', () => {
    expect(ids([{ key: 'qty', order: 'asc' }])).toEqual([3, 1, 5, 2, 4])
    expect(ids([{ key: 'qty', order: 'asc' }, { key: 'name', order: 'asc' }])).toEqual([3, 5, 1, 2, 4])
  })
  it('文本按中文自然序比较（螺丝2 < 螺丝10）；数字文本按数值比较', () => {
    const names = [{ name: '螺丝10' }, { name: '螺丝2' }, { name: '螺丝1' }]
    expect(sortRows(names, [{ key: 'name', order: 'asc' }], acc).map(r => r.name)).toEqual(['螺丝1', '螺丝2', '螺丝10'])
    const t = [{ v: '10' }, { v: '9' }, { v: '100' }]
    expect(sortRows(t, [{ key: 'v', order: 'asc' }], acc).map(r => r.v)).toEqual(['9', '10', '100'])
  })
  it('没有取值函数的列被忽略；无有效键时原样返回（新数组）', () => {
    const out = sortRows(rows, [{ key: 'nope', order: 'asc' }], () => undefined)
    expect(out.map(r => r.id)).toEqual([1, 2, 3, 4, 5])
    expect(out).not.toBe(rows)
  })
  it('不修改入参数组', () => {
    const copy = rows.map(r => r.id)
    sortRows(rows, [{ key: 'qty', order: 'desc' }], acc)
    expect(rows.map(r => r.id)).toEqual(copy)
  })
})
