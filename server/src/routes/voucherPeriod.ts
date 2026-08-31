import { Router } from 'express'
import { getDb } from '../db/index.js'
import { authMiddleware, AuthRequest, requirePermission, operationLog } from '../middleware/index.js'
import { listPeriodClosingStatus } from '../services/voucherEntry.js'
import {
  buildYearPeriodStatusView,
  closeAccountingPeriod,
  closeAllAccountingPeriods,
  getPeriodCloseYearBounds,
  openAccountingPeriod,
  openAllAccountingPeriods,
} from '../services/yearClosing.js'

const router = Router()
router.use(authMiddleware)

function parseYearPeriod(params: { year?: string; period?: string }) {
  return {
    year: Number(params.year),
    period: Number(params.period),
  }
}

router.get('/periods/year-bounds', (req: AuthRequest, res) => {
  const db = getDb()
  const data = getPeriodCloseYearBounds(db, req.accountSetId || '')
  res.json({ code: 0, data })
})

router.get('/periods/:year/overview', (req: AuthRequest, res) => {
  const db = getDb()
  const year = Number(req.params.year) || new Date().getFullYear()
  const data = buildYearPeriodStatusView({
    db,
    accountSetId: req.accountSetId || '',
    year,
  })
  res.json({ code: 0, data })
})

router.post(
  '/periods/:year/close-all',
  requirePermission('period:close'),
  operationLog('全年结账', '凭证管理'),
  (req: AuthRequest, res) => {
    const year = Number(req.params.year)
    const db = getDb()

    try {
      const result = closeAllAccountingPeriods({
        db,
        accountSetId: req.accountSetId || '',
        year,
        period: 12,
        userId: req.userId,
      })
      const closedText = result.closedPeriods.join('、')
      // FIX-003：年结时若部分科目下年期初已手工调整，保留并提示
      const manualHint =
        result.preservedManualOpeningCount && result.preservedManualOpeningCount > 0
          ? `；其中 ${result.preservedManualOpeningCount} 项科目下年期初为手工调整，已保留未覆盖`
          : ''
      res.json({
        code: 0,
        message: result.closedPeriods.includes(12)
          ? result.overwrittenNextYearOpening
            ? `全年结账成功（${closedText}期），已重新计算并覆盖下一年期初余额${manualHint}`
            : `全年结账成功（${closedText}期），已生成下一年期初余额${manualHint}`
          : `批量结账成功（${closedText}期）`,
        data: result,
      })
    } catch (error: any) {
      res.status(400).json({
        code: 400,
        message: error?.message || '全年结账失败',
      })
    }
  }
)

router.post(
  '/periods/:year/open-all',
  requirePermission('period:unclose'),
  operationLog('全年反结账', '凭证管理'),
  (req: AuthRequest, res) => {
    const year = Number(req.params.year)
    const db = getDb()

    try {
      const result = openAllAccountingPeriods({
        db,
        accountSetId: req.accountSetId || '',
        year,
        period: 12,
        userId: req.userId,
      })
      const openedText = result.openedPeriods.join('、')
      res.json({
        code: 0,
        message:
          result.removedNextYearOpening && result.nextYearVoucherCount
            ? `全年反结账成功（${openedText}期）；${result.nextYear}年已有 ${result.nextYearVoucherCount} 张凭证，发生额可查询，余额待重新年结后恢复`
            : result.removedNextYearOpening
              ? `全年反结账成功（${openedText}期），已撤销下一年期初余额`
              : `全年反结账成功（${openedText}期）`,
        data: result,
      })
    } catch (error: any) {
      res.status(400).json({
        code: 400,
        message: error?.message || '全年反结账失败',
      })
    }
  }
)

router.post(
  '/periods/:year/:period/close',
  requirePermission('period:close'),
  operationLog('结账', '凭证管理'),
  (req: AuthRequest, res) => {
    const { year, period } = parseYearPeriod(req.params)
    const db = getDb()

    try {
      const result = closeAccountingPeriod({
        db,
        accountSetId: req.accountSetId || '',
        year,
        period,
        userId: req.userId,
      })

      // FIX-003：年结时若部分科目下年期初已手工调整，保留并提示
      const manualHint =
        result.preservedManualOpeningCount && result.preservedManualOpeningCount > 0
          ? `；其中 ${result.preservedManualOpeningCount} 项科目下年期初为手工调整，已保留未覆盖`
          : ''

      res.json({
        code: 0,
        message:
          period === 12
            ? result.overwrittenNextYearOpening
              ? `年度结账成功，已重新计算并覆盖下一年期初余额${manualHint}`
              : `年度结账成功，已生成下一年期初余额${manualHint}`
            : '月结成功',
        data: result,
      })
    } catch (error: any) {
      res.status(400).json({
        code: 400,
        message: error?.message || '结账失败',
      })
    }
  }
)

router.post(
  '/periods/:year/:period/open',
  requirePermission('period:unclose'),
  operationLog('反结账', '凭证管理'),
  (req: AuthRequest, res) => {
    const { year, period } = parseYearPeriod(req.params)
    const db = getDb()

    try {
      const result = openAccountingPeriod({
        db,
        accountSetId: req.accountSetId || '',
        year,
        period,
        userId: req.userId,
      })
      res.json({
        code: 0,
        message:
          period === 12 && result.removedNextYearOpening
            ? result.nextYearVoucherCount
              ? `年度反结账成功，已撤销下一年期初余额；${result.nextYear}年已有 ${result.nextYearVoucherCount} 张凭证，发生额可查询，余额待重新年度结账后恢复`
              : '年度反结账成功，已撤销下一年期初余额'
            : '反结账成功',
        data: result,
      })
    } catch (error: any) {
      res.status(400).json({
        code: 400,
        message: error?.message || '反结账失败',
      })
    }
  }
)

router.get('/periods/status', (req: AuthRequest, res) => {
  const { year } = req.query
  const db = getDb()
  const yearValue = typeof year === 'string' || typeof year === 'number' ? year : new Date().getFullYear()
  const list = listPeriodClosingStatus({
    db,
    accountSetId: req.accountSetId || '',
    year: yearValue,
  })
  res.json({ code: 0, data: list })
})

router.get('/periods/available-for-report', (req: AuthRequest, res) => {
  const db = getDb()
  const { year } = req.query
  let y = Number(year) || new Date().getFullYear()

  if (y < 100) {
    y = 2000 + y
  }

  const closedPeriods = db
    .prepare(
      `
      SELECT year, period
      FROM period_closing
      WHERE account_set_id = ?
        AND year = ?
        AND status = 'closed'
      ORDER BY period
    `
    )
    .all(req.accountSetId, y)

  res.json({
    code: 0,
    data: closedPeriods.map((p: any) => p.period),
  })
})

export default router
