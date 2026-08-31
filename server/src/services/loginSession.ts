import type Database from 'better-sqlite3'
import { isSameLoginIp, toDisplayIp } from '../utils/requestIp.js'

export type ActiveLoginSession = {
  id: string
  login_ip: string | null
  login_at: string
  last_seen_at: string
}

/** 与 authMiddleware 默认会话空闲策略一致（非「记住我」为 8 小时） */
export const DEFAULT_SESSION_IDLE_MODIFIER = '-8 hours'

export function expireStaleLoginSessions(
  db: Database.Database,
  userId: string,
  accountSetId: string,
  idleModifier = DEFAULT_SESSION_IDLE_MODIFIER
) {
  db.prepare(
    `UPDATE user_login_sessions
     SET status = 'expired'
     WHERE user_id = ? AND account_set_id = ? AND status = 'active'
       AND last_seen_at <= datetime('now', ?)`
  ).run(userId, accountSetId, idleModifier)
}

/** 服务启动时清理全局僵尸会话（status 仍为 active 但早已无实际连接） */
export function expireAllStaleLoginSessions(
  db: Database.Database,
  idleModifier = DEFAULT_SESSION_IDLE_MODIFIER
) {
  const result = db
    .prepare(
      `UPDATE user_login_sessions
       SET status = 'expired'
       WHERE status = 'active'
         AND last_seen_at <= datetime('now', ?)`
    )
    .run(idleModifier)
  return result.changes
}

/** Session 空闲超过阈值则视为过期（按 last_seen_at 滑动窗口，与 SQLite 时间一致） */
export function isSessionIdleExpired(
  db: Database.Database,
  lastSeenAt: string | null | undefined,
  remember: boolean
): boolean {
  if (!lastSeenAt) return true
  const idleModifier = remember ? '-7 days' : '-8 hours'
  const row = db
    .prepare(`SELECT 1 AS stale WHERE datetime(?) <= datetime('now', ?)`)
    .get(lastSeenAt, idleModifier) as { stale: number } | undefined
  return !!row
}

export function listActiveLoginSessions(
  db: Database.Database,
  userId: string,
  accountSetId: string,
  excludeSessionId?: string
): ActiveLoginSession[] {
  if (excludeSessionId) {
    return db
      .prepare(
        `SELECT id, login_ip, login_at, last_seen_at
         FROM user_login_sessions
         WHERE user_id = ? AND account_set_id = ? AND status = 'active' AND id <> ?
         ORDER BY last_seen_at DESC, login_at DESC`
      )
      .all(userId, accountSetId, excludeSessionId) as ActiveLoginSession[]
  }

  return db
    .prepare(
      `SELECT id, login_ip, login_at, last_seen_at
       FROM user_login_sessions
       WHERE user_id = ? AND account_set_id = ? AND status = 'active'
       ORDER BY last_seen_at DESC, login_at DESC`
    )
    .all(userId, accountSetId) as ActiveLoginSession[]
}

export function findOtherIpActiveSession(
  sessions: ActiveLoginSession[],
  currentLoginIp: string,
  db?: Database.Database
): ActiveLoginSession | undefined {
  return sessions.find(session => {
    if (isSameLoginIp(session.login_ip, currentLoginIp)) return false
    // 超过默认空闲阈值的会话在中间件侧已失效，不应再阻塞新登录
    if (db && isSessionIdleExpired(db, session.last_seen_at, false)) return false
    return true
  })
}

/** @deprecated 同 IP 多标签不再互踢，保留供管理端清理使用 */
export function expireSameIpActiveSessions(
  db: Database.Database,
  sessions: ActiveLoginSession[],
  currentLoginIp: string
) {
  const stmt = db.prepare(
    `UPDATE user_login_sessions
     SET status = 'expired', last_seen_at = datetime('now')
     WHERE id = ? AND status = 'active'`
  )
  for (const session of sessions) {
    if (isSameLoginIp(session.login_ip, currentLoginIp)) {
      stmt.run(session.id)
    }
  }
}

export function forceOtherIpActiveSessions(
  db: Database.Database,
  sessions: ActiveLoginSession[],
  currentLoginIp: string,
  forcedByIp: string
): string | null {
  const others = sessions.filter(session => !isSameLoginIp(session.login_ip, currentLoginIp))
  if (others.length === 0) return null

  const stmt = db.prepare(
    `UPDATE user_login_sessions
     SET status = 'forced', forced_logout_at = datetime('now'), forced_by_ip = ?
     WHERE id = ? AND status = 'active'`
  )
  for (const session of others) {
    stmt.run(forcedByIp, session.id)
  }

  return others[0].login_ip ? toDisplayIp(others[0].login_ip) : null
}
