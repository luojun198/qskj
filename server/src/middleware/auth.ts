import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import { getDb } from '../db/index.js'
import { getRequestIp } from '../utils/requestIp.js'
import { resolveUserPermissions } from '../services/userRoleLinks.js'
import {
  resolveUserAccountScope,
  type AccountScopeContext,
} from '../services/accountAuthorization.js'
import { isSessionIdleExpired } from '../services/loginSession.js'

// FIX-013 / P1-21：last_seen_at 节流
//
// 每个 sessionId 的 UPDATE 不能更频繁于 LAST_SEEN_THROTTLE_MS（60s）。
// 内存 Map 保存最近一次写入时刻。多进程部署时各进程独立节流；可接受 ——
// last_seen_at 仅用于"会话空闲过期"检测，分钟级精度足够。
const LAST_SEEN_THROTTLE_MS = 60_000
const lastSeenWrittenAt = new Map<string, number>()
function shouldUpdateLastSeen(sessionId: string): boolean {
  const now = Date.now()
  const last = lastSeenWrittenAt.get(sessionId) ?? 0
  if (now - last < LAST_SEEN_THROTTLE_MS) return false
  lastSeenWrittenAt.set(sessionId, now)
  return true
}
/** 测试场景：清空节流缓存（生产代码不应调用） */
export function __resetLastSeenThrottleForTest() {
  lastSeenWrittenAt.clear()
}

// Lazy-load JWT_SECRET to avoid ESM import hoisting issues:
// In ESM, all static imports are resolved before any code runs,
// so dotenv.config() in index.ts hasn't executed yet when this module loads.
// Using a getter defers the check until first actual use.
let _jwtSecret: string | undefined
function getJwtSecret(): string {
  if (!_jwtSecret) {
    _jwtSecret = process.env.JWT_SECRET
    if (!_jwtSecret) {
      throw new Error(
        'FATAL: JWT_SECRET is not set. ' +
          'Ensure dotenv.config() runs before any auth check, or set JWT_SECRET in environment.'
      )
    }
  }
  return _jwtSecret
}

export interface AuthRequest extends Request {
  userId?: string
  userName?: string
  accountSetId?: string
  roleId?: string
  sessionId?: string
  remember?: boolean
  permissions?: string[]
  accountScope?: AccountScopeContext
}

export function authMiddleware(req: AuthRequest, res: Response, next: NextFunction) {
  const token = req.headers.authorization?.replace('Bearer ', '')
  if (!token) {
    return res.status(401).json({ code: 401, message: '未登录' })
  }

  let payload: {
    userId?: string
    userName?: string
    accountSetId?: string
    roleId?: string
    sessionId?: string
    remember?: boolean
  }
  try {
    payload = jwt.verify(token, getJwtSecret()) as typeof payload
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      return res.status(401).json({ code: 401, message: '登录已过期' })
    }
    return res.status(401).json({ code: 401, message: 'Token 无效' })
  }

  req.userId = payload.userId
  req.userName = payload.userName
  req.accountSetId = payload.accountSetId
  req.roleId = payload.roleId
  req.sessionId = payload.sessionId
  req.remember = !!payload.remember

  if (!payload.sessionId) {
    return res.status(401).json({ code: 40101, message: '登录已失效，请重新登录' })
  }

  try {
    const db = getDb()
    const session = db
      .prepare(
        `SELECT id, status, last_seen_at
         FROM user_login_sessions
         WHERE id = ? AND user_id = ? AND account_set_id = ?
         LIMIT 1`
      )
      .get(payload.sessionId, payload.userId, payload.accountSetId) as
      | { id: string; status: string; last_seen_at: string }
      | undefined

    if (!session || session.status !== 'active') {
      return res.status(401).json({ code: 40101, message: '账号已在其他地方登录，请重新登录' })
    }

    if (isSessionIdleExpired(db, session.last_seen_at, req.remember)) {
      db.prepare(
        `UPDATE user_login_sessions
         SET status = 'expired', last_seen_at = datetime('now')
         WHERE id = ? AND status = 'active'`
      ).run(payload.sessionId)
      return res.status(401).json({ code: 401, message: '登录已过期，请重新登录' })
    }

    // FIX-013 / P1-21：节流写入，避免每次 API 请求都打 SQLite 写锁
    if (shouldUpdateLastSeen(payload.sessionId)) {
      db.prepare(
        `UPDATE user_login_sessions
         SET last_seen_at = datetime('now'), login_ip = COALESCE(NULLIF(login_ip, ''), ?)
         WHERE id = ?`
      ).run(getRequestIp(req), payload.sessionId)
    }

    // 查询用户的所有角色权限（从 user_roles 表，回退 users.role_id）
    const userRecord = db
      .prepare(
        `SELECT role_id, custom_permissions, status, locked_until
         FROM users
         WHERE id = ? AND account_set_id = ?
         LIMIT 1`
      )
      .get(payload.userId, payload.accountSetId) as
      | { role_id: string | null; custom_permissions: string | null; status: string; locked_until: string | null }
      | undefined

    // FIX：登录后被禁用/锁定/删除的用户，凭现有 active token 不得继续访问（与登录处判定一致）
    const isUserLocked = !!userRecord?.locked_until && new Date(userRecord.locked_until) > new Date()
    if (!userRecord || userRecord.status !== 'active' || isUserLocked) {
      db.prepare(
        `UPDATE user_login_sessions
         SET status = 'logout', last_seen_at = datetime('now')
         WHERE id = ? AND status = 'active'`
      ).run(payload.sessionId)
      return res.status(401).json({ code: 401, message: '账号已被禁用或锁定，请重新登录' })
    }

    req.permissions = resolveUserPermissions(db, {
      userId: payload.userId!,
      accountSetId: payload.accountSetId!,
      roleId: userRecord?.role_id,
      customPermissions: userRecord?.custom_permissions,
    })

    req.accountScope = resolveUserAccountScope(db, {
      userId: payload.userId!,
      accountSetId: payload.accountSetId!,
      roleId: userRecord?.role_id,
      permissions: req.permissions,
    })

    next()
  } catch (error) {
    console.error('[auth] session check failed:', error)
    return res.status(503).json({ code: 503, message: '服务繁忙，请稍后重试' })
  }
}

export function requirePermission(permission: string) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.permissions?.includes('*') && !req.permissions?.includes(permission)) {
      return res.status(403).json({ code: 403, message: '无此操作权限' })
    }
    next()
  }
}

export function requireAnyPermission(...permissions: string[]) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (req.permissions?.includes('*')) return next()
    const hasAny = permissions.some(p => req.permissions?.includes(p))
    if (!hasAny) {
      return res.status(403).json({ code: 403, message: '无此操作权限' })
    }
    next()
  }
}

export function requireAllPermissions(...permissions: string[]) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (req.permissions?.includes('*')) return next()
    const hasAll = permissions.every(p => req.permissions?.includes(p))
    if (!hasAll) {
      return res.status(403).json({ code: 403, message: '无此操作权限' })
    }
    next()
  }
}

export function generateToken(payload: {
  userId: string
  userName: string
  accountSetId: string
  roleId: string
  sessionId?: string
  remember?: boolean
  permissions?: string[]
}) {
  // FIX-017：若调用方已显式传入 permissions，则直接使用；否则从 DB 解析。
  // 旧实现无视 payload.permissions，每次都强制从 DB 拉取，导致：
  //   1) 测试用例无法独立运行（需要预先 seed 用户/角色）
  //   2) 显式权限注入场景（如 ACD 导入临时 token、超级管理员调试）失效
  let permissions: string[]
  if (Array.isArray(payload.permissions) && payload.permissions.length > 0) {
    permissions = payload.permissions
  } else {
    const db = getDb()
    const userRecord = db
      .prepare(
        `SELECT role_id, custom_permissions
         FROM users
         WHERE id = ? AND account_set_id = ?
         LIMIT 1`
      )
      .get(payload.userId, payload.accountSetId) as
      | { role_id: string | null; custom_permissions: string | null }
      | undefined

    permissions = resolveUserPermissions(db, {
      userId: payload.userId,
      accountSetId: payload.accountSetId,
      roleId: userRecord?.role_id,
      customPermissions: userRecord?.custom_permissions,
    })
  }

  const tokenPayload = {
    ...payload,
    permissions,
    remember: !!payload.remember,
  }

  const expiresIn = payload.remember ? '7d' : '8h'
  return jwt.sign(tokenPayload, getJwtSecret(), { expiresIn })
}

export { getJwtSecret as JWT_SECRET }
