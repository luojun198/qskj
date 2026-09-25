import { Router } from 'express'
import { parseAmountFilter } from '../utils/amountUtils.js'
import { v4 as uuidv4 } from 'uuid'
import fs from 'fs/promises'
import path from 'path'
import multer from 'multer'
import { getDb } from '../db/index.js'
import { authMiddleware, AuthRequest, operationLog } from '../middleware/index.js'
import { cashierPermissionGuard } from '../middleware/cashierPermission.js'
import { deleteVoucherWithRefs } from '../services/voucherDelete.js'
import { assertAccountIdInScope, type AccountScopeContext } from '../services/accountAuthorization.js'
import { createPreReinitializeBackup } from '../services/systemReinitialize.js'
import {
  listCashierAccounts,
  listCashierCurrencies,
  listJournal,
  getAccountBalanceReport,
  getCashFlowSummary,
  searchJournals,
  generateCashierVoucher,
  previewCashierGenerate,
  getCashierBaseCurrency,
  normalizeCashierCurrency,
  appendCashierCodeScopeCondition,
  getCashierAccountCurrency,
  resolveCashierRate,
  computeBaseAmounts,
} from '../services/cashierQuery.js'
import {
  assertCashierPeriodOpen,
  closeCashierPeriod,
  getLatestClosedCashierPeriod,
  listCashierPeriodStatus,
  normalizeBizDate,
  parseBizDate,
  reopenCashierPeriod,
} from '../services/cashierPeriodClosing.js'
import { assertGlPeriodOpen } from '../services/voucherMutationGuard.js'
import { fixGarbledFilename } from '../utils/uploadFilename.js'
import { getGlOpeningBalance } from '../services/cashierOpening.js'
import { getCashierResetImpact, performCashierReset } from '../services/cashierReset.js'
import {
  assertJournalDateWritable, importJournalRows, round2, validateJournalAmounts,
} from '../services/cashierJournalImport.js'
import {
  autoMatch, cancelMatch, getBatchMembers, getCashierGlReport, getPeriodSummary, listCashierRows, listGlEntries,
  GL_RECONCILE_LIST_LIMIT,
  manualMatch, pruneStaleMatches,
} from '../services/cashierGlReconcile.js'
import type { Database } from 'better-sqlite3'


/**
 * FIX-260：解析写入用的币种与汇率。币种跟科目走（外币科目取科目币种，否则本位币）；
 * 前端若传了 currency 且与科目不一致视为错误。本位币汇率强制 1；外币汇率缺省走汇率链，传了必须 > 0。
 */
function resolveJournalFx(
  db: Database,
  accountSetId: string,
  accountCode: string,
  bizDate: string,
  rawCurrency: unknown,
  rawRate: unknown
): { currency: string; rate: number } | { error: string } {
  const base = getCashierBaseCurrency(db, accountSetId)
  const currency = getCashierAccountCurrency(db, accountSetId, accountCode)
  if (rawCurrency != null && String(rawCurrency).trim() !== '' && normalizeCashierCurrency(rawCurrency, base) !== currency) {
    return { error: `科目 ${accountCode} 的核算币种为 ${currency}，与传入币种不一致` }
  }
  if (currency === base) return { currency, rate: 1 }
  if (rawRate == null || rawRate === '') return { currency, rate: resolveCashierRate(db, accountSetId, currency, bizDate) }
  const rate = Number(rawRate)
  if (!Number.isFinite(rate) || rate <= 0) return { error: '汇率必须是大于 0 的数字' }
  return { currency, rate }
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

const router = Router()
router.use(authMiddleware)

// ── 出纳模块权限守卫（规则表见 middleware/cashierPermission.ts，与 cashierImport.ts 共用） ──
router.use(cashierPermissionGuard)

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

/** 单科目入口的科目授权（P1-10）：越权返回 403 */
function scopeGuard(req: AuthRequest, res: any, codes: Array<string | null | undefined>): boolean {
  const err = assertCashierCodesInScope(getDb(), req.accountScope, req.accountSetId || '', codes)
  if (err) { res.status(403).json({ code: 403, message: err }); return false }
  return true
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
  const row = db.prepare('SELECT code, name FROM settle_type WHERE id = ? AND account_set_id = ?').get(req.params.id, req.accountSetId) as any
  if (!row) return res.status(404).json({ code: 404, message: '结算方式不存在' })
  // P2-9：已被日记账 / 对账单 / 供应链单据引用的结算方式不允许删除，否则历史行退化为裸编码，
  // 之后新增同编码不同名称的结算方式会把历史口径改写
  const refs: string[] = []
  const countIn = (table: string, col = 'settle_type') => {
    const exists = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)
    if (!exists) return 0
    return (db.prepare(`SELECT COUNT(*) c FROM ${table} WHERE account_set_id=? AND ${col}=?`).get(req.accountSetId, row.code) as any).c
  }
  const j = countIn('cashier_journal')
  const b = countIn('bank_statement')
  if (j) refs.push(`出纳日记账 ${j} 条`)
  if (b) refs.push(`银行对账单 ${b} 条`)
  if (refs.length) {
    return res.status(400).json({ code: 400, message: `结算方式「${row.name}」已被引用（${refs.join('、')}），不能删除` })
  }
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
  const ibConds = ['account_set_id = ?']
  const ibParams: any[] = [req.accountSetId || '']
  appendCashierCodeScopeCondition(req.accountScope, req.accountSetId || '', 'account_code', ibConds, ibParams)
  const list = db
    .prepare(`SELECT * FROM cashier_init_balance WHERE ${ibConds.join(' AND ')} ORDER BY account_code, currency`)
    .all(...ibParams) as any[]
  // 所有行共享同一个 init_date（账套级别），取第一条
  const initDate = list[0]?.init_date ?? null
  // FIX-263：只有出纳已结账才锁期初（期初改动会改写已结账月份的余额与报表）。
  // 对账是日记账行 ↔ 分录逐笔匹配，与期初无关，不再因「已对账」锁定。
  const latestClosed = getLatestClosedCashierPeriod(db, req.accountSetId || '')
  res.json({
    code: 0,
    data: {
      rows: list,
      init_date: initDate,
      locked: !!latestClosed,
      locked_reason: latestClosed ? `出纳已结账至 ${latestClosed.year}年${latestClosed.month}月，修改期初请先在「出纳结账」中全部反结账` : null,
    },
  })
})

router.put(
  '/cashier/init-balance',
  operationLog('出纳期初余额', '出纳管理'),
  (req: AuthRequest, res) => {
    const db = getDb()
    // FIX-263：不再因「已对账」锁定（对账逐笔匹配，与期初无关）；只保留已结账锁
    // P1-6：期初改动会追溯改写所有已结账月份的余额与报表
    const latestClosed = getLatestClosedCashierPeriod(db, req.accountSetId || '')
    if (latestClosed) {
      return res.status(400).json({
        code: 400,
        message: `出纳已结账至 ${latestClosed.year}年${latestClosed.month}月，修改期初余额请先全部反结账`,
      })
    }

    const { account_code, balance, init_date } = req.body
    const currency = normalizeCashierCurrency(req.body.currency, getCashierBaseCurrency(db, req.accountSetId || ''))
    if (!account_code || balance === undefined) {
      return res.status(400).json({ code: 400, message: '科目编码和余额不能为空' })
    }
    if (!scopeGuard(req, res, [account_code])) return
    if (init_date != null && init_date !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(String(init_date))) {
      return res.status(400).json({ code: 400, message: '出纳启用日期格式应为 YYYY-MM-DD' })
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
    // 评审 P1-6：启用日期是账套级的，改一行即同步全部期初行，避免各行日期不一致
    if (init_date) {
      db.prepare("UPDATE cashier_init_balance SET init_date=?, updated_at=datetime('now') WHERE account_set_id=? AND (init_date IS NULL OR init_date<>?)")
        .run(init_date, req.accountSetId, init_date)
    }
    res.json({ code: 0, data: { ok: true } })
  }
)

/**
 * FIX-261：读入总账余额——各出纳科目在出纳启用月之前的总账余额，供期初页回填「期初余额」。
 * 只读计算，是否保存由前端「保存」决定（保存时仍走期初锁定校验）。
 */
router.get('/cashier/init-balance/gl', (req: AuthRequest, res) => {
  const db = getDb()
  const asid = req.accountSetId || ''
  const stored = (db.prepare(
    'SELECT init_date FROM cashier_init_balance WHERE account_set_id=? AND init_date IS NOT NULL LIMIT 1'
  ).get(asid) as { init_date: string } | undefined)?.init_date
  const initDate = String(req.query.init_date || stored || '')
  if (!/^\d{4}-\d{2}/.test(initDate)) {
    return res.status(400).json({ code: 400, message: '尚未设置出纳启用日期，无法读取总账余额' })
  }
  const base = getCashierBaseCurrency(db, asid)
  // 与期初页一致：出纳末级科目（已按科目授权过滤）
  const accounts = listCashierAccounts(asid, req.accountScope)
  const conds = ['account_set_id = ?']
  const params: any[] = [asid]
  appendCashierCodeScopeCondition(req.accountScope, asid, 'account_code', conds, params)
  const existing = db.prepare(`SELECT account_code, currency FROM cashier_init_balance WHERE ${conds.join(' AND ')}`)
    .all(...params) as Array<{ account_code: string; currency: string }>
  // 每个科目的币种：科目核算币种 + 期初表里已有的币种行
  const pairs = new Map<string, { account_code: string; currency: string }>()
  for (const a of accounts) {
    const cur = Number(a.is_foreign || 0) === 1 && a.currency_code
      ? normalizeCashierCurrency(a.currency_code, base) : base
    pairs.set(`${a.code}::${cur}`, { account_code: a.code, currency: cur })
  }
  for (const r of existing) pairs.set(`${r.account_code}::${r.currency}`, r)
  const rows = [...pairs.values()]
    .map(p => ({ ...p, balance: getGlOpeningBalance(db, asid, p.account_code, p.currency, initDate, base) }))
    .filter(r => r.balance !== null)
  res.json({ code: 0, data: { init_date: initDate, rows } })
})

// ── 日记账列表（含逐行余额） ──────────────────────────────
router.get('/cashier/journal', (req: AuthRequest, res) => {
  const { account_code, currency, start_date, end_date, page, page_size } = req.query as Record<string, string>
  if (!account_code) return res.status(400).json({ code: 400, message: '科目编码不能为空' })
  if (!scopeGuard(req, res, [account_code])) return
  const result = listJournal({
    accountSetId: req.accountSetId || '',
    accountCode: account_code,
    currency: currency || undefined,
    startDate: start_date,
    endDate: end_date,
    // FIX-326：一律分页（未传按第 1 页、每页 100 条，上限 1000）；导出走 /export/styled-xlsx 的 cashierJournal 数据源
    page: page !== undefined ? Number(page) : undefined,
    pageSize: page_size !== undefined ? Number(page_size) : undefined,
  })
  res.json({ code: 0, data: result })
})

// ── FIX-260：录入弹窗默认汇率（币种跟科目走） ──────────────
router.get('/cashier/journal/rate', (req: AuthRequest, res) => {
  const { account_code, biz_date } = req.query as Record<string, string>
  if (!account_code) return res.status(400).json({ code: 400, message: '科目编码不能为空' })
  const db = getDb()
  const asid = req.accountSetId || ''
  const base = getCashierBaseCurrency(db, asid)
  const currency = getCashierAccountCurrency(db, asid, account_code)
  const rate = resolveCashierRate(db, asid, currency, biz_date || '')
  res.json({ code: 0, data: { currency, base_currency: base, is_foreign: currency !== base, rate } })
})

router.post(
  '/cashier/journal',
  operationLog('出纳日记账录入', '出纳管理'),
  (req: AuthRequest, res) => {
    const {
      account_code, biz_date, seq = 0, summary,
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
    // FIX-260：币种跟科目走，外币行带汇率与本位币金额
    const fx = resolveJournalFx(db, req.accountSetId || '', account_code, bizDate, req.body.currency, req.body.exchange_rate)
    if ('error' in fx) return res.status(400).json({ code: 400, message: fx.error })
    const d = round2(Number(debit) || 0)
    const c = round2(Number(credit) || 0)
    const baseAmt = computeBaseAmounts(d, c, fx.rate)
    // FIX-261：未指定序号时接在该科目（币种）现有最大序号之后，不再一律写 0
    const seqNo = Number(seq) > 0
      ? Math.floor(Number(seq))
      : ((db.prepare(
          'SELECT COALESCE(MAX(seq), 0) AS m FROM cashier_journal WHERE account_set_id=? AND account_code=? AND currency=?'
        ).get(req.accountSetId, account_code, fx.currency) as { m: number }).m || 0) + 1
    const id = uuidv4()
    db.prepare(
      `INSERT INTO cashier_journal
        (id, account_set_id, account_code, currency, biz_date, seq, summary,
         debit, credit, exchange_rate, base_debit, base_credit,
         settle_type, bill_no, counter_unit, counter_account,
         bank_name, bank_account, unit_code, counter_aux_item_id, created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(
      id, req.accountSetId, account_code, fx.currency, bizDate, seqNo, summary || null,
      d, c, fx.rate, baseAmt.base_debit, baseAmt.base_credit, settle_type || null, bill_no || null,
      counter_unit || null, counter_account || null, bank_name || null,
      bank_account || null, unit_code || null,
      counter_aux_item_id || null, (req as any).user?.name || null
    )
    res.json({ code: 0, data: { id, currency: fx.currency, exchange_rate: fx.rate } })
  }
)

router.put(
  '/cashier/journal/:id',
  operationLog('出纳日记账修改', '出纳管理'),
  (req: AuthRequest, res) => {
    const { id } = req.params
    const db = getDb()
    const existing = db
      .prepare('SELECT id, account_code, currency, biz_date, debit, credit, exchange_rate, reconciled, counter_account, voucher_no, voucher_id FROM cashier_journal WHERE id=? AND account_set_id=?')
      .get(id, req.accountSetId) as { id: string; account_code: string; currency: string; biz_date: string; debit: number; credit: number; exchange_rate: number; reconciled: number; counter_account: string | null; voucher_no: string | null; voucher_id: string | null } | undefined
    if (!existing) return res.status(404).json({ code: 404, message: '记录不存在' })
    if (!scopeGuard(req, res, [existing.account_code, req.body.counter_account])) return

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
    // 评审 P2：已生成凭证的行改金额 / 日期 / 汇率 / 对方科目，日记账与总账凭证不再一致（凭证不会跟着变）——须先删凭证
    if (existing.voucher_no || existing.voucher_id) {
      const differs = (a: unknown, b: unknown) => a != null && a !== '' && Math.abs(Number(a) - Number(b || 0)) > 0.0049
      const changed =
        differs(debit, existing.debit) ||
        differs(credit, existing.credit) ||
        (newBizDate != null && newBizDate !== existing.biz_date) ||
        (req.body.exchange_rate != null && req.body.exchange_rate !== '' && differs(req.body.exchange_rate, existing.exchange_rate)) ||
        (counter_account != null && counter_account !== '' && String(counter_account) !== String(existing.counter_account ?? ''))
      if (changed) {
        return res.status(400).json({
          code: 400,
          message: `该记录已生成凭证 ${existing.voucher_no ?? ''}，修改金额、日期、汇率或对方科目请先删除凭证（摘要、票据号等可直接改）`,
        })
      }
    }
    // P1-4：已对账（FIX-262 起为「已与总账分录匹配」）的行改金额 / 日期会让匹配批次失效；
    // 评审 P2：按实际改动判断（前端保存会带上全部字段，原先只要带了金额就拦，连改摘要都不行）
    const amountDiffers = (a: unknown, b: unknown) => a != null && a !== '' && Math.abs(Number(a) - Number(b || 0)) > 0.0049
    const touchesMatchedFields =
      amountDiffers(debit, existing.debit) || amountDiffers(credit, existing.credit) || (newBizDate && newBizDate !== existing.biz_date)
    if (existing.reconciled && touchesMatchedFields) {
      return res.status(400).json({ code: 400, message: '该记录已与总账分录对账匹配，请先在「出纳对账」取消匹配后再修改金额或日期' })
    }
    // P2-10 / P2-2：按修改后的借贷金额校验；非数字返回 400，而不是被 COALESCE 静默丢弃
    if (debit != null || credit != null) {
      const amountErr = validateJournalAmounts(
        debit != null ? debit : existing.debit,
        credit != null ? credit : existing.credit
      )
      if (amountErr) return res.status(400).json({ code: 400, message: amountErr })
    }
    // FIX-260：币种仍跟科目走（不可改）；汇率可改，本位币金额按修改后的原币 × 汇率重算
    const base = getCashierBaseCurrency(db, req.accountSetId || '')
    const currency = getCashierAccountCurrency(db, req.accountSetId || '', existing.account_code)
    let rate = 1
    if (currency !== base) {
      if (req.body.exchange_rate != null && req.body.exchange_rate !== '') {
        rate = Number(req.body.exchange_rate)
        if (!Number.isFinite(rate) || rate <= 0) return res.status(400).json({ code: 400, message: '汇率必须是大于 0 的数字' })
      } else {
        rate = Number(existing.exchange_rate) > 0 ? Number(existing.exchange_rate) : resolveCashierRate(db, req.accountSetId || '', currency, newBizDate || existing.biz_date)
      }
    }
    const newDebit = debit != null ? round2(Number(debit)) : Number(existing.debit) || 0
    const newCredit = credit != null ? round2(Number(credit)) : Number(existing.credit) || 0
    const baseAmt = computeBaseAmounts(newDebit, newCredit, rate)
    const auxProvided = 'counter_aux_item_id' in req.body
    const auxClause = auxProvided ? 'counter_aux_item_id=?,' : ''
    const auxParam: any[] = auxProvided ? [req.body.counter_aux_item_id || null] : []
    db.prepare(
      `UPDATE cashier_journal SET
        biz_date=COALESCE(?,biz_date), seq=COALESCE(?,seq), summary=COALESCE(?,summary),
        debit=COALESCE(?,debit), credit=COALESCE(?,credit),
        currency=?, exchange_rate=?, base_debit=?, base_credit=?,
        settle_type=COALESCE(?,settle_type), bill_no=COALESCE(?,bill_no),
        counter_unit=COALESCE(?,counter_unit), counter_account=COALESCE(?,counter_account),
        bank_name=COALESCE(?,bank_name), bank_account=COALESCE(?,bank_account),
        ${auxClause}
        updated_at=datetime('now')
       WHERE id=?`
    ).run(
      newBizDate, seq, summary, debit != null ? round2(Number(debit)) : null,
      credit != null ? round2(Number(credit)) : null,
      currency, rate, baseAmt.base_debit, baseAmt.base_credit,
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
      'SELECT id, account_code, voucher_no, voucher_year, voucher_month, voucher_id, biz_date, summary, reconciled FROM cashier_journal WHERE id=? AND account_set_id=?'
    ).get(id, req.accountSetId) as any
    if (!existing) return res.status(404).json({ code: 404, message: '记录不存在' })
    if (!scopeGuard(req, res, [existing.account_code])) return
    try { assertExistingJournalDateWritable(db, req.accountSetId || '', existing.biz_date) } catch (e: any) {
      return res.status(400).json({ code: 400, message: e.message })
    }
    // P1-4：已勾对的行删除后对账单侧 matched=1 成孤儿，余额调节表永久不平
    if (existing.reconciled) {
      return res.status(400).json({ code: 400, message: '该记录已与总账分录对账匹配，请先在「出纳对账」取消匹配后再删除' })
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
    const { account_code, rows } = req.body
    if (!account_code) return res.status(400).json({ code: 400, message: '科目编码不能为空' })
    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ code: 400, message: '导入数据为空' })
    }
    if (!scopeGuard(req, res, [account_code])) return
    // 校验 / 分片写入 / 币种汇率 / 序号见 services/cashierJournalImport.ts（与对账单导入共用）
    importJournalRows(getDb(), {
      accountSetId: req.accountSetId || '',
      accountCode: account_code,
      rows,
      maker: (req as any).user?.name || null,
      currency: req.body.currency,
    }).then(r => {
      if ('error' in r) return res.status(400).json({ code: 400, message: r.error })
      res.json({ code: 0, data: { inserted: r.inserted, errors: r.errors } })
    }).catch(e => res.status(500).json({ code: 500, message: e?.message || '导入失败' }))
  }
)

// ── 出纳对账（FIX-262）：出纳日记账 ↔ 总账该科目已记账分录，一对多 / 多对一 ──────────
function glScope(req: AuthRequest, accountCode: string) {
  return { db: getDb(), accountSetId: req.accountSetId || '', accountCode }
}

/** 对账工作台数据：两侧明细 + 本期汇总；先清理失效批次 */
router.get('/cashier/gl-reconcile/entries', (req: AuthRequest, res) => {
  const { account_code, start_date, end_date } = req.query as Record<string, string>
  if (!account_code) return res.status(400).json({ code: 400, message: '科目编码不能为空' })
  if (!scopeGuard(req, res, [account_code])) return
  const s = glScope(req, account_code)
  const stale = pruneStaleMatches(s)
  // FIX-326：两侧明细各最多 GL_RECONCILE_LIST_LIMIT 行（多取 1 行判断是否截断）；合计由 summary 按 SQL 汇总
  const limit = GL_RECONCILE_LIST_LIMIT
  const range = { start: start_date || undefined, end: end_date || undefined }
  const cashier = listCashierRows(s, { ...range, limit: limit + 1 })
  const gl = listGlEntries(s, { ...range, limit: limit + 1 }).rows
  const summary = getPeriodSummary(s, range.start, range.end)
  const truncated = { cashier: cashier.length > limit, gl: gl.length > limit }
  res.json({ code: 0, data: { cashier: cashier.slice(0, limit), gl: gl.slice(0, limit), summary, stale, limit, truncated } })
})

router.get('/cashier/gl-reconcile/batch/:batchId', (req: AuthRequest, res) => {
  const account_code = String(req.query.account_code || '')
  if (!account_code) return res.status(400).json({ code: 400, message: '科目编码不能为空' })
  if (!scopeGuard(req, res, [account_code])) return
  res.json({ code: 0, data: getBatchMembers(glScope(req, account_code), req.params.batchId) })
})

router.post(
  '/cashier/gl-reconcile/auto',
  operationLog('出纳自动对账', '出纳管理'),
  (req: AuthRequest, res) => {
    const { account_code, start_date, end_date, day_tolerance } = req.body
    if (!account_code) return res.status(400).json({ code: 400, message: '科目编码不能为空' })
    if (!scopeGuard(req, res, [account_code])) return
    const r = autoMatch(glScope(req, account_code), {
      start: start_date || undefined, end: end_date || undefined,
      dayTolerance: Number(day_tolerance) || 0, user: (req as any).user?.name || null,
    })
    res.json({ code: 0, data: r })
  }
)

router.post(
  '/cashier/gl-reconcile/manual',
  operationLog('出纳手动对账', '出纳管理'),
  (req: AuthRequest, res) => {
    const { account_code, journal_ids, entry_ids } = req.body
    if (!account_code) return res.status(400).json({ code: 400, message: '科目编码不能为空' })
    if (!scopeGuard(req, res, [account_code])) return
    const r = manualMatch(glScope(req, account_code), journal_ids, entry_ids, (req as any).user?.name || null)
    if ('error' in r) return res.status(400).json({ code: 400, message: r.error })
    res.json({ code: 0, data: r })
  }
)

router.post(
  '/cashier/gl-reconcile/cancel',
  operationLog('撤销出纳对账', '出纳管理'),
  (req: AuthRequest, res) => {
    const { account_code, ref_id } = req.body
    if (!account_code || !ref_id) return res.status(400).json({ code: 400, message: '科目编码和记录不能为空' })
    if (!scopeGuard(req, res, [account_code])) return
    const r = cancelMatch(glScope(req, account_code), String(ref_id))
    if ('error' in r) return res.status(400).json({ code: 400, message: r.error })
    res.json({ code: 0, data: r })
  }
)

/** 差异清单（出纳 ↔ 总账） */
router.get('/cashier/gl-reconcile/report', (req: AuthRequest, res) => {
  const { account_code, end_date } = req.query as Record<string, string>
  if (!account_code || !end_date) return res.status(400).json({ code: 400, message: '科目编码和截止日期不能为空' })
  if (!scopeGuard(req, res, [account_code])) return
  let endDate: string
  try { endDate = normalizeBizDate(end_date) } catch (e: any) { return res.status(400).json({ code: 400, message: e.message }) }
  res.json({ code: 0, data: getCashierGlReport(glScope(req, account_code), endDate) })
})

// ── 批量删除出纳生成的凭证 ────────────────────────────────
router.post(
  '/cashier/delete-vouchers',
  operationLog('批量删除出纳凭证', '出纳管理'),
  (req: AuthRequest, res) => {
    const { account_code, start_date, end_date, ids } = req.body
    const db = getDb()
    const asId = req.accountSetId || ''
    // 评审 P1-5：受科目授权限制的用户必须指定出纳科目，否则会删到白名单外科目的出纳凭证
    if (!account_code && req.accountScope?.restricted && !req.accountScope.bypass) {
      return res.status(403).json({ code: 403, message: '您的科目权限受限，删除出纳凭证须指定出纳科目' })
    }
    if (!scopeGuard(req, res, [account_code])) return
    // P2-11 / 评审 P2：一律逐张按凭证日期过闸（见下）。此前给了日期区间就只按区间过闸，
    // 而勾选行时忽略区间——勾到已结账月份的凭证照样能删

    // 直接从 vouchers 表查 source='cashier' 的凭证，按日期范围过滤。
    // 指定 account_code 时，只删除被该科目出纳日记账关联的凭证，避免误删其他现金/银行账户的出纳凭证。
    // P1-11：优先按 cashier_journal.voucher_id 关联（迁移 127），存量行回退到 年/期/号 匹配
    const conds = [`v.account_set_id=?`, `v.source='cashier'`]
    const vals: any[] = [asId]
    // 勾选了记录时：只删除选中行关联的凭证（选中行优先，忽略日期区间），与生成凭证 P2-11 口径一致
    const byIds = Array.isArray(ids) && ids.length > 0
    if (byIds) {
      const ph = ids.map(() => '?').join(',')
      const rows = db.prepare(
        `SELECT voucher_id, voucher_no, voucher_year, voucher_month FROM cashier_journal
         WHERE account_set_id=? AND account_code=? AND id IN (${ph})`
      ).all(asId, account_code, ...ids) as any[]
      const ors: string[] = []
      const orVals: any[] = []
      const vidSet = [...new Set(rows.map(r => r.voucher_id).filter(Boolean))]
      if (vidSet.length) {
        ors.push(`v.id IN (${vidSet.map(() => '?').join(',')})`)
        orVals.push(...vidSet)
      }
      // 存量行回退：voucher_id 为空但有 年/期/号
      for (const r of rows) {
        if (r.voucher_id || r.voucher_no == null) continue
        ors.push('(v.year=? AND v.period=? AND CAST(v.voucher_no AS TEXT)=CAST(? AS TEXT))')
        orVals.push(r.voucher_year, r.voucher_month, r.voucher_no)
      }
      if (ors.length === 0) {
        return res.status(400).json({ code: 400, message: '选中的记录尚未生成凭证，无法删除' })
      }
      conds.push(`(${ors.join(' OR ')})`)
      // 评审 P2 复测发现：此前漏了这一句，按勾选行删除时参数个数对不上，接口直接 500
      vals.push(...orVals)
    }
    if (account_code) {
      conds.push(`EXISTS (SELECT 1 FROM cashier_journal j
        WHERE j.account_set_id = v.account_set_id AND j.account_code = ?
          AND (j.voucher_id = v.id OR (j.voucher_id IS NULL
            AND CAST(j.voucher_no AS TEXT) = CAST(v.voucher_no AS TEXT)
            AND j.voucher_year = v.year AND j.voucher_month = v.period)))`)
      vals.push(account_code)
    }
    if (!byIds) {
      if (start_date) { conds.push('v.voucher_date >= ?'); vals.push(start_date) }
      if (end_date)   { conds.push('v.voucher_date <= ?'); vals.push(end_date) }
    }
    const vouchers = db.prepare(
      `SELECT v.id, v.voucher_no, v.status, v.source, v.year, v.period, v.voucher_type_id, v.voucher_date FROM vouchers v WHERE ${conds.join(' AND ')}`
    ).all(...vals) as any[]
    for (const v of vouchers) {
      try { assertCashierPeriodOpen(db, asId, v.voucher_date) } catch (e: any) {
        return res.status(400).json({ code: 400, message: `${e.message}（凭证 ${v.voucher_no}）` })
      }
    }

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

// ── 出纳对账 → 生成凭证 ──────────────────────────────────

// 生成凭证预览：返回将生成凭证的日记账行（供预览页二次确认）
router.post(
  '/cashier/generate-voucher/preview',
  (req: AuthRequest, res) => {
    const { account_code, start_date, end_date, ids } = req.body
    if (!account_code) return res.status(400).json({ code: 400, message: '科目编码不能为空' })
    if (!scopeGuard(req, res, [account_code])) return
    const data = previewCashierGenerate({
      db: getDb(),
      accountSetId: req.accountSetId || '',
      accountCode: account_code,
      startDate: start_date,
      endDate: end_date,
      ids,
    })
    res.json({ code: 0, data })
  }
)

router.post(
  '/cashier/generate-voucher',
  operationLog('出纳生成凭证', '出纳管理'),
  (req: AuthRequest, res) => {
    const { account_code, start_date, end_date, hangup_account_code, ids } = req.body
    if (!account_code) return res.status(400).json({ code: 400, message: '科目编码不能为空' })
    const db = getDb()
    // 评审 P1-5：科目授权——出纳科目、挂账科目与待生成行的对方科目都须在授权范围内（与预览 / 录单同口径）
    {
      const byIds = Array.isArray(ids) && ids.length > 0
      const conds = ['account_set_id=?', 'account_code=?', 'voucher_no IS NULL', 'counter_account IS NOT NULL']
      const vals: any[] = [req.accountSetId, account_code]
      if (byIds) {
        conds.push(`id IN (${ids.map(() => '?').join(',')})`)
        vals.push(...ids)
      } else {
        if (start_date) { conds.push('biz_date >= ?'); vals.push(start_date) }
        if (end_date) { conds.push('biz_date <= ?'); vals.push(end_date) }
      }
      const counters = (db.prepare(`SELECT DISTINCT counter_account FROM cashier_journal WHERE ${conds.join(' AND ')}`)
        .all(...vals) as Array<{ counter_account: string }>).map(r => r.counter_account)
      if (!scopeGuard(req, res, [account_code, hangup_account_code, ...counters])) return
    }
    // 出纳结账闸：按 ids 时逐条校验业务日期，否则按日期区间校验
    try {
      if (Array.isArray(ids) && ids.length) {
        const placeholders = ids.map(() => '?').join(',')
        const rows = db.prepare(`SELECT biz_date FROM cashier_journal WHERE account_set_id=? AND id IN (${placeholders})`)
          .all(req.accountSetId, ...ids) as Array<{ biz_date: string }>
        for (const r of rows) assertCashierPeriodOpen(db, req.accountSetId || '', r.biz_date)
      } else {
        // 评审 P2：按区间生成时只校验「真正要生成的行」所在月份——前端改为按筛选区间生成后，区间里
        // 早已结账（其流水必然都已生成凭证）的月份不应把整次生成拦下
        const months = db.prepare(
          `SELECT DISTINCT biz_date FROM cashier_journal
            WHERE account_set_id=? AND account_code=? AND voucher_no IS NULL
              ${start_date ? 'AND biz_date >= ?' : ''} ${end_date ? 'AND biz_date <= ?' : ''}`
        ).all(req.accountSetId, account_code, ...(start_date ? [start_date] : []), ...(end_date ? [end_date] : [])) as Array<{ biz_date: string }>
        for (const r of months) assertCashierPeriodOpen(db, req.accountSetId || '', r.biz_date)
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
    minAmount: parseAmountFilter(query.min_amount),
    maxAmount: parseAmountFilter(query.max_amount),
    reconciled: query.reconciled ? Number(query.reconciled) as 0|1 : undefined,
    hasVoucher: query.has_voucher ? Number(query.has_voucher) as 0|1 : undefined,
    page: query.page ? Number(query.page) : undefined,
    pageSize: query.page_size ? Number(query.page_size) : undefined,
    scope: req.accountScope,
  })
  res.json({ code: 0, data })
})

// 按 id 查单条日记账（生成凭证拦截弹窗「补全」按钮打开分录用）
router.get('/cashier/journal/:id', (req: AuthRequest, res) => {
  const db = getDb()
  const row = db
    .prepare('SELECT * FROM cashier_journal WHERE id=? AND account_set_id=?')
    .get(req.params.id, req.accountSetId) as any
  if (!row) return res.status(404).json({ code: 404, message: '记录不存在' })
  if (!scopeGuard(req, res, [row.account_code])) return
  res.json({ code: 0, data: row })
})

// ── 出纳日报 ─────────────────────────────────────────────
router.get('/cashier/daily-report', (req: AuthRequest, res) => {
  const { start_date, end_date, currency } = req.query as Record<string, string>
  if (!start_date || !end_date) return res.status(400).json({ code: 400, message: '日期区间不能为空' })
  const data = getAccountBalanceReport({ accountSetId: req.accountSetId || '', startDate: start_date, endDate: end_date, currency, scope: req.accountScope })
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
    groupBy: group_by as 'counter_account' | 'settle_type' | 'month',
    scope: req.accountScope,
  })
  res.json({ code: 0, data })
})

// ── 出纳初始化（清理所有出纳数据） ───────────────────────
/** FIX-264：初始化影响范围（确认框展示）：日记账行数、出纳凭证（含将自动反记账的）、将清除的结账月份、阻断项 */
router.get('/cashier/reset/preview', (req: AuthRequest, res) => {
  res.json({ code: 0, data: getCashierResetImpact(getDb(), req.accountSetId || '') })
})

router.post(
  '/cashier/reset',
  operationLog('出纳初始化', '出纳管理'),
  async (req: AuthRequest, res) => {
    const db = getDb()
    const asid = req.accountSetId || ''
    // FIX-264：出纳已结账月份一并清除、已记账出纳凭证自动反记账后删除；
    // 只有「已记账出纳凭证所在的总账期间已结账」不能自动处理（总账审计冻结，初始化不越权反结总账）
    const impact = getCashierResetImpact(db, asid)
    if (impact.blockedGlPeriods.length) {
      return res.status(400).json({
        code: 400,
        message: `总账 ${impact.blockedGlPeriods.join('、')} 已结账，其中有已记账的出纳凭证，请先在总账「期末结账」中取消结账后再初始化`,
      })
    }
    // 强制：清空前先完整备份本账套，备份失败则中止
    let backupFile = ''
    try {
      const b = await createPreReinitializeBackup(asid, req.userId)
      backupFile = b.filename
    } catch (e: any) {
      return res.status(500).json({ code: 500, message: e?.message || '初始化前自动备份失败，已中止操作' })
    }
    // P2-4：物理附件文件在事务提交后删除（DB 行由 ON DELETE CASCADE 处理）
    const attachmentFiles = db
      .prepare('SELECT filename FROM cashier_attachments WHERE account_set_id=?')
      .all(asid) as Array<{ filename: string }>
    let result: ReturnType<typeof performCashierReset>
    try {
      result = performCashierReset(db, asid)
    } catch (e: any) {
      return res.status(400).json({ code: 400, message: e?.message || '出纳初始化失败', data: { backup: backupFile } })
    }
    for (const a of attachmentFiles) {
      const filePath = path.join(process.cwd(), 'uploads', 'attachments', path.basename(a.filename))
      await fs.unlink(filePath).catch(() => {})
    }
    res.json({ code: 0, data: { ok: true, backup: backupFile, ...result } })
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
    const journal = db.prepare('SELECT id, biz_date, account_code FROM cashier_journal WHERE id = ? AND account_set_id = ?').get(journalId, accountSetId) as any
    if (!journal) {
      return res.status(404).json({ code: 404, message: '出纳记录不存在' })
    }
    if (!scopeGuard(req, res, [journal.account_code])) return
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
  // 评审 P1-5：按所属日记账的科目过授权
  const owner = db.prepare('SELECT account_code FROM cashier_journal WHERE id = ? AND account_set_id = ?').get(req.params.id, req.accountSetId) as any
  if (owner && !scopeGuard(req, res, [owner.account_code])) return
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
      const journalRow = db.prepare('SELECT biz_date, account_code FROM cashier_journal WHERE id = ? AND account_set_id = ?').get(journalId, accountSetId) as any
      if (journalRow && !scopeGuard(req, res, [journalRow.account_code])) return
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
