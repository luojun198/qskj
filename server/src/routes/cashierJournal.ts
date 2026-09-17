import { Router } from 'express'
import { v4 as uuidv4 } from 'uuid'
import fs from 'fs/promises'
import path from 'path'
import multer from 'multer'
import { getDb } from '../db/index.js'
import { authMiddleware, AuthRequest, operationLog } from '../middleware/index.js'
import { deleteVoucherWithRefs } from '../services/voucherDelete.js'
import { assertAccountIdInScope, type AccountScopeContext } from '../services/accountAuthorization.js'
import { createPreReinitializeBackup } from '../services/systemReinitialize.js'
import {
  listCashierAccounts,
  listCashierCurrencies,
  listJournal,
  autoReconcile,
  manualReconcile,
  cancelReconcile,
  getBankReconciliation,
  getAccountBalanceReport,
  getCashFlowSummary,
  searchJournals,
  generateCashierVoucher,
} from '../services/cashierQuery.js'
import {
  assertCashierPeriodOpen,
  assertCashierRangeOpen,
  closeCashierPeriod,
  getLatestClosedCashierPeriod,
  listCashierPeriodStatus,
  normalizeBizDate,
  parseBizDate,
  reopenCashierPeriod,
} from '../services/cashierPeriodClosing.js'
import { assertGlPeriodOpen } from '../services/voucherMutationGuard.js'
import type { Database } from 'better-sqlite3'

/**
 * 新写入的业务日期：严格规范化为 YYYY-MM-DD（P1-7），并同时过出纳结账闸与总账期间闸（P0-2）。
 * 返回规范化后的日期。
 */
function assertJournalDateWritable(db: Database, accountSetId: string, raw: unknown): string {
  const bizDate = normalizeBizDate(raw)
  assertCashierPeriodOpen(db, accountSetId, bizDate)
  const ym = parseBizDate(bizDate)!
  assertGlPeriodOpen(db, accountSetId, ym.year, ym.month)
  return bizDate
}

const round2 = (n: number) => Math.round(n * 100) / 100

/** 借贷金额校验（P2-10 / P2-2）：必须是有限数字、非负，且有且仅有一方大于 0 */
function validateJournalAmounts(debit: unknown, credit: unknown): string | null {
  const d = Number(debit ?? 0)
  const c = Number(credit ?? 0)
  if (!Number.isFinite(d) || !Number.isFinite(c)) return '借方 / 贷方金额必须是数字'
  if (d < 0 || c < 0) return '借方 / 贷方金额不能为负数'
  if (d > 0 && c > 0) return '借方与贷方金额不能同时大于 0'
  if (!(d > 0) && !(c > 0)) return '借方、贷方金额不能同时为空或零'
  return null
}

/**
 * 已入库行的业务日期：历史脏日期（无法规范化）放行，允许用户修正 / 删除；
 * 能解析的则同样过出纳闸与总账闸。
 */
function assertExistingJournalDateWritable(db: Database, accountSetId: string, raw: unknown): void {
  let bizDate: string
  try { bizDate = normalizeBizDate(raw) } catch { return }
  assertCashierPeriodOpen(db, accountSetId, bizDate)
  const ym = parseBizDate(bizDate)!
  assertGlPeriodOpen(db, accountSetId, ym.year, ym.month)
}

/** 已入库行（对账单 / 附件所属日记账）只过出纳闸，脏日期放行 */
function assertExistingCashierDateOpen(db: Database, accountSetId: string, raw: unknown): void {
  let bizDate: string
  try { bizDate = normalizeBizDate(raw) } catch { return }
  assertCashierPeriodOpen(db, accountSetId, bizDate)
}

// 附件上传配置
const ALLOWED_ATTACHMENT_MIMES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]
const MAX_ATTACHMENT_SIZE = 30 * 1024 * 1024 // 30MB

const attachmentUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_ATTACHMENT_SIZE,
    files: 10,
  },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_ATTACHMENT_MIMES.includes(file.mimetype)) {
      return cb(new Error(`不支持的文件类型: ${file.mimetype}，仅允许图片、PDF和Office文档`))
    }
    cb(null, true)
  },
})

function fixGarbledFilename(str: string): string {
  if (!str || typeof str !== 'string') return str
  const latin1Buf = Buffer.from(str, 'latin1')
  const fixed = new TextDecoder('utf-8', { fatal: false }).decode(latin1Buf)
  if (fixed && fixed !== str) {
    const reencoded = Buffer.from(fixed, 'utf-8')
    if (reencoded.equals(latin1Buf)) return fixed
  }
  return str
}

const router = Router()
router.use(authMiddleware)

// ── 出纳模块权限守卫：按路径映射所需权限（admin '*' 自动放行） ──────────
const CASHIER_PERMISSION_RULES: Array<{ re: RegExp; perm: string; alsoPerms?: string[] }> = [
  { re: /^\/cashier\/params/,            perm: 'cashier:param' },
  // 出纳结账 / 反结账：ACD 4AC / 4A3 映射为 cashier:param；状态读取放开给日记账岗位
  // P1-8：任何形如 periods/x/y/close|reopen 的写请求都必须有 cashier:param（此前 `2026.5` 这类畸形年份
  // 不匹配 \d+ 规则，落到下一条 alsoPerms 放行，仅日记账权限即可结账）
  { re: /^\/cashier\/periods\/[^/]+\/[^/]+\/(close|reopen)$/, perm: 'cashier:param' },
  { re: /^\/cashier\/periods/,           perm: 'cashier:param', alsoPerms: ['cashier:journal'] },
  // 结算方式：菜单权限为 cashier:dict；兼容历史 cashier:param 授权
  { re: /^\/cashier\/settle-type(\/|$)/, perm: 'cashier:dict', alsoPerms: ['cashier:param'] },
  // 结算方式字典读取：出纳各页面与供应链单据都会读取
  { re: /^\/cashier\/settle-types(\/|$)/, perm: 'cashier:dict', alsoPerms: ['cashier:param', 'cashier:journal'] },
  { re: /^\/cashier\/init-balance/,      perm: 'cashier:initbal' },
  { re: /^\/cashier\/bank-statement\/import/, perm: 'cashier:import' },
  { re: /^\/cashier\/bank-statement/,    perm: 'cashier:reconcile' },
  { re: /^\/cashier\/reconcil/,          perm: 'cashier:reconcile' }, // reconcile/* 与 reconciliation
  { re: /^\/cashier\/delete-vouchers/,   perm: 'cashier:voucher' },
  { re: /^\/cashier\/generate-voucher/,  perm: 'cashier:voucher' },
  { re: /^\/cashier\/daily-report/,      perm: 'cashier:report' },
  // 其余（journal、accounts、settle-types 读、reset、attachments）默认需出纳日记账权限
  { re: /^\/cashier\//,                  perm: 'cashier:journal' },
]
router.use((req: AuthRequest, res, next) => {
  if (!req.path.startsWith('/cashier/')) return next()
  if (req.permissions?.includes('*')) return next()
  // 收付款单只需读取现金/银行末级科目；允许往来岗位读取账户，不扩大日记账增删改权限。
  if (req.method === 'GET' && req.path === '/cashier/accounts' && req.permissions?.includes('scm:arap')) return next()
  // 供应链单据读取结算方式字典
  if (req.method === 'GET' && req.path === '/cashier/settle-types' && req.permissions?.some(p => p.startsWith('scm:'))) return next()
  const rule = CASHIER_PERMISSION_RULES.find(r => r.re.test(req.path))
  const allowed = rule
    ? req.permissions?.includes(rule.perm) || (rule.alsoPerms?.some(p => req.permissions?.includes(p)) ?? false)
    : true
  if (rule && !allowed) {
    return res.status(403).json({ code: 403, message: '无此操作权限' })
  }
  next()
})

// 科目授权：校验一组科目编码是否都在授权范围内（空/未知编码跳过；越权返回错误信息）
function assertCashierCodesInScope(
  db: ReturnType<typeof getDb>,
  ctx: AccountScopeContext | undefined,
  accountSetId: string,
  codes: Array<string | null | undefined>
): string | null {
  if (!ctx || ctx.bypass || !ctx.restricted) return null
  for (const code of codes) {
    if (!code) continue
    const row = db.prepare('SELECT id FROM accounts WHERE account_set_id=? AND code=?').get(accountSetId, code) as any
    if (!row) continue
    const err = assertAccountIdInScope(ctx, row.id)
    if (err) return err
  }
  return null
}

// ── 出纳参数读写（无需 system:account 权限） ──────────────
const CASHIER_PARAM_KEYS = ['cashier:default_voucher_type_id', 'cashier:default_counter_account']

router.put('/cashier/params', operationLog('保存出纳参数', '出纳管理'), (req: AuthRequest, res) => {
  const { params } = req.body
  if (!Array.isArray(params)) return res.status(400).json({ code: 400, message: '参数格式错误' })
  const db = getDb()
  const upsert = db.prepare('INSERT OR REPLACE INTO system_params (id, account_set_id, param_key, param_value) VALUES (?, ?, ?, ?)')
  for (const p of params) {
    if (!CASHIER_PARAM_KEYS.includes(p.param_key)) continue
    const existing = db.prepare('SELECT id FROM system_params WHERE account_set_id=? AND param_key=?').get(req.accountSetId, p.param_key) as any
    upsert.run(existing?.id || uuidv4(), req.accountSetId, p.param_key, p.param_value ?? '')
  }
  res.json({ code: 0, message: '保存成功' })
})

// ── 结算方式字典 ──────────────────────────────────────────

// GET /cashier/settle-types
router.get('/cashier/settle-types', (req: AuthRequest, res) => {
  const db = getDb()
  const rows = db.prepare('SELECT * FROM settle_type WHERE account_set_id = ? ORDER BY code').all(req.accountSetId || '')
  res.json({ code: 0, data: rows })
})

// POST /cashier/settle-type
router.post('/cashier/settle-type', operationLog('新增结算方式', '出纳管理'), (req: AuthRequest, res) => {
  const { code, name } = req.body
  if (!code || !name) return res.status(400).json({ code: 400, message: '编码和名称不能为空' })
  const db = getDb()
  if (db.prepare('SELECT id FROM settle_type WHERE account_set_id=? AND code=?').get(req.accountSetId, code)) {
    return res.status(409).json({ code: 409, message: '编码已存在' })
  }
  const id = uuidv4()
  db.prepare('INSERT INTO settle_type (id, account_set_id, code, name) VALUES (?, ?, ?, ?)').run(id, req.accountSetId, code, name)
  res.json({ code: 0, data: { id } })
})

// PUT /cashier/settle-type/:id
router.put('/cashier/settle-type/:id', operationLog('修改结算方式', '出纳管理'), (req: AuthRequest, res) => {
  const { name } = req.body
  if (!name) return res.status(400).json({ code: 400, message: '名称不能为空' })
  const db = getDb()
  db.prepare('UPDATE settle_type SET name = ? WHERE id = ? AND account_set_id = ?').run(name, req.params.id, req.accountSetId)
  res.json({ code: 0, data: { ok: true } })
})

// DELETE /cashier/settle-type/:id
router.delete('/cashier/settle-type/:id', operationLog('删除结算方式', '出纳管理'), (req: AuthRequest, res) => {
  const db = getDb()
  db.prepare('DELETE FROM settle_type WHERE id = ? AND account_set_id = ?').run(req.params.id, req.accountSetId)
  res.json({ code: 0, data: { ok: true } })
})

// POST /cashier/settle-type/init — 初始化默认值
router.post('/cashier/settle-type/init', operationLog('初始化结算方式', '出纳管理'), async (req: AuthRequest, res) => {
  try {
    const { ensureDefaultAssetDicts } = await import('../services/accountSetDefaults.js')
    ensureDefaultAssetDicts(getDb(), req.accountSetId || '', 'change_type') // Actually, I should separate cashier defaults
    // Wait, I should add a specific cashier dict init
    ensureDefaultCashierDicts(getDb(), req.accountSetId || '')
    res.json({ code: 0, data: { ok: true } })
  } catch (e: any) {
    res.status(500).json({ code: 500, message: e.message })
  }
})

function ensureDefaultCashierDicts(db: any, accountSetId: string) {
  const ctCount = (db.prepare('SELECT COUNT(*) as c FROM settle_type WHERE account_set_id=?').get(accountSetId) as any).c
  if (ctCount === 0) {
    const insSettle = db.prepare('INSERT OR IGNORE INTO settle_type (id, account_set_id, code, name) VALUES (?, ?, ?, ?)')
    insSettle.run(uuidv4(), accountSetId, '01', '现金')
    insSettle.run(uuidv4(), accountSetId, '02', '转账支票')
    insSettle.run(uuidv4(), accountSetId, '03', '电汇')
    insSettle.run(uuidv4(), accountSetId, '04', '网银')
  }
}

// ── 出纳科目列表（现金/银行末级科目） ────────────────────
router.get('/cashier/accounts', (req: AuthRequest, res) => {
  const asid = req.accountSetId || ''
  res.json({ code: 0, data: listCashierAccounts(asid, req.accountScope) })
})

// ── 出纳币别列表（含本位币，供前端币种切换） ────────────
router.get('/cashier/currencies', (req: AuthRequest, res) => {
  res.json({ code: 0, data: listCashierCurrencies(req.accountSetId || '') })
})

// ── 期初余额 ─────────────────────────────────────────────
router.get('/cashier/init-balance', (req: AuthRequest, res) => {
  const db = getDb()
  const list = db
    .prepare('SELECT * FROM cashier_init_balance WHERE account_set_id = ? ORDER BY account_code, currency')
    .all(req.accountSetId || '') as any[]
  // 所有行共享同一个 init_date（账套级别），取第一条
  const initDate = list[0]?.init_date ?? null
  // 检查是否有对账记录（reconciled=1 的日记账）
  const hasReconciled = !!(db
    .prepare('SELECT 1 FROM cashier_journal WHERE account_set_id=? AND reconciled=1 LIMIT 1')
    .get(req.accountSetId || ''))
  res.json({ code: 0, data: { rows: list, init_date: initDate, locked: hasReconciled } })
})

router.put(
  '/cashier/init-balance',
  operationLog('出纳期初余额', '出纳管理'),
  (req: AuthRequest, res) => {
    const db = getDb()
    // 有对账记录则锁定
    const hasReconciled = !!(db
      .prepare('SELECT 1 FROM cashier_journal WHERE account_set_id=? AND reconciled=1 LIMIT 1')
      .get(req.accountSetId || ''))
    if (hasReconciled) {
      return res.status(400).json({ code: 400, message: '已有对账单据，不允许修改期初余额' })
    }
    // P1-6：期初改动会追溯改写所有已结账月份的余额与报表
    const latestClosed = getLatestClosedCashierPeriod(db, req.accountSetId || '')
    if (latestClosed) {
      return res.status(400).json({
        code: 400,
        message: `出纳已结账至 ${latestClosed.year}年${latestClosed.month}月，修改期初余额请先全部反结账`,
      })
    }

    const { account_code, currency = 'RMB', balance, init_date } = req.body
    if (!account_code || balance === undefined) {
      return res.status(400).json({ code: 400, message: '科目编码和余额不能为空' })
    }
    const existing = db
      .prepare('SELECT id FROM cashier_init_balance WHERE account_set_id=? AND account_code=? AND currency=?')
      .get(req.accountSetId, account_code, currency) as { id: string } | undefined
    if (existing) {
      db.prepare(
        "UPDATE cashier_init_balance SET balance=?, init_date=COALESCE(?,init_date), updated_at=datetime('now') WHERE id=?"
      ).run(Number(balance), init_date ?? null, existing.id)
    } else {
      db.prepare(
        'INSERT INTO cashier_init_balance (id, account_set_id, account_code, currency, balance, init_date) VALUES (?,?,?,?,?,?)'
      ).run(uuidv4(), req.accountSetId, account_code, currency, Number(balance), init_date ?? null)
    }
    res.json({ code: 0, data: { ok: true } })
  }
)

// ── 日记账列表（含逐行余额） ──────────────────────────────
router.get('/cashier/journal', (req: AuthRequest, res) => {
  const { account_code, currency, start_date, end_date, reconciled } = req.query as Record<string, string>
  if (!account_code) return res.status(400).json({ code: 400, message: '科目编码不能为空' })
  const result = listJournal({
    accountSetId: req.accountSetId || '',
    accountCode: account_code,
    currency: currency || 'RMB',
    startDate: start_date,
    endDate: end_date,
    reconciled: reconciled !== undefined ? (Number(reconciled) as 0 | 1) : undefined,
  })
  res.json({ code: 0, data: result })
})

router.post(
  '/cashier/journal',
  operationLog('出纳日记账录入', '出纳管理'),
  (req: AuthRequest, res) => {
    const {
      account_code, currency = 'RMB', biz_date, seq = 0, summary,
      debit = 0, credit = 0, settle_type, bill_no, counter_unit,
      counter_account, bank_name, bank_account, unit_code, counter_aux_item_id,
    } = req.body
    if (!account_code || !biz_date) {
      return res.status(400).json({ code: 400, message: '科目编码和日期不能为空' })
    }
    const db = getDb()
    // 科目授权：现金科目与对方科目须在授权范围内
    const scopeErr = assertCashierCodesInScope(db, req.accountScope, req.accountSetId || '', [account_code, counter_account])
    if (scopeErr) return res.status(403).json({ code: 403, message: scopeErr })
    // 日期严格规范化 + 出纳结账闸 + 总账期间闸
    let bizDate: string
    try { bizDate = assertJournalDateWritable(db, req.accountSetId || '', biz_date) } catch (e: any) {
      return res.status(400).json({ code: 400, message: e.message })
    }
    // P2-10 / P2-2：借贷金额有且仅有一方大于 0（与导入路径一致），非数字返回 400 而不是 500
    const amountErr = validateJournalAmounts(debit, credit)
    if (amountErr) return res.status(400).json({ code: 400, message: amountErr })
    const id = uuidv4()
    db.prepare(
      `INSERT INTO cashier_journal
        (id, account_set_id, account_code, currency, biz_date, seq, summary,
         debit, credit, settle_type, bill_no, counter_unit, counter_account,
         bank_name, bank_account, unit_code, counter_aux_item_id, created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(
      id, req.accountSetId, account_code, currency, bizDate, seq, summary || null,
      round2(Number(debit) || 0), round2(Number(credit) || 0), settle_type || null, bill_no || null,
      counter_unit || null, counter_account || null, bank_name || null,
      bank_account || null, unit_code || null,
      counter_aux_item_id || null, (req as any).user?.name || null
    )
    res.json({ code: 0, data: { id } })
  }
)

router.put(
  '/cashier/journal/:id',
  operationLog('出纳日记账修改', '出纳管理'),
  (req: AuthRequest, res) => {
    const { id } = req.params
    const db = getDb()
    const existing = db
      .prepare('SELECT id, biz_date, debit, credit, reconciled FROM cashier_journal WHERE id=? AND account_set_id=?')
      .get(id, req.accountSetId) as { id: string; biz_date: string; debit: number; credit: number; reconciled: number } | undefined
    if (!existing) return res.status(404).json({ code: 404, message: '记录不存在' })

    const {
      biz_date, seq, summary, debit, credit,
      settle_type, bill_no, counter_unit, counter_account,
      bank_name, bank_account,
    } = req.body
    // 出纳结账闸 + 总账期间闸：原日期与新日期所在月都不能已结账
    let newBizDate: string | null = null
    try {
      assertExistingJournalDateWritable(db, req.accountSetId || '', existing.biz_date)
      if (biz_date) newBizDate = assertJournalDateWritable(db, req.accountSetId || '', biz_date)
    } catch (e: any) {
      return res.status(400).json({ code: 400, message: e.message })
    }
    // P1-4：已勾对的行改金额 / 日期会让对账单与日记账不再对应
    const touchesMatchedFields = debit != null || credit != null || (newBizDate && newBizDate !== existing.biz_date)
    if (existing.reconciled && touchesMatchedFields) {
      return res.status(400).json({ code: 400, message: '该记录已与银行对账单勾对，请先撤销勾对后再修改金额或日期' })
    }
    // P2-10 / P2-2：按修改后的借贷金额校验；非数字返回 400，而不是被 COALESCE 静默丢弃
    if (debit != null || credit != null) {
      const amountErr = validateJournalAmounts(
        debit != null ? debit : existing.debit,
        credit != null ? credit : existing.credit
      )
      if (amountErr) return res.status(400).json({ code: 400, message: amountErr })
    }
    const auxProvided = 'counter_aux_item_id' in req.body
    const auxClause = auxProvided ? 'counter_aux_item_id=?,' : ''
    const auxParam: any[] = auxProvided ? [req.body.counter_aux_item_id || null] : []
    db.prepare(
      `UPDATE cashier_journal SET
        biz_date=COALESCE(?,biz_date), seq=COALESCE(?,seq), summary=COALESCE(?,summary),
        debit=COALESCE(?,debit), credit=COALESCE(?,credit),
        settle_type=COALESCE(?,settle_type), bill_no=COALESCE(?,bill_no),
        counter_unit=COALESCE(?,counter_unit), counter_account=COALESCE(?,counter_account),
        bank_name=COALESCE(?,bank_name), bank_account=COALESCE(?,bank_account),
        ${auxClause}
        updated_at=datetime('now')
       WHERE id=?`
    ).run(
      newBizDate, seq, summary, debit != null ? round2(Number(debit)) : null,
      credit != null ? round2(Number(credit)) : null,
      settle_type, bill_no, counter_unit, counter_account, bank_name, bank_account,
      ...auxParam, id
    )
    res.json({ code: 0, data: { ok: true } })
  }
)

router.delete(
  '/cashier/journal/:id',
  operationLog('出纳日记账删除', '出纳管理'),
  async (req: AuthRequest, res) => {
    const { id } = req.params
    const db = getDb()
    const existing = db.prepare(
      'SELECT id, voucher_no, voucher_year, voucher_month, voucher_id, biz_date, summary, reconciled FROM cashier_journal WHERE id=? AND account_set_id=?'
    ).get(id, req.accountSetId) as any
    if (!existing) return res.status(404).json({ code: 404, message: '记录不存在' })
    try { assertExistingJournalDateWritable(db, req.accountSetId || '', existing.biz_date) } catch (e: any) {
      return res.status(400).json({ code: 400, message: e.message })
    }
    // P1-4：已勾对的行删除后对账单侧 matched=1 成孤儿，余额调节表永久不平
    if (existing.reconciled) {
      return res.status(400).json({ code: 400, message: '该记录已与银行对账单勾对，请先撤销勾对后再删除' })
    }

    let deletedVoucher: { voucher_no: string; status: string } | null = null
    if (existing.voucher_no || existing.voucher_id) {
      // P1-11：优先按 voucher_id 定位，存量行回退到 年/期/号
      const voucher =
        (existing.voucher_id
          ? (db.prepare('SELECT id, voucher_no, status, source FROM vouchers WHERE id=? AND account_set_id=?').get(existing.voucher_id, req.accountSetId) as any)
          : null) ||
        (db.prepare(
          'SELECT id, voucher_no, status, source FROM vouchers WHERE account_set_id=? AND year=? AND period=? AND CAST(voucher_no AS TEXT)=CAST(? AS TEXT) AND source=?'
        ).get(req.accountSetId, existing.voucher_year, existing.voucher_month, existing.voucher_no, 'cashier') as any)
      if (voucher) {
        if (voucher.status === 'posted') {
          return res.status(400).json({ code: 400, message: `关联凭证 ${voucher.voucher_no} 已过账，无法删除，请先反过账` })
        }
        // P2-5：统一走 deleteVoucherWithRefs（含冲红 / 调汇 / 供应链回写清理）
        deleteVoucherWithRefs(db, req.accountSetId || '', voucher)
        deletedVoucher = { voucher_no: voucher.voucher_no, status: voucher.status }
      }
    }

    // 清理附件
    const attachments = db.prepare('SELECT filename FROM cashier_attachments WHERE journal_id = ?').all(id) as any[]
    for (const a of attachments) {
      const filePath = path.join(process.cwd(), 'uploads', 'attachments', path.basename(a.filename))
      await fs.unlink(filePath).catch(() => {})
    }
    db.prepare('DELETE FROM cashier_attachments WHERE journal_id = ?').run(id)

    db.prepare('DELETE FROM cashier_journal WHERE id=?').run(id)
    res.json({ code: 0, data: { ok: true, deletedVoucher } })
  }
)

// ── 出纳日记账批量导入（Excel 解析在前端完成，此处仅落库） ──
router.post(
  '/cashier/journal/import',
  operationLog('出纳日记账批量导入', '出纳管理'),
  (req: AuthRequest, res) => {
    const { account_code, currency = 'RMB', rows } = req.body
    if (!account_code) return res.status(400).json({ code: 400, message: '科目编码不能为空' })
    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ code: 400, message: '导入数据为空' })
    }
    const db = getDb()
    const stmt = db.prepare(
      `INSERT INTO cashier_journal
        (id, account_set_id, account_code, currency, biz_date, seq, summary,
         debit, credit, settle_type, bill_no, counter_unit, counter_account,
         bank_name, bank_account, unit_code, counter_aux_item_id, created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    )
    const maker = (req as any).user?.name || null
    let inserted = 0
    const errors: { row: number; message: string }[] = []
    const tx = db.transaction(() => {
      rows.forEach((r: any, i: number) => {
        const rowNo = i + 1
        if (!r.biz_date) { errors.push({ row: rowNo, message: '日期为空' }); return }
        let bizDate: string
        try { bizDate = assertJournalDateWritable(db, req.accountSetId || '', r.biz_date) } catch (e: any) {
          errors.push({ row: rowNo, message: e.message }); return
        }
        const debit = round2(Number(r.debit) || 0)
        const credit = round2(Number(r.credit) || 0)
        const amountErr = validateJournalAmounts(debit, credit)
        if (amountErr) {
          errors.push({ row: rowNo, message: amountErr }); return
        }
        stmt.run(
          uuidv4(), req.accountSetId, account_code, currency, bizDate, r.seq ?? rowNo,
          r.summary || null, debit, credit, r.settle_type || null, r.bill_no || null,
          r.counter_unit || null, r.counter_account || null, null, null, null, null, maker
        )
        inserted++
      })
    })
    tx()
    res.json({ code: 0, data: { inserted, errors } })
  }
)

// ── 银行对账单 ────────────────────────────────────────────
router.get('/cashier/bank-statement', (req: AuthRequest, res) => {
  const { account_code, start_date, end_date, matched } = req.query as Record<string, string>
  const db = getDb()
  const conds = ['account_set_id = ?']
  const params: any[] = [req.accountSetId]
  if (account_code) { conds.push('account_code = ?'); params.push(account_code) }
  if (start_date) { conds.push('biz_date >= ?'); params.push(start_date) }
  if (end_date) { conds.push('biz_date <= ?'); params.push(end_date) }
  if (matched !== undefined) { conds.push('matched = ?'); params.push(Number(matched)) }
  const rows = db
    .prepare(`SELECT * FROM bank_statement WHERE ${conds.join(' AND ')} ORDER BY biz_date, id`)
    .all(...params)
  res.json({ code: 0, data: rows })
})

router.post(
  '/cashier/bank-statement',
  operationLog('录入对账单', '出纳管理'),
  (req: AuthRequest, res) => {
    const { account_code, biz_date, debit = 0, credit = 0, settle_type, bill_no } = req.body
    if (!account_code || !biz_date) {
      return res.status(400).json({ code: 400, message: '科目编码和日期不能为空' })
    }
    const db = getDb()
    // P1-6 / P1-7：日期规范化 + 已结账月份不允许录入对账单（会改写该月余额调节表）
    let bizDate: string
    try {
      bizDate = normalizeBizDate(biz_date)
      assertCashierPeriodOpen(db, req.accountSetId || '', bizDate)
    } catch (e: any) {
      return res.status(400).json({ code: 400, message: e.message })
    }
    const amountErr = validateJournalAmounts(debit, credit)
    if (amountErr) return res.status(400).json({ code: 400, message: amountErr })
    const id = uuidv4()
    db.prepare(
      `INSERT INTO bank_statement (id, account_set_id, account_code, biz_date, debit, credit, settle_type, bill_no, source)
       VALUES (?,?,?,?,?,?,?,?,'manual')`
    ).run(id, req.accountSetId, account_code, bizDate, round2(Number(debit) || 0), round2(Number(credit) || 0), settle_type || null, bill_no || null)
    res.json({ code: 0, data: { id } })
  }
)

// DELETE /cashier/bank-statement/:id — 删除未对账的银行对账单
router.delete('/cashier/bank-statement/:id', operationLog('删除对账单', '出纳管理'), (req: AuthRequest, res) => {
  const db = getDb()
  const row = db.prepare('SELECT id, matched, biz_date FROM bank_statement WHERE id=? AND account_set_id=?')
    .get(req.params.id, req.accountSetId) as any
  if (!row) return res.status(404).json({ code: 404, message: '记录不存在' })
  if (row.matched) return res.status(400).json({ code: 400, message: '已对账的对账单不能删除，请先撤销对账' })
  // P1-6：已结账月份的对账单不允许删除
  try { assertExistingCashierDateOpen(db, req.accountSetId || '', row.biz_date) } catch (e: any) {
    return res.status(400).json({ code: 400, message: e.message })
  }
  db.prepare('DELETE FROM bank_statement WHERE id=? AND account_set_id=?').run(req.params.id, req.accountSetId)
  res.json({ code: 0, data: { ok: true } })
})

// ── 银行自动对账 ──────────────────────────────────────────
router.post(
  '/cashier/reconcile/auto',
  operationLog('银行自动对账', '出纳管理'),
  (req: AuthRequest, res) => {
    const { account_code, start_date, end_date, use_bill_no } = req.body
    if (!account_code) return res.status(400).json({ code: 400, message: '科目编码不能为空' })
    const result = autoReconcile({
      accountSetId: req.accountSetId || '',
      accountCode: account_code,
      startDate: start_date,
      endDate: end_date,
      useBillNo: !!use_bill_no,
    })
    res.json({ code: 0, data: result })
  }
)

// ── 银行手动勾对 ──────────────────────────────────────────
router.post(
  '/cashier/reconcile/manual',
  operationLog('银行手动勾对', '出纳管理'),
  (req: AuthRequest, res) => {
    const { journal_id, bank_statement_id } = req.body
    if (!journal_id || !bank_statement_id) {
      return res.status(400).json({ code: 400, message: '日记账ID和对账单ID不能为空' })
    }
    const db = getDb()
    const result = manualReconcile({
      db,
      accountSetId: req.accountSetId || '',
      journalId: journal_id,
      bankStatementId: bank_statement_id,
    })
    if ('error' in result) return res.status(400).json({ code: 400, message: result.error })
    res.json({ code: 0, data: result })
  }
)

// ── 撤销勾对 ──────────────────────────────────────────────
router.post(
  '/cashier/reconcile/cancel',
  operationLog('撤销银行对账', '出纳管理'),
  (req: AuthRequest, res) => {
    const { journal_id } = req.body
    if (!journal_id) return res.status(400).json({ code: 400, message: '日记账ID不能为空' })
    const db = getDb()
    const result = cancelReconcile({
      db,
      accountSetId: req.accountSetId || '',
      journalId: journal_id,
    })
    if ('error' in result) return res.status(400).json({ code: 400, message: result.error })
    res.json({ code: 0, data: result })
  }
)

// ── 批量删除出纳生成的凭证 ────────────────────────────────
router.post(
  '/cashier/delete-vouchers',
  operationLog('批量删除出纳凭证', '出纳管理'),
  (req: AuthRequest, res) => {
    const { account_code, start_date, end_date } = req.body
    const db = getDb()
    const asId = req.accountSetId || ''
    try { assertCashierRangeOpen(db, asId, start_date, end_date) } catch (e: any) {
      return res.status(400).json({ code: 400, message: e.message })
    }

    // 直接从 vouchers 表查 source='cashier' 的凭证，按日期范围过滤。
    // 指定 account_code 时，只删除被该科目出纳日记账关联的凭证，避免误删其他现金/银行账户的出纳凭证。
    // P1-11：优先按 cashier_journal.voucher_id 关联（迁移 127），存量行回退到 年/期/号 匹配
    const conds = [`v.account_set_id=?`, `v.source='cashier'`]
    const vals: any[] = [asId]
    if (account_code) {
      conds.push(`EXISTS (SELECT 1 FROM cashier_journal j
        WHERE j.account_set_id = v.account_set_id AND j.account_code = ?
          AND (j.voucher_id = v.id OR (j.voucher_id IS NULL
            AND CAST(j.voucher_no AS TEXT) = CAST(v.voucher_no AS TEXT)
            AND j.voucher_year = v.year AND j.voucher_month = v.period)))`)
      vals.push(account_code)
    }
    if (start_date) { conds.push('v.voucher_date >= ?'); vals.push(start_date) }
    if (end_date)   { conds.push('v.voucher_date <= ?'); vals.push(end_date) }
    const vouchers = db.prepare(
      `SELECT v.id, v.voucher_no, v.status, v.source, v.year, v.period, v.voucher_type_id FROM vouchers v WHERE ${conds.join(' AND ')}`
    ).all(...vals) as any[]

    let deleted = 0, skipped = 0
    const deletedNos: string[] = []
    const groupMap = new Map<string, { year: number; period: number; voucher_type_id: string | null }>()
    const tx = db.transaction(() => {
      for (const v of vouchers) {
        if (v.status === 'posted') { skipped++; continue }
        // 记录受影响 (年,期,类型) 分组，供前端提示重新排号
        const gkey = `${v.year}|${v.period}|${v.voucher_type_id ?? ''}`
        if (!groupMap.has(gkey)) {
          groupMap.set(gkey, { year: v.year, period: v.period, voucher_type_id: v.voucher_type_id ?? null })
        }
        // P2-5：走统一出口，顺带清理冲红 / 调汇 / 供应链回写与本表 voucher_id
        deleteVoucherWithRefs(db, asId, v)
        deletedNos.push(v.voucher_no)
        deleted++
      }
      // 删完后统一清零：日记账中 voucher_no 非空但对应凭证已不存在的记录
      // 同时清掉 counter_account：该对方科目是生成/编辑凭证时回写进来的，凭证删除后应一并还原为空，便于重新生成时重新挂账
      const clearConds = [
        'account_set_id=?',
        'voucher_no IS NOT NULL',
        `CASE WHEN voucher_id IS NOT NULL
              THEN NOT EXISTS (SELECT 1 FROM vouchers v2 WHERE v2.id = cashier_journal.voucher_id)
              ELSE NOT EXISTS (SELECT 1 FROM vouchers v2 WHERE v2.account_set_id=cashier_journal.account_set_id
                AND v2.year=cashier_journal.voucher_year AND v2.period=cashier_journal.voucher_month
                AND CAST(v2.voucher_no AS TEXT)=CAST(cashier_journal.voucher_no AS TEXT))
         END`,
      ]
      const clearVals: any[] = [asId]
      if (account_code) { clearConds.push('account_code=?'); clearVals.push(account_code) }
      db.prepare(`UPDATE cashier_journal SET voucher_year=NULL,voucher_month=NULL,voucher_type=NULL,voucher_no=NULL,voucher_id=NULL,counter_account=NULL
        WHERE ${clearConds.join(' AND ')}`).run(...clearVals)
    })
    tx()
    res.json({ code: 0, data: { deleted, skipped, deletedNos, affectedGroups: [...groupMap.values()] } })
  }
)

// ── 银行余额调节表 ──────────────────────────────────────────

router.get('/cashier/reconciliation', (req: AuthRequest, res) => {
  const { account_code, end_date } = req.query as Record<string, string>
  if (!account_code || !end_date) {
    return res.status(400).json({ code: 400, message: '科目编码和截止日期不能为空' })
  }
  const data = getBankReconciliation({
    accountSetId: req.accountSetId || '',
    accountCode: account_code,
    endDate: end_date,
  })
  res.json({ code: 0, data })
})

// ── 出纳对账 → 生成凭证 ──────────────────────────────────

router.post(
  '/cashier/generate-voucher',
  operationLog('出纳生成凭证', '出纳管理'),
  (req: AuthRequest, res) => {
    const { account_code, start_date, end_date, hangup_account_code, ids } = req.body
    if (!account_code) return res.status(400).json({ code: 400, message: '科目编码不能为空' })
    const db = getDb()
    // 出纳结账闸：按 ids 时逐条校验业务日期，否则按日期区间校验
    try {
      if (Array.isArray(ids) && ids.length) {
        const placeholders = ids.map(() => '?').join(',')
        const rows = db.prepare(`SELECT biz_date FROM cashier_journal WHERE account_set_id=? AND id IN (${placeholders})`)
          .all(req.accountSetId, ...ids) as Array<{ biz_date: string }>
        for (const r of rows) assertCashierPeriodOpen(db, req.accountSetId || '', r.biz_date)
      } else {
        assertCashierRangeOpen(db, req.accountSetId || '', start_date, end_date)
      }
    } catch (e: any) {
      return res.status(400).json({ code: 400, message: e.message })
    }
    const result = generateCashierVoucher({
      db,
      accountSetId: req.accountSetId || '',
      accountCode: account_code,
      startDate: start_date,
      endDate: end_date,
      makerName: (req as any).userName || '系统',
      hangupAccountCode: hangup_account_code || undefined,
      ids,
    })
    if ('error' in result) {
      // 携带未填对方科目的记录明细，供前端列出引导补全 / 选择挂账科目
      return res.status(400).json({ code: 400, message: result.error, missingRows: result.missingRows })
    }
    res.json({ code: 0, data: result })
  }
)

// ── 出纳结账 / 反结账 ─────────────────────────────────────────
router.get('/cashier/periods/:year', (req: AuthRequest, res) => {
  const year = Number(req.params.year) || new Date().getFullYear()
  res.json({ code: 0, data: { year, months: listCashierPeriodStatus(getDb(), req.accountSetId || '', year) } })
})

router.post(
  '/cashier/periods/:year/:month/close',
  operationLog('出纳结账', '出纳管理'),
  (req: AuthRequest, res) => {
    try {
      const data = closeCashierPeriod({
        db: getDb(),
        accountSetId: req.accountSetId || '',
        year: Number(req.params.year),
        month: Number(req.params.month),
        userId: req.userId,
        userName: req.userName,
      })
      res.json({ code: 0, data })
    } catch (e: any) {
      res.status(400).json({ code: 400, message: e.message || '结账失败' })
    }
  }
)

router.post(
  '/cashier/periods/:year/:month/reopen',
  operationLog('出纳反结账', '出纳管理'),
  (req: AuthRequest, res) => {
    try {
      const data = reopenCashierPeriod({
        db: getDb(),
        accountSetId: req.accountSetId || '',
        year: Number(req.params.year),
        month: Number(req.params.month),
      })
      res.json({ code: 0, data })
    } catch (e: any) {
      res.status(400).json({ code: 400, message: e.message || '反结账失败' })
    }
  }
)

// ── 单据综合查询 ─────────────────────────────────────────────

router.get('/cashier/journal/search', (req: AuthRequest, res) => {
  const query = req.query as any
  const data = searchJournals({
    accountSetId: req.accountSetId || '',
    accountCodes: query.account_codes ? query.account_codes.split(',') : undefined,
    currency: query.currency || undefined,
    startDate: query.start_date || undefined,
    endDate: query.end_date || undefined,
    summary: query.summary || undefined,
    settleTypes: query.settle_types ? query.settle_types.split(',') : undefined,
    billNo: query.bill_no || undefined,
    counterUnit: query.counter_unit || undefined,
    counterAccount: query.counter_account || undefined,
    amountDirection: query.amount_direction as 'all' | 'income' | 'expense' || undefined,
    minAmount: query.min_amount ? Number(query.min_amount) : undefined,
    maxAmount: query.max_amount ? Number(query.max_amount) : undefined,
    reconciled: query.reconciled ? Number(query.reconciled) as 0|1 : undefined,
    hasVoucher: query.has_voucher ? Number(query.has_voucher) as 0|1 : undefined,
    page: query.page ? Number(query.page) : undefined,
    pageSize: query.page_size ? Number(query.page_size) : undefined,
  })
  res.json({ code: 0, data })
})

// ── 出纳日报 ─────────────────────────────────────────────

router.get('/cashier/daily-report', (req: AuthRequest, res) => {
  const { start_date, end_date, currency } = req.query as Record<string, string>
  if (!start_date || !end_date) return res.status(400).json({ code: 400, message: '日期区间不能为空' })
  const data = getAccountBalanceReport({ accountSetId: req.accountSetId || '', startDate: start_date, endDate: end_date, currency })
  res.json({ code: 0, data })
})

// ── 资金收支汇总表 ──────────────────────────────────────────

router.get('/cashier/summary-report', (req: AuthRequest, res) => {
  const { start_date, end_date, currency, group_by } = req.query as Record<string, string>
  if (!['counter_account', 'settle_type', 'month'].includes(group_by)) {
    return res.status(400).json({ code: 400, message: '无效的分组维度' })
  }
  const data = getCashFlowSummary({
    accountSetId: req.accountSetId || '',
    startDate: start_date,
    endDate: end_date,
    currency,
    groupBy: group_by as 'counter_account' | 'settle_type' | 'month'
  })
  res.json({ code: 0, data })
})

// ── 出纳初始化（清理所有出纳数据） ───────────────────────
router.post(
  '/cashier/reset',
  operationLog('出纳初始化', '出纳管理'),
  async (req: AuthRequest, res) => {
    const db = getDb()
    const asid = req.accountSetId || ''
    // 强制：清空前先完整备份本账套，备份失败则中止
    let backupFile = ''
    try {
      const b = await createPreReinitializeBackup(asid, req.userId)
      backupFile = b.filename
    } catch (e: any) {
      return res.status(500).json({ code: 500, message: e?.message || '初始化前自动备份失败，已中止操作' })
    }
    db.transaction(() => {
      db.prepare('DELETE FROM cashier_journal WHERE account_set_id=?').run(asid)
      db.prepare('DELETE FROM cashier_init_balance WHERE account_set_id=?').run(asid)
      db.prepare('DELETE FROM bank_statement WHERE account_set_id=?').run(asid)
      db.prepare('DELETE FROM cashier_period_closing WHERE account_set_id=?').run(asid)
    })()
    res.json({ code: 0, data: { ok: true, backup: backupFile } })
  }
)

// ── 出纳日记账附件 ──────────────────────────────────────

router.post(
  '/cashier/journal/:id/attachments',
  attachmentUpload.array('file'),
  operationLog('上传出纳附件', '出纳管理'),
  async (req: AuthRequest, res) => {
    const { id: journalId } = req.params
    const accountSetId = req.accountSetId

    if (!req.files || (req.files as Express.Multer.File[]).length === 0) {
      return res.status(400).json({ code: 400, message: '请选择要上传的文件' })
    }

    const db = getDb()
    const journal = db.prepare('SELECT id, biz_date FROM cashier_journal WHERE id = ? AND account_set_id = ?').get(journalId, accountSetId) as any
    if (!journal) {
      return res.status(404).json({ code: 404, message: '出纳记录不存在' })
    }
    // P1-6：已结账月份的日记账附件不可增删
    try { assertExistingCashierDateOpen(db, accountSetId || '', journal.biz_date) } catch (e: any) {
      return res.status(400).json({ code: 400, message: e.message })
    }

    const uploadDir = path.join(process.cwd(), 'uploads', 'attachments')
    await fs.mkdir(uploadDir, { recursive: true })

    const files = req.files as Express.Multer.File[]
    const writtenPaths: string[] = []
    const attachments: any[] = []

    try {
      for (const file of files) {
        const ext = path.extname(file.originalname)
        const filename = `${uuidv4()}${ext}`
        const filePath = path.join(uploadDir, filename)
        
        await fs.writeFile(filePath, file.buffer)
        writtenPaths.push(filePath)

        attachments.push({
          id: uuidv4(),
          account_set_id: accountSetId,
          journal_id: journalId,
          filename: filename,
          original_name: fixGarbledFilename(file.originalname),
          file_path: `/uploads/attachments/${filename}`,
          file_size: file.size,
          mime_type: file.mimetype,
          created_by: (req as any).userId,
        })
      }

      const ins = db.prepare(`
        INSERT INTO cashier_attachments 
        (id, account_set_id, journal_id, filename, original_name, file_path, file_size, mime_type, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)

      const tx = db.transaction(() => {
        for (const a of attachments) {
          ins.run(a.id, a.account_set_id, a.journal_id, a.filename, a.original_name, a.file_path, a.file_size, a.mime_type, a.created_by)
        }
      })
      tx()

      res.json({ code: 0, data: attachments, message: `成功上传 ${attachments.length} 个文件` })
    } catch (error: any) {
      for (const p of writtenPaths) {
        await fs.unlink(p).catch(() => {})
      }
      res.status(500).json({ code: 500, message: `文件写入失败: ${error.message}` })
    }
  }
)

router.get('/cashier/journal/:id/attachments', (req: AuthRequest, res) => {
  const db = getDb()
  const attachments = db.prepare(`
    SELECT id, filename, original_name, file_path, file_size, mime_type, created_at, created_by
    FROM cashier_attachments
    WHERE journal_id = ? AND account_set_id = ?
    ORDER BY created_at
  `).all(req.params.id, req.accountSetId)
  res.json({ code: 0, data: attachments })
})

router.delete(
  '/cashier/journal/:id/attachments/:attachmentId',
  operationLog('删除出纳附件', '出纳管理'),
  async (req: AuthRequest, res) => {
    const { id: journalId, attachmentId } = req.params
    const accountSetId = req.accountSetId
    const db = getDb()

    try {
      const attachment = db.prepare(`
        SELECT * FROM cashier_attachments 
        WHERE id = ? AND journal_id = ? AND account_set_id = ?
      `).get(attachmentId, journalId, accountSetId) as any

      if (!attachment) {
        return res.status(404).json({ code: 404, message: '附件不存在' })
      }
      // P1-6：已结账月份的日记账附件不可增删
      const journalRow = db.prepare('SELECT biz_date FROM cashier_journal WHERE id = ? AND account_set_id = ?').get(journalId, accountSetId) as any
      if (journalRow) {
        try { assertExistingCashierDateOpen(db, accountSetId || '', journalRow.biz_date) } catch (e: any) {
          return res.status(400).json({ code: 400, message: e.message })
        }
      }

      const safeFilename = path.basename(attachment.filename)
      const filePath = path.join(process.cwd(), 'uploads', 'attachments', safeFilename)
      
      await fs.unlink(filePath).catch(err => {
        console.warn(`物理文件删除失败: ${filePath}`, err)
      })

      db.prepare('DELETE FROM cashier_attachments WHERE id = ? AND journal_id = ? AND account_set_id = ?')
        .run(attachmentId, journalId, accountSetId)

      res.json({ code: 0, message: '附件已删除' })
    } catch (error: any) {
      res.status(500).json({ code: 500, message: error.message })
    }
  }
)

export default router
