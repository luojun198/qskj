import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'

function queryAuxItems(
  db: Database.Database,
  accountSetId: string,
  opts: { categoryId?: string; ids?: string[]; limit?: number; order?: 'asc' | 'desc' } = {}
) {
  const conditions = ['ai.account_set_id = ?']
  const params: unknown[] = [accountSetId]

  if (opts.categoryId) {
    conditions.push('ai.type = ?')
    params.push(opts.categoryId)
  }

  if (opts.ids?.length) {
    conditions.push(`ai.id IN (${opts.ids.map(() => '?').join(',')})`)
    params.push(...opts.ids)
  }

  const where = conditions.length ? ` WHERE ${conditions.join(' AND ')}` : ''
  let limitClause = ''
  if (opts.limit != null && opts.limit > 0) {
    limitClause = ` LIMIT ${Math.min(opts.limit, 500)}`
  }
  const orderDir = opts.order === 'desc' ? 'DESC' : 'ASC'
  const sql = `
    SELECT ai.id, ai.code, ai.name, ai.type
    FROM aux_items ai${where}
    ORDER BY ai.code ${orderDir}${limitClause}
  `
  return db.prepare(sql).all(...params) as Array<{ id: string; code: string; name: string; type: string }>
}

describe('aux-items list query (limit / ids)', () => {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE aux_items (
      id TEXT PRIMARY KEY,
      account_set_id TEXT,
      code TEXT,
      name TEXT,
      type TEXT,
      status TEXT
    );
  `)
  const catId = 'cat-project'
  const inserts = [
    ['i1', 's1', '000001', '项目A', catId, 'active'],
    ['i2', 's1', '000002', '项目B', catId, 'active'],
    ['i3', 's1', '000003', '项目C', catId, 'active'],
    ['i9', 's1', '000099', '项目Z', catId, 'active'],
  ]
  const stmt = db.prepare(
    'INSERT INTO aux_items (id, account_set_id, code, name, type, status) VALUES (?, ?, ?, ?, ?, ?)'
  )
  for (const row of inserts) {
    stmt.run(...row)
  }

  it('limit 返回指定条数', () => {
    const list = queryAuxItems(db, 's1', { categoryId: catId, limit: 2 })
    expect(list).toHaveLength(2)
    expect(list[0].code).toBe('000001')
  })

  it('ids 仅返回指定项目', () => {
    const list = queryAuxItems(db, 's1', { ids: ['i2', 'i9'] })
    expect(list.map(r => r.id).sort()).toEqual(['i2', 'i9'])
  })

  it('order desc + limit 1 用于下一编码', () => {
    const list = queryAuxItems(db, 's1', { categoryId: catId, limit: 1, order: 'desc' })
    expect(list).toHaveLength(1)
    expect(list[0].code).toBe('000099')
  })
})
