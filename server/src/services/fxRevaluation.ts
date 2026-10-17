import { v4 as uuidv4 } from 'uuid'
import type { Database } from 'better-sqlite3'
import {
  buildVoucherEntryPayloads,
  VOUCHER_ENTRY_INSERT_SQL,
  calculateVoucherTotals,
  getNextVoucherNo,
  getPeriodClosingRecord,
  isPeriodClosed,
  loadVoucherAuxiliaryData,
  type VoucherEntryInput,
} from './voucherEntry.js'
import {
  applyVoucherPosting,
  applyVoucherUnpost,
  loadVoucherEntries,
  type VoucherLike,
} from './voucherPosting.js'
import { buildForeignBalanceQuery } from './ledgerQuery.js'
import { hasPreBookColumns, hasForeignPreBookColumns, resolveOpeningBaseYear } from './initBalanceScope.js'
import { peekAccountSetStartDate } from './accountSetDefaults.js'
import { getGlStartDateError } from './voucherMutationGuard.js'
import { getAutoTransferVoucherDate, validateAutoTransferPeriod } from './autoTransfer.js'

export const FX_REVAL_SOURCE = 'fx_reval'

/** 与 amountUtils.MONEY_EPSILON 同量级：小于半分的差额视为无需调汇 */
const ADJUSTMENT_EPSILON = 0.005

/**
 * 期末汇率的取值来源。用户常在「外币类型」页改了期末汇率却发现调汇没变化——
 * 原因是该期间在「汇率明细」（exchange_rates）里有记录，优先级更高把它盖住了。
 * 把来源一路带到界面上，省得再靠猜。
 */
export type FxRateSource =
  | 'base'
  | 'period-closing'
  | 'period-rate'
  | 'currency-end'
  | 'nearest-period'
  | 'default'

export interface FxRevaluationRow {
  account_id: string
  account_code: string
  account_name: string
  direction: 'debit' | 'credit'
  currency_code: string
  /** 原币期末余额（按科目方向的有符号数） */
  foreign_end_balance: number
  /** 账面本位币期末余额（按科目方向的有符号数） */
  book_base_balance: number
  closing_rate: number
  closing_rate_source: FxRateSource
  revalued_base_balance: number
  /** 重估 - 账面；> 0 表示本位币余额需按科目方向增加 */
  adjustment: number
  /** 外币科目这一侧的分录方向；null 表示无需调汇 */
  entry_direction: 'debit' | 'credit' | null
  /** 跳过原因（原币数据不完整等），有值时不生成分录 */
  skip_reason: string | null
  /** 带辅助核算的科目按辅助项目拆分后，该行对应的辅助项目（如「往来单位：某某公司」） */
  aux_label?: string
}

export interface FxRevaluationPreview {
  year: number
  period: number
  closed: boolean
  alreadyGenerated: boolean
  existingRun: FxRevaluationRunInfo | null
  blockedReason: string | null
  /** 本期未过账凭证数（不含调汇凭证自身）；> 0 时不允许调汇 */
  unpostedVoucherCount: number
  gainAccount: { id: string; code: string; name: string; direction: 'debit' | 'credit' } | null
  rows: FxRevaluationRow[]
  entries: VoucherEntryInput[]
  totalGain: number
  totalLoss: number
}

export interface FxRevaluationRunInfo {
  id: string
  voucher_id: string
  voucher_no: string | null
  voucher_date: string | null
  status: string | null
  total_amount: number
  created_by: string | null
  created_at: string
}

type Db = Database

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

function isSqliteConstraintError(error: any) {
  const code = String(error?.code || '')
  const message = String(error?.message || '')
  return code.startsWith('SQLITE_CONSTRAINT') || message.includes('SQLITE_CONSTRAINT')
}

function isForeignCurrencyEnabledDb(db: Db, accountSetId: string): boolean {
  const row = db
    .prepare(
      `SELECT param_value FROM system_params WHERE account_set_id = ? AND param_key = 'enable_foreign_currency' LIMIT 1`
    )
    .get(accountSetId) as { param_value?: string } | undefined
  return row?.param_value === 'true'
}

function isAuxAccount(db: Db, accountSetId: string, accountId: string): boolean {
  const row = db
    .prepare(`SELECT is_aux, aux_types FROM accounts WHERE id = ? AND account_set_id = ?`)
    .get(accountId, accountSetId) as { is_aux?: number; aux_types?: string | null } | undefined
  return Boolean(row?.is_aux) && loadAccountAuxCategories(db, accountSetId, row?.aux_types ?? null).length > 0
}

function loadGainAccount(db: Db, accountSetId: string) {
  const param = db
    .prepare(
      `SELECT param_value FROM system_params WHERE account_set_id = ? AND param_key = 'exchange_gain_account_code' LIMIT 1`
    )
    .get(accountSetId) as { param_value?: string } | undefined
  const code = String(param?.param_value || '').trim()
  if (!code) return null
  const acc = db
    .prepare(
      `SELECT id, code, name, direction FROM accounts WHERE account_set_id = ? AND code = ? LIMIT 1`
    )
    .get(accountSetId, code) as
    | { id: string; code: string; name: string; direction: 'debit' | 'credit' }
    | undefined
  return acc || null
}

/**
 * 期末汇率回退链：本期 exchange_rates.closing_rate → 本期 rate → currencies.end_rate → 最近一期 rate → default_rate → 1
 * 与 resolveExchangeRate 的区别：优先使用按期间维护的「期末汇率」列。
 */
export function resolveClosingExchangeRateWithSource(
  db: Db,
  accountSetId: string,
  currencyCode: string,
  year: number,
  period: number
): { rate: number; source: FxRateSource } {
  const code = String(currencyCode || '').trim().toUpperCase()
  if (!code) return { rate: 1, source: 'base' }
  const currency = db
    .prepare(`SELECT is_base, end_rate, default_rate FROM currencies WHERE account_set_id = ? AND UPPER(code) = ?`)
    .get(accountSetId, code) as
    | { is_base?: number; end_rate?: number | null; default_rate?: number | null }
    | undefined
  if (currency?.is_base) return { rate: 1, source: 'base' }

  const exact = db
    .prepare(
      `SELECT rate, closing_rate FROM exchange_rates
       WHERE account_set_id = ? AND UPPER(currency_code) = ? AND year = ? AND period = ?`
    )
    .get(accountSetId, code, year, period) as
    | { rate?: number | null; closing_rate?: number | null }
    | undefined
  if (exact?.closing_rate != null && Number(exact.closing_rate) > 0) {
    return { rate: Number(exact.closing_rate), source: 'period-closing' }
  }
  if (exact?.rate != null && Number(exact.rate) > 0) {
    return { rate: Number(exact.rate), source: 'period-rate' }
  }

  if (currency?.end_rate != null && Number(currency.end_rate) > 0) {
    return { rate: Number(currency.end_rate), source: 'currency-end' }
  }

  const nearest = db
    .prepare(
      `SELECT rate FROM exchange_rates
       WHERE account_set_id = ? AND UPPER(currency_code) = ?
         AND (year < ? OR (year = ? AND period <= ?))
       ORDER BY year DESC, period DESC LIMIT 1`
    )
    .get(accountSetId, code, year, year, period) as { rate?: number | null } | undefined
  if (nearest?.rate != null && Number(nearest.rate) > 0) {
    return { rate: Number(nearest.rate), source: 'nearest-period' }
  }

  if (currency?.default_rate != null && Number(currency.default_rate) > 0) {
    return { rate: Number(currency.default_rate), source: 'default' }
  }
  return { rate: 1, source: 'default' }
}

/** 只要汇率数值的薄封装（外币余额表等调用点用它，签名保持不变） */
export function resolveClosingExchangeRate(
  db: Db,
  accountSetId: string,
  currencyCode: string,
  year: number,
  period: number
): number {
  return resolveClosingExchangeRateWithSource(db, accountSetId, currencyCode, year, period).rate
}

export function getFxRevaluationRun(params: {
  db: Db
  accountSetId: string
  year: number
  period: number
}): FxRevaluationRunInfo | null {
  const row = params.db
    .prepare(
      `SELECT r.id, r.voucher_id, r.created_by, r.created_at,
              v.voucher_no, v.voucher_date, v.status, v.total_amount
       FROM fx_revaluation_runs r
       LEFT JOIN vouchers v ON v.id = r.voucher_id
       WHERE r.account_set_id = ? AND r.year = ? AND r.period = ?`
    )
    .get(params.accountSetId, params.year, params.period) as any
  if (!row) return null
  return {
    id: row.id,
    voucher_id: row.voucher_id,
    voucher_no: row.voucher_no ?? null,
    voucher_date: row.voucher_date ?? null,
    status: row.status ?? null,
    total_amount: Number(row.total_amount) || 0,
    created_by: row.created_by ?? null,
    created_at: row.created_at,
  }
}

export function getFxRevaluationStatus(params: {
  db: Db
  accountSetId: string
  year: number
  period: number
}) {
  const closingRecord = getPeriodClosingRecord(params)
  const closed = isPeriodClosed(closingRecord)
  const existingRun = getFxRevaluationRun(params)
  return {
    closed,
    existingRun,
    alreadyGenerated: Boolean(existingRun),
    canRevoke: Boolean(existingRun) && !closed,
    unpostedVoucherCount: countUnpostedVouchers(params),
  }
}

/**
 * 本期未过账凭证数。调汇基数只算已过账凭证（`includeUnposted: false`），
 * 所以没记完账就调汇会按不完整的余额算差额，必须拦下。
 *
 * 刻意排除调汇凭证自身：它以 `'audited'` 落库后在同一事务里立刻过账，正常流程下不会被统计到，
 * 但这条排除保证「先插入、后过账」这个中间态或将来拆分过账时，页面不会自打嘴巴说
 * 「本期还有 1 张凭证未记账」而把用户锁死在无法反调汇的死角。
 */
function countUnpostedVouchers(params: {
  db: Db
  accountSetId: string
  year: number
  period: number
}): number {
  const row = params.db
    .prepare(
      `SELECT COUNT(*) AS n FROM vouchers
       WHERE account_set_id = ? AND year = ? AND period = ?
         AND status IN ('draft', 'audited')
         AND COALESCE(source, '') != ?`
    )
    .get(params.accountSetId, params.year, params.period, FX_REVAL_SOURCE) as { n?: number } | undefined
  return Number(row?.n) || 0
}

interface AuxSplitPart {
  ids: Record<string, string>
  label: string
  foreign: number
  base: number
}

/** 科目启用的辅助类目（按 aux_types 声明顺序）：[{ id, code, name }] */
function loadAccountAuxCategories(db: Db, accountSetId: string, auxTypes: string | null) {
  if (!auxTypes) return []
  let ids: string[] = []
  try {
    ids = Object.keys(JSON.parse(auxTypes) || {})
  } catch {
    return []
  }
  const cats: Array<{ id: string; code: string; name: string }> = []
  for (const id of ids) {
    const c = db
      .prepare(`SELECT id, code, name FROM aux_categories WHERE id = ? AND account_set_id = ?`)
      .get(id, accountSetId) as { id: string; code: string; name: string } | undefined
    if (c) cats.push(c)
  }
  return cats
}

/**
 * 带辅助核算的外币科目：按辅助项目（组合）汇总已记账原币 / 本位币余额（按科目方向取正向）。
 * 期初取 init_balances 的辅助明细行（仅单类目科目），之后累加基准年年初至期末的已记账分录。
 * 调用方会再与科目级余额核对，对不上时回退为按原币余额比例分摊，保证合计与科目级调汇额一致。
 */
function loadAuxSplitParts(params: {
  db: Db
  accountSetId: string
  accountId: string
  direction: 'debit' | 'credit'
  cats: Array<{ id: string; code: string; name: string }>
  baseYear: number
  periodEnd: string
}): AuxSplitPart[] {
  const { db, accountSetId, accountId, direction, cats } = params
  const parts = new Map<string, AuxSplitPart>()
  const itemNameCache = new Map<string, string>()
  const itemName = (id: string) => {
    if (!itemNameCache.has(id)) {
      const row = db.prepare(`SELECT name FROM aux_items WHERE id = ?`).get(id) as { name?: string } | undefined
      itemNameCache.set(id, row?.name || id)
    }
    return itemNameCache.get(id)!
  }
  const bucket = (ids: Record<string, string>) => {
    const key = cats.map(c => ids[c.code] || '').join('|')
    let part = parts.get(key)
    if (!part) {
      const label = cats.map(c => `${c.name}：${itemName(ids[c.code])}`).join('，')
      part = { ids, label, foreign: 0, base: 0 }
      parts.set(key, part)
    }
    return part
  }
  const sign = (d: string) => (d === direction ? 1 : -1)

  if (cats.length === 1) {
    const initRows = db
      .prepare(
        `SELECT aux_item_id, init_balance, init_debit, init_credit,
                foreign_init_balance, foreign_opening_debit, foreign_opening_credit
         FROM init_balances
         WHERE account_set_id = ? AND account_id = ? AND year = ? AND COALESCE(aux_item_id, '') != ''`
      )
      .all(accountSetId, accountId, params.baseYear) as any[]
    for (const r of initRows) {
      const itemId = String(r.aux_item_id).split('|')[0].split(':').pop() || ''
      if (!itemId) continue
      const base =
        Number(r.init_debit) || Number(r.init_credit)
          ? (direction === 'debit' ? 1 : -1) * ((Number(r.init_debit) || 0) - (Number(r.init_credit) || 0))
          : Number(r.init_balance) || 0
      const foreign =
        Number(r.foreign_opening_debit) || Number(r.foreign_opening_credit)
          ? (direction === 'debit' ? 1 : -1) * ((Number(r.foreign_opening_debit) || 0) - (Number(r.foreign_opening_credit) || 0))
          : Number(r.foreign_init_balance) || 0
      if (!base && !foreign) continue
      const part = bucket({ [cats[0].code]: itemId })
      part.base = round2(part.base + base)
      part.foreign = round2(part.foreign + foreign)
    }
  }

  const entryRows = db
    .prepare(
      `SELECT ve.direction, ve.amount, ve.foreign_amount, ve.aux_data
       FROM voucher_entries ve JOIN vouchers v ON v.id = ve.voucher_id
       WHERE ve.account_set_id = ? AND ve.account_id = ? AND v.status = 'posted'
         AND v.voucher_date >= ? AND v.voucher_date <= ?`
    )
    .all(accountSetId, accountId, `${params.baseYear}-01-01`, params.periodEnd) as any[]
  for (const e of entryRows) {
    let aux: Record<string, { id?: string }> = {}
    try {
      aux = e.aux_data ? JSON.parse(e.aux_data) : {}
    } catch {
      aux = {}
    }
    const ids: Record<string, string> = {}
    for (const c of cats) ids[c.code] = String(aux[c.code]?.id || '')
    const part = bucket(ids)
    part.base = round2(part.base + sign(e.direction) * (Number(e.amount) || 0))
    part.foreign = round2(part.foreign + sign(e.direction) * (Number(e.foreign_amount) || 0))
  }
  return [...parts.values()].filter(p => Math.abs(p.base) >= ADJUSTMENT_EPSILON || Math.abs(p.foreign) >= ADJUSTMENT_EPSILON)
}

/**
 * 预览期末调汇：对每个外币科目，按期末汇率重估本位币余额，差额进汇兑损益科目。
 * 原币不变，所以生成的分录不带 currency_code / exchange_rate / foreign_amount。
 */
export function previewFxRevaluation(params: {
  db: Db
  accountSetId: string
  year: number
  period: number
}): FxRevaluationPreview {
  const { db, accountSetId, year, period } = params
  const status = getFxRevaluationStatus(params)
  const gainAccount = loadGainAccount(db, accountSetId)

  const base: FxRevaluationPreview = {
    year,
    period,
    closed: status.closed,
    alreadyGenerated: status.alreadyGenerated,
    existingRun: status.existingRun,
    blockedReason: null,
    unpostedVoucherCount: status.unpostedVoucherCount,
    gainAccount,
    rows: [],
    entries: [],
    totalGain: 0,
    totalLoss: 0,
  }

  if (!isForeignCurrencyEnabledDb(db, accountSetId)) {
    base.blockedReason = '账套未启用外币核算'
    return base
  }
  if (!gainAccount) {
    base.blockedReason = '未设置汇兑损益科目，请先到「外币类型」页面配置'
    return base
  }

  if (isAuxAccount(db, accountSetId, gainAccount.id)) {
    base.blockedReason = '汇兑损益科目不能启用辅助核算，请到「外币类型」页面改选科目'
    return base
  }

  // 外币余额表已统一为凭证明细口径，这里按「期间首末日 + 仅已记账」调用，
  // 与改造前读 account_balances（过账后余额）的语义等价。
  const periodStart = `${year}-${String(period).padStart(2, '0')}-01`
  const periodEnd = `${year}-${String(period).padStart(2, '0')}-${String(new Date(year, period, 0).getDate()).padStart(2, '0')}`
  const query = buildForeignBalanceQuery({
    accountSetId,
    startDate: periodStart,
    endDate: periodEnd,
    includeUnposted: false,
    accountSetStartDate: peekAccountSetStartDate(db as any, accountSetId),
    preBookEnabled: hasPreBookColumns(db as any),
    foreignPreBookEnabled: hasForeignPreBookColumns(db as any),
    resolveOpeningBaseYear: year => resolveOpeningBaseYear(db as any, accountSetId, year),
  })
  const balanceRows = db.prepare(query.sql).all(...query.params) as Array<{
    account_id: string
    account_code: string
    account_name: string
    direction: 'debit' | 'credit'
    currency_code: string | null
    foreign_end_balance: number | null
    end_balance: number | null
  }>

  // 只对末级科目调汇，避免父子科目重复
  const leafSet = new Set(
    (
      db
        .prepare(
          `SELECT a.id FROM accounts a
           WHERE a.account_set_id = ? AND a.is_foreign = 1
             AND NOT EXISTS (SELECT 1 FROM accounts c WHERE c.parent_id = a.id AND c.account_set_id = a.account_set_id)`
        )
        .all(accountSetId) as Array<{ id: string }>
    ).map(r => r.id)
  )

  const rows: FxRevaluationRow[] = []
  const entries: VoucherEntryInput[] = []
  let totalGain = 0
  let totalLoss = 0

  for (const r of balanceRows) {
    if (!leafSet.has(r.account_id)) continue
    if (r.account_id === gainAccount.id) continue
    const currency = String(r.currency_code || '').trim().toUpperCase()
    if (!currency) continue

    const foreignEnd = Number(r.foreign_end_balance) || 0
    const bookBase = round2(Number(r.end_balance) || 0)
    // 原币与本位币都为零的科目本期没有余额，不进入调汇清单
    if (Math.abs(foreignEnd) < ADJUSTMENT_EPSILON && Math.abs(bookBase) < ADJUSTMENT_EPSILON) continue
    const { rate, source: rateSource } = resolveClosingExchangeRateWithSource(
      db,
      accountSetId,
      currency,
      year,
      period
    )
    const revalued = round2(foreignEnd * rate)
    const adjustment = round2(revalued - bookBase)

    // 科目是后来才勾成外币核算的：历史本位币有余额但原币为 0，按字面重估会把整笔余额冲成汇兑损益。
    // 这是原币数据缺失而不是汇率变动，跳过并提示补录原币期初/凭证。
    let accountSkipReason: string | null = null
    if (Math.abs(foreignEnd) < ADJUSTMENT_EPSILON && Math.abs(bookBase) >= ADJUSTMENT_EPSILON) {
      accountSkipReason = '原币余额为 0 但本位币有余额，原币数据不完整，已跳过'
    }

    // 带辅助核算的科目：凭证分录必须带齐辅助项目，否则过账校验会拒绝。按辅助项目拆开分别重估。
    interface Part {
      auxIds?: Record<string, string>
      auxLabel?: string
      foreign: number
      book: number
      revalued: number
      adjustment: number
      skipReason: string | null
    }
    let parts: Part[] = [
      { foreign: foreignEnd, book: bookBase, revalued, adjustment, skipReason: accountSkipReason },
    ]
    const accMeta = db
      .prepare(`SELECT is_aux, aux_types FROM accounts WHERE id = ? AND account_set_id = ?`)
      .get(r.account_id, accountSetId) as { is_aux?: number; aux_types?: string | null } | undefined
    const auxCats = accMeta?.is_aux ? loadAccountAuxCategories(db, accountSetId, accMeta.aux_types ?? null) : []
    if (auxCats.length > 0 && !accountSkipReason) {
      const auxParts = loadAuxSplitParts({
        db,
        accountSetId,
        accountId: r.account_id,
        direction: r.direction,
        cats: auxCats,
        baseYear: resolveOpeningBaseYear(db as any, accountSetId, year),
        periodEnd,
      })
      const sumForeign = round2(auxParts.reduce((t, p) => t + p.foreign, 0))
      const sumBook = round2(auxParts.reduce((t, p) => t + p.base, 0))
      const missingAux = auxParts.some(p => auxCats.some(c => !p.ids[c.code]))
      const consistent =
        Math.abs(sumForeign - foreignEnd) < ADJUSTMENT_EPSILON && Math.abs(sumBook - bookBase) < ADJUSTMENT_EPSILON
      if (auxParts.length === 0 || missingAux) {
        parts = [
          { ...parts[0], skipReason: '该科目启用了辅助核算，但余额缺少辅助项目（如期初未按辅助项目录入），无法拆分调汇，已跳过' },
        ]
      } else if (consistent) {
        // 与科目级余额一致：每个辅助项目各自按期末汇率重估
        parts = auxParts.map(ap => {
          const apRevalued = round2(ap.foreign * rate)
          const missing = Math.abs(ap.foreign) < ADJUSTMENT_EPSILON && Math.abs(ap.base) >= ADJUSTMENT_EPSILON
          return {
            auxIds: ap.ids,
            auxLabel: ap.label,
            foreign: ap.foreign,
            book: ap.base,
            revalued: apRevalued,
            adjustment: round2(apRevalued - ap.base),
            skipReason: missing ? '原币余额为 0 但本位币有余额，原币数据不完整，已跳过' : null,
          }
        })
      } else if (Math.abs(sumForeign) >= ADJUSTMENT_EPSILON && Math.abs(adjustment) >= ADJUSTMENT_EPSILON) {
        // 辅助项目余额与科目级对不上（如存在账前发生额）：科目级调汇额按各项目原币余额比例分摊，合计不变
        let allocated = 0
        const sorted = [...auxParts].sort((x, y) => Math.abs(y.foreign) - Math.abs(x.foreign))
        parts = sorted.map((ap, i) => {
          const share =
            i === sorted.length - 1 ? round2(adjustment - allocated) : round2((adjustment * ap.foreign) / sumForeign)
          allocated = round2(allocated + share)
          return {
            auxIds: ap.ids,
            auxLabel: ap.label,
            foreign: ap.foreign,
            book: ap.base,
            revalued: round2(ap.base + share),
            adjustment: share,
            skipReason: null,
          }
        })
      } else {
        parts = [{ ...parts[0], skipReason: '辅助项目余额与科目余额不一致，无法拆分调汇，已跳过' }]
      }
    }

    for (const part of parts) {
      let entryDirection: 'debit' | 'credit' | null = null
      if (!part.skipReason && Math.abs(part.adjustment) >= ADJUSTMENT_EPSILON) {
        // adjustment > 0：余额沿科目方向增加 → 外币科目按其方向记账
        const increase = part.adjustment > 0
        if (r.direction === 'debit') entryDirection = increase ? 'debit' : 'credit'
        else entryDirection = increase ? 'credit' : 'debit'
      }

      rows.push({
        account_id: r.account_id,
        account_code: r.account_code,
        account_name: r.account_name,
        direction: r.direction,
        currency_code: currency,
        foreign_end_balance: part.foreign,
        book_base_balance: part.book,
        closing_rate: rate,
        closing_rate_source: rateSource,
        revalued_base_balance: part.revalued,
        adjustment: part.adjustment,
        entry_direction: entryDirection,
        skip_reason: part.skipReason,
        ...(part.auxLabel ? { aux_label: part.auxLabel } : {}),
      })

      if (!entryDirection) continue
      const amount = Math.abs(part.adjustment)
      const summary = `${period}月期末调汇 ${currency} ${part.foreign.toFixed(2)} × ${rate}`
      const auxFields: Record<string, string> = {}
      for (const c of auxCats) if (part.auxIds?.[c.code]) auxFields[`_${c.code}_id`] = part.auxIds[c.code]
      entries.push({
        account_id: r.account_id,
        account_code: r.account_code,
        account_name: r.account_name,
        direction: entryDirection,
        amount,
        summary,
        ...auxFields,
      } as VoucherEntryInput)
      // 对方科目方向相反；外币科目借方增加 = 汇兑收益（贷损益），借方减少 = 汇兑损失
      const gainDirection: 'debit' | 'credit' = entryDirection === 'debit' ? 'credit' : 'debit'
      entries.push({
        account_id: gainAccount.id,
        account_code: gainAccount.code,
        account_name: gainAccount.name,
        direction: gainDirection,
        amount,
        summary,
      } as VoucherEntryInput)
      if (gainDirection === 'credit') totalGain = round2(totalGain + amount)
      else totalLoss = round2(totalLoss + amount)
    }
  }

  base.rows = rows
  base.entries = entries
  base.totalGain = totalGain
  base.totalLoss = totalLoss
  if (rows.length === 0) base.blockedReason = '本期没有外币科目余额'
  // 明细已经算完才拦——用户仍要看得到表格，才知道差在哪
  if (status.unpostedVoucherCount > 0) {
    base.blockedReason = `本期还有 ${status.unpostedVoucherCount} 张凭证未记账，请先过账后再调汇（未记账凭证不计入调汇基数）`
  }
  return base
}

function resolveFxVoucherTypeId(db: Db, accountSetId: string): string | null {
  const byName = db
    .prepare(
      `SELECT id FROM voucher_types WHERE account_set_id = ? AND (name = '记账' OR name = '记' OR code = 'JZ') ORDER BY sort_order LIMIT 1`
    )
    .get(accountSetId) as { id: string } | undefined
  if (byName) return byName.id
  const first = db
    .prepare(`SELECT id FROM voucher_types WHERE account_set_id = ? ORDER BY sort_order, code LIMIT 1`)
    .get(accountSetId) as { id: string } | undefined
  return first?.id ?? null
}

export function runFxRevaluation(params: {
  db: Db
  accountSetId: string
  userId?: string | null
  userName?: string | null
  year: number
  period: number
}): { error: string | null; voucherId: string | null; voucherNo: string | null; entryCount: number } {
  const { db, accountSetId, year, period } = params
  const periodError = validateAutoTransferPeriod(year, period)
  if (periodError) return { error: periodError, voucherId: null, voucherNo: null, entryCount: 0 }
  const startDateError = getGlStartDateError(db, accountSetId, getAutoTransferVoucherDate(year, period))
  if (startDateError) return { error: startDateError, voucherId: null, voucherNo: null, entryCount: 0 }

  const preview = previewFxRevaluation(params)
  if (preview.closed) return { error: '该期间已结账，不能生成调汇凭证', voucherId: null, voucherNo: null, entryCount: 0 }
  if (preview.alreadyGenerated) {
    return { error: '本期已生成调汇凭证，请先反调汇', voucherId: null, voucherNo: null, entryCount: 0 }
  }
  if (preview.blockedReason) return { error: preview.blockedReason, voucherId: null, voucherNo: null, entryCount: 0 }
  if (preview.entries.length === 0) {
    return { error: '本期外币科目账面余额与期末汇率折算一致，无需调汇', voucherId: null, voucherNo: null, entryCount: 0 }
  }

  const totals = calculateVoucherTotals(preview.entries)
  if (Math.abs(totals.debitTotal - totals.creditTotal) > 0.005) {
    return {
      error: `调汇分录借贷不平（借 ${totals.debitTotal.toFixed(2)} / 贷 ${totals.creditTotal.toFixed(2)}）`,
      voucherId: null,
      voucherNo: null,
      entryCount: 0,
    }
  }

  const voucherTypeId = resolveFxVoucherTypeId(db, accountSetId)
  const { effectiveTypeId, voucherNo } = getNextVoucherNo({ db, accountSetId, year, period, voucherTypeId })
  const voucherId = uuidv4()
  const runId = uuidv4()
  const { categories, itemMap } = loadVoucherAuxiliaryData({ db, accountSetId })
  const voucherDate = getAutoTransferVoucherDate(year, period)
  const remark = `${year}年${period}期期末调汇`

  const insertVoucher = db.prepare(`
    INSERT INTO vouchers (id, account_set_id, voucher_no, voucher_type_id, voucher_date, year, period, total_amount, maker_id, maker_name, remark, source, status, auditor_id, auditor_name)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'audited', ?, ?)
  `)
  const insertEntry = db.prepare(VOUCHER_ENTRY_INSERT_SQL)
  const insertRun = db.prepare(`
    INSERT INTO fx_revaluation_runs (id, account_set_id, year, period, voucher_id, created_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
  `)

  const tx = db.transaction(() => {
    insertVoucher.run(
      voucherId,
      accountSetId,
      voucherNo,
      effectiveTypeId,
      voucherDate,
      year,
      period,
      totals.debitTotal,
      params.userId ?? null,
      params.userName ?? null,
      remark,
      FX_REVAL_SOURCE,
      params.userId ?? null,
      params.userName ?? null
    )
    const payloads = buildVoucherEntryPayloads({
      db,
      accountSetId,
      voucherId,
      entries: preview.entries,
      categories,
      itemMap,
    })
    payloads.forEach(p => insertEntry.run(...p))
    insertRun.run(runId, accountSetId, year, period, voucherId, params.userId ?? null)

    const voucher: VoucherLike = { id: voucherId, year, period, status: 'audited' }
    applyVoucherPosting(db, voucher, loadVoucherEntries(db, voucherId), {
      accountSetId,
      userId: params.userId || undefined,
      userName: params.userName || undefined,
      requireAudit: true,
      allowDirectPost: false,
    })
  })

  try {
    tx()
  } catch (error: any) {
    if (isSqliteConstraintError(error)) {
      return { error: '凭证号冲突或本期已生成调汇凭证，请刷新后重试', voucherId: null, voucherNo: null, entryCount: 0 }
    }
    throw error
  }
  return { error: null, voucherId, voucherNo, entryCount: preview.entries.length }
}

export function revokeFxRevaluation(params: {
  db: Db
  accountSetId: string
  year: number
  period: number
  userId?: string | null
  userName?: string | null
}): { error: string | null; voucherId: string | null; voucherNo: string | null } {
  const { db, accountSetId, year, period } = params
  const status = getFxRevaluationStatus(params)
  if (status.closed) return { error: '该期间已结账，不能反调汇', voucherId: null, voucherNo: null }
  const run = status.existingRun
  if (!run) return { error: '本期未生成调汇凭证，无需反调汇', voucherId: null, voucherNo: null }

  const voucher = db.prepare('SELECT * FROM vouchers WHERE id = ?').get(run.voucher_id) as any
  const tx = db.transaction(() => {
    if (voucher && voucher.status === 'posted') {
      applyVoucherUnpost(
        db,
        { id: voucher.id, year: voucher.year, period: voucher.period, status: 'posted' },
        loadVoucherEntries(db, voucher.id),
        {
          accountSetId,
          userId: params.userId || undefined,
          userName: params.userName || undefined,
          requireAudit: true,
          allowDirectPost: false,
        }
      )
    }
    db.prepare('DELETE FROM voucher_attachments WHERE voucher_id = ?').run(run.voucher_id)
    db.prepare('DELETE FROM voucher_entries WHERE voucher_id = ?').run(run.voucher_id)
    db.prepare('DELETE FROM fx_revaluation_runs WHERE id = ?').run(run.id)
    db.prepare('DELETE FROM vouchers WHERE id = ?').run(run.voucher_id)
  })
  tx()
  return { error: null, voucherId: run.voucher_id, voucherNo: run.voucher_no }
}
