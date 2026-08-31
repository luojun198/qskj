import { Router } from 'express'
import { getDb } from '../db/index.js'
import {
  authMiddleware,
  requirePermission,
  operationLog,
  type AuthRequest,
} from '../middleware/index.js'
import {
  previewReinitialize,
  runReinitializeAsync,
  verifyAdminPassword,
  type ReinitPayload,
} from '../services/systemReinitialize.js'

const router = Router()

router.use(authMiddleware)

function parseAccountCodeLengths(raw: unknown): number[] | undefined {
  if (Array.isArray(raw)) {
    return raw.map(item => Number(item)).filter(n => Number.isFinite(n) && n > 0)
  }
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        return parsed.map(item => Number(item)).filter(n => Number.isFinite(n) && n > 0)
      }
    } catch {
      /* ignore */
    }
  }
  return undefined
}

function parseReinitPayload(source: Record<string, unknown>): ReinitPayload {
  const mode = source.mode === 'full_reinit' ? 'full_reinit' : 'voucher_only'
  const preserveRaw = (source.preserve || {}) as Record<string, unknown>
  const accountLevelsRaw = source.account_levels
  const accountLevels =
    accountLevelsRaw != null && String(accountLevelsRaw).trim() !== ''
      ? Number.parseInt(String(accountLevelsRaw), 10)
      : undefined
  return {
    mode,
    start_date: String(source.start_date || ''),
    accounting_standard: source.accounting_standard as ReinitPayload['accounting_standard'],
    standard_template_id: String(source.standard_template_id || ''),
    account_levels: Number.isFinite(accountLevels) ? accountLevels : undefined,
    account_code_lengths: parseAccountCodeLengths(source.account_code_lengths),
    preserve: {
      preserve_aux: !!preserveRaw.preserve_aux,
      preserve_voucher_types: !!preserveRaw.preserve_voucher_types,
      preserve_transfer: !!preserveRaw.preserve_transfer,
      preserve_dashboard_rules: !!preserveRaw.preserve_dashboard_rules,
      preserve_business_params: !!preserveRaw.preserve_business_params,
    },
  }
}

router.get(
  '/reinitialize/preview',
  requirePermission('system:init'),
  (req: AuthRequest, res) => {
    try {
      const db = getDb()
      const payload = parseReinitPayload({
        mode: req.query.mode,
        start_date: req.query.start_date,
        accounting_standard: req.query.accounting_standard,
        standard_template_id: req.query.standard_template_id,
        account_levels: req.query.account_levels,
        account_code_lengths: req.query.account_code_lengths,
        preserve: {
          preserve_aux: req.query.preserve_aux === 'true',
          preserve_voucher_types: req.query.preserve_voucher_types === 'true',
          preserve_transfer: req.query.preserve_transfer === 'true',
          preserve_dashboard_rules: req.query.preserve_dashboard_rules === 'true',
          preserve_business_params: req.query.preserve_business_params === 'true',
        },
      })
      const data = previewReinitialize(db, req.accountSetId!, payload)
      res.json({ code: 0, data })
    } catch (error: any) {
      res.status(400).json({ code: 400, message: error.message || '预览失败' })
    }
  }
)

router.post(
  '/reinitialize-async',
  requirePermission('system:init'),
  operationLog('系统初始化', '系统管理'),
  (req: AuthRequest, res) => {
    try {
      const { password, confirm_text: confirmText, ...rest } = req.body || {}
      if (String(confirmText || '').trim() !== '确认初始化') {
        return res.status(400).json({ code: 400, message: '请输入确认文案：确认初始化' })
      }

      const db = getDb()
      if (!verifyAdminPassword(db, req.accountSetId!, String(password || ''))) {
        return res.status(400).json({ code: 400, message: '管理员密码错误' })
      }

      const payload = parseReinitPayload(rest)
      previewReinitialize(db, req.accountSetId!, payload)

      const taskId = runReinitializeAsync(db, req.accountSetId!, payload, req.userId)
      res.json({ code: 0, data: { taskId } })
    } catch (error: any) {
      res.status(400).json({ code: 400, message: error.message || '系统初始化失败' })
    }
  }
)

export default router
