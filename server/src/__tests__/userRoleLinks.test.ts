import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { v4 as uuidv4 } from 'uuid'
import Database from 'better-sqlite3'
import {
  ensureUserRoleLink,
  resolvePrimaryUserRole,
  resolveUserPermissions,
  syncAccountSetUserRoleLinks,
  userHasLoginPermissionConfig,
} from '../services/userRoleLinks.js'

describe('userRoleLinks', () => {
  let db: Database.Database
  let accountSetId: string
  let roleId: string
  let userId: string

  beforeEach(() => {
    db = new Database(':memory:')
    accountSetId = uuidv4()
    roleId = uuidv4()
    userId = uuidv4()

    db.exec(`
      CREATE TABLE account_sets (id TEXT PRIMARY KEY);
      CREATE TABLE roles (
        id TEXT PRIMARY KEY,
        account_set_id TEXT NOT NULL,
        code TEXT NOT NULL,
        name TEXT NOT NULL,
        permissions TEXT
      );
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        account_set_id TEXT NOT NULL,
        username TEXT NOT NULL,
        password TEXT NOT NULL,
        nickname TEXT,
        role_id TEXT,
        custom_permissions TEXT,
        status TEXT DEFAULT 'active'
      );
      CREATE TABLE user_roles (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        role_id TEXT NOT NULL,
        account_set_id TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(user_id, role_id, account_set_id)
      );
    `)

    db.prepare('INSERT INTO account_sets (id) VALUES (?)').run(accountSetId)
    db.prepare(
      `INSERT INTO roles (id, account_set_id, code, name, permissions)
       VALUES (?, ?, 'admin', '系统管理员', ?)`
    ).run(roleId, accountSetId, JSON.stringify(['*']))
    db.prepare(
      `INSERT INTO users (id, account_set_id, username, password, nickname, role_id)
       VALUES (?, ?, 'admin', 'hash', '系统管理员', ?)`
    ).run(userId, accountSetId, roleId)
  })

  afterEach(() => {
    db.close()
  })

  it('允许仅有 role_id 的用户通过登录权限校验', () => {
    expect(userHasLoginPermissionConfig(db, { id: userId, role_id: roleId }, accountSetId)).toBe(true)
  })

  it('syncAccountSetUserRoleLinks 会把 role_id 同步到 user_roles', () => {
    syncAccountSetUserRoleLinks(accountSetId, db)

    const count = db
      .prepare('SELECT COUNT(*) as count FROM user_roles WHERE user_id = ?')
      .get(userId) as { count: number }

    expect(count.count).toBe(1)
  })

  it('resolveUserPermissions 在缺少 user_roles 时回退 role_id', () => {
    const permissions = resolveUserPermissions(db, {
      userId,
      accountSetId,
      roleId,
    })

    expect(permissions).toEqual(['*'])
  })

  it('允许仅有 custom_permissions 的用户通过登录权限校验', () => {
    const customUserId = uuidv4()
    db.prepare(
      `INSERT INTO users (id, account_set_id, username, password, nickname, role_id, custom_permissions)
       VALUES (?, ?, 'custom', 'hash', '自定义用户', NULL, ?)`
    ).run(customUserId, accountSetId, JSON.stringify(['voucher:read', 'ledger:read']))

    expect(
      userHasLoginPermissionConfig(
        db,
        { id: customUserId, role_id: null, custom_permissions: JSON.stringify(['voucher:read']) },
        accountSetId
      )
    ).toBe(true)
  })

  it('resolveUserPermissions 在无角色时使用 custom_permissions', () => {
    const customUserId = uuidv4()
    const customPerms = JSON.stringify(['voucher:read', 'ledger:read'])
    db.prepare(
      `INSERT INTO users (id, account_set_id, username, password, nickname, role_id, custom_permissions)
       VALUES (?, ?, 'custom', 'hash', '自定义用户', NULL, ?)`
    ).run(customUserId, accountSetId, customPerms)

    const permissions = resolveUserPermissions(db, {
      userId: customUserId,
      accountSetId,
      roleId: null,
      customPermissions: customPerms,
    })

    expect(permissions).toEqual(['voucher:read', 'ledger:read'])
  })

  it('resolvePrimaryUserRole 在无角色时返回 null', () => {
    const customUserId = uuidv4()
    db.prepare(
      `INSERT INTO users (id, account_set_id, username, password, nickname, role_id, custom_permissions)
       VALUES (?, ?, 'custom', 'hash', '自定义用户', NULL, ?)`
    ).run(customUserId, accountSetId, JSON.stringify(['voucher:read']))

    const role = resolvePrimaryUserRole(db, {
      userId: customUserId,
      accountSetId,
      roleId: null,
      customPermissions: JSON.stringify(['voucher:read']),
    })

    expect(role).toBeNull()
  })
})
