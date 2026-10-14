/**
 * 对账单（单据化，第四份反馈 Q2）路由。权限沿用「往来收付/对账」scm:arap。
 */
import { Router } from 'express'
import { getDb } from '../db/index.js'
import { authMiddleware, requirePermission, operationLog, type AuthRequest } from '../middleware/index.js'
import {
  getStatementCandidates, createStatement, updateStatement, deleteStatement, auditStatement, unauditStatement,
  getStatement, listStatements, getStatementDetailReport,
} from '../services/scmStatement.js'

const router = Router()
router.use(authMiddleware)
router.use('/scm/statements', requirePermission('scm:arap'))

const asid = (req: AuthRequest) => req.accountSetId || ''
const userName = (req: AuthRequest) => (req as any).userName || '系统'

function handle(res: any, fn: () => any) {
  try {
    res.json({ code: 0, data: fn() })
  } catch (e: any) {
    res.status(400).json({ code: 400, message: e?.message || '操作失败' })
  }
}

router.get('/scm/statements', (req: AuthRequest, res) => {
  const q = req.query as any
  handle(res, () => listStatements(getDb(), asid(req), {
    direction: q.direction, partner_code: q.partner_code, status: q.status, keyword: q.keyword,
    date_from: q.date_from, date_to: q.date_to, page: Number(q.page) || 1, page_size: Number(q.page_size) || 50,
  }))
})
// 须先于 /:id 注册
router.get('/scm/statements/candidates', (req: AuthRequest, res) => {
  const q = req.query as any
  handle(res, () => getStatementCandidates(getDb(), asid(req), {
    direction: q.direction, partner_code: q.partner_code, end_date: q.end_date, start_date: q.start_date, statement_id: q.statement_id,
  }))
})
router.get('/scm/statements/detail-report', (req: AuthRequest, res) => {
  const q = req.query as any
  handle(res, () => getStatementDetailReport(getDb(), asid(req), {
    direction: q.direction, partner_code: q.partner_code, date_from: q.date_from, date_to: q.date_to, status: q.status,
  }))
})
router.get('/scm/statements/:id', (req: AuthRequest, res) => {
  const data = getStatement(getDb(), asid(req), req.params.id)
  if (!data) return res.status(404).json({ code: 404, message: '对账单不存在' })
  res.json({ code: 0, data })
})
router.post('/scm/statements', operationLog('新增对账单', '供应链'), (req: AuthRequest, res) => {
  handle(res, () => createStatement(getDb(), asid(req), req.body || {}, userName(req)))
})
router.put('/scm/statements/:id', operationLog('修改对账单', '供应链'), (req: AuthRequest, res) => {
  handle(res, () => updateStatement(getDb(), asid(req), req.params.id, req.body || {}))
})
router.delete('/scm/statements/:id', operationLog('删除对账单', '供应链'), (req: AuthRequest, res) => {
  handle(res, () => deleteStatement(getDb(), asid(req), req.params.id))
})
router.post('/scm/statements/:id/audit', operationLog('审核对账单', '供应链'), (req: AuthRequest, res) => {
  handle(res, () => auditStatement(getDb(), asid(req), req.params.id, userName(req)))
})
router.post('/scm/statements/:id/unaudit', operationLog('反审核对账单', '供应链'), (req: AuthRequest, res) => {
  handle(res, () => unauditStatement(getDb(), asid(req), req.params.id))
})

export default router
