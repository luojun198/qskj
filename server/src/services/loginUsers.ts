import type { Database } from 'better-sqlite3'
import { getDb, ensureUsersTableSchema } from '../db/index.js'

export interface LoginUserItem {
  username: string
  nickname: string
}

function usersTableColumns(database: Database): Set<string> {
  return new Set(
    (database.prepare('PRAGMA table_info(users)').all() as Array<{ name: string }>).map(
      column => column.name
    )
  )
}

/** 登录页：按账套列出可登录用户（兼容缺少 status/nickname 的旧库） */
export function listActiveUsersForAccountSet(accountSetId: string): LoginUserItem[] {
  const database = getDb()
  ensureUsersTableSchema(database)

  const columns = usersTableColumns(database)
  if (!columns.has('account_set_id')) {
    throw new Error('users 表缺少 account_set_id 列')
  }

  const selectNickname = columns.has('nickname')
    ? "COALESCE(nickname, '') AS nickname"
    : "'' AS nickname"
  let sql = `SELECT username, ${selectNickname} FROM users WHERE account_set_id = ?`
  if (columns.has('status')) {
    sql += ` AND status = 'active'`
  }
  sql += ' ORDER BY username'

  return database.prepare(sql).all(accountSetId) as LoginUserItem[]
}
