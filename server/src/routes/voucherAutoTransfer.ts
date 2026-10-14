import { Router } from 'express'
import { getDb } from '../db/index.js'
import { authMiddleware, AuthRequest, requirePermission, requireAnyPermission, operationLog } from '../middleware/index.js'
import {
  buildAllTransferPreviews,
  createAllTransferVouchers,
  getAutoTransferStatus,
  redoTransferVouchers,
  revokeAllTransferVouchers,
  validateAutoTransferPeriod,
} from '../services/autoTransfer.js'

const router = Router()
router.use(authMiddleware)

// ===================== 自动结转 =====================

// 评审 P2：读接口补权限码（页面路由 period:carry，执行 / 撤销 base:transfer，二者任一即可查看）
router.get('/auto-transfer/status', requireAnyPermission('period:carry', 'base:transfer'), (req: AuthRequest, res) => {
  const year = Number(req.query.year)
  const period = Number(req.query.period)
  const periodError = validateAutoTransferPeriod(year, period)
  if (periodError) {
    return res.status(400).json({ code: 400, message: periodError })
  }

  const db = getDb()
  const status = getAutoTransferStatus({
    db,
    accountSetId: req.accountSetId || '',
    year,
    period,
  })
  res.json({
    code: 0,
    data: {
      closed: status.closed,
      alreadyGenerated: status.alreadyGenerated,
      canRevoke: status.canRevoke,
      existingRun: status.existingRun || null,
      runCount: status.runCount,
      unpostedCount: status.unpostedCount,
    },
  })
})

router.post(
  '/auto-transfer/preview',
  requireAnyPermission('period:carry', 'base:transfer'),
  operationLog('预览自动结转', '凭证管理'),
  (req: AuthRequest, res) => {
    const year = Number(req.body.year)
    const period = Number(req.body.period)
    const periodError = validateAutoTransferPeriod(year, period)
    if (periodError) {
      return res.status(400).json({ code: 400, message: periodError })
    }

    const db = getDb()

    // 使用新的按类型预览函数
    const result = buildAllTransferPreviews({
      db,
      accountSetId: req.accountSetId || '',
      year,
      period,
    })

    // 即使有 blockedReason 也返回 200，让前端显示警告信息
    res.json({
      code: 0,
      data: result,
      message: result.blockedReason || `预览自动结转（${year}年${period}期，${result.previews.length}个结转类型）`,
    })
  }
)

router.post(
  '/auto-transfer/run',
  requirePermission('base:transfer'),
  operationLog('执行自动结转', '凭证管理'),
  (req: AuthRequest, res) => {
    const year = Number(req.body.year)
    const period = Number(req.body.period)
    const transferTypeCodes = Array.isArray(req.body.transferTypeCodes)
      ? req.body.transferTypeCodes.map((code: unknown) => String(code || '').trim()).filter(Boolean)
      : undefined
    const periodError = validateAutoTransferPeriod(year, period)
    if (periodError) {
      return res.status(400).json({ code: 400, message: periodError })
    }

    const db = getDb()

    // 使用新的创建所有凭证函数
    const result = createAllTransferVouchers({
      db,
      accountSetId: req.accountSetId || '',
      userId: req.userId,
      userName: req.userName,
      year,
      period,
      transferTypeCodes,
    })

    if (result.error) {
      return res.status(400).json({
        code: 400,
        message: `${result.error}（${year}年${period}期）`,
        data: result,
      })
    }

    // 统计成功创建的凭证数量
    const successCount = result.results.filter(r => !r.skipped && !('error' in r && r.error)).length
    const skippedCount = result.results.filter(r => r.skipped).length
    const incrementalCount = result.results.filter(r => 'incremental' in r && r.incremental).length
    const voucherNos = result.results
      .filter(r => r.voucherNo)
      .map(r => r.voucherNo)
      .join('、')

    if (successCount === 0) {
      const reasons = result.results.filter(r => r.skipped).map(r => `${r.transferTypeName}：${r.reason}`)
      return res.status(400).json({
        code: 400,
        message: `没有生成结转凭证（${year}年${period}期）${reasons.length ? '：' + reasons.join('；') : ''}`,
        data: { results: result.results, successCount, skippedCount },
      })
    }

    res.json({
      code: 0,
      message: `自动结转成功（${year}年${period}期，生成${successCount}张凭证${incrementalCount > 0 ? `，其中补结差额${incrementalCount}张` : ''}${skippedCount > 0 ? `，跳过${skippedCount}个类型` : ''}，凭证号：${voucherNos}，已自动审核并记账）`,
      data: {
        results: result.results,
        successCount,
        skippedCount,
      },
    })
  }
)

// 一键重新结转：撤销所选类型本期全部结转凭证后，按当前余额整体重新生成
router.post(
  '/auto-transfer/redo',
  requirePermission('base:transfer'),
  operationLog('重新结转', '凭证管理'),
  (req: AuthRequest, res) => {
    const year = Number(req.body.year)
    const period = Number(req.body.period)
    const transferTypeCodes = Array.isArray(req.body.transferTypeCodes)
      ? req.body.transferTypeCodes.map((code: unknown) => String(code || '').trim()).filter(Boolean)
      : []
    const periodError = validateAutoTransferPeriod(year, period)
    if (periodError) {
      return res.status(400).json({ code: 400, message: periodError })
    }

    const result = redoTransferVouchers({
      db: getDb(),
      accountSetId: req.accountSetId || '',
      userId: req.userId,
      userName: req.userName,
      year,
      period,
      transferTypeCodes,
    })
    if (result.error) {
      return res.status(400).json({ code: 400, message: `${result.error}（${year}年${period}期）`, data: result })
    }
    const revokedNos = result.revoked.filter(r => r.success).map(r => r.voucherNo).join('、')
    const createdNos = result.results.filter(r => r.voucherNo).map(r => r.voucherNo).join('、')
    const skipped = result.results.filter(r => r.skipped).map(r => `${r.transferTypeName}：${r.reason}`)
    res.json({
      code: 0,
      message: `重新结转完成（${year}年${period}期${revokedNos ? `，已删除原结转凭证：${revokedNos}` : ''}${createdNos ? `，新凭证：${createdNos}` : '，无需生成新凭证'}${skipped.length ? `；${skipped.join('；')}` : ''}）`,
      data: result,
    })
  }
)

router.post(
  '/auto-transfer/revoke',
  requirePermission('base:transfer'),
  operationLog('反结转', '凭证管理'),
  (req: AuthRequest, res) => {
    const year = Number(req.body.year)
    const period = Number(req.body.period)
    const periodError = validateAutoTransferPeriod(year, period)
    if (periodError) {
      return res.status(400).json({ code: 400, message: periodError })
    }

    const db = getDb()

    try {
      // 反结转按期间一次性删除全部自动结转生成的凭证
      const result = revokeAllTransferVouchers({
        db,
        accountSetId: req.accountSetId || '',
        year,
        period,
      })

      if (result.error) {
        return res
          .status(400)
          .json({ code: 400, message: `${result.error}（${year}年${period}期）` })
      }

      const successCount = result.results.filter(r => r.success).length
      const failCount = result.results.filter(r => !r.success).length
      const voucherNos = result.results
        .filter(r => r.success)
        .map(r => r.voucherNo)
        .join('、')

      res.json({
        code: 0,
        message: `反结转成功（${year}年${period}期，删除${successCount}张结转凭证${failCount > 0 ? `，${failCount}张失败` : ''}，凭证号：${voucherNos}）`,
        data: {
          results: result.results,
          successCount,
          failCount,
        },
      })
    } catch (error: any) {
      console.error('Revoke auto transfer failed:', error)
      return res.status(500).json({
        code: 500,
        message: error?.message || '反结转失败',
        data: {
          stack: process.env.NODE_ENV !== 'production' ? error?.stack : undefined,
        },
      })
    }
  }
)

export default router
