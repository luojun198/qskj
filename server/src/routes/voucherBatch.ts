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
  applyVoucherUnAudit,
  getPeriodClosingRecord,
  isPeriodClosed,
} from '../services/voucherEntry.js'
import { buildVoucherAllEntriesInScopeSql } from '../services/accountAuthorization.js'
import { deleteVouchersWithRefs } from '../services/voucherDelete.js'
import { getVoucherImmutableReason } from '../services/voucherMutationGuard.js'
import { validateInitBalanceBalancedForYears } from '../services/initBalanceTrial.js'
import {
  applyVoucherPosting,
  applyVoucherUnpost,
  getAllowDirectPost,
  getRequireAuditEnabled,
} from '../services/voucherPosting.js'

const router = Router()
router.use(authMiddleware)

// ===================== 批量审核 =====================

router.post(
  '/vouchers/batch-audit/preview',
  requirePermission('voucher:audit'),
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
  requirePermission('voucher:entry'),
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

// ===================== 筛选模式共用：按状态取凭证（含科目授权范围 + 已结账期间拆分） =====================

// FIX-134：筛选模式此前只按 status + 日期/类型/号段 SQL 取凭证，
// 既不过滤科目授权范围（受限用户可操作看不见的凭证），也不排除已结账期间；
// 与按 ID 模式（voucherPosting.ts / voucherAudit.ts）的双重校验不一致。
function loadStatusFilteredVouchers(params: {
  db: ReturnType<typeof getDb>
  req: AuthRequest
  filters: ReturnType<typeof getBatchVoucherFilters>
  status: 'audited' | 'posted'
  order: 'ASC' | 'DESC'
}) {
  const { db, req, filters, status, order } = params
  const accountSetId = req.accountSetId || ''
  const scope = req.accountScope
    ? buildVoucherAllEntriesInScopeSql(req.accountScope, 'vouchers.id', accountSetId)
    : { sql: '1=1', params: [] as string[] }
  const rows = db
    .prepare(
      `SELECT * FROM vouchers
       WHERE account_set_id=? AND status=?
       AND voucher_date BETWEEN ? AND ?
       ${filters.voucherTypeIds.length > 0 ? `AND voucher_type_id IN (${filters.voucherTypeIds.map(() => '?').join(',')})` : ''}
       ${filters.startNo ? 'AND voucher_no >= ?' : ''}
       ${filters.endNo ? 'AND voucher_no <= ?' : ''}
       AND (${scope.sql})
       ORDER BY voucher_date ${order}, voucher_no ${order}`
    )
    .all(
      accountSetId,
      status,
      filters.startDate,
      filters.endDate,
      ...filters.voucherTypeIds,
      ...(filters.startNo ? [filters.startNo] : []),
      ...(filters.endNo ? [filters.endNo] : []),
      ...scope.params
    ) as any[]

  // 已结账期间的凭证一律跳过（P1-13 原仅反记账有此逻辑，现统一）
  const operable: any[] = []
  let skippedClosed = 0
  for (const v of rows) {
    const record = getPeriodClosingRecord({ db, accountSetId, year: v.year, period: v.period })
    if (isPeriodClosed(record)) skippedClosed++
    // 出纳已结账月份的现金 / 银行凭证同样跳过（P0-1）
    else if (
      getVoucherImmutableReason({ db, accountSetId, voucher: v, operation: status === 'posted' ? 'unpost' : 'unaudit' })
    )
      skippedClosed++
    else operable.push(v)
  }
  return { rows, operable, skippedClosed }
}

function buildStatusPreviewData(result: ReturnType<typeof loadStatusFilteredVouchers>) {
  const { operable, skippedClosed } = result
  return {
    count: operable.length,
    firstVoucherNo: operable[0]?.voucher_no || null,
    lastVoucherNo: operable[operable.length - 1]?.voucher_no || null,
    blockedVoucherNo: null,
    skippedClosed,
  }
}

function loadPostingParams(db: ReturnType<typeof getDb>, accountSetId: string) {
  // FIX-135：与单张/按 ID 模式同源读取，不再硬编码 requireAudit=false
  const requireAudit = db
    .prepare(`SELECT param_value FROM system_params WHERE account_set_id=? AND param_key='require_audit'`)
    .get(accountSetId) as any
  const allowDirectPost = db
    .prepare(`SELECT param_value FROM system_params WHERE account_set_id=? AND param_key='allow_direct_post'`)
    .get(accountSetId) as any
  return {
    requireAudit: getRequireAuditEnabled(requireAudit),
    allowDirectPost: getAllowDirectPost(allowDirectPost),
  }
}

// ===================== 批量反审核 =====================

router.post(
  '/vouchers/batch-unaudit/preview',
  requirePermission('voucher:audit'),
  operationLog('预览批量反审核凭证', '凭证管理'),
  (req: AuthRequest, res) => {
    const filters = getBatchVoucherFilters(req.body)
    if (!validateBatchVoucherFilters(filters)) {
      return res.status(400).json({ code: 400, message: '日期区间、凭证类型不能为空' })
    }
    const result = loadStatusFilteredVouchers({ db: getDb(), req, filters, status: 'audited', order: 'ASC' })
    res.json({ code: 0, data: buildStatusPreviewData(result) })
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
    const { rows, operable, skippedClosed } = loadStatusFilteredVouchers({ db, req, filters, status: 'audited', order: 'ASC' })
    if (rows.length === 0) {
      return res.status(400).json({ code: 400, message: '未找到符合条件的已审核凭证' })
    }
    if (operable.length === 0) {
      return res.status(400).json({ code: 400, message: '所选凭证均属于已结账期间，不能反审核' })
    }

    const transaction = db.transaction(() => {
      for (const v of operable) {
        applyVoucherUnAudit({ db, voucherId: v.id })
      }
    })
    transaction()

    res.json({
      code: 0,
      message:
        `批量反审核成功，共反审核 ${operable.length} 张凭证` +
        (skippedClosed > 0 ? `，${skippedClosed} 张因所属期间已结账被跳过` : ''),
      data: { count: operable.length, skippedClosed },
    })
  }
)

// ===================== 批量记账 =====================

router.post(
  '/vouchers/batch-post/preview',
  requirePermission('voucher:post'),
  operationLog('预览批量记账凭证', '凭证管理'),
  (req: AuthRequest, res) => {
    const filters = getBatchVoucherFilters(req.body)
    if (!validateBatchVoucherFilters(filters)) {
      return res.status(400).json({ code: 400, message: '日期区间、凭证类型不能为空' })
    }
    const result = loadStatusFilteredVouchers({ db: getDb(), req, filters, status: 'audited', order: 'ASC' })
    res.json({ code: 0, data: buildStatusPreviewData(result) })
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
    const accountSetId = req.accountSetId || ''
    const { rows, operable, skippedClosed } = loadStatusFilteredVouchers({ db, req, filters, status: 'audited', order: 'ASC' })
    if (rows.length === 0) {
      return res.status(400).json({ code: 400, message: '未找到符合条件的已审核凭证' })
    }
    if (operable.length === 0) {
      return res.status(400).json({ code: 400, message: '所选凭证均属于已结账期间，不能记账' })
    }

    const initBalanceError = validateInitBalanceBalancedForYears(
      db,
      accountSetId,
      [...new Set(operable.map(v => v.year as number))]
    )
    if (initBalanceError) {
      return res.status(400).json({ code: 400, message: initBalanceError })
    }

    const ctx = { accountSetId, userId: req.userId, userName: req.userName, ...loadPostingParams(db, accountSetId) }
    const transaction = db.transaction(() => {
      for (const voucher of operable) {
        const entries = db
          .prepare('SELECT * FROM voucher_entries WHERE voucher_id=? ORDER BY seq')
          .all(voucher.id) as any[]
        applyVoucherPosting(db, voucher, entries, ctx)
      }
    })
    transaction()

    res.json({
      code: 0,
      message:
        `批量记账成功，共记账 ${operable.length} 张凭证` +
        (skippedClosed > 0 ? `，${skippedClosed} 张因所属期间已结账被跳过` : ''),
      data: { count: operable.length, skippedClosed },
    })
  }
)

// ===================== 批量反记账 =====================

router.post(
  '/vouchers/batch-unpost/preview',
  requirePermission('voucher:unpost'),
  operationLog('预览批量反记账凭证', '凭证管理'),
  (req: AuthRequest, res) => {
    const filters = getBatchVoucherFilters(req.body)
    if (!validateBatchVoucherFilters(filters)) {
      return res.status(400).json({ code: 400, message: '日期区间、凭证类型不能为空' })
    }
    const result = loadStatusFilteredVouchers({ db: getDb(), req, filters, status: 'posted', order: 'DESC' })
    res.json({ code: 0, data: buildStatusPreviewData(result) })
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
    const accountSetId = req.accountSetId || ''
    const { rows, operable, skippedClosed } = loadStatusFilteredVouchers({ db, req, filters, status: 'posted', order: 'DESC' })
    if (rows.length === 0) {
      return res.status(400).json({ code: 400, message: '未找到符合条件的已记账凭证' })
    }
    if (operable.length === 0) {
      return res.status(400).json({ code: 400, message: '所选凭证均属于已结账期间，不能反记账' })
    }

    // FIX-135：requireAudit / allowDirectPost 读真实系统参数，反记账后已审核凭证保持 audited 而不是降级为草稿
    const ctx = { accountSetId, userId: req.userId, userName: req.userName, ...loadPostingParams(db, accountSetId) }
    const transaction = db.transaction(() => {
      for (const voucher of operable) {
        const entries = db
          .prepare('SELECT * FROM voucher_entries WHERE voucher_id=? ORDER BY seq')
          .all(voucher.id) as any[]
        applyVoucherUnpost(db, voucher, entries, ctx)
      }
    })
    transaction()

    res.json({
      code: 0,
      message:
        `批量反记账成功，共反记账 ${operable.length} 张凭证` +
        (skippedClosed > 0 ? `，${skippedClosed} 张因所属期间已结账被跳过` : ''),
      data: { count: operable.length, skippedClosed },
    })
  }
)

export default router
