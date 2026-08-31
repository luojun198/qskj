import type { Database } from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'
import { getDb } from '../db/index.js'

export interface UserPermissionContext {
  userId: string
  accountSetId: string
  roleId?: string | null
  customPermissions?: string | null
}

export interface ResolvedUserRole {
  id: string
  code: string
  name: string
  permissions: string | null
}

function hasUserRolesTable(database: Database): boolean {
  const row = database
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'user_roles'`)
    .get() as { name: string } | undefined
  return !!row
}

/** 确保 users.role_id 在 user_roles 中有对应关联（兼容多角色迁移后的旧创建路径） */
export function ensureUserRoleLink(
  database: Database,
  userId: string,
  roleId: string | null | undefined,
  accountSetId: string
) {
  if (!roleId || !hasUserRolesTable(database)) return

  const role = database
    .prepare('SELECT id FROM roles WHERE id = ? AND account_set_id = ?')
    .get(roleId, accountSetId) as { id: string } | undefined
  if (!role) {
    if (database.prepare('PRAGMA table_info(users)').all().some((c: { name: string }) => c.name === 'role_id')) {
      database.prepare('UPDATE users SET role_id = NULL WHERE id = ?').run(userId)
    }
    return
  }

  database
    .prepare(
      `INSERT OR IGNORE INTO user_roles (id, user_id, role_id, account_set_id)
       VALUES (?, ?, ?, ?)`
    )
    .run(uuidv4(), userId, roleId, accountSetId)
}

/** 将账套内所有带 role_id 的用户同步到 user_roles */
export function syncAccountSetUserRoleLinks(accountSetId: string, database: Database = getDb()) {
  if (!hasUserRolesTable(database)) return

  const users = database
    .prepare(
      `SELECT id, role_id, account_set_id
       FROM users
       WHERE account_set_id = ? AND role_id IS NOT NULL`
    )
    .all(accountSetId) as Array<{ id: string; role_id: string; account_set_id: string }>

  for (const user of users) {
    try {
      ensureUserRoleLink(database, user.id, user.role_id, user.account_set_id)
    } catch {
      /* 跳过无效 role_id，由 repairDatabaseReferentialIntegrity 统一清理 */
    }
  }
}

/** 登录前校验：至少配置了 user_roles、custom_permissions 或 role_id 之一 */
export function userHasLoginPermissionConfig(
  database: Database,
  user: { id: string; role_id?: string | null; custom_permissions?: string | null },
  accountSetId: string
): boolean {
  if (user.custom_permissions) {
    try {
      if (JSON.parse(user.custom_permissions).length > 0) return true
    } catch {
      /* ignore */
    }
  }

  if (user.role_id) return true

  if (!hasUserRolesTable(database)) return false

  const hasRoles = database
    .prepare('SELECT COUNT(*) as count FROM user_roles WHERE user_id = ? AND account_set_id = ?')
    .get(user.id, accountSetId) as { count: number }

  return hasRoles.count > 0
}

function parsePermissionsJson(raw: string | null | undefined): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

/** 合并 user_roles + role_id + custom_permissions 得到最终权限列表 */
export function resolveUserPermissions(
  database: Database,
  context: UserPermissionContext
): string[] {
  const permissionSet = new Set<string>()

  if (hasUserRolesTable(database)) {
    const userRoles = database
      .prepare(
        `SELECT r.permissions
         FROM user_roles ur
         JOIN roles r ON ur.role_id = r.id
         WHERE ur.user_id = ? AND ur.account_set_id = ?`
      )
      .all(context.userId, context.accountSetId) as Array<{ permissions: string | null }>

    for (const role of userRoles) {
      parsePermissionsJson(role.permissions).forEach(p => permissionSet.add(p))
    }
  }

  if (permissionSet.size === 0 && context.roleId) {
    const role = database
      .prepare('SELECT permissions FROM roles WHERE id = ? AND account_set_id = ?')
      .get(context.roleId, context.accountSetId) as { permissions: string | null } | undefined
    parsePermissionsJson(role?.permissions).forEach(p => permissionSet.add(p))
  }

  parsePermissionsJson(context.customPermissions).forEach(p => permissionSet.add(p))

  return Array.from(permissionSet)
}

/** 获取登录响应所需的角色信息（优先 user_roles，回退 role_id） */
export function resolvePrimaryUserRole(
  database: Database,
  context: UserPermissionContext
): ResolvedUserRole | null {
  if (hasUserRolesTable(database)) {
    const roleFromLinks = database
      .prepare(
        `SELECT r.id, r.code, r.name, r.permissions
         FROM user_roles ur
         JOIN roles r ON ur.role_id = r.id
         WHERE ur.user_id = ? AND ur.account_set_id = ?
         ORDER BY ur.created_at
         LIMIT 1`
      )
      .get(context.userId, context.accountSetId) as ResolvedUserRole | undefined

    if (roleFromLinks) return roleFromLinks
  }

  if (!context.roleId) return null

  return (
    (database
      .prepare(
        `SELECT id, code, name, permissions
         FROM roles
         WHERE id = ? AND account_set_id = ?
         LIMIT 1`
      )
      .get(context.roleId, context.accountSetId) as ResolvedUserRole | undefined) || null
  )
}
