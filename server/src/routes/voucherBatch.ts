import { Router } from 'express'
import { getDb } from '../db/index.js'
import { authMiddleware, AuthRequest, requirePermission, operationLog } from '../middleware/index.js'
import {
  buildBatchAuditPreviewData,
  buildBatchDeletePreviewData,
  getBatchVoucherFilters,
  loadBatchDraftVouchers,
  loadBatchFilteredVouchers,
  validateBatchVoucherFilters,
} from '../services/voucherEntry.js'
import { deleteVouchersWithRefs } from '../services/voucherDelete.js'
import { validateInitBalanceBalancedForYears } from '../services/initBalanceTrial.js'
import { applyVoucherPosting, applyVoucherUnpost } from '../services/voucherPosting.js'

const router = Router()
router.use(authMiddleware)

// ===================== 批量审核 =====================

router.post(
  '/vouchers/batch-audit/preview',
  operationLog('预览批量审核凭证', '凭证管理'),
  (req: AuthRequest, res) => {
    const filters = getBatchVoucherFilters(req.body)
    if (!validateBatchVoucherFilters(filters)) {
      return res.status(400).json({ code: 400, message: '日期区间、凭证类型不能为空' })
    }

    const db = getDb()
    const vouchers = loadBatchDraftVouchers({
      db,
      accountSetId: req.accountSetId || '',
      accountScope: req.accountScope,
      filters,
    })

    res.json({
      code: 0,
      data: buildBatchAuditPreviewData(vouchers, req.userId),
    })
  }
)

// /vouchers/batch-audit 的实际实现在 routes/voucherAudit.ts；
// Express 路由按注册顺序匹配，voucherAuditRoutes 在 index.ts 中先 use，所以这里曾经的同名 handler 永远不会被调用。
// 已于 2026-05-21 删除该死代码，本文件保留 batch-audit/preview。

// ===================== 批量删除 =====================

router.post(
  '/vouchers/batch-delete/preview',
  operationLog('预览批量删除凭证', '凭证管理'),
  (req: AuthRequest, res) => {
    const filters = getBatchVoucherFilters(req.body)
    if (!validateBatchVoucherFilters(filters)) {
      return res.status(400).json({ code: 400, message: '日期区间、凭证类型不能为空' })
    }

    const db = getDb()
    const vouchers = loadBatchFilteredVouchers({
      db,
      accountSetId: req.accountSetId || '',
      accountScope: req.accountScope,
      filters,
    })

    res.json({
      code: 0,
      data: buildBatchDeletePreviewData(vouchers),
    })
  }
)

router.post(
  '/vouchers/batch-delete',
  requirePermission('voucher:entry'),
  operationLog('批量删除凭证', '凭证管理'),
  (req: AuthRequest, res) => {
    const filters = getBatchVoucherFilters(req.body)
    if (!validateBatchVoucherFilters(filters)) {
      return res.status(400).json({ code: 400, message: '日期区间、凭证类型不能为空' })
    }

    const db = getDb()
    const vouchers = loadBatchFilteredVouchers({
      db,
      accountSetId: req.accountSetId || '',
      accountScope: req.accountScope,
      filters,
    })

    if (vouchers.length === 0) {
      return res.status(400).json({ code: 400, message: '未找到符合条件的凭证' })
    }

    // FIX-132：与单张删除共用来源守卫（posted / cashier / asset_*）与关联清理（冲红、调汇、供应链回写）
    try {
      deleteVouchersWithRefs(db, req.accountSetId || '', vouchers)
    } catch (err) {
      return res.status(400).json({ code: 400, message: (err as Error).message })
    }

    res.json({
      code: 0,
      message: `批量删除成功，共删除 ${vouchers.length} 张凭证`,
      data: { count: vouchers.length },
    })
  }
)

// ===================== 批量反审核 =====================

router.post(
  '/vouchers/batch-unaudit/preview',
  operationLog('预览批量反审核凭证', '凭证管理'),
  (req: AuthRequest, res) => {
    const filters = getBatchVoucherFilters(req.body)
    if (!validateBatchVoucherFilters(filters)) {
      return res.status(400).json({ code: 400, message: '日期区间、凭证类型不能为空' })
    }

    const db = getDb()
    const vouchers = db
      .prepare(
        `SELECT * FROM vouchers
         WHERE account_set_id=? AND status='audited'
         AND voucher_date BETWEEN ? AND ?
         ${filters.voucherTypeIds.length > 0 ? `AND voucher_type_id IN (${filters.voucherTypeIds.map(() => '?').join(',')})` : ''}
         ${filters.startNo ? 'AND voucher_no >= ?' : ''}
         ${filters.endNo ? 'AND voucher_no <= ?' : ''}
         ORDER BY voucher_date, voucher_no`
      )
      .all(
        req.accountSetId,
        filters.startDate,
        filters.endDate,
        ...filters.voucherTypeIds,
        ...(filters.startNo ? [filters.startNo] : []),
        ...(filters.endNo ? [filters.endNo] : [])
      ) as any[]

    res.json({
      code: 0,
      data: {
        count: vouchers.length,
        firstVoucherNo: vouchers[0]?.voucher_no || null,
        lastVoucherNo: vouchers[vouchers.length - 1]?.voucher_no || null,
        blockedVoucherNo: null,
      },
    })
  }
)

router.post(
  '/vouchers/batch-unaudit',
  requirePermission('voucher:audit'),
  operationLog('批量反审核凭证', '凭证管理'),
  (req: AuthRequest, res) => {
    const filters = getBatchVoucherFilters(req.body)
    if (!validateBatchVoucherFilters(filters)) {
      return res.status(400).json({ code: 400, message: '日期区间、凭证类型不能为空' })
    }

    const db = getDb()
    const vouchers = db
      .prepare(
        `SELECT * FROM vouchers
         WHERE account_set_id=? AND status='audited'
         AND voucher_date BETWEEN ? AND ?
         ${filters.voucherTypeIds.length > 0 ? `AND voucher_type_id IN (${filters.voucherTypeIds.map(() => '?').join(',')})` : ''}
         ${filters.startNo ? 'AND voucher_no >= ?' : ''}
         ${filters.endNo ? 'AND voucher_no <= ?' : ''}
         ORDER BY voucher_date, voucher_no`
      )
      .all(
        req.accountSetId,
        filters.startDate,
        filters.endDate,
        ...filters.voucherTypeIds,
        ...(filters.startNo ? [filters.startNo] : []),
        ...(filters.endNo ? [filters.endNo] : [])
      ) as any[]

    if (vouchers.length === 0) {
      return res.status(400).json({ code: 400, message: '未找到符合条件的已审核凭证' })
    }

    const updateStmt = db.prepare(
      "UPDATE vouchers SET status='draft', auditor_id=NULL, auditor_name=NULL, updated_at=datetime('now') WHERE id=?"
    )
    const transaction = db.transaction(() => {
      for (const v of vouchers) {
        updateStmt.run(v.id)
      }
    })
    transaction()

    res.json({
      code: 0,
      message: `批量反审核成功，共反审核 ${vouchers.length} 张凭证`,
      data: { count: vouchers.length },
    })
  }
)

// ===================== 批量记账 =====================

router.post(
  '/vouchers/batch-post/preview',
  operationLog('预览批量记账凭证', '凭证管理'),
  (req: AuthRequest, res) => {
    const filters = getBatchVoucherFilters(req.body)
    if (!validateBatchVoucherFilters(filters)) {
      return res.status(400).json({ code: 400, message: '日期区间、凭证类型不能为空' })
    }

    const db = getDb()
    const vouchers = db
      .prepare(
        `SELECT * FROM vouchers
         WHERE account_set_id=? AND status='audited'
         AND voucher_date BETWEEN ? AND ?
         ${filters.voucherTypeIds.length > 0 ? `AND voucher_type_id IN (${filters.voucherTypeIds.map(() => '?').join(',')})` : ''}
         ${filters.startNo ? 'AND voucher_no >= ?' : ''}
         ${filters.endNo ? 'AND voucher_no <= ?' : ''}
         ORDER BY voucher_date, voucher_no`
      )
      .all(
        req.accountSetId,
        filters.startDate,
        filters.endDate,
        ...filters.voucherTypeIds,
        ...(filters.startNo ? [filters.startNo] : []),
        ...(filters.endNo ? [filters.endNo] : [])
      ) as any[]

    res.json({
      code: 0,
      data: {
        count: vouchers.length,
        firstVoucherNo: vouchers[0]?.voucher_no || null,
        lastVoucherNo: vouchers[vouchers.length - 1]?.voucher_no || null,
        blockedVoucherNo: null,
      },
    })
  }
)

router.post(
  '/vouchers/batch-post',
  requirePermission('voucher:post'),
  operationLog('批量记账凭证', '凭证管理'),
  (req: AuthRequest, res) => {
    const filters = getBatchVoucherFilters(req.body)
    if (!validateBatchVoucherFilters(filters)) {
      return res.status(400).json({ code: 400, message: '日期区间、凭证类型不能为空' })
    }

    const db = getDb()
    const vouchers = db
      .prepare(
        `SELECT * FROM vouchers
         WHERE account_set_id=? AND status='audited'
         AND voucher_date BETWEEN ? AND ?
         ${filters.voucherTypeIds.length > 0 ? `AND voucher_type_id IN (${filters.voucherTypeIds.map(() => '?').join(',')})` : ''}
         ${filters.startNo ? 'AND voucher_no >= ?' : ''}
         ${filters.endNo ? 'AND voucher_no <= ?' : ''}
         ORDER BY voucher_date, voucher_no`
      )
      .all(
        req.accountSetId,
        filters.startDate,
        filters.endDate,
        ...filters.voucherTypeIds,
        ...(filters.startNo ? [filters.startNo] : []),
        ...(filters.endNo ? [filters.endNo] : [])
      ) as any[]

    if (vouchers.length === 0) {
      return res.status(400).json({ code: 400, message: '未找到符合条件的已审核凭证' })
    }

    const initBalanceError = validateInitBalanceBalancedForYears(
      db,
      req.accountSetId || '',
      [...new Set(vouchers.map(v => v.year as number))]
    )
    if (initBalanceError) {
      return res.status(400).json({ code: 400, message: initBalanceError })
    }

    // 批量记账逻辑（applyVoucherPosting 已在顶部静态 import）
    const transaction = db.transaction(() => {
      for (const voucher of vouchers) {
        const entries = db
          .prepare('SELECT * FROM voucher_entries WHERE voucher_id=? ORDER BY seq')
          .all(voucher.id) as any[]

        applyVoucherPosting(db, voucher, entries, {
          accountSetId: req.accountSetId || '',
          userId: req.userId,
          userName: req.userName,
          requireAudit: false,
          allowDirectPost: true,
        })
      }
    })
    transaction()

    res.json({
      code: 0,
      message: `批量记账成功，共记账 ${vouchers.length} 张凭证`,
      data: { count: vouchers.length },
    })
  }
)

// ===================== 批量反记账 =====================

router.post(
  '/vouchers/batch-unpost/preview',
  operationLog('预览批量反记账凭证', '凭证管理'),
  (req: AuthRequest, res) => {
    const filters = getBatchVoucherFilters(req.body)
    if (!validateBatchVoucherFilters(filters)) {
      return res.status(400).json({ code: 400, message: '日期区间、凭证类型不能为空' })
    }

    const db = getDb()
    const vouchers = db
      .prepare(
        `SELECT * FROM vouchers
         WHERE account_set_id=? AND status='posted'
         AND voucher_date BETWEEN ? AND ?
         ${filters.voucherTypeIds.length > 0 ? `AND voucher_type_id IN (${filters.voucherTypeIds.map(() => '?').join(',')})` : ''}
         ${filters.startNo ? 'AND voucher_no >= ?' : ''}
         ${filters.endNo ? 'AND voucher_no <= ?' : ''}
         ORDER BY voucher_date DESC, voucher_no DESC`
      )
      .all(
        req.accountSetId,
        filters.startDate,
        filters.endDate,
        ...filters.voucherTypeIds,
        ...(filters.startNo ? [filters.startNo] : []),
        ...(filters.endNo ? [filters.endNo] : [])
      ) as any[]

    res.json({
      code: 0,
      data: {
        count: vouchers.length,
        firstVoucherNo: vouchers[0]?.voucher_no || null,
        lastVoucherNo: vouchers[vouchers.length - 1]?.voucher_no || null,
        blockedVoucherNo: null,
      },
    })
  }
)

router.post(
  '/vouchers/batch-unpost',
  requirePermission('voucher:unpost'),
  operationLog('批量反记账凭证', '凭证管理'),
  (req: AuthRequest, res) => {
    const filters = getBatchVoucherFilters(req.body)
    if (!validateBatchVoucherFilters(filters)) {
      return res.status(400).json({ code: 400, message: '日期区间、凭证类型不能为空' })
    }

    const db = getDb()
    const vouchers = db
      .prepare(
        `SELECT * FROM vouchers
         WHERE account_set_id=? AND status='posted'
         AND voucher_date BETWEEN ? AND ?
         ${filters.voucherTypeIds.length > 0 ? `AND voucher_type_id IN (${filters.voucherTypeIds.map(() => '?').join(',')})` : ''}
         ${filters.startNo ? 'AND voucher_no >= ?' : ''}
         ${filters.endNo ? 'AND voucher_no <= ?' : ''}
         ORDER BY voucher_date DESC, voucher_no DESC`
      )
      .all(
        req.accountSetId,
        filters.startDate,
        filters.endDate,
        ...filters.voucherTypeIds,
        ...(filters.startNo ? [filters.startNo] : []),
        ...(filters.endNo ? [filters.endNo] : [])
      ) as any[]

    if (vouchers.length === 0) {
      return res.status(400).json({ code: 400, message: '未找到符合条件的已记账凭证' })
    }

    // P1-13：排除已结账期间的凭证，避免筛选模式反记账破坏「已结账期间不可变」
    const closedStmt = db.prepare(
      `SELECT 1 FROM period_closing WHERE account_set_id=? AND year=? AND period=? AND status='closed'`
    )
    const unpostable = vouchers.filter(
      v => !closedStmt.get(req.accountSetId, v.year, v.period)
    )
    const skippedClosed = vouchers.length - unpostable.length
    if (unpostable.length === 0) {
      return res.status(400).json({ code: 400, message: '所选凭证均属于已结账期间，不能反记账' })
    }

    // 批量反记账逻辑（applyVoucherUnpost 已在顶部静态 import）
    const transaction = db.transaction(() => {
      for (const voucher of unpostable) {
        const entries = db
          .prepare('SELECT * FROM voucher_entries WHERE voucher_id=? ORDER BY seq')
          .all(voucher.id) as any[]

        applyVoucherUnpost(db, voucher, entries, {
          accountSetId: req.accountSetId || '',
          userId: req.userId,
          userName: req.userName,
          requireAudit: false,
          allowDirectPost: true,
        })
      }
    })
    transaction()

    res.json({
      code: 0,
      message:
        `批量反记账成功，共反记账 ${unpostable.length} 张凭证` +
        (skippedClosed > 0 ? `，${skippedClosed} 张因所属期间已结账被跳过` : ''),
      data: { count: unpostable.length, skippedClosed },
    })
  }
)

export default router
