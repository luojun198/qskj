import { v4 as uuidv4 } from 'uuid'
import { getDb } from '../db/index.js'

export type TaskType =
  | 'batch-audit'
  | 'batch-unaudit'
  | 'batch-post'
  | 'batch-unpost'
  | 'init-balance-import'
  | 'init-balance-clear'
  | 'aux-init-clear'
  | 'aux-init-save'
  | 'aux-init-export'
  | 'aux-items-delete'
  | 'aux-items-import'
  | 'aux-items-export'
  | 'aux-items-import-file'
  | 'accounts-import'
  | 'system-reinitialize'

export interface Task {
  id: string
  type: TaskType
  status: 'pending' | 'processing' | 'completed' | 'failed'
  progress: number // 0-100
  total: number
  processed: number
  success: number
  failed: number
  message?: string
  result?: any
  accountSetId?: string
  createdAt: Date
  updatedAt: Date
}

type TaskRow = {
  id: string
  account_set_id: string | null
  type: TaskType
  status: Task['status']
  progress: number
  total: number
  processed: number
  success: number
  failed: number
  message: string | null
  result_json: string | null
  created_at: string
  updated_at: string
}

const tasks = new Map<string, Task>()
let taskTableReady = false
const lastPersistAt = new Map<string, number>()
const PERSIST_THROTTLE_MS = 500

function hasAsyncTaskTable(db: ReturnType<typeof getDb>): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='async_tasks'")
    .get() as { name?: string } | undefined
  return !!row?.name
}

function rowToTask(row: TaskRow): Task {
  let result: unknown
  if (row.result_json) {
    try {
      result = JSON.parse(row.result_json)
    } catch {
      result = undefined
    }
  }
  return {
    id: row.id,
    type: row.type,
    status: row.status,
    progress: row.progress,
    total: row.total,
    processed: row.processed,
    success: row.success,
    failed: row.failed,
    message: row.message || undefined,
    result,
    accountSetId: row.account_set_id || undefined,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  }
}

function persistTask(task: Task) {
  if (!taskTableReady) return
  const db = getDb()
  db.prepare(
    `
    INSERT INTO async_tasks (
      id, account_set_id, type, status, progress, total, processed, success, failed,
      message, result_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      account_set_id = excluded.account_set_id,
      type = excluded.type,
      status = excluded.status,
      progress = excluded.progress,
      total = excluded.total,
      processed = excluded.processed,
      success = excluded.success,
      failed = excluded.failed,
      message = excluded.message,
      result_json = excluded.result_json,
      updated_at = excluded.updated_at
  `
  ).run(
    task.id,
    task.accountSetId || null,
    task.type,
    task.status,
    task.progress,
    task.total,
    task.processed,
    task.success,
    task.failed,
    task.message || null,
    task.result == null ? null : JSON.stringify(task.result),
    task.createdAt.toISOString(),
    task.updatedAt.toISOString()
  )
}

function loadTaskFromDb(taskId: string): Task | undefined {
  if (!taskTableReady) return undefined
  const db = getDb()
  const row = db
    .prepare('SELECT * FROM async_tasks WHERE id = ?')
    .get(taskId) as TaskRow | undefined
  if (!row) return undefined
  const task = rowToTask(row)
  tasks.set(task.id, task)
  return task
}

/** 启动时恢复近期任务，并将中断中的任务标记为失败 */
export function initTaskQueue() {
  const db = getDb()
  taskTableReady = hasAsyncTaskTable(db)
  if (!taskTableReady) return

  db.prepare(
    `
    UPDATE async_tasks
    SET status = 'failed',
        message = COALESCE(message, '服务重启导致任务中断，请重新操作'),
        updated_at = datetime('now')
    WHERE status IN ('pending', 'processing')
  `
  ).run()

  const rows = db
    .prepare(
      `
      SELECT * FROM async_tasks
      WHERE updated_at >= datetime('now', '-1 hour')
      ORDER BY updated_at DESC
    `
    )
    .all() as TaskRow[]

  for (const row of rows) {
    tasks.set(row.id, rowToTask(row))
  }
}

export function createTask(type: Task['type'], accountSetId?: string): Task {
  const now = new Date()
  const task: Task = {
    id: uuidv4(),
    type,
    status: 'pending',
    progress: 0,
    total: 0,
    processed: 0,
    success: 0,
    failed: 0,
    accountSetId,
    createdAt: now,
    updatedAt: now,
  }
  tasks.set(task.id, task)
  persistTask(task)
  return task
}

export function getTask(taskId: string): Task | undefined {
  const cached = tasks.get(taskId)
  if (cached) return cached
  return loadTaskFromDb(taskId)
}

export function updateTask(taskId: string, updates: Partial<Task>): void {
  const task = getTask(taskId)
  if (!task) return
  const prevStatus = task.status
  Object.assign(task, updates, { updatedAt: new Date() })
  tasks.set(taskId, task)

  const statusChanged = updates.status !== undefined && updates.status !== prevStatus
  const isTerminal = task.status === 'completed' || task.status === 'failed'
  const hasResult = updates.result !== undefined
  const now = Date.now()
  const last = lastPersistAt.get(taskId) ?? 0
  const shouldPersist =
    statusChanged || isTerminal || hasResult || now - last >= PERSIST_THROTTLE_MS

  if (shouldPersist) {
    persistTask(task)
    lastPersistAt.set(taskId, now)
  }
}

export function deleteTask(taskId: string): void {
  tasks.delete(taskId)
  if (!taskTableReady) return
  getDb().prepare('DELETE FROM async_tasks WHERE id = ?').run(taskId)
}

/** 返回可安全 JSON 序列化的任务副本（避免 result 过大或含不可序列化字段） */
export function serializeTaskForResponse(task: Task) {
  let result = task.result
  if (result != null) {
    try {
      result = JSON.parse(JSON.stringify(result))
    } catch {
      result = { summary: task.message || '任务已完成' }
    }
  }
  return {
    id: task.id,
    type: task.type,
    status: task.status,
    progress: task.progress,
    total: task.total,
    processed: task.processed,
    success: task.success,
    failed: task.failed,
    message: task.message,
    result,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  }
}

// 清理过期任务
setInterval(() => {
  const now = Date.now()
  for (const [id, task] of tasks.entries()) {
    if (
      (task.status === 'completed' || task.status === 'failed') &&
      now - task.updatedAt.getTime() > 3600000
    ) {
      tasks.delete(id)
    }
  }
  if (!taskTableReady) return
  getDb()
    .prepare(
      `
      DELETE FROM async_tasks
      WHERE status IN ('completed', 'failed')
        AND updated_at < datetime('now', '-1 hour')
    `
    )
    .run()
}, 300000)
