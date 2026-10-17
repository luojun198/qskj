import type { Request, Response, NextFunction } from 'express'
import { getDb } from '../db/index.js'
import { isLoopbackIp } from '../utils/requestIp.js'
import { authMiddleware, type AuthRequest } from './auth.js'

/**
 * SEC-1：登录页「新建账套 / 标准模板建账 / 备份导入 / ACD 导入」的访问守卫。
 *
 * 这几条接口在登录前使用，不能直接挂 authMiddleware；但完全公开时，能访问 3105 端口的人
 * 都可以往库里塞整套账和 admin/admin123 用户。放行条件（任一满足）：
 *   1. 库里还没有任何账套（首次初始化）；
 *   2. 请求来自服务器本机（按 TCP 连接地址判断，不信任 X-Forwarded-For 等可伪造的头）；
 *   3. 带有效登录 token，且有「套账管理」权限；
 *   4. 环境变量 ALLOW_REMOTE_ACCOUNT_SET_CREATE=1（需要局域网登录页建账时手工打开）。
 */
export function accountSetCreateGuard(req: Request, res: Response, next: NextFunction) {
  if (process.env.ALLOW_REMOTE_ACCOUNT_SET_CREATE === '1') return next()

  try {
    const row = getDb().prepare('SELECT COUNT(*) AS c FROM account_sets').get() as { c: number }
    if (!row || Number(row.c) === 0) return next()
  } catch {
    // 账套表还不存在（全新库）同样视为首次初始化
    return next()
  }

  if (isLoopbackIp(req.socket?.remoteAddress)) return next()

  const deny = () =>
    res.status(403).json({
      code: 403,
      message: '只能在服务器本机新建或导入账套；其他电脑请先登录，由有「套账管理」权限的操作员办理',
    })

  if (!req.headers.authorization) return deny()
  return authMiddleware(req as AuthRequest, res, () => {
    const perms = (req as AuthRequest).permissions || []
    if (perms.includes('*') || perms.includes('system:account')) return next()
    return deny()
  })
}
