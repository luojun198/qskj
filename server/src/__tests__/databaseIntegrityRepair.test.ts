import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { repairDatabaseReferentialIntegrity } from '../services/databaseIntegrityRepair.js'

function createSchema(db: Database.Database) {
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE account_sets (id TEXT PRIMARY KEY, name TEXT);
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      account_set_id TEXT REFERENCES account_sets(id),
      username TEXT NOT NULL,
      role_id TEXT
    );
    CREATE TABLE roles (id TEXT PRIMARY KEY, account_set_id TEXT REFERENCES account_sets(id), code TEXT);
    CREATE TABLE user_roles (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      role_id TEXT NOT NULL REFERENCES roles(id),
      account_set_id TEXT NOT NULL REFERENCES account_sets(id)
    );
    CREATE TABLE user_login_sessions (
      id TEXT PRIMARY KEY,
      account_set_id TEXT NOT NULL REFERENCES account_sets(id),
      user_id TEXT NOT NULL REFERENCES users(id),
      username TEXT NOT NULL,
      status TEXT DEFAULT 'active',
      login_at TEXT DEFAULT (datetime('now')),
      last_seen_at TEXT DEFAULT (datetime('now'))
    );
  `)
}

describe('repairDatabaseReferentialIntegrity', () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    createSchema(db)
    db.prepare('INSERT INTO account_sets (id, name) VALUES (?, ?)').run('as1', '账套1')
    db.prepare('INSERT INTO roles (id, account_set_id, code) VALUES (?, ?, ?)').run('r1', 'as1', 'admin')
    db.prepare('INSERT INTO users (id, account_set_id, username, role_id) VALUES (?, ?, ?, ?)').run(
      'u1',
      'as1',
      'admin',
      'r-deleted'
    )
    db.pragma('foreign_keys = OFF')
    db.prepare(
      'INSERT INTO user_roles (id, user_id, role_id, account_set_id) VALUES (?, ?, ?, ?)'
    ).run('ur1', 'u1', 'r-deleted', 'as1')
    db.prepare(
      `INSERT INTO user_login_sessions (id, account_set_id, user_id, username, status)
       VALUES ('s1', 'as-missing', 'u1', 'admin', 'active')`
    ).run()
    db.pragma('foreign_keys = ON')
  })

  it('清理孤立 session 与 user_roles 后登录可写 session', () => {
    db.pragma('foreign_keys = OFF')
    const stats = repairDatabaseReferentialIntegrity(db)
    expect(stats.orphanLoginSessions).toBe(1)
    expect(stats.orphanUserRoles).toBe(1)

    db.pragma('foreign_keys = ON')
    expect(() => {
      db.prepare(
        `INSERT INTO user_login_sessions (id, account_set_id, user_id, username, status, login_at, last_seen_at)
         VALUES ('s2', 'as1', 'u1', 'admin', 'active', datetime('now'), datetime('now'))`
      ).run()
    }).not.toThrow()
  })
})
