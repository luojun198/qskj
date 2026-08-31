import { Router } from 'express'
import { existsSync } from 'fs'
import { relative, resolve } from 'path'
import { authMiddleware, AuthRequest } from '../middleware/index.js'
import { getTask, serializeTaskForResponse } from '../services/taskQueue.js'
import { getDeployDir } from '../db/index.js'

const router = Router()
router.use(authMiddleware)

router.get('/tasks/:taskId', (req: AuthRequest, res) => {
  try {
    const { taskId } = req.params
    const task = getTask(taskId)

    if (!task) {
      return res.status(404).json({ code: 404, message: '任务不存在' })
    }

    if (task.accountSetId && req.accountSetId && task.accountSetId !== req.accountSetId) {
      return res.status(404).json({ code: 404, message: '任务不存在' })
    }

    res.json({ code: 0, data: serializeTaskForResponse(task) })
  } catch (error: any) {
    res.status(500).json({ code: 500, message: error.message || '查询任务状态失败' })
  }
})

router.get('/tasks/:taskId/download', (req: AuthRequest, res) => {
  const task = getTask(req.params.taskId)
  if (!task || (task.accountSetId && task.accountSetId !== req.accountSetId)) {
    return res.status(404).json({ code: 404, message: '任务不存在' })
  }
  const filePath = String(task.result?.filePath || '')
  const exportRoot = resolve(getDeployDir(), 'tmp', 'exports')
  const relativePath = filePath ? relative(exportRoot, resolve(filePath)) : '..'
  if (!filePath || relativePath.startsWith('..') || relativePath.includes(':') || !existsSync(filePath)) {
    return res.status(404).json({ code: 404, message: '导出文件不存在或已过期' })
  }
  res.download(filePath, String(task.result?.fileName || 'export.xlsx'))
})

export default router
