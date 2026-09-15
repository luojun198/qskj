/**
 * 期初余额「按科目汇总」的唯一口径（FIX-104）。
 *
 * 背景：`init_balances` 里一个科目可能同时存在两类行——
 *  - **科目汇总行**（`aux_item_id = ''`）：由 `initBalanceAux.recalcInitBalanceAuxSummary`
 *    维护，取值是**任一辅助类目的合计**（保存辅助期初时强制各类目合计相等）；
 *  - **辅助明细行**（`aux_item_id != ''`）：每个辅助类目各一套，金额相同。
 *
 * 因此「SUM 全部辅助明细行」在多辅助类目场景下会成倍放大：
 * 同时启用 部门 + 人员 的科目，dept 合计 91 + person 合计 91 = 182，而真实期初只有 91。
 * 借贷同时放大，试算平衡校验侥幸仍为 true，缺陷会长期潜伏。
 *
 * 统一口径：**有科目汇总行时以汇总行为准；没有汇总行（历史数据 / 批量导入）才回退到
 * 累加辅助明细行**。回退分支保留是为了不让旧账套的期初凭空变 0——单类目场景下两者相等，
 * 只有「多类目且缺汇总行」的历史数据仍会偏大，这类数据应通过重新保存辅助期初补齐汇总行。
 *
 * 账簿（ledgerQuery）、试算（initBalanceTrial）、报表（reportBalance）三处必须共用本文件，
 * 否则同一科目会再次出现两套期初数。
 */

import type { Database } from 'better-sqlite3'
import { buildDirectionSignedNetSql } from '../utils/accountBalance.js'

/**
 * init_balances 的一组取数列。金额与数量核算共用同一套汇总口径，只是列名不同，
 * 因此所有表达式构造器都接受一个列集合参数，默认取金额列（老调用点无需改动）。
 */
export interface InitBalanceColumnSet {
  initBalance: string
  openingDebit: string
  openingCredit: string
  preBookDebit: string
  preBookCredit: string
}

export const AMOUNT_INIT_COLUMNS: InitBalanceColumnSet = {
  initBalance: 'init_balance',
  openingDebit: 'opening_debit',
  openingCredit: 'opening_credit',
  preBookDebit: 'pre_book_debit',
  preBookCredit: 'pre_book_credit',
}

export const QUANTITY_INIT_COLUMNS: InitBalanceColumnSet = {
  initBalance: 'qty_init_balance',
  openingDebit: 'qty_opening_debit',
  openingCredit: 'qty_opening_credit',
  preBookDebit: 'qty_pre_book_debit',
  preBookCredit: 'qty_pre_book_credit',
}

/** 外币原币列。与金额列一一对称，由 20260905_add_foreign_currency 迁移添加 */
export const FOREIGN_INIT_COLUMNS: InitBalanceColumnSet = {
  initBalance: 'foreign_init_balance',
  openingDebit: 'foreign_opening_debit',
  openingCredit: 'foreign_opening_credit',
  preBookDebit: 'foreign_pre_book_debit',
  preBookCredit: 'foreign_pre_book_credit',
}

/** 汇总行优先、辅助明细兜底的 CASE 表达式。`alias` 为 init_balances 的表别名（无别名传空串） */
export function buildInitBalanceSumExpr(
  alias = '',
  cols: InitBalanceColumnSet = AMOUNT_INIT_COLUMNS
): string {
  const p = alias ? `${alias}.` : ''
  const col = `${p}${cols.initBalance}`
  return `CASE
      WHEN COUNT(CASE WHEN COALESCE(${p}aux_item_id, '') = '' THEN 1 END) > 0
      THEN SUM(CASE WHEN COALESCE(${p}aux_item_id, '') = '' THEN ${col} ELSE 0 END)
      ELSE SUM(CASE WHEN COALESCE(${p}aux_item_id, '') != '' THEN ${col} ELSE 0 END)
    END`
}

/** 明细行（JS 侧）按同一口径挑出参与汇总的行 */
export function pickInitBalanceRows<T extends { aux_item_id?: string | null }>(rows: T[]): T[] {
  const summaryRows = rows.filter(r => !r.aux_item_id)
  return summaryRows.length > 0 ? summaryRows : rows.filter(r => r.aux_item_id)
}

/**
 * 中途启用账套的「年初余额」与「账前发生额」口径（FIX-105）。
 *
 * 账套在年度中间启用（如 2025-12-01）时，`init_balances` 一行同时存三组数：
 *  - `opening_debit/opening_credit`：**年初**（1 月 1 日）余额；
 *  - `pre_book_debit/pre_book_credit`：**年初 → 启用日**之间的发生额，即启用前已在旧系统
 *    记账、本系统没有凭证明细的那部分；
 *  - `init_balance`：**启用时点**余额，恒等于 `方向×(opening 净额 + pre_book 净额)`。
 *
 * 账簿旧实现只读 `init_balance`，于是「本年累计发生额」丢掉了启用前的部分——期末余额
 * 因为 `init_balance` 已内含 pre_book 净额而侥幸正确，但期初与发生额两列对不上外部账。
 */

/** 年初余额（按科目方向签名）。`accountAlias` 需能取到 direction；汇总行优先，与期初口径一致 */
export function buildOpeningBalanceSumExpr(
  alias = '',
  accountAlias = 'a',
  cols: InitBalanceColumnSet = AMOUNT_INIT_COLUMNS
): string {
  const p = alias ? `${alias}.` : ''
  const summaryFilter = `COALESCE(${p}aux_item_id, '') = ''`
  const detailFilter = `COALESCE(${p}aux_item_id, '') != ''`
  // 贷方科目：贷 - 借；借方科目：借 - 贷（统一走 buildDirectionSignedNetSql）
  const signed = (filter: string) =>
    `SUM(CASE WHEN ${filter} THEN
        (${buildDirectionSignedNetSql(
          `${accountAlias}.direction`,
          `COALESCE(${p}${cols.openingDebit}, 0)`,
          `COALESCE(${p}${cols.openingCredit}, 0)`
        )})
      ELSE 0 END)`
  return `CASE
      WHEN COUNT(CASE WHEN ${summaryFilter} THEN 1 END) > 0 THEN ${signed(summaryFilter)}
      ELSE ${signed(detailFilter)}
    END`
}

/**
 * `opening_* / pre_book_*` 是后续迁移补的列，未升级的老库没有。
 * 取数前必须先探测，缺列时整体回退到 `init_balance` 旧口径，否则 SQL 直接报错。
 */
const preBookColumnCache = new WeakMap<object, boolean>()

export function hasPreBookColumns(db: Database): boolean {
  const key = db as unknown as object
  const cached = preBookColumnCache.get(key)
  if (cached !== undefined) return cached
  let supported = false
  try {
    const cols = db.prepare('PRAGMA table_info(init_balances)').all() as Array<{ name?: string }>
    const names = new Set(cols.map(c => String(c?.name || '')))
    supported =
      names.has('opening_debit') &&
      names.has('opening_credit') &&
      names.has('pre_book_debit') &&
      names.has('pre_book_credit')
  } catch {
    supported = false
  }
  preBookColumnCache.set(key, supported)
  return supported
}

/**
 * 外币原币的 `foreign_opening_* / foreign_pre_book_*` 同样是后加列。
 * 只做过 20260905 之前迁移的老库只有 `foreign_init_balance`，探测失败时
 * 外币期初回退到 `buildAccountInitBalanceExpr`（只读 foreign_init_balance）。
 */
const foreignPreBookColumnCache = new WeakMap<object, boolean>()

export function hasForeignPreBookColumns(db: Database): boolean {
  const key = db as unknown as object
  const cached = foreignPreBookColumnCache.get(key)
  if (cached !== undefined) return cached
  let supported = false
  try {
    const cols = db.prepare('PRAGMA table_info(init_balances)').all() as Array<{ name?: string }>
    const names = new Set(cols.map(c => String(c?.name || '')))
    supported =
      names.has('foreign_opening_debit') &&
      names.has('foreign_opening_credit') &&
      names.has('foreign_pre_book_debit') &&
      names.has('foreign_pre_book_credit')
  } catch {
    supported = false
  }
  foreignPreBookColumnCache.set(key, supported)
  return supported
}

/**
 * 账前发生额的归属时点：**启用日的前一天**。
 * 把它当成一笔发生在该日的汇总凭证，即可用统一的日期/期间比较判断它应计入期初、
 * 本期发生额还是本年累计。启用日缺失时回退为年初，归属时点落到上年末，
 * 等价于旧口径（全部并入期初）。
 */
export function resolvePreBookDate(accountSetStartDate: string | undefined, year: number): string {
  const start = accountSetStartDate || `${year}-01-01`
  const d = new Date(`${start}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return `${year - 1}-12-31`
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

/**
 * FIX-105 账前发生额归属推导（区间口径）。
 *
 * 科目余额表 / 数量金额余额表按任意起止日期查询，需要判断这笔"启用日前一天"的
 * 汇总发生额应计入期初、本期发生额、本年累计还是期末余额。四个布尔值必须一起推导，
 * 否则容易出现"期初已含、本期又加一遍"的重复计算。
 *
 * 注意：initIncludesPreBook / endIncludesPreBook 有意不判断 preBookEnabled ——
 * 未启用时 pre_book_* 列恒为 0，加不加等价；而 current / year 会额外拼接子查询与
 * 占位符，必须由 preBookEnabled 收口。此差异是刻意保留的，勿"顺手统一"。
 */
export function resolvePreBookRangeFlags(params: {
  accountSetStartDate?: string
  preBookEnabled?: boolean
  /** 查询区间起始日 YYYY-MM-DD */
  startDate: string
  /** 查询区间结束日 YYYY-MM-DD */
  endDate: string
  /** 本年累计的起算日（endDate 所在年度的 1 月 1 日） */
  yearStartDate: string
}): {
  preBookEnabled: boolean
  initIncludesPreBook: boolean
  currentIncludesPreBook: boolean
  yearIncludesPreBook: boolean
  endIncludesPreBook: boolean
} {
  const { startDate, endDate, yearStartDate } = params
  const preBookEnabled = params.preBookEnabled === true
  const startDateYear = new Date(startDate).getFullYear()
  const endDateYear = new Date(endDate).getFullYear()
  const preBookDateStartYear = resolvePreBookDate(params.accountSetStartDate, startDateYear)
  const preBookDateEndYear = resolvePreBookDate(params.accountSetStartDate, endDateYear)
  return {
    preBookEnabled,
    initIncludesPreBook: preBookDateStartYear < startDate,
    currentIncludesPreBook:
      preBookEnabled && preBookDateEndYear >= startDate && preBookDateEndYear <= endDate,
    yearIncludesPreBook:
      preBookEnabled && preBookDateEndYear >= yearStartDate && preBookDateEndYear <= endDate,
    endIncludesPreBook: preBookDateEndYear <= endDate,
  }
}

/**
 * FIX-105 账前发生额归属推导（年度/月份口径）。
 *
 * 总分类账、总账（按期）这类"按年取数、逐月成列"的查询用本函数：账前发生额挂在
 * 启用日前一天所属月份，落在本年之前则并入期初，保证「期初 + 各月 = 期末」逐列勾稽。
 *
 * preBookMonth 已由 preBookEnabled 收口（未启用恒为 0），调用方若还要判断"当前期间"
 * 仍应保留自己的 preBookEnabled 判断，避免 0 <= period 恒真。
 */
export function resolvePreBookYearFlags(params: {
  accountSetStartDate?: string
  preBookEnabled?: boolean
  year: number
}): {
  preBookEnabled: boolean
  preBookDate: string
  preBookInYear: boolean
  /** 账前发生额所属月份 1~12；未启用或不在本年时为 0 */
  preBookMonth: number
  initIncludesPreBook: boolean
} {
  const { year } = params
  const preBookEnabled = params.preBookEnabled === true
  const preBookDate = resolvePreBookDate(params.accountSetStartDate, year)
  const preBookInYear = preBookDate >= `${year}-01-01` && preBookDate <= `${year}-12-31`
  return {
    preBookEnabled,
    preBookDate,
    preBookInYear,
    preBookMonth: preBookEnabled && preBookInYear ? Number(preBookDate.slice(5, 7)) : 0,
    initIncludesPreBook: !preBookInYear && preBookDate < `${year}-01-01`,
  }
}

/** 账前发生额（原始借/贷金额，不签名）。`side` 取 debit / credit */
export function buildPreBookSumExpr(
  side: 'debit' | 'credit',
  alias = '',
  cols: InitBalanceColumnSet = AMOUNT_INIT_COLUMNS
): string {
  const p = alias ? `${alias}.` : ''
  const col = side === 'debit' ? `${p}${cols.preBookDebit}` : `${p}${cols.preBookCredit}`
  const summaryFilter = `COALESCE(${p}aux_item_id, '') = ''`
  const detailFilter = `COALESCE(${p}aux_item_id, '') != ''`
  return `CASE
      WHEN COUNT(CASE WHEN ${summaryFilter} THEN 1 END) > 0
      THEN SUM(CASE WHEN ${summaryFilter} THEN COALESCE(${col}, 0) ELSE 0 END)
      ELSE SUM(CASE WHEN ${detailFilter} THEN COALESCE(${col}, 0) ELSE 0 END)
    END`
}

/**
 * FIX-150：账簿期初的单一出口。
 *  - preBookEnabled=false（老库缺列）：回退 init_balance（启用时点余额）
 *  - preBookEnabled=true：年初余额（opening）+ 账前发生额（仅当其归属日早于查询起点，即 initIncludesPreBook）
 * 结果按科目方向签名（借方科目借正、贷方科目贷正），需外层 JOIN accounts 别名 accountAlias。
 */
export function buildLedgerOpeningExpr(params: {
  preBookEnabled: boolean
  initIncludesPreBook: boolean
  alias?: string
  accountAlias?: string
  cols?: InitBalanceColumnSet
}): string {
  const alias = params.alias ?? 'ib'
  const accountAlias = params.accountAlias ?? 'a'
  const cols = params.cols ?? AMOUNT_INIT_COLUMNS
  if (!params.preBookEnabled) return buildInitBalanceSumExpr(alias, cols)
  const opening = buildOpeningBalanceSumExpr(alias, accountAlias, cols)
  if (!params.initIncludesPreBook) return opening
  const preBook = buildDirectionSignedNetSql(
    `${accountAlias}.direction`,
    buildPreBookSumExpr('debit', alias, cols),
    buildPreBookSumExpr('credit', alias, cols)
  )
  return `(${opening}) + (${preBook})`
}

/**
 * FIX-153 / P1-账簿-6：期初链式上溯。
 *
 * 余额类查询的「期初 / 期末」= 某年度 init_balances + 该年度年初起的凭证累计。若上年未年结，
 * 本年 init_balances 没有行，期末会丢掉整个上年及以前。这里从 year 往前找到最近一个
 * 有期初行的年度（账套级），凭证累计下限也改从该年年初起，链式补上未年结年度的发生额。
 * 找不到任何期初行时回退到账套最早凭证年度（全部凭证累计）。
 */
export function resolveOpeningBaseYear(
  db: { prepare: (sql: string) => { get: (...args: any[]) => any } },
  accountSetId: string,
  year: number,
  maxBack = 20
): number {
  const hasInit = db.prepare('SELECT 1 FROM init_balances WHERE account_set_id = ? AND year = ? LIMIT 1')
  let y = year
  for (let i = 0; i < maxBack; i++) {
    if (hasInit.get(accountSetId, y)) return y
    y -= 1
  }
  const earliest = db
    .prepare('SELECT MIN(year) AS y FROM vouchers WHERE account_set_id = ?')
    .get(accountSetId) as { y: number | null } | undefined
  const minVoucherYear = Number(earliest?.y)
  return Number.isFinite(minVoucherYear) && minVoucherYear > 0 ? Math.min(minVoucherYear, year) : year
}
