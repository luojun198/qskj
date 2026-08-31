import type { Response } from 'express'
import { AuthRequest } from './auth.js'
import { v4 as uuidv4 } from 'uuid'
import { logQueue } from '../utils/logQueue.js'
import { getRequestIp } from '../utils/requestIp.js'

export function operationLog(action: string, module?: string) {
  return (req: AuthRequest, res: Response, next: any) => {
    const originalSend = res.send
    const startTime = Date.now()

    // 预先捕获请求数据（注意：req.body 可能在异步操作后被修改，所以这里浅拷贝一份）
    const requestData = {
      params: { ...req.params },
      query: { ...req.query },
      body: req.body && typeof req.body === 'object' ? { ...req.body } : req.body,
    }

    // 简单脱敏
    if (requestData.body && typeof requestData.body === 'object') {
      const sensitiveKeys = ['password', 'oldPassword', 'newPassword', 'token']
      for (const key of sensitiveKeys) {
        if (key in requestData.body) requestData.body[key] = '******'
      }
    }

    res.send = function (body) {
      try {
        let responseMessage = ''
        if (typeof body === 'string') {
          try {
            const parsedBody = JSON.parse(body)
            responseMessage = parsedBody.message || ''
          } catch {
            responseMessage = body
          }
        } else if (body && typeof body === 'object') {
          responseMessage = body.message || ''
        }

        const logDetail = {
          request: requestData,
          response: responseMessage,
          duration: Date.now() - startTime,
          status: res.statusCode
        }

        // 使用异步队列写入日志，避免阻塞请求
        logQueue.push({
          id: uuidv4(),
          account_set_id: req.accountSetId || null,
          user_id: req.userId || null,
          username: req.userName || null,
          action,
          module: module || '',
          detail: JSON.stringify(logDetail),
          ip_address: getRequestIp(req),
          user_agent: req.headers['user-agent'] || '',
        })
      } catch (e) {
        console.error('Failed to queue operation log:', e)
      }
      return originalSend.call(this, body)
    }
    next()
  }
}
