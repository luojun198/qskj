import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import {
  createAuxItemExistsCheckers,
  createAccountParentLookup,
} from '../utils/bulkImportHelpers.js'

describe('bulkImportHelpers', () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    db.exec(`
      CREATE TABLE aux_items (
        id TEXT PRIMARY KEY,
        account_set_id TEXT,
        type TEXT,
        code TEXT,
        name TEXT
      );
      CREATE TABLE accounts (
        id TEXT PRIMARY KEY,
        account_set_id TEXT,
        code TEXT,
        level INTEGER
      );
    `)
    db.prepare(`INSERT INTO aux_items VALUES ('i1', 's1', 'cat1', '001', '项目A')`).run()
    db.prepare(`INSERT INTO accounts VALUES ('a1', 's1', '1001', 1)`).run()
  })

  it('createAuxItemExistsCheckers 按 code/name 查询', () => {
    const check = createAuxItemExistsCheckers(db, 's1', 'cat1')
    expect(check.codeExists('001')).toBe(true)
    expect(check.codeExists('999')).toBe(false)
    expect(check.nameExists('项目A')).toBe(true)
    expect(check.nameExists('不存在')).toBe(false)
  })

  it('createAccountParentLookup 按编码查上级', () => {
    const lookup = createAccountParentLookup(db, 's1')
    expect(lookup('1001')).toEqual({ id: 'a1', level: 1 })
    expect(lookup('9999')).toBeUndefined()
    expect(lookup('')).toBeNull()
  })
})
