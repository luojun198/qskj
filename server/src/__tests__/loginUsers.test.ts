import { describe, it, expect, beforeEach, vi } from 'vitest'
import Database from 'better-sqlite3'
import { listActiveUsersForAccountSet } from '../services/loginUsers.js'

let testDb: Database.Database

vi.mock('../db/index.js', () => ({
  getDb: () => testDb,
  ensureUsersTableSchema: (db: Database.Database) => {
    const columns = db.prepare('PRAGMA table_info(users)').all() as Array<{ name: string }>
    const names = new Set(columns.map(c => c.name))
    if (!names.has('status')) {
      db.exec("ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'active'")
    }
    if (!names.has('nickname')) {
      db.exec('ALTER TABLE users ADD COLUMN nickname TEXT')
    }
  },
}))

describe('listActiveUsersForAccountSet', () => {
  beforeEach(() => {
    testDb = new Database(':memory:')
    testDb.exec(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        account_set_id TEXT,
        username TEXT NOT NULL,
        password TEXT NOT NULL
      );
    `)
    testDb.prepare(
      `INSERT INTO users (id, account_set_id, username, password) VALUES (?, ?, ?, ?)`
    ).run('u1', 'as1', 'admin', 'hash')
  })

  it('旧库无 status/nickname 列时仍可查询用户', () => {
    const users = listActiveUsersForAccountSet('as1')
    expect(users).toEqual([{ username: 'admin', nickname: '' }])
  })

  it('有 status 列时仅返回 active 用户', () => {
    testDb.exec("ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'active'")
    testDb.exec('ALTER TABLE users ADD COLUMN nickname TEXT')
    testDb.prepare(
      `INSERT INTO users (id, account_set_id, username, password, status, nickname)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run('u2', 'as1', 'disabled_user', 'hash', 'disabled', '禁用')

    const users = listActiveUsersForAccountSet('as1')
    expect(users.map(u => u.username)).toEqual(['admin'])
  })
})
