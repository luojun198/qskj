import type { Response } from 'express'
import { AuthRequest } from './auth.js'
import { v4 as uuidv4 } from 'uuid'
import { logQueue } from '../utils/logQueue.js'
import { getRequestIp } from '../utils/requestIp.js'

/** 数组超过这个长度只记条数与前几条样例（批量导入 10 万行的 body 不能原样进操作日志） */
const LOG_ARRAY_SAMPLE = 5
const LOG_ARRAY_LIMIT = 50
/** detail JSON 上限，超过截断（FIX-254：出纳导入 10 万行曾把 30MB 请求体整段写进 operation_logs） */
const LOG_DETAIL_MAX_CHARS = 64 * 1024

/** 递归压缩请求体：大数组只留条数 + 样例，避免批量接口把整份数据写进日志表并长期驻留内存 */
function compactForLog(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[depth]'
  if (Array.isArray(value)) {
    if (value.length > LOG_ARRAY_LIMIT) {
      return { __array_length: value.length, sample: value.slice(0, LOG_ARRAY_SAMPLE).map(v => compactForLog(v, depth + 1)) }
    }
    return value.map(v => compactForLog(v, depth + 1))
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = compactForLog(v, depth + 1)
    return out
  }
  if (typeof value === 'string' && value.length > 2000) return value.slice(0, 2000) + '…[' + value.length + ' chars]'
  return value
}

export function operationLog(action: string, module?: string) {
  return (req: AuthRequest, res: Response, next: any) => {
    const originalSend = res.send
    const startTime = Date.now()

    // 预先捕获请求数据（注意：req.body 可能在异步操作后被修改，所以这里浅拷贝一份）
    const requestData = {
      params: { ...req.params },
      query: { ...req.query },
      body: req.body && typeof req.body === 'object' ? compactForLog({ ...req.body }) : req.body,
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
          detail: (() => {
            const json = JSON.stringify(logDetail)
            return json.length > LOG_DETAIL_MAX_CHARS ? json.slice(0, LOG_DETAIL_MAX_CHARS) + '…[truncated]' : json
          })(),
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
