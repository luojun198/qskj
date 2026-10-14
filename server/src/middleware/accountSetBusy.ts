import type { Request, Response, NextFunction } from 'express'
import {
  getAccountSetDeleteJob,
  isAccountSetDeleting,
  toProgressPayload,
} from '../services/accountSetDeleteJob.js'

export const DELETE_PROGRESS_PATH = '/api/system/account-sets/delete-progress'

/**
 * 删除账套期间锁定服务：删除是跨多次事件循环的未提交事务，
 * 其它请求的读写不能混入。进度查询免登录放行（删除自身会清掉登录会话），只返回非敏感进度信息。
 */
export function accountSetBusyMiddleware(req: Request, res: Response, next: NextFunction) {
  if (req.method === 'GET' && req.path === DELETE_PROGRESS_PATH) {
    return res.json({ code: 0, data: toProgressPayload(getAccountSetDeleteJob()) })
  }
  if (!isAccountSetDeleting()) return next()
  if (req.method === 'OPTIONS') return next()
  return res.status(423).json({ code: 423, message: '账套正在删除中，请稍候…' })
}
