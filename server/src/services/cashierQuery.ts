/**
 * 出纳查询服务：现金/银行日记账列表（含逐行余额）、生成凭证、凭证同步（出纳对账见 cashierGlReconcile.ts）
 */
import { getDb } from '../db/index.js'
import { v4 as uuidv4 } from 'uuid'
import { buildVoucherNo } from './voucherEntry.js'
import { appendAccountScopeCondition, type AccountScopeContext } from './accountAuthorization.js'
import { assertGlPeriodOpen, getGlStartDateError } from './voucherMutationGuard.js'
import { assertCashierPeriodOpen, parseBizDate } from './cashierPeriodClosing.js'
import { deleteVoucherWithRefs } from './voucherDelete.js'
import { resolveExchangeRate } from './currencyService.js'
import { createAccountAuxRequirementLookup, type AccountAuxRequirementLookup, type AuxCategoryBrief } from './auxRequirement.js'
import { syncCashierAccountsFromGl, cashierGlCode, cashierCodeForGl, cashierLinkedGlCodes, ensureCashierAccountSchema } from './cashierAccount.js'
import { getPaymentVoucherMode, getScmSourcesOfJournals, paymentDocLabel, type ScmJournalSource } from './paymentVoucherMode.js'

export interface CashierAccount {
  code: string
  name: string
  is_cash: number
  is_bank: number
  /** FIX-260：外币科目标记与核算币种（出纳日记账币种跟科目走） */
  is_foreign: number
  currency_code: string | null
  /** 出纳独立账户：类型（cash / bank / other）与关联总账科目（可空） */
  kind?: string
  gl_account_code?: string | null
}

/**
 * 出纳账户的科目授权：关联了总账科目的按科目白名单过滤；未关联科目的独立账户不受科目授权限制
 * （出纳账户本身不是科目，只受出纳模块权限控制）。alias 为 v_cashier_account 的别名。
 */
export function appendCashierViewScope(ctx: AccountScopeContext | undefined, alias: string, conditions: string[], params: any[]): void {
  if (!ctx || ctx.bypass || !ctx.restricted) return
  const inner: string[] = []
  appendAccountScopeCondition(ctx, `${alias}.gl_account_id`, inner, params)
  if (inner.length) conditions.push(`(${alias}.gl_account_id IS NULL OR (${inner.join(' AND ')}))`)
}

/** 现金/银行类末级科目（出纳日记账左侧科目树）；传入科目授权上下文则按白名单过滤 */
export function listCashierAccounts(accountSetId: string, ctx?: AccountScopeContext): CashierAccount[] {
  const db = getDb()
  // 出纳独立账户：读「出纳账户」档案（总账新增的现金 / 银行末级科目会自动补成账户）
  syncCashierAccountsFromGl(db, accountSetId)
  const conditions: string[] = ['a.account_set_id = ?', 'a.is_enabled = 1']
  const params: any[] = [accountSetId]
  appendCashierViewScope(ctx, 'a', conditions, params)
  return db
    .prepare(
      `SELECT a.code, a.name, a.is_cash, a.is_bank, a.is_foreign, a.currency_code, a.kind, a.gl_account_code
       FROM v_cashier_account a
       WHERE ${conditions.join(' AND ')}
       ORDER BY a.code`
    )
    .all(...params) as CashierAccount[]
}

/**
 * 科目授权（P1-10）：出纳表用 account_code 关联科目，这里把科目 id 白名单换算成对 code 列的条件。
 * 无授权上下文或不受限时不追加条件。
 */
export function appendCashierCodeScopeCondition(
  ctx: AccountScopeContext | undefined,
  accountSetId: string,
  codeColumn: string,
  conditions: string[],
  params: any[]
): void {
  if (!ctx || ctx.bypass || !ctx.restricted) return
  ensureCashierAccountSchema(getDb())
  // 出纳账户按关联科目判断授权（未关联的独立账户不受科目授权限制）；
  // 尚未建出纳账户档案的历史编码回退按科目表判断（与改造前口径一致）
  const inner: string[] = ['sa.account_set_id = ?', `sa.code = ${codeColumn}`]
  const innerParams: any[] = [accountSetId]
  appendCashierViewScope(ctx, 'sa', inner, innerParams)
  const legacy: string[] = ['sb.account_set_id = ?', `sb.code = ${codeColumn}`]
  const legacyParams: any[] = [accountSetId]
  appendAccountScopeCondition(ctx, 'sb.id', legacy, legacyParams)
  conditions.push(`(EXISTS (SELECT 1 FROM v_cashier_account sa WHERE ${inner.join(' AND ')})
    OR (NOT EXISTS (SELECT 1 FROM v_cashier_account sx WHERE sx.account_set_id = ? AND sx.code = ${codeColumn})
        AND EXISTS (SELECT 1 FROM accounts sb WHERE ${legacy.join(' AND ')})))`)
  params.push(...innerParams, accountSetId, ...legacyParams)
}

export interface JournalRow {
  id: string
  account_code: string
  currency: string
  biz_date: string
  seq: number
  summary: string | null
  debit: number
  credit: number
  /** FIX-260：汇率（本位币恒 1）与本位币金额 */
  exchange_rate?: number
  base_debit?: number
  base_credit?: number
  settle_type: string | null
  bill_no: string | null
  counter_unit: string | null
  counter_account: string | null
  reconciled: number
  voucher_year: number | null
  voucher_month: number | null
  voucher_type: number | null
  voucher_no: number | null
  balance?: number
  base_balance?: number
  /** 来源收付款单（收付款单审核写入的流水） */
  scm_doc_type?: string | null
  scm_doc_no?: string | null
}

/**
 * 账套本位币（P1-2）：优先 `currencies.is_base`，其次 `system_params.base_currency`，缺省 RMB。
 * 出纳全链路此前硬编码 RMB，而供应链收付款单默认 CNY，同一本位币被拆成两个"币种"，
 * 收付款流水在出纳默认视图里消失。CNY 与 RMB 视为同一本位币（人民币的两种写法）。
 */
export function getCashierBaseCurrency(db: any, accountSetId: string): string {
  const hasTable = (t: string) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t)
  let code = ''
  if (hasTable('currencies')) {
    const row = db.prepare('SELECT code FROM currencies WHERE account_set_id=? AND is_base=1 LIMIT 1').get(accountSetId) as any
    code = String(row?.code || '')
  }
  if (!code && hasTable('system_params')) {
    const row = db
      .prepare("SELECT param_value FROM system_params WHERE account_set_id=? AND param_key='base_currency' LIMIT 1")
      .get(accountSetId) as any
    code = String(row?.param_value || '')
  }
  return normalizeCashierCurrency(code || 'RMB', 'RMB')
}

/** 币别归一：大小写、CNY→RMB（人民币两种写法视为同一本位币）；空值回退到本位币 */
export function normalizeCashierCurrency(raw: unknown, base: string): string {
  const code = String(raw ?? '').trim().toUpperCase()
  if (!code) return base
  if (code === 'CNY') return 'RMB'
  return code
}

/**
 * FIX-260：出纳科目的币种——跟科目走。科目 `is_foreign=1` 时取其 `currency_code`，否则为本位币。
 * 出纳全部接口的币种由此决定，不信任前端传入的 currency（仅作一致性校验）。
 */
export function getCashierAccountCurrency(db: any, accountSetId: string, accountCode: string): string {
  const base = getCashierBaseCurrency(db, accountSetId)
  return lookupCashierAccountCurrency(db, accountSetId, accountCode) ?? base
}

/**
 * 按科目查核算币种：外币科目返回其币种，本位币科目返回本位币；科目不存在（或库里还没有外币列）返回 null，
 * 由调用方决定回退口径（SCM 收付款单回退到单据币种）。
 */
export function lookupCashierAccountCurrency(db: any, accountSetId: string, accountCode: string): string | null {
  const base = getCashierBaseCurrency(db, accountSetId)
  let row: { is_foreign?: number; currency_code?: string | null } | undefined
  try {
    // 出纳账户档案的币别优先；老库无档案 / 非出纳编码（SCM 结算科目等）回退科目表
    try {
      row = db.prepare('SELECT is_foreign, currency_code FROM v_cashier_account WHERE account_set_id=? AND code=? LIMIT 1').get(accountSetId, accountCode)
    } catch { row = undefined }
    if (!row) {
      row = db
        .prepare('SELECT is_foreign, currency_code FROM accounts WHERE account_set_id=? AND code=? LIMIT 1')
        .get(accountSetId, accountCode)
    }
  } catch {
    return null
  }
  if (!row) return null
  if (Number(row.is_foreign || 0) !== 1 || !row.currency_code) return base
  return normalizeCashierCurrency(row.currency_code, base)
}

/** FIX-260：出纳流水默认汇率——本位币恒 1，外币按业务日期所在年/期走总账汇率链（exchange_rates → 期末汇率 → 最近一期 → 默认汇率） */
export function resolveCashierRate(db: any, accountSetId: string, currency: string, bizDate: string): number {
  const base = getCashierBaseCurrency(db, accountSetId)
  const cur = normalizeCashierCurrency(currency, base)
  if (cur === base) return 1
  const m = /^(\d{4})-(\d{1,2})/.exec(String(bizDate || ''))
  const now = new Date()
  const year = m ? Number(m[1]) : now.getFullYear()
  const period = m ? Number(m[2]) : now.getMonth() + 1
  const rate = resolveExchangeRate(accountSetId, cur, year, period)
  return rate > 0 ? rate : 1
}

/** FIX-260：本位币金额 = 原币 × 汇率，保留两位（与凭证 amount_cents 口径一致） */
export function computeBaseAmounts(debit: number, credit: number, rate: number): { base_debit: number; base_credit: number } {
  const r = rate > 0 ? rate : 1
  const round2 = (n: number) => Math.round(n * r * 100) / 100
  return { base_debit: round2(Number(debit) || 0), base_credit: round2(Number(credit) || 0) }
}

/** 出纳期初余额（无记录返回 0） */
export function getInitBalance(accountSetId: string, accountCode: string, currency?: string): number {
  const db = getDb()
  const cur = currency || getCashierBaseCurrency(db, accountSetId)
  const row = db
    .prepare(
      `SELECT balance FROM cashier_init_balance
       WHERE account_set_id = ? AND account_code = ? AND currency = ?`
    )
    .get(accountSetId, accountCode, cur) as { balance: number } | undefined
  return row?.balance ?? 0
}

/** 出纳科目涉及到的币别（本位币排第一），供前端币种切换；CNY 并入 RMB 不重复列出 */
export function listCashierCurrencies(accountSetId: string, scope?: AccountScopeContext): string[] {
  const db = getDb()
  const base = getCashierBaseCurrency(db, accountSetId)
  // 科目授权：受限用户只看到其授权科目涉及的币种（此前该接口不过滤，会泄露未授权科目的币种）
  const jc: string[] = ['account_set_id=?', "currency IS NOT NULL", "currency<>''"]
  const jp: any[] = [accountSetId]
  appendCashierCodeScopeCondition(scope, accountSetId, 'account_code', jc, jp)
  const rows = db.prepare(`
    SELECT DISTINCT currency FROM (
      SELECT currency FROM cashier_journal WHERE ${jc.join(' AND ')}
      UNION
      SELECT currency FROM cashier_init_balance WHERE ${jc.join(' AND ')}
    ) ORDER BY currency
  `).all(...jp, ...jp) as Array<{ currency: string }>
  // FIX-260：并入币种主数据（启用的外币），否则没有外币流水前下拉里永远选不到 USD；受限用户不并入主数据
  const restricted = !!scope && !scope.bypass && scope.restricted
  const hasCurrencies = !restricted && !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='currencies'").get()
  const master = hasCurrencies
    ? (db.prepare('SELECT code FROM currencies WHERE account_set_id=? AND is_enabled=1 ORDER BY sort_order, code').all(accountSetId) as Array<{ code: string }>)
    : []
  const codes = [...new Set([...rows.map(r => r.currency), ...master.map(r => r.code)].map(c => normalizeCashierCurrency(c, base)))]
    .filter(c => c !== base)
    .sort()
  return [base, ...codes]
}

/**
 * 日记账列表（按科目+币别+日期区间），返回逐行余额。
 * 现金/银行为借方科目：余额 = 期初 + 借 - 贷。
 */
export function searchJournals(params: {
  accountSetId: string
  accountCodes?: string[]
  currency?: string
  startDate?: string
  endDate?: string
  summary?: string
  settleTypes?: string[]
  billNo?: string
  counterUnit?: string
  counterAccount?: string
  amountDirection?: 'all' | 'income' | 'expense'
  minAmount?: number
  maxAmount?: number
  reconciled?: 0 | 1
  hasVoucher?: 0 | 1
  page?: number
  pageSize?: number
  /** 科目授权上下文（P1-10） */
  scope?: AccountScopeContext
}): { list: JournalRow[]; total: number } {
  const db = getDb()
  const conds = ['account_set_id = ?']
  const vals: any[] = [params.accountSetId]
  appendCashierCodeScopeCondition(params.scope, params.accountSetId, 'cashier_journal.account_code', conds, vals)

  if (params.accountCodes && params.accountCodes.length > 0) {
    conds.push(`account_code IN (${params.accountCodes.map(() => '?').join(',')})`)
    vals.push(...params.accountCodes)
  }
  if (params.currency) {
    conds.push('currency = ?')
    vals.push(normalizeCashierCurrency(params.currency, getCashierBaseCurrency(db, params.accountSetId)))
  }
  if (params.startDate) {
    conds.push('biz_date >= ?')
    vals.push(params.startDate)
  }
  if (params.endDate) {
    conds.push('biz_date <= ?')
    vals.push(params.endDate)
  }
  if (params.summary) {
    conds.push('summary LIKE ?')
    vals.push(`%${params.summary}%`)
  }
  if (params.settleTypes && params.settleTypes.length > 0) {
    conds.push(`settle_type IN (${params.settleTypes.map(() => '?').join(',')})`)
    vals.push(...params.settleTypes)
  }
  if (params.billNo) {
    conds.push('bill_no LIKE ?')
    vals.push(`%${params.billNo}%`)
  }
  if (params.counterUnit) {
    conds.push('counter_unit LIKE ?')
    vals.push(`%${params.counterUnit}%`)
  }
  if (params.counterAccount) {
    conds.push('counter_account = ?')
    vals.push(params.counterAccount)
  }
  
  // Amount Direction Filter
  const dir = params.amountDirection || 'all'
  let amountCol = '(debit + credit)'
  if (dir === 'income') {
    amountCol = 'debit'
    conds.push('debit > 0')
  } else if (dir === 'expense') {
    amountCol = 'credit'
    conds.push('credit > 0')
  }

  if (params.minAmount !== undefined) {
    conds.push(`${amountCol} >= ?`)
    vals.push(params.minAmount)
  }
  if (params.maxAmount !== undefined) {
    conds.push(`${amountCol} <= ?`)
    vals.push(params.maxAmount)
  }

  if (params.reconciled !== undefined) {
    conds.push('reconciled = ?')
    vals.push(params.reconciled)
  }
  if (params.hasVoucher !== undefined) {
    if (params.hasVoucher === 1) {
      conds.push('voucher_no IS NOT NULL')
    } else {
      conds.push('voucher_no IS NULL')
    }
  }

  const whereClause = conds.join(' AND ')

  // Count total
  const countRow = db.prepare(`SELECT COUNT(*) as total FROM cashier_journal WHERE ${whereClause}`).get(...vals) as { total: number }
  const total = countRow.total

  // Pagination（P2-3：钳制，page_size=-1 会返回全表、1e100 直接 500）
  const page = Math.max(1, Math.trunc(Number(params.page)) || 1)
  const pageSize = Math.min(2000, Math.max(1, Math.trunc(Number(params.pageSize)) || 100))
  const offset = (page - 1) * pageSize

  const sql = `
    SELECT * FROM cashier_journal
    WHERE ${whereClause}
    ORDER BY biz_date DESC, seq DESC, created_at DESC
    LIMIT ${pageSize} OFFSET ${offset}
  `
  const list = db.prepare(sql).all(...vals) as JournalRow[]

  return { list, total }
}

export interface AuxColumn { id: string; code: string; name: string }

/**
 * 给流水行挂上「按辅助类别拆开的值」：aux_values = { 类别id: 项目显示名 }，页面据此一个类别一列。
 * 项目显示名取项目名称，项目已被删除时回退为 id。只处理传入的行（当前页），按 id 分批取。
 */
export function attachAuxValues(db: any, rows: Array<{ id: string }>): void {
  if (!rows.length) return
  const hasAux = !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='cashier_journal_aux'").get()
  const values = new Map<string, Record<string, string>>()
  if (hasAux) {
    const ids = rows.map(r => r.id)
    const CHUNK = 500
    for (let i = 0; i < ids.length; i += CHUNK) {
      const part = ids.slice(i, i + CHUNK)
      const list = db.prepare(`
        SELECT ax.journal_id AS jid, ax.category_id AS cid, COALESCE(ai.name, ax.item_id) AS item
        FROM cashier_journal_aux ax
        LEFT JOIN aux_items ai ON ai.id = ax.item_id
        WHERE ax.journal_id IN (${part.map(() => '?').join(',')})
      `).all(...part) as Array<{ jid: string; cid: string; item: string }>
      for (const x of list) {
        const m = values.get(x.jid) || {}
        m[x.cid] = x.item
        values.set(x.jid, m)
      }
    }
  }
  for (const r of rows as any[]) r.aux_values = values.get(r.id) || {}
}

/**
 * 当前筛选结果「全集」里出现过的辅助类别（不是仅当前页），页面据此动态生成列，翻页时列不跳变。
 * @param existsSql 形如 `SELECT 1 FROM cashier_journal j WHERE j.id = ax.journal_id AND <筛选条件>`，
 *                  由调用方按自己的过滤口径拼好（必须用 ax.journal_id 关联）
 * 按类别逐个 EXISTS，命中即停，类别少时开销很小。
 */
export function listAuxColumns(db: any, accountSetId: string, existsSql: string, params: any[]): AuxColumn[] {
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='cashier_journal_aux'").get()) return []
  return db.prepare(`
    SELECT c.id, c.code, c.name
    FROM aux_categories c
    WHERE c.account_set_id = ?
      AND EXISTS (SELECT 1 FROM cashier_journal_aux ax WHERE ax.category_id = c.id AND ax.account_set_id = ? AND EXISTS (${existsSql}))
    ORDER BY c.sort_order, c.code
  `).all(accountSetId, accountSetId, ...params) as AuxColumn[]
}

/**
 * 给流水行补展示字段：对方科目名称、辅助项目（按类别 aux_values + 兼容的合并文本 aux_text）。
 * 只处理当前页行（≤1000），按 id 批量取，不逐行查询。
 */
export function enrichJournalRows(db: any, accountSetId: string, rows: JournalRow[]): void {
  if (!rows.length) return
  const codes = [...new Set(rows.map(r => r.counter_account).filter(Boolean))] as string[]
  const nameOf = new Map<string, string>()
  if (codes.length) {
    const found = db.prepare(`SELECT code, name FROM accounts WHERE account_set_id=? AND code IN (${codes.map(() => '?').join(',')})`)
      .all(accountSetId, ...codes) as Array<{ code: string; name: string }>
    for (const a of found) nameOf.set(a.code, a.name)
  }
  attachAuxValues(db, rows)
  const catName = new Map<string, string>()
  // 只在确实有辅助数据时才读类别名（老库 / 精简库可能没有辅助类别表）
  if ((rows as any[]).some(r => r.aux_values && Object.keys(r.aux_values).length)) {
    const cats = db.prepare('SELECT id, name FROM aux_categories WHERE account_set_id=?').all(accountSetId) as Array<{ id: string; name: string }>
    for (const c of cats) catName.set(c.id, c.name)
  }
  // 来源收付款单：前端据此显示「收款单 RCV-xxx」并按收付款制证方式限制勾选 / 编辑 / 删除
  const sources = getScmSourcesOfJournals(db, accountSetId, rows.map(r => r.id))
  for (const r of rows as any[]) {
    r.counter_account_name = r.counter_account ? nameOf.get(r.counter_account) || null : null
    const parts = Object.entries(r.aux_values as Record<string, string>).map(([cid, item]) => `${catName.get(cid) || cid}:${item}`)
    r.aux_text = parts.length ? parts.join('；') : null
    const src = sources.get(r.id)
    r.scm_doc_type = src?.doc_type || null
    r.scm_doc_no = src?.doc_no || null
  }
}

export function listJournal(params: {
  accountSetId: string
  accountCode: string
  currency?: string
  startDate?: string
  endDate?: string
  /** FIX-253：分页（1 起）；FIX-326 起强制分页，不传按第 1 页、每页 100 条，上限 1000 */
  page?: number
  pageSize?: number
  /** 日期排序方向，默认升序；降序时余额仍是按时间累计的真实余额 */
  sortOrder?: 'asc' | 'desc'
}): {
  opening: number
  rows: JournalRow[]
  closing: number
  totalDebit: number
  totalCredit: number
  /** FIX-260：本位币合计（本位币科目与原币一致） */
  totalBaseDebit: number
  totalBaseCredit: number
  currency: string
  /** 区间内行数（与分页无关） */
  total: number
  page: number
  pageSize: number
  /** 评审 P2：同科目、同区间但币种与科目核算币种不一致的存量行数（这些行不在本视图内，前端据此提示） */
  otherCurrencyCount: number
  /** 当前筛选结果里出现过的辅助类别（页面按类别动态拆列） */
  aux_columns: AuxColumn[]
} {
  const db = getDb()
  const { accountSetId, accountCode } = params
  // FIX-260：币种跟科目走；未传 currency 时按科目解析，不再默认本位币
  const currency = params.currency
    ? normalizeCashierCurrency(params.currency, getCashierBaseCurrency(db, accountSetId))
    : getCashierAccountCurrency(db, accountSetId, accountCode)

  const opening = getInitBalance(accountSetId, accountCode, currency)

  // 区间前的累计净额，用于得到区间期初。
  // 评审 P1-1：未传开始日期 = 从头查，区间前没有流水；此前退化成「全部行净额」当区间前净额，
  // 随后逐行 / 合计又累加一次，期初、逐行余额、期末都被重复计入。
  const beforeNet = params.startDate
    ? (db
        .prepare(
          `SELECT COALESCE(SUM(debit),0) d, COALESCE(SUM(credit),0) c
           FROM cashier_journal WHERE account_set_id = ? AND account_code = ? AND currency = ? AND biz_date < ?`
        )
        .get(accountSetId, accountCode, currency, params.startDate) as { d: number; c: number })
    : { d: 0, c: 0 }
  let running = opening + beforeNet.d - beforeNet.c
  const periodOpening = running

  const rowConds = ['account_set_id = ?', 'account_code = ?', 'currency = ?']
  const rowParams: any[] = [accountSetId, accountCode, currency]
  if (params.startDate) {
    rowConds.push('biz_date >= ?')
    rowParams.push(params.startDate)
  }
  if (params.endDate) {
    rowConds.push('biz_date <= ?')
    rowParams.push(params.endDate)
  }
  // 评审 P2 收尾：去掉 reconciled 筛选——筛掉部分行后逐行余额 / 期末只累加剩余行，数字失真；前端从未使用
  const whereSql = rowConds.join(' AND ')
  const desc = params.sortOrder === 'desc'
  const orderSql = desc ? 'ORDER BY biz_date DESC, seq DESC, created_at DESC' : 'ORDER BY biz_date, seq, created_at'

  // FIX-253（十万级压测 P1-1）：合计与期末改由一条聚合 SQL 得出，不再依赖把全部行读进内存逐行累加——
  // 十万行时单次请求 30MB JSON、RSS +100MB。分页时本页首行之前的净额用同一排序的 LIMIT 子查询算出。
  const totals = db
    .prepare(
      `SELECT COUNT(*) n, COALESCE(SUM(debit),0) d, COALESCE(SUM(credit),0) c,
              COALESCE(SUM(base_debit),0) bd, COALESCE(SUM(base_credit),0) bc
       FROM cashier_journal WHERE ${whereSql}`
    )
    .get(...rowParams) as { n: number; d: number; c: number; bd: number; bc: number }
  const totalDebit = totals.d
  const totalCredit = totals.c
  const closing = periodOpening + totalDebit - totalCredit

  // FIX-326：强制分页。此前不传 page / page_size 时返回区间全部行（FIX-253 为兼容老调用方保留），25 万行时单次响应
  // 170MB / 10s / 服务内存 ~1GB，并发时撑爆进程。未传按第 1 页、每页 100 条；上限 1000；导出走服务端数据源 cashierJournal。
  const pageSize = Math.min(1000, Math.max(1, Math.trunc(Number(params.pageSize) || 100)))
  const page = Math.max(1, Math.trunc(Number(params.page) || 1))
  const offset = (page - 1) * pageSize

  // 本页首行之前的净额（同一排序的 LIMIT 子查询），本页余额从「区间期初 + 前页净额」续算
  const beforePage = db
    .prepare(
      `SELECT COALESCE(SUM(debit - credit),0) net FROM (
         SELECT debit, credit FROM cashier_journal WHERE ${whereSql} ${orderSql} LIMIT ?
       )`
    )
    .get(...rowParams, offset) as { net: number }
  const rows = db
    .prepare(`SELECT * FROM cashier_journal WHERE ${whereSql} ${orderSql} LIMIT ? OFFSET ?`)
    .all(...rowParams, pageSize, offset) as JournalRow[]

  if (desc) {
    // 降序：本页首行是时间上最靠后的，余额 = 期末 − 它之前（降序序）各页的净额，再逐行倒推
    running = closing - beforePage.net
    for (const r of rows) {
      r.balance = running
      running -= r.debit - r.credit
    }
  } else {
    running += beforePage.net
    for (const r of rows) {
      running += r.debit - r.credit
      r.balance = running
    }
  }
  enrichJournalRows(db, accountSetId, rows)

  // 评审 P2：币种跟科目走后，科目改过币种 / 迁移前录入的行按币种过滤不再显示，此前完全无提示
  // FIX-325：<> 用不上索引，改写为两段范围，走 (账套, 科目, 币种) 索引
  const otherConds = ['account_set_id = ?', 'account_code = ?', '(currency < ? OR currency > ?)']
  const otherParams: any[] = [accountSetId, accountCode, currency, currency]
  if (params.startDate) { otherConds.push('biz_date >= ?'); otherParams.push(params.startDate) }
  if (params.endDate) { otherConds.push('biz_date <= ?'); otherParams.push(params.endDate) }
  const otherCurrencyCount = (db
    .prepare(`SELECT COUNT(*) n FROM cashier_journal WHERE ${otherConds.join(' AND ')}`)
    .get(...otherParams) as { n: number }).n

  const auxColumns = listAuxColumns(
    db, accountSetId,
    `SELECT 1 FROM cashier_journal j WHERE j.id = ax.journal_id AND ${rowConds.map(c => `j.${c}`).join(' AND ')}`,
    rowParams
  )

  return {
    otherCurrencyCount,
    aux_columns: auxColumns,
    opening: periodOpening,
    rows,
    closing,
    totalDebit,
    totalCredit,
    totalBaseDebit: totals.bd,
    totalBaseCredit: totals.bc,
    currency,
    total: totals.n,
    page,
    pageSize,
  }
}

// ── 出纳对账 → 生成凭证 ─────────────────────────────────

export interface CashierMissingCounterRow {
  id: string
  biz_date: string
  seq: number | null
  summary: string | null
  debit: number
  credit: number
}

/** 对方科目要求辅助核算但流水未填的记录 */
export interface CashierMissingAuxRow extends CashierMissingCounterRow {
  counter_account: string
  /** 缺少的辅助类别名 */
  missing_aux: string[]
}

/**
 * 解析流水的 counter_aux_item_id（{ 类别id 或 类别code: 项目id }）为 类别 → 项目。
 * 原实现只认类别 id，键为 code 时被静默丢弃。
 */
export function parseCounterAuxSelections(
  raw: unknown,
  lookup: AccountAuxRequirementLookup,
): Map<string, { cat: AuxCategoryBrief; itemId: string }> {
  const out = new Map<string, { cat: AuxCategoryBrief; itemId: string }>()
  if (!raw) return out
  let obj: Record<string, unknown> | null = null
  try { obj = typeof raw === 'string' ? JSON.parse(raw) : (raw as Record<string, unknown>) } catch { obj = null }
  if (!obj || typeof obj !== 'object') return out
  for (const [key, value] of Object.entries(obj)) {
    const itemId = typeof value === 'string' ? value : (value as any)?.id
    if (!itemId) continue
    const cat = lookup.categoryByKey(key)
    if (cat && !out.has(cat.id)) out.set(cat.id, { cat, itemId: String(itemId) })
  }
  return out
}

/** 对方科目要求、但流水未填的辅助类别名 */
export function cashierRowMissingAux(
  lookup: AccountAuxRequirementLookup,
  counterCode: string | null | undefined,
  counterAux: unknown,
): string[] {
  const req = counterCode ? lookup(counterCode) : null
  if (!req) return []
  const sel = parseCounterAuxSelections(counterAux, lookup)
  return req.categories.filter(c => !sel.has(c.id)).map(c => c.name)
}

/** 生成凭证预览行：与 missingRows / 明细同口径的日记账字段 */
export interface CashierGeneratePreviewRow {
  id: string
  biz_date: string
  seq: number | null
  summary: string | null
  debit: number
  credit: number
  counter_account: string | null
  /** 对方科目要求辅助核算但未填的类别名（生成凭证时会被拦截） */
  missing_aux?: string[]
  /** 来源收付款单（通过出纳制证模式下同单流水合并成一张凭证） */
  scm_doc_type?: string
  scm_doc_no?: string
  /** 未勾选、因同单合并制证被自动带入的行 */
  auto_included?: boolean
  /** FIX-260 */
  currency?: string
  exchange_rate?: number
  base_debit?: number
  base_credit?: number
}

/**
 * 收付款制证方式（payment_voucher_mode）对出纳选行的约束：
 *  - scm 模式：收付款单来源的流水由单据制证。勾选了来源行 → 报错；按日期区间批量 → 自动排除。
 *  - cashier 模式：来源行按收付款单合并制证。单据已由供应链制证 → 报错；同单未勾选的行自动带入。
 * 返回过滤 / 补齐后的行（j.* 全字段）及来源映射。
 */
function applyPaymentVoucherMode(
  db: any, accountSetId: string, accountCode: string, rows: any[], byIds: boolean,
): { rows: any[]; sources: Map<string, ScmJournalSource>; autoIds: Set<string>; error?: string } {
  const autoIds = new Set<string>()
  const sources = getScmSourcesOfJournals(db, accountSetId, rows.map(r => r.id))
  if (!sources.size) return { rows, sources, autoIds }
  const docLabel = (src: ScmJournalSource) => `${paymentDocLabel(src.doc_type)} ${src.doc_no}`
  if (getPaymentVoucherMode(db, accountSetId) === 'scm') {
    if (byIds) {
      const docs = [...new Set(rows.filter(r => sources.has(r.id)).map(r => docLabel(sources.get(r.id)!)))]
      return {
        rows: [], sources, autoIds,
        error: `有 ${rows.filter(r => sources.has(r.id)).length} 条流水来源于收付款单（${docs.slice(0, 5).join('、')}${docs.length > 5 ? ' 等' : ''}），系统参数「收付款制证方式」为收付款单直接生成凭证，请到收付款单生成凭证`,
      }
    }
    return { rows: rows.filter(r => !sources.has(r.id)), sources, autoIds }
  }
  // cashier 模式：补齐同单其它流水，并校验单据未由供应链制证
  const have = new Set(rows.map(r => r.id))
  const docs = new Map<string, ScmJournalSource>()
  for (const src of sources.values()) docs.set(`${src.doc_type}|${src.doc_no}`, src)
  const out = [...rows]
  for (const src of docs.values()) {
    if (src.doc_voucher_id) {
      const v = db.prepare('SELECT voucher_no FROM vouchers WHERE id=?').get(src.doc_voucher_id) as any
      return { rows: [], sources, autoIds, error: `${docLabel(src)} 已由供应链生成凭证 ${v?.voucher_no || ''}，不能在出纳重复制证` }
    }
    const siblings = db.prepare(`
      SELECT j.* FROM scm_ar_ap_log l JOIN cashier_journal j ON j.id=l.cashier_journal_id AND j.account_set_id=l.account_set_id
      WHERE l.account_set_id=? AND l.doc_type=? AND l.doc_no=?
    `).all(accountSetId, src.doc_type, src.doc_no) as any[]
    for (const sib of siblings) {
      if (have.has(sib.id)) continue
      if (sib.voucher_no || sib.voucher_id) {
        return { rows: [], sources, autoIds, error: `${docLabel(src)} 的部分流水已生成凭证 ${sib.voucher_no || ''}，请先删除该凭证后整单重新生成` }
      }
      if (sib.account_code !== accountCode) {
        return { rows: [], sources, autoIds, error: `${docLabel(src)} 的流水分属不同出纳账户，无法合并制证` }
      }
      out.push(sib)
      have.add(sib.id)
      autoIds.add(sib.id)
      sources.set(sib.id, src)
    }
  }
  out.sort((a, b) => String(a.biz_date).localeCompare(String(b.biz_date)) || (Number(a.seq) || 0) - (Number(b.seq) || 0))
  return { rows: out, sources, autoIds }
}

/**
 * 生成凭证预览：查询将要生成凭证的日记账（未生成 + 选中行或期间范围）。
 * 与 generateCashierVoucher 的选行口径一致（P2-11：选中行优先，忽略日期区间）。
 */
export function previewCashierGenerate(params: {
  db: any
  accountSetId: string
  accountCode: string
  startDate?: string
  endDate?: string
  ids?: string[]
}): { rows: CashierGeneratePreviewRow[]; error?: string } {
  const { db, accountSetId, accountCode, startDate, endDate, ids } = params

  const conds = ['j.account_set_id=?', 'j.account_code=?', 'j.voucher_no IS NULL']
  const vals: any[] = [accountSetId, accountCode]
  const byIds = !!(ids && ids.length > 0)
  if (!byIds && startDate) { conds.push('j.biz_date >= ?'); vals.push(startDate) }
  if (!byIds && endDate)   { conds.push('j.biz_date <= ?'); vals.push(endDate) }
  if (byIds) {
    conds.push(`j.id IN (${ids!.map(() => '?').join(',')})`)
    vals.push(...ids!)
  }
  const selected = db.prepare(`
    SELECT j.* FROM cashier_journal j
    WHERE ${conds.join(' AND ')}
    ORDER BY j.biz_date, j.seq
  `).all(...vals) as any[]
  const moded = applyPaymentVoucherMode(db, accountSetId, accountCode, selected, byIds)
  if (moded.error) return { rows: [], error: moded.error }
  const auxLookup = createAccountAuxRequirementLookup(db, accountSetId)
  return {
    rows: moded.rows.map((j: any) => {
      const r: CashierGeneratePreviewRow = {
        id: j.id, biz_date: j.biz_date, seq: j.seq, summary: j.summary, debit: j.debit, credit: j.credit,
        counter_account: j.counter_account, currency: j.currency, exchange_rate: j.exchange_rate,
        base_debit: j.base_debit, base_credit: j.base_credit,
      }
      const src = moded.sources.get(j.id)
      if (src) { r.scm_doc_type = src.doc_type; r.scm_doc_no = src.doc_no }
      if (moded.autoIds.has(j.id)) r.auto_included = true
      const missing = cashierRowMissingAux(auxLookup, r.counter_account, j.counter_aux_item_id)
      if (missing.length) r.missing_aux = missing
      return r
    }),
  }
}

/**
 * 每条出纳日记账独立生成一张会计凭证（一对一）。
 * 返回生成的凭证数量；遇到未填对方科目且无挂账科目时拦截。
 */
/** 每张生成凭证的明细（成功提示逐行列出） */
export interface CashierVoucherDetail {
  voucherNo: string
  bizDate: string
  summary: string | null
  /** 本位币金额（FIX-260：外币行为 原币 × 汇率） */
  amount: number
  direction: '收入' | '支出'
  counterCode: string
  counterName: string
  hungup: boolean
  currency?: string
  exchangeRate?: number
  foreignAmount?: number
}

export function generateCashierVoucher(params: {
  db: any
  accountSetId: string
  accountCode: string
  startDate?: string
  endDate?: string
  makerName: string
  hangupAccountCode?: string
  /** 本次指定的凭证类型（已校验）；优先于 cashier:default_voucher_type_id */
  voucherTypeId?: string | null
  ids?: string[]
}):
  | {
      syncedCount: number
      voucherNos: string[]
      voucherIds: string[]
      totalDebit: number
      totalCredit: number
      hangupCount: number
      hangupCode: string | null
      hangupName: string | null
      details: CashierVoucherDetail[]
    }
  | { error: string; missingRows?: CashierMissingCounterRow[]; missingAuxRows?: CashierMissingAuxRow[] } {
  const { db, accountSetId, accountCode, startDate, endDate, makerName, hangupAccountCode, ids } = params

  // 1. 查询未生成凭证的出纳日记账
  const conds = ['j.account_set_id=?', 'j.account_code=?', 'j.voucher_no IS NULL']
  const vals: any[] = [accountSetId, accountCode]
  const byIds = !!(ids && ids.length > 0)
  // P2-11：指定了选中行时以选中行为准，不再与日期区间取交集（此前查 8 月勾 3 行、页面默认带 9 月区间 → 0 行命中）
  if (!byIds && startDate) { conds.push('j.biz_date >= ?'); vals.push(startDate) }
  if (!byIds && endDate)   { conds.push('j.biz_date <= ?'); vals.push(endDate) }
  if (byIds) {
    conds.push(`j.id IN (${ids!.map(() => '?').join(',')})`)
    vals.push(...ids!)
  }
  const selected = db.prepare(`
    SELECT j.* FROM cashier_journal j
    WHERE ${conds.join(' AND ')}
    ORDER BY j.biz_date, j.seq
  `).all(...vals) as any[]
  if (selected.length === 0) return { error: '所选范围内没有未生成凭证的记录' }
  // 收付款制证方式：严格单侧制证（见 paymentVoucherMode.ts）
  const moded = applyPaymentVoucherMode(db, accountSetId, accountCode, selected, byIds)
  if (moded.error) return { error: moded.error }
  const rows = moded.rows
  if (rows.length === 0) return { error: '所选范围内没有未生成凭证的记录（收付款单来源的流水请到收付款单生成凭证）' }

  // P0-2：总账已结账（含已年结）期间不得再生成凭证，否则凭证永远无法记账、跨年期初也已固化
  const closedMonths = new Set<string>()
  for (const r of rows) {
    const ym = parseBizDate(r.biz_date)
    if (!ym) return { error: `日记账 ${r.biz_date} 日期格式不合法（${r.summary || r.id}）` }
    const startDateError = getGlStartDateError(db, accountSetId, r.biz_date, '日记账日期')
    if (startDateError) return { error: `${startDateError}（${r.summary || r.id}）` }
    const key = `${ym.year}-${ym.month}`
    if (closedMonths.has(key)) continue
    try {
      assertGlPeriodOpen(db, accountSetId, ym.year, ym.month)
    } catch (e: any) {
      return { error: e?.message || '所属期间已结账' }
    }
    closedMonths.add(key)
  }

  // 2. 校验对方科目（缺失时拦截或挂账）
  const lookup = db.prepare('SELECT id, name, is_foreign, currency_code FROM accounts WHERE account_set_id=? AND code=? LIMIT 1')
  // 出纳独立账户：凭证上的现金 / 银行分录记到该账户关联的总账科目；未关联不能生成凭证
  const cashGlCode = cashierGlCode(db, accountSetId, accountCode)
  if (!cashGlCode) return { error: `出纳账户 ${accountCode} 未关联总账科目，请先在「出纳账户」中关联科目后再生成凭证` }
  const cashAcc = lookup.get(accountSetId, cashGlCode) as any
  if (!cashAcc) return { error: `出纳账户 ${accountCode} 关联的科目 ${cashGlCode} 在账套中不存在` }
  // FIX-260：币种跟科目走。外币现金/银行科目的分录写原币三字段；对方科目为外币时币种必须一致，
  // 非外币对方科目只记本位币（与总账 validateVoucherEntriesForeignCurrency 规则一致）。
  const baseCurrency = getCashierBaseCurrency(db, accountSetId)
  const cashCurrency = getCashierAccountCurrency(db, accountSetId, accountCode)
  const cashIsForeign = cashCurrency !== baseCurrency
  const accountCurrency = (acc: any): string | null =>
    acc && Number(acc.is_foreign || 0) === 1 && acc.currency_code ? normalizeCashierCurrency(acc.currency_code, baseCurrency) : null

  const missingRows: CashierMissingCounterRow[] = rows
    .filter((r: any) => !r.counter_account)
    .map((r: any) => ({ id: r.id, biz_date: r.biz_date, seq: r.seq, summary: r.summary, debit: r.debit, credit: r.credit }))

  let hangupCode: string | undefined
  let ha: any
  if (missingRows.length > 0) {
    if (!hangupAccountCode) {
      return { error: `有 ${missingRows.length} 条记录未填对方科目，请补全或指定挂账科目`, missingRows }
    }
    ha = lookup.get(accountSetId, hangupAccountCode) as any
    if (!ha) return { error: `挂账科目 ${hangupAccountCode} 在账套中不存在` }
    const childCount = (db.prepare('SELECT COUNT(*) c FROM accounts WHERE parent_id=?').get(ha.id) as any)?.c ?? 0
    if (childCount > 0) return { error: `挂账科目 ${hangupAccountCode} 不是末级科目，请选择末级科目挂账` }
    hangupCode = hangupAccountCode
  }

  // 校验所有对方科目存在
  const allCounterCodes = [...new Set(rows.map((r: any) => r.counter_account || hangupCode!))]
  const missingCodes = allCounterCodes.filter(code => !lookup.get(accountSetId, code))
  if (missingCodes.length > 0) return { error: `对方科目不存在：${missingCodes.join('、')}` }
  // FIX-260：对方科目若为外币科目，币种必须与出纳科目一致（否则总账无法记账）
  for (const code of allCounterCodes) {
    const cur = accountCurrency(lookup.get(accountSetId, code))
    if (cur && cur !== cashCurrency) {
      return { error: `对方科目 ${code} 的核算币种为 ${cur}，与出纳科目 ${accountCode}（${cashCurrency}）不一致，无法生成凭证` }
    }
  }
  // 对方科目（含挂账科目）挂了辅助核算而流水未填：拦截，不再生成辅助项为空、过不了账的凭证
  const auxLookup = createAccountAuxRequirementLookup(db, accountSetId)
  const missingAuxRows: CashierMissingAuxRow[] = []
  for (const r of rows) {
    const counterCode = r.counter_account || hangupCode!
    const missing = cashierRowMissingAux(auxLookup, counterCode, r.counter_aux_item_id)
    if (missing.length) {
      missingAuxRows.push({ id: r.id, biz_date: r.biz_date, seq: r.seq, summary: r.summary, debit: r.debit, credit: r.credit,
        counter_account: counterCode, missing_aux: missing })
    }
  }
  if (missingAuxRows.length > 0) {
    const first = missingAuxRows[0]
    return {
      error: `有 ${missingAuxRows.length} 条记录的对方科目要求辅助核算但未填写（如 ${first.biz_date} ${first.summary || ''} 缺「${first.missing_aux.join('、')}」），请在日记账补填后再生成`,
      missingAuxRows,
    }
  }

  // 3. 取凭证类型：本次指定 > 系统参数 cashier:default_voucher_type_id > code 最小的
  const requestedVt = params.voucherTypeId
    ? db.prepare(`SELECT id, name FROM voucher_types WHERE (account_set_id=? OR account_set_id IS NULL) AND id=? LIMIT 1`).get(accountSetId, params.voucherTypeId) as any
    : null
  const defaultVtParam = db.prepare(
    `SELECT param_value FROM system_params WHERE account_set_id=? AND param_key='cashier:default_voucher_type_id' LIMIT 1`
  ).get(accountSetId) as any
  const vt = requestedVt || (defaultVtParam?.param_value
    ? (db.prepare(`SELECT id, name FROM voucher_types WHERE account_set_id=? AND id=? LIMIT 1`).get(accountSetId, defaultVtParam.param_value) as any
      || db.prepare(`SELECT id, name FROM voucher_types WHERE (account_set_id=? OR account_set_id IS NULL) ORDER BY sort_order, code LIMIT 1`).get(accountSetId) as any)
    : db.prepare(`SELECT id, name FROM voucher_types WHERE (account_set_id=? OR account_set_id IS NULL) ORDER BY sort_order, code LIMIT 1`).get(accountSetId) as any)
  const voucherTypeId = vt?.id || null
  const voucherTypeName: string = vt?.name || ''

  const insVoucher = db.prepare(`
    INSERT INTO vouchers (id, account_set_id, voucher_no, voucher_type_id, voucher_date, year, period, total_amount, maker_name, remark, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'cashier')
  `)
  const insEntry = db.prepare(`
    INSERT INTO voucher_entries (
      id, account_set_id, voucher_id, seq, account_id, account_code, account_name,
      direction, amount, amount_cents, summary,
      dept_id, dept_name, project_id, project_name,
      supplier_id, supplier_name, person_id, person_name,
      func_class_id, func_class_name, aux_data,
      currency_code, exchange_rate, foreign_amount
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const updJournal = db.prepare(`
    UPDATE cashier_journal SET voucher_year=?, voucher_month=?, voucher_type=?, voucher_no=?, voucher_id=?, updated_at=datetime('now') WHERE id=?
  `)

  // 辅助项目名称（类别按 id / code 都能识别，见 parseCounterAuxSelections）
  const getItemName = db.prepare(`SELECT name FROM aux_items WHERE account_set_id=? AND id=? LIMIT 1`)

  const voucherNos: string[] = []
  const voucherIds: string[] = []
  const details: CashierVoucherDetail[] = []
  let totalDebit = 0
  let totalCredit = 0
  let hangupCount = 0

  // 4. 每条日记账独立生成一张凭证；收付款单来源的流水（通过出纳制证模式）同一单据合并成一张凭证（事务包裹全部）
  const units: any[][] = []
  const unitByDoc = new Map<string, any[]>()
  for (const r of rows) {
    const src = moded.sources.get(r.id)
    if (!src) { units.push([r]); continue }
    const key = `${src.doc_type}|${src.doc_no}`
    let u = unitByDoc.get(key)
    if (!u) { u = []; unitByDoc.set(key, u); units.push(u) }
    u.push(r)
  }

  const tx = db.transaction(() => {
    for (const unit of units) {
      const head = unit[0]
      const src = moded.sources.get(head.id)
      const [year, month] = (head.biz_date as string).split('-').map(Number)
      // 本期最大号（含已生成的，确保号码不重复）
      const lastNo = (db.prepare(`
        SELECT CAST(CASE WHEN INSTR(voucher_no,'-')>0 THEN SUBSTR(voucher_no,INSTR(voucher_no,'-')+1) ELSE voucher_no END AS INTEGER) no
        FROM vouchers WHERE account_set_id=? AND year=? AND period=? ORDER BY no DESC LIMIT 1
      `).get(accountSetId, year, month) as any)?.no ?? 0
      const voucherNo = buildVoucherNo({ maxNo: lastNo, typeName: voucherTypeName || undefined })
      const voucherId = uuidv4()
      const remark = src ? `${paymentDocLabel(src.doc_type)}${src.doc_no}` : (head.summary || '出纳生成')
      // 先插凭证头（金额待分录写完回填），分录外键依赖凭证头
      insVoucher.run(voucherId, accountSetId, voucherNo, voucherTypeId, head.biz_date, year, month, 0, makerName, remark)
      let voucherTotal = 0
      let seq = 0

      for (const r of unit) {
        const counterCode = r.counter_account || hangupCode!
        const cAcc = lookup.get(accountSetId, counterCode) as any
        // P2-1：金额统一保留两位，total_amount 与 amount_cents 口径一致
        // FIX-260：外币行凭证金额取本位币（原币 × 汇率）；存量本位币行 base_* 与原币相同
        const fcAmt = Math.round((r.debit > 0 ? r.debit : r.credit) * 100) / 100
        const rate = cashIsForeign && Number(r.exchange_rate) > 0 ? Number(r.exchange_rate) : 1
        const baseStored = r.debit > 0 ? Number(r.base_debit) : Number(r.base_credit)
        const amt = cashIsForeign
          ? (baseStored > 0 ? Math.round(baseStored * 100) / 100 : Math.round(fcAmt * rate * 100) / 100)
          : fcAmt
        const hungup = !r.counter_account
        if (r.debit > 0) totalDebit += amt
        else totalCredit += amt
        if (hungup) hangupCount++
        voucherTotal += amt

        // 解析辅助核算
        const entryAux: any = {
          dept_id: null, dept_name: null, project_id: null, project_name: null,
          supplier_id: null, supplier_name: null, person_id: null, person_name: null,
          func_class_id: null, func_class_name: null, aux_data: null
        }
        if (r.counter_aux_item_id) {
          try {
            const auxDataObj: Record<string, any> = {}
            for (const { cat, itemId } of parseCounterAuxSelections(r.counter_aux_item_id, auxLookup).values()) {
              const itemName = (getItemName.get(accountSetId, itemId) as any)?.name || ''

              // 分配到固定列或 aux_data
              const code = cat.code
              if (code === 'dept') { entryAux.dept_id = itemId; entryAux.dept_name = itemName }
              else if (code === 'project' || code === 'proj') { entryAux.project_id = itemId; entryAux.project_name = itemName }
              else if (code === 'supplier' || code === 'customer' || code === 'supp') { entryAux.supplier_id = itemId; entryAux.supplier_name = itemName }
              else if (code === 'person' || code === 'pers') { entryAux.person_id = itemId; entryAux.person_name = itemName }
              else if (code === 'func_class' || code === 'func') { entryAux.func_class_id = itemId; entryAux.func_class_name = itemName }

              // 所有项都放入 aux_data 供前端展示
              auxDataObj[code] = { id: itemId, name: itemName }
            }
            if (Object.keys(auxDataObj).length > 0) {
              entryAux.aux_data = JSON.stringify(auxDataObj)
            }
          } catch { /* ignore */ }
        }

        const runEntry = (accId: any, accCode: string, accName: string, direction: string, hasAux: boolean, foreign: boolean) => {
          const aux = hasAux ? entryAux : {
            dept_id: null, dept_name: null, project_id: null, project_name: null,
            supplier_id: null, supplier_name: null, person_id: null, person_name: null,
            func_class_id: null, func_class_name: null, aux_data: null
          }
          insEntry.run(
            uuidv4(), accountSetId, voucherId, ++seq, accId, accCode, accName, direction, amt, Math.round(amt * 100), r.summary || '出纳生成',
            aux.dept_id, aux.dept_name, aux.project_id, aux.project_name,
            aux.supplier_id, aux.supplier_name, aux.person_id, aux.person_name,
            aux.func_class_id, aux.func_class_name, aux.aux_data,
            foreign ? cashCurrency : null, foreign ? rate : null, foreign ? fcAmt : null
          )
        }
        // 对方科目为同币种外币科目时同样带原币三字段（前面已拦截币种不一致）
        const counterForeign = cashIsForeign && accountCurrency(cAcc) === cashCurrency

        if (r.debit > 0) {
          // 收入：借现金，贷对方
          runEntry(cashAcc.id, cashGlCode, cashAcc.name, 'debit', false, cashIsForeign)
          runEntry(cAcc.id, counterCode, cAcc.name, 'credit', true, counterForeign)
        } else {
          // 支出：借对方，贷现金
          runEntry(cAcc.id, counterCode, cAcc.name, 'debit', true, counterForeign)
          runEntry(cashAcc.id, cashGlCode, cashAcc.name, 'credit', false, cashIsForeign)
        }

        updJournal.run(year, month, voucherTypeId, voucherNo, voucherId, r.id)
        details.push({
          voucherNo,
          bizDate: r.biz_date,
          summary: r.summary || null,
          amount: amt,
          direction: r.debit > 0 ? '收入' : '支出',
          counterCode,
          counterName: cAcc.name,
          hungup,
          ...(cashIsForeign ? { currency: cashCurrency, exchangeRate: rate, foreignAmount: fcAmt } : {}),
        })
      }

      db.prepare('UPDATE vouchers SET total_amount=? WHERE id=?').run(Math.round(voucherTotal * 100) / 100, voucherId)
      // 通过出纳制证：回写收付款单凭证号，单据据此显示已制证并禁止反审核
      if (src?.doc_id) {
        db.prepare('UPDATE scm_doc SET voucher_id=? WHERE id=? AND account_set_id=? AND voucher_id IS NULL').run(voucherId, src.doc_id, accountSetId)
      }
      voucherNos.push(voucherNo)
      voucherIds.push(voucherId)
    }
  })
  tx()

  // 合计保留两位，避免浮点累加误差
  totalDebit = Math.round(totalDebit * 100) / 100
  totalCredit = Math.round(totalCredit * 100) / 100

  return {
    syncedCount: rows.length,
    voucherNos,
    voucherIds,
    totalDebit,
    totalCredit,
    hangupCount,
    hangupCode: hangupCount > 0 ? hangupCode || null : null,
    hangupName: hangupCount > 0 ? (ha?.name ?? null) : null,
    details,
  }
}

// ── 出纳日报 ─────────────────────────────────────────────

export interface DailyReportRow {
  account_code: string
  account_name: string
  opening: number
  income: number   // 借方
  expense: number  // 贷方
  closing: number
}

export function getAccountBalanceReport(params: {
  accountSetId: string
  startDate: string
  endDate: string
  currency?: string
  /** 科目授权上下文（P1-10）：只汇总白名单内的现金 / 银行科目 */
  scope?: AccountScopeContext
}): { rows: DailyReportRow[]; total_income: number; total_expense: number } {
  const db = getDb()
  const { accountSetId, startDate, endDate } = params
  const currency = normalizeCashierCurrency(params.currency, getCashierBaseCurrency(db, accountSetId))

  // 现金+银行科目列表（按科目授权过滤）
  syncCashierAccountsFromGl(db, accountSetId)
  const accConds = ['a.account_set_id=?', 'a.is_enabled=1']
  const accParams: any[] = [accountSetId]
  appendCashierViewScope(params.scope, 'a', accConds, accParams)
  const accounts = db.prepare(`
    SELECT a.code, a.name FROM v_cashier_account a
    WHERE ${accConds.join(' AND ')}
    ORDER BY a.code
  `).all(...accParams) as Array<{ code: string; name: string }>

  const rows: DailyReportRow[] = []
  let totalIncome = 0, totalExpense = 0

  for (const acc of accounts) {
    const opening = getInitBalance(accountSetId, acc.code, currency)
    // 开始日期之前的累计净额
    const before = db.prepare(`
      SELECT COALESCE(SUM(debit),0) d, COALESCE(SUM(credit),0) c
      FROM cashier_journal WHERE account_set_id=? AND account_code=? AND currency=? AND biz_date < ?
    `).get(accountSetId, acc.code, currency, startDate) as { d: number; c: number }
    const dayBefore = opening + before.d - before.c

    // 期间收支
    const period = db.prepare(`
      SELECT COALESCE(SUM(debit),0) d, COALESCE(SUM(credit),0) c
      FROM cashier_journal WHERE account_set_id=? AND account_code=? AND currency=? AND biz_date >= ? AND biz_date <= ?
    `).get(accountSetId, acc.code, currency, startDate, endDate) as { d: number; c: number }

    // P2-1：先各列取整到分，再用分整数相加，保证 期初 + 收入 − 支出 = 期末 逐行成立（此前四列独立取整可能差 1 分）
    const cents = (n: number) => Math.round(n * 100)
    const openingC = cents(dayBefore)
    const incomeC = cents(period.d)
    const expenseC = cents(period.c)
    const closingC = openingC + incomeC - expenseC
    totalIncome += incomeC
    totalExpense += expenseC
    rows.push({
      account_code: acc.code,
      account_name: acc.name,
      opening: openingC / 100,
      income: incomeC / 100,
      expense: expenseC / 100,
      closing: closingC / 100,
    })
  }

  return { rows, total_income: totalIncome / 100, total_expense: totalExpense / 100 }
}

export function getCashFlowSummary(params: {
  accountSetId: string
  startDate?: string
  endDate?: string
  currency?: string
  groupBy: 'counter_account' | 'settle_type' | 'month'
  /** 科目授权上下文（P1-10） */
  scope?: AccountScopeContext
}): any[] {
  const db = getDb()
  const { accountSetId, startDate, endDate, groupBy } = params

  const conds = ['j.account_set_id=?']
  const vals: any[] = [accountSetId]
  appendCashierCodeScopeCondition(params.scope, accountSetId, 'j.account_code', conds, vals)
  if (params.currency) { conds.push('j.currency = ?'); vals.push(normalizeCashierCurrency(params.currency, getCashierBaseCurrency(db, accountSetId))) }
  if (startDate) { conds.push('j.biz_date >= ?'); vals.push(startDate) }
  if (endDate) { conds.push('j.biz_date <= ?'); vals.push(endDate) }

  let groupCol = ''
  let joinClause = ''
  let groupNameSelect = ''

  if (groupBy === 'month') {
    groupCol = "strftime('%Y-%m', j.biz_date)"
    groupNameSelect = `${groupCol} AS group_name`
  } else if (groupBy === 'settle_type') {
    groupCol = 'j.settle_type'
    joinClause = 'LEFT JOIN settle_type st ON j.settle_type = st.code AND j.account_set_id = st.account_set_id'
    groupNameSelect = `COALESCE(st.name, j.settle_type, '未指定') AS group_name`
  } else if (groupBy === 'counter_account') {
    groupCol = 'j.counter_account'
    joinClause = 'LEFT JOIN accounts a ON j.counter_account = a.code AND j.account_set_id = a.account_set_id'
    groupNameSelect = `COALESCE(a.name, j.counter_account, '未指定') AS group_name`
  }

  const sql = `
    SELECT
      ${groupCol} AS group_code,
      ${groupNameSelect},
      SUM(j.debit) AS income,
      SUM(j.credit) AS expense
    FROM cashier_journal j
    ${joinClause}
    WHERE ${conds.join(' AND ')}
    GROUP BY ${groupCol}
    ORDER BY group_code
  `

  const rows = db.prepare(sql).all(...vals) as any[]
  return rows.map(r => ({
    group_code: r.group_code || 'N/A',
    group_name: r.group_name || '未指定',
    income: Math.round((r.income || 0) * 100) / 100,
    expense: Math.round((r.expense || 0) * 100) / 100,
  }))
}

/**
 * P1-11：凭证重排号 / 插号 / 手工改号后，按 voucher_id 把新的 年/期/类型/号 刷回出纳日记账。
 * 日记账以 voucher_id 为真正的关联键，冗余的号只作展示与老库回退匹配。
 * 老库（无 voucher_id 列）静默跳过。
 */
export function syncCashierVoucherNos(db: any, accountSetId: string, voucherIds: string[]): number {
  if (!voucherIds.length) return 0
  const cols = db.prepare('PRAGMA table_info(cashier_journal)').all() as Array<{ name: string }>
  if (!cols.some(c => c.name === 'voucher_id')) return 0
  const upd = db.prepare(`
    UPDATE cashier_journal
       SET voucher_year = (SELECT v.year FROM vouchers v WHERE v.id = cashier_journal.voucher_id),
           voucher_month = (SELECT v.period FROM vouchers v WHERE v.id = cashier_journal.voucher_id),
           voucher_type = (SELECT v.voucher_type_id FROM vouchers v WHERE v.id = cashier_journal.voucher_id),
           voucher_no = (SELECT v.voucher_no FROM vouchers v WHERE v.id = cashier_journal.voucher_id),
           updated_at = datetime('now')
     WHERE account_set_id = ? AND voucher_id = ?
  `)
  let n = 0
  for (const id of voucherIds) n += upd.run(accountSetId, id).changes
  return n
}

// ── 凭证自动同步到出纳日记账 ───────────────────────────────

/**
 * 凭证保存/修改后，检查是否涉及现金/银行科目，
 * 若启用自动同步（system_params cashier:auto_sync=1），则自动生成/更新出纳日记账。
 *
 * 幂等策略：按 (account_set_id, voucher_year, voucher_month, voucher_type, voucher_no, account_code, biz_date) 查重，
 * 存在则更新金额/摘要，不存在则插入。
 */
export function syncCashierFromVoucher(params: {
  db: any
  accountSetId: string
  voucherDate: string
  voucherYear: number
  voucherMonth: number
  voucherType: number | string | null
  voucherNo: string
  /** 凭证 id（迁移 127 后作为真正的关联键写入 cashier_journal.voucher_id） */
  voucherId?: string | null
  entries: Array<{
    account_code: string
    direction: 'debit' | 'credit'
    amount: number
    summary?: string
    /** FIX-260：分录外币三字段（外币出纳科目按原币写日记账） */
    currency_code?: string | null
    exchange_rate?: number | null
    foreign_amount?: number | null
  }>
}): { synced: number } {
  const { db, accountSetId, voucherDate, voucherYear, voucherMonth, voucherType, voucherNo, voucherId = null, entries } = params

  // 检查是否启用自动同步（默认不启用，按账套独立配置）
  const cfg = db.prepare(
    "SELECT param_value FROM system_params WHERE account_set_id=? AND param_key='cashier:auto_sync'"
  ).get(accountSetId) as any
  if (!cfg || cfg.param_value !== '1') return { synced: 0 }

  // 取现金/银行科目列表
  // 出纳独立账户：凭证分录科目 → 关联的出纳账户（无关联账户的现金 / 银行科目不同步）
  const codeSet = cashierLinkedGlCodes(db, accountSetId)
  const hasCashEntry = entries.some(e => codeSet.has(e.account_code))
  if (!hasCashEntry) return { synced: 0 }

  // P1-6：目标月份出纳已结账则拒绝写入（总账侧守卫已先拦，这里兜底）
  assertCashierPeriodOpen(db, accountSetId, voucherDate)
  const baseCurrency = getCashierBaseCurrency(db, accountSetId)

  // 查重用空值安全的 IS 比较：CW 凭证类型为 UUID，vt 恒为 null，
  // 若用 `voucher_type=?`（NULL 比较永不成立）会导致每次编辑凭证都重复插入日记账（FIX：见修复日志）。
  // P2-6：查重键不再含 biz_date——仅改凭证日期时此前会新插一行、原行留存，出纳余额翻倍；
  // 优先按 voucher_id 定位（迁移 127），无 voucher_id 的存量行回退到 年/期/类型/号。
  const findByVoucherId = db.prepare(`
    SELECT id, biz_date FROM cashier_journal
    WHERE account_set_id=? AND account_code=? AND voucher_id=?
    LIMIT 1
  `)
  const find = db.prepare(`
    SELECT id, biz_date FROM cashier_journal
    WHERE account_set_id=? AND account_code=?
      AND voucher_year=? AND voucher_month=? AND voucher_type IS ? AND voucher_no=?
    LIMIT 1
  `)
  const insert = db.prepare(`
    INSERT INTO cashier_journal
      (id, account_set_id, account_code, currency, biz_date, seq, summary, debit, credit,
       exchange_rate, base_debit, base_credit,
       counter_account, voucher_year, voucher_month, voucher_type, voucher_no, voucher_id, created_by)
    VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, '凭证同步')
  `)
  const update = db.prepare(`
    UPDATE cashier_journal
       SET debit=?, credit=?, currency=?, exchange_rate=?, base_debit=?, base_credit=?,
           summary=?, biz_date=?, voucher_year=?, voucher_month=?, voucher_id=COALESCE(?, voucher_id),
           updated_at=datetime('now')
     WHERE id=?
  `)

  let synced = 0
  // voucher_type 列定义为 INTEGER（ACD 兼容），CW 内部用 UUID，取不到数字则存 null
  const vtNum = Number(voucherType)
  const vt = (voucherType != null && voucherType !== '' && !isNaN(vtNum)) ? vtNum : null
  const accountCurrencyCache = new Map<string, string>()
  for (const entry of entries) {
    if (!codeSet.has(entry.account_code)) continue
    const cashierCode = cashierCodeForGl(db, accountSetId, entry.account_code)
    if (!cashierCode) continue
    // FIX-260：币种跟科目走。外币出纳科目：原币 = 分录 foreign_amount（缺失时按汇率倒算），本位币 = amount
    let currency = accountCurrencyCache.get(cashierCode)
    if (currency === undefined) {
      currency = getCashierAccountCurrency(db, accountSetId, cashierCode)
      accountCurrencyCache.set(cashierCode, currency)
    }
    const baseAmount = Math.round((Number(entry.amount) || 0) * 100) / 100
    let fcAmount = baseAmount
    let rate = 1
    if (currency !== baseCurrency) {
      rate = Number(entry.exchange_rate) > 0 ? Number(entry.exchange_rate) : resolveCashierRate(db, accountSetId, currency, voucherDate)
      fcAmount = Number(entry.foreign_amount) > 0
        ? Math.round(Number(entry.foreign_amount) * 100) / 100
        : Math.round((baseAmount / rate) * 100) / 100
    }
    const debit = entry.direction === 'debit' ? fcAmount : 0
    const credit = entry.direction === 'credit' ? fcAmount : 0
    const baseDebit = entry.direction === 'debit' ? baseAmount : 0
    const baseCredit = entry.direction === 'credit' ? baseAmount : 0
    const summary = entry.summary || '凭证'

    const existing =
      (voucherId ? (findByVoucherId.get(accountSetId, cashierCode, voucherId) as any) : null) ||
      (find.get(accountSetId, cashierCode, voucherYear, voucherMonth, vt, voucherNo) as any)
    if (existing) {
      // 原行所在月份已结账同样拒绝改写
      if (existing.biz_date !== voucherDate) assertCashierPeriodOpen(db, accountSetId, existing.biz_date)
      update.run(debit, credit, currency, rate, baseDebit, baseCredit, summary, voucherDate, voucherYear, voucherMonth, voucherId, existing.id)
    } else {
      insert.run(uuidv4(), accountSetId, cashierCode, currency, voucherDate, summary, debit, credit,
        rate, baseDebit, baseCredit, voucherYear, voucherMonth, vt, voucherNo, voucherId)
    }
    synced++
  }
  return { synced }
}

/**
 * 出纳生成的凭证（source='cashier'）被重新编辑后，把「对方科目」回写出纳日记账。
 *
 * 适用场景：生成凭证时对未填对方科目的记录用「挂账科目」占位，事后在凭证录入界面
 * 把占位科目改成真实对方科目，需同步更新对应日记账记录的 counter_account。
 *
 * 关联定位：用编辑前的 (account_set_id, voucher_year, voucher_month, voucher_type, voucher_no)
 * 命中 generateCashierVoucher 写入的日记账行（一对一）。日记账行自带现金科目 account_code，
 * 凭证里 account_code ≠ 该现金科目、且「恰好一条」的分录即新对方科目。
 *
 * 仅回写 counter_account（不动 debit/credit/summary）；号/日期若改了则一并刷新链接字段，避免下次失配。
 * 找不到关联行、或对方分录不唯一时静默跳过，返回 updated:0。
 */
export function syncCashierCounterFromVoucher(params: {
  db: any
  accountSetId: string
  // 编辑前的关联标识（用于定位日记账行）
  oldYear: number
  oldMonth: number
  oldVoucherType: number | string | null
  oldVoucherNo: string
  // 编辑后的凭证分录
  entries: Array<{ account_code: string }>
  // 编辑后的新关联标识（号/日期若改了，刷新日记账链接）
  newYear: number
  newMonth: number
  newVoucherType: number | string | null
  newVoucherNo: string
  /** 凭证 id：迁移 127 后优先按 voucher_id 定位 */
  voucherId?: string | null
}): { updated: number } {
  const {
    db, accountSetId,
    oldYear, oldMonth, oldVoucherType, oldVoucherNo,
    entries,
    newYear, newMonth, newVoucherType, newVoucherNo,
    voucherId = null,
  } = params

  // 1. 优先按 voucher_id 定位；存量行回退到编辑前标识
  //   （voucher_type/voucher_no 列声明为 INTEGER 但实存 UUID/字符串，CAST 成文本比较）
  const journalRow =
    (voucherId
      ? (db.prepare('SELECT id, account_code, biz_date FROM cashier_journal WHERE account_set_id=? AND voucher_id=? LIMIT 1').get(accountSetId, voucherId) as any)
      : null) ||
    (db.prepare(`
      SELECT id, account_code, biz_date FROM cashier_journal
      WHERE account_set_id=? AND voucher_year=? AND voucher_month=?
        AND CAST(voucher_type AS TEXT)=? AND CAST(voucher_no AS TEXT)=?
      LIMIT 1
    `).get(
      accountSetId, oldYear, oldMonth,
      oldVoucherType == null ? '' : String(oldVoucherType),
      oldVoucherNo == null ? '' : String(oldVoucherNo),
    ) as any)
  if (!journalRow) return { updated: 0 }

  // P1-6：已结账月份的日记账行不回写
  assertCashierPeriodOpen(db, accountSetId, journalRow.biz_date)

  // 2. 对方分录 = account_code ≠ 现金科目；必须恰好一条，否则歧义跳过
  // 出纳账户编码换算成关联科目再比较（独立账户编码与凭证分录科目编码不同）
  const cashGl = cashierGlCode(db, accountSetId, journalRow.account_code) || journalRow.account_code
  const counters = entries.filter(e => String(e.account_code) !== String(cashGl))
  if (counters.length !== 1) return { updated: 0 }
  const newCounterCode = counters[0].account_code

  // 3. 回写 counter_account，并刷新链接字段（号/日期若没改即原值）
  db.prepare(`
    UPDATE cashier_journal
    SET counter_account=?, voucher_year=?, voucher_month=?, voucher_type=?, voucher_no=?,
        voucher_id=COALESCE(?, voucher_id), updated_at=datetime('now')
    WHERE id=?
  `).run(
    newCounterCode, newYear, newMonth,
    newVoucherType == null ? null : String(newVoucherType),
    newVoucherNo == null ? null : String(newVoucherNo),
    voucherId,
    journalRow.id,
  )

  return { updated: 1 }
}
