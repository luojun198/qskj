import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { cleanupAccountSetCascade } from '../services/accountSetCleanup.js'

function createSchema(db: Database.Database) {
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE account_sets (id TEXT PRIMARY KEY, name TEXT);
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      account_set_id TEXT REFERENCES account_sets(id),
      username TEXT NOT NULL,
      password TEXT NOT NULL
    );
    CREATE TABLE roles (
      id TEXT PRIMARY KEY,
      account_set_id TEXT REFERENCES account_sets(id),
      code TEXT NOT NULL,
      owner_user_id TEXT REFERENCES users(id)
    );
    CREATE TABLE user_roles (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
      account_set_id TEXT NOT NULL REFERENCES account_sets(id)
    );
    CREATE TABLE accounts (
      id TEXT PRIMARY KEY,
      account_set_id TEXT NOT NULL REFERENCES account_sets(id),
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      direction TEXT NOT NULL DEFAULT 'debit',
      level INTEGER DEFAULT 1
    );
    CREATE TABLE role_account_scopes (
      id TEXT PRIMARY KEY,
      role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
      account_set_id TEXT NOT NULL REFERENCES account_sets(id),
      account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      include_children INTEGER DEFAULT 1
    );
    CREATE TABLE aux_categories (
      id TEXT PRIMARY KEY,
      account_set_id TEXT NOT NULL REFERENCES account_sets(id),
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      default_item_id TEXT
    );
    CREATE TABLE aux_category_fields (
      id TEXT PRIMARY KEY,
      category_id TEXT NOT NULL REFERENCES aux_categories(id) ON DELETE CASCADE,
      field_key TEXT NOT NULL,
      field_name TEXT NOT NULL,
      field_type TEXT DEFAULT 'text'
    );
    CREATE TABLE aux_items (
      id TEXT PRIMARY KEY,
      account_set_id TEXT NOT NULL REFERENCES account_sets(id),
      type TEXT NOT NULL REFERENCES aux_categories(id),
      code TEXT NOT NULL,
      name TEXT NOT NULL
    );
  `)
}

describe('cleanupAccountSetCascade', () => {
  let db: Database.Database
  const accountSetId = 'as-1'

  beforeEach(() => {
    db = new Database(':memory:')
    createSchema(db)
    db.prepare('INSERT INTO account_sets (id, name) VALUES (?, ?)').run(accountSetId, '测试账套')
    db.prepare(
      'INSERT INTO users (id, account_set_id, username, password) VALUES (?, ?, ?, ?)'
    ).run('u1', accountSetId, 'admin', 'hash')
    db.prepare('INSERT INTO roles (id, account_set_id, code, owner_user_id) VALUES (?, ?, ?, ?)').run(
      'r1',
      accountSetId,
      'admin',
      'u1'
    )
    db.prepare('INSERT INTO user_roles (id, user_id, role_id, account_set_id) VALUES (?, ?, ?, ?)').run(
      'ur1',
      'u1',
      'r1',
      accountSetId
    )
    db.prepare(
      'INSERT INTO accounts (id, account_set_id, code, name, direction) VALUES (?, ?, ?, ?, ?)'
    ).run('a1', accountSetId, '1001', '现金', 'debit')
    db.prepare(
      'INSERT INTO role_account_scopes (id, role_id, account_set_id, account_id) VALUES (?, ?, ?, ?)'
    ).run('ras1', 'r1', accountSetId, 'a1')
    db.prepare('INSERT INTO aux_categories (id, account_set_id, code, name) VALUES (?, ?, ?, ?)').run(
      'c1',
      accountSetId,
      'dept',
      '部门'
    )
    db.prepare(
      'INSERT INTO aux_category_fields (id, category_id, field_key, field_name) VALUES (?, ?, ?, ?)'
    ).run('cf1', 'c1', 'ext', '扩展')
    db.prepare('INSERT INTO aux_items (id, account_set_id, type, code, name) VALUES (?, ?, ?, ?, ?)').run(
      'i1',
      accountSetId,
      'c1',
      '01',
      '本部'
    )
  })

  it('应删除含 user_roles / role_account_scopes 的账套且不触发外键错误', () => {
    expect(() => cleanupAccountSetCascade(db, accountSetId)).not.toThrow()
    const left = db.prepare('SELECT id FROM account_sets WHERE id = ?').get(accountSetId)
    expect(left).toBeUndefined()
    expect((db.prepare('SELECT COUNT(*) as c FROM user_roles').get() as { c: number }).c).toBe(0)
  })
})
