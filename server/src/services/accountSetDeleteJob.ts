import { randomUUID } from 'crypto'
import type { Database } from 'better-sqlite3'
import { cleanupAccountSetCascadeAsync } from './accountSetCleanup.js'

export interface AccountSetDeleteJob {
  taskId: string
  accountSetId: string
  accountSetName: string
  status: 'running' | 'done' | 'failed'
  done: number
  total: number
  label: string
  error?: string
  startedAt: number
  finishedAt?: number
}

/** 同一时刻只允许一个删除任务；结束后保留一段时间供前端读取最终状态 */
let currentJob: AccountSetDeleteJob | null = null
const KEEP_FINISHED_MS = 60_000

export function getAccountSetDeleteJob(): AccountSetDeleteJob | null {
  if (currentJob && currentJob.status !== 'running' && Date.now() - (currentJob.finishedAt || 0) > KEEP_FINISHED_MS) {
    currentJob = null
  }
  return currentJob
}

export function isAccountSetDeleting(): boolean {
  return currentJob?.status === 'running'
}

/** 启动删除任务；已有任务在跑则返回 null */
export function startAccountSetDeleteJob(
  db: Database,
  accountSetId: string,
  accountSetName: string
): AccountSetDeleteJob | null {
  if (isAccountSetDeleting()) return null
  const job: AccountSetDeleteJob = {
    taskId: randomUUID(),
    accountSetId,
    accountSetName,
    status: 'running',
    done: 0,
    total: 0,
    label: '准备中',
    startedAt: Date.now(),
  }
  currentJob = job
  cleanupAccountSetCascadeAsync(db, accountSetId, (done, total, label) => {
    job.done = done
    job.total = total
    job.label = label
  })
    .then(() => {
      job.status = 'done'
      job.finishedAt = Date.now()
    })
    .catch((err: any) => {
      const msg = String(err?.message || err)
      job.status = 'failed'
      job.error = msg.includes('FOREIGN KEY')
        ? '删除账套失败：存在未清理的关联数据，请联系管理员或升级至最新版本后重试'
        : '删除账套失败: ' + msg
      job.finishedAt = Date.now()
    })
  return job
}

export function toProgressPayload(job: AccountSetDeleteJob | null) {
  if (!job) return { active: false }
  return {
    active: job.status === 'running',
    taskId: job.taskId,
    accountSetId: job.accountSetId,
    accountSetName: job.accountSetName,
    status: job.status,
    done: job.done,
    total: job.total,
    percent: job.total ? Math.min(100, Math.floor((job.done / job.total) * 100)) : 0,
    label: job.label,
    error: job.error,
    elapsedMs: (job.finishedAt || Date.now()) - job.startedAt,
  }
}

/** 仅供测试 */
export function __resetAccountSetDeleteJob() {
  currentJob = null
}
