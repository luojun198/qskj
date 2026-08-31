import { Router } from 'express'
import { getDb } from '../db/index.js'
import { authMiddleware, AuthRequest, requirePermission, operationLog } from '../middleware/index.js'
import {
  applyVoucherAudit,
  applyVoucherUnAudit,
  auditBatchVouchers,
  findSelfMadeVoucher,
  getBatchVoucherFilters,
  getVoucherById,
  loadBatchDraftVouchers,
  sendBatchVoucherOperationResponse,
  validateVoucherForAudit,
  validateBatchVoucherFilters,
  validateVoucherForUnAudit,
} from '../services/voucherEntry.js'
import { isVoucherVisibleInAccountScope } from '../services/accountAuthorization.js'

const router = Router()
router.use(authMiddleware)

// ===================== 凭证审核 =====================

router.post(
  '/vouchers/:id/audit',
  requirePermission('voucher:audit'),
  operationLog('审核凭证', '凭证管理'),
  (req: AuthRequest, res) => {
    const { id } = req.params
    const db = getDb()
    const voucher = getVoucherById({ db, voucherId: id, accountSetId: req.accountSetId })
    const validationError = validateVoucherForAudit(voucher, req.userId)
    if (validationError) {
      const status = validationError === '凭证不存在' ? 404 : 400
      return res.status(status).json({ code: status, message: validationError })
    }
    if (
      req.accountScope &&
      !isVoucherVisibleInAccountScope(db, req.accountScope, id, req.accountSetId || '')
    ) {
      return res.status(404).json({ code: 404, message: '凭证不存在' })
    }
    applyVoucherAudit({
      db,
      voucherId: id,
      userId: req.userId,
      userName: req.userName,
    })
    res.json({ code: 0, message: '审核成功' })
  }
)

// 批量审核
router.post(
  '/vouchers/batch-audit',
  requirePermission('voucher:audit'),
  operationLog('批量审核凭证', '凭证管理'),
  (req: AuthRequest, res) => {
    const { voucherIds } = req.body

    if (!Array.isArray(voucherIds)) {
      const filters = getBatchVoucherFilters(req.body)
      if (!validateBatchVoucherFilters(filters)) {
        return res.status(400).json({ code: 400, message: '请选择要审核的凭证，或完整选择日期区间和凭证类型' })
      }

      const db = getDb()
      const vouchers = loadBatchDraftVouchers({
        db,
        accountSetId: req.accountSetId || '',
        accountScope: req.accountScope,
        filters,
      })

      if (vouchers.length === 0) {
        return res.status(400).json({ code: 400, message: '未找到符合条件的草稿凭证' })
      }

      const selfMadeVoucher = findSelfMadeVoucher(vouchers, req.userId)
      if (selfMadeVoucher) {
        return res
          .status(400)
          .json({ code: 400, message: `制单人与审核人不能为同一人：${selfMadeVoucher.voucher_no}` })
      }

      auditBatchVouchers({
        db,
        vouchers,
        userId: req.userId,
        userName: req.userName,
      })

      return res.json({
        code: 0,
        message: `批量审核成功，共审核 ${vouchers.length} 张凭证`,
        data: { count: vouchers.length },
      })
    }

    if (voucherIds.length === 0) {
      return res.status(400).json({ code: 400, message: '请选择要审核的凭证' })
    }

    // FIX-014 / P1-13：批量上限从 100 提至 1000（满足月底集中审核场景）
    if (voucherIds.length > 1000) {
      return res.status(400).json({ code: 400, message: '单次最多审核 1000 张凭证，请分批操作或改用日期 + 凭证类型筛选模式' })
    }

    const db = getDb()
    const results: Array<{ id: string; voucher_no: string; success: boolean; error?: string }> = []

    for (const id of voucherIds) {
      try {
        const voucher = getVoucherById({ db, voucherId: id, accountSetId: req.accountSetId })
        const voucherNo = voucher?.voucher_no || id
        const validationError = validateVoucherForAudit(voucher, req.userId)

        if (validationError) {
          results.push({ id, voucher_no: voucherNo, success: false, error: validationError })
          continue
        }
        if (
          req.accountScope &&
          !isVoucherVisibleInAccountScope(db, req.accountScope, id, req.accountSetId || '')
        ) {
          results.push({ id, voucher_no: voucherNo, success: false, error: '凭证不存在' })
          continue
        }

        applyVoucherAudit({
          db,
          voucherId: id,
          userId: req.userId,
          userName: req.userName,
        })

        results.push({ id, voucher_no: voucherNo, success: true })
      } catch (error: any) {
        const voucher = getVoucherById({ db, voucherId: id, accountSetId: req.accountSetId })
        results.push({
          id,
          voucher_no: voucher?.voucher_no || id,
          success: false,
          error: error.message || '审核失败',
        })
      }
    }

    return sendBatchVoucherOperationResponse(res, '审核', voucherIds, results)
  }
)

// 批量反审核（按 voucherIds；条件筛选由 voucherBatch 路由处理）
router.post(
  '/vouchers/batch-unaudit',
  requirePermission('voucher:audit'),
  operationLog('批量反审核凭证', '凭证管理'),
  (req: AuthRequest, res, next) => {
    const { voucherIds } = req.body

    if (!Array.isArray(voucherIds)) {
      return next()
    }

    if (voucherIds.length === 0) {
      return res.status(400).json({ code: 400, message: '请选择要反审核的凭证' })
    }

    // FIX-014 / P1-13：批量上限从 100 提至 1000
    if (voucherIds.length > 1000) {
      return res.status(400).json({ code: 400, message: '单次最多反审核 1000 张凭证，请分批操作' })
    }

    const db = getDb()
    const results: Array<{ id: string; voucher_no: string; success: boolean; error?: string }> = []

    for (const id of voucherIds) {
      try {
        const voucher = getVoucherById({ db, voucherId: id, accountSetId: req.accountSetId })
        const voucherNo = voucher?.voucher_no || id
        const validationError = validateVoucherForUnAudit(voucher)

        if (validationError) {
          results.push({ id, voucher_no: voucherNo, success: false, error: validationError })
          continue
        }
        if (
          req.accountScope &&
          !isVoucherVisibleInAccountScope(db, req.accountScope, id, req.accountSetId || '')
        ) {
          results.push({ id, voucher_no: voucherNo, success: false, error: '凭证不存在' })
          continue
        }

        applyVoucherUnAudit({ db, voucherId: id })
        results.push({ id, voucher_no: voucherNo, success: true })
      } catch (error: any) {
        const voucher = getVoucherById({ db, voucherId: id, accountSetId: req.accountSetId })
        results.push({
          id,
          voucher_no: voucher?.voucher_no || id,
          success: false,
          error: error.message || '反审核失败',
        })
      }
    }

    return sendBatchVoucherOperationResponse(res, '反审核', voucherIds, results)
  }
)

router.post(
  '/vouchers/:id/unaudit',
  requirePermission('voucher:audit'),
  operationLog('反审核凭证', '凭证管理'),
  (req: AuthRequest, res) => {
    const { id } = req.params
    const db = getDb()
    const voucher = getVoucherById({ db, voucherId: id, accountSetId: req.accountSetId })
    const validationError = validateVoucherForUnAudit(voucher)
    if (validationError) {
      return res.status(400).json({ code: 400, message: validationError })
    }
    if (
      req.accountScope &&
      !isVoucherVisibleInAccountScope(db, req.accountScope, id, req.accountSetId || '')
    ) {
      return res.status(404).json({ code: 404, message: '凭证不存在' })
    }
    applyVoucherUnAudit({ db, voucherId: id })
    res.json({ code: 0, message: '反审核成功' })
  }
)

export default router
