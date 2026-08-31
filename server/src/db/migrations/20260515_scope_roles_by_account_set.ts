import type Database from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'
import { PRESET_ROLES } from '../permissions.js'

const ADMIN_HASH = '$2a$10$Dj9DCcIGNtjYZmfcub6td.wly0mkJT.bLPc.yeFAStW77WqkQu5ie' // admin123

function hasColumn(db: Database.Database, table: string, col: string) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  return cols.some(c => c.name === col)
}

export function up(db: Database.Database) {
  if (!hasColumn(db, 'roles', 'account_set_id')) {
    // 迁移到新 roles 表结构（按账套隔离）
    db.exec('PRAGMA foreign_keys = OFF;')

    db.exec(`
      ALTER TABLE roles RENAME TO roles_old;

      CREATE TABLE roles (
        id TEXT PRIMARY KEY,
        account_set_id TEXT REFERENCES account_sets(id),
        name TEXT NOT NULL,
        code TEXT NOT NULL,
        description TEXT,
        is_system INTEGER DEFAULT 0,
        permissions TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(account_set_id, code)
      );
    `)

    const accountSets = db.prepare('SELECT id FROM account_sets').all() as Array<{ id: string }>
    const oldRoles = db.prepare('SELECT * FROM roles_old').all() as any[]

    // oldRoleId + accountSetId -> newRoleId
    const roleMap = new Map<string, string>()

    const insertRole = db.prepare(
      `INSERT INTO roles (id, account_set_id, name, code, description, is_system, permissions, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')))`
    )

    for (const as of accountSets) {
      for (const r of oldRoles) {
        const newId = uuidv4()
        roleMap.set(`${r.id}::${as.id}`, newId)
        insertRole.run(
          newId,
          as.id,
          r.name,
          r.code,
          r.description,
          r.is_system || 0,
          r.permissions || '[]',
          r.created_at || null
        )
      }
    }

    // 重映射 users.role_id
    const users = db.prepare('SELECT id, account_set_id, role_id, username FROM users').all() as Array<{
      id: string
      account_set_id: string
      role_id: string | null
      username: string
    }>

    const updateUserRole = db.prepare('UPDATE users SET role_id = ? WHERE id = ?')

    for (const u of users) {
      if (!u.account_set_id) continue
      if (u.role_id) {
        const mapped = roleMap.get(`${u.role_id}::${u.account_set_id}`)
        if (mapped) {
          updateUserRole.run(mapped, u.id)
          continue
        }
      }

      // 没有 role 或映射失败：如果是 admin，强制绑定本账套 admin 角色
      if ((u.username || '').toLowerCase() === 'admin') {
        const adminRole = db
          .prepare('SELECT id FROM roles WHERE account_set_id = ? AND code = ? LIMIT 1')
          .get(u.account_set_id, 'admin') as { id: string } | undefined
        if (adminRole) updateUserRole.run(adminRole.id, u.id)
      }
    }

    db.exec('DROP TABLE roles_old;')

    // 补齐每个账套的预置角色（如果旧库 roles 不完整）
    const existingByAs = db
      .prepare('SELECT account_set_id, code FROM roles')
      .all() as Array<{ account_set_id: string; code: string }>
    const existingSet = new Set(existingByAs.map(r => `${r.account_set_id}::${r.code}`))

    const insertPreset = db.prepare(
      `INSERT OR IGNORE INTO roles (id, account_set_id, name, code, description, is_system, permissions)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )

    for (const as of accountSets) {
      for (const r of PRESET_ROLES) {
        const key = `${as.id}::${r.code}`
        if (existingSet.has(key)) continue
        insertPreset.run(uuidv4(), as.id, r.name, r.code, r.description, r.is_system, JSON.stringify(r.permissions))
      }

      // 确保每个账套有 admin 用户
      const adminExists = db
        .prepare('SELECT id FROM users WHERE account_set_id = ? AND username = ? LIMIT 1')
        .get(as.id, 'admin')
      if (!adminExists) {
        const adminRole = db
          .prepare('SELECT id FROM roles WHERE account_set_id = ? AND code = ? LIMIT 1')
          .get(as.id, 'admin') as { id: string } | undefined
        db.prepare(
          `INSERT INTO users (id, account_set_id, username, password, nickname, role_id, status, created_at, updated_at)
           VALUES (?, ?, 'admin', ?, '系统管理员', ?, 'active', datetime('now'), datetime('now'))`
        ).run(uuidv4(), as.id, ADMIN_HASH, adminRole?.id || null)
      }
    }

    db.exec('PRAGMA foreign_keys = ON;')
  }

  // 索引
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_roles_account_set_id ON roles(account_set_id);
    CREATE INDEX IF NOT EXISTS idx_roles_account_set_code ON roles(account_set_id, code);
  `)
}

export function down(db: Database.Database) {
  // 回滚：恢复全局 roles（不含 account_set_id），并将 users.role_id 指向第一个匹配 code 的全局 role
  db.exec('PRAGMA foreign_keys = OFF;')

  const hasAs = hasColumn(db, 'roles', 'account_set_id')
  if (!hasAs) {
    db.exec('PRAGMA foreign_keys = ON;')
    return
  }

  db.exec(`
    ALTER TABLE roles RENAME TO roles_scoped;

    CREATE TABLE roles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      code TEXT NOT NULL UNIQUE,
      description TEXT,
      is_system INTEGER DEFAULT 0,
      permissions TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `)

  // 使用第一个账套的角色集作为全局角色（避免重复 code）
  const firstAs = db.prepare('SELECT id FROM account_sets ORDER BY created_at ASC LIMIT 1').get() as any
  const asId = firstAs?.id || (db.prepare('SELECT id FROM account_sets LIMIT 1').get() as any)?.id

  if (asId) {
    const roles = db.prepare('SELECT * FROM roles_scoped WHERE account_set_id = ?').all(asId) as any[]
    const insert = db.prepare(
      `INSERT OR IGNORE INTO roles (id, name, code, description, is_system, permissions, created_at)
       VALUES (?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')))`
    )
    for (const r of roles) {
      insert.run(r.id, r.name, r.code, r.description, r.is_system || 0, r.permissions || '[]', r.created_at || null)
    }

    // 重新映射用户 role_id：按 code 找回全局角色 id
    const users = db.prepare('SELECT id, role_id FROM users').all() as Array<{ id: string; role_id: string | null }>
    const getCode = db.prepare('SELECT code FROM roles_scoped WHERE id = ?').get as any
    const getGlobalId = db.prepare('SELECT id FROM roles WHERE code = ?').get as any
    const updateUser = db.prepare('UPDATE users SET role_id = ? WHERE id = ?')

    for (const u of users) {
      if (!u.role_id) continue
      const codeRow = getCode(u.role_id) as { code: string } | undefined
      if (!codeRow?.code) continue
      const global = getGlobalId(codeRow.code) as { id: string } | undefined
      if (global?.id) updateUser.run(global.id, u.id)
    }
  }

  db.exec('DROP TABLE roles_scoped;')
  db.exec('PRAGMA foreign_keys = ON;')
}
