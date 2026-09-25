/**
 * 凭证 Excel 转入（凭证录入页「转入」）
 *
 * GET  /api/voucher/excel-import/columns   — 列定义（固定列 + 辅助核算类别动态列），转出/转入共用
 * POST /api/voucher/excel-import/validate  — 校验并返回分组预览
 * POST /api/voucher/excel-import/confirm   — 重新校验后整批写入草稿凭证
 */
import { Router } from 'express'
import { getDb } from '../db/index.js'
import { authMiddleware, AuthRequest, requirePermission, operationLog } from '../middleware/index.js'
import {
  getVoucherExcelColumns,
  importParsedVouchers,
  parseVoucherExcelRows,
  type VoucherExcelImportOptions,
} from '../services/voucherExcelImport.js'

const router = Router()
router.use(authMiddleware)

/** 单次转入的最大行数（分录行） */
const MAX_IMPORT_ROWS = 20000

function readBody(req: AuthRequest): { rows: Array<Record<string, unknown>>; options: VoucherExcelImportOptions } | string {
  const { rows, options } = req.body || {}
  if (!Array.isArray(rows) || rows.length === 0) return '没有可转入的数据行'
  if (rows.length > MAX_IMPORT_ROWS) return `单次最多转入 ${MAX_IMPORT_ROWS} 行，请拆分文件`
  const opt: VoucherExcelImportOptions = {
    dateMode: options?.dateMode === 'monthEnd' ? 'monthEnd' : 'original',
    targetYear: options?.targetYear != null ? Number(options.targetYear) : undefined,
    targetPeriod: options?.targetPeriod != null ? Number(options.targetPeriod) : undefined,
    numberMode: options?.numberMode === 'manual' ? 'manual' : 'auto',
    startNo: options?.startNo != null ? Number(options.startNo) : undefined,
  }
  return { rows, options: opt }
}

function summarize(vouchers: ReturnType<typeof parseVoucherExcelRows>['vouchers']) {
  return vouchers.map(v => ({
    seq: v.seqLabel,
    voucher_type_name: v.voucherTypeName,
    voucher_date: v.voucherDate,
    entry_count: v.entries.length,
    total_debit: v.totalDebit,
    total_credit: v.totalCredit,
    rows: v.rows,
  }))
}

router.get('/excel-import/columns', requirePermission('voucher:entry'), (req: AuthRequest, res) => {
  const db = getDb()
  res.json({ code: 0, data: getVoucherExcelColumns(db, req.accountSetId || '') })
})

router.post('/excel-import/validate', requirePermission('voucher:entry'), (req: AuthRequest, res) => {
  const body = readBody(req)
  if (typeof body === 'string') return res.status(400).json({ code: 400, message: body })
  const db = getDb()
  const { vouchers, errors } = parseVoucherExcelRows({
    db,
    accountSetId: req.accountSetId || '',
    rows: body.rows,
    options: body.options,
    accountScope: req.accountScope,
  })
  res.json({ code: 0, data: { rowCount: body.rows.length, vouchers: summarize(vouchers), errors } })
})

router.post(
  '/excel-import/confirm',
  requirePermission('voucher:entry'),
  operationLog('Excel 转入凭证', '凭证管理'),
  (req: AuthRequest, res) => {
    const body = readBody(req)
    if (typeof body === 'string') return res.status(400).json({ code: 400, message: body })
    const db = getDb()
    const accountSetId = req.accountSetId || ''
    const { vouchers, errors } = parseVoucherExcelRows({
      db,
      accountSetId,
      rows: body.rows,
      options: body.options,
      accountScope: req.accountScope,
    })
    if (errors.length > 0) {
      return res
        .status(400)
        .json({ code: 400, message: `存在 ${errors.length} 处校验错误，未写入任何凭证`, data: { errors } })
    }
    if (vouchers.length === 0) {
      return res.status(400).json({ code: 400, message: '没有可转入的凭证' })
    }
    try {
      const result = importParsedVouchers({
        db,
        accountSetId,
        userId: req.userId,
        userName: req.userName,
        vouchers,
        options: body.options,
      })
      res.json({
        code: 0,
        message: `已转入 ${result.created} 张凭证`,
        data: { created: result.created, voucher_ids: result.voucherIds, voucher_nos: result.voucherNos },
      })
    } catch (err: any) {
      res.status(400).json({ code: 400, message: err?.message || '转入失败' })
    }
  }
)

export default router
