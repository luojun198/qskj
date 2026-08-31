import { Router } from 'express'
import { getDb } from '../db/index.js'
import { authMiddleware, AuthRequest, requirePermission, operationLog } from '../middleware/index.js'
import {
  applyVoucherPosting,
  applyVoucherUnpost,
  getAllowDirectPost,
  getRequireAuditEnabled,
  loadVoucherEntries,
  validateVoucherCanPost,
  validateVoucherForUnpost,
} from '../services/voucherPosting.js'
import { getVoucherById, getPeriodClosingRecord, isPeriodClosed, sendBatchVoucherOperationResponse } from '../services/voucherEntry.js'
import { isVoucherVisibleInAccountScope } from '../services/accountAuthorization.js'
import { checkPostingIntegrity } from '../services/postingIntegrityCheck.js'
import { validateInitBalanceBalancedForYears } from '../services/initBalanceTrial.js'

const router = Router()
router.use(authMiddleware)

// ===================== 凭证记账 =====================

router.post('/vouchers/:id/post', requirePermission('voucher:post'), operationLog('记账凭证', '凭证管理'), (req: AuthRequest, res) => {
  const { id } = req.params
  const db = getDb()
  const voucher = getVoucherById({ db, voucherId: id, accountSetId: req.accountSetId })
  if (!voucher) {
    return res.status(404).json({ code: 404, message: '凭证不存在' })
  }
  if (
    req.accountScope &&
    !isVoucherVisibleInAccountScope(db, req.accountScope, id, req.accountSetId || '')
  ) {
    return res.status(404).json({ code: 404, message: '凭证不存在' })
  }

  // 检查系统参数：是否需要审核
  const requireAudit = db
    .prepare(
      `SELECT param_value FROM system_params WHERE account_set_id=? AND param_key='require_audit'`
    )
    .get(req.accountSetId) as any
  const requireAuditEnabled = getRequireAuditEnabled(requireAudit)

  // 检查系统参数：是否允许直接记账
  const allowDirectPost = db
    .prepare(
      `SELECT param_value FROM system_params WHERE account_set_id=? AND param_key='allow_direct_post'`
    )
    .get(req.accountSetId) as any
  const allowDirectPostEnabled = getAllowDirectPost(allowDirectPost)

  const postValidationError = validateVoucherCanPost(
    voucher,
    requireAuditEnabled,
    allowDirectPostEnabled
  )
  if (postValidationError) {
    return res.status(400).json({ code: 400, message: postValidationError })
  }

  // 检查期间是否已结账
  const closingRecord = getPeriodClosingRecord({
    db,
    accountSetId: req.accountSetId || '',
    year: voucher.year,
    period: voucher.period,
  })
  if (isPeriodClosed(closingRecord)) {
    return res.status(400).json({
      code: 400,
      message: `${voucher.year}年${voucher.period}期已结账，不能记账`,
    })
  }

  const entries = loadVoucherEntries(db, id)

  // 记账前数据完整性检查（仅警告，不阻止记账）
  const integrityCheck = checkPostingIntegrity(
    db,
    req.accountSetId || '',
    voucher.year,
    voucher.period,
    entries
  )
  if (!integrityCheck.isValid) {
    return res.status(400).json({
      code: 400,
      message: integrityCheck.errors.join('；'),
      data:
        integrityCheck.warnings.length > 0
          ? {
              warnings: integrityCheck.warnings,
            }
          : undefined,
    })
  }

  applyVoucherPosting(db, voucher, entries, {
    accountSetId: req.accountSetId || '',
    userId: req.userId,
    userName: req.userName,
    requireAudit: requireAuditEnabled,
    allowDirectPost: allowDirectPostEnabled,
  })

  res.json({
    code: 0,
    message: '记账成功',
    data:
      integrityCheck.warnings.length > 0
        ? {
            warnings: integrityCheck.warnings,
          }
        : undefined,
  })
})

function loadPostingSystemParams(db: ReturnType<typeof getDb>, accountSetId: string) {
  const requireAudit = db
    .prepare(
      `SELECT param_value FROM system_params WHERE account_set_id=? AND param_key='require_audit'`
    )
    .get(accountSetId) as any

  const allowDirectPost = db
    .prepare(
      `SELECT param_value FROM system_params WHERE account_set_id=? AND param_key='allow_direct_post'`
    )
    .get(accountSetId) as any

  return {
    requireAuditEnabled: getRequireAuditEnabled(requireAudit),
    allowDirectPostEnabled: getAllowDirectPost(allowDirectPost),
  }
}

// 批量记账（按 voucherIds；条件筛选由 voucherBatch 路由处理）
router.post(
  '/vouchers/batch-post',
  requirePermission('voucher:post'),
  operationLog('批量记账凭证', '凭证管理'),
  (req: AuthRequest, res, next) => {
    const { voucherIds } = req.body

    if (!Array.isArray(voucherIds)) {
      return next()
    }

    if (voucherIds.length === 0) {
      return res.status(400).json({ code: 400, message: '请选择要记账的凭证' })
    }

    // FIX-014 / P1-13：批量上限从 100 提至 1000
    if (voucherIds.length > 1000) {
      return res.status(400).json({ code: 400, message: '单次最多记账 1000 张凭证，请分批操作或改用筛选模式' })
    }

    const db = getDb()
    const accountSetId = req.accountSetId || ''
    const { requireAuditEnabled, allowDirectPostEnabled } = loadPostingSystemParams(db, accountSetId)

    const yearsToCheck = new Set<number>()
    for (const id of voucherIds) {
      const voucher = getVoucherById({ db, voucherId: id, accountSetId: req.accountSetId })
      if (voucher?.year) yearsToCheck.add(voucher.year)
    }
    const initBalanceError = validateInitBalanceBalancedForYears(db, accountSetId, yearsToCheck)
    if (initBalanceError) {
      return res.status(400).json({
        code: 400,
        message: initBalanceError,
        data: {
          total: voucherIds.length,
          success: 0,
          fail: voucherIds.length,
          details: [],
          initBalanceBlocked: true,
        },
      })
    }

    const results: Array<{ id: string; voucher_no: string; success: boolean; error?: string }> = []

    for (const id of voucherIds) {
      try {
        const voucher = getVoucherById({ db, voucherId: id, accountSetId: req.accountSetId })
        const voucherNo = voucher?.voucher_no || id

        if (!voucher) {
          results.push({ id, voucher_no: voucherNo, success: false, error: '凭证不存在' })
          continue
        }
        if (
          req.accountScope &&
          !isVoucherVisibleInAccountScope(db, req.accountScope, id, accountSetId)
        ) {
          results.push({ id, voucher_no: voucherNo, success: false, error: '凭证不存在' })
          continue
        }

        const postValidationError = validateVoucherCanPost(
          voucher,
          requireAuditEnabled,
          allowDirectPostEnabled
        )
        if (postValidationError) {
          results.push({ id, voucher_no: voucherNo, success: false, error: postValidationError })
          continue
        }

        const closingRecord = getPeriodClosingRecord({
          db,
          accountSetId,
          year: voucher.year,
          period: voucher.period,
        })
        if (isPeriodClosed(closingRecord)) {
          results.push({
            id,
            voucher_no: voucherNo,
            success: false,
            error: `${voucher.year}年${voucher.period}期已结账，不能记账`,
          })
          continue
        }

        const entries = loadVoucherEntries(db, id)
        const integrityCheck = checkPostingIntegrity(
          db,
          accountSetId,
          voucher.year,
          voucher.period,
          entries
        )
        if (!integrityCheck.isValid) {
          results.push({
            id,
            voucher_no: voucherNo,
            success: false,
            error: integrityCheck.errors.join('；'),
          })
          continue
        }

        applyVoucherPosting(db, voucher, entries, {
          accountSetId,
          userId: req.userId,
          userName: req.userName,
          requireAudit: requireAuditEnabled,
          allowDirectPost: allowDirectPostEnabled,
        })

        results.push({ id, voucher_no: voucherNo, success: true })
      } catch (error: any) {
        const voucher = getVoucherById({ db, voucherId: id, accountSetId: req.accountSetId })
        results.push({
          id,
          voucher_no: voucher?.voucher_no || id,
          success: false,
          error: error.message || '记账失败',
        })
      }
    }

    return sendBatchVoucherOperationResponse(res, '记账', voucherIds, results)
  }
)

router.post(
  '/vouchers/:id/unpost',
  requirePermission('voucher:unpost'),
  operationLog('反记账凭证', '凭证管理'),
  (req: AuthRequest, res) => {
    const { id } = req.params
    const db = getDb()
    const voucher = getVoucherById({ db, voucherId: id, accountSetId: req.accountSetId })
    const validationError = validateVoucherForUnpost(voucher)
    if (validationError) {
      return res.status(400).json({ code: 400, message: validationError })
    }

    // 检查期间是否已结账
    const closingRecord = getPeriodClosingRecord({
      db,
      accountSetId: req.accountSetId || '',
      year: voucher.year,
      period: voucher.period,
    })
    if (isPeriodClosed(closingRecord)) {
      return res.status(400).json({
        code: 400,
        message: `${voucher.year}年${voucher.period}期已结账，不能反记账`,
      })
    }

    const entries = loadVoucherEntries(db, id)
    const requireAudit = db
      .prepare(
        `SELECT param_value FROM system_params WHERE account_set_id=? AND param_key='require_audit'`
      )
      .get(req.accountSetId) as any

    const allowDirectPost = db
      .prepare(
        `SELECT param_value FROM system_params WHERE account_set_id=? AND param_key='allow_direct_post'`
      )
      .get(req.accountSetId) as any

    applyVoucherUnpost(db, voucher, entries, {
      accountSetId: req.accountSetId || '',
      requireAudit: getRequireAuditEnabled(requireAudit),
      allowDirectPost: getAllowDirectPost(allowDirectPost),
    })

    res.json({ code: 0, message: '反记账成功' })
  }
)

// 批量反记账（按 voucherIds；条件筛选由 voucherBatch 路由处理）
router.post(
  '/vouchers/batch-unpost',
  requirePermission('voucher:unpost'),
  operationLog('批量反记账凭证', '凭证管理'),
  (req: AuthRequest, res, next) => {
    const { voucherIds } = req.body

    if (!Array.isArray(voucherIds)) {
      return next()
    }

    if (voucherIds.length === 0) {
      return res.status(400).json({ code: 400, message: '请选择要反记账的凭证' })
    }

    // FIX-014 / P1-13：批量上限从 100 提至 1000
    if (voucherIds.length > 1000) {
      return res.status(400).json({ code: 400, message: '单次最多反记账 1000 张凭证，请分批操作' })
    }

    const db = getDb()
    const accountSetId = req.accountSetId || ''
    const { requireAuditEnabled, allowDirectPostEnabled } = loadPostingSystemParams(db, accountSetId)
    const results: Array<{ id: string; voucher_no: string; success: boolean; error?: string }> = []

    for (const id of voucherIds) {
      try {
        const voucher = getVoucherById({ db, voucherId: id, accountSetId: req.accountSetId })
        const voucherNo = voucher?.voucher_no || id
        const validationError = validateVoucherForUnpost(voucher)

        if (validationError) {
          results.push({ id, voucher_no: voucherNo, success: false, error: validationError })
          continue
        }

        const closingRecord = getPeriodClosingRecord({
          db,
          accountSetId,
          year: voucher!.year,
          period: voucher!.period,
        })
        if (isPeriodClosed(closingRecord)) {
          results.push({
            id,
            voucher_no: voucherNo,
            success: false,
            error: `${voucher!.year}年${voucher!.period}期已结账，不能反记账`,
          })
          continue
        }

        const entries = loadVoucherEntries(db, id)
        applyVoucherUnpost(db, voucher!, entries, {
          accountSetId,
          requireAudit: requireAuditEnabled,
          allowDirectPost: allowDirectPostEnabled,
        })

        results.push({ id, voucher_no: voucherNo, success: true })
      } catch (error: any) {
        const voucher = getVoucherById({ db, voucherId: id, accountSetId: req.accountSetId })
        results.push({
          id,
          voucher_no: voucher?.voucher_no || id,
          success: false,
          error: error.message || '反记账失败',
        })
      }
    }

    return sendBatchVoucherOperationResponse(res, '反记账', voucherIds, results)
  }
)

export default router





