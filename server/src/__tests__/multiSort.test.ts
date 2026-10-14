import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import { buildMultiOrderBy, parseSortParam, MAX_SORT_LEVELS } from '../utils/multiSort'

const WL = { name: 'd.name', qty: 'd.qty', city: 'd.city' }
const base = { whitelist: WL, defaultOrderBy: 'd.name DESC', tieBreakers: ['d.id ASC'], numericKeys: new Set(['qty']) }

describe('parseSortParam', () => {
  it('解析多级、缺省方向 asc、忽略大小写', () => {
    expect(parseSortParam('name:desc, qty:ASC ,city')).toEqual([
      { key: 'name', order: 'desc' }, { key: 'qty', order: 'asc' }, { key: 'city', order: 'asc' },
    ])
  })
  it('重复 key 只取第一次；非法方向丢弃；非字符串/空串得空数组', () => {
    expect(parseSortParam('name:desc,name:asc,qty:sideways')).toEqual([{ key: 'name', order: 'desc' }, { key: 'qty:sideways', order: 'asc' }])
    expect(parseSortParam('cf:abc:desc,cf:x')).toEqual([{ key: 'cf:abc', order: 'desc' }, { key: 'cf:x', order: 'asc' }])
    expect(parseSortParam(undefined)).toEqual([])
    expect(parseSortParam('')).toEqual([])
    expect(parseSortParam(123 as any)).toEqual([])
  })
  it(`最多 ${MAX_SORT_LEVELS} 级`, () => {
    expect(parseSortParam('a,b,c,d,e,f,g')).toHaveLength(MAX_SORT_LEVELS)
  })
})

describe('buildMultiOrderBy', () => {
  it('无有效排序 → 默认排序 + 兜底列', () => {
    expect(buildMultiOrderBy(undefined, base).sql).toBe('ORDER BY d.name DESC, d.id ASC')
    expect(buildMultiOrderBy('hack:desc', base)).toEqual({ sql: 'ORDER BY d.name DESC, d.id ASC', applied: [] })
  })
  it('只认白名单：注入串被忽略，合法级别仍生效', () => {
    const r = buildMultiOrderBy('name;DROP TABLE x:asc,qty:desc', base)
    expect(r.applied).toEqual([{ key: 'qty', order: 'desc' }])
    expect(r.sql).not.toMatch(/DROP/)
    expect(buildMultiOrderBy('qty:sideways', base).applied).toEqual([])
    const r2 = buildMultiOrderBy("1);DELETE FROM t;--:asc,city:desc", base)
    expect(r2.applied).toEqual([{ key: 'city', order: 'desc' }])
    expect(r2.sql).not.toMatch(/DELETE/)
  })
  it('动态 key 解析（resolve）', () => {
    const r = buildMultiOrderBy('cf:abc:desc', { ...base, resolve: k => (/^cf:\w+$/.test(k) ? `json_extract(d.fv,'$.${k.slice(3)}')` : null) })
    expect(r.applied).toEqual([{ key: 'cf:abc', order: 'desc' }])
    expect(r.sql).toContain("json_extract(d.fv,'$.abc') DESC")
  })

  it('SQLite 实测：多级排序、空值置后、兜底稳定', () => {
    const db = new Database(':memory:')
    db.exec('CREATE TABLE d (id INTEGER PRIMARY KEY, name TEXT, qty REAL, city TEXT)')
    const ins = db.prepare('INSERT INTO d (name,qty,city) VALUES (?,?,?)')
    ins.run('乙', 5, '广州'); ins.run('甲', 9, '广州'); ins.run('甲', 3, '深圳'); ins.run('甲', null, '佛山'); ins.run('', 7, null); ins.run('乙', 5, '广州')
    const run = (sort: string) => (db.prepare(`SELECT id FROM d ${buildMultiOrderBy(sort, base).sql}`).all() as any[]).map(r => r.id)
    // 第一排序 name 升（空名置后），第二排序 qty 降（NULL 置后；同值按 id 兜底）
    expect(run('name:asc,qty:desc')).toEqual([1, 6, 2, 3, 4, 5])
    // 第一排序 city 降（NULL 置后），同城按 qty 升
    expect(run('city:desc,qty:asc')).toEqual([3, 1, 6, 2, 4, 5])
    // 未指定 → 默认 name DESC，再按 id
    expect(run('')).toEqual([2, 3, 4, 1, 6, 5])
  })
})
