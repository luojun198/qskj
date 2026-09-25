import { Router } from 'express'
import { parseAmountFilter } from '../utils/amountUtils.js'
import { v4 as uuidv4 } from 'uuid'
import { authMiddleware, AuthRequest, requirePermission, requireAnyPermission, operationLog } from '../middleware/index.js'
import {
  findVatParentAccount,
  queryVatLedger,
  resolveVatColumns,
  saveVatColumnSettings,
} from '../services/vatLedgerQuery.js'
import {
  queryMultiColumnLedger,
  readMultiColumnSettings,
  resolveMultiColumnAccounts,
  saveMultiColumnSettings,
  type MultiColumnSetting,
} from '../services/multiColumnLedgerQuery.js'
import {
  queryAuxMultiColumnLedger,
  resolveAuxMultiColumnColumnSources,
  saveAuxMultiColumnSettings,
  type AuxMultiColumnMode,
  type AuxMultiColumnSetting,
} from '../services/auxMultiColumnLedgerQuery.js'
import { getDb } from '../db/index.js'
import {
  buildCashJournalQuery,
  buildChronologicalQuery,
  buildGeneralLedgerQuery,
  buildLedgerDetailQuery,
  buildLedgerGeneralQuery,
  buildForeignBalanceQuery,
  buildQuantityBalanceQuery,
  buildVoucherSummaryQuery,
  buildVoucherSummaryNoRangeQuery,
  supplementMissingParents,
  accumulateParentBalances,
  accumulateParentBalancesWithMonths,
  supplementMissingParentsWithMonths,
  getCodeLengths,
} from '../services/ledgerQuery.js'
import {
  buildAuxFieldValuesSelect,
  appendAuxItemMatchParams,
  buildAuxIdSelect,
  buildAuxItemLookup,
  buildAuxItemMatchCondition,
  buildAuxMatchOptions,
  buildAuxNameSelect,
  enrichAuxLedgerEntry,
} from '../utils/auxLedgerQuery.js'
import {
  applyEntryToSignedBalance,
  buildSignedEntryAmountSql,
  calcInitBalanceFromDebitCredit,
} from '../utils/accountBalance.js'
import {
  getCashFlowTrialBalance,
  type CashFlowTrialBalanceScope,
} from '../services/cashFlowTrialBalance.js'
import { getCashFlowVoucherCheck } from '../services/cashFlowVoucherCheck.js'
import { isCashFlowEnabledForAccountSet } from '../services/voucherEntry.js'
import {
  appendAccountScopeCondition,
  assertAccountCodePrefixInScope,
  assertAccountIdInScope,
  assertAccountIdsInScope,
  filterLedgerRowsByScope,
} from '../services/accountAuthorization.js'
import { AUX_BALANCE_ITEM_BATCH, MAX_PAGE_SIZE, parsePageSizeParam } from '../utils/listLimits.js'
import { peekAccountSetStartDate } from '../services/accountSetDefaults.js'
import { hasPreBookColumns, hasForeignPreBookColumns, resolveOpeningBaseYear } from '../services/initBalanceScope.js'
import { resolveClosingExchangeRate } from '../services/fxRevaluation.js'

/** 统一解析「含未记账」布尔参数：兼容 true / 1 / 'true' / '1'（各端点原口径不一） */
function includeUnpostedFlag(raw: unknown): boolean {
  return raw === true || raw === 1 || raw === 'true' || raw === '1'
}

/** 明细/日记/序时账前端会一次性拉较大结果集，设上限避免超大 LIMIT 拖垮服务 */
const MAX_BULK_PAGE_SIZE = 100000
function clampBulkPageSize(raw: unknown, fallback = 100): number {
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return fallback
  return Math.min(Math.floor(n), MAX_BULK_PAGE_SIZE)
}
function clampPage(raw: unknown): number {
  const n = Number(raw)
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1
}

/** 外币余额表一行：本位币与原币成对，与 buildForeignBalanceQuery 的 SELECT 列一一对应 */
interface ForeignBalanceTotals {
  foreign_init_balance: number
  init_balance: number
  foreign_current_debit: number
  current_debit: number
  foreign_current_credit: number
  current_credit: number
  foreign_year_debit: number
  year_debit: number
  foreign_year_credit: number
  year_credit: number
  foreign_end_balance: number
  end_balance: number
}

/**
 * 账套内各外币币种的期末汇率（本位币不返回）。
 * 外币余额表与辅助项目外币余额表共用，回退链完全交给 `resolveClosingExchangeRate`，
 * 不在这里另写一套优先级。
 */
function loadClosingRates(
  db: ReturnType<typeof getDb>,
  accountSetId: string,
  year: number,
  period: number
): Record<string, number> {
  // 汇率只是展示列，老库缺 currencies 表时返回空对象即可，不能让整张余额表 500
  let rows: Array<{ code: string }> = []
  try {
    rows = db
      .prepare(
        `SELECT UPPER(code) AS code FROM currencies
         WHERE account_set_id = ? AND is_enabled = 1 AND COALESCE(is_base, 0) = 0`
      )
      .all(accountSetId) as Array<{ code: string }>
  } catch (error) {
    console.warn('读取币种期末汇率失败，汇率列将为空：', error)
    return {}
  }
  const rates: Record<string, number> = {}
  for (const row of rows) {
    const code = String(row.code || '').trim().toUpperCase()
    if (!code) continue
    rates[code] = resolveClosingExchangeRate(db, accountSetId, code, year, period)
  }
  return rates
}

interface ForeignBalanceRow extends ForeignBalanceTotals {
  account_id: string
  account_code: string
  account_name: string
  direction: 'debit' | 'credit'
  level: number
  currency_code: string | null
}

const router = Router()
router.use(authMiddleware)

// ===================== 总账 =====================

/**
 * FIX-250：余额表类端点的日期收口。缺 start_date/end_date 时：有 year 取该年全年，否则当年全年，
 * 并打一条 warn 便于定位漏传参数的调用方。旧行为回退「当月」会触发 SQLite 窄区间劣化计划（十万级 209 秒）。
 */
function resolveBalanceRouteDates(req: AuthRequest, endpoint: string) {
  const { start_date, end_date, year } = req.query as Record<string, string | undefined>
  if (start_date && end_date) return { startDate: start_date, endDate: end_date }
  const y = Number(year) || new Date().getFullYear()
  const startDate = start_date || `${y}-01-01`
  const endDate = end_date || `${y}-12-31`
  console.warn(`[ledger] ${endpoint} 缺少日期参数，已回退为 ${startDate}~${endDate}（query=${JSON.stringify(req.query)}）`)
  return { startDate, endDate }
}

// 评审 P2 收尾：账簿读接口此前只校验登录，按页面路由的权限码（config/navigation.ts ROUTE_PERMISSION_MAP）补齐；
// 注意路由名与权限 key 的历史错位：/general（科目余额表）= ledger:balance，/general-ledger（总分类账）= ledger:general
router.get('/general', requirePermission('ledger:balance'), (req: AuthRequest, res) => {
  const db = getDb()
  const {
    account_code,
    account_level,
    account_code_start,
    account_code_end,
    filter_types,
    include_unposted,
  } = req.query
  const { startDate, endDate } = resolveBalanceRouteDates(req, '/ledger/general')
  const maxLevel = account_level ? Number(account_level) : undefined

  // 将逗号分隔的字符串转为数组
  let filterTypesArray: string[] | undefined
  if (filter_types && typeof filter_types === 'string') {
    filterTypesArray = filter_types.split(',').filter(t => t.trim())
  }

  const query = buildLedgerGeneralQuery({
    accountSetId: req.accountSetId || '',
    startDate,
    endDate,
    accountCode: account_code as string | undefined,
    accountLevel: undefined, // 不限制级次，确保子科目能正确汇总到父科目
    accountCodeStart: account_code_start as string | undefined,
    accountCodeEnd: account_code_end as string | undefined,
    filterTypes: undefined,
    includeUnposted: includeUnpostedFlag(include_unposted),
    accountScope: req.accountScope,
    accountSetStartDate: peekAccountSetStartDate(db, req.accountSetId || ''),
    preBookEnabled: hasPreBookColumns(db),
    resolveOpeningBaseYear: year => resolveOpeningBaseYear(db, req.accountSetId || '', year),
  })

  let list = db.prepare(query.sql).all(...query.params) as any[]

  // 获取科目编码长度配置
  const codeLengths = getCodeLengths(db, req.accountSetId || '')

  // 补充缺失的父科目
  list = supplementMissingParents(list, db, req.accountSetId || '', codeLengths)

  // 将子科目金额汇总到父科目
  list = accumulateParentBalances(list, codeLengths)
  list = filterLedgerRowsByScope(req.accountScope, list)

  // 汇总完成后，再应用筛选条件
  if (filterTypesArray && filterTypesArray.length > 0) {
    list = list.filter(row => {
      const conditions: boolean[] = []

      if (filterTypesArray.includes('init_balance')) {
        conditions.push(row.init_balance !== 0)
      }

      if (filterTypesArray.includes('has_amount')) {
        conditions.push(row.current_debit !== 0 || row.current_credit !== 0)
      }

      if (filterTypesArray.includes('has_balance')) {
        conditions.push(row.end_balance !== 0)
      }

      return conditions.length === 0 || conditions.some(c => c)
    })
  }

  // 如果指定了科目级次，在汇总计算完成后过滤展示
  if (maxLevel) {
    list = list.filter(row => row.level <= maxLevel)
  }

  res.json({ code: 0, data: list })
})

// ===================== 明细账 =====================

router.get('/detail', requirePermission('ledger:detail'), (req: AuthRequest, res) => {
  const db = getDb()
  const {
    year,
    period,
    account_id,
    start_date,
    end_date,
    aux_type,
    aux_id,
    voucher_type_id,
    maker_name,
    auditor_name,
    summary_keyword,
    min_amount,
    max_amount,
    account_code_start,
    account_code_end,
    currency_code,
    include_unposted,
    page = 1,
    pageSize = 100,
  } = req.query

  if (account_id && typeof account_id === 'string') {
    const scopeErr = assertAccountIdInScope(req.accountScope, account_id)
    if (scopeErr) {
      return res.status(403).json({ code: 403, message: scopeErr })
    }
  }

  const query = buildLedgerDetailQuery({
    accountSetId: req.accountSetId || '',
    year: year as string | number | undefined,
    period: period as string | number | undefined,
    accountId: account_id as string | undefined,
    startDate: start_date as string | undefined,
    endDate: end_date as string | undefined,
    auxType: aux_type as string | undefined,
    auxId: aux_id as string | undefined,
    voucherTypeId: voucher_type_id as string | undefined,
    makerName: maker_name as string | undefined,
    auditorName: auditor_name as string | undefined,
    summaryKeyword: summary_keyword as string | undefined,
    minAmount: parseAmountFilter(min_amount),
    maxAmount: parseAmountFilter(max_amount),
    accountCodeStart: account_code_start as string | undefined,
    accountCodeEnd: account_code_end as string | undefined,
    currencyCode: typeof currency_code === 'string' ? currency_code : undefined,
    includeUnposted: includeUnpostedFlag(include_unposted),
    page: clampPage(page),
    pageSize: clampBulkPageSize(pageSize),
    accountScope: req.accountScope,
    accountSetStartDate: peekAccountSetStartDate(db, req.accountSetId || ''),
    preBookEnabled: hasPreBookColumns(db),
    resolveOpeningBaseYear: year => resolveOpeningBaseYear(db, req.accountSetId || '', year),
  })

  const initBal = db.prepare(query.initBalanceSql).get(...query.initBalanceParams) as any
  const total = (db.prepare(query.countSql).get(...query.countParams) as any).count
  const entries = db.prepare(query.listSql).all(...query.listParams)
  const preBook = db.prepare(query.preBookSql).get(...query.preBookParams) as
    | { pre_book_debit?: number; pre_book_credit?: number }
    | undefined

  const fxInit = db.prepare(query.foreignInitBalanceSql).get(...query.foreignInitBalanceParams) as
    | { foreign_init_balance?: number }
    | undefined
  const foreignInitBalance = Number(fxInit?.foreign_init_balance) || 0

  res.json({
    code: 0,
    data: entries,
    initBalance: initBal?.init_balance || 0,
    foreignInitBalance,
    // 账前发生额：中途启用账套在启用前的累计发生额，无凭证明细，供「本年累计」行累加
    preBookDebit: Number(preBook?.pre_book_debit) || 0,
    preBookCredit: Number(preBook?.pre_book_credit) || 0,
    total
  })
})

// ===================== 凭证汇总表 =====================

/** 指定年月/类型下实际存在的凭证号区间，供条件窗自动填充默认值 */
router.get('/voucher-summary/no-range', requirePermission('ledger:vsummary'), (req: AuthRequest, res) => {
  const db = getDb()
  const { year, period, voucher_type_id, scope } = req.query
  const query = buildVoucherSummaryNoRangeQuery({
    accountSetId: req.accountSetId || '',
    year: Number(year) || new Date().getFullYear(),
    period: Number(period) || new Date().getMonth() + 1,
    voucherTypeId: (voucher_type_id as string) || undefined,
    scope: scope === 'posted' || scope === 'unposted' ? scope : 'all',
  })
  const range = db.prepare(query.sql).get(...query.params) as
    | { min_no?: number; max_no?: number; voucher_count?: number }
    | undefined
  res.json({
    code: 0,
    data: {
      min_voucher_no: Number(range?.min_no) || 0,
      max_voucher_no: Number(range?.max_no) || 0,
      voucher_count: Number(range?.voucher_count) || 0,
    },
  })
})

router.get('/voucher-summary', requirePermission('ledger:vsummary'), (req: AuthRequest, res) => {
  const db = getDb()
  const accountSetId = req.accountSetId || ''
  const { year, period, voucher_type_id, voucher_no_start, voucher_no_end, level, scope } = req.query

  const y = Number(year) || new Date().getFullYear()
  const p = Number(period) || new Date().getMonth() + 1
  const summaryScope = scope === 'posted' || scope === 'unposted' ? scope : 'all'
  const byDetail = level === 'detail'

  const toVoucherNo = (v: unknown) => {
    const n = Number(v)
    return Number.isFinite(n) ? n : undefined
  }

  const query = buildVoucherSummaryQuery({
    accountSetId,
    year: y,
    period: p,
    voucherTypeId: (voucher_type_id as string) || undefined,
    voucherNoStart: toVoucherNo(voucher_no_start),
    voucherNoEnd: toVoucherNo(voucher_no_end),
    scope: summaryScope,
    accountScope: req.accountScope,
  })

  const entryRows = db.prepare(query.sql).all(...query.params) as any[]
  const scoped = filterLedgerRowsByScope(req.accountScope, entryRows)

  let list: any[]
  if (byDetail) {
    list = scoped.map(row => ({
      account_code: row.account_code,
      account_name: row.account_name,
      direction: row.direction,
      level: row.level,
      debit_amount: Number(row.debit_amount) || 0,
      credit_amount: Number(row.credit_amount) || 0,
    }))
  } else {
    // 一级科目：按编码前 N 位归并，科目名取一级科目档案名（缺失时退回明细行的名字）
    const topLength = getCodeLengths(db, accountSetId)[0] || 4
    const grouped = new Map<string, any>()
    for (const row of scoped) {
      const topCode = String(row.account_code || '').slice(0, topLength)
      if (!topCode) continue
      let target = grouped.get(topCode)
      if (!target) {
        const topAccount = db
          .prepare('SELECT name, direction FROM accounts WHERE account_set_id = ? AND code = ?')
          .get(accountSetId, topCode) as { name?: string; direction?: string } | undefined
        target = {
          account_code: topCode,
          account_name: topAccount?.name || row.account_name,
          direction: topAccount?.direction || row.direction,
          level: 1,
          debit_amount: 0,
          credit_amount: 0,
        }
        grouped.set(topCode, target)
      }
      target.debit_amount += Number(row.debit_amount) || 0
      target.credit_amount += Number(row.credit_amount) || 0
    }
    list = [...grouped.values()].sort((a, b) => a.account_code.localeCompare(b.account_code))
  }

  // 表头号段必须反映「实际汇总了哪些凭证」：本期全量号段先查出来，
  // 再与用户填的区间求交集，否则填了 1~1 却显示 1~86，数据对不上也看不出来
  const rangeQuery = buildVoucherSummaryNoRangeQuery({
    accountSetId,
    year: y,
    period: p,
    voucherTypeId: (voucher_type_id as string) || undefined,
    scope: summaryScope,
  })
  const range = db.prepare(rangeQuery.sql).get(...rangeQuery.params) as
    | { min_no?: number; max_no?: number; voucher_count?: number }
    | undefined

  const periodMin = Number(range?.min_no) || 0
  const periodMax = Number(range?.max_no) || 0
  const askedStart = toVoucherNo(voucher_no_start)
  const askedEnd = toVoucherNo(voucher_no_end)

  res.json({
    code: 0,
    data: list,
    meta: {
      year: y,
      period: p,
      min_voucher_no: askedStart != null ? Math.max(askedStart, periodMin) : periodMin,
      max_voucher_no: askedEnd != null ? Math.min(askedEnd, periodMax) : periodMax,
      period_min_voucher_no: periodMin,
      period_max_voucher_no: periodMax,
      voucher_count: Number(range?.voucher_count) || 0,
    },
  })
})

// ===================== 库存数量金额表 =====================

router.get('/quantity-balance', requirePermission('ledger:qty'), (req: AuthRequest, res) => {
  const db = getDb()
  const { account_code, include_unposted } = req.query
  const { startDate, endDate } = resolveBalanceRouteDates(req, '/ledger/quantity-balance')

  if (account_code) {
    const codeErr = assertAccountCodePrefixInScope(
      db,
      req.accountScope,
      req.accountSetId || '',
      String(account_code)
    )
    if (codeErr) {
      return res.status(403).json({ code: 403, message: codeErr })
    }
  }

  const query = buildQuantityBalanceQuery({
    accountSetId: req.accountSetId || '',
    startDate,
    endDate,
    accountCode: account_code as string | undefined,
    includeUnposted: includeUnpostedFlag(include_unposted),
    accountScope: req.accountScope,
    accountSetStartDate: peekAccountSetStartDate(db, req.accountSetId || ''),
    preBookEnabled: hasPreBookColumns(db),
    resolveOpeningBaseYear: year => resolveOpeningBaseYear(db, req.accountSetId || '', year),
  })

  // 数量核算科目按 is_quantity 平铺，不补父科目、不向上汇总
  // （不同子科目计量单位可能不同，数量相加没有业务含义）
  const list = filterLedgerRowsByScope(req.accountScope, db.prepare(query.sql).all(...query.params) as any[])

  const summary = {
    totalQtyCurrentDebit: 0,
    totalCurrentDebit: 0,
    totalQtyCurrentCredit: 0,
    totalCurrentCredit: 0,
    totalQtyYearDebit: 0,
    totalYearDebit: 0,
    totalQtyYearCredit: 0,
    totalYearCredit: 0,
    totalInitBalance: 0,
    totalEndBalance: 0,
  }
  for (const row of list as any[]) {
    summary.totalQtyCurrentDebit += Number(row.qty_current_debit) || 0
    summary.totalCurrentDebit += Number(row.current_debit) || 0
    summary.totalQtyCurrentCredit += Number(row.qty_current_credit) || 0
    summary.totalCurrentCredit += Number(row.current_credit) || 0
    summary.totalQtyYearDebit += Number(row.qty_year_debit) || 0
    summary.totalYearDebit += Number(row.year_debit) || 0
    summary.totalQtyYearCredit += Number(row.qty_year_credit) || 0
    summary.totalYearCredit += Number(row.year_credit) || 0
    summary.totalInitBalance += Number(row.init_balance) || 0
    summary.totalEndBalance += Number(row.end_balance) || 0
  }

  res.json({ code: 0, data: list, summary })
})

// ===================== 外币余额表 =====================

/**
 * 外币余额表。
 *
 * 支持两种时间入参：
 *  - `start_date` / `end_date`：与科目余额表同款日期区间（前端默认走这套）；
 *  - `year` + `period`：旧调用方式，内部换算成该期间的首末日。
 *
 * 响应除数据行外还带：
 *  - `summary`：按币种分桶的合计（结构与辅助外币表的 `foreign_totals` 一致）；
 *  - `rates`：各币种期末汇率，复用期末调汇的 `resolveClosingExchangeRate` 回退链。
 */
router.get('/foreign-balance', requirePermission('ledger:foreign'), (req: AuthRequest, res) => {
  const db = getDb()
  const {
    year,
    period,
    start_date,
    end_date,
    account_code,
    currency_code,
    filter_types,
    include_unposted,
  } = req.query

  const now = new Date()
  const y = Number(year) || now.getFullYear()
  const p = Number(period) || now.getMonth() + 1
  const periodStart = `${y}-${String(p).padStart(2, '0')}-01`
  const periodEnd = `${y}-${String(p).padStart(2, '0')}-${String(new Date(y, p, 0).getDate()).padStart(2, '0')}`

  const startDate = (start_date as string | undefined) || periodStart
  const endDate = (end_date as string | undefined) || periodEnd

  let filterTypesArray: string[] | undefined
  if (filter_types && typeof filter_types === 'string') {
    filterTypesArray = filter_types.split(',').filter(t => t.trim())
  }

  const query = buildForeignBalanceQuery({
    accountSetId: req.accountSetId || '',
    startDate,
    endDate,
    accountCode: account_code as string | undefined,
    currencyCode: currency_code as string | undefined,
    filterTypes: filterTypesArray,
    includeUnposted: includeUnpostedFlag(include_unposted),
    accountScope: req.accountScope,
    accountSetStartDate: peekAccountSetStartDate(db, req.accountSetId || ''),
    preBookEnabled: hasPreBookColumns(db),
    foreignPreBookEnabled: hasForeignPreBookColumns(db),
    resolveOpeningBaseYear: year => resolveOpeningBaseYear(db, req.accountSetId || '', year),
  })
  const list = db.prepare(query.sql).all(...query.params) as ForeignBalanceRow[]

  // 期末汇率按 endDate 所在年月取（区间查询时以结束期间为准，与调汇一致）
  const rateYear = new Date(endDate).getFullYear() || y
  const rateMonth = new Date(endDate).getMonth() + 1 || p
  const rates = loadClosingRates(db, req.accountSetId || '', rateYear, rateMonth)
  const summary: Record<string, ForeignBalanceTotals> = {}

  for (const row of list) {
    const code = String(row.currency_code || '').trim().toUpperCase()
    if (!code) continue
    if (!summary[code]) {
      summary[code] = {
        foreign_init_balance: 0,
        init_balance: 0,
        foreign_current_debit: 0,
        current_debit: 0,
        foreign_current_credit: 0,
        current_credit: 0,
        foreign_year_debit: 0,
        year_debit: 0,
        foreign_year_credit: 0,
        year_credit: 0,
        foreign_end_balance: 0,
        end_balance: 0,
      }
    }
    const bucket = summary[code]
    for (const key of Object.keys(bucket) as Array<keyof ForeignBalanceTotals>) {
      bucket[key] += Number(row[key]) || 0
    }
  }

  res.json({ code: 0, data: list, summary, rates })
})

// 评审 P2：原 GET /ledger/balance（旧余额表）前端早已不再调用，且口径未随余额表后续修复同步（无期初上溯 / 账前发生额年度），已删除；
// 科目余额表走 /ledger/general（buildLedgerGeneralQuery）。

// ===================== 总分类账（带月度汇总） =====================

/**
 * 查询按月透视的科目发生额，并补齐父科目、向上汇总、计算本年累计与期末余额。
 * 总分类账与财务分析（科目分析）共用；后者以 excludeTransfer 排除结转凭证。
 */
function queryMonthlyLedgerRows(
  req: AuthRequest,
  db: ReturnType<typeof getDb>,
  options: {
    year?: string | number
    accountCode?: string
    includeUnposted: boolean
    excludeTransfer?: boolean
  }
) {
  // 注意：不传 accountLevel 给 SQL 查询，确保所有级次的科目都被查询到
  // 这样才能正确汇总子科目到父科目，级次过滤在汇总计算完成后进行
  const query = buildGeneralLedgerQuery({
    accountSetId: req.accountSetId || '',
    year: options.year,
    accountCode: options.accountCode,
    accountLevel: undefined,
    includeUnposted: options.includeUnposted,
    excludeTransfer: options.excludeTransfer,
    accountScope: req.accountScope,
    accountSetStartDate: peekAccountSetStartDate(db, req.accountSetId || ''),
    preBookEnabled: hasPreBookColumns(db),
  })

  let list = db.prepare(query.sql).all(...query.params) as any[]

  const deduplicatedMap = new Map<string, any>()
  ;(list as any[]).forEach(row => {
    if (deduplicatedMap.has(row.account_code)) {
      const existing = deduplicatedMap.get(row.account_code)
      existing.init_balance = (existing.init_balance || 0) + (row.init_balance || 0)
      for (let m = 1; m <= 12; m++) {
        existing[`month${m}_debit`] = (existing[`month${m}_debit`] || 0) + (row[`month${m}_debit`] || 0)
        existing[`month${m}_credit`] = (existing[`month${m}_credit`] || 0) + (row[`month${m}_credit`] || 0)
      }
    } else {
      deduplicatedMap.set(row.account_code, { ...row })
    }
  })
  list = Array.from(deduplicatedMap.values())

  const codeLengths = getCodeLengths(db, req.accountSetId || '')
  list = supplementMissingParentsWithMonths(list, db, req.accountSetId || '', codeLengths)
  list = accumulateParentBalancesWithMonths(list, codeLengths)
  list = filterLedgerRowsByScope(req.accountScope, list)

  return (list as any[]).map(row => {
    let yearDebit = 0
    let yearCredit = 0
    for (let m = 1; m <= 12; m++) {
      yearDebit += (row[`month${m}_debit`] || 0)
      yearCredit += (row[`month${m}_credit`] || 0)
    }
    let endBalance = row.init_balance
    if (row.direction === 'debit') endBalance += yearDebit - yearCredit
    else endBalance += yearCredit - yearDebit
    return { ...row, year_debit: yearDebit, year_credit: yearCredit, end_balance: endBalance }
  })
}

// ===================== 财务分析：科目分析（排除损益结转） =====================

router.get('/subject-analysis', requirePermission('ledger:balance'), (req: AuthRequest, res) => {
  const db = getDb()
  const { year, account_code, include_unposted } = req.query
  const code = String(account_code || '').trim()
  if (!code) {
    res.status(400).json({ code: 1, message: '请指定分析科目' })
    return
  }

  const rows = queryMonthlyLedgerRows(req, db, {
    year: year as string | number | undefined,
    accountCode: code,
    includeUnposted: includeUnpostedFlag(include_unposted),
    excludeTransfer: true,
  })

  // 只返回所选科目及其子孙；父级金额已由子级汇总
  const data = rows
    .filter(row => String(row.account_code).startsWith(code))
    .map(row => {
      const months = Array.from({ length: 12 }, (_, i) => ({
        debit: Number(row[`month${i + 1}_debit`]) || 0,
        credit: Number(row[`month${i + 1}_credit`]) || 0,
      }))
      return {
        account_id: row.account_id,
        account_code: row.account_code,
        account_name: row.account_name,
        direction: row.direction,
        level: row.level,
        is_leaf: !rows.some(
          r => r.account_code !== row.account_code && String(r.account_code).startsWith(row.account_code)
        ),
        init_balance: Number(row.init_balance) || 0,
        months,
        year_debit: row.year_debit,
        year_credit: row.year_credit,
        end_balance: row.end_balance,
      }
    })

  res.json({ code: 0, data })
})

router.get('/general-ledger', requirePermission('ledger:general'), (req: AuthRequest, res) => {
  const db = getDb()
  const { year, account_code, account_level, include_unposted } = req.query
  const maxLevel = account_level ? Number(account_level) : undefined

  const result = queryMonthlyLedgerRows(req, db, {
    year: year as string | number | undefined,
    accountCode: account_code as string | undefined,
    includeUnposted: includeUnpostedFlag(include_unposted),
  })

  // 如果指定了科目级次，在汇总计算完成后过滤展示
  let finalData = result
  if (maxLevel) {
    finalData = (result as any[]).filter(row => row.level <= maxLevel)
  }

  // 合计计算：统一按"叶节点"——数据集中没有任何子项以本科目编码为前缀。
  // 不分级次单独处理，避免"展开到 N 级但实际数据没那么深"时漏掉行（如展开到
  // 3 级但所有科目最深只到 2 级，按 level===3 过滤就空了）。
  const leafData = finalData.filter(
    (row: any) =>
      !finalData.some((r: any) => r.account_code !== row.account_code && r.account_code.startsWith(row.account_code))
  )
  const summary: any = {
    totalInitDebit: 0,
    totalInitCredit: 0,
    totalMonthDebit: {},
    totalMonthCredit: {},
    totalYearDebit: 0,
    totalYearCredit: 0,
    totalEndDebit: 0,
    totalEndCredit: 0,
  }

  // 初始化月度合计
  for (let m = 1; m <= 12; m++) {
    summary.totalMonthDebit[m] = 0
    summary.totalMonthCredit[m] = 0
  }

  for (const row of leafData) {
    // 期初余额
    if (row.init_balance > 0) {
      if (row.direction === 'debit') summary.totalInitDebit += row.init_balance
      else summary.totalInitCredit += row.init_balance
    } else if (row.init_balance < 0) {
      if (row.direction === 'debit') summary.totalInitCredit += Math.abs(row.init_balance)
      else summary.totalInitDebit += Math.abs(row.init_balance)
    }

    // 月度发生额
    for (let m = 1; m <= 12; m++) {
      summary.totalMonthDebit[m] += (row[`month${m}_debit`] || 0)
      summary.totalMonthCredit[m] += (row[`month${m}_credit`] || 0)
    }

    // 本年累计
    summary.totalYearDebit += row.year_debit
    summary.totalYearCredit += row.year_credit

    // 期末余额
    if (row.end_balance > 0) {
      if (row.direction === 'debit') summary.totalEndDebit += row.end_balance
      else summary.totalEndCredit += row.end_balance
    } else if (row.end_balance < 0) {
      if (row.direction === 'debit') summary.totalEndCredit += Math.abs(row.end_balance)
      else summary.totalEndDebit += Math.abs(row.end_balance)
    }
  }

  const y = Number(year) || new Date().getFullYear()
  const voucherStatusCondition = includeUnpostedFlag(include_unposted)
    ? "v.status IN ('draft', 'audited', 'posted')"
    : "v.status = 'posted'"
  const lastMonthRow = db
    .prepare(
      `
      SELECT MAX(CAST(strftime('%m', v.voucher_date) AS INTEGER)) as last_month
      FROM vouchers v
      WHERE v.account_set_id = ?
        AND ${voucherStatusCondition}
        AND v.voucher_date >= ?
        AND v.voucher_date <= ?
    `
    )
    .get(req.accountSetId, `${y}-01-01`, `${y}-12-31`) as { last_month: number | null } | undefined
  const lastActiveMonth = lastMonthRow?.last_month ? Number(lastMonthRow.last_month) : 0

  res.json({ code: 0, data: finalData, summary, lastActiveMonth })
})

// ===================== 日记账 =====================

router.get('/cash-journal', requireAnyPermission('ledger:cash', 'ledger:bank'), (req: AuthRequest, res) => {
  const db = getDb()
  const {
    year,
    period,
    start_date,
    end_date,
    account_id,
    account_type,
    direction,
    min_amount,
    max_amount,
    opposite_account_code,
    include_unposted,
    page = 1,
    pageSize = 100,
  } = req.query

  // 未指定科目范围时不查询全账套，避免误解为「全部科目日记账」
  if (!account_id && !account_type) {
    return res.json({ code: 0, data: [], total: 0, initBalance: 0 })
  }

  if (account_id && typeof account_id === 'string') {
    const scopeErr = assertAccountIdInScope(req.accountScope, account_id)
    if (scopeErr) {
      return res.status(403).json({ code: 403, message: scopeErr })
    }
  }

  const query = buildCashJournalQuery({
    accountSetId: req.accountSetId || '',
    year: year as string | number | undefined,
    period: period as string | number | undefined,
    startDate: start_date as string | undefined,
    endDate: end_date as string | undefined,
    accountId: account_id as string | undefined,
    accountType: account_type as string | undefined,
    direction: direction as string | undefined,
    minAmount: parseAmountFilter(min_amount),
    maxAmount: parseAmountFilter(max_amount),
    oppositeAccountCode: opposite_account_code as string | undefined,
    includeUnposted: includeUnpostedFlag(include_unposted),
    page: clampPage(page),
    pageSize: clampBulkPageSize(pageSize),
    accountScope: req.accountScope,
  })

  const total = (db.prepare(query.countSql).get(...query.countParams) as any).count
  const list = db.prepare(query.listSql).all(...query.listParams)
  const initBal = db.prepare(query.initBalanceSql).get(...query.initBalanceParams) as any
  const carryAmount = db.prepare(query.carryAmountSql).get(...query.carryAmountParams) as any
  let runningBalance = (initBal?.init_balance || 0) + (carryAmount?.carry_amount || 0)

  for (const entry of list as any[]) {
    const accountDirection = entry.account_direction === 'credit' ? 'credit' : 'debit'
    runningBalance = applyEntryToSignedBalance(
      runningBalance,
      entry.amount,
      entry.direction,
      accountDirection
    )
    entry.running_balance = runningBalance
  }

  res.json({ code: 0, data: list, total, initBalance: initBal?.init_balance || 0 })
})

// ===================== 序时账 =====================

router.get('/chronological', requirePermission('ledger:detail'), (req: AuthRequest, res) => {
  const db = getDb()
  const {
    year,
    period,
    start_date,
    end_date,
    include_unposted,
    summary_keyword,
    min_amount,
    max_amount,
    maker_name,
    auditor_name,
    page = 1,
    pageSize = 100,
    skip_count,
  } = req.query

  const query = buildChronologicalQuery({
    accountSetId: req.accountSetId || '',
    year: year as string | number | undefined,
    period: period as string | number | undefined,
    startDate: start_date as string | undefined,
    endDate: end_date as string | undefined,
    includeUnposted: includeUnpostedFlag(include_unposted),
    summaryKeyword: summary_keyword as string | undefined,
    minAmount: parseAmountFilter(min_amount),
    maxAmount: parseAmountFilter(max_amount),
    makerName: maker_name as string | undefined,
    auditorName: auditor_name as string | undefined,
    page: clampPage(page),
    pageSize: clampBulkPageSize(pageSize),
    accountScope: req.accountScope,
  })

  // FIX-253：导出 / 打印分页循环拉全量时（fetchAllPages）只有首页需要 total，
  // 后续页传 skip_count=1 跳过 24 万行 JOIN 的 COUNT（十万级每页省约 0.5s）
  const skipCount = clampPage(page) > 1 && ['1', 'true'].includes(String(skip_count))
  const total = skipCount ? undefined : (db.prepare(query.countSql).get(...query.countParams) as any).count
  const list = db.prepare(query.listSql).all(...query.listParams)
  res.json({ code: 0, data: list, total })
})

// ===================== 辅助项目余额表 =====================

router.post('/aux-balance', requirePermission('ledger:aux'), (req: AuthRequest, res) => {
  const db = getDb()
  const {
    aux_category_ids,
    aux_ids,
    start_date,
    end_date,
    account_code,
    include_unposted,
    page,
    pageSize,
    item_offset,
    item_limit,
    summary_only,
    skip_summary,
    with_foreign,
    currency_code,
    with_quantity,
  } = req.body
  const accountSetId = req.accountSetId!

  // 外币模式（辅助项目外币余额表）：只统计外币核算科目，附加原币期初/发生/期末，并按币种给出合计
  const withForeign = with_foreign === true || with_foreign === 'true'
  const currencyFilter = withForeign && currency_code ? String(currency_code).trim().toUpperCase() : ''
  // 分录币种优先取分录自身，缺失时回退科目档案币种
  const entryCurrencyExpr = `UPPER(COALESCE(NULLIF(ve.currency_code, ''), a.currency_code, ''))`
  const accountCurrencyExpr = `UPPER(COALESCE(a.currency_code, ''))`
  const appendForeignEntryConditions = (conditions: string[], params: any[]) => {
    if (!withForeign) return
    conditions.push('a.is_foreign = 1')
    if (currencyFilter) {
      conditions.push(`${entryCurrencyExpr} = ?`)
      params.push(currencyFilter)
    }
  }
  const foreignAccountJoin = withForeign ? 'JOIN accounts a ON a.id = ve.account_id' : ''

  // 数量模式（辅助项目库存数量金额表）：只统计数量核算科目，附加数量期初/发生/结余。
  // 数量不进 account_balances，与外币一样直接聚合 voucher_entries.quantity。
  const withQuantity = with_quantity === true || with_quantity === 'true'
  const appendQuantityEntryConditions = (conditions: string[], _params: any[]) => {
    if (!withQuantity) return
    conditions.push('a.is_quantity = 1')
  }
  const quantityAccountJoin =
    !withForeign && withQuantity ? 'JOIN accounts a ON a.id = ve.account_id' : ''
  /** 需要 accounts 别名 a 的场景：外币或数量模式各自的 JOIN（两者互斥，不会重复 JOIN） */
  const scopedAccountJoin = foreignAccountJoin || quantityAccountJoin

  const itemOffset = Math.max(0, Number(item_offset) || 0)
  const itemLimitProvided = item_limit !== undefined && item_limit !== null && item_limit !== ''
  const itemLimitNum = itemLimitProvided ? Math.max(0, Number(item_limit) || 0) : null
  const metaOnly = itemLimitNum === 0
  const summaryOnly = summary_only === true || summary_only === 'true'
  const skipSummary = skip_summary === true || skip_summary === 'true'
  const chunkedMode = itemLimitProvided && itemLimitNum !== null && itemLimitNum > 0

  // 参数验证：aux_category_ids 必填，aux_ids 可选（不传时查类别下所有项目）
  if (!aux_category_ids) {
    return res.status(400).json({ code: 1, error: '缺少必要参数：aux_category_ids' })
  }

  const rawCategoryIdArray = (aux_category_ids as string).split(',').filter(id => id.trim())
  const auxIdArray = aux_ids ? (aux_ids as string).split(',').filter(id => id.trim()) : []

  if (rawCategoryIdArray.length === 0) {
    return res.status(400).json({ code: 1, error: '辅助类别不能为空' })
  }

  if (account_code) {
    const codeErr = assertAccountCodePrefixInScope(
      db,
      req.accountScope,
      accountSetId,
      String(account_code)
    )
    if (codeErr) {
      return res.status(403).json({ code: 403, message: codeErr })
    }
  }

  // 现金流量项目本质是凭证级标签而非辅助核算项目，从辅助账簿中剔除（兜底，防止前端漏过滤）
  const cfRows = db
    .prepare(`SELECT id FROM aux_categories WHERE code = 'cash_flow' AND account_set_id = ?`)
    .all(accountSetId) as { id: string }[]
  const cashFlowCatIds = new Set(cfRows.map(r => r.id))
  const categoryIdArray = rawCategoryIdArray.filter(id => !cashFlowCatIds.has(id))

  if (categoryIdArray.length === 0) {
    return res.json({ code: 0, data: [], categoryFields: {}, total: 0, totals: null })
  }

  // 兼容布尔值和字符串
  const statusValue = includeUnpostedFlag(include_unposted)
    ? ['draft', 'audited', 'posted']
    : ['posted']

  const startTime = Date.now()
  const catPlaceholders = categoryIdArray.map(() => '?').join(',')

  // 查询自定义字段定义（meta / 正式查询均需要）
  const fieldDefs = db.prepare(`
    SELECT f.category_id, f.field_key, f.field_name, f.sort_order
    FROM aux_category_fields f
    WHERE f.category_id IN (${catPlaceholders}) AND f.is_enabled = 1
    ORDER BY f.category_id, f.sort_order
  `).all(...categoryIdArray) as any[]

  const categoryMeta = db.prepare(`
    SELECT id, code, name FROM aux_categories WHERE id IN (${catPlaceholders})
  `).all(...categoryIdArray) as any[]

  const categoryFields: Record<string, { name: string; fields: { field_key: string; field_name: string }[] }> = {}
  const categoryNameByCode = new Map<string, string>()
  const categoryIdByCode = new Map<string, string>()
  for (const cat of categoryMeta) {
    categoryNameByCode.set(cat.code, cat.name)
    categoryIdByCode.set(cat.code, cat.id)
    categoryFields[cat.code] = {
      name: cat.name,
      fields: fieldDefs.filter(f => f.category_id === cat.id).map(f => ({ field_key: f.field_key, field_name: f.field_name })),
    }
  }

  const itemsCountRow = db
    .prepare(
      `SELECT COUNT(*) as count FROM aux_items ai WHERE ai.type IN (${catPlaceholders}) AND ai.account_set_id = ?`
    )
    .get(...categoryIdArray, accountSetId) as { count: number }
  const itemsTotal = auxIdArray.length > 0 ? auxIdArray.length : (itemsCountRow?.count ?? 0)

  if (metaOnly) {
    return res.json({
      code: 0,
      data: [],
      total: 0,
      items_total: itemsTotal,
      categoryFields,
      totals: null,
    })
  }

  try {
    // 查询辅助项目信息（同样剔除属于 cash_flow 类目的项目）
    let items: any[]
    if (auxIdArray.length > 0) {
      const itemsPlaceholders = auxIdArray.map(() => '?').join(',')
      const itemsSql = `
        SELECT ai.id, ai.code, ai.name, ai.type as category_id, ac.code as category_code, ac.name as category_name
        FROM aux_items ai
        LEFT JOIN aux_categories ac ON ac.id = ai.type
        WHERE ai.id IN (${itemsPlaceholders}) AND ai.account_set_id = ?
          AND (ac.code IS NULL OR ac.code != 'cash_flow')
      `
      items = db.prepare(itemsSql).all(...auxIdArray, accountSetId) as any[]
    } else if (summaryOnly && auxIdArray.length === 0) {
      items = []
    } else if (chunkedMode || summaryOnly) {
      const limit = summaryOnly ? itemsTotal : Math.min(itemLimitNum!, AUX_BALANCE_ITEM_BATCH)
      const itemsSql = `
        SELECT ai.id, ai.code, ai.name, ai.type as category_id, ac.code as category_code, ac.name as category_name
        FROM aux_items ai
        LEFT JOIN aux_categories ac ON ac.id = ai.type
        WHERE ai.type IN (${catPlaceholders}) AND ai.account_set_id = ?
          AND (ac.code IS NULL OR ac.code != 'cash_flow')
        ORDER BY ac.code, ai.code
        LIMIT ? OFFSET ?
      `
      items = db.prepare(itemsSql).all(...categoryIdArray, accountSetId, limit, itemOffset) as any[]
    } else {
      // 常规分页不再一次读取类别下全部项目；后续按固定批次聚合到临时表。
      items = []
    }

    if (items.length === 0 && !summaryOnly && (auxIdArray.length > 0 || chunkedMode)) {
      return res.json({
        code: 0,
        data: [],
        categoryFields,
        total: 0,
        items_total: itemsTotal,
        items_processed: Math.min(itemOffset + (itemLimitNum ?? 0), itemsTotal),
        totals: null,
      })
    }

    if (!summaryOnly) {
      console.log(`辅助项目余额表：本批处理 ${items.length} 个辅助项目（offset=${itemOffset}）`)
    }

    const groupItemsByCategory = (itemBatch: any[]) => {
      const grouped = new Map<string, any[]>()
      for (const item of itemBatch) {
        if (!item.category_code) continue
        if (!grouped.has(item.category_code)) grouped.set(item.category_code, [])
        grouped.get(item.category_code)!.push(item)
      }
      return grouped
    }
    const itemsByCategory = groupItemsByCategory(items)

    db.exec('DROP TABLE IF EXISTS _tmp_aux_balance_rows')
    db.exec(`CREATE TEMP TABLE _tmp_aux_balance_rows (
      row_key TEXT PRIMARY KEY,
      account_code TEXT,
      account_name TEXT,
      account_direction TEXT,
      aux_id TEXT,
      aux_name TEXT,
      field_values_json TEXT,
      category_code TEXT,
      category_name TEXT,
      currency_code TEXT DEFAULT '',
      init_balance REAL DEFAULT 0,
      current_debit REAL DEFAULT 0,
      current_credit REAL DEFAULT 0,
      end_balance REAL DEFAULT 0,
      foreign_init_balance REAL DEFAULT 0,
      foreign_current_debit REAL DEFAULT 0,
      foreign_current_credit REAL DEFAULT 0,
      foreign_end_balance REAL DEFAULT 0,
      qty_init_balance REAL DEFAULT 0,
      qty_current_debit REAL DEFAULT 0,
      qty_current_credit REAL DEFAULT 0,
      qty_end_balance REAL DEFAULT 0
    )`)
    const upsertAuxBalanceRow = db.prepare(`
      INSERT INTO _tmp_aux_balance_rows (
        row_key, account_code, account_name, account_direction,
        aux_id, aux_name, field_values_json, category_code, category_name, currency_code,
        init_balance, current_debit, current_credit, end_balance,
        foreign_init_balance, foreign_current_debit, foreign_current_credit, foreign_end_balance,
        qty_init_balance, qty_current_debit, qty_current_credit, qty_end_balance
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(row_key) DO UPDATE SET
        account_name=excluded.account_name,
        account_direction=excluded.account_direction,
        aux_name=COALESCE(NULLIF(excluded.aux_name,''), _tmp_aux_balance_rows.aux_name),
        field_values_json=COALESCE(excluded.field_values_json, _tmp_aux_balance_rows.field_values_json),
        category_name=COALESCE(NULLIF(excluded.category_name,''), _tmp_aux_balance_rows.category_name),
        init_balance=_tmp_aux_balance_rows.init_balance + excluded.init_balance,
        current_debit=_tmp_aux_balance_rows.current_debit + excluded.current_debit,
        current_credit=_tmp_aux_balance_rows.current_credit + excluded.current_credit,
        end_balance=_tmp_aux_balance_rows.end_balance + excluded.end_balance,
        foreign_init_balance=_tmp_aux_balance_rows.foreign_init_balance + excluded.foreign_init_balance,
        foreign_current_debit=_tmp_aux_balance_rows.foreign_current_debit + excluded.foreign_current_debit,
        foreign_current_credit=_tmp_aux_balance_rows.foreign_current_credit + excluded.foreign_current_credit,
        foreign_end_balance=_tmp_aux_balance_rows.foreign_end_balance + excluded.foreign_end_balance,
        qty_init_balance=_tmp_aux_balance_rows.qty_init_balance + excluded.qty_init_balance,
        qty_current_debit=_tmp_aux_balance_rows.qty_current_debit + excluded.qty_current_debit,
        qty_current_credit=_tmp_aux_balance_rows.qty_current_credit + excluded.qty_current_credit,
        qty_end_balance=_tmp_aux_balance_rows.qty_end_balance + excluded.qty_end_balance
    `)
    const writeAuxBalanceRows = db.transaction((rows: any[]) => {
      for (const row of rows) {
        const auxId = String(row.aux_id || '')
        if (!auxId) continue
        // 外币模式下同一科目+项目可能出现多个币种（分录币种与科目档案不一致的历史数据），按币种分行
        const rowCurrency = withForeign ? String(row.currency_code || '').toUpperCase() : ''
        upsertAuxBalanceRow.run(
          `${row.account_code}|${row.category_code}|${auxId}|${rowCurrency}`,
          row.account_code,
          row.account_name,
          row.account_direction,
          auxId,
          row.aux_name || '',
          row.field_values_json || null,
          row.category_code,
          row.category_name || '',
          rowCurrency,
          Number(row.init_balance || 0),
          Number(row.current_debit || 0),
          Number(row.current_credit || 0),
          Number(row.end_balance || 0),
          Number(row.foreign_init_balance || 0),
          Number(row.foreign_current_debit || 0),
          Number(row.foreign_current_credit || 0),
          Number(row.foreign_end_balance || 0),
          Number(row.qty_init_balance || 0),
          Number(row.qty_current_debit || 0),
          Number(row.qty_current_credit || 0),
          Number(row.qty_end_balance || 0)
        )
      }
    })

    const statusPlaceholders = statusValue.map(() => '?').join(',')
    const processBalanceItemBatch = (itemBatch: any[]) => {
      const auxLookup = buildAuxItemLookup(itemBatch)
      const groupedItems = groupItemsByCategory(itemBatch)
      for (const [categoryCode, categoryItems] of groupedItems) {
      // SQLite 参数限制为 999，分批查询
      // SQLite 参数上限 999，每个辅助项目最多生成 ~5 个 SQL 参数
      // （JSON 双 key + legacy 列 + 编码匹配），加上基础参数约 20 个，
      // 安全批次 = floor((999 - 20) / 5) ≈ 195，取 150 留余量
      const batchSize = 150
      for (let i = 0; i < categoryItems.length; i += batchSize) {
        const batch = categoryItems.slice(i, i + batchSize)
        const itemIds = batch.map(item => item.id)
        const itemIdsPlaceholders = itemIds.map(() => '?').join(',')
        const matchOpts = buildAuxMatchOptions(categoryCode, categoryIdByCode, batch)
        const auxMatchCondition = buildAuxItemMatchCondition(categoryCode, itemIdsPlaceholders, matchOpts)

        const baseConditions = [
          've.account_set_id = ?',
          `v.status IN (${statusPlaceholders})`,
          auxMatchCondition,
        ]
        const baseParams: any[] = [accountSetId, ...statusValue]
        appendAuxItemMatchParams(baseParams, categoryCode, itemIds, matchOpts)

        if (account_code) {
          baseConditions.push('ve.account_code LIKE ?')
          baseParams.push(`${account_code}%`)
        }

        appendAccountScopeCondition(req.accountScope, 've.account_id', baseConditions, baseParams)
        appendForeignEntryConditions(baseConditions, baseParams)
        appendQuantityEntryConditions(baseConditions, baseParams)

        const buildPeriodAmountSelects = (amountRef: string, prefix: string) => `
            COALESCE(SUM(CASE
              WHEN v.voucher_date >= ? AND v.voucher_date < ? THEN ${buildSignedEntryAmountSql('a.direction', 've.direction', amountRef)}
              ELSE 0
            END), 0) as ${prefix}init_balance,
            COALESCE(SUM(CASE
              WHEN v.voucher_date >= ? AND v.voucher_date <= ? AND ve.direction = 'debit'
              THEN ${amountRef} ELSE 0
            END), 0) as ${prefix}current_debit,
            COALESCE(SUM(CASE
              WHEN v.voucher_date >= ? AND v.voucher_date <= ? AND ve.direction = 'credit'
              THEN ${amountRef} ELSE 0
            END), 0) as ${prefix}current_credit,
            COALESCE(SUM(CASE
              WHEN v.voucher_date >= ? AND v.voucher_date <= ? THEN ${buildSignedEntryAmountSql('a.direction', 've.direction', amountRef)}
              ELSE 0
            END), 0) as ${prefix}end_balance`
        const foreignSelects = withForeign
          ? `,${buildPeriodAmountSelects('COALESCE(ve.foreign_amount, 0)', 'foreign_')}`
          : ''
        const foreignHaving = withForeign
          ? ' OR foreign_init_balance != 0 OR foreign_current_debit != 0 OR foreign_current_credit != 0 OR foreign_end_balance != 0'
          : ''
        const quantitySelects = withQuantity
          ? `,${buildPeriodAmountSelects('COALESCE(ve.quantity, 0)', 'qty_')}`
          : ''
        const quantityHaving = withQuantity
          ? ' OR qty_init_balance != 0 OR qty_current_debit != 0 OR qty_current_credit != 0 OR qty_end_balance != 0'
          : ''
        const sql = `
          SELECT
            ve.account_code,
            ve.account_name,
            a.direction as account_direction,
            ${withForeign ? entryCurrencyExpr : "''"} as currency_code,
            ${buildAuxIdSelect(categoryCode, categoryIdByCode.get(categoryCode))} as aux_id,
            ${buildAuxNameSelect(categoryCode, categoryIdByCode.get(categoryCode))} as aux_name,
            MAX(${buildAuxFieldValuesSelect(categoryCode, categoryIdByCode.get(categoryCode))}) as field_values_json,
            '${categoryCode}' as category_code,
            ${buildPeriodAmountSelects('ve.amount', '')}
            ${foreignSelects}
            ${quantitySelects}
          FROM voucher_entries ve
          JOIN vouchers v ON v.id = ve.voucher_id
          JOIN accounts a ON a.id = ve.account_id
          WHERE ${baseConditions.join(' AND ')}
          GROUP BY ve.account_code, ve.account_name, a.direction, ${withForeign ? entryCurrencyExpr : "''"}, aux_id, aux_name
          HAVING init_balance != 0 OR current_debit != 0 OR current_credit != 0 OR end_balance != 0${foreignHaving}${quantityHaving}
          ORDER BY ve.account_code, aux_name
        `

        // P1-14：凭证期初/期末只累计「当年年初」起的分录，避免与下方 init_balances 表
        // （年结已写入上年余额）合并时把上年活动重复计入
        const auxYearStartDate = start_date
          ? `${new Date(start_date).getFullYear()}-01-01`
          : '1900-01-01'
        const periodDateParams = [
          auxYearStartDate,                 // init 下限：当年年初
          start_date || '1900-01-01',       // init 上限：< start_date
          start_date || '1900-01-01',       // current_debit >=
          end_date || '9999-12-31',         // current_debit <=
          start_date || '1900-01-01',       // current_credit >=
          end_date || '9999-12-31',         // current_credit <=
          auxYearStartDate,                 // end_balance 下限：当年年初
          end_date || '9999-12-31',         // end_balance 上限：<= end_date
        ]
        const balanceParams = [
          ...periodDateParams,
          ...(withForeign ? periodDateParams : []),
          ...(withQuantity ? periodDateParams : []),
          ...baseParams,
        ]

        const batchResults = db.prepare(sql).all(...balanceParams) as any[]
        for (const row of batchResults) {
          enrichAuxLedgerEntry(row, categoryCode, categoryNameByCode, auxLookup)
          const token = String(row.aux_id || '')
          const itemMeta = auxLookup.byId.get(token) || auxLookup.byCode.get(`${categoryCode}:${token}`)
          if (itemMeta) {
            row.aux_id = itemMeta.id
            if (!row.aux_name || row.aux_name === 'null') row.aux_name = itemMeta.name
          }
        }
        writeAuxBalanceRows(batchResults)
      }
      }
    }

    const loadReferencedItems = () => {
      const referencedItems: any[] = []
      for (const category of categoryMeta) {
        const rawAuxId = buildAuxIdSelect(category.code, category.id)
        const conditions = [
          've.account_set_id=?',
          `v.status IN (${statusPlaceholders})`,
          `(${rawAuxId}) IS NOT NULL`,
        ]
        const params: any[] = [
          accountSetId,
          category.id,
          accountSetId,
          ...statusValue,
        ]
        if (account_code) {
          conditions.push('ve.account_code LIKE ?')
          params.push(`${account_code}%`)
        }
        appendAccountScopeCondition(req.accountScope, 've.account_id', conditions, params)
        appendForeignEntryConditions(conditions, params)
        appendQuantityEntryConditions(conditions, params)
        const rows = db
          .prepare(
            `SELECT DISTINCT matched_ai.id, matched_ai.code, matched_ai.name,
                    matched_ai.type as category_id,
                    ? as category_code, ? as category_name
             FROM voucher_entries ve
             JOIN vouchers v ON v.id=ve.voucher_id
             ${scopedAccountJoin}
             JOIN aux_items matched_ai
               ON matched_ai.account_set_id=? AND matched_ai.type=?
              AND (matched_ai.id=(${rawAuxId}) OR matched_ai.code=(${rawAuxId}))
             WHERE ${conditions.join(' AND ')}`
          )
          .all(category.code, category.name, ...params) as any[]
        referencedItems.push(...rows)
      }
      for (const [code, rows] of groupItemsByCategory(referencedItems)) {
        itemsByCategory.set(code, rows)
      }
      return referencedItems
    }

    if (!summaryOnly) {
      if (items.length > 0) {
        processBalanceItemBatch(items)
      } else {
        // 全类别查询只解析凭证中实际出现过的项目。项目档案很多但凭证较少时，
        // 不再遍历全部档案；纯期初项目由下方 init_balances 合并。
        const referencedItems = loadReferencedItems()
        processBalanceItemBatch(referencedItems)
      }
    } else if (itemsByCategory.size === 0) {
      // 汇总模式同样需要发现凭证中实际引用的项目，否则临时 entry id 表为空，合计会被错误算成 0。
      loadReferencedItems()
    }

    if (!summaryOnly) {
      const rowCount = (db.prepare('SELECT COUNT(*) AS count FROM _tmp_aux_balance_rows').get() as any)?.count || 0
      console.log(`辅助项目余额表：聚合 ${rowCount} 条余额明细到临时表`)
    }

    // ===== 合并 init_balances 表中的辅助期初 =====
    const initYear = start_date ? new Date(start_date).getFullYear() : new Date().getFullYear()
    const accountCodeFilter = account_code ? ` AND a.code LIKE ?` : ''
    const initForeignFilter = withForeign
      ? ` AND a.is_foreign = 1${currencyFilter ? ` AND ${accountCurrencyExpr} = ?` : ''}`
      : ''
    const initQuantityFilter = withQuantity ? ' AND a.is_quantity = 1' : ''
    const initBalanceSql = `
      SELECT a.code as account_code, a.name as account_name, a.direction,
             ${withForeign ? accountCurrencyExpr : "''"} as currency_code,
             ib.aux_item_id, ib.init_balance, ib.init_debit, ib.init_credit,
             COALESCE(ib.foreign_init_balance, 0) as foreign_init_balance,
             COALESCE(ib.qty_init_balance, 0) as qty_init_balance
      FROM init_balances ib
      JOIN accounts a ON a.id = ib.account_id
      WHERE ib.account_set_id = ? AND ib.year = ? AND ib.aux_item_id != ''
      ${accountCodeFilter}${initForeignFilter}${initQuantityFilter}
    `
    const initBalanceParams: any[] = [accountSetId, initYear]
    if (account_code) initBalanceParams.push(`${account_code}%`)
    if (withForeign && currencyFilter) initBalanceParams.push(currencyFilter)
    const auxInitStatement = db.prepare(initBalanceSql)
    const iterateAuxInitRows = () => auxInitStatement.iterate(...initBalanceParams) as Iterable<any>
    const auxInitRowCount = (
      db.prepare(`SELECT COUNT(*) AS count FROM (${initBalanceSql})`).get(...initBalanceParams) as any
    )?.count || 0

    const selectedCategoryCodes = new Set(
      auxIdArray.length > 0 || chunkedMode
        ? Array.from(itemsByCategory.keys())
        : categoryMeta.map((cat: any) => String(cat.code))
    )
    const selectedCategoryFilterCodes = new Set(categoryMeta.map((c: any) => c.code))
    const selectedItemIdsByCat = new Map<string, Set<string>>()
    for (const [code, arr] of itemsByCategory) {
      selectedItemIdsByCat.set(code, new Set(arr.map((it: any) => String(it.id))))
    }
    const restrictItemIds = auxIdArray.length > 0 || (chunkedMode && !summaryOnly)
    const categoryIdBySelectedCode = new Map(categoryMeta.map((cat: any) => [String(cat.code), String(cat.id)]))
    const resolveInitAuxItem = db.prepare(
      `SELECT id, name FROM aux_items
       WHERE account_set_id=? AND type=? AND (id=? OR code=?) LIMIT 1`
    )

    if (!summaryOnly) {
    const initBalanceWriteBuffer: any[] = []
    for (const row of iterateAuxInitRows()) {
      const parts = row.aux_item_id.split('|')
      // aux_item_id 单类目格式 `code:itemId`，组合格式 `code1:id1|code2:id2`
      // 取每个部分分别处理（与多类目分标签录入一致）
      for (const part of parts) {
        const idx = part.indexOf(':')
        if (idx <= 0) continue
        const categoryCode = part.slice(0, idx)
        const itemToken = part.slice(idx + 1)
        if (!selectedCategoryCodes.has(categoryCode)) continue
        const categoryId = categoryIdBySelectedCode.get(categoryCode)
        if (!categoryId) continue
        const resolvedItem = resolveInitAuxItem.get(
          accountSetId,
          categoryId,
          itemToken,
          itemToken
        ) as { id: string; name: string } | undefined
        if (!resolvedItem) continue
        const itemId = resolvedItem.id
        if (restrictItemIds) {
          const allowedIds = selectedItemIdsByCat.get(categoryCode)
          if (!allowedIds || !allowedIds.size || !allowedIds.has(itemId)) continue
        }

        const initDebit = row.init_debit || 0
        const initCredit = row.init_credit || 0
        const initBalance = calcInitBalanceFromDebitCredit(
          row.direction === 'credit' ? 'credit' : 'debit',
          initDebit,
          initCredit,
          row.init_balance
        )
        const foreignInitBalance = withForeign ? Number(row.foreign_init_balance) || 0 : 0
        const qtyInitBalance = withQuantity ? Number(row.qty_init_balance) || 0 : 0
        initBalanceWriteBuffer.push({
          account_code: row.account_code,
          account_name: row.account_name,
          account_direction: row.direction === 'credit' ? 'credit' : 'debit',
          currency_code: row.currency_code || '',
          aux_id: itemId,
          aux_name: resolvedItem.name || '',
          field_values_json: null,
          category_code: categoryCode,
          category_name: categoryNameByCode.get(categoryCode) || categoryCode,
          init_balance: initBalance,
          current_debit: 0,
          current_credit: 0,
          end_balance: initBalance,
          foreign_init_balance: foreignInitBalance,
          foreign_current_debit: 0,
          foreign_current_credit: 0,
          foreign_end_balance: foreignInitBalance,
          qty_init_balance: qtyInitBalance,
          qty_current_debit: 0,
          qty_current_credit: 0,
          qty_end_balance: qtyInitBalance,
        })
        if (initBalanceWriteBuffer.length >= 500) {
          writeAuxBalanceRows(initBalanceWriteBuffer)
          initBalanceWriteBuffer.length = 0
        }
      }
    }
    if (initBalanceWriteBuffer.length > 0) writeAuxBalanceRows(initBalanceWriteBuffer)
    }

    if (!summaryOnly) {
      const rowCount = (db.prepare('SELECT COUNT(*) AS count FROM _tmp_aux_balance_rows').get() as any)?.count || 0
      console.log(`辅助项目余额表：合并辅助期初 ${auxInitRowCount} 条，临时表共 ${rowCount} 条明细`)
    }

    let grandTotals = {
      init_balance: 0,
      current_debit: 0,
      current_credit: 0,
      end_balance: 0,
      qty_init_balance: 0,
      qty_current_debit: 0,
      qty_current_credit: 0,
      qty_end_balance: 0,
    }
    // 原币与本位币成对：多币种时前端要按币种出小计行，只有原币不够
    type ForeignTotals = {
      foreign_init_balance: number
      init_balance: number
      foreign_current_debit: number
      current_debit: number
      foreign_current_credit: number
      current_credit: number
      foreign_end_balance: number
      end_balance: number
    }
    // 外币模式：不同币种的原币不能相加，按币种分别合计
    const foreignTotalsByCurrency: Record<string, ForeignTotals> = {}

    if (!skipSummary) {
    // ===== 独立查询科目汇总行余额（临时表去重，避免多类目重复计算同一分录）=====
    // 当用户选多个辅助类目时，同一条分录可能命中多个类目查询（如既有 dept 又有 person 标签），
    // 若直接把明细行加总会导致同一笔金额被多次累加。
    // 用临时表收集所有匹配的 voucher_entry ID（自动去重），再做科目维度汇总，
    // 同时避免 OR 合并所有类目条件导致 SQL 参数超过 SQLite 999 上限。
    db.exec('CREATE TEMP TABLE IF NOT EXISTS _tmp_aux_entry_ids (entry_id TEXT)')
    db.exec('DELETE FROM _tmp_aux_entry_ids')

    const insertEntryId = db.prepare('INSERT INTO _tmp_aux_entry_ids (entry_id) VALUES (?)')
    const summaryBatchSize = 150

    const fillTempTableForCategoryItems = (catCode: string, catItems: any[]) => {
      for (let i = 0; i < catItems.length; i += summaryBatchSize) {
        const batch = catItems.slice(i, i + summaryBatchSize)
        const ids = batch.map((it: any) => it.id)
        const ph = ids.map(() => '?').join(',')
        const matchOpts = buildAuxMatchOptions(catCode, categoryIdByCode, batch)
        const auxCond = buildAuxItemMatchCondition(catCode, ph, matchOpts)

        const conds = [
          've.account_set_id = ?',
          `v.status IN (${statusPlaceholders})`,
          auxCond,
        ]
        const params: any[] = [accountSetId, ...statusValue]
        appendAuxItemMatchParams(params, catCode, ids, matchOpts)

        if (account_code) {
          conds.push('ve.account_code LIKE ?')
          params.push(`${account_code}%`)
        }
        appendAccountScopeCondition(req.accountScope, 've.account_id', conds, params)
        appendForeignEntryConditions(conds, params)
        appendQuantityEntryConditions(conds, params)

        const selectSql = `
          SELECT DISTINCT ve.id
          FROM voucher_entries ve
          JOIN vouchers v ON v.id = ve.voucher_id
          ${scopedAccountJoin}
          WHERE ${conds.join(' AND ')}
        `
        const entryRows = db.prepare(selectSql).all(...params) as { id: string }[]
        const insertMany = db.transaction((rows: { id: string }[]) => {
          for (const row of rows) {
            insertEntryId.run(row.id)
          }
        })
        insertMany(entryRows)
      }
    }

    for (const [catCode, catItems] of itemsByCategory) {
      fillTempTableForCategoryItems(catCode, catItems)
    }

    const buildSummaryAmountSelects = (amountRef: string, prefix: string) => {
      const signed = buildSignedEntryAmountSql('a.direction', 've.direction', amountRef)
      // FIX-151：与明细路径（P1-14）同口径——期初 / 期末凭证只累计当年年初起的分录，
      // 否则与 init_balances 年结行合并时把上年活动重复计入
      return `
        COALESCE(SUM(CASE
          WHEN v.voucher_date >= ? AND v.voucher_date < ? THEN ${signed}
          ELSE 0
        END), 0) as ${prefix}init_balance,
        COALESCE(SUM(CASE
          WHEN v.voucher_date >= ? AND v.voucher_date <= ? AND ve.direction = 'debit'
          THEN ${amountRef} ELSE 0
        END), 0) as ${prefix}current_debit,
        COALESCE(SUM(CASE
          WHEN v.voucher_date >= ? AND v.voucher_date <= ? AND ve.direction = 'credit'
          THEN ${amountRef} ELSE 0
        END), 0) as ${prefix}current_credit,
        COALESCE(SUM(CASE
          WHEN v.voucher_date >= ? AND v.voucher_date <= ? THEN ${signed}
          ELSE 0
        END), 0) as ${prefix}end_balance`
    }
    const accountSummarySql = `
      SELECT
        ve.account_code,
        ve.account_name,
        a.direction as account_direction,
        ${withForeign ? entryCurrencyExpr : "''"} as currency_code,
        ${buildSummaryAmountSelects('ve.amount', '')}
        ${withForeign ? `,${buildSummaryAmountSelects('COALESCE(ve.foreign_amount, 0)', 'foreign_')}` : ''}
        ${withQuantity ? `,${buildSummaryAmountSelects('COALESCE(ve.quantity, 0)', 'qty_')}` : ''}
      FROM voucher_entries ve
      JOIN vouchers v ON v.id = ve.voucher_id
      JOIN accounts a ON a.id = ve.account_id
      WHERE ve.id IN (SELECT DISTINCT entry_id FROM _tmp_aux_entry_ids)
      GROUP BY ve.account_code, ve.account_name, a.direction, ${withForeign ? entryCurrencyExpr : "''"}
    `
    const summaryYearStartDate = start_date ? `${new Date(start_date).getFullYear()}-01-01` : '1900-01-01'
    const summaryDateParams = [
      summaryYearStartDate,             // init 下限：当年年初
      start_date || '1900-01-01',       // init 上限：< start_date
      start_date || '1900-01-01',
      end_date || '9999-12-31',
      start_date || '1900-01-01',
      end_date || '9999-12-31',
      summaryYearStartDate,             // end 下限：当年年初
      end_date || '9999-12-31',
    ]
    const accountSummaryBalanceParams = [
      ...summaryDateParams,
      ...(withForeign ? summaryDateParams : []),
      ...(withQuantity ? summaryDateParams : []),
    ]
    const accountSummaryRows = db.prepare(accountSummarySql).all(...accountSummaryBalanceParams) as any[]

    // 清理临时表
    db.exec('DROP TABLE IF EXISTS _tmp_aux_entry_ids')

    // 科目汇总余额 Map（来自凭证，不含 init_balances 期初）；外币模式按「科目|币种」分键
    type AccountSummary = {
      init_balance: number
      current_debit: number
      current_credit: number
      end_balance: number
      foreign_init_balance: number
      foreign_current_debit: number
      foreign_current_credit: number
      foreign_end_balance: number
      qty_init_balance: number
      qty_current_debit: number
      qty_current_credit: number
      qty_end_balance: number
      currency_code: string
      account_direction: 'debit' | 'credit'
    }
    const summaryKey = (acctCode: string, currency: string) => `${acctCode}|${withForeign ? currency : ''}`
    const accountSummaryMap = new Map<string, AccountSummary>()
    for (const row of accountSummaryRows) {
      const currency = String(row.currency_code || '').toUpperCase()
      accountSummaryMap.set(summaryKey(row.account_code, currency), {
        init_balance: row.init_balance || 0,
        current_debit: row.current_debit || 0,
        current_credit: row.current_credit || 0,
        end_balance: row.end_balance || 0,
        foreign_init_balance: row.foreign_init_balance || 0,
        foreign_current_debit: row.foreign_current_debit || 0,
        foreign_current_credit: row.foreign_current_credit || 0,
        foreign_end_balance: row.foreign_end_balance || 0,
        qty_init_balance: row.qty_init_balance || 0,
        qty_current_debit: row.qty_current_debit || 0,
        qty_current_credit: row.qty_current_credit || 0,
        qty_end_balance: row.qty_end_balance || 0,
        currency_code: currency,
        account_direction: row.account_direction === 'credit' ? 'credit' : 'debit',
      })
    }

    // 把 init_balances 的辅助期初也折入科目汇总
    // （辅助期初已合并到临时结果表，这里对科目汇总单独加一遍）
    // 修复：一行 aux_item_id 可能形如 "cash_flow:xxx|person:yyy"（组合），
    // 按 parts 累加会把同一行算多次，应"命中即一次"。
    const accountInitMap = new Map<
      string,
      {
        account_code: string
        currency_code: string
        initBalance: number
        foreignInitBalance: number
        qtyInitBalance: number
        account_direction: 'debit' | 'credit'
      }
    >()
    for (const row of iterateAuxInitRows()) {
      let hit = false
      for (const part of String(row.aux_item_id).split('|')) {
        const idx = part.indexOf(':')
        if (idx <= 0) continue
        const catCode = part.slice(0, idx)
        const itemToken = part.slice(idx + 1)
        if (!selectedCategoryFilterCodes.has(catCode)) continue
        if (restrictItemIds) {
          const categoryId = categoryIdBySelectedCode.get(catCode)
          if (!categoryId) continue
          const resolvedItem = resolveInitAuxItem.get(
            accountSetId,
            categoryId,
            itemToken,
            itemToken
          ) as { id: string } | undefined
          if (!resolvedItem) continue
          const allowedIds = selectedItemIdsByCat.get(catCode)
          if (!allowedIds || !allowedIds.size || !allowedIds.has(resolvedItem.id)) continue
        }
        hit = true
        break
      }
      if (hit) {
        const initBalance = calcInitBalanceFromDebitCredit(
          row.direction === 'credit' ? 'credit' : 'debit',
          row.init_debit || 0,
          row.init_credit || 0,
          row.init_balance
        )
        const currency = String(row.currency_code || '').toUpperCase()
        const key = summaryKey(row.account_code, currency)
        const existing = accountInitMap.get(key)
        accountInitMap.set(key, {
          account_code: row.account_code,
          currency_code: currency,
          initBalance: (existing?.initBalance || 0) + initBalance,
          foreignInitBalance:
            (existing?.foreignInitBalance || 0) + (withForeign ? Number(row.foreign_init_balance) || 0 : 0),
          qtyInitBalance:
            (existing?.qtyInitBalance || 0) + (withQuantity ? Number(row.qty_init_balance) || 0 : 0),
          account_direction: row.direction === 'credit' ? 'credit' : 'debit',
        })
      }
    }
    for (const [key, initInfo] of accountInitMap) {
      const existing = accountSummaryMap.get(key)
      if (existing) {
        existing.init_balance += initInfo.initBalance
        existing.end_balance += initInfo.initBalance
        existing.foreign_init_balance += initInfo.foreignInitBalance
        existing.foreign_end_balance += initInfo.foreignInitBalance
        existing.qty_init_balance += initInfo.qtyInitBalance
        existing.qty_end_balance += initInfo.qtyInitBalance
      } else {
        // 只有期初、无凭证的科目
        accountSummaryMap.set(key, {
          init_balance: initInfo.initBalance,
          current_debit: 0,
          current_credit: 0,
          end_balance: initInfo.initBalance,
          foreign_init_balance: initInfo.foreignInitBalance,
          foreign_current_debit: 0,
          foreign_current_credit: 0,
          foreign_end_balance: initInfo.foreignInitBalance,
          qty_init_balance: initInfo.qtyInitBalance,
          qty_current_debit: 0,
          qty_current_credit: 0,
          qty_end_balance: initInfo.qtyInitBalance,
          currency_code: initInfo.currency_code,
          account_direction: initInfo.account_direction,
        })
      }
    }

    for (const accSum of accountSummaryMap.values()) {
      grandTotals.init_balance += accSum.init_balance || 0
      grandTotals.current_debit += accSum.current_debit || 0
      grandTotals.current_credit += accSum.current_credit || 0
      grandTotals.end_balance += accSum.end_balance || 0
      grandTotals.qty_init_balance += accSum.qty_init_balance || 0
      grandTotals.qty_current_debit += accSum.qty_current_debit || 0
      grandTotals.qty_current_credit += accSum.qty_current_credit || 0
      grandTotals.qty_end_balance += accSum.qty_end_balance || 0
      if (withForeign) {
        const currency = accSum.currency_code || ''
        const bucket = (foreignTotalsByCurrency[currency] ||= {
          foreign_init_balance: 0,
          init_balance: 0,
          foreign_current_debit: 0,
          current_debit: 0,
          foreign_current_credit: 0,
          current_credit: 0,
          foreign_end_balance: 0,
          end_balance: 0,
        })
        bucket.foreign_init_balance += accSum.foreign_init_balance || 0
        bucket.init_balance += accSum.init_balance || 0
        bucket.foreign_current_debit += accSum.foreign_current_debit || 0
        bucket.current_debit += accSum.current_debit || 0
        bucket.foreign_current_credit += accSum.foreign_current_credit || 0
        bucket.current_credit += accSum.current_credit || 0
        bucket.foreign_end_balance += accSum.foreign_end_balance || 0
        bucket.end_balance += accSum.end_balance || 0
      }
    }
    }
    const foreignTotals = withForeign ? foreignTotalsByCurrency : undefined
    // 汇率列数据源：与外币余额表同一条回退链，按结束日期所在年月取期末汇率
    const rateBase = new Date(String(end_date || '') || Date.now())
    const foreignRates = withForeign
      ? loadClosingRates(db, accountSetId, rateBase.getFullYear(), rateBase.getMonth() + 1)
      : undefined

    if (summaryOnly) {
      const queryTime = Date.now() - startTime
      console.log(`辅助项目余额表：合计查询完成，耗时 ${queryTime}ms`)
      return res.json({
        code: 0,
        data: [],
        total: 0,
        items_total: itemsTotal,
        totals: grandTotals,
        foreign_totals: foreignTotals,
        rates: foreignRates,
        categoryFields,
      })
    }

    const hydrateRows = (rows: any[]) => rows.map(detail => {
      let field_values: Record<string, any> = {}
      try {
        if (detail.field_values_json) {
          field_values = JSON.parse(detail.field_values_json)
        }
      } catch {}

      return {
        ...detail,
        direction: detail.account_direction,
        field_values,
        field_values_json: undefined,
      }
    })

    const itemsProcessed = Math.min(
      itemOffset + (chunkedMode ? items.length : itemsTotal),
      itemsTotal
    )
    const queryTime = Date.now() - startTime

    if (chunkedMode) {
      const flatRows = hydrateRows(
        db.prepare(
          `SELECT * FROM _tmp_aux_balance_rows
           ORDER BY account_code, category_code, aux_name, aux_id, currency_code`
        ).all() as any[]
      )
      console.log(
        `辅助项目余额表：分批查询完成，耗时 ${queryTime}ms，本批明细 ${flatRows.length} 行，项目进度 ${itemsProcessed}/${itemsTotal}`
      )
      return res.json({
        code: 0,
        data: flatRows,
        total: flatRows.length,
        chunk_rows: flatRows.length,
        items_total: itemsTotal,
        items_processed: itemsProcessed,
        totals: skipSummary ? null : grandTotals,
        foreign_totals: skipSummary ? undefined : foreignTotals,
        rates: foreignRates,
        categoryFields,
      })
    }

    const totalRows = Number(
      (db.prepare('SELECT COUNT(*) AS count FROM _tmp_aux_balance_rows').get() as any)?.count || 0
    )
    const currentPage = Math.max(1, Number(page) || 1)
    const pageSizeNum = Math.max(1, Math.min(Number(pageSize) || 50, MAX_PAGE_SIZE))
    const offset = (currentPage - 1) * pageSizeNum
    const pagedResults = hydrateRows(
      db.prepare(
        `SELECT * FROM _tmp_aux_balance_rows
         ORDER BY account_code, category_code, aux_name, aux_id, currency_code
         LIMIT ? OFFSET ?`
      ).all(pageSizeNum, offset) as any[]
    )

    console.log(
      `辅助项目余额表：查询完成，耗时 ${queryTime}ms，明细 ${totalRows} 行，返回第 ${currentPage} 页 ${pagedResults.length} 行`
    )

    res.json({
      code: 0,
      data: pagedResults,
      total: totalRows,
      items_total: itemsTotal,
      totals: skipSummary ? null : grandTotals,
      foreign_totals: skipSummary ? undefined : foreignTotals,
      rates: foreignRates,
      categoryFields,
    })
  } catch (error: any) {
    console.error('辅助项目余额表查询失败:', error)
    res.status(500).json({ code: 1, error: error.message || '查询失败' })
  }
})

// ===================== 辅助项目明细账 =====================

router.post('/aux-detail', requirePermission('ledger:aux'), (req: AuthRequest, res) => {
  const db = getDb()
  const {
    aux_category_ids,
    aux_ids,
    start_date,
    end_date,
    account_code,
    summary_keyword,
    min_amount,
    max_amount,
    maker_name,
    auditor_name,
    include_unposted,
    page,
    pageSize,
  } = req.body
  const accountSetId = req.accountSetId!

  console.log('辅助明细账查询参数:', { aux_category_ids, aux_ids, page, pageSize, start_date, end_date })

  // 参数验证：aux_category_ids 必填，aux_ids 可选（不传时查类别下所有项目）
  if (!aux_category_ids) {
    return res.status(400).json({ code: 1, error: '缺少必要参数：aux_category_ids' })
  }

  const rawCategoryIdArray = (aux_category_ids as string).split(',').filter(id => id.trim())
  const auxIdArray = aux_ids ? (aux_ids as string).split(',').filter(id => id.trim()) : []

  if (rawCategoryIdArray.length === 0) {
    return res.status(400).json({ code: 1, error: '辅助类别不能为空' })
  }

  if (account_code) {
    const codeErr = assertAccountCodePrefixInScope(
      db,
      req.accountScope,
      accountSetId,
      String(account_code)
    )
    if (codeErr) {
      return res.status(403).json({ code: 403, message: codeErr })
    }
  }

  // 现金流量项目本质是凭证级标签而非辅助核算项目，从辅助账簿中剔除（兜底，防止前端漏过滤）
  const cfRowsDetail = db
    .prepare(`SELECT id FROM aux_categories WHERE code = 'cash_flow' AND account_set_id = ?`)
    .all(accountSetId) as { id: string }[]
  const cashFlowCatIdsDetail = new Set(cfRowsDetail.map(r => r.id))
  const categoryIdArray = rawCategoryIdArray.filter(id => !cashFlowCatIdsDetail.has(id))

  if (categoryIdArray.length === 0) {
    return res.json({ code: 0, data: [], initBalance: 0, categoryFields: {}, total: 0 })
  }

  // 构建凭证状态过滤条件（兼容布尔值和字符串）
  const statusValue = includeUnpostedFlag(include_unposted)
    ? ['draft', 'audited', 'posted']
    : ['posted']
  const statusPlaceholders = statusValue.map(() => '?').join(',')

  try {
    // 查询辅助项目信息：如果指定了 aux_ids 则按 ID 查，否则查类别下所有项目
    // 同样剔除属于 cash_flow 类目的项目
    let items: any[]
    if (auxIdArray.length > 0) {
      const itemsPlaceholders = auxIdArray.map(() => '?').join(',')
      const itemsSql = `
        SELECT ai.id, ai.code, ai.name, ai.type, ac.code as category_code, ac.name as category_name
        FROM aux_items ai
        LEFT JOIN aux_categories ac ON ac.id = ai.type
        WHERE ai.id IN (${itemsPlaceholders}) AND ai.account_set_id = ?
          AND (ac.code IS NULL OR ac.code != 'cash_flow')
      `
      items = db.prepare(itemsSql).all(...auxIdArray, accountSetId) as any[]
    } else {
      // 未指定项目时不再把类别下全部项目读入 Node 内存；后续按类别使用
      // EXISTS(aux_items) 直接匹配有效项目，并只解析当前页涉及的项目。
      items = []
    }

    if (auxIdArray.length > 0 && items.length === 0) {
      console.log('辅助明细账：未找到辅助项目')
      return res.json({ code: 0, data: [], initBalance: 0, categoryFields: {}, total: 0 })
    }

    console.log('辅助明细账：指定辅助项目数量:', items.length)
    if (items.length > 0) {
      console.log('辅助明细账：第一个项目示例:', {
        id: items[0].id,
        code: items[0].code,
        name: items[0].name,
        category_code: items[0].category_code
      })
    }

    // 查询所选类别的自定义字段定义
    const catPlaceholders2 = categoryIdArray.map(() => '?').join(',')
    const fieldDefs = db.prepare(`
      SELECT f.category_id, f.field_key, f.field_name, f.sort_order
      FROM aux_category_fields f
      WHERE f.category_id IN (${catPlaceholders2}) AND f.is_enabled = 1
      ORDER BY f.category_id, f.sort_order
    `).all(...categoryIdArray) as any[]

    const categoryMeta = db.prepare(`
      SELECT id, code, name FROM aux_categories WHERE id IN (${catPlaceholders2})
    `).all(...categoryIdArray) as any[]

    const categoryFields: Record<string, { name: string; fields: { field_key: string; field_name: string }[] }> = {}
    const categoryNameByCode = new Map<string, string>()
    const categoryIdByCode = new Map<string, string>()
    for (const cat of categoryMeta) {
      categoryNameByCode.set(cat.code, cat.name)
      categoryIdByCode.set(cat.code, cat.id)
      categoryFields[cat.code] = {
        name: cat.name,
        fields: fieldDefs.filter((f: any) => f.category_id === cat.id).map((f: any) => ({ field_key: f.field_key, field_name: f.field_name })),
      }
    }

    const auxLookup = buildAuxItemLookup(items)

    // 按类别分组辅助项目
    const itemsByCategory = new Map<string, any[]>()
    for (const item of items) {
      if (!item.category_code) continue
      if (!itemsByCategory.has(item.category_code)) {
        itemsByCategory.set(item.category_code, [])
      }
      itemsByCategory.get(item.category_code)!.push(item)
    }
    const restrictItemIds = auxIdArray.length > 0
    const categoryWork = restrictItemIds
      ? Array.from(itemsByCategory.entries()).map(([code, categoryItems]) => ({
          code,
          id: categoryIdByCode.get(code) || '',
          items: categoryItems,
        }))
      : categoryMeta.map((cat: any) => ({ code: cat.code, id: cat.id, items: [] as any[] }))

    function buildCategoryMatch(categoryCode: string, categoryId: string, batch: any[]) {
      if (restrictItemIds) {
        const ids = batch.map((it: any) => it.id)
        const ph = ids.map(() => '?').join(',')
        const matchOpts = buildAuxMatchOptions(categoryCode, categoryIdByCode, batch)
        const params: any[] = []
        appendAuxItemMatchParams(params, categoryCode, ids, matchOpts)
        return {
          sql: buildAuxItemMatchCondition(categoryCode, ph, matchOpts),
          params,
        }
      }
      const rawId = buildAuxIdSelect(categoryCode, categoryId)
      return {
        sql: `(${rawId}) IS NOT NULL AND EXISTS (
          SELECT 1 FROM aux_items matched_ai
          WHERE matched_ai.account_set_id=? AND matched_ai.type=?
            AND (matched_ai.id=(${rawId}) OR matched_ai.code=(${rawId}))
        )`,
        params: [accountSetId, categoryId],
      }
    }

    // ===== 临时表收集所有匹配的分录 ID（去重 COUNT / 期初用） =====
    // 同一条分录可能同时打了多个类目标签（如 cash_flow + person），若按类目分别 COUNT/累加会重复。
    // 用临时表收集所有匹配的 entry ID（自动去重），避免 OR 合并所有类目导致 SQL 参数超 999。
    db.exec('CREATE TEMP TABLE IF NOT EXISTS _tmp_aux_detail_ids (entry_id TEXT)')
    db.exec('DELETE FROM _tmp_aux_detail_ids')
    // P0-5：期初分录专用临时表（voucher_date < start_date），与区间临时表分开收集
    db.exec('CREATE TEMP TABLE IF NOT EXISTS _tmp_aux_detail_init_ids (entry_id TEXT)')
    db.exec('DELETE FROM _tmp_aux_detail_init_ids')

    // 公共筛选条件构造器（避免在多处重复拼接）
    function buildCommonFilter(opts: { withRangeDate?: boolean; lessThanStart?: boolean }) {
      const conds: string[] = []
      const params: any[] = []
      if (opts.withRangeDate) {
        if (start_date) {
          conds.push('v.voucher_date >= ?')
          params.push(start_date)
        }
        if (end_date) {
          conds.push('v.voucher_date <= ?')
          params.push(end_date)
        }
      }
      if (opts.lessThanStart && start_date) {
        // P1-14：期初凭证只累计「当年年初」起的分录，避免与 init_balances 表
        // （年结已写入上年余额）合并时把上年活动重复计入
        conds.push('v.voucher_date >= ? AND v.voucher_date < ?')
        params.push(`${new Date(start_date).getFullYear()}-01-01`, start_date)
      }
      if (account_code) {
        conds.push('ve.account_code LIKE ?')
        params.push(`${account_code}%`)
      }
      appendAccountScopeCondition(req.accountScope, 've.account_id', conds, params)
      if (summary_keyword) {
        conds.push('ve.summary LIKE ?')
        params.push(`%${summary_keyword}%`)
      }
      const minAmt = parseAmountFilter(min_amount)
      const maxAmt = parseAmountFilter(max_amount)
      if (minAmt !== undefined) {
        conds.push('ve.amount >= ?')
        params.push(minAmt)
      }
      if (maxAmt !== undefined) {
        conds.push('ve.amount <= ?')
        params.push(maxAmt)
      }
      if (maker_name) {
        conds.push('v.maker_name LIKE ?')
        params.push(`%${maker_name}%`)
      }
      if (auditor_name) {
        conds.push('v.auditor_name LIKE ?')
        params.push(`%${auditor_name}%`)
      }
      return { conds, params }
    }

    // 按批次收集匹配的 entry ID 到临时表
    const insertDetailEntryId = db.prepare('INSERT INTO _tmp_aux_detail_ids (entry_id) VALUES (?)')
    const insertDetailInitEntryId = db.prepare('INSERT INTO _tmp_aux_detail_init_ids (entry_id) VALUES (?)')
    const detailCollectBatchSize = 150

    const insertIdsTx = db.transaction((rows: { id: string }[], stmt: any) => {
      for (const row of rows) stmt.run(row.id)
    })

    for (const category of categoryWork) {
      const batches = restrictItemIds
        ? Array.from(
            { length: Math.ceil(category.items.length / detailCollectBatchSize) },
            (_, index) => category.items.slice(index * detailCollectBatchSize, (index + 1) * detailCollectBatchSize)
          )
        : [[]]
      for (const batch of batches) {
        const match = buildCategoryMatch(category.code, category.id, batch)

        const baseConds = [
          've.account_set_id = ?',
          `v.status IN (${statusPlaceholders})`,
          match.sql,
        ]
        const baseParams: any[] = [accountSetId, ...statusValue]
        baseParams.push(...match.params)

        // 区间分录（日期范围 + 科目/摘要等筛选）→ 明细列表临时表
        {
          const dataCommon = buildCommonFilter({ withRangeDate: true })
          const conds = [...baseConds, ...dataCommon.conds]
          const params = [...baseParams, ...dataCommon.params]
          const rows = db
            .prepare(
              `SELECT DISTINCT ve.id
               FROM voucher_entries ve
               JOIN vouchers v ON v.id = ve.voucher_id
               WHERE ${conds.join(' AND ')}`
            )
            .all(...params) as { id: string }[]
          insertIdsTx(rows, insertDetailEntryId)
        }

        // P0-5：期初分录（voucher_date < start_date）→ 期初临时表，
        // 与 categoryInitBalances 同口径。原实现复用区间临时表（其分录均 >= start_date），
        // 与「< start_date」条件交集为空，导致合计期初的凭证部分恒为 0。
        if (start_date) {
          const initCommon = buildCommonFilter({ lessThanStart: true })
          const conds = [...baseConds, ...initCommon.conds]
          const params = [...baseParams, ...initCommon.params]
          const rows = db
            .prepare(
              `SELECT DISTINCT ve.id
               FROM voucher_entries ve
               JOIN vouchers v ON v.id = ve.voucher_id
               WHERE ${conds.join(' AND ')}`
            )
            .all(...params) as { id: string }[]
          insertIdsTx(rows, insertDetailInitEntryId)
        }
      }
    }

    // ===== 使用临时表 COUNT(DISTINCT)，避免同一分录被多个类目重复计数 =====
    const totalCount = (db.prepare(`
      SELECT COUNT(DISTINCT entry_id) as count FROM _tmp_aux_detail_ids
    `).get() as any)?.count || 0

    console.log('辅助明细账：COUNT 查询完成，总记录数:', totalCount)

    const currentPage = Math.max(1, Number(page) || 1)
    const pageSizeNum = parsePageSizeParam(pageSize, 50)
    const offset = (currentPage - 1) * pageSizeNum
    const pageIdRows = db
      .prepare(
        `SELECT ve.id
         FROM voucher_entries ve
         JOIN vouchers v ON v.id=ve.voucher_id
         WHERE ve.id IN (SELECT DISTINCT entry_id FROM _tmp_aux_detail_ids)
         ORDER BY v.voucher_date, v.voucher_no, ve.seq
         LIMIT ? OFFSET ?`
      )
      .all(pageSizeNum, offset) as Array<{ id: string }>
    const pageEntryIds = pageIdRows.map(row => row.id)
    const carryRow = db
      .prepare(
        `SELECT COALESCE(SUM(${buildSignedEntryAmountSql('account_direction', 'direction', 'amount')}),0) AS amount
         FROM (
           SELECT ve.direction, ve.amount, a.direction AS account_direction
           FROM voucher_entries ve
           JOIN vouchers v ON v.id=ve.voucher_id
           JOIN accounts a ON a.id=ve.account_id
           WHERE ve.id IN (SELECT DISTINCT entry_id FROM _tmp_aux_detail_ids)
           ORDER BY v.voucher_date, v.voucher_no, ve.seq
           LIMIT ?
         )`
      )
      .get(offset) as { amount?: number }
    const carryAmount = Number(carryRow?.amount || 0)

    // 批量查询所有辅助项目的数据（性能优化：使用 IN 子句替代循环查询）
    let allEntries: any[] = []
    let totalInitBalance = 0
    const categoryInitBalances: {
      category_code: string
      category_name: string
      init_balance: number
    }[] = []

    const initYearAuxDetail = start_date ? new Date(start_date).getFullYear() : new Date().getFullYear()
    const selectedCategoryCodes = new Set(categoryWork.map(category => category.code))
    const selectedItemIdsByCat = new Map<string, Set<string>>()
    for (const [code, arr] of itemsByCategory) {
      selectedItemIdsByCat.set(code, new Set(arr.map((it: any) => String(it.id))))
    }

    const accountCodeFilter = account_code ? ` AND a.code LIKE ?` : ''
    const initRowsSql = `
      SELECT a.code as account_code, a.direction, ib.aux_item_id, ib.init_balance, ib.init_debit, ib.init_credit
      FROM init_balances ib
      JOIN accounts a ON a.id = ib.account_id
      WHERE ib.account_set_id = ? AND ib.year = ? AND ib.aux_item_id != ''
      ${accountCodeFilter}
    `
    const initRowsParams: any[] = [accountSetId, initYearAuxDetail]
    if (account_code) initRowsParams.push(`${account_code}%`)
    const initRowsStatement = db.prepare(initRowsSql)
    const resolveInitAuxItemDetail = db.prepare(
      `SELECT id FROM aux_items
       WHERE account_set_id=? AND type=? AND (id=? OR code=?) LIMIT 1`
    )
    const auxInitBalanceByCategory = new Map<string, number>()
    let auxInitTotalBalance = 0
    let auxInitRowCount = 0

    // 期初明细可能达到十几万行：流式遍历一次，同时算出分类合计和去重后的总合计，
    // 避免把全部记录留在 Node 数组中，也避免每个类别重复扫描整批期初数据。
    for (const row of initRowsStatement.iterate(...initRowsParams) as Iterable<any>) {
      auxInitRowCount += 1
      const matchedCategories = new Set<string>()
      for (const part of String(row.aux_item_id).split('|')) {
        const idx = part.indexOf(':')
        if (idx <= 0) continue
        const categoryCode = part.slice(0, idx)
        const itemToken = part.slice(idx + 1)
        if (!selectedCategoryCodes.has(categoryCode)) continue
        if (restrictItemIds) {
          const categoryId = categoryIdByCode.get(categoryCode)
          if (!categoryId) continue
          const resolvedItem = resolveInitAuxItemDetail.get(
            accountSetId,
            categoryId,
            itemToken,
            itemToken
          ) as { id: string } | undefined
          const allowed = selectedItemIdsByCat.get(categoryCode)
          if (!resolvedItem || !allowed?.has(resolvedItem.id)) continue
        }
        matchedCategories.add(categoryCode)
      }
      if (matchedCategories.size === 0) continue

      const initBalance = calcInitBalanceFromDebitCredit(
        row.direction === 'credit' ? 'credit' : 'debit',
        row.init_debit || 0,
        row.init_credit || 0,
        row.init_balance
      )
      auxInitTotalBalance += initBalance
      const firstMatchedCategory = categoryWork.find(category => matchedCategories.has(category.code))?.code
      if (firstMatchedCategory) {
        auxInitBalanceByCategory.set(
          firstMatchedCategory,
          (auxInitBalanceByCategory.get(firstMatchedCategory) || 0) + initBalance
        )
      }
    }

    /** 组合 aux_item_id 行只计入首个命中的类目，避免拆行展示时重复 */
    function addAuxInitBalanceForCategory(categoryCode: string): number {
      return auxInitBalanceByCategory.get(categoryCode) || 0
    }

    // ===== 按辅助类别分别汇总期初（用于前端分开展示） =====
    for (const category of categoryWork) {
      const categoryCode = category.code
      const categoryItems = category.items
      let catInit = 0
      if (start_date) {
        const initCommon = buildCommonFilter({ lessThanStart: true })
        const batchSize = 150
        const batches = restrictItemIds
          ? Array.from(
              { length: Math.ceil(categoryItems.length / batchSize) },
              (_, index) => categoryItems.slice(index * batchSize, (index + 1) * batchSize)
            )
          : [[]]
        for (const batch of batches) {
          const match = buildCategoryMatch(categoryCode, category.id, batch)

          const initSqlCat = `
            SELECT COALESCE(SUM(
              ${buildSignedEntryAmountSql('account_direction', 'direction', 'amount')}
            ), 0) as init_balance
            FROM (
              SELECT DISTINCT ve.id, ve.direction, ve.amount, a.direction as account_direction
              FROM voucher_entries ve
              JOIN vouchers v ON v.id = ve.voucher_id
              JOIN accounts a ON a.id = ve.account_id
              WHERE ve.account_set_id = ?
                AND v.status IN (${statusPlaceholders})
                AND ${match.sql}
                ${initCommon.conds.length > 0 ? 'AND ' + initCommon.conds.join(' AND ') : ''}
            )
          `
          const initRowCat = db.prepare(initSqlCat).get(
            accountSetId,
            ...statusValue,
            ...match.params,
            ...initCommon.params
          ) as any
          catInit += initRowCat?.init_balance || 0
        }
      }
      catInit += addAuxInitBalanceForCategory(categoryCode)
      if (catInit !== 0) {
        categoryInitBalances.push({
          category_code: categoryCode,
          category_name: categoryNameByCode.get(categoryCode) || categoryCode,
          init_balance: catInit,
        })
      }
    }

    // ===== 合计期初（凭证 DISTINCT 去重 + 期初表每行只计一次） =====
    if (start_date) {
      // P0-5：从「期初临时表」求和（其分录已按 voucher_date < start_date 收集、跨类目去重），
      // 不再复用区间临时表（分录均 >= start_date，交集为空导致期初恒 0）
      const initSqlAll = `
        SELECT COALESCE(SUM(
          ${buildSignedEntryAmountSql('a.direction', 've.direction', 've.amount')}
        ), 0) as init_balance
        FROM voucher_entries ve
        JOIN vouchers v ON v.id = ve.voucher_id
        JOIN accounts a ON a.id = ve.account_id
        WHERE ve.id IN (SELECT DISTINCT entry_id FROM _tmp_aux_detail_init_ids)
      `
      const initRow = db.prepare(initSqlAll).get() as any
      totalInitBalance += initRow?.init_balance || 0
    }

    totalInitBalance += auxInitTotalBalance
    console.log(
      `辅助明细账：合并辅助期初记录 ${auxInitRowCount} 条，年度 ${initYearAuxDetail}，分类期初 ${categoryInitBalances.length} 项`
    )

    // 为每个类别执行批量查询，结果按 ve.id 去重合并到 entryMap
    // 同一条分录可能同时被多个类目命中（如 cash_flow + person），用 Map 去重，多个类目的标签合并到同一行
    const entryMap = new Map<string, any>()

    const pageIdsJson = JSON.stringify(pageEntryIds)
    const resolveAuxItem = db.prepare(
      `SELECT id, code, name FROM aux_items
       WHERE account_set_id=? AND type=? AND (id=? OR code=?) LIMIT 1`
    )
    for (const category of categoryWork) {
      const categoryCode = category.code
      const categoryItems = category.items
      const batchSize = 150
      const batches = restrictItemIds
        ? Array.from(
            { length: Math.ceil(categoryItems.length / batchSize) },
            (_, index) => categoryItems.slice(index * batchSize, (index + 1) * batchSize)
          )
        : [[]]
      for (const batch of batches) {
        if (pageEntryIds.length === 0) continue
        const match = buildCategoryMatch(categoryCode, category.id, batch)

        // 查询明细分录
        const dataConditions = [
          've.account_set_id = ?',
          `v.status IN (${statusPlaceholders})`,
          match.sql,
          've.id IN (SELECT value FROM json_each(?))',
        ]
        const dataParams: any[] = [accountSetId, ...statusValue]
        dataParams.push(...match.params, pageIdsJson)

        const dataCommon = buildCommonFilter({ withRangeDate: true })
        dataConditions.push(...dataCommon.conds)
        dataParams.push(...dataCommon.params)

        const detailSql = `
          SELECT
            ve.id as entry_id,
            ve.voucher_id,
            v.status as voucher_status,
            v.voucher_date,
            v.voucher_no,
            ve.seq,
            ve.account_code,
            ve.account_name,
            a.direction as account_direction,
            ve.summary,
            ve.direction,
            ve.amount,
            ${buildAuxIdSelect(categoryCode, categoryIdByCode.get(categoryCode))} as aux_id,
            ${buildAuxNameSelect(categoryCode, categoryIdByCode.get(categoryCode))} as aux_name,
            '${categoryCode}' as category_code,
            ${buildAuxFieldValuesSelect(categoryCode, categoryIdByCode.get(categoryCode))} as field_values_json
          FROM voucher_entries ve
          JOIN vouchers v ON v.id = ve.voucher_id
          JOIN accounts a ON a.id = ve.account_id
          WHERE ${dataConditions.join(' AND ')}
          ORDER BY v.voucher_date, v.voucher_no, ve.seq
        `
        const entries = db.prepare(detailSql).all(...dataParams) as any[]

        for (const entry of entries) {
          let field_values: Record<string, any> = {}
          try {
            if (entry.field_values_json) {
              const raw =
                typeof entry.field_values_json === 'string'
                  ? entry.field_values_json
                  : JSON.stringify(entry.field_values_json)
              field_values = JSON.parse(raw)
            }
          } catch {}
          entry.field_values = field_values
          delete entry.field_values_json

          enrichAuxLedgerEntry(entry, categoryCode, categoryNameByCode, auxLookup)
          const token = String(entry.aux_id || '')
          const resolved = resolveAuxItem.get(
            accountSetId,
            category.id,
            token,
            token
          ) as { id: string; name: string } | undefined
          if (resolved) {
            entry.aux_id = resolved.id
            if (!entry.aux_name || entry.aux_name === 'null') entry.aux_name = resolved.name
          }

          const existing = entryMap.get(entry.entry_id)
          if (existing) {
            // 同一条分录被多个类目命中：合并 category_name / aux_name，金额不重复累加
            const newCatName = entry.category_name || categoryCode
            const newAuxName = entry.aux_name || ''
            if (newCatName && !String(existing.category_name || '').split('、').includes(newCatName)) {
              existing.category_name = existing.category_name
                ? `${existing.category_name}、${newCatName}`
                : newCatName
            }
            if (newAuxName && !String(existing.aux_name || '').split('、').includes(newAuxName)) {
              existing.aux_name = existing.aux_name
                ? `${existing.aux_name}、${newAuxName}`
                : newAuxName
            }
            // 自定义字段：浅合并
            existing.field_values = { ...(existing.field_values || {}), ...field_values }
          } else {
            entryMap.set(entry.entry_id, entry)
          }
        }
      }
    }

    allEntries = Array.from(entryMap.values())

    console.log('辅助明细账：数据查询完成，去重后分录数:', allEntries.length)

    // 按日期、凭证号、分录序排序（去重后多类目混合时需稳定排序）
    allEntries.sort((a, b) => {
      if (a.voucher_date !== b.voucher_date) {
        return a.voucher_date.localeCompare(b.voucher_date)
      }
      if (a.voucher_no !== b.voucher_no) {
        return a.voucher_no.localeCompare(b.voucher_no)
      }
      return (a.seq || 0) - (b.seq || 0)
    })

    const paginatedEntries = allEntries

    console.log('辅助明细账查询结果:', {
      totalCount,
      allEntriesLength: allEntries.length,
      paginatedEntriesLength: paginatedEntries.length,
      currentPage,
      pageSizeNum,
      offset
    })

    // 清理临时表
    db.exec('DROP TABLE IF EXISTS _tmp_aux_detail_ids')
    db.exec('DROP TABLE IF EXISTS _tmp_aux_detail_init_ids')

    res.json({
      code: 0,
      data: paginatedEntries,
      initBalance: totalInitBalance,
      categoryInitBalances,
      pageStartBalance: totalInitBalance + carryAmount,
      categoryFields,
      total: totalCount,
    })
  } catch (error: any) {
    console.error('辅助项目明细账查询失败:', error)
    res.status(500).json({ code: 1, error: error.message || '查询失败' })
  }
})

router.get('/cash-flow-trial-balance', requirePermission('ledger:cashflow'), (req: AuthRequest, res) => {
  try {
    const accountSetId = req.accountSetId || ''
    if (!isCashFlowEnabledForAccountSet(getDb(), accountSetId)) {
      return res.status(400).json({ code: 400, message: '账套未启用现金流核算' })
    }

    const year = Number(req.query.year) || new Date().getFullYear()
    const period = Number(req.query.period) || new Date().getMonth() + 1
    const scope: CashFlowTrialBalanceScope = req.query.scope === 'ytd' ? 'ytd' : 'month'
    const includeUnposted = includeUnpostedFlag(req.query.include_unposted)

    const data = getCashFlowTrialBalance(getDb(), accountSetId, year, period, scope, includeUnposted)
    res.json({ code: 0, data })
  } catch (error: any) {
    console.error('现金流量试算平衡表查询失败:', error)
    res.status(500).json({ code: 500, message: error.message || '查询失败' })
  }
})

router.get('/cash-flow-voucher-check', requirePermission('ledger:cashflow'), (req: AuthRequest, res) => {
  try {
    const accountSetId = req.accountSetId || ''
    if (!isCashFlowEnabledForAccountSet(getDb(), accountSetId)) {
      return res.status(400).json({ code: 400, message: '账套未启用现金流核算' })
    }

    const year = Number(req.query.year) || new Date().getFullYear()
    const period = Number(req.query.period) || new Date().getMonth() + 1
    const scope: CashFlowTrialBalanceScope = req.query.scope === 'ytd' ? 'ytd' : 'month'
    const includeUnposted = includeUnpostedFlag(req.query.include_unposted)

    const data = getCashFlowVoucherCheck(getDb(), accountSetId, year, period, scope, includeUnposted)
    res.json({ code: 0, data })
  } catch (error: any) {
    console.error('现金流量凭证检查失败:', error)
    res.status(500).json({ code: 500, message: error.message || '查询失败' })
  }
})

// ===================== 通用多栏账 =====================

router.get('/multi-column/settings', requirePermission('ledger:multirow'), (req: AuthRequest, res) => {
  try {
    const db = getDb()
    const accountSetId = req.accountSetId || ''
    const accountId = typeof req.query.account_id === 'string' ? req.query.account_id : ''
    const resolved = resolveMultiColumnAccounts(db, accountSetId, accountId)
    const scopeErr = assertAccountIdsInScope(
      req.accountScope,
      [accountId, ...resolved.columns.map(column => column.accountId)].filter(Boolean)
    )
    if (scopeErr) return res.status(403).json({ code: 403, message: scopeErr })
    res.json({ code: 0, data: { main: resolved.main, columns: resolved.columns } })
  } catch (error: any) {
    res.status(500).json({ code: 500, message: error.message || '读取多栏账设置失败' })
  }
})

router.put(
  '/multi-column/settings',
  requirePermission('ledger:multirow'),
  operationLog('保存多栏账设置', '账簿'),
  (req: AuthRequest, res) => {
    try {
      const db = getDb()
      const accountSetId = req.accountSetId || ''
      const mainAccountId = String(req.body?.accountId || '')
      const resolved = resolveMultiColumnAccounts(db, accountSetId, mainAccountId)
      const scopeErr = assertAccountIdsInScope(
        req.accountScope,
        [mainAccountId, ...resolved.columns.map(column => column.accountId)].filter(Boolean)
      )
      if (scopeErr) return res.status(403).json({ code: 403, message: scopeErr })
      const allowed = new Set(resolved.columns.map(column => column.accountId))
      const settings = (Array.isArray(req.body?.columns) ? req.body.columns : [])
        .filter((item: any) => allowed.has(String(item?.accountId)))
        .map((item: any, index: number): MultiColumnSetting => ({
          accountId: String(item.accountId),
          enabled: item.enabled !== false,
          printName: String(item.printName ?? '').trim(),
          printNameEn: String(item.printNameEn ?? '').trim(),
          sortOrder: Number.isFinite(Number(item.sortOrder)) ? Number(item.sortOrder) : index,
        }))
      saveMultiColumnSettings(db, accountSetId, mainAccountId, settings, () => uuidv4())
      const next = resolveMultiColumnAccounts(db, accountSetId, mainAccountId)
      res.json({ code: 0, data: { main: next.main, columns: next.columns } })
    } catch (error: any) {
      res.status(500).json({ code: 500, message: error.message || '保存多栏账设置失败' })
    }
  }
)

router.get('/multi-column', requirePermission('ledger:multirow'), (req: AuthRequest, res) => {
  try {
    const db = getDb()
    const accountSetId = req.accountSetId || ''
    const mainAccountId = typeof req.query.account_id === 'string' ? req.query.account_id : ''
    const resolved = resolveMultiColumnAccounts(db, accountSetId, mainAccountId)
    const scopeErr = assertAccountIdsInScope(
      req.accountScope,
      [mainAccountId, ...resolved.columns.map(column => column.accountId)].filter(Boolean)
    )
    if (scopeErr) return res.status(403).json({ code: 403, message: scopeErr })
    const data = queryMultiColumnLedger(db, {
      accountSetId,
      mainAccountId,
      year: Number(req.query.year) || new Date().getFullYear(),
      startMonth: Number(req.query.start_month) || 1,
      endMonth: Number(req.query.end_month) || 12,
      includeUnposted: includeUnpostedFlag(req.query.include_unposted),
      accountSetStartDate: peekAccountSetStartDate(db, accountSetId),
      preBookEnabled: hasPreBookColumns(db),
    })
    res.json({ code: 0, data })
  } catch (error: any) {
    console.error('多栏账查询失败:', error)
    res.status(500).json({ code: 500, message: error.message || '多栏账查询失败' })
  }
})

function parseAuxItemIdsParam(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.map(value => String(value)).filter(value => value.trim())
  }
  if (typeof raw === 'string') {
    return raw.split(',').map(value => value.trim()).filter(Boolean)
  }
  return []
}

function parseAuxMultiColumnInput(req: AuthRequest, source: 'query' | 'body') {
  const db = getDb()
  const raw: any = source === 'query' ? req.query : req.body || {}
  const pick = (queryKey: string, bodyKey: string) =>
    source === 'query' ? raw[queryKey] : raw[bodyKey] ?? raw[queryKey]
  const modeRaw = String(pick('mode', 'mode') || 'counter')
  return {
    accountSetId: req.accountSetId || '',
    mode: (modeRaw === 'aux_item' ? 'aux_item' : 'counter') as AuxMultiColumnMode,
    categoryId: String(pick('aux_category_id', 'categoryId') || ''),
    auxItemIds: parseAuxItemIdsParam(pick('aux_item_ids', 'auxItemIds')),
    accountId: String(pick('account_id', 'accountId') || '') || undefined,
    year: Number(pick('year', 'year')) || new Date().getFullYear(),
    startMonth: Number(pick('start_month', 'startMonth')) || 1,
    endMonth: Number(pick('end_month', 'endMonth')) || 12,
    // FIX-147 / GL-04 漏网：统一走 includeUnpostedFlag，前端传 1 / '1' 也生效
    includeUnposted: includeUnpostedFlag(pick('include_unposted', 'includeUnposted')),
    // FIX-150：期初口径与总账一致（年初余额 + 账前归属判断）
    accountSetStartDate: peekAccountSetStartDate(db, req.accountSetId || ''),
    preBookEnabled: hasPreBookColumns(db),
    accountCode: (() => {
      const value = pick('account_code', 'accountCode')
      return typeof value === 'string' && value.trim() ? value.trim() : undefined
    })(),
    accountScope: req.accountScope,
  }
}

/** 栏目 key 形如 d_<sourceId> / c_<sourceId>，模式 counter 下 sourceId 即对方科目 ID */
function auxMultiColumnScopeIds(input: { mode: AuxMultiColumnMode; accountId?: string }, columns: Array<{ key: string }>) {
  const ids = new Set<string>()
  if (input.accountId) ids.add(input.accountId)
  if (input.mode === 'counter') {
    for (const column of columns) {
      const sourceId = column.key.replace(/^[dc]_/, '')
      if (sourceId) ids.add(sourceId)
    }
  }
  return Array.from(ids)
}

router.get('/aux-multi-column/settings', requirePermission('ledger:aux'), (req: AuthRequest, res) => {
  try {
    const db = getDb()
    const input = parseAuxMultiColumnInput(req, 'query')
    const resolved = resolveAuxMultiColumnColumnSources(db, input)
    const scopeErr = assertAccountIdsInScope(req.accountScope, auxMultiColumnScopeIds(input, resolved.columns))
    if (scopeErr) return res.status(403).json({ code: 403, message: scopeErr })
    res.json({
      code: 0,
      data: {
        mode: resolved.mode,
        category: resolved.category,
        account: resolved.account,
        columns: resolved.columns,
      },
    })
  } catch (error: any) {
    res.status(500).json({ code: 500, message: error.message || '读取辅助多栏账设置失败' })
  }
})

router.put(
  '/aux-multi-column/settings',
  requirePermission('ledger:aux'),
  operationLog('保存辅助多栏账设置', '账簿'),
  (req: AuthRequest, res) => {
    try {
      const db = getDb()
      const input = parseAuxMultiColumnInput(req, 'body')
      const resolved = resolveAuxMultiColumnColumnSources(db, input)
      const scopeErr = assertAccountIdsInScope(req.accountScope, auxMultiColumnScopeIds(input, resolved.columns))
      if (scopeErr) return res.status(403).json({ code: 403, message: scopeErr })
      // 已保存但被禁用的栏目不在 resolved.columns 里，需一并放行，否则禁用后再也改不回来
      const previous = new Set(
        (Array.isArray(req.body?.columns) ? req.body.columns : []).map((item: any) => String(item?.accountId))
      )
      const allowed = new Set([...resolved.columns.map(column => column.key), ...previous])
      const settings = (Array.isArray(req.body?.columns) ? req.body.columns : [])
        .filter((item: any) => allowed.has(String(item?.accountId)))
        .map((item: any, index: number): AuxMultiColumnSetting => ({
          accountId: String(item.accountId),
          enabled: item.enabled !== false,
          printName: String(item.printName ?? '').trim(),
          sortOrder: Number.isFinite(Number(item.sortOrder)) ? Number(item.sortOrder) : index,
        }))
      saveAuxMultiColumnSettings(db, input.accountSetId, resolved.settingsKey, settings, () => uuidv4())
      const refreshed = resolveAuxMultiColumnColumnSources(db, input)
      res.json({ code: 0, data: { mode: refreshed.mode, columns: refreshed.columns } })
    } catch (error: any) {
      res.status(500).json({ code: 500, message: error.message || '保存辅助多栏账设置失败' })
    }
  }
)

router.get('/aux-multi-column', requirePermission('ledger:aux'), (req: AuthRequest, res) => {
  try {
    const db = getDb()
    const input = parseAuxMultiColumnInput(req, 'query')
    if (input.mode === 'aux_item' && !input.accountId) {
      return res.status(400).json({ code: 1, message: '按辅助项目分栏时必须选择科目' })
    }
    const scopeErr = assertAccountIdsInScope(req.accountScope, input.accountId ? [input.accountId] : [])
    if (scopeErr) return res.status(403).json({ code: 403, message: scopeErr })
    const data = queryAuxMultiColumnLedger(db, input)
    res.json({ code: 0, data })
  } catch (error: any) {
    console.error('辅助多栏账查询失败:', error)
    res.status(500).json({ code: 500, message: error.message || '辅助多栏账查询失败' })
  }
})

// ===================== 应交税金(增值税)明细账 =====================

router.get('/vat-detail/settings', requirePermission('ledger:detail'), (req: AuthRequest, res) => {
  try {
    const db = getDb()
    const accountSetId = req.accountSetId || ''
    const parent = findVatParentAccount(db, accountSetId)
    res.json({
      code: 0,
      data: {
        columns: resolveVatColumns(db, accountSetId),
        parent: parent ? { code: parent.code, name: parent.name } : null,
      },
    })
  } catch (error: any) {
    res.status(500).json({ code: 500, message: error.message || '读取设置失败' })
  }
})

router.put(
  '/vat-detail/settings',
  requirePermission('ledger:detail'),
  operationLog('保存增值税明细账设置', '账簿'),
  (req: AuthRequest, res) => {
    try {
      const db = getDb()
      const accountSetId = req.accountSetId || ''
      const settings = Array.isArray(req.body?.columns) ? req.body.columns : []
      saveVatColumnSettings(db, accountSetId, settings, () => uuidv4())
      res.json({ code: 0, data: { columns: resolveVatColumns(db, accountSetId) } })
    } catch (error: any) {
      res.status(500).json({ code: 500, message: error.message || '保存设置失败' })
    }
  }
)

router.get('/vat-detail', requirePermission('ledger:detail'), (req: AuthRequest, res) => {
  try {
    const db = getDb()
    const accountSetId = req.accountSetId || ''
    const data = queryVatLedger(db, {
      accountSetId,
      year: Number(req.query.year) || new Date().getFullYear(),
      startMonth: Number(req.query.start_month) || 1,
      endMonth: Number(req.query.end_month) || 12,
      includeUnposted: includeUnpostedFlag(req.query.include_unposted),
      accountSetStartDate: peekAccountSetStartDate(db, accountSetId),
      preBookEnabled: hasPreBookColumns(db),
    })
    const scopeErr = assertAccountIdsInScope(
      req.accountScope,
      data.columns.filter(c => c.accountId).map(c => c.accountId)
    )
    if (scopeErr) return res.status(403).json({ code: 403, message: scopeErr })
    res.json({ code: 0, data })
  } catch (error: any) {
    console.error('增值税明细账查询失败:', error)
    res.status(500).json({ code: 500, message: error.message || '查询失败' })
  }
})

export default router
 
