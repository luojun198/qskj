import type Database from 'better-sqlite3'

function hasTable(db: Database.Database, tableName: string): boolean {
  const row = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`)
    .get(tableName)
  return !!row
}

function hasColumn(db: Database.Database, table: string, col: string): boolean {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  return cols.some(c => c.name === col)
}

export function up(db: Database.Database) {
  console.log('开始科目授权迁移...')

  if (!hasColumn(db, 'roles', 'account_scope_enabled')) {
    db.exec(`ALTER TABLE roles ADD COLUMN account_scope_enabled INTEGER NOT NULL DEFAULT 0`)
    console.log('✓ roles.account_scope_enabled')
  }

  if (!hasColumn(db, 'users', 'account_scope_enabled')) {
    db.exec(`ALTER TABLE users ADD COLUMN account_scope_enabled INTEGER NOT NULL DEFAULT 0`)
    console.log('✓ users.account_scope_enabled')
  }

  if (!hasTable(db, 'role_account_scopes')) {
    db.exec(`
      CREATE TABLE role_account_scopes (
        id TEXT PRIMARY KEY,
        role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
        account_set_id TEXT NOT NULL REFERENCES account_sets(id),
        account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        include_children INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(role_id, account_set_id, account_id)
      );
      CREATE INDEX idx_role_account_scopes_role ON role_account_scopes(role_id, account_set_id);
    `)
    console.log('✓ role_account_scopes 表')
  }

  if (!hasTable(db, 'user_account_scopes')) {
    db.exec(`
      CREATE TABLE user_account_scopes (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        account_set_id TEXT NOT NULL REFERENCES account_sets(id),
        account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        include_children INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(user_id, account_set_id, account_id)
      );
      CREATE INDEX idx_user_account_scopes_user ON user_account_scopes(user_id, account_set_id);
    `)
    console.log('✓ user_account_scopes 表')
  }

  console.log('✓ 科目授权迁移完成')
}

export function down(db: Database.Database) {
  db.exec('DROP TABLE IF EXISTS user_account_scopes')
  db.exec('DROP TABLE IF EXISTS role_account_scopes')
  // SQLite 不支持 DROP COLUMN，保留 enabled 字段
}
