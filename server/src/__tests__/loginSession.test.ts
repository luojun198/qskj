import { describe, expect, it, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import {
  expireSameIpActiveSessions,
  expireStaleLoginSessions,
  findOtherIpActiveSession,
  forceOtherIpActiveSessions,
  isSessionIdleExpired,
  listActiveLoginSessions,
} from '../services/loginSession.js'

describe('loginSession', () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    db.exec(`
      CREATE TABLE user_login_sessions (
        id TEXT PRIMARY KEY,
        account_set_id TEXT,
        user_id TEXT,
        username TEXT,
        login_ip TEXT,
        user_agent TEXT,
        login_at TEXT,
        last_seen_at TEXT,
        status TEXT,
        forced_logout_at TEXT,
        forced_by_ip TEXT
      );
    `)
    db.prepare(
      `INSERT INTO user_login_sessions VALUES (?, 'as1', 'u1', 'admin', ?, '', datetime('now'), datetime('now'), 'active', NULL, NULL)`
    ).run('s1', '192.168.0.10')
    db.prepare(
      `INSERT INTO user_login_sessions VALUES (?, 'as1', 'u1', 'admin', ?, '', datetime('now'), datetime('now'), 'active', NULL, NULL)`
    ).run('s2', '192.168.0.20')
  })

  it('同 IP 活跃会话不应视为冲突', () => {
    db.prepare(`DELETE FROM user_login_sessions`).run()
    db.prepare(
      `INSERT INTO user_login_sessions VALUES ('s1', 'as1', 'u1', 'admin', '192.168.0.10', '', datetime('now'), datetime('now'), 'active', NULL, NULL)`
    ).run()
    const sessions = listActiveLoginSessions(db, 'u1', 'as1')
    expect(findOtherIpActiveSession(sessions, '192.168.0.10')).toBeUndefined()
  })

  it('不同 IP 活跃会话应视为冲突', () => {
    const sessions = listActiveLoginSessions(db, 'u1', 'as1')
    const conflict = findOtherIpActiveSession(sessions, '192.168.0.10', db)
    expect(conflict?.id).toBe('s2')
  })

  it('空闲超过 8 小时的其他 IP 会话不应阻塞登录', () => {
    db.prepare(`DELETE FROM user_login_sessions`).run()
    db.prepare(
      `INSERT INTO user_login_sessions VALUES ('stale', 'as1', 'u1', 'admin', '192.168.0.20', '', datetime('now', '-2 days'), datetime('now', '-2 days'), 'active', NULL, NULL)`
    ).run()
    const sessions = listActiveLoginSessions(db, 'u1', 'as1')
    expect(findOtherIpActiveSession(sessions, '192.168.0.10', db)).toBeUndefined()
  })

  it('应静默过期同 IP 旧会话（管理清理用，登录流程不再调用）', () => {
    const sessions = listActiveLoginSessions(db, 'u1', 'as1')
    expireSameIpActiveSessions(db, sessions, '192.168.0.10')
    const s1 = db.prepare(`SELECT status FROM user_login_sessions WHERE id='s1'`).get() as any
    const s2 = db.prepare(`SELECT status FROM user_login_sessions WHERE id='s2'`).get() as any
    expect(s1.status).toBe('expired')
    expect(s2.status).toBe('active')
  })

  it('应按 last_seen_at 清理长期空闲会话', () => {
    db.prepare(`DELETE FROM user_login_sessions`).run()
    db.prepare(
      `INSERT INTO user_login_sessions VALUES ('old', 'as1', 'u1', 'admin', '127.0.0.1', '', datetime('now', '-10 days'), datetime('now', '-10 days'), 'active', NULL, NULL)`
    ).run()
    expireStaleLoginSessions(db, 'u1', 'as1')
    const row = db.prepare(`SELECT status FROM user_login_sessions WHERE id='old'`).get() as any
    expect(row.status).toBe('expired')
  })

  it('应识别空闲超时的 session', () => {
    db.prepare(`DELETE FROM user_login_sessions`).run()
    db.prepare(
      `INSERT INTO user_login_sessions VALUES ('idle', 'as1', 'u1', 'admin', '127.0.0.1', '', datetime('now', '-9 hours'), datetime('now', '-9 hours'), 'active', NULL, NULL)`
    ).run()
    const session = db
      .prepare(`SELECT last_seen_at FROM user_login_sessions WHERE id='idle'`)
      .get() as { last_seen_at: string }
    expect(isSessionIdleExpired(db, session.last_seen_at, false)).toBe(true)
    expect(isSessionIdleExpired(db, session.last_seen_at, true)).toBe(false)
  })

  it('强制登录只踢掉其他 IP 会话', () => {
    const sessions = listActiveLoginSessions(db, 'u1', 'as1')
    const forcedIp = forceOtherIpActiveSessions(db, sessions, '192.168.0.10', '192.168.0.10')
    expect(forcedIp).toBe('192.168.0.20')
    const s2 = db.prepare(`SELECT status FROM user_login_sessions WHERE id='s2'`).get() as any
    expect(s2.status).toBe('forced')
  })
})
