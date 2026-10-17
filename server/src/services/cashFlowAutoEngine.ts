/**
 * 现金流量表自动取数引擎（按「科目现金流量项目」推算，不再看分录上人工指定的 cash_flow_code）
 *
 * 主表（直接法）——逐张已过账凭证：
 *   现金类科目借方合计 = 收到的现金 in，贷方合计 = 付出的现金 out；
 *   对方（非现金）科目贷方分录分摊 in，记入该科目「主表贷方」项目；
 *   对方科目借方分录分摊 out，记入该科目「主表借方」项目。
 *   只有现金类科目之间互转（提现 / 存现 / 转账）的凭证不产生现金流量。
 *   分摊：in 不超过对方贷方合计 NC，超出部分视为对方借贷相互抵消（如收款时一并扣手续费），
 *   即 实际流入 I = min(NC, in)、实际流出 O = ND − (NC − I)，按金额占比摊给各分录。
 *
 * 附表（补充资料·间接法）——排除结转凭证后，非现金科目分录按「附表贷方 / 附表借方」项目汇总：
 *   资产负债类：贷方记 +、借方记 −（资产减少 / 负债增加 = 现金增加）
 *   损益类：借方记 +、贷方记 −（费用加回、收益扣减）
 *   净利润 = 损益类科目（贷 − 借）净额。
 */
import type { AccountScopeContext } from './accountAuthorization.js'
import { isAccountIdInScope } from './accountAuthorization.js'
import { getLedgerDataEpoch } from './ledgerDataEpoch.js'
import {
  getCashFlowMapEpoch,
  getEffectiveCashFlowMapping,
  type CashFlowQueryDb,
  type EffectiveCashFlowMapping,
} from './cashFlowAccountMap.js'
import { SUPPLEMENT_ITEMS, SUPPLEMENT_NET_PROFIT_CODE } from '../config/cashFlowAccountDefaults.js'
import { CLOSING_VOUCHER_TYPE_JOIN_SQL, IS_CLOSING_VOUCHER_SQL } from '../utils/closingVoucherSql.js'

export interface CashFlowItemAmount {
  /** 摊到本项目的流入 / 流出（毛额） */
  inflow: number
  outflow: number
  /** 涉及的凭证张数 */
  voucherCount?: number
}

export interface CashFlowUnmappedLine {
  account_id: string
  account_code: string
  account_name: string
  /** credit = 对方科目在贷方（现金流入），debit = 在借方（现金流出） */
  side: 'credit' | 'debit'
  amount: number
  voucher_count: number
}

/** 逐分录问题明细（检查表用） */
export interface CashFlowIssueLine {
  voucher_id: string
  account_id: string
  side: 'credit' | 'debit'
  amount: number
  /** missing = 对方科目没设主表项目；invalid_code = 设的项目编码已不存在 */
  issue: 'missing' | 'invalid_code'
  code: string | null
}

export interface CashFlowAutoOptions {
  /** 统计未记账凭证（草稿 / 已审核） */
  includeUnposted?: boolean
  /** 收集逐分录问题明细 */
  collectDetail?: boolean
}

export interface CashFlowAutoResult {
  /** 主表项目编码 → 摊到的流入 / 流出 */
  main: Map<string, CashFlowItemAmount>
  /** 附表项目编码 → 调节金额（F01 为净利润） */
  supplement: Map<string, number>
  netProfit: number
  /** 三大活动净额（流入为正） */
  activities: { operating: number; investing: number; financing: number; other: number; net: number }
  /** 间接法经营活动现金流量净额 = 净利润 + 附表各项 */
  indirectOperating: number
  /** 现金类科目本期净增加（借 − 贷，含现金内部互转的净额 0） */
  cashChange: number
  /** 对方科目没设主表项目的金额 */
  unmapped: CashFlowUnmappedLine[]
  /** 映射是否已保存（false = 按默认规则临时推算） */
  persisted: boolean
  /** 逐分录问题明细（options.collectDetail 时才有） */
  issues: CashFlowIssueLine[]
  /** 参与计算的含现金科目凭证张数 */
  cashVoucherCount: number
  /** 项目编码 → 活动 / 流向 */
  itemClass: EffectiveCashFlowMapping['itemClass']
  items: EffectiveCashFlowMapping['items']
}

function round2(v: number): number {
  return Math.round((v + Number.EPSILON) * 100) / 100
}

// ───────────────────────── 缓存：一次报表计算里 @xj_je 每格都会调用 ─────────────────────────
const CACHE_TTL_MS = 3000
const cache = new WeakMap<object, Map<string, { expires: number; epoch: string; data: CashFlowAutoResult }>>()

export function clearCashFlowAutoCache() {
  // WeakMap 无法枚举，借映射版本号整体失效
  cacheEpochOffset += 1
}
let cacheEpochOffset = 0

function scopeKey(scope?: AccountScopeContext): string {
  if (!scope || scope.bypass || !scope.restricted) return '*'
  return [...scope.allowedAccountIds].sort().join(',')
}

export function computeCashFlowByMapping(
  db: CashFlowQueryDb,
  accountSetId: string,
  year: number,
  fromPeriod: number,
  toPeriod: number,
  accountScope?: AccountScopeContext,
  options: CashFlowAutoOptions = {}
): CashFlowAutoResult {
  const from = Math.min(12, Math.max(1, Math.trunc(fromPeriod) || 1))
  const to = Math.min(12, Math.max(from, Math.trunc(toPeriod) || from))
  const key = `${accountSetId}|${year}|${from}|${to}|${scopeKey(accountScope)}|${options.includeUnposted ? 1 : 0}|${options.collectDetail ? 1 : 0}`
  // GL-6：记账 / 反记账也要让缓存失效（原来只认映射版本号，3 秒内过账仍返回旧数）
  const epoch = `${getCashFlowMapEpoch()}|${cacheEpochOffset}|${getLedgerDataEpoch()}`
  const now = Date.now()
  let perDb = cache.get(db as object)
  if (!perDb) {
    perDb = new Map()
    cache.set(db as object, perDb)
  }
  const hit = perDb.get(key)
  if (hit && hit.expires > now && hit.epoch === epoch) return hit.data

  const data = computeUncached(db, accountSetId, year, from, to, accountScope, options)
  perDb.set(key, { expires: now + CACHE_TTL_MS, epoch, data })
  return data
}

function computeUncached(
  db: CashFlowQueryDb,
  accountSetId: string,
  year: number,
  from: number,
  to: number,
  accountScope?: AccountScopeContext,
  options: CashFlowAutoOptions = {}
): CashFlowAutoResult {
  const mapping = getEffectiveCashFlowMapping(db, accountSetId)
  const main = new Map<string, CashFlowItemAmount>()
  const unmappedAgg = new Map<string, CashFlowUnmappedLine & { vouchers: Set<string> }>()
  const issues: CashFlowIssueLine[] = []
  const ctx: AllocContext = {
    mapping,
    main,
    unmapped: unmappedAgg,
    issues: options.collectDetail ? issues : null,
    validMainCodes: new Set(mapping.items.filter(i => i.kind !== 'supplement').map(i => i.code)),
    itemVouchers: new Map(),
  }
  let cashChange = 0
  let cashVoucherCount = 0

  const cashIds = [...mapping.cashIds].filter(id => isAccountIdInScope(accountScope, id))
  if (cashIds.length > 0) {
    const entries = loadCashVoucherEntries(db, accountSetId, year, from, to, cashIds, !!options.includeUnposted)
    const cashSet = new Set(cashIds)
    let current: string | null = null
    let bucket: EntryRow[] = []
    const flush = () => {
      if (bucket.length) {
        cashVoucherCount++
        cashChange += allocateVoucher(bucket, cashSet, ctx)
      }
      bucket = []
    }
    for (const e of entries) {
      if (e.voucher_id !== current) {
        flush()
        current = e.voucher_id
      }
      bucket.push(e)
    }
    flush()
  }

  // 主表 → 三大活动
  const activities = { operating: 0, investing: 0, financing: 0, other: 0, net: 0 }
  for (const [code, amt] of main) {
    const signed = amt.inflow - amt.outflow
    const cls = mapping.itemClass.get(code)
    if (cls?.activity === 'operating') activities.operating += signed
    else if (cls?.activity === 'investing') activities.investing += signed
    else if (cls?.activity === 'financing') activities.financing += signed
    else activities.other += signed
  }
  activities.operating = round2(activities.operating)
  activities.investing = round2(activities.investing)
  activities.financing = round2(activities.financing)
  activities.other = round2(activities.other)
  activities.net = round2(activities.operating + activities.investing + activities.financing + activities.other)

  for (const [code, amt] of main) {
    main.set(code, { inflow: round2(amt.inflow), outflow: round2(amt.outflow), voucherCount: ctx.itemVouchers.get(code)?.size || 0 })
  }

  // 附表
  const { supplement, netProfit } = computeSupplement(db, accountSetId, year, from, to, mapping, accountScope, !!options.includeUnposted)
  let indirectOperating = netProfit
  for (const [code, v] of supplement) if (code !== SUPPLEMENT_NET_PROFIT_CODE) indirectOperating += v

  const unmapped = [...unmappedAgg.values()]
    .map(({ vouchers, ...rest }) => ({ ...rest, amount: round2(rest.amount), voucher_count: vouchers.size }))
    .filter(u => Math.abs(u.amount) >= 0.005)
    .sort((a, b) => a.account_code.localeCompare(b.account_code))

  return {
    main,
    supplement,
    netProfit,
    activities,
    indirectOperating: round2(indirectOperating),
    cashChange: round2(cashChange),
    unmapped,
    issues,
    cashVoucherCount,
    persisted: mapping.persisted,
    itemClass: mapping.itemClass,
    items: mapping.items,
  }
}

interface EntryRow {
  voucher_id: string
  account_id: string
  direction: 'debit' | 'credit'
  amount: number
}

function loadCashVoucherEntries(
  db: CashFlowQueryDb,
  accountSetId: string,
  year: number,
  from: number,
  to: number,
  cashIds: string[],
  includeUnposted: boolean
): EntryRow[] {
  const placeholders = cashIds.map(() => '?').join(',')
  return db
    .prepare(
      `
      SELECT ve.voucher_id, ve.account_id, ve.direction, ve.amount
      FROM voucher_entries ve
      JOIN vouchers v ON v.id = ve.voucher_id
      WHERE v.account_set_id = ?
        AND v.year = ? AND v.period >= ? AND v.period <= ?
        AND ${statusSql(includeUnposted)}
        AND ve.voucher_id IN (
          SELECT DISTINCT ve2.voucher_id FROM voucher_entries ve2
          WHERE ve2.account_set_id = ? AND ve2.account_id IN (${placeholders})
        )
      ORDER BY ve.voucher_id
      `
    )
    .all(accountSetId, year, from, to, accountSetId, ...cashIds) as EntryRow[]
}

function statusSql(includeUnposted: boolean) {
  return includeUnposted ? "v.status IN ('draft', 'audited', 'posted')" : "v.status = 'posted'"
}

interface AllocContext {
  mapping: EffectiveCashFlowMapping
  main: Map<string, CashFlowItemAmount>
  unmapped: Map<string, CashFlowUnmappedLine & { vouchers: Set<string> }>
  issues: CashFlowIssueLine[] | null
  validMainCodes: Set<string>
  itemVouchers: Map<string, Set<string>>
}

/** 一张凭证的现金分摊，返回现金净增加 */
function allocateVoucher(entries: EntryRow[], cashSet: Set<string>, ctx: AllocContext): number {
  const { mapping, main, unmapped } = ctx
  let cashIn = 0
  let cashOut = 0
  const credits: EntryRow[] = []
  const debits: EntryRow[] = []
  for (const e of entries) {
    const amount = Number(e.amount) || 0
    if (cashSet.has(e.account_id)) {
      if (e.direction === 'debit') cashIn += amount
      else cashOut += amount
      continue
    }
    // 现金等价物但不在授权范围内的科目：视作现金，不参与对方分摊
    if (mapping.cashIds.has(e.account_id)) continue
    const acc = mapping.accountById.get(e.account_id)
    if (acc && !mapping.accountClass.get(acc.id)?.tab) continue // 预算会计等不参与的科目
    if (e.direction === 'credit') credits.push(e)
    else debits.push(e)
  }
  if (Math.abs(cashIn) < 0.005 && Math.abs(cashOut) < 0.005) return 0
  const netCash = cashIn - cashOut
  if (credits.length === 0 && debits.length === 0) return netCash // 现金内部互转

  const NC = credits.reduce((s, e) => s + (Number(e.amount) || 0), 0)
  const ND = debits.reduce((s, e) => s + (Number(e.amount) || 0), 0)
  let creditScale = 1
  let debitScale = 1
  if (NC > 0 && ND >= 0 && cashIn >= 0 && cashOut >= 0) {
    const I = Math.min(NC, cashIn)
    const O = ND - (NC - I)
    creditScale = NC > 0 ? I / NC : 0
    debitScale = ND > 0 ? Math.max(0, O) / ND : 0
  }

  const voucherId = entries[0]?.voucher_id || ''
  const add = (e: EntryRow, side: 'credit' | 'debit', amount: number) => {
    if (Math.abs(amount) < 1e-9) return
    const codes = mapping.codes.get(e.account_id)
    const code = side === 'credit' ? codes?.main_credit_code : codes?.main_debit_code
    if (code && ctx.validMainCodes.has(code)) {
      const cur = main.get(code) || { inflow: 0, outflow: 0 }
      if (side === 'credit') cur.inflow += amount
      else cur.outflow += amount
      main.set(code, cur)
      const set = ctx.itemVouchers.get(code) || new Set<string>()
      set.add(voucherId)
      ctx.itemVouchers.set(code, set)
      return
    }
    const acc = mapping.accountById.get(e.account_id)
    const key = `${e.account_id}|${side}`
    const u = unmapped.get(key) || {
      account_id: e.account_id,
      account_code: acc?.code || '',
      account_name: acc?.name || '',
      side,
      amount: 0,
      voucher_count: 0,
      vouchers: new Set<string>(),
    }
    u.amount += amount
    u.vouchers.add(voucherId)
    unmapped.set(key, u)
    ctx.issues?.push({
      voucher_id: voucherId,
      account_id: e.account_id,
      side,
      amount: round2(amount),
      issue: code ? 'invalid_code' : 'missing',
      code: code || null,
    })
  }
  for (const e of credits) add(e, 'credit', (Number(e.amount) || 0) * creditScale)
  for (const e of debits) add(e, 'debit', (Number(e.amount) || 0) * debitScale)
  return netCash
}

function computeSupplement(
  db: CashFlowQueryDb,
  accountSetId: string,
  year: number,
  from: number,
  to: number,
  mapping: EffectiveCashFlowMapping,
  accountScope: AccountScopeContext | undefined,
  includeUnposted: boolean
): { supplement: Map<string, number>; netProfit: number } {
  const rows = db
    .prepare(
      `
      SELECT ve.account_id,
        SUM(CASE WHEN ve.direction = 'debit' THEN ve.amount ELSE 0 END) AS d,
        SUM(CASE WHEN ve.direction = 'credit' THEN ve.amount ELSE 0 END) AS c
      FROM voucher_entries ve
      JOIN vouchers v ON v.id = ve.voucher_id
      ${CLOSING_VOUCHER_TYPE_JOIN_SQL}
      WHERE v.account_set_id = ?
        AND v.year = ? AND v.period >= ? AND v.period <= ?
        AND ${statusSql(includeUnposted)}
        AND NOT ${IS_CLOSING_VOUCHER_SQL}
      GROUP BY ve.account_id
      `
    )
    .all(accountSetId, year, from, to) as Array<{ account_id: string; d: number | null; c: number | null }>

  const supplement = new Map<string, number>()
  if (mapping.profile.hasSupplement) for (const s of SUPPLEMENT_ITEMS) supplement.set(s.code, 0)
  let netProfit = 0
  for (const r of rows) {
    if (mapping.cashIds.has(r.account_id)) continue
    if (!isAccountIdInScope(accountScope, r.account_id)) continue
    const acc = mapping.accountById.get(r.account_id)
    if (!acc) continue
    const cls = mapping.accountClass.get(acc.id)
    if (!cls) continue
    if (!cls.tab) continue
    const debit = Number(r.d) || 0
    const credit = Number(r.c) || 0
    if (cls.isProfitLoss) netProfit += credit - debit
    const codes = mapping.codes.get(r.account_id)
    if (!codes) continue
    const sign = cls.isProfitLoss ? -1 : 1
    if (codes.supp_credit_code && codes.supp_credit_code !== SUPPLEMENT_NET_PROFIT_CODE) {
      supplement.set(codes.supp_credit_code, (supplement.get(codes.supp_credit_code) || 0) + sign * credit)
    }
    if (codes.supp_debit_code && codes.supp_debit_code !== SUPPLEMENT_NET_PROFIT_CODE) {
      supplement.set(codes.supp_debit_code, (supplement.get(codes.supp_debit_code) || 0) - sign * debit)
    }
  }
  netProfit = round2(netProfit)
  if (mapping.profile.hasSupplement) supplement.set(SUPPLEMENT_NET_PROFIT_CODE, netProfit)
  for (const [k, v] of supplement) supplement.set(k, round2(v))
  return { supplement, netProfit }
}

/**
 * 主表项目金额（按项目自身流向取正：流入项目 = 流入 − 流出，流出项目 = 流出 − 流入）。
 * 传入的是非末级项目时汇总其下级（编码前缀）。
 */
export function getMainItemAmount(result: CashFlowAutoResult, code: string): number {
  const flow = result.itemClass.get(code)?.flow
  const value = (amt: CashFlowItemAmount) => (flow === 'out' ? amt.outflow - amt.inflow : amt.inflow - amt.outflow)
  const own = result.main.get(code)
  if (own) return round2(value(own))
  const item = result.items.find(i => i.code === code)
  if (!item || item.is_leaf !== 0) return 0
  let total = 0
  for (const [c, amt] of result.main) {
    if (c !== code && c.startsWith(code)) total += value(amt)
  }
  return round2(total)
}

/** 附表项目金额 */
export function getSupplementItemAmount(result: CashFlowAutoResult, code: string): number {
  return round2(result.supplement.get(code) || 0)
}
