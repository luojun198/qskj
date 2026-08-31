/**
 * 操作日志异步队列
 * 使用内存队列 + 批量 flush 机制，减少同步写入开销
 */

import { getDb } from '../db/index.js'
import { log } from './logger.js'

interface LogEntry {
  id: string
  account_set_id: string | null
  user_id: string | null
  username: string | null
  action: string
  module: string
  detail: string
  ip_address: string
  user_agent: string
}

class LogQueue {
  private queue: LogEntry[] = []
  private flushTimer: NodeJS.Timeout | null = null
  private readonly BATCH_SIZE = 50 // 批量写入数量
  private readonly FLUSH_INTERVAL = 5000 // 5秒自动 flush

  /**
   * 添加日志到队列
   */
  push(entry: LogEntry): void {
    this.queue.push(entry)

    // 达到批量大小时立即 flush
    if (this.queue.length >= this.BATCH_SIZE) {
      this.flush()
    } else {
      // 否则设置定时 flush
      this.scheduleFlush()
    }
  }

  /**
   * 调度定时 flush
   */
  private scheduleFlush(): void {
    if (this.flushTimer) return

    this.flushTimer = setTimeout(() => {
      this.flush()
    }, this.FLUSH_INTERVAL)
  }

  /**
   * 批量写入日志到数据库
   */
  flush(): void {
    // 清除定时器
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }

    // 如果队列为空，直接返回
    if (this.queue.length === 0) return

    // 取出当前队列中的所有日志
    const entries = this.queue.splice(0, this.queue.length)

    try {
      const db = getDb()

      // 使用事务批量插入
      const insertLog = db.prepare(`
        INSERT INTO operation_logs (id, account_set_id, user_id, username, action, module, detail, ip_address, user_agent)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)

      const batchInsert = db.transaction((logs: LogEntry[]) => {
        for (const entry of logs) {
          insertLog.run(
            entry.id,
            entry.account_set_id,
            entry.user_id,
            entry.username,
            entry.action,
            entry.module,
            entry.detail,
            entry.ip_address,
            entry.user_agent
          )
        }
      })

      batchInsert(entries)
      log.debug(`批量写入 ${entries.length} 条操作日志`)
    } catch (err) {
      log.error('批量写入操作日志失败:', err)
      // 失败时将日志放回队列头部，下次重试
      this.queue.unshift(...entries)
    }
  }

  /**
   * 获取队列大小
   */
  get size(): number {
    return this.queue.length
  }
}

// 单例模式
export const logQueue = new LogQueue()

// 进程退出时 flush 所有日志
process.on('beforeExit', () => {
  logQueue.flush()
})

process.on('SIGINT', () => {
  logQueue.flush()
  process.exit(0)
})

process.on('SIGTERM', () => {
  logQueue.flush()
  process.exit(0)
})
