import { Router } from 'express'
import { authMiddleware, AuthRequest, requirePermission } from '../middleware/index.js'
import { getTask, serializeTaskForResponse } from '../services/taskQueue.js'
import {
  batchAuditAsync,
  batchUnAuditAsync,
  batchPostAsync,
  batchUnpostAsync,
} from '../services/batchOperationAsync.js'
import { getDb } from '../db/index.js'

const router = Router()
router.use(authMiddleware)

// 获取任务状态
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

// 批量审核（异步）
router.post('/vouchers/batch-audit-async', requirePermission('voucher:audit'), async (req: AuthRequest, res) => {
  const { dateRange, voucher_type_ids, status } = req.body

  try {
    const reason = getBatchOperationUnavailableReason({
      accountSetId: req.accountSetId!,
      dateRange,
      voucherTypeIds: voucher_type_ids,
      status: 'draft',
      emptyMessage: '当前筛选条件下没有需要审核的凭证。只有草稿状态的凭证可以审核，请调整日期、凭证类型或先录入未审核凭证。',
    })
    if (reason) {
      return res.status(400).json({ code: 400, message: reason })
    }

    const taskId = await batchAuditAsync({
      db: getDb(),
      accountSetId: req.accountSetId!,
      userId: req.userId!,
      userName: req.userName!,
      dateRange,
      voucherTypeIds: voucher_type_ids,
      status,
    })

    res.json({ code: 0, data: { taskId }, message: '批量审核任务已创建' })
  } catch (error: any) {
    res.status(500).json({ code: 500, message: error.message || '创建任务失败' })
  }
})

// 批量反审核（异步）
router.post('/vouchers/batch-unaudit-async', requirePermission('voucher:audit'), async (req: AuthRequest, res) => {
  const { dateRange, voucher_type_ids } = req.body

  try {
    const reason = getBatchOperationUnavailableReason({
      accountSetId: req.accountSetId!,
      dateRange,
      voucherTypeIds: voucher_type_ids,
      status: 'audited',
      emptyMessage: '当前筛选条件下没有可以反审核的凭证。只有已审核且未记账的凭证可以反审核；已记账凭证请先反记账。',
    })
    if (reason) {
      return res.status(400).json({ code: 400, message: reason })
    }

    const taskId = await batchUnAuditAsync({
      db: getDb(),
      accountSetId: req.accountSetId!,
      userId: req.userId!,
      userName: req.userName!,
      dateRange,
      voucherTypeIds: voucher_type_ids,
      status: 'audited',
    })

    res.json({ code: 0, data: { taskId }, message: '批量反审核任务已创建' })
  } catch (error: any) {
    res.status(500).json({ code: 500, message: error.message || '创建任务失败' })
  }
})

// 批量记账（异步）
router.post('/vouchers/batch-post-async', requirePermission('voucher:post'), async (req: AuthRequest, res) => {
  const { dateRange, voucher_type_ids } = req.body

  try {
    const taskId = await batchPostAsync({
      db: getDb(),
      accountSetId: req.accountSetId!,
      userId: req.userId!,
      userName: req.userName!,
      dateRange,
      voucherTypeIds: voucher_type_ids,
      status: 'audited',
    })

    res.json({ code: 0, data: { taskId }, message: '批量记账任务已创建' })
  } catch (error: any) {
    res.status(500).json({ code: 500, message: error.message || '创建任务失败' })
  }
})

// 批量反记账（异步）
router.post('/vouchers/batch-unpost-async', requirePermission('voucher:unpost'), async (req: AuthRequest, res) => {
  const { dateRange, voucher_type_ids } = req.body

  try {
    const taskId = await batchUnpostAsync({
      db: getDb(),
      accountSetId: req.accountSetId!,
      userId: req.userId!,
      userName: req.userName!,
      dateRange,
      voucherTypeIds: voucher_type_ids,
      status: 'posted',
    })

    res.json({ code: 0, data: { taskId }, message: '批量反记账任务已创建' })
  } catch (error: any) {
    res.status(500).json({ code: 500, message: error.message || '创建任务失败' })
  }
})

function getBatchOperationUnavailableReason(params: {
  accountSetId: string
  dateRange?: [string, string]
  voucherTypeIds?: string[]
  status: string
  emptyMessage: string
}) {
  const db = getDb()
  let sql = `SELECT COUNT(*) as count FROM vouchers WHERE account_set_id = ? AND status = ?`
  const sqlParams: any[] = [params.accountSetId, params.status]

  if (params.dateRange?.length === 2) {
    sql += ` AND voucher_date BETWEEN ? AND ?`
    sqlParams.push(params.dateRange[0], params.dateRange[1])
  }

  if (params.voucherTypeIds?.length) {
    sql += ` AND voucher_type_id IN (${params.voucherTypeIds.map(() => '?').join(',')})`
    sqlParams.push(...params.voucherTypeIds)
  }

  const row = db.prepare(sql).get(...sqlParams) as { count: number } | undefined
  return row?.count ? null : params.emptyMessage
}

export default router
