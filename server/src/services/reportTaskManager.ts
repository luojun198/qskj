/**
 * 报表生成任务管理
 * 提供进度追踪能力，支持前端轮询获取进度
 */

interface ReportTask {
  id: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  progress: number // 0-100
  message: string
  result?: any
  error?: string
  createdAt: number
  updatedAt: number
}

// 内存任务存储（生产环境应使用 Redis）
const tasks = new Map<string, ReportTask>()

// 自动清理超过 30 分钟的任务
const TASK_TTL = 30 * 60 * 1000

function cleanupExpiredTasks() {
  const now = Date.now()
  for (const [id, task] of tasks) {
    if (now - task.updatedAt > TASK_TTL) {
      tasks.delete(id)
    }
  }
}

/**
 * 创建报表任务
 */
export function createReportTask(id: string): ReportTask {
  cleanupExpiredTasks()
  const task: ReportTask = {
    id,
    status: 'pending',
    progress: 0,
    message: '等待生成...',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
  tasks.set(id, task)
  return task
}

/**
 * 更新任务进度
 */
export function updateReportTask(
  id: string,
  update: Partial<Pick<ReportTask, 'status' | 'progress' | 'message' | 'result' | 'error'>>
): void {
  const task = tasks.get(id)
  if (!task) return
  Object.assign(task, update, { updatedAt: Date.now() })
}

/**
 * 获取任务状态
 */
export function getReportTask(id: string): ReportTask | null {
  cleanupExpiredTasks()
  return tasks.get(id) || null
}

/**
 * 在报表生成流程中包装进度更新
 */
export async function runWithProgress<T>(
  taskId: string,
  steps: Array<{ label: string; fn: () => T | Promise<T> }>
): Promise<T[]> {
  const results: T[] = []
  const total = steps.length

  updateReportTask(taskId, { status: 'running', progress: 0, message: '开始生成报表...' })

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]
    const progress = Math.round((i / total) * 100)

    updateReportTask(taskId, {
      progress,
      message: `正在${step.label}... (${i + 1}/${total})`,
    })

    try {
      const result = await step.fn()
      results.push(result)
    } catch (error: any) {
      updateReportTask(taskId, {
        status: 'failed',
        progress: Math.round(((i + 1) / total) * 100),
        message: `${step.label}失败`,
        error: error.message || '未知错误',
      })
      throw error
    }
  }

  updateReportTask(taskId, {
    status: 'completed',
    progress: 100,
    message: '报表生成完成',
  })

  return results
}
