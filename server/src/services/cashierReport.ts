/**
 * 出纳报表统一查询服务。
 *
 * 所有报表共用一个过滤对象 CashierReportFilter 与 buildJournalWhere，保证「余额表 / 多维汇总 / 辅助项目收支 /
 * 综合查询」口径一致：科目授权、账户类型、币种、对方科目、结算方式、辅助项目、凭证状态、对账状态、关键字、金额。
 *
 * 口径约定：
 *   - 辅助项目 = 流水「对方科目」的辅助核算（现金 / 银行科目自身没有辅助项），走子表 cashier_journal_aux；
 *   - 金额一律先取整到分（ROUND(x*100)）再累加，避免浮点累计误差，期初 + 收入 − 支出 = 期末逐行成立；
 *   - currency='ALL' 表示跨币种汇总，金额取本位币列 base_debit / base_credit；否则取原币。
 */
import {
  appendCashierCodeScopeCondition,
  appendCashierViewScope,
  getCashierBaseCurrency,
  normalizeCashierCurrency,
  resolveCashierRate,
  attachAuxValues,
  enrichJournalRows,
  listAuxColumns,
  type AuxColumn,
  type JournalRow,
} from './cashierQuery.js'
import { appendAccountScopeCondition, type AccountScopeContext } from './accountAuthorization.js'
import { syncCashierAccountsFromGl, ensureCashierAccountSchema } from './cashierAccount.js'
import { SCM_LINKED_JOURNAL_SQL } from './paymentVoucherMode.js'

/** 进销存未启用的账套没有往来台账表 */
function hasScmArApLog(db: Db): boolean {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='scm_ar_ap_log'").get()
}

type Db = any

export const ALL_CURRENCIES = 'ALL'
/** 辅助项目筛选里表示「未指定该类别辅助」的特殊项目 id */
export const AUX_NONE = '__none__'

export type VoucherStatusFilter = 'none' | 'draft' | 'audited' | 'posted'

export interface CashierReportFilter {
  accountSetId: string
  startDate?: string
  endDate?: string
  accountCodes?: string[]
  accountType?: 'cash' | 'bank' | 'all'
  /** 币种；'ALL' = 跨币种按本位币折算；缺省 = 本位币 */
  currency?: string
  counterAccounts?: string[]
  settleTypes?: string[]
  aux?: Array<{ categoryId: string; itemIds?: string[] }>
  voucherStatus?: VoucherStatusFilter[]
  reconciled?: 0 | 1
  summary?: string
  billNo?: string
  counterUnit?: string
  amountDirection?: 'all' | 'income' | 'expense'
  minAmount?: number
  maxAmount?: number
  /** 排除收付款单审核写入的流水（收付款单直接制证模式下，这些流水不属于出纳待制证） */
  excludeScmPayment?: boolean
  scope?: AccountScopeContext
}

const cents = (n: number) => Math.round((Number(n) || 0) * 100)
const money = (c: number) => c / 100
const like = (s: string) => `%${s.replace(/[\\%_]/g, m => `\\${m}`)}%`
const inList = (n: number) => Array(n).fill('?').join(',')

/** 解析当前过滤使用的币种：{ all: 是否跨币种折本位币, currency: 具体币种(all 时为本位币) } */
export function resolveReportCurrency(db: Db, f: Pick<CashierReportFilter, 'accountSetId' | 'currency'>) {
  const base = getCashierBaseCurrency(db, f.accountSetId)
  if (String(f.currency || '').toUpperCase() === ALL_CURRENCIES) return { all: true, currency: base, base }
  return { all: false, currency: normalizeCashierCurrency(f.currency, base), base }
}

/** 取金额列：跨币种用本位币列，否则原币列 */
export function amountColumns(all: boolean, alias = 'j') {
  return all ? { d: `${alias}.base_debit`, c: `${alias}.base_credit` } : { d: `${alias}.debit`, c: `${alias}.credit` }
}

/**
 * 把请求 / 导出参数（snake_case）收敛成 CashierReportFilter。接口与导出数据源共用同一份解析，
 * 保证「页面上看到的」与「导出的」筛选口径完全一致。
 */
export function parseReportFilterParams(
  b: Record<string, any>,
  accountSetId: string,
  scope?: AccountScopeContext
): CashierReportFilter {
  const arr = (v: any): string[] | undefined => {
    const list = Array.isArray(v) ? v : (typeof v === 'string' && v ? v.split(',') : [])
    const out = list.map((x: any) => String(x).trim()).filter(Boolean)
    return out.length ? out : undefined
  }
  const num = (v: any): number | undefined =>
    v === undefined || v === null || v === '' ? undefined : (Number.isFinite(Number(v)) ? Number(v) : undefined)
  let aux: CashierReportFilter['aux']
  let rawAux = b.aux
  if (typeof rawAux === 'string' && rawAux) { try { rawAux = JSON.parse(rawAux) } catch { rawAux = undefined } }
  if (Array.isArray(rawAux)) {
    aux = rawAux
      .map((a: any) => ({ categoryId: String(a?.category_id ?? a?.categoryId ?? ''), itemIds: arr(a?.item_ids ?? a?.itemIds) }))
      .filter(a => a.categoryId)
  }
  let voucherStatus = arr(b.voucher_status) as VoucherStatusFilter[] | undefined
  // 兼容旧参数：has_voucher=1 → 已有凭证（任意状态）；0 → 无凭证
  if (!voucherStatus && (b.has_voucher === 1 || b.has_voucher === '1')) voucherStatus = ['draft', 'audited', 'posted']
  if (!voucherStatus && (b.has_voucher === 0 || b.has_voucher === '0')) voucherStatus = ['none']
  const at = b.account_type
  const dir = b.amount_direction
  const rec = b.reconciled
  return {
    accountSetId,
    startDate: b.start_date || undefined,
    endDate: b.end_date || undefined,
    accountCodes: arr(b.account_codes),
    accountType: at === 'cash' || at === 'bank' || at === 'all' ? at : undefined,
    currency: b.currency ? String(b.currency) : undefined,
    counterAccounts: arr(b.counter_accounts),
    settleTypes: arr(b.settle_types),
    aux,
    voucherStatus,
    reconciled: rec === 0 || rec === 1 || rec === '0' || rec === '1' ? (Number(rec) as 0 | 1) : undefined,
    summary: b.summary ? String(b.summary) : undefined,
    billNo: b.bill_no ? String(b.bill_no) : undefined,
    counterUnit: b.counter_unit ? String(b.counter_unit) : undefined,
    amountDirection: dir === 'income' || dir === 'expense' ? dir : undefined,
    minAmount: num(b.min_amount),
    maxAmount: num(b.max_amount),
    excludeScmPayment: b.exclude_scm_payment === 1 || b.exclude_scm_payment === '1' || b.exclude_scm_payment === true || b.exclude_scm_payment === 'true',
    scope,
  }
}

export interface JournalWhere {
  conds: string[]
  params: any[]
  /** 是否需要 LEFT JOIN vouchers v ON v.id = j.voucher_id */
  needVoucherJoin: boolean
}

/**
 * 构建流水过滤条件（表别名固定为 j）。
 * @param opts.skipDate 余额表需要区间前的数据，日期条件由调用方自己处理
 * @param opts.skipCurrency 同上，币种由调用方处理
 */
export function buildJournalWhere(
  db: Db,
  f: CashierReportFilter,
  opts: { skipDate?: boolean; skipCurrency?: boolean } = {}
): JournalWhere {
  ensureCashierAccountSchema(db as any)
  const conds: string[] = ['j.account_set_id = ?']
  const params: any[] = [f.accountSetId]
  let needVoucherJoin = false

  appendCashierCodeScopeCondition(f.scope, f.accountSetId, 'j.account_code', conds, params)

  if (f.accountCodes?.length) {
    conds.push(`j.account_code IN (${inList(f.accountCodes.length)})`)
    params.push(...f.accountCodes)
  }
  if (f.accountType === 'cash' || f.accountType === 'bank') {
    conds.push(
      `EXISTS (SELECT 1 FROM v_cashier_account ta WHERE ta.account_set_id = j.account_set_id AND ta.code = j.account_code AND ta.${f.accountType === 'cash' ? 'is_cash' : 'is_bank'} = 1)`
    )
  }
  if (!opts.skipCurrency) {
    const cur = resolveReportCurrency(db, f)
    if (!cur.all) { conds.push('j.currency = ?'); params.push(cur.currency) }
  }
  if (!opts.skipDate) {
    if (f.startDate) { conds.push('j.biz_date >= ?'); params.push(f.startDate) }
    if (f.endDate) { conds.push('j.biz_date <= ?'); params.push(f.endDate) }
  }
  if (f.counterAccounts?.length) {
    conds.push(`j.counter_account IN (${inList(f.counterAccounts.length)})`)
    params.push(...f.counterAccounts)
  }
  if (f.settleTypes?.length) {
    conds.push(`j.settle_type IN (${inList(f.settleTypes.length)})`)
    params.push(...f.settleTypes)
  }
  if (f.summary) { conds.push("j.summary LIKE ? ESCAPE '\\'"); params.push(like(f.summary)) }
  if (f.billNo) { conds.push("j.bill_no LIKE ? ESCAPE '\\'"); params.push(like(f.billNo)) }
  if (f.counterUnit) { conds.push("j.counter_unit LIKE ? ESCAPE '\\'"); params.push(like(f.counterUnit)) }
  if (f.reconciled === 0 || f.reconciled === 1) { conds.push('j.reconciled = ?'); params.push(f.reconciled) }

  // 金额方向与区间（按所选金额列判断）
  const { d, c } = amountColumns(resolveReportCurrency(db, f).all)
  const dir = f.amountDirection || 'all'
  let amountCol = `(${d} + ${c})`
  if (dir === 'income') { amountCol = d; conds.push(`${d} > 0`) }
  else if (dir === 'expense') { amountCol = c; conds.push(`${c} > 0`) }
  if (f.minAmount !== undefined && Number.isFinite(f.minAmount)) { conds.push(`${amountCol} >= ?`); params.push(f.minAmount) }
  if (f.maxAmount !== undefined && Number.isFinite(f.maxAmount)) { conds.push(`${amountCol} <= ?`); params.push(f.maxAmount) }

  // 凭证状态：none=尚未生成凭证；其余按凭证实际状态（出纳表只记 voucher_id，状态要联 vouchers）
  if (f.voucherStatus?.length) {
    const parts: string[] = []
    const real = f.voucherStatus.filter(s => s !== 'none')
    if (f.voucherStatus.includes('none')) parts.push('(j.voucher_id IS NULL AND j.voucher_no IS NULL)')
    if (real.length) {
      needVoucherJoin = true
      parts.push(`v.status IN (${inList(real.length)})`)
      params.push(...real)
    }
    conds.push(`(${parts.join(' OR ')})`)
  }

  if (f.excludeScmPayment && hasScmArApLog(db)) conds.push(`NOT ${SCM_LINKED_JOURNAL_SQL}`)

  // 辅助项目：多类别 AND；类别内项目 OR；项目含 AUX_NONE 表示「未指定」
  for (const a of f.aux || []) {
    if (!a.categoryId) continue
    const ids = (a.itemIds || []).filter(Boolean)
    const wantNone = ids.includes(AUX_NONE)
    const real = ids.filter(i => i !== AUX_NONE)
    const parts: string[] = []
    if (!ids.length) {
      parts.push('EXISTS (SELECT 1 FROM cashier_journal_aux ax WHERE ax.journal_id = j.id AND ax.category_id = ?)')
      params.push(a.categoryId)
    } else {
      if (real.length) {
        parts.push(`EXISTS (SELECT 1 FROM cashier_journal_aux ax WHERE ax.journal_id = j.id AND ax.category_id = ? AND ax.item_id IN (${inList(real.length)}))`)
        params.push(a.categoryId, ...real)
      }
      if (wantNone) {
        parts.push('NOT EXISTS (SELECT 1 FROM cashier_journal_aux ax WHERE ax.journal_id = j.id AND ax.category_id = ?)')
        params.push(a.categoryId)
      }
    }
    conds.push(`(${parts.join(' OR ')})`)
  }

  return { conds, params, needVoucherJoin }
}

/** 现金 / 银行末级启用科目（按科目授权过滤）；与 listCashierAccounts 同口径，但使用传入的 db，便于测试 */
export function listScopedCashierAccounts(
  db: Db,
  f: Pick<CashierReportFilter, 'accountSetId' | 'scope'>
): Array<{ code: string; name: string; is_cash: number; is_bank: number; is_foreign: number; currency_code: string | null }> {
  // 出纳独立账户：读「出纳账户」档案（与 listCashierAccounts 同口径）
  syncCashierAccountsFromGl(db as any, f.accountSetId)
  const conds = ['a.account_set_id = ?', 'a.is_enabled = 1']
  const params: any[] = [f.accountSetId]
  appendCashierViewScope(f.scope, 'a', conds, params)
  return db.prepare(
    `SELECT a.code, a.name, a.is_cash, a.is_bank, a.is_foreign, a.currency_code
     FROM v_cashier_account a WHERE ${conds.join(' AND ')} ORDER BY a.code`
  ).all(...params)
}

// ═══ 账户余额表 ═══════════════════════════════════════════════════════════

export interface BalanceReportRow {
  account_code: string
  account_name: string
  currency: string
  opening: number
  income: number
  expense: number
  closing: number
  /** 本位币折算（外币行按流水折算额累计；期初外币余额按期初汇率估算，base_estimated=true） */
  income_base: number
  expense_base: number
  closing_base: number
  base_estimated: boolean
  /** 本期笔数 */
  count: number
  /** 截至期末尚未与总账对账的笔数 / 净额（借−贷） */
  unreconciled_count: number
  unreconciled_net: number
}

export interface BalanceReportTotal {
  currency: string
  opening: number
  income: number
  expense: number
  closing: number
  count: number
}

export interface BalanceReport {
  base_currency: string
  currency_mode: 'single' | 'all'
  rows: BalanceReportRow[]
  /** 按币种分别合计（不同币种原币不能直接相加） */
  totals: BalanceReportTotal[]
  /** 本位币合计：收入 / 支出 / 期末（跨币种折算后） */
  total_base: { income: number; expense: number; closing: number }
  /** 所选币种下没有任何数据的已选科目数（提示「选了外币，人民币科目全是零」） */
  empty_accounts: number
}

/**
 * 账户余额表：一条聚合 SQL 取全部科目×币种，替代原来逐科目 2 次 SQL 的 N+1。
 * 余额表只应用「账户级」条件（科目 / 账户类型 / 币种 / 日期）；明细类条件（结算方式、辅助项目…）
 * 会让期初期末失去意义，由多维汇总承担。
 */
export function getBalanceReport(
  db: Db,
  f: CashierReportFilter & { startDate: string; endDate: string },
  opts: { includeZero?: boolean } = {}
): BalanceReport {
  const cur = resolveReportCurrency(db, f)
  const accounts = listScopedCashierAccounts(db, f).filter(a => {
    if (f.accountCodes?.length && !f.accountCodes.includes(a.code)) return false
    if (f.accountType === 'cash' && !a.is_cash) return false
    if (f.accountType === 'bank' && !a.is_bank) return false
    return true
  })
  const nameOf = new Map(accounts.map(a => [a.code, a.name]))
  const codes = accounts.map(a => a.code)
  const empty: BalanceReport = {
    base_currency: cur.base, currency_mode: cur.all ? 'all' : 'single', rows: [], totals: [],
    total_base: { income: 0, expense: 0, closing: 0 }, empty_accounts: 0,
  }
  if (!codes.length) return empty

  const curCond = cur.all ? '' : ' AND j.currency = ?'
  const curParams = cur.all ? [] : [cur.currency]
  const ph = inList(codes.length)

  // 区间前净额、本期收支、笔数、未对账，全部一条 SQL（走覆盖索引）
  const rowsRaw = db.prepare(`
    SELECT j.account_code, j.currency,
      COALESCE(SUM(CASE WHEN j.biz_date < ? THEN ROUND(j.debit*100) - ROUND(j.credit*100) ELSE 0 END), 0) AS before_net,
      COALESCE(SUM(CASE WHEN j.biz_date >= ? THEN ROUND(j.debit*100) ELSE 0 END), 0) AS inc,
      COALESCE(SUM(CASE WHEN j.biz_date >= ? THEN ROUND(j.credit*100) ELSE 0 END), 0) AS exp,
      COALESCE(SUM(CASE WHEN j.biz_date < ? THEN ROUND(j.base_debit*100) - ROUND(j.base_credit*100) ELSE 0 END), 0) AS before_base_net,
      COALESCE(SUM(CASE WHEN j.biz_date >= ? THEN ROUND(j.base_debit*100) ELSE 0 END), 0) AS inc_base,
      COALESCE(SUM(CASE WHEN j.biz_date >= ? THEN ROUND(j.base_credit*100) ELSE 0 END), 0) AS exp_base,
      SUM(CASE WHEN j.biz_date >= ? THEN 1 ELSE 0 END) AS cnt,
      SUM(CASE WHEN j.reconciled = 0 THEN 1 ELSE 0 END) AS unrec_cnt,
      COALESCE(SUM(CASE WHEN j.reconciled = 0 THEN ROUND(j.debit*100) - ROUND(j.credit*100) ELSE 0 END), 0) AS unrec_net
    FROM cashier_journal j
    WHERE j.account_set_id = ? AND j.biz_date <= ? AND j.account_code IN (${ph})${curCond}
    GROUP BY j.account_code, j.currency
  `).all(
    f.startDate, f.startDate, f.startDate, f.startDate, f.startDate, f.startDate, f.startDate,
    f.accountSetId, f.endDate, ...codes, ...curParams
  ) as any[]

  const initRows = db.prepare(`
    SELECT account_code, currency, balance FROM cashier_init_balance
    WHERE account_set_id = ? AND account_code IN (${ph})${cur.all ? '' : ' AND currency = ?'}
  `).all(f.accountSetId, ...codes, ...curParams) as any[]

  // 合并 账户×币种：有流水的、有期初的都要出现
  type Key = string
  const merged = new Map<Key, { code: string; currency: string; init: number; r?: any }>()
  const keyOf = (code: string, currency: string) => `${code}\u0000${normalizeCashierCurrency(currency, cur.base)}`
  for (const r of rowsRaw) {
    const k = keyOf(r.account_code, r.currency)
    merged.set(k, { code: r.account_code, currency: normalizeCashierCurrency(r.currency, cur.base), init: 0, r })
  }
  for (const i of initRows) {
    const k = keyOf(i.account_code, i.currency)
    const hit = merged.get(k)
    if (hit) hit.init += cents(i.balance)
    else merged.set(k, { code: i.account_code, currency: normalizeCashierCurrency(i.currency, cur.base), init: cents(i.balance) })
  }
  // 单币种模式下，所选币种没有数据的科目补一个零行（方便核对）
  if (!cur.all) {
    for (const code of codes) {
      const k = keyOf(code, cur.currency)
      if (!merged.has(k)) merged.set(k, { code, currency: cur.currency, init: 0 })
    }
  }

  const rows: BalanceReportRow[] = []
  let emptyAccounts = 0
  for (const m of merged.values()) {
    const r = m.r || {}
    const beforeNet = Number(r.before_net || 0)
    const inc = Number(r.inc || 0)
    const exp = Number(r.exp || 0)
    const openingC = m.init + beforeNet
    const closingC = openingC + inc - exp
    const isBase = m.currency === cur.base
    // 外币期初余额没有本位币金额，按期初所在期间汇率折算估算
    let initBase = m.init
    let estimated = false
    if (!isBase && m.init !== 0) {
      initBase = Math.round(m.init * resolveCashierRate(db, f.accountSetId, m.currency, f.startDate))
      estimated = true
    }
    const incBase = isBase ? inc : Number(r.inc_base || 0)
    const expBase = isBase ? exp : Number(r.exp_base || 0)
    const closingBase = isBase ? closingC : initBase + Number(r.before_base_net || 0) + incBase - expBase
    const row: BalanceReportRow = {
      account_code: m.code,
      account_name: nameOf.get(m.code) || m.code,
      currency: m.currency,
      opening: money(openingC), income: money(inc), expense: money(exp), closing: money(closingC),
      income_base: money(incBase), expense_base: money(expBase), closing_base: money(closingBase),
      base_estimated: estimated,
      count: Number(r.cnt || 0),
      unreconciled_count: Number(r.unrec_cnt || 0),
      unreconciled_net: money(Number(r.unrec_net || 0)),
    }
    const isZero = openingC === 0 && inc === 0 && exp === 0 && closingC === 0
    if (isZero && !opts.includeZero) { emptyAccounts++; continue }
    rows.push(row)
  }
  rows.sort((a, b) =>
    a.account_code.localeCompare(b.account_code) ||
    (a.currency === cur.base ? -1 : b.currency === cur.base ? 1 : a.currency.localeCompare(b.currency))
  )

  const totalsMap = new Map<string, BalanceReportTotal & { oc: number; ic: number; ec: number; cc: number }>()
  let baseInc = 0, baseExp = 0, baseClosing = 0
  for (const r of rows) {
    const t = totalsMap.get(r.currency) || { currency: r.currency, opening: 0, income: 0, expense: 0, closing: 0, count: 0, oc: 0, ic: 0, ec: 0, cc: 0 }
    t.oc += cents(r.opening); t.ic += cents(r.income); t.ec += cents(r.expense); t.cc += cents(r.closing); t.count += r.count
    totalsMap.set(r.currency, t)
    baseInc += cents(r.income_base); baseExp += cents(r.expense_base); baseClosing += cents(r.closing_base)
  }
  const totals = [...totalsMap.values()].map(t => ({
    currency: t.currency, opening: money(t.oc), income: money(t.ic), expense: money(t.ec), closing: money(t.cc), count: t.count,
  }))
  return {
    base_currency: cur.base,
    currency_mode: cur.all ? 'all' : 'single',
    rows, totals,
    total_base: { income: money(baseInc), expense: money(baseExp), closing: money(baseClosing) },
    empty_accounts: emptyAccounts,
  }
}

// ═══ 多维收支汇总 ═════════════════════════════════════════════════════════

export type SummaryDimension =
  | 'account' | 'currency' | 'year' | 'month' | 'day' | 'settle_type' | 'counter_account'
  | `aux:${string}`

export interface SummaryNode {
  /** 维度层级（0 起）；总计为 -1 */
  level: number
  /** 该层维度 */
  dimension: string
  key: string
  name: string
  income: number
  expense: number
  net: number
  count: number
  /** 占总计收入 / 支出的比例（0~1） */
  income_ratio: number
  expense_ratio: number
  /** 本节点的完整路径 key（钻取用） */
  path: Array<{ dimension: string; key: string }>
  children?: SummaryNode[]
}

export interface SummaryReport {
  base_currency: string
  currency_mode: 'single' | 'all'
  group_by: string[]
  root: SummaryNode
  /** 明细分组超限被截断 */
  truncated: boolean
}

const SUMMARY_MAX_LEAVES = 5000
const SUMMARY_MAX_DIMS = 4

function dimensionSql(dim: string, idx: number): { joins: string[]; key: string; name: string; params: any[] } | null {
  const a = `d${idx}`
  switch (dim) {
    case 'account':
      return { joins: [`LEFT JOIN v_cashier_account ${a} ON ${a}.account_set_id = j.account_set_id AND ${a}.code = j.account_code`],
        key: 'j.account_code', name: `COALESCE(${a}.name, j.account_code)`, params: [] }
    case 'currency':
      return { joins: [], key: 'j.currency', name: 'j.currency', params: [] }
    case 'year':
      return { joins: [], key: "strftime('%Y', j.biz_date)", name: "strftime('%Y', j.biz_date) || '年'", params: [] }
    case 'month':
      return { joins: [], key: "strftime('%Y-%m', j.biz_date)", name: "strftime('%Y-%m', j.biz_date)", params: [] }
    case 'day':
      return { joins: [], key: 'j.biz_date', name: 'j.biz_date', params: [] }
    case 'settle_type':
      return { joins: [`LEFT JOIN settle_type ${a} ON ${a}.account_set_id = j.account_set_id AND ${a}.code = j.settle_type`],
        key: "COALESCE(j.settle_type, '')", name: `COALESCE(${a}.name, NULLIF(j.settle_type, ''), '（未指定）')`, params: [] }
    case 'counter_account':
      return { joins: [`LEFT JOIN accounts ${a} ON ${a}.account_set_id = j.account_set_id AND ${a}.code = j.counter_account`],
        key: "COALESCE(j.counter_account, '')", name: `COALESCE(${a}.code || ' ' || ${a}.name, NULLIF(j.counter_account, ''), '（未指定）')`, params: [] }
    default:
      if (dim.startsWith('aux:')) {
        const catId = dim.slice(4)
        if (!catId) return null
        return {
          joins: [
            `LEFT JOIN cashier_journal_aux ${a}x ON ${a}x.journal_id = j.id AND ${a}x.category_id = ?`,
            `LEFT JOIN aux_items ${a}i ON ${a}i.id = ${a}x.item_id`,
          ],
          key: `COALESCE(${a}x.item_id, '')`,
          name: `COALESCE(${a}i.code || ' ' || ${a}i.name, ${a}x.item_id, '（未指定）')`,
          params: [catId],
        }
      }
      return null
  }
}

/** 多维汇总：维度可任意有序组合，返回逐级小计的树（含总计），金额先取整到分再累加 */
export function getSummaryReport(db: Db, f: CashierReportFilter, groupBy: string[]): SummaryReport {
  ensureCashierAccountSchema(db as any)
  const dims = groupBy.filter(Boolean)
  if (!dims.length) throw new Error('请至少选择一个汇总维度')
  if (dims.length > SUMMARY_MAX_DIMS) throw new Error(`汇总维度最多 ${SUMMARY_MAX_DIMS} 个`)
  if (new Set(dims).size !== dims.length) throw new Error('汇总维度不能重复')

  const cur = resolveReportCurrency(db, f)
  const { d: dCol, c: cCol } = amountColumns(cur.all)
  const where = buildJournalWhere(db, f)

  const specs = dims.map((dim, i) => {
    const s = dimensionSql(dim, i)
    if (!s) throw new Error(`不支持的汇总维度：${dim}`)
    return s
  })
  const joins = specs.flatMap(s => s.joins)
  const joinParams = specs.flatMap(s => s.params)
  const selectDims = specs.map((s, i) => `${s.key} AS k${i}, ${s.name} AS n${i}`).join(', ')
  const groupCols = specs.map((_, i) => `k${i}`).join(', ')
  const voucherJoin = where.needVoucherJoin ? 'LEFT JOIN vouchers v ON v.id = j.voucher_id' : ''

  const rows = db.prepare(`
    SELECT ${selectDims},
      CAST(COALESCE(SUM(ROUND(${dCol} * 100)), 0) AS INTEGER) AS inc,
      CAST(COALESCE(SUM(ROUND(${cCol} * 100)), 0) AS INTEGER) AS exp,
      COUNT(*) AS cnt
    FROM cashier_journal j
    ${joins.join('\n    ')}
    ${voucherJoin}
    WHERE ${where.conds.join(' AND ')}
    GROUP BY ${groupCols}
    ORDER BY ${dims.map((d, i) => (d.startsWith('aux:') ? `n${i}` : `k${i}`)).join(', ')}
    LIMIT ${SUMMARY_MAX_LEAVES + 1}
  `).all(...joinParams, ...where.params) as any[]

  const truncated = rows.length > SUMMARY_MAX_LEAVES
  if (truncated) rows.pop()

  type Acc = { key: string; name: string; inc: number; exp: number; cnt: number; children: Map<string, Acc> }
  const mk = (key: string, name: string): Acc => ({ key, name, inc: 0, exp: 0, cnt: 0, children: new Map() })
  const root = mk('', '合计')
  for (const r of rows) {
    root.inc += r.inc; root.exp += r.exp; root.cnt += r.cnt
    let node = root
    for (let i = 0; i < dims.length; i++) {
      const key = String(r[`k${i}`] ?? '')
      let child = node.children.get(key)
      if (!child) { child = mk(key, String(r[`n${i}`] ?? key)); node.children.set(key, child) }
      child.inc += r.inc; child.exp += r.exp; child.cnt += r.cnt
      node = child
    }
  }

  const build = (acc: Acc, level: number, path: SummaryNode['path']): SummaryNode => {
    const node: SummaryNode = {
      level,
      dimension: level >= 0 ? dims[level] : '',
      key: acc.key, name: acc.name,
      income: money(acc.inc), expense: money(acc.exp), net: money(acc.inc - acc.exp), count: acc.cnt,
      income_ratio: root.inc ? acc.inc / root.inc : 0,
      expense_ratio: root.exp ? acc.exp / root.exp : 0,
      path,
    }
    if (acc.children.size) {
      node.children = [...acc.children.values()].map(c =>
        build(c, level + 1, [...path, { dimension: dims[level + 1], key: c.key }])
      )
    }
    return node
  }
  return {
    base_currency: cur.base,
    currency_mode: cur.all ? 'all' : 'single',
    group_by: dims,
    root: build(root, -1, []),
    truncated,
  }
}

// ═══ 动态筛选元数据 ═══════════════════════════════════════════════════════

export interface ReportFilterMeta {
  aux_categories: Array<{ id: string; code: string; name: string; journal_count: number; item_count: number }>
  settle_types: Array<{ code: string; name: string; count: number }>
  counter_accounts: Array<{ code: string; name: string; count: number }>
}

/** 本账套出纳流水里实际出现过的辅助类别 / 结算方式 / 对方科目（按科目授权收敛），供筛选面板动态加载 */
export function getReportFilterMeta(db: Db, accountSetId: string, scope?: AccountScopeContext): ReportFilterMeta {
  const conds = ['j.account_set_id = ?']
  const params: any[] = [accountSetId]
  appendCashierCodeScopeCondition(scope, accountSetId, 'j.account_code', conds, params)
  const where = conds.join(' AND ')

  const aux = db.prepare(`
    SELECT c.id, c.code, c.name, COUNT(*) AS journal_count, COUNT(DISTINCT ax.item_id) AS item_count
    FROM cashier_journal_aux ax
    JOIN cashier_journal j ON j.id = ax.journal_id
    JOIN aux_categories c ON c.id = ax.category_id
    WHERE ${where}
    GROUP BY c.id, c.code, c.name
    ORDER BY c.sort_order, c.code
  `).all(...params) as any[]

  const settle = db.prepare(`
    SELECT COALESCE(j.settle_type, '') AS code, COALESCE(st.name, NULLIF(j.settle_type, ''), '（未指定）') AS name, COUNT(*) AS count
    FROM cashier_journal j
    LEFT JOIN settle_type st ON st.account_set_id = j.account_set_id AND st.code = j.settle_type
    WHERE ${where}
    GROUP BY j.settle_type, st.name
    ORDER BY code
  `).all(...params) as any[]

  const counter = db.prepare(`
    SELECT j.counter_account AS code, COALESCE(a.name, j.counter_account) AS name, COUNT(*) AS count
    FROM cashier_journal j
    LEFT JOIN accounts a ON a.account_set_id = j.account_set_id AND a.code = j.counter_account
    WHERE ${where} AND j.counter_account IS NOT NULL AND j.counter_account <> ''
    GROUP BY j.counter_account, a.name
    ORDER BY j.counter_account
    LIMIT 500
  `).all(...params) as any[]

  return { aux_categories: aux, settle_types: settle, counter_accounts: counter }
}

// ═══ 单据综合查询（统一过滤 + 全量合计 + 辅助列） ═══════════════════════════

export interface SearchRow {
  id: string
  account_code: string
  account_name: string
  currency: string
  biz_date: string
  seq: number
  summary: string | null
  debit: number
  credit: number
  base_debit: number
  base_credit: number
  settle_type: string | null
  settle_type_name: string | null
  bill_no: string | null
  counter_unit: string | null
  counter_account: string | null
  counter_account_name: string | null
  aux_text: string | null
  reconciled: number
  voucher_id: string | null
  voucher_no: number | null
  voucher_year: number | null
  voucher_month: number | null
  voucher_status: string | null
  /** 来源收付款单（收付款单审核写入的流水） */
  scm_doc_type?: string | null
  scm_doc_no?: string | null
  /** 按辅助类别拆开的值：{ 类别id: 项目名 } */
  aux_values?: Record<string, string>
}

export interface SearchResult {
  list: SearchRow[]
  total: number
  /** 全量合计（不受分页影响），按所选金额口径 */
  totals: { income: number; expense: number; count: number }
  currency_mode: 'single' | 'all'
  base_currency: string
  /** 当前筛选全集里出现过的辅助类别，页面按类别动态拆列 */
  aux_columns: AuxColumn[]
}

export function searchJournalsReport(db: Db, f: CashierReportFilter, page = 1, pageSize = 100): SearchResult {
  ensureCashierAccountSchema(db as any)
  const cur = resolveReportCurrency(db, f)
  const { d: dCol, c: cCol } = amountColumns(cur.all)
  const where = buildJournalWhere(db, f)
  const voucherJoin = 'LEFT JOIN vouchers v ON v.id = j.voucher_id'
  // 合计 / 计数不需要其它联表，只在凭证状态过滤时联 vouchers
  const countJoin = where.needVoucherJoin ? voucherJoin : ''
  const agg = db.prepare(`
    SELECT COUNT(*) AS total,
      CAST(COALESCE(SUM(ROUND(${dCol} * 100)), 0) AS INTEGER) AS inc,
      CAST(COALESCE(SUM(ROUND(${cCol} * 100)), 0) AS INTEGER) AS exp
    FROM cashier_journal j ${countJoin}
    WHERE ${where.conds.join(' AND ')}
  `).get(...where.params) as { total: number; inc: number; exp: number }

  const p = Math.max(1, Math.trunc(Number(page)) || 1)
  const size = Math.min(2000, Math.max(1, Math.trunc(Number(pageSize)) || 100))
  const list = db.prepare(`
    SELECT j.id, j.account_code, COALESCE(a.name, j.account_code) AS account_name, j.currency, j.biz_date, j.seq, j.summary,
      j.debit, j.credit, j.base_debit, j.base_credit, j.settle_type, st.name AS settle_type_name, j.bill_no, j.counter_unit,
      j.counter_account, ca.name AS counter_account_name, j.reconciled, j.voucher_id, j.voucher_no, j.voucher_year, j.voucher_month,
      v.status AS voucher_status,
      ${hasScmArApLog(db) ? `(SELECT sl.doc_type FROM scm_ar_ap_log sl WHERE sl.account_set_id = j.account_set_id AND sl.cashier_journal_id = j.id AND sl.doc_type IN ('RCV','PAY') LIMIT 1) AS scm_doc_type,
      (SELECT sl.doc_no FROM scm_ar_ap_log sl WHERE sl.account_set_id = j.account_set_id AND sl.cashier_journal_id = j.id AND sl.doc_type IN ('RCV','PAY') LIMIT 1) AS scm_doc_no,` : ''}
      (SELECT group_concat(ac.name || ':' || COALESCE(ai.name, ax.item_id), '；')
         FROM cashier_journal_aux ax
         JOIN aux_categories ac ON ac.id = ax.category_id
         LEFT JOIN aux_items ai ON ai.id = ax.item_id
        WHERE ax.journal_id = j.id) AS aux_text
    FROM cashier_journal j
    LEFT JOIN v_cashier_account a ON a.account_set_id = j.account_set_id AND a.code = j.account_code
    LEFT JOIN accounts ca ON ca.account_set_id = j.account_set_id AND ca.code = j.counter_account
    LEFT JOIN settle_type st ON st.account_set_id = j.account_set_id AND st.code = j.settle_type
    ${voucherJoin}
    WHERE ${where.conds.join(' AND ')}
    ORDER BY j.biz_date DESC, j.seq DESC, j.created_at DESC
    LIMIT ${size} OFFSET ${(p - 1) * size}
  `).all(...where.params) as SearchRow[]

  attachAuxValues(db, list)
  const auxColumns = listAuxColumns(
    db, f.accountSetId,
    `SELECT 1 FROM cashier_journal j ${countJoin} WHERE j.id = ax.journal_id AND ${where.conds.join(' AND ')}`,
    where.params
  )

  return {
    list,
    total: agg.total,
    totals: { income: money(agg.inc), expense: money(agg.exp), count: agg.total },
    currency_mode: cur.all ? 'all' : 'single',
    base_currency: cur.base,
    aux_columns: auxColumns,
  }
}

// ═══ 出纳流水账：表头明细筛选（逐行余额仍为全量余额） ═══════════════════════

/** 流水账表头筛选里出现的明细条件（其余账户 / 日期 / 币种条件由流水账自己的参数决定） */
export function hasJournalDetailFilter(f: Partial<CashierReportFilter>): boolean {
  return !!(
    f.summary || f.billNo || f.counterUnit ||
    f.counterAccounts?.length || f.settleTypes?.length ||
    f.aux?.some(a => a.categoryId) || f.voucherStatus?.length ||
    f.reconciled === 0 || f.reconciled === 1
  )
}

/**
 * 在 listJournal 的基础结果上套明细筛选：只列出命中行，但每行余额仍是它在**完整流水**里的真实余额
 * （期初 + 该行之前含本行的全部流水净额），所以筛选后余额不会失真；期初 / 期末保持全量。
 * 逐行累计用窗口函数在 (账套, 科目, 币种, 日期区间) 范围内一次算出，只在有筛选条件时才走这条路径。
 *
 * @param base 不带明细筛选的 listJournal 结果（取期初 / 期末 / 币种 / 辅助列 / 全量合计）
 */
export function listJournalFiltered<B extends {
  opening: number
  currency: string
  totalDebit: number
  totalCredit: number
  totalBaseDebit: number
  totalBaseCredit: number
}>(
  db: Db,
  params: { accountSetId: string; accountCode: string; startDate?: string; endDate?: string; page?: number; pageSize?: number; sortOrder?: 'asc' | 'desc' },
  detail: CashierReportFilter,
  base: B
): B & { rows: JournalRow[]; total: number; page: number; pageSize: number; filtered: true; filteredTotalDebit: number; filteredTotalCredit: number } {
  const where = buildJournalWhere(db, { ...detail, accountSetId: params.accountSetId, accountCodes: undefined, currency: undefined }, { skipDate: true, skipCurrency: true })
  const voucherJoin = where.needVoucherJoin ? 'LEFT JOIN vouchers v ON v.id = j.voucher_id' : ''

  const baseConds = ['cj.account_set_id = ?', 'cj.account_code = ?', 'cj.currency = ?']
  const baseParams: any[] = [params.accountSetId, params.accountCode, base.currency]
  if (params.startDate) { baseConds.push('cj.biz_date >= ?'); baseParams.push(params.startDate) }
  if (params.endDate) { baseConds.push('cj.biz_date <= ?'); baseParams.push(params.endDate) }
  const windowed = `(
    SELECT cj.*, SUM(ROUND(cj.debit * 100) - ROUND(cj.credit * 100)) OVER (
      ORDER BY cj.biz_date, cj.seq, cj.created_at, cj.id ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    ) AS run_cents
    FROM cashier_journal cj WHERE ${baseConds.join(' AND ')}
  )`

  const agg = db.prepare(`
    SELECT COUNT(*) AS n,
      COALESCE(SUM(ROUND(j.debit * 100)), 0) AS d, COALESCE(SUM(ROUND(j.credit * 100)), 0) AS c
    FROM cashier_journal j ${voucherJoin}
    WHERE j.account_code = ? AND j.currency = ?${params.startDate ? ' AND j.biz_date >= ?' : ''}${params.endDate ? ' AND j.biz_date <= ?' : ''}
      AND ${where.conds.join(' AND ')}
  `).get(
    params.accountCode, base.currency,
    ...(params.startDate ? [params.startDate] : []), ...(params.endDate ? [params.endDate] : []),
    ...where.params
  ) as { n: number; d: number; c: number }

  const pageSize = Math.min(1000, Math.max(1, Math.trunc(Number(params.pageSize) || 100)))
  const page = Math.max(1, Math.trunc(Number(params.page) || 1))
  const openingCents = Math.round(base.opening * 100)
  const rows = (db.prepare(`
    SELECT j.*, v.status AS voucher_status FROM ${windowed} j
    LEFT JOIN vouchers v ON v.id = j.voucher_id
    WHERE ${where.conds.join(' AND ')}
    ${params.sortOrder === 'desc' ? 'ORDER BY j.biz_date DESC, j.seq DESC, j.created_at DESC, j.id DESC' : 'ORDER BY j.biz_date, j.seq, j.created_at, j.id'}
    LIMIT ? OFFSET ?
  `).all(...baseParams, ...where.params, pageSize, (page - 1) * pageSize) as any[]).map(r => {
    const { run_cents, ...rest } = r
    return { ...rest, balance: (openingCents + Number(run_cents)) / 100 }
  }) as JournalRow[]
  enrichJournalRows(db, params.accountSetId, rows)

  return {
    ...base,
    rows,
    total: agg.n,
    page,
    pageSize,
    filtered: true,
    // 筛选后的合计单独给出；base 里的 totalDebit / totalCredit 保持全量，期末 = 期初 + 全量借 − 全量贷
    filteredTotalDebit: agg.d / 100,
    filteredTotalCredit: agg.c / 100,
  }
}
