import { Router } from 'express'
import { getDb } from '../db/index.js'
import { authMiddleware, AuthRequest, requirePermission, operationLog } from '../middleware/index.js'
import { validateAutoTransferPeriod } from '../services/autoTransfer.js'
import {
  getFxRevaluationStatus,
  previewFxRevaluation,
  revokeFxRevaluation,
  runFxRevaluation,
} from '../services/fxRevaluation.js'

const router = Router()
router.use(authMiddleware)

// ===================== 期末调汇 =====================

router.get('/fx-reval/status', (req: AuthRequest, res) => {
  const year = Number(req.query.year)
  const period = Number(req.query.period)
  const periodError = validateAutoTransferPeriod(year, period)
  if (periodError) return res.status(400).json({ code: 400, message: periodError })

  const status = getFxRevaluationStatus({
    db: getDb(),
    accountSetId: req.accountSetId || '',
    year,
    period,
  })
  res.json({ code: 0, data: status })
})

router.post(
  '/fx-reval/preview',
  requirePermission('period:carry'),
  operationLog('预览期末调汇', '凭证管理'),
  (req: AuthRequest, res) => {
    const year = Number(req.body.year)
    const period = Number(req.body.period)
    const periodError = validateAutoTransferPeriod(year, period)
    if (periodError) return res.status(400).json({ code: 400, message: periodError })

    const result = previewFxRevaluation({
      db: getDb(),
      accountSetId: req.accountSetId || '',
      year,
      period,
    })
    res.json({ code: 0, data: result, message: result.blockedReason || '' })
  }
)

router.post(
  '/fx-reval/run',
  requirePermission('period:carry'),
  operationLog('生成期末调汇凭证', '凭证管理'),
  (req: AuthRequest, res) => {
    const year = Number(req.body.year)
    const period = Number(req.body.period)
    const periodError = validateAutoTransferPeriod(year, period)
    if (periodError) return res.status(400).json({ code: 400, message: periodError })

    try {
      const result = runFxRevaluation({
        db: getDb(),
        accountSetId: req.accountSetId || '',
        userId: req.userId,
        userName: req.userName,
        year,
        period,
      })
      if (result.error) {
        return res.status(400).json({ code: 400, message: `${result.error}（${year}年${period}期）` })
      }
      res.json({
        code: 0,
        message: `期末调汇完成（${year}年${period}期，凭证号 ${result.voucherNo}，已自动审核并记账）`,
        data: result,
      })
    } catch (error: any) {
      console.error('Run fx revaluation failed:', error)
      res.status(500).json({ code: 500, message: error?.message || '生成调汇凭证失败' })
    }
  }
)

router.post(
  '/fx-reval/revoke',
  requirePermission('period:carry'),
  operationLog('反调汇', '凭证管理'),
  (req: AuthRequest, res) => {
    const year = Number(req.body.year)
    const period = Number(req.body.period)
    const periodError = validateAutoTransferPeriod(year, period)
    if (periodError) return res.status(400).json({ code: 400, message: periodError })

    try {
      const result = revokeFxRevaluation({
        db: getDb(),
        accountSetId: req.accountSetId || '',
        userId: req.userId,
        userName: req.userName,
        year,
        period,
      })
      if (result.error) {
        return res.status(400).json({ code: 400, message: `${result.error}（${year}年${period}期）` })
      }
      res.json({
        code: 0,
        message: `反调汇成功（${year}年${period}期，已删除凭证 ${result.voucherNo}）`,
        data: result,
      })
    } catch (error: any) {
      console.error('Revoke fx revaluation failed:', error)
      res.status(500).json({ code: 500, message: error?.message || '反调汇失败' })
    }
  }
)

export default router
