/**
 * ⚠️ 已废弃 — 请勿在 index.ts 重新挂载
 *
 * 静态辅助余额表（report 端）已被动态报表 + 账簿模块 ledger/aux-balance 取代。
 * 仅保留源代码用于历史参考。
 */
import { Router } from 'express'
import { authMiddleware, AuthRequest } from '../middleware/index.js'
import { getDb } from '../db/index.js'
import { buildAuxBalanceQuery, getAuxBalanceField } from '../services/reportQuery.js'

const router = Router()
router.use(authMiddleware)

// ===================== 辅助余额表（按辅助核算项目） =====================
router.get('/aux-balance', (req: AuthRequest, res) => {
  const db = getDb()
  const { year, period, aux_type } = req.query
  const y = Number(year) || new Date().getFullYear()
  const p = Number(period) || new Date().getMonth() + 1

  const auxField = getAuxBalanceField(aux_type as string | undefined)
  if (!auxField) {
    return res.json({ code: 400, message: '无效的辅助核算类型' })
  }

  const query = buildAuxBalanceQuery({
    accountSetId: req.accountSetId || '',
    year: y,
    period: p,
    auxField,
    accountScope: req.accountScope,
  })
  const list = db.prepare(query.sql).all(...query.params)
  res.json({ code: 0, data: list })
})

export default router
