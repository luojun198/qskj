import type { Database } from 'better-sqlite3'

function tableExists(db: Database, table: string): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
    .get(table) as { name?: string } | undefined
  return !!row?.name
}

function columnExists(db: Database, table: string, column: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  return rows.some(row => row.name === column)
}

export type ReferentialIntegrityRepairStats = {
  orphanLoginSessions: number
  orphanUserRoles: number
  orphanRoleAccountScopes: number
  orphanUserAccountScopes: number
  clearedInvalidUserRoleId: number
  clearedInvalidRoleOwner: number
  orphanUsers: number
}

/**
 * 清理孤立外键数据（多由账套删除不完整或历史 FK=OFF 删除导致）。
 * 服务启动与登录前调用，避免 FOREIGN KEY constraint failed。
 */
export function repairDatabaseReferentialIntegrity(
  db: Database
): ReferentialIntegrityRepairStats {
  const stats: ReferentialIntegrityRepairStats = {
    orphanLoginSessions: 0,
    orphanUserRoles: 0,
    orphanRoleAccountScopes: 0,
    orphanUserAccountScopes: 0,
    clearedInvalidUserRoleId: 0,
    clearedInvalidRoleOwner: 0,
    orphanUsers: 0,
  }

  if (!tableExists(db, 'account_sets')) return stats

  db.pragma('foreign_keys = OFF')
  try {
    const run = db.transaction(() => {
      if (tableExists(db, 'user_login_sessions')) {
        stats.orphanLoginSessions = db
          .prepare(
            `DELETE FROM user_login_sessions
             WHERE account_set_id NOT IN (SELECT id FROM account_sets)
                OR user_id NOT IN (SELECT id FROM users)`
          )
          .run().changes
      }

      if (tableExists(db, 'user_roles')) {
        stats.orphanUserRoles = db
          .prepare(
            `DELETE FROM user_roles
             WHERE account_set_id NOT IN (SELECT id FROM account_sets)
                OR user_id NOT IN (SELECT id FROM users)
                OR role_id NOT IN (SELECT id FROM roles)`
          )
          .run().changes
      }

      if (tableExists(db, 'role_account_scopes')) {
        stats.orphanRoleAccountScopes = db
          .prepare(
            `DELETE FROM role_account_scopes
             WHERE account_set_id NOT IN (SELECT id FROM account_sets)
                OR role_id NOT IN (SELECT id FROM roles)
                OR account_id NOT IN (SELECT id FROM accounts)`
          )
          .run().changes
      }

      if (tableExists(db, 'user_account_scopes')) {
        stats.orphanUserAccountScopes = db
          .prepare(
            `DELETE FROM user_account_scopes
             WHERE account_set_id NOT IN (SELECT id FROM account_sets)
                OR user_id NOT IN (SELECT id FROM users)
                OR account_id NOT IN (SELECT id FROM accounts)`
          )
          .run().changes
      }

      if (tableExists(db, 'users') && columnExists(db, 'users', 'role_id')) {
        stats.clearedInvalidUserRoleId = db
          .prepare(
            `UPDATE users SET role_id = NULL
             WHERE role_id IS NOT NULL
               AND role_id NOT IN (SELECT id FROM roles)`
          )
          .run().changes
      }

      if (tableExists(db, 'roles') && columnExists(db, 'roles', 'owner_user_id')) {
        stats.clearedInvalidRoleOwner = db
          .prepare(
            `UPDATE roles SET owner_user_id = NULL
             WHERE owner_user_id IS NOT NULL
               AND owner_user_id NOT IN (SELECT id FROM users)`
          )
          .run().changes
      }

      if (tableExists(db, 'users')) {
        stats.orphanUsers = db
          .prepare(
            `DELETE FROM users
             WHERE account_set_id IS NOT NULL
               AND account_set_id NOT IN (SELECT id FROM account_sets)`
          )
          .run().changes
      }
    })
    run()
  } finally {
    db.pragma('foreign_keys = ON')
  }

  return stats
}
