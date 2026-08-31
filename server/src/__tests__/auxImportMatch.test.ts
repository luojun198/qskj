import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { lookupAuxItemsForImport } from '../services/auxImportMatch.js'

describe('auxImportMatch', () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    db.exec(`
      CREATE TABLE aux_items (
        id TEXT PRIMARY KEY,
        account_set_id TEXT,
        type TEXT,
        code TEXT,
        name TEXT,
        status TEXT
      );
    `)
    db.prepare(
      `INSERT INTO aux_items VALUES ('i1', 's1', 'cat1', '100001', '案件A', 'active')`
    ).run()
    db.prepare(
      `INSERT INTO aux_items VALUES ('i2', 's1', 'cat1', '100002', '案件B', 'active')`
    ).run()
  })

  it('按编码批量匹配', () => {
    const items = lookupAuxItemsForImport(db, 's1', 'cat1', ['100001', '999999'], [])
    expect(items).toHaveLength(1)
    expect(items[0].id).toBe('i1')
  })

  it('按名称批量匹配', () => {
    const items = lookupAuxItemsForImport(db, 's1', 'cat1', [], ['案件B'])
    expect(items).toHaveLength(1)
    expect(items[0].code).toBe('100002')
  })
})
