import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { up } from '../db/migrations/20260722_add_scm_item_default_warehouse.js'

describe('物料默认仓库迁移', () => {
  it('为现有物料表增加可空默认仓库字段，且可重复执行', () => {
    const db = new Database(':memory:')
    db.exec('CREATE TABLE scm_item (id TEXT PRIMARY KEY, code TEXT)')

    up(db)
    up(db)

    const columns = db.prepare('PRAGMA table_info(scm_item)').all() as Array<{ name: string }>
    expect(columns.some(column => column.name === 'default_warehouse_code')).toBe(true)
  })
})
