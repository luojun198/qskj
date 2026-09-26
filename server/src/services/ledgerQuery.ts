import { AUX_LEGACY_COLUMNS, appendAuxItemMatchParams, buildAuxItemMatchCondition } from '../utils/auxLedgerQuery.js'
import { CLOSING_VOUCHER_TYPE_JOIN_SQL, NOT_CLOSING_VOUCHER_SQL } from '../utils/closingVoucherSql.js'
import { buildDirectionSignedNetSql, buildSignedEntryAmountSql } from '../utils/accountBalance.js'
import {
  buildInitBalanceSumExpr,
  buildOpeningBalanceSumExpr,
  buildPreBookSumExpr,
  resolvePreBookDate,
  resolvePreBookRangeFlags,
  resolvePreBookYearFlags,
  AMOUNT_INIT_COLUMNS,
  QUANTITY_INIT_COLUMNS,
  FOREIGN_INIT_COLUMNS,
  type InitBalanceColumnSet,
} from './initBalanceScope.js'
import {
  appendAccountScopeCondition,
  type AccountScopeContext,
} from './accountAuthorization.js'

type SqlParam = string | number

// P1-16：期初金额须按科目方向签名（与 calcInitBalanceFromDebitCredit 一致）。
// 旧实现恒 init_debit - init_credit，贷方科目辅助期初符号相反（贷 1000 被算成 -1000），
// 再与方向签名的凭证期初相加导致辅助明细账期初方向/金额错误。需 accounts a 在作用域内提供 a.direction。
const INIT_BALANCE_AMOUNT_EXPR = `CASE WHEN ib.init_debit != 0 OR ib.init_credit != 0
  THEN (${buildDirectionSignedNetSql('a.direction', 'ib.init_debit', 'ib.init_credit')})
  ELSE ib.init_balance END`

/** 匹配 aux_item_id 中单段或组合键（如 dept:id 或 dept:id|proj:2） */
export function buildAuxItemIdMatchCondition(column = 'ib.aux_item_id'): string {
  return `(${column} = ? OR ${column} LIKE ? || '|%' OR ${column} LIKE '%|' || ? || '|%' OR ${column} LIKE '%|' || ?)`
}

function buildWhereClause(conditions: string[]) {
  if (conditions.length === 0) {
    return ''
  }

  return ` WHERE ${conditions.join(' AND ')}`
}

/** 按科目汇总期初，口径见 initBalanceScope.buildInitBalanceSumExpr（汇总行优先） */
export const INIT_BALANCE_GROUP_BY_ACCOUNT_SQL = `
  SELECT account_id,
    ${buildInitBalanceSumExpr()} as init_balance
  FROM init_balances
  WHERE year = ? AND account_set_id = ?
  GROUP BY account_id
`

/** 单科目期初子查询（关联 accounts 别名），占位符：account_set_id, year */
export function buildAccountInitBalanceExpr(
  accountIdRef: string,
  cols: InitBalanceColumnSet = AMOUNT_INIT_COLUMNS
): string {
  return `COALESCE(
    (SELECT ${buildInitBalanceSumExpr('ib', cols)}
     FROM init_balances ib
     WHERE ib.account_id = ${accountIdRef}
       AND ib.account_set_id = ?
       AND ib.year = ?),
    0
  )`
}

/** 账前发生额净额（按科目方向签名），需外层 accounts 别名 a 提供 direction */
function preBookNetSignedExpr(
  alias = 'ib',
  cols: InitBalanceColumnSet = AMOUNT_INIT_COLUMNS
): string {
  return buildDirectionSignedNetSql(
    'a.direction',
    buildPreBookSumExpr('debit', alias, cols),
    buildPreBookSumExpr('credit', alias, cols)
  )
}

/**
 * 单科目「年初余额（+ 视情况计入账前发生额）」子查询，占位符：account_set_id, year。
 * includePreBook=true 时结果恒等于 init_balances.init_balance（启用时点余额）。
 */
export function buildAccountOpeningBalanceExpr(
  accountIdRef: string,
  includePreBook: boolean,
  cols: InitBalanceColumnSet = AMOUNT_INIT_COLUMNS
): string {
  return `COALESCE(
    (SELECT ${buildOpeningBalanceSumExpr('ib', 'a', cols)} + ${includePreBook ? preBookNetSignedExpr('ib', cols) : '0'}
     FROM init_balances ib
     WHERE ib.account_id = ${accountIdRef}
       AND ib.account_set_id = ?
       AND ib.year = ?),
    0
  )`
}

/** 单科目账前借方/贷方发生额子查询，占位符：account_set_id, year。include=false 时恒为 0 但仍消耗占位符 */
export function buildAccountPreBookSideExpr(
  accountIdRef: string,
  side: 'debit' | 'credit',
  include: boolean,
  cols: InitBalanceColumnSet = AMOUNT_INIT_COLUMNS
): string {
  return `COALESCE(
    (SELECT ${include ? buildPreBookSumExpr(side, 'ib', cols) : '0'}
     FROM init_balances ib
     WHERE ib.account_id = ${accountIdRef}
       AND ib.account_set_id = ?
       AND ib.year = ?),
    0
  )`
}

/** 仅末级科目参与汇总，避免父科目科目级期初与子科目辅助期初重复相加 */
export const INIT_BALANCE_LEAF_ACCOUNTS_ONLY = `
  AND NOT EXISTS (
    SELECT 1 FROM accounts child
    WHERE child.parent_id = a.id
      AND child.account_set_id = a.account_set_id
      AND child.is_enabled = 1
  )
`

/** 多科目期初合计（先按科目去重再 SUM），额外 WHERE 片段如 AND a.code >= ? */
export function buildScopedInitBalanceSumSql(
  extraWhere: string,
  options?: { leafAccountsOnly?: boolean }
): string {
  const leafClause = options?.leafAccountsOnly !== false ? INIT_BALANCE_LEAF_ACCOUNTS_ONLY : ''
  return `COALESCE(
    (SELECT SUM(t.init_balance) FROM (
      SELECT ib.account_id,
        ${buildInitBalanceSumExpr('ib')} as init_balance
      FROM init_balances ib
      JOIN accounts a ON a.id = ib.account_id
      WHERE ib.account_set_id = ?
        AND ib.year = ?
        ${extraWhere}
        ${leafClause}
      GROUP BY ib.account_id
    ) t),
    0
  )`
}

/**
 * 多科目账前发生额合计（借/贷各一列）。
 * 与 buildScopedInitBalanceSumSql 同样只取末级科目：init_balances 里父科目的 pre_book
 * 是子科目之和（冗余存储），按编码范围查询会同时命中父子两行，不过滤会翻倍。
 * 占位符：account_set_id, year, ...extraWhere 的参数。
 */
export function buildScopedPreBookSumSql(
  extraWhere: string,
  options?: { leafAccountsOnly?: boolean }
): string {
  // 按单个 account_id 精确取数时不存在父子重复，反而不能过滤——
  // 否则「有子科目的父科目」会被叶子条件整个排除，结果恒为 0。
  const leafClause = options?.leafAccountsOnly === false ? '' : INIT_BALANCE_LEAF_ACCOUNTS_ONLY
  const sumSide = (side: 'debit' | 'credit') => `COALESCE(
    (SELECT SUM(t.amount) FROM (
      SELECT ib.account_id, ${buildPreBookSumExpr(side, 'ib')} as amount
      FROM init_balances ib
      JOIN accounts a ON a.id = ib.account_id
      WHERE ib.account_set_id = ?
        AND ib.year = ?
        ${extraWhere}
        ${leafClause}
      GROUP BY ib.account_id
    ) t),
    0
  )`
  return `SELECT ${sumSide('debit')} as pre_book_debit, ${sumSide('credit')} as pre_book_credit`
}

/**
 * 余额表缺省日期区间：**当年全年**（FIX-250）。
 * 旧默认「当月」在十万级账套上会触发 SQLite 窄区间劣化计划（954 科目 × 相关子查询，实测 209 秒同步阻塞）。
 * 路由层已收口为全年，这里保持同一口径，避免直接调用 build 函数的服务端代码（如汇率重估）再踩雷。
 */
function resolveBalanceDateRange(startDate?: string, endDate?: string) {
  const year = new Date().getFullYear()
  return {
    startDate: startDate || `${year}-01-01`,
    endDate: endDate || `${year}-12-31`,
  }
}

/** 余额表分录聚合 CTE 的一个取值列：prefix 决定输出列名前缀，expr 是分录上的取值表达式 */
interface EntryAggregateValue {
  prefix: string
  expr: string
}

/**
 * FIX-250（压测 P0-1）：科目 / 数量 / 外币余额表共用的**分录一次性聚合 CTE**。
 *
 * 旧写法对每个科目跑 5~10 个 `(SELECT SUM … WHERE ve.account_id = a.id AND 日期区间)` 相关子查询，
 * SQLite 在窄日期区间（如单月）下改走 `idx_vouchers_date → voucher_id 反查分录` 计划，
 * 十万级账套实测 209 秒且 better-sqlite3 同步阻塞整个进程。
 * 现改为一次扫描 `[min(各口径起点), endDate]` 内的分录，按科目分桶 SUM 出四个口径 × 借贷两侧：
 *   - `{p}_init_debit/credit`：[startBaseYearStart, startDate)  → 期初凭证累计
 *   - `{p}_cur_debit/credit` ：[startDate, endDate]             → 本期发生额
 *   - `{p}_year_debit/credit`：[yearStartDate, endDate]         → 本年累计
 *   - `{p}_end_debit/credit` ：[endBaseYearStart, endDate]      → 期末凭证累计
 * 外层 `LEFT JOIN entry_agg m ON m.account_id = a.id` 后按科目方向签名即可，语义与旧相关子查询逐列等价。
 * 占位符顺序：SELECT 列（按 values 顺序，每列两个日期）→ WHERE（account_set_id ×2、总区间两端）。
 *
 * 写成 `vouchers CROSS JOIN voucher_entries` 是有意的：CROSS JOIN 在 SQLite 里是连接顺序提示，强制先走凭证再按
 * voucher_id 取分录。十万级实测：分录驱动（idx_voucher_entries_account 全扫 + 凭证主键回查）2.2s；
 * 凭证驱动在大区间走 rowid 顺序扫描 0.33s、窄区间走 idx_vouchers_set_status_date 0.11s（规划器按范围自行二选一）。
 */
function buildEntryAggregateCte(opts: {
  accountSetId: string
  statusCondition: string
  startDate: string
  endDate: string
  startBaseYearStart: string
  endBaseYearStart: string
  yearStartDate: string
  values: EntryAggregateValue[]
}): { sql: string; params: SqlParam[] } {
  const buckets: { name: string; from: string; to: string; toInclusive: boolean }[] = [
    { name: 'init', from: opts.startBaseYearStart, to: opts.startDate, toInclusive: false },
    { name: 'cur', from: opts.startDate, to: opts.endDate, toInclusive: true },
    { name: 'year', from: opts.yearStartDate, to: opts.endDate, toInclusive: true },
    { name: 'end', from: opts.endBaseYearStart, to: opts.endDate, toInclusive: true },
  ]
  const columns: string[] = []
  const params: SqlParam[] = []
  for (const value of opts.values) {
    for (const b of buckets) {
      for (const side of ['debit', 'credit'] as const) {
        columns.push(
          `SUM(CASE WHEN v.voucher_date >= ? AND v.voucher_date ${b.toInclusive ? '<=' : '<'} ? AND ve.direction = '${side}' THEN ${value.expr} ELSE 0 END) as ${value.prefix}_${b.name}_${side}`
        )
        params.push(b.from, b.to)
      }
    }
  }
  // 总区间取各口径起点的最小值，保证每个桶都落在扫描范围内
  const scanStart = buckets.map(b => b.from).sort()[0]
  params.push(opts.accountSetId, opts.accountSetId, scanStart, opts.endDate)
  return {
    sql: `entry_agg AS (
      SELECT ve.account_id,
        ${columns.join(',\n        ')}
      FROM vouchers v
      CROSS JOIN voucher_entries ve ON ve.voucher_id = v.id
      WHERE v.account_set_id = ?
        AND ve.account_set_id = ?
        AND ${opts.statusCondition}
        AND v.voucher_date >= ?
        AND v.voucher_date <= ?
      GROUP BY ve.account_id
    )`,
    params,
  }
}

/** 聚合 CTE 某口径的借/贷列引用（LEFT JOIN 未命中的科目取 0） */
function aggCol(prefix: string, bucket: 'init' | 'cur' | 'year' | 'end', side: 'debit' | 'credit') {
  return `COALESCE(m.${prefix}_${bucket}_${side}, 0)`
}

/** 聚合 CTE 某口径按科目方向签名后的净额 */
function aggSignedNet(prefix: string, bucket: 'init' | 'cur' | 'year' | 'end') {
  return buildDirectionSignedNetSql('a.direction', aggCol(prefix, bucket, 'debit'), aggCol(prefix, bucket, 'credit'))
}

export function buildLedgerGeneralQuery(filters: {
  accountSetId: string
  startDate?: string // 开始日期
  endDate?: string // 结束日期
  accountCode?: string
  accountLevel?: number
  accountCodeStart?: string
  accountCodeEnd?: string
  filterTypes?: string[]
  includeUnposted?: boolean
  accountScope?: AccountScopeContext
  /** 账套启用日（account_sets.start_date），用于定位账前发生额归属期间 */
  accountSetStartDate?: string
  /** init_balances 是否具备 opening / pre_book 相关列；老库缺列时回退旧口径 */
  preBookEnabled?: boolean
  /** FIX-153：期初链式上溯——返回某年度实际可用的期初基准年（上年未年结时往前找） */
  resolveOpeningBaseYear?: (year: number) => number
}) {
  const { startDate, endDate } = resolveBalanceDateRange(filters.startDate, filters.endDate)

  // FIX-002 / P0-4：分别计算「起始年度年初」和「结束年度年初」
  // - 期初余额 = 起始年度年初余额 + 起始年度内 [年初, startDate) 的凭证累计
  // - 期末余额 = 结束年度年初余额 + 结束年度内 [年初, endDate] 的凭证累计
  // 跨年查询时不能用 endDate 年的 init_balances 去加 startDate 年的凭证（会重复计算）
  const startDateYear = new Date(startDate).getFullYear()
  const endDateYear = new Date(endDate).getFullYear()
  const startDateYearStart = `${startDateYear}-01-01`
  const endDateYearStart = `${endDateYear}-01-01`
  // FIX-153：上年未年结时 init_balances(year) 无行，期初 / 期末改用最近有期初行的年度作基准，凭证从该年年初累计
  const startBaseYear = filters.resolveOpeningBaseYear?.(startDateYear) ?? startDateYear
  const endBaseYear = filters.resolveOpeningBaseYear?.(endDateYear) ?? endDateYear
  const startBaseYearStart = `${startBaseYear}-01-01`
  const endBaseYearStart = `${endBaseYear}-01-01`
  // 本年累计的起始日期：endDate 所在年度的 1 月 1 日（中国财务"本年累计"按 endDate 所在年统计）
  const yearStartDate = endDateYearStart

  // FIX-105：账前发生额（启用前在旧系统记账、本系统无凭证明细的部分）视为发生在启用日前一天，
  // 据此判断它应计入期初、本期发生额还是本年累计。年初启用的账套 pre_book 恒为 0，各分支等价。
  const {
    preBookEnabled,
    initIncludesPreBook,
    currentIncludesPreBook,
    yearIncludesPreBook,
    endIncludesPreBook,
  } = resolvePreBookRangeFlags({
    accountSetStartDate: filters.accountSetStartDate,
    preBookEnabled: filters.preBookEnabled,
    startDate,
    endDate,
    yearStartDate,
  })

  // 账前发生额所在的 init_balances 年度：必须与 resolvePreBookRangeFlags 内部使用的 preBookDate 一致。
  // 原实现两个占位符都传 endDateYear，跨年查询（区间跨过启用年）时会在错误年度找不到账前行 → 金额漏算。
  const preBookYear = Number(
    resolvePreBookDate(filters.accountSetStartDate, endDateYear).slice(0, 4)
  )

  // 构建凭证状态过滤条件
  const statusCondition = filters.includeUnposted
    ? "v.status IN ('draft', 'audited', 'posted')"
    : "v.status = 'posted'"

  // 构建科目筛选条件
  const accountConditions = ['a.account_set_id = ?', 'a.is_enabled = 1']
  const accountParams: SqlParam[] = [filters.accountSetId]

  // 科目编码筛选
  if (filters.accountCode) {
    accountConditions.push('a.code LIKE ?')
    accountParams.push(`${filters.accountCode}%`)
  }

  // 科目级次筛选
  if (filters.accountLevel) {
    accountConditions.push('a.level <= ?')
    accountParams.push(filters.accountLevel)
  }

  // 科目范围查询
  if (filters.accountCodeStart) {
    accountConditions.push('a.code >= ?')
    accountParams.push(filters.accountCodeStart)
  }
  if (filters.accountCodeEnd) {
    accountConditions.push('a.code <= ?')
    accountParams.push(filters.accountCodeEnd)
  }

  appendAccountScopeCondition(filters.accountScope, 'a.id', accountConditions, accountParams)

  // 根据筛选类型构建WHERE子句（支持多选，使用OR连接）
  let havingClause = ''
  if (filters.filterTypes && filters.filterTypes.length > 0) {
    const conditions: string[] = []

    if (filters.filterTypes.includes('init_balance')) {
      conditions.push('init_balance != 0')
    }

    if (filters.filterTypes.includes('has_amount')) {
      conditions.push('(current_debit != 0 OR current_credit != 0)')
    }

    if (filters.filterTypes.includes('has_balance')) {
      conditions.push('end_balance != 0')
    }

    if (conditions.length > 0) {
      havingClause = ` AND (${conditions.join(' OR ')})`
    }
  }

  // FIX-250：分录发生额改由 entry_agg CTE 一次聚合，外层只剩 init_balances 的小子查询（按科目主键点查）
  const agg = buildEntryAggregateCte({
    accountSetId: filters.accountSetId,
    statusCondition,
    startDate,
    endDate,
    startBaseYearStart,
    endBaseYearStart,
    yearStartDate,
    values: [{ prefix: 'amt', expr: 've.amount' }],
  })

  return {
    sql: `
      WITH ${agg.sql}
      SELECT * FROM (
        SELECT * FROM (
          SELECT
            a.id as account_id,
            a.code as account_code,
            a.name as account_name,
            a.direction,
            a.level,
            a.is_foreign,
            a.currency_code,
            ${
              preBookEnabled
                ? buildAccountOpeningBalanceExpr('a.id', initIncludesPreBook)
                : buildAccountInitBalanceExpr('a.id')
            } + ${aggSignedNet('amt', 'init')} as init_balance,
            ${currentIncludesPreBook ? `${buildAccountPreBookSideExpr('a.id', 'debit', true)} +` : ''} ${aggCol('amt', 'cur', 'debit')} as current_debit,
            ${currentIncludesPreBook ? `${buildAccountPreBookSideExpr('a.id', 'credit', true)} +` : ''} ${aggCol('amt', 'cur', 'credit')} as current_credit,
            ${yearIncludesPreBook ? `${buildAccountPreBookSideExpr('a.id', 'debit', true)} +` : ''} ${aggCol('amt', 'year', 'debit')} as year_debit,
            ${yearIncludesPreBook ? `${buildAccountPreBookSideExpr('a.id', 'credit', true)} +` : ''} ${aggCol('amt', 'year', 'credit')} as year_credit,
            ${
              preBookEnabled
                ? buildAccountOpeningBalanceExpr('a.id', endIncludesPreBook)
                : buildAccountInitBalanceExpr('a.id')
            } + ${aggSignedNet('amt', 'end')} as end_balance
          FROM accounts a
          LEFT JOIN entry_agg m ON m.account_id = a.id
          ${buildWhereClause(accountConditions)}
        ) WHERE 1=1 ${havingClause}
      ) WHERE 1=1
      ORDER BY account_code
    `,
    // 占位符顺序与上面 SQL 严格对应：CTE 在最前，随后是各列 init_balances 子查询（账前发生额只在计入时出现），最后科目条件
    params: (() => {
      const p: SqlParam[] = [...agg.params]
      // 期初：startDate 所在年度（链式上溯后）的 init_balances
      p.push(filters.accountSetId, startBaseYear)
      // 本期借方 / 贷方的账前发生额
      for (const _ of [0, 1]) {
        if (currentIncludesPreBook) p.push(filters.accountSetId, preBookYear)
      }
      // 本年累计借方 / 贷方的账前发生额
      for (const _ of [0, 1]) {
        if (yearIncludesPreBook) p.push(filters.accountSetId, preBookYear)
      }
      // 期末：endDate 所在年度的 init_balances
      p.push(filters.accountSetId, endBaseYear)
      p.push(...accountParams)
      return p
    })(),
  }
}

export function buildLedgerBalanceQuery(filters: {
  accountSetId: string
  year?: string | number
  period?: string | number
  accountScope?: AccountScopeContext
  /** 账套启用日（account_sets.start_date），用于定位账前发生额归属期间 */
  accountSetStartDate?: string
  /** 是否启用账前发生额（init_balances 具备 opening / pre_book 列时为 true） */
  preBookEnabled?: boolean
}) {
  const y = Number(filters.year) || new Date().getFullYear()
  const p = Number(filters.period) || new Date().getMonth() + 1

  const accountConditions = ['a.account_set_id = ?', 'a.is_enabled = 1']
  const accountParams: SqlParam[] = [filters.accountSetId]
  appendAccountScopeCondition(filters.accountScope, 'a.id', accountConditions, accountParams)

  // FIX-105：账前发生额归属「启用日前一天」所在期间；期初改取年初余额，与科目余额表口径一致
  const { preBookEnabled, preBookInYear, preBookMonth, initIncludesPreBook } =
    resolvePreBookYearFlags({
      accountSetStartDate: filters.accountSetStartDate,
      preBookEnabled: filters.preBookEnabled,
      year: y,
    })
  const currentPreBookFactor = preBookEnabled && preBookInYear && preBookMonth === p ? 1 : 0
  const cumPreBookFactor = preBookEnabled && preBookInYear && preBookMonth <= p ? 1 : 0

  // 期初余额子查询：有辅助明细时只汇总辅助行，避免与科目级期初重复
  const initBalanceSubquery = preBookEnabled
    ? `
    SELECT ib.account_id,
      ${buildOpeningBalanceSumExpr('ib', 'ia')} + ${
        initIncludesPreBook
          ? `(${buildDirectionSignedNetSql(
              'ia.direction',
              buildPreBookSumExpr('debit', 'ib'),
              buildPreBookSumExpr('credit', 'ib')
            )})`
          : '0'
      } as init_balance,
      ${buildPreBookSumExpr('debit', 'ib')} as pre_book_debit,
      ${buildPreBookSumExpr('credit', 'ib')} as pre_book_credit
    FROM init_balances ib
    JOIN accounts ia ON ia.id = ib.account_id
    WHERE ib.year = ? AND ib.account_set_id = ?
    GROUP BY ib.account_id
  `
    : `
    SELECT account_id,
      ${buildInitBalanceSumExpr()} as init_balance,
      0 as pre_book_debit,
      0 as pre_book_credit
    FROM init_balances
    WHERE year = ? AND account_set_id = ?
    GROUP BY account_id
  `

  // FIX-006 / P0-2+P0-3：
  // 旧实现 SUM(end_balance) WHERE period=? 严重错误 —— account_balances.end_balance
  // 由 applyVoucherPosting 写入时仅 = 年初 + 本期净额，缺失 1~N-1 期发生额。
  // 改为动态计算：
  //   - 本期借/贷：仅本期（period = ?）发生额
  //   - 累计借/贷：从年初到本期（period <= ?）发生额
  //   - end_balance = 期初 + 按方向取的累计净额（在外层用 a.direction 计算）
  const currentBalanceSubquery = `
    SELECT
      account_id,
      SUM(CASE WHEN period = ? THEN current_debit ELSE 0 END) as current_debit,
      SUM(CASE WHEN period = ? THEN current_credit ELSE 0 END) as current_credit,
      SUM(current_debit) as cum_debit,
      SUM(current_credit) as cum_credit
    FROM account_balances
    WHERE year = ? AND period <= ? AND account_set_id = ?
    GROUP BY account_id
  `

  return {
    sql: `
      SELECT * FROM (
        SELECT
          a.code as account_code,
          a.name as account_name,
          a.direction,
          a.level,
          COALESCE(ib.init_balance, 0) as init_balance,
          COALESCE(cb.current_debit, 0) + ${currentPreBookFactor} * COALESCE(ib.pre_book_debit, 0) as current_debit,
          COALESCE(cb.current_credit, 0) + ${currentPreBookFactor} * COALESCE(ib.pre_book_credit, 0) as current_credit,
          CASE WHEN a.direction = 'debit'
            THEN COALESCE(ib.init_balance, 0)
                 + COALESCE(cb.cum_debit, 0) + ${cumPreBookFactor} * COALESCE(ib.pre_book_debit, 0)
                 - COALESCE(cb.cum_credit, 0) - ${cumPreBookFactor} * COALESCE(ib.pre_book_credit, 0)
            ELSE COALESCE(ib.init_balance, 0)
                 + COALESCE(cb.cum_credit, 0) + ${cumPreBookFactor} * COALESCE(ib.pre_book_credit, 0)
                 - COALESCE(cb.cum_debit, 0) - ${cumPreBookFactor} * COALESCE(ib.pre_book_debit, 0)
          END as end_balance
        FROM accounts a
        LEFT JOIN (${initBalanceSubquery}) ib ON ib.account_id = a.id
        LEFT JOIN (${currentBalanceSubquery}) cb ON cb.account_id = a.id
        WHERE ${accountConditions.join(' AND ')}
      ) WHERE init_balance != 0 OR current_debit != 0 OR current_credit != 0 OR end_balance != 0
      ORDER BY account_code
    `,
    params: [
      // initBalanceSubquery: year, account_set_id
      y,
      filters.accountSetId,
      // currentBalanceSubquery: period (本期借), period (本期贷), year, period (累计上限), account_set_id
      p,
      p,
      y,
      p,
      filters.accountSetId,
      // 外层 accounts
      ...accountParams,
    ],
  }
}

// ===================== 总分类账（带月度汇总） =====================

export function buildGeneralLedgerQuery(filters: {
  accountSetId: string
  year?: string | number
  accountCode?: string
  accountLevel?: number
  includeUnposted?: boolean
  accountScope?: AccountScopeContext
  /** 账套启用日（account_sets.start_date），用于定位账前发生额归属月份 */
  accountSetStartDate?: string
  /** init_balances 是否具备 opening / pre_book 相关列；老库缺列时回退旧口径 */
  preBookEnabled?: boolean
  /**
   * 月度发生额是否排除凭证类型为「结转」的凭证（财务分析口径）。
   * 损益类科目月末结转后余额归零，不排除的话费用发生额会被结转分录抵消。
   */
  excludeTransfer?: boolean
}) {
  const y = Number(filters.year) || new Date().getFullYear()

  // 构建凭证状态过滤条件
  const statusCondition = filters.includeUnposted
    ? "v.status IN ('draft', 'audited', 'posted')"
    : "v.status = 'posted'"
  // FIX-143 / GL-09：按 is_closing 标志排除结转凭证；LEFT JOIN 保证无凭证类型的分录不被连带丢弃
  const transferJoin = filters.excludeTransfer ? CLOSING_VOUCHER_TYPE_JOIN_SQL : ''

  // 科目筛选条件
  const conditions: string[] = ['a.account_set_id = ?', 'a.is_enabled = 1']
  const accountParams: SqlParam[] = [filters.accountSetId]

  if (filters.accountCode) {
    conditions.push('a.code LIKE ?')
    accountParams.push(`${filters.accountCode}%`)
  }
  if (filters.accountLevel) {
    conditions.push('a.level <= ?')
    accountParams.push(filters.accountLevel)
  }

  appendAccountScopeCondition(filters.accountScope, 'a.id', conditions, accountParams)

  // FIX-250：CTE 改为凭证驱动（CROSS JOIN 提示，见 buildEntryAggregateCte 说明），账套条件放在凭证侧供索引使用
  const cteConditions = [
    'v.account_set_id = ?',
    've.account_set_id = ?',
    statusCondition,
    'v.voucher_date >= ?',
    'v.voucher_date <= ?',
    ...(filters.excludeTransfer ? [NOT_CLOSING_VOUCHER_SQL] : []),
  ]
  const cteParams: SqlParam[] = [filters.accountSetId, filters.accountSetId, `${y}-01-01`, `${y}-12-31`]
  appendAccountScopeCondition(filters.accountScope, 've.account_id', cteConditions, cteParams)

  // FIX-331：指定了科目（科目分析、总账按科目查）时，外层只取该科目子树，CTE 却聚合了全年全部凭证的全部分录
  // （10 万凭证时科目分析 1.8s）。此时限定分录科目并改由分录 (账套, 科目) 索引出发；未指定科目仍为凭证驱动
  const subtreeCondition = 've.account_id IN (SELECT id FROM accounts WHERE account_set_id = ? AND code LIKE ?)'
  const subtreeParams: SqlParam[] = filters.accountCode ? [filters.accountSetId, `${filters.accountCode}%`] : []
  if (filters.accountCode) {
    cteConditions.push(subtreeCondition)
    cteParams.push(...subtreeParams)
  }
  const entryFrom = filters.accountCode
    ? 'voucher_entries ve\n        CROSS JOIN vouchers v ON v.id = ve.voucher_id'
    : 'vouchers v\n        CROSS JOIN voucher_entries ve ON ve.voucher_id = v.id'

  // FIX-105：账前发生额落在启用日前一天所属月份。中途启用账套的 1~N-1 月没有凭证明细，
  // 只有这一笔汇总数，挂在启用前最后一个月，可保证「期初 + 各月 = 期末」逐列勾稽。
  // 账前发生额落在本年之前时并入期初，否则期初只取年初余额
  const { preBookEnabled, preBookMonth, initIncludesPreBook } = resolvePreBookYearFlags({
    accountSetStartDate: filters.accountSetStartDate,
    preBookEnabled: filters.preBookEnabled,
    year: y,
  })

  // 构建月份列的输出
  const monthColumns: string[] = []
  const monthPreBookParams: SqlParam[] = []
  for (let month = 1; month <= 12; month++) {
    if (month === preBookMonth) {
      monthColumns.push(
        `COALESCE(am.month${month}_debit, 0) + ${buildAccountPreBookSideExpr('a.id', 'debit', true)} as month${month}_debit`
      )
      monthColumns.push(
        `COALESCE(am.month${month}_credit, 0) + ${buildAccountPreBookSideExpr('a.id', 'credit', true)} as month${month}_credit`
      )
      monthPreBookParams.push(filters.accountSetId, y, filters.accountSetId, y)
    } else {
      monthColumns.push(`COALESCE(am.month${month}_debit, 0) as month${month}_debit`)
      monthColumns.push(`COALESCE(am.month${month}_credit, 0) as month${month}_credit`)
    }
  }

  return {
    sql: `
      WITH monthly_amounts AS (
        -- 一次性聚合所有科目的月度发生额
        SELECT
          ve.account_id,
          CAST(strftime('%m', v.voucher_date) AS INTEGER) as month,
          ve.direction,
          SUM(ve.amount) as amount
        FROM ${entryFrom}
        ${transferJoin}
        WHERE ${cteConditions.join(' AND ')}
        GROUP BY ve.account_id, month, ve.direction
      ),
      account_monthly AS (
        -- 将月度数据透视为列
        SELECT
          account_id,
          SUM(CASE WHEN month = 1 AND direction = 'debit' THEN amount ELSE 0 END) as month1_debit,
          SUM(CASE WHEN month = 1 AND direction = 'credit' THEN amount ELSE 0 END) as month1_credit,
          SUM(CASE WHEN month = 2 AND direction = 'debit' THEN amount ELSE 0 END) as month2_debit,
          SUM(CASE WHEN month = 2 AND direction = 'credit' THEN amount ELSE 0 END) as month2_credit,
          SUM(CASE WHEN month = 3 AND direction = 'debit' THEN amount ELSE 0 END) as month3_debit,
          SUM(CASE WHEN month = 3 AND direction = 'credit' THEN amount ELSE 0 END) as month3_credit,
          SUM(CASE WHEN month = 4 AND direction = 'debit' THEN amount ELSE 0 END) as month4_debit,
          SUM(CASE WHEN month = 4 AND direction = 'credit' THEN amount ELSE 0 END) as month4_credit,
          SUM(CASE WHEN month = 5 AND direction = 'debit' THEN amount ELSE 0 END) as month5_debit,
          SUM(CASE WHEN month = 5 AND direction = 'credit' THEN amount ELSE 0 END) as month5_credit,
          SUM(CASE WHEN month = 6 AND direction = 'debit' THEN amount ELSE 0 END) as month6_debit,
          SUM(CASE WHEN month = 6 AND direction = 'credit' THEN amount ELSE 0 END) as month6_credit,
          SUM(CASE WHEN month = 7 AND direction = 'debit' THEN amount ELSE 0 END) as month7_debit,
          SUM(CASE WHEN month = 7 AND direction = 'credit' THEN amount ELSE 0 END) as month7_credit,
          SUM(CASE WHEN month = 8 AND direction = 'debit' THEN amount ELSE 0 END) as month8_debit,
          SUM(CASE WHEN month = 8 AND direction = 'credit' THEN amount ELSE 0 END) as month8_credit,
          SUM(CASE WHEN month = 9 AND direction = 'debit' THEN amount ELSE 0 END) as month9_debit,
          SUM(CASE WHEN month = 9 AND direction = 'credit' THEN amount ELSE 0 END) as month9_credit,
          SUM(CASE WHEN month = 10 AND direction = 'debit' THEN amount ELSE 0 END) as month10_debit,
          SUM(CASE WHEN month = 10 AND direction = 'credit' THEN amount ELSE 0 END) as month10_credit,
          SUM(CASE WHEN month = 11 AND direction = 'debit' THEN amount ELSE 0 END) as month11_debit,
          SUM(CASE WHEN month = 11 AND direction = 'credit' THEN amount ELSE 0 END) as month11_credit,
          SUM(CASE WHEN month = 12 AND direction = 'debit' THEN amount ELSE 0 END) as month12_debit,
          SUM(CASE WHEN month = 12 AND direction = 'credit' THEN amount ELSE 0 END) as month12_credit
        FROM monthly_amounts
        GROUP BY account_id
      ),
      pre_year AS MATERIALIZED (
        -- FIX-323：本年无期初行时，期初 = 年初之前的凭证累计。原为逐科目关联子查询（每科目扫一遍自己的全部分录再回查凭证
        -- 判日期，10 万凭证时总分类账 4.6s），改为按凭证日期索引只取年初前凭证、按科目一次聚合；只在该分支被引用时计算
        SELECT ve.account_id,
          SUM(CASE WHEN ve.direction = 'debit' THEN ve.amount ELSE 0 END) AS dr,
          SUM(CASE WHEN ve.direction = 'credit' THEN ve.amount ELSE 0 END) AS cr
        FROM ${entryFrom}
        WHERE v.account_set_id = ? AND ve.account_set_id = ? AND ${statusCondition} AND v.voucher_date < ?${
          filters.accountCode ? `\n          AND ${subtreeCondition}` : ''
        }
        GROUP BY ve.account_id
      )
      SELECT
        a.id as account_id,
        a.code as account_code,
        a.name as account_name,
        a.direction,
        a.level,
        a.parent_id,
        -- 期初余额 = 年初余额（含落在本年之前的账前发生额）+ 该年1月1日之前的凭证累计
        -- FIX-129：本年 init_balances 已有行（年结写入或手工录入）时，年初余额已含上年全部活动，
        -- 不再累计上年凭证，否则年结后期初双计；本年无行（上年未年结）时保留上溯累计
        ${
          preBookEnabled
            ? buildAccountOpeningBalanceExpr('a.id', initIncludesPreBook)
            : buildAccountInitBalanceExpr('a.id')
        } + CASE WHEN EXISTS (
          SELECT 1 FROM init_balances ib0 WHERE ib0.account_set_id = ? AND ib0.year = ?
        ) THEN ${
          filters.includeUnposted
            ? `CASE WHEN EXISTS (
                SELECT 1 FROM init_balances ib1
                WHERE ib1.account_set_id = ? AND ib1.year = ? AND ib1.source = 'year_close_auto'
              ) THEN COALESCE(
                -- FIX-129 补充：年结期初只含已过账凭证，「含未记账」口径下把上年未记账凭证单独累回来
                (SELECT
                   CASE WHEN a.direction = 'debit'
                     THEN SUM(CASE WHEN ve.direction = 'debit' THEN ve.amount ELSE -ve.amount END)
                     ELSE SUM(CASE WHEN ve.direction = 'credit' THEN ve.amount ELSE -ve.amount END)
                   END
                 FROM voucher_entries ve
                 JOIN vouchers v ON v.id = ve.voucher_id
                 WHERE ve.account_id = a.id
                   AND ve.account_set_id = ?
                   AND v.status IN ('draft', 'audited')
                   AND v.voucher_date < ?),
                0
              ) ELSE 0 END`
            : '0'
        } ELSE COALESCE(
          (SELECT CASE WHEN a.direction = 'debit' THEN py.dr - py.cr ELSE py.cr - py.dr END
           FROM pre_year py WHERE py.account_id = a.id),
          0
        ) END as init_balance,
        -- 各月发生额（从 CTE 中获取，账前发生额并入其归属月份）
        ${monthColumns.join(',\n        ')}
      FROM accounts a
      LEFT JOIN account_monthly am ON a.id = am.account_id
      ${buildWhereClause(conditions)}
    `,
    params: [
      // monthly_amounts CTE
      ...cteParams,
      // pre_year CTE（FIX-323）
      filters.accountSetId,
      filters.accountSetId,
      `${y}-01-01`,
      ...subtreeParams,
      // init_balances 年初余额
      filters.accountSetId,
      y,
      // FIX-129：本年是否已有期初行（有则不累计上年凭证）
      filters.accountSetId,
      y,
      // FIX-129 补充：含未记账时，年结自动行 + 上年未记账凭证
      ...(filters.includeUnposted ? [filters.accountSetId, y, filters.accountSetId, `${y}-01-01`] : []),
      // 账前发生额所在月份列
      ...monthPreBookParams,
      // 科目筛选
      ...accountParams,
    ],
  }
}

export function buildCashJournalQuery(filters: {
  accountSetId: string
  year?: string | number
  period?: string | number
  startDate?: string
  endDate?: string
  accountId?: string
  accountType?: string
  direction?: string
  minAmount?: number
  maxAmount?: number
  oppositeAccountCode?: string
  includeUnposted?: boolean
  page: number
  pageSize: number
  accountScope?: AccountScopeContext
}) {
  const hasDateRange = Boolean(filters.startDate || filters.endDate)
  const y = Number(filters.year) || new Date().getFullYear()
  const p = Number(filters.period) || new Date().getMonth() + 1

  // 构建凭证状态过滤条件
  const statusCondition = filters.includeUnposted
    ? "v.status IN ('draft', 'audited', 'posted')"
    : "v.status = 'posted'"

  const conditions = ['ve.account_set_id = ?', statusCondition]
  const params: SqlParam[] = [filters.accountSetId]

  if (!hasDateRange) {
    conditions.push('v.year = ?', 'v.period = ?')
    params.push(y, p)
  }

  // 日期范围筛选
  if (filters.startDate) {
    conditions.push('v.voucher_date >= ?')
    params.push(filters.startDate)
  }
  if (filters.endDate) {
    conditions.push('v.voucher_date <= ?')
    params.push(filters.endDate)
  }

  if (filters.accountId) {
    // FIX-023 / P2-26：原 `>= AND < code || 'z'` 范围对非数字编码（含 CJK、'~' 等大于 'z'）不可靠，
    // 改用 LIKE prefix 匹配，更稳健（SQLite LIKE 对 ASCII 大小写不敏感，但科目编码场景安全）
    conditions.push(`(ve.account_id = ? OR (a.code LIKE (SELECT code FROM accounts WHERE id = ?) || '%'))`)
    params.push(filters.accountId, filters.accountId)
  } else if (filters.accountType === 'cash') {
    conditions.push('a.is_cash = 1')
  } else if (filters.accountType === 'bank') {
    conditions.push('a.is_bank = 1')
  }

  appendAccountScopeCondition(filters.accountScope, 'a.id', conditions, params)

  // 收支类型筛选
  if (filters.direction) {
    conditions.push('ve.direction = ?')
    params.push(filters.direction)
  }

  // 金额范围筛选
  if (filters.minAmount !== undefined) {
    conditions.push('ve.amount >= ?')
    params.push(filters.minAmount)
  }
  if (filters.maxAmount !== undefined) {
    conditions.push('ve.amount <= ?')
    params.push(filters.maxAmount)
  }

  // 对方科目筛选 (需要子查询)
  let oppositeAccountFilter = ''
  if (filters.oppositeAccountCode) {
    oppositeAccountFilter = `
      AND EXISTS (
        SELECT 1 FROM voucher_entries ve2
        WHERE ve2.voucher_id = ve.voucher_id
          AND ve2.id != ve.id
          AND ve2.account_code LIKE ?
      )
    `
    params.push(`${filters.oppositeAccountCode}%`)
  }

  const whereClause = buildWhereClause(conditions)
  const balanceStartDate = filters.startDate || `${y}-${String(p).padStart(2, '0')}-01`
  const balanceYear = Number(balanceStartDate.slice(0, 4)) || y
  const balanceYearStartDate = `${balanceYear}-01-01`
  const initConditions = ['ve.account_set_id = ?', statusCondition]
  const initParams: SqlParam[] = [filters.accountSetId]

  if (filters.accountId) {
    initConditions.push(`(ve.account_id = ? OR (a.code LIKE (SELECT code FROM accounts WHERE id = ?) || '%'))`)
    initParams.push(filters.accountId, filters.accountId)
  } else if (filters.accountType === 'cash') {
    initConditions.push('a.is_cash = 1')
  } else if (filters.accountType === 'bank') {
    initConditions.push('a.is_bank = 1')
  }

  appendAccountScopeCondition(filters.accountScope, 'a.id', initConditions, initParams)

  // 期初：仅汇总科目树下末级，且不做「父科目 id + 子科目编码」双路径匹配，避免重复
  const initAccountFilter = filters.accountId
    ? `AND (a.code LIKE (SELECT code FROM accounts WHERE id = ?) || '%')`
    : filters.accountType === 'cash'
      ? 'AND a.is_cash = 1'
      : filters.accountType === 'bank'
        ? 'AND a.is_bank = 1'
        : ''
  const initWhereClause = buildWhereClause(initConditions)

  // 查询对方科目：从同一凭证的其他分录中获取
  // 使用 GROUP_CONCAT 合并多个对方科目
  return {
    initBalanceSql: `
      SELECT
        ${buildScopedInitBalanceSumSql(initAccountFilter)} + COALESCE(
          (SELECT SUM(
             CASE WHEN a.direction = 'debit'
               THEN CASE WHEN ve.direction = 'debit' THEN ve.amount ELSE -ve.amount END
               ELSE CASE WHEN ve.direction = 'credit' THEN ve.amount ELSE -ve.amount END
             END
           )
           FROM voucher_entries ve
           JOIN vouchers v ON v.id = ve.voucher_id
           JOIN accounts a ON a.id = ve.account_id
           ${initWhereClause}
             AND v.voucher_date >= ?
             AND v.voucher_date < ?),
          0
        ) as init_balance
    `,
    countSql: `
      SELECT COUNT(*) as count
      FROM voucher_entries ve
      JOIN vouchers v ON v.id = ve.voucher_id
      JOIN accounts a ON a.id = ve.account_id
      ${whereClause}
      ${oppositeAccountFilter}
    `,
    carryAmountSql: `
      SELECT COALESCE(SUM(
        ${buildSignedEntryAmountSql('account_direction', 'direction', 'amount')}
      ), 0) as carry_amount
      FROM (
        SELECT ve.direction, ve.amount, a.direction as account_direction
        FROM voucher_entries ve
        JOIN vouchers v ON v.id = ve.voucher_id
        JOIN accounts a ON a.id = ve.account_id
        ${whereClause}
        ${oppositeAccountFilter}
        ORDER BY v.voucher_date, v.voucher_no, ve.seq
        LIMIT ? OFFSET 0
      )
    `,
    listSql: `
      SELECT
        ve.id,
        ve.voucher_id,
        ve.account_id,
        v.voucher_date,
        v.voucher_no,
        v.status as voucher_status,
        a.code as account_code,
        a.name as account_name,
        a.direction as account_direction,
        ve.summary,
        ve.direction,
        ve.amount,
        v.maker_name,
        v.auditor_name,
        (
          SELECT GROUP_CONCAT(ve2.account_code || ' ' || ve2.account_name, ', ')
          FROM voucher_entries ve2
          WHERE ve2.voucher_id = ve.voucher_id
            AND ve2.id != ve.id
        ) as opposite_accounts
      FROM voucher_entries ve
      JOIN vouchers v ON v.id = ve.voucher_id
      JOIN accounts a ON a.id = ve.account_id
      ${whereClause}
      ${oppositeAccountFilter}
      ORDER BY v.voucher_date, v.voucher_no, ve.seq
      LIMIT ? OFFSET ?
    `,
    initBalanceParams: [
      filters.accountSetId,
      balanceYear,
      // FIX-023 / P2-26：initAccountFilter 现在用 LIKE 1 个占位符（原 >=/< 是 2 个）
      ...(filters.accountId ? [filters.accountId] : []),
      ...initParams,
      balanceYearStartDate,
      balanceStartDate,
    ],
    carryAmountParams: [...params, (filters.page - 1) * filters.pageSize],
    countParams: params,
    listParams: [...params, filters.pageSize, (filters.page - 1) * filters.pageSize],
  }
}

export function buildLedgerDetailQuery(filters: {
  accountSetId: string
  year?: string | number
  period?: string | number
  accountId?: string
  accountCodeStart?: string
  accountCodeEnd?: string
  /** 复币明细账按币种过滤区间内的子科目（仅编码区间分支生效） */
  currencyCode?: string
  startDate?: string
  endDate?: string
  auxType?: string
  auxId?: string
  voucherTypeId?: string
  makerName?: string
  auditorName?: string
  summaryKeyword?: string
  minAmount?: number
  maxAmount?: number
  includeUnposted?: boolean
  page: number
  pageSize: number
  accountScope?: AccountScopeContext
  /** 账套启用日（account_sets.start_date），用于定位账前发生额归属期间 */
  accountSetStartDate?: string
  /** init_balances 是否具备 opening / pre_book 相关列；老库缺列时回退旧口径 */
  preBookEnabled?: boolean
  /** 评审 P1-8：期初链式上溯（与总账 / 余额表同口径，见 initBalanceScope.resolveOpeningBaseYear） */
  resolveOpeningBaseYear?: (year: number) => number
}) {
  const startDateYear = filters.startDate ? new Date(filters.startDate).getFullYear() : undefined
  const y = Number(filters.year) || startDateYear || new Date().getFullYear()
  // 评审 P1-8：上年未年结时 init_balances(y) 无行，期初改用最近有期初行的年度，凭证从该年年初累计
  const openingBaseYear = filters.resolveOpeningBaseYear?.(y) ?? y

  // 构建凭证状态过滤条件
  const statusCondition = filters.includeUnposted
    ? "v.status IN ('draft', 'audited', 'posted')"
    : "v.status = 'posted'"

  const conditions = ['ve.account_set_id = ?', statusCondition]
  const params: SqlParam[] = [filters.accountSetId]
  const rangeCurrency = String(filters.currencyCode || '').trim().toUpperCase()

  // 科目筛选：编码区间（父科目汇总）支持单边界，其次使用科目ID（叶子科目）
  if (filters.accountCodeStart || filters.accountCodeEnd) {
    const scopeParts: string[] = []
    const scopeParams: SqlParam[] = []
    appendAccountScopeCondition(filters.accountScope, 'id', scopeParts, scopeParams)
    const scopeSql = scopeParts.length > 0 ? ` AND ${scopeParts.join(' AND ')}` : ''
    const rangeParts: string[] = ['account_set_id = ?']
    const rangeParams: SqlParam[] = [filters.accountSetId]
    if (filters.accountCodeStart) { rangeParts.push('code >= ?'); rangeParams.push(filters.accountCodeStart) }
    if (filters.accountCodeEnd) { rangeParts.push('code <= ?'); rangeParams.push(filters.accountCodeEnd) }
    if (rangeCurrency) { rangeParts.push("UPPER(COALESCE(currency_code, '')) = ?"); rangeParams.push(rangeCurrency) }
    conditions.push(`ve.account_id IN (
      SELECT id FROM accounts
      WHERE ${rangeParts.join(' AND ')}${scopeSql}
    )`)
    params.push(...rangeParams, ...scopeParams)
  } else if (filters.accountId) {
    conditions.push('ve.account_id = ?')
    params.push(filters.accountId)
  } else {
    appendAccountScopeCondition(filters.accountScope, 've.account_id', conditions, params)
  }

  if (filters.startDate) {
    conditions.push('v.voucher_date >= ?')
    params.push(filters.startDate)
  }

  if (filters.endDate) {
    conditions.push('v.voucher_date <= ?')
    params.push(filters.endDate)
  }

  // 辅助核算筛选
  // FIX-152：改用 buildAuxItemMatchCondition（aux_data JSON 双 key + legacy 固定列），
  // 自定义辅助类目此前因无 legacy 列而不拼任何条件，静默返回全量分录
  let auxMatchSql = ''
  const auxMatchParams: SqlParam[] = []
  if (filters.auxType && filters.auxId) {
    auxMatchSql = buildAuxItemMatchCondition(filters.auxType, '?', { categoryId: filters.auxType })
    appendAuxItemMatchParams(auxMatchParams, filters.auxType, [filters.auxId], { categoryId: filters.auxType })
    conditions.push(auxMatchSql)
    params.push(...auxMatchParams)
  }
  const auxItemIdKey =
    filters.auxType && filters.auxId ? `${filters.auxType}:${filters.auxId}` : ''

  // 凭证类型筛选
  if (filters.voucherTypeId) {
    conditions.push('v.voucher_type_id = ?')
    params.push(filters.voucherTypeId)
  }

  // 制单人筛选
  if (filters.makerName) {
    conditions.push('v.maker_name LIKE ?')
    params.push(`%${filters.makerName}%`)
  }

  // 审核人筛选
  if (filters.auditorName) {
    conditions.push('v.auditor_name LIKE ?')
    params.push(`%${filters.auditorName}%`)
  }

  // 摘要关键词搜索
  if (filters.summaryKeyword) {
    conditions.push('ve.summary LIKE ?')
    params.push(`%${filters.summaryKeyword}%`)
  }

  // 金额范围筛选
  if (filters.minAmount !== undefined) {
    conditions.push('ve.amount >= ?')
    params.push(filters.minAmount)
  }
  if (filters.maxAmount !== undefined) {
    conditions.push('ve.amount <= ?')
    params.push(filters.maxAmount)
  }

  // 年初至 start_date 前的凭证发生额；amountExpr 换成原币即得原币口径
  const buildVoucherInitBeforeStartSql = (
    accountWhereSql: string,
    extraParams: SqlParam[],
    amountExpr = 've.amount'
  ) => {
    const auxClause = auxMatchSql ? ` AND ${auxMatchSql}` : ''
    return {
      sql: `(SELECT SUM(
             CASE WHEN a.direction = 'debit'
               THEN CASE WHEN ve.direction = 'debit' THEN ${amountExpr} ELSE -${amountExpr} END
               ELSE CASE WHEN ve.direction = 'credit' THEN ${amountExpr} ELSE -${amountExpr} END
             END
           )
           FROM voucher_entries ve
           JOIN vouchers v ON v.id = ve.voucher_id
           JOIN accounts a ON a.id = ve.account_id
           WHERE ve.account_set_id = ?
             AND v.account_set_id = ?
             AND ${statusCondition}
             AND v.voucher_date >= ?
             AND v.voucher_date < ?
             ${accountWhereSql}${auxClause})`,
      params: [
        filters.accountSetId,
        filters.accountSetId,
        openingBaseYearStart,
        balanceStartDate,
        ...extraParams,
        ...auxMatchParams,
      ] as SqlParam[],
    }
  }

  const buildInitFromTableSql = (accountWhereSql: string, accountParams: SqlParam[]) => {
    if (auxItemIdKey) {
      // 无条件 JOIN accounts，使 INIT_BALANCE_AMOUNT_EXPR 可按 a.direction 签名（P1-16）
      return {
        sql: `COALESCE(
          (SELECT ${INIT_BALANCE_AMOUNT_EXPR}
           FROM init_balances ib
           JOIN accounts a ON a.id = ib.account_id
           WHERE ib.account_set_id = ?
             AND ib.year = ?
             ${accountWhereSql}
             AND ${buildAuxItemIdMatchCondition()}),
          0
        )`,
        params: [
          filters.accountSetId,
          openingBaseYear,
          ...accountParams,
          auxItemIdKey,
          auxItemIdKey,
          auxItemIdKey,
          auxItemIdKey,
        ] as SqlParam[],
      }
    }
    if (accountWhereSql.includes('ib.account_id = ?')) {
      const accountId = accountParams[0]
      return {
        sql: buildAccountInitBalanceExpr('?'),
        params: [accountId, filters.accountSetId, openingBaseYear] as SqlParam[],
      }
    }
    return {
      sql: buildScopedInitBalanceSumSql(accountWhereSql),
      params: [filters.accountSetId, openingBaseYear, ...accountParams],
    }
  }

  let initBalanceSql: string
  let initBalanceParams: SqlParam[]
  const balanceStartDate = filters.startDate || `${y}-01-01`
  const openingBaseYearStart = `${openingBaseYear}-01-01`

  // FIX-148 / GL-06：编码区间支持单边界（与上方分录侧一致），期初 / 原币期初 / 账前发生额三处共用
  const hasCodeRange = Boolean(filters.accountCodeStart || filters.accountCodeEnd)
  const rangeWhereSql =
    'AND a.account_set_id = ?' +
    (filters.accountCodeStart ? ' AND a.code >= ?' : '') +
    (filters.accountCodeEnd ? ' AND a.code <= ?' : '')
  const rangeWhereParams: SqlParam[] = [
    filters.accountSetId,
    ...(filters.accountCodeStart ? [filters.accountCodeStart] : []),
    ...(filters.accountCodeEnd ? [filters.accountCodeEnd] : []),
  ]

  if (hasCodeRange) {
    const initTable = buildInitFromTableSql(rangeWhereSql, rangeWhereParams)
    const voucherInit = buildVoucherInitBeforeStartSql(rangeWhereSql, rangeWhereParams)
    initBalanceSql = `
      SELECT
        ${initTable.sql} + COALESCE(${voucherInit.sql}, 0) as init_balance
    `
    initBalanceParams = [...initTable.params, ...voucherInit.params]
  } else if (filters.accountId) {
    const initTable = auxItemIdKey
      ? buildInitFromTableSql('AND ib.account_id = ?', [filters.accountId])
      : {
          sql: buildAccountInitBalanceExpr('?'),
          params: [filters.accountId, filters.accountSetId, openingBaseYear] as SqlParam[],
        }
    const voucherInit = buildVoucherInitBeforeStartSql('AND ve.account_id = ?', [filters.accountId])
    initBalanceSql = `
      SELECT
        ${initTable.sql} + COALESCE(${voucherInit.sql}, 0) as init_balance
    `
    initBalanceParams = [...initTable.params, ...voucherInit.params]
  } else {
    initBalanceSql = `
      SELECT 0 as init_balance
    `
    initBalanceParams = []
  }

  // 原币期初：init_balances.foreign_init_balance（科目级，不含辅助项）+ 年初至 start_date 前凭证原币发生额。
  // 编码区间只取叶子科目，避免父科目若也录了期初被重复累加；按币种过滤时只累计该币种子科目。
  const FX_AMOUNT = 'COALESCE(ve.foreign_amount, 0)'
  let foreignInitBalanceSql: string
  let foreignInitBalanceParams: SqlParam[]
  if (hasCodeRange) {
    const currencyClause = rangeCurrency ? " AND UPPER(COALESCE(a.currency_code, '')) = ?" : ''
    const currencyParams: SqlParam[] = rangeCurrency ? [rangeCurrency] : []
    const voucherInit = buildVoucherInitBeforeStartSql(
      `${rangeWhereSql}${currencyClause}`,
      [...rangeWhereParams, ...currencyParams],
      FX_AMOUNT
    )
    foreignInitBalanceSql = `
      SELECT COALESCE(
        (SELECT SUM(ib.foreign_init_balance)
         FROM init_balances ib
         JOIN accounts a ON a.id = ib.account_id
         WHERE ib.account_set_id = ?
           AND ib.year = ?
           AND COALESCE(ib.aux_item_id, '') = ''
           ${rangeWhereSql}${currencyClause}
           ${INIT_BALANCE_LEAF_ACCOUNTS_ONLY}),
        0
      ) + COALESCE(${voucherInit.sql}, 0) as foreign_init_balance
    `
    foreignInitBalanceParams = [
      filters.accountSetId,
      openingBaseYear,
      ...rangeWhereParams,
      ...currencyParams,
      ...voucherInit.params,
    ]
  } else if (filters.accountId) {
    const voucherInit = buildVoucherInitBeforeStartSql('AND ve.account_id = ?', [filters.accountId], FX_AMOUNT)
    foreignInitBalanceSql = `
      SELECT COALESCE(
        (SELECT SUM(ib.foreign_init_balance)
         FROM init_balances ib
         WHERE ib.account_set_id = ? AND ib.account_id = ? AND ib.year = ?
           AND COALESCE(ib.aux_item_id, '') = ''),
        0
      ) + COALESCE(${voucherInit.sql}, 0) as foreign_init_balance
    `
    foreignInitBalanceParams = [filters.accountSetId, filters.accountId, openingBaseYear, ...voucherInit.params]
  } else {
    foreignInitBalanceSql = `
      SELECT 0 as foreign_init_balance
    `
    foreignInitBalanceParams = []
  }

  // FIX-105：账前发生额（中途启用账套里启用前的累计发生额，无凭证明细）。
  // 明细账的「本年累计」需要它作为起点，否则只剩启用后的零头。
  // 仅当查询区间覆盖其归属日（启用日前一天）时才返回，避免按月查询时重复计入。
  let preBookSql = 'SELECT 0 as pre_book_debit, 0 as pre_book_credit'
  let preBookParams: SqlParam[] = []
  if (filters.preBookEnabled) {
    const { preBookDate, preBookInYear } = resolvePreBookYearFlags({
      accountSetStartDate: filters.accountSetStartDate,
      preBookEnabled: filters.preBookEnabled,
      year: y,
    })
    const inRange =
      preBookInYear &&
      preBookDate >= balanceStartDate &&
      (!filters.endDate || preBookDate <= filters.endDate)
    if (inRange && !auxItemIdKey) {
      if (hasCodeRange) {
        preBookSql = buildScopedPreBookSumSql(rangeWhereSql)
        preBookParams = [
          filters.accountSetId,
          y,
          ...rangeWhereParams,
          filters.accountSetId,
          y,
          ...rangeWhereParams,
        ]
      } else if (filters.accountId) {
        preBookSql = buildScopedPreBookSumSql('AND ib.account_id = ?', { leafAccountsOnly: false })
        preBookParams = [
          filters.accountSetId,
          y,
          filters.accountId,
          filters.accountSetId,
          y,
          filters.accountId,
        ]
      }
    }
  }

  const whereClause = buildWhereClause(conditions)

  return {
    initBalanceSql,
    initBalanceParams,
    foreignInitBalanceSql,
    foreignInitBalanceParams,
    preBookSql,
    preBookParams,
    countSql: `
      SELECT COUNT(*) as count
      FROM voucher_entries ve
      JOIN vouchers v ON v.id = ve.voucher_id
      ${whereClause}
    `,
    countParams: params,
    listSql: `
      SELECT
        ve.*,
        a.is_foreign as account_is_foreign,
        a.currency_code as account_currency_code,
        v.voucher_no,
        v.voucher_date,
        v.status as voucher_status,
        vt.name as voucher_type_name,
        v.maker_name,
        v.auditor_name,
        (
          SELECT GROUP_CONCAT(ve2.account_code || ' ' || ve2.account_name, ', ')
          FROM voucher_entries ve2
          WHERE ve2.voucher_id = v.id
            AND ve2.id != ve.id
        ) as opposite_accounts
      FROM voucher_entries ve
      JOIN vouchers v ON v.id = ve.voucher_id
      LEFT JOIN accounts a ON a.id = ve.account_id
      LEFT JOIN voucher_types vt ON v.voucher_type_id = vt.id
      ${whereClause}
      ORDER BY v.voucher_date, v.voucher_no, ve.seq
      LIMIT ? OFFSET ?
    `,
    listParams: [...params, filters.pageSize, (filters.page - 1) * filters.pageSize],
  }
}

export function buildChronologicalQuery(filters: {
  accountSetId: string
  year?: string | number
  period?: string | number
  startDate?: string
  endDate?: string
  includeUnposted?: boolean
  summaryKeyword?: string
  minAmount?: string | number
  maxAmount?: string | number
  makerName?: string
  auditorName?: string
  page: number
  pageSize: number
  accountScope?: AccountScopeContext
  /** FIX-254：参数模式导出只取需要的列，避免 24 万行 ve.*（含 aux_data JSON）把内存顶到 1GB */
  selectColumns?: string
  /** FIX-254：在原有筛选之上再叠加一段日期窗口（参数模式导出按月分批取数，不改变 year/period 语义） */
  dateWindow?: { from: string; to: string }
}) {
  const hasDateRange = Boolean(filters.startDate || filters.endDate)
  const hasYear = filters.year !== undefined && filters.year !== '' && filters.year !== null
  const hasPeriod = filters.period !== undefined && filters.period !== '' && filters.period !== null

  // 构建凭证状态过滤条件
  const statusCondition = filters.includeUnposted
    ? "v.status IN ('draft', 'audited', 'posted')"
    : "v.status = 'posted'"

  const conditions = ['v.account_set_id = ?', statusCondition]
  const params: SqlParam[] = [filters.accountSetId]

  if (!hasDateRange) {
    if (hasYear) {
      conditions.push('v.year = ?')
      params.push(Number(filters.year))
      if (hasPeriod) {
        conditions.push('v.period = ?')
        params.push(Number(filters.period))
      }
    } else if (hasPeriod) {
      conditions.push('v.period = ?')
      params.push(Number(filters.period))
    }
  }

  if (filters.startDate) {
    conditions.push('v.voucher_date >= ?')
    params.push(filters.startDate)
  }

  if (filters.endDate) {
    conditions.push('v.voucher_date <= ?')
    params.push(filters.endDate)
  }

  if (filters.dateWindow) {
    conditions.push('v.voucher_date >= ?', 'v.voucher_date <= ?')
    params.push(filters.dateWindow.from, filters.dateWindow.to)
  }

  if (filters.summaryKeyword) {
    conditions.push('ve.summary LIKE ?')
    params.push(`%${filters.summaryKeyword}%`)
  }

  // 评审 P2：0 是合法金额界限，不能按真值判断
  if (filters.minAmount !== undefined && filters.minAmount !== null && filters.minAmount !== '' && Number.isFinite(Number(filters.minAmount))) {
    conditions.push('ve.amount >= ?')
    params.push(Number(filters.minAmount))
  }

  if (filters.maxAmount !== undefined && filters.maxAmount !== null && filters.maxAmount !== '' && Number.isFinite(Number(filters.maxAmount))) {
    conditions.push('ve.amount <= ?')
    params.push(Number(filters.maxAmount))
  }

  if (filters.makerName) {
    conditions.push('v.maker_name LIKE ?')
    params.push(`%${filters.makerName}%`)
  }

  if (filters.auditorName) {
    conditions.push('v.auditor_name LIKE ?')
    params.push(`%${filters.auditorName}%`)
  }

  appendAccountScopeCondition(filters.accountScope, 've.account_id', conditions, params)

  const whereClause = buildWhereClause(conditions)

  return {
    countSql: `SELECT COUNT(*) as count FROM voucher_entries ve JOIN vouchers v ON v.id = ve.voucher_id${whereClause}`,
    listSql: `
      SELECT ${filters.selectColumns || 've.*'}, v.voucher_no, v.voucher_date, vt.name as voucher_type_name, v.maker_name, v.status as voucher_status
      FROM voucher_entries ve
      JOIN vouchers v ON v.id = ve.voucher_id
      LEFT JOIN voucher_types vt ON v.voucher_type_id = vt.id
      ${whereClause}
      ORDER BY v.voucher_date, v.voucher_no, ve.seq
      LIMIT ? OFFSET ?
    `,
    countParams: params,
    listParams: [...params, filters.pageSize, (filters.page - 1) * filters.pageSize],
  }
}

// ===================== 辅助函数：父科目处理 =====================

/**
 * 根据科目编码长度配置，获取所有父科目编码
 */
export function getParentCodes(code: string, codeLengths: number[]): string[] {
  const parentCodes: string[] = []
  let currentLength = 0

  // 计算当前科目的级数
  let currentLevel = 0
  for (let i = 0; i < codeLengths.length; i++) {
    currentLength += codeLengths[i]
    if (currentLength >= code.length) {
      currentLevel = i + 1
      break
    }
  }

  // 生成所有上级科目编码
  currentLength = 0
  for (let i = 0; i < currentLevel - 1; i++) {
    currentLength += codeLengths[i]
    parentCodes.push(code.substring(0, currentLength))
  }

  return parentCodes
}

/**
 * 根据编码长度计算科目级数
 */
export function calculateLevel(code: string, codeLengths: number[]): number {
  let currentLength = 0
  for (let i = 0; i < codeLengths.length; i++) {
    currentLength += codeLengths[i]
    if (currentLength >= code.length) {
      return i + 1
    }
  }
  return 1
}

/**
 * 补充缺失的父科目
 * 从子科目列表反推父科目，查询数据库获取父科目信息
 */
export function supplementMissingParents(
  list: any[],
  db: any,
  accountSetId: string,
  codeLengths: number[]
): any[] {
  const accountMap = new Map<string, any>()
  list.forEach(row => accountMap.set(row.account_code, row))

  const missingParents: any[] = []

  list.forEach(row => {
    const parentCodes = getParentCodes(row.account_code, codeLengths)
    parentCodes.forEach(parentCode => {
      if (!accountMap.has(parentCode)) {
        const parentAccount = db
          .prepare('SELECT id, code, name, direction, level FROM accounts WHERE code = ? AND account_set_id = ?')
          .get(parentCode, accountSetId) as any

        // FIX-154：补出的父行带 account_id 与标记，科目授权过滤时不再整行丢弃（其金额只汇总自已授权的子科目）
        const parentRow = {
          account_id: parentAccount ? parentAccount.id : null,
          is_supplemented_parent: true,
          account_code: parentCode,
          account_name: parentAccount ? parentAccount.name : '-',
          direction: parentAccount ? parentAccount.direction : row.direction,
          level: parentAccount ? parentAccount.level : calculateLevel(parentCode, codeLengths),
          init_balance: 0,
          current_debit: 0,
          current_credit: 0,
          year_debit: 0,
          year_credit: 0,
          end_balance: 0,
        }
        missingParents.push(parentRow)
        accountMap.set(parentCode, parentRow)
      }
    })
  })

  return [...list, ...missingParents]
}

/**
 * 将子科目带符号余额 rollup 到父科目（init/end 按科目自然方向存储）。
 * 同方向子科目相加，反方向子科目相减（如应交税费下进项借方与销项贷方）。
 */
export function rollupSignedBalanceToParent(
  childAmount: number,
  childDirection: string,
  parentDirection: string
): number {
  if (!childAmount) return 0
  return childDirection === parentDirection ? childAmount : -childAmount
}

/** 按编码长度规则查找直接上级科目行 */
export function findDirectParentRow(
  list: Array<{ account_code: string }>,
  row: { account_code: string },
  codeLengths: number[]
): ({ account_code: string; direction?: string; init_balance?: number; end_balance?: number; current_debit?: number; current_credit?: number; year_debit?: number; year_credit?: number } & Record<string, any>) | null {
  const parentCodes = getParentCodes(row.account_code, codeLengths)
  if (parentCodes.length === 0) return null
  const directParentCode = parentCodes[parentCodes.length - 1]
  return list.find(p => p.account_code === directParentCode) ?? null
}

/**
 * 将子科目金额汇总到父科目
 * 按科目编码长度倒序排序，从最底层子科目开始累加
 *
 * 设计意图（FIX-016 评审更正 §P1-20）：
 * 父科目"首次被访问时清零自身再累加子科目"是**有意为之**的规范化：
 *   - 中国会计实务要求非末级科目不应直接挂账
 *   - 如父科目因导入/手工录入存在直接挂账数据（违规但可能），账簿展示时应以子科目合计为准
 *   - 这样的展示与 SQL 的"按 account_id 精确返回各级数据"一起保持：父行最终 = Σ子科目合计
 * 测试 `accumulateParentBalances.test.ts` 锁定该规范化行为，不应取消。
 */
export function accumulateParentBalances(list: any[], codeLengths: number[]): any[] {
  const sortedList = [...list].sort((a, b) => b.account_code.length - a.account_code.length)

  // 记录哪些父科目已被清零（避免重复清零）
  const zeroedParents = new Set<string>()

  sortedList.forEach(row => {
    const parent = findDirectParentRow(list, row, codeLengths)

    if (parent) {
      // 第一次遇到该父科目时，清零其原有值（避免父科目自身有凭证条目导致重复计算）
      if (!zeroedParents.has(parent.account_code)) {
        zeroedParents.add(parent.account_code)
        parent.init_balance = 0
        parent.current_debit = 0
        parent.current_credit = 0
        parent.year_debit = 0
        parent.year_credit = 0
        parent.end_balance = 0
      }
      const parentDirection = parent.direction || row.direction
      parent.init_balance =
        (parent.init_balance || 0) +
        rollupSignedBalanceToParent(row.init_balance || 0, row.direction, parentDirection)
      parent.current_debit = (parent.current_debit || 0) + (row.current_debit || 0)
      parent.current_credit = (parent.current_credit || 0) + (row.current_credit || 0)
      parent.year_debit = (parent.year_debit || 0) + (row.year_debit || 0)
      parent.year_credit = (parent.year_credit || 0) + (row.year_credit || 0)
      parent.end_balance =
        (parent.end_balance || 0) +
        rollupSignedBalanceToParent(row.end_balance || 0, row.direction, parentDirection)
    }
  })

  return list
}

/**
 * 将子科目金额汇总到父科目（包含12个月度字段的版本，用于总分类账）
 * 设计意图与 accumulateParentBalances 一致，保留首次清零行为
 */
export function accumulateParentBalancesWithMonths(list: any[], codeLengths: number[]): any[] {
  const sortedList = [...list].sort((a, b) => b.account_code.length - a.account_code.length)

  const zeroedParents = new Set<string>()

  sortedList.forEach(row => {
    const parent = findDirectParentRow(list, row, codeLengths)

    if (parent) {
      // 第一次遇到该父科目时，清零（避免父科目自身有凭证条目导致重复计算）
      if (!zeroedParents.has(parent.account_code)) {
        zeroedParents.add(parent.account_code)
        parent.init_balance = 0
        for (let m = 1; m <= 12; m++) {
          parent[`month${m}_debit`] = 0
          parent[`month${m}_credit`] = 0
        }
      }
      const parentDirection = parent.direction || row.direction
      parent.init_balance =
        (parent.init_balance || 0) +
        rollupSignedBalanceToParent(row.init_balance || 0, row.direction, parentDirection)
      for (let m = 1; m <= 12; m++) {
        parent[`month${m}_debit`] = (parent[`month${m}_debit`] || 0) + (row[`month${m}_debit`] || 0)
        parent[`month${m}_credit`] = (parent[`month${m}_credit`] || 0) + (row[`month${m}_credit`] || 0)
      }
    }
  })

  return list
}

/**
 * 补充缺失的父科目（包含12个月度字段的版本，用于总分类账）
 */
export function supplementMissingParentsWithMonths(
  list: any[],
  db: any,
  accountSetId: string,
  codeLengths: number[]
): any[] {
  const accountMap = new Map<string, any>()
  list.forEach((row: any) => accountMap.set(row.account_code, row))

  const missingParents: any[] = []

  list.forEach((row: any) => {
    const parentCodes = getParentCodes(row.account_code, codeLengths)
    parentCodes.forEach(parentCode => {
      if (!accountMap.has(parentCode)) {
        const parentAccount = db
          .prepare('SELECT id, code, name, direction, level FROM accounts WHERE code = ? AND account_set_id = ?')
          .get(parentCode, accountSetId) as any

        // FIX-154：同 supplementMissingParents
        const parentRow: any = {
          account_id: parentAccount ? parentAccount.id : null,
          is_supplemented_parent: true,
          account_code: parentCode,
          account_name: parentAccount ? parentAccount.name : '-',
          direction: parentAccount ? parentAccount.direction : row.direction,
          level: parentAccount ? parentAccount.level : calculateLevel(parentCode, codeLengths),
          init_balance: 0,
        }
        for (let m = 1; m <= 12; m++) {
          parentRow[`month${m}_debit`] = 0
          parentRow[`month${m}_credit`] = 0
        }
        missingParents.push(parentRow)
        accountMap.set(parentCode, parentRow)
      }
    })
  })

  return [...list, ...missingParents]
}

/**
 * 获取科目编码长度配置
 */
export function getCodeLengths(db: any, accountSetId: string): number[] {
  const accountCodeLengthsStr = db
    .prepare('SELECT param_value FROM system_params WHERE account_set_id = ? AND param_key = ?')
    .get(accountSetId, 'account_code_lengths') as any
  if (accountCodeLengthsStr?.param_value) {
    try {
      return JSON.parse(accountCodeLengthsStr.param_value)
    } catch {
      // 使用默认值
    }
  }
  return [4, 2, 2, 2, 2, 2]
}

/**
 * 凭证汇总表：按指定年月 + 凭证号区间，把凭证分录汇总成「科目 → 借方 / 贷方合计」。
 *
 * 与余额表不同，这里只统计**本期发生额**，不涉及期初与余额，因此不接期初表；
 * 一级科目汇总由调用方用 codeLengths 截断编码后合并，明细科目则直接按分录科目输出。
 */
export function buildVoucherSummaryQuery(filters: {
  accountSetId: string
  year: number
  period: number
  voucherTypeId?: string
  voucherNoStart?: number
  voucherNoEnd?: number
  /** all=全部凭证；posted=已过账；unposted=未过账 */
  scope?: 'all' | 'posted' | 'unposted'
  accountScope?: AccountScopeContext
}) {
  const conditions = ['v.account_set_id = ?', 'v.year = ?', 'v.period = ?']
  const params: SqlParam[] = [filters.accountSetId, filters.year, filters.period]

  if (filters.scope === 'posted') conditions.push("v.status = 'posted'")
  else if (filters.scope === 'unposted') conditions.push("v.status IN ('draft', 'audited')")
  else conditions.push("v.status IN ('draft', 'audited', 'posted')")

  if (filters.voucherTypeId) {
    conditions.push('v.voucher_type_id = ?')
    params.push(filters.voucherTypeId)
  }

  // 凭证号可能是「记-1」这种带前缀的形式，与凭证查询保持同一套数值化比较口径
  const voucherNoExpr = `COALESCE(CAST(SUBSTR(v.voucher_no, INSTR(v.voucher_no, '-') + 1) AS INTEGER), CAST(v.voucher_no AS INTEGER))`
  if (filters.voucherNoStart != null) {
    conditions.push(`${voucherNoExpr} >= ?`)
    params.push(filters.voucherNoStart)
  }
  if (filters.voucherNoEnd != null) {
    conditions.push(`${voucherNoExpr} <= ?`)
    params.push(filters.voucherNoEnd)
  }

  appendAccountScopeCondition(filters.accountScope, 've.account_id', conditions, params)

  return {
    sql: `
      SELECT
        ve.account_id,
        a.code as account_code,
        a.name as account_name,
        a.direction,
        a.level,
        SUM(CASE WHEN ve.direction = 'debit' THEN ve.amount ELSE 0 END) as debit_amount,
        SUM(CASE WHEN ve.direction = 'credit' THEN ve.amount ELSE 0 END) as credit_amount
      FROM voucher_entries ve
      JOIN vouchers v ON v.id = ve.voucher_id
      JOIN accounts a ON a.id = ve.account_id
      ${buildWhereClause(conditions)}
      GROUP BY ve.account_id, a.code, a.name, a.direction, a.level
      ORDER BY a.code
    `,
    params,
  }
}

/** 凭证汇总表：本期实际使用到的凭证号范围，用于表头「凭证号：从 N 到 M」 */
export function buildVoucherSummaryNoRangeQuery(filters: {
  accountSetId: string
  year: number
  period: number
  voucherTypeId?: string
  scope?: 'all' | 'posted' | 'unposted'
}) {
  const conditions = ['v.account_set_id = ?', 'v.year = ?', 'v.period = ?']
  const params: SqlParam[] = [filters.accountSetId, filters.year, filters.period]

  if (filters.scope === 'posted') conditions.push("v.status = 'posted'")
  else if (filters.scope === 'unposted') conditions.push("v.status IN ('draft', 'audited')")
  else conditions.push("v.status IN ('draft', 'audited', 'posted')")

  if (filters.voucherTypeId) {
    conditions.push('v.voucher_type_id = ?')
    params.push(filters.voucherTypeId)
  }

  const voucherNoExpr = `COALESCE(CAST(SUBSTR(v.voucher_no, INSTR(v.voucher_no, '-') + 1) AS INTEGER), CAST(v.voucher_no AS INTEGER))`

  return {
    sql: `
      SELECT MIN(${voucherNoExpr}) as min_no, MAX(${voucherNoExpr}) as max_no, COUNT(*) as voucher_count
      FROM vouchers v
      ${buildWhereClause(conditions)}
    `,
    params,
  }
}

/**
 * 外币余额表：仅外币核算科目，按年/期输出原币与本位币的期初/本期/期末
 */
/**
 * 库存数量金额表：数量核算科目的 期初 / 本期 / 本年累计 / 结余，数量与金额并列。
 *
 * 口径与 buildLedgerGeneralQuery 完全一致（同一套日期区间、账前发生额 pre_book 判定），
 * 只是每个金额子查询都并列一份把 `ve.amount` 换成 `ve.quantity`、把 init_balances 的
 * 金额列换成 `qty_*` 列的数量子查询。
 *
 * 数量**不进** account_balances，全部实时聚合自 voucher_entries，因此过账逻辑无需改动。
 * 「结余单价 = 结余金额 / 结余数量」是纯展示派生，放前端算以避免除零污染 SQL。
 *
 * 不做父科目补齐与向上汇总：不同子科目的计量单位可能不同，数量相加没有业务含义。
 */
export function buildQuantityBalanceQuery(filters: {
  accountSetId: string
  startDate?: string
  endDate?: string
  accountCode?: string
  includeUnposted?: boolean
  accountScope?: AccountScopeContext
  /** 账套启用日（account_sets.start_date），用于定位账前发生额归属期间 */
  accountSetStartDate?: string
  /** init_balances 是否具备 opening / pre_book 相关列；老库缺列时回退旧口径 */
  preBookEnabled?: boolean
  /** FIX-153：期初链式上溯——返回某年度实际可用的期初基准年（上年未年结时往前找） */
  resolveOpeningBaseYear?: (year: number) => number
}) {
  const { startDate, endDate } = resolveBalanceDateRange(filters.startDate, filters.endDate)

  const startDateYear = new Date(startDate).getFullYear()
  const endDateYear = new Date(endDate).getFullYear()
  const startDateYearStart = `${startDateYear}-01-01`
  const endDateYearStart = `${endDateYear}-01-01`
  // FIX-153：上年未年结时 init_balances(year) 无行，期初 / 期末改用最近有期初行的年度作基准，凭证从该年年初累计
  const startBaseYear = filters.resolveOpeningBaseYear?.(startDateYear) ?? startDateYear
  const endBaseYear = filters.resolveOpeningBaseYear?.(endDateYear) ?? endDateYear
  const startBaseYearStart = `${startBaseYear}-01-01`
  const endBaseYearStart = `${endBaseYear}-01-01`
  const yearStartDate = endDateYearStart

  const {
    preBookEnabled,
    initIncludesPreBook,
    currentIncludesPreBook,
    yearIncludesPreBook,
    endIncludesPreBook,
  } = resolvePreBookRangeFlags({
    accountSetStartDate: filters.accountSetStartDate,
    preBookEnabled: filters.preBookEnabled,
    startDate,
    endDate,
    yearStartDate,
  })

  // 账前发生额所在年度（与 resolvePreBookDate 一致），修复跨年账前漏算
  const preBookYear = Number(
    resolvePreBookDate(filters.accountSetStartDate, endDateYear).slice(0, 4)
  )

  const statusCondition = filters.includeUnposted
    ? "v.status IN ('draft', 'audited', 'posted')"
    : "v.status = 'posted'"

  const accountConditions = ['a.account_set_id = ?', 'a.is_enabled = 1', 'a.is_quantity = 1']
  const accountParams: SqlParam[] = [filters.accountSetId]

  if (filters.accountCode) {
    accountConditions.push('a.code LIKE ?')
    accountParams.push(`${filters.accountCode}%`)
  }

  appendAccountScopeCondition(filters.accountScope, 'a.id', accountConditions, accountParams)

  // FIX-250：数量与金额两组取值列同放一个 entry_agg CTE，一次扫描分录
  const agg = buildEntryAggregateCte({
    accountSetId: filters.accountSetId,
    statusCondition,
    startDate,
    endDate,
    startBaseYearStart,
    endBaseYearStart,
    yearStartDate,
    values: [
      { prefix: 'qty', expr: 'COALESCE(ve.quantity, 0)' },
      { prefix: 'amt', expr: 've.amount' },
    ],
  })

  /** 期初余额：年初余额 + [年初, startDate) 凭证净额（按科目方向签名） */
  const initBalanceExpr = (prefix: string, cols: InitBalanceColumnSet) => `
          ${
            preBookEnabled
              ? buildAccountOpeningBalanceExpr('a.id', initIncludesPreBook, cols)
              : buildAccountInitBalanceExpr('a.id', cols)
          } + ${aggSignedNet(prefix, 'init')}`

  /** 结余：结束年度年初余额 + [年初, endDate] 凭证净额 */
  const endBalanceExpr = (prefix: string, cols: InitBalanceColumnSet) => `
          ${
            preBookEnabled
              ? buildAccountOpeningBalanceExpr('a.id', endIncludesPreBook, cols)
              : buildAccountInitBalanceExpr('a.id', cols)
          } + ${aggSignedNet(prefix, 'end')}`

  /** 区间内某方向的发生额（金额或数量） */
  const sideExpr = (
    prefix: string,
    cols: InitBalanceColumnSet,
    bucket: 'cur' | 'year',
    side: 'debit' | 'credit',
    includePreBook: boolean
  ) => `
          ${includePreBook ? `${buildAccountPreBookSideExpr('a.id', side, true, cols)} +` : ''} ${aggCol(prefix, bucket, side)}`

  const QC = QUANTITY_INIT_COLUMNS
  const AC = AMOUNT_INIT_COLUMNS

  return {
    sql: `
      WITH ${agg.sql}
      SELECT * FROM (
        SELECT
          a.id as account_id,
          a.code as account_code,
          a.name as account_name,
          a.direction,
          a.level,
          a.quantity_unit as unit,
          ${initBalanceExpr('qty', QC)} as qty_init_balance,
          ${initBalanceExpr('amt', AC)} as init_balance,
          ${sideExpr('qty', QC, 'cur', 'debit', currentIncludesPreBook)} as qty_current_debit,
          ${sideExpr('amt', AC, 'cur', 'debit', currentIncludesPreBook)} as current_debit,
          ${sideExpr('qty', QC, 'cur', 'credit', currentIncludesPreBook)} as qty_current_credit,
          ${sideExpr('amt', AC, 'cur', 'credit', currentIncludesPreBook)} as current_credit,
          ${sideExpr('qty', QC, 'year', 'debit', yearIncludesPreBook)} as qty_year_debit,
          ${sideExpr('amt', AC, 'year', 'debit', yearIncludesPreBook)} as year_debit,
          ${sideExpr('qty', QC, 'year', 'credit', yearIncludesPreBook)} as qty_year_credit,
          ${sideExpr('amt', AC, 'year', 'credit', yearIncludesPreBook)} as year_credit,
          ${endBalanceExpr('qty', QC)} as qty_end_balance,
          ${endBalanceExpr('amt', AC)} as end_balance
        FROM accounts a
        LEFT JOIN entry_agg m ON m.account_id = a.id
        ${buildWhereClause(accountConditions)}
      )
      -- 参考图提示 3：期初、本期借贷发生额全为 0 的科目不在表中显示
      WHERE qty_init_balance != 0 OR init_balance != 0
         OR qty_current_debit != 0 OR current_debit != 0
         OR qty_current_credit != 0 OR current_credit != 0
      ORDER BY account_code
    `,
    // 占位符顺序与上面 SQL 严格对应：CTE 在最前，随后每个口径「数量在前、金额在后」各一份
    // init_balances 子查询；账前发生额子查询只在计入时才出现，故按条件 push。
    params: (() => {
      const p: SqlParam[] = [...agg.params]
      // 期初：数量、金额各一份
      for (const _ of [0, 1]) p.push(filters.accountSetId, startBaseYear)
      // 本期借方（数量、金额）、本期贷方（数量、金额）
      for (const _ of [0, 1, 2, 3]) {
        if (currentIncludesPreBook) p.push(filters.accountSetId, preBookYear)
      }
      // 本年累计借方（数量、金额）、本年累计贷方（数量、金额）
      for (const _ of [0, 1, 2, 3]) {
        if (yearIncludesPreBook) p.push(filters.accountSetId, preBookYear)
      }
      // 结余：数量、金额各一份
      for (const _ of [0, 1]) p.push(filters.accountSetId, endBaseYear)
      p.push(...accountParams)
      return p
    })(),
  }
}

/**
 * 外币余额表（`GET /ledger/foreign-balance`）。
 *
 * 口径与 `buildQuantityBalanceQuery` / `buildLedgerGeneralQuery` 完全一致：**从凭证明细
 * `voucher_entries` 实时聚合**，而不是读过账后的 `account_balances`。改口径的原因：
 *  - 辅助项目外币余额表（`POST /ledger/aux-balance` + `with_foreign`）本来就走凭证明细，
 *    两张表读不同的源，一旦过账回写有偏差就对不上；
 *  - 汇总表口径拿不到「统计未记账凭证」、日期区间与本年累计。
 *
 * 每个口径成对输出本位币与原币两列（`xxx` / `foreign_xxx`），原币把金额表达式换成
 * `COALESCE(ve.foreign_amount, 0)`、期初列集换成 `FOREIGN_INIT_COLUMNS`。
 *
 * 只取 `is_foreign = 1` 的科目，**不做父科目汇总**：不同币种的原币相加没有业务含义
 * （与数量核算同理），因此本表也不提供科目级次筛选。
 */
export function buildForeignBalanceQuery(filters: {
  accountSetId: string
  startDate?: string
  endDate?: string
  accountCode?: string
  currencyCode?: string
  filterTypes?: string[]
  includeUnposted?: boolean
  accountScope?: AccountScopeContext
  /** 账套启用日（account_sets.start_date），用于定位账前发生额归属期间 */
  accountSetStartDate?: string
  /** init_balances 是否具备 opening / pre_book 相关列；老库缺列时回退旧口径 */
  preBookEnabled?: boolean
  /** FIX-153：期初链式上溯——返回某年度实际可用的期初基准年（上年未年结时往前找） */
  resolveOpeningBaseYear?: (year: number) => number
  /** init_balances 是否具备 foreign_opening / foreign_pre_book 列 */
  foreignPreBookEnabled?: boolean
}) {
  const { startDate, endDate } = resolveBalanceDateRange(filters.startDate, filters.endDate)

  const startDateYear = new Date(startDate).getFullYear()
  const endDateYear = new Date(endDate).getFullYear()
  const startDateYearStart = `${startDateYear}-01-01`
  const endDateYearStart = `${endDateYear}-01-01`
  // FIX-153：上年未年结时 init_balances(year) 无行，期初 / 期末改用最近有期初行的年度作基准，凭证从该年年初累计
  const startBaseYear = filters.resolveOpeningBaseYear?.(startDateYear) ?? startDateYear
  const endBaseYear = filters.resolveOpeningBaseYear?.(endDateYear) ?? endDateYear
  const startBaseYearStart = `${startBaseYear}-01-01`
  const endBaseYearStart = `${endBaseYear}-01-01`
  const yearStartDate = endDateYearStart

  const {
    preBookEnabled,
    initIncludesPreBook,
    currentIncludesPreBook,
    yearIncludesPreBook,
    endIncludesPreBook,
  } = resolvePreBookRangeFlags({
    accountSetStartDate: filters.accountSetStartDate,
    preBookEnabled: filters.preBookEnabled,
    startDate,
    endDate,
    yearStartDate,
  })

  // 原币的 opening / pre_book 列是后加的；缺列时原币期初回退到 foreign_init_balance。
  // 占位符数量随之变化，故原币侧持有独立开关，不能直接复用本位币的 preBookEnabled。
  const fxPreBookEnabled = preBookEnabled && filters.foreignPreBookEnabled !== false

  // 账前发生额所在年度（与 resolvePreBookDate 一致），修复跨年账前漏算
  const preBookYear = Number(
    resolvePreBookDate(filters.accountSetStartDate, endDateYear).slice(0, 4)
  )

  const statusCondition = filters.includeUnposted
    ? "v.status IN ('draft', 'audited', 'posted')"
    : "v.status = 'posted'"

  const accountConditions = ['a.account_set_id = ?', 'a.is_enabled = 1', 'a.is_foreign = 1']
  const accountParams: SqlParam[] = [filters.accountSetId]

  if (filters.accountCode) {
    accountConditions.push('a.code LIKE ?')
    accountParams.push(`${filters.accountCode}%`)
  }

  if (filters.currencyCode) {
    accountConditions.push("UPPER(COALESCE(a.currency_code, '')) = ?")
    accountParams.push(String(filters.currencyCode).trim().toUpperCase())
  }

  appendAccountScopeCondition(filters.accountScope, 'a.id', accountConditions, accountParams)

  // 筛选类型：本位币与原币任一命中即保留（与辅助外币表的 foreignHaving 同口径）
  let havingClause = ''
  if (filters.filterTypes && filters.filterTypes.length > 0) {
    const conditions: string[] = []
    if (filters.filterTypes.includes('init_balance')) {
      conditions.push('(init_balance != 0 OR foreign_init_balance != 0)')
    }
    if (filters.filterTypes.includes('has_amount')) {
      conditions.push(
        '(current_debit != 0 OR current_credit != 0 OR foreign_current_debit != 0 OR foreign_current_credit != 0)'
      )
    }
    if (filters.filterTypes.includes('has_balance')) {
      conditions.push('(end_balance != 0 OR foreign_end_balance != 0)')
    }
    if (conditions.length > 0) {
      havingClause = ` AND (${conditions.join(' OR ')})`
    }
  }

  // FIX-250：原币与本位币两组取值列同放一个 entry_agg CTE，一次扫描分录
  const agg = buildEntryAggregateCte({
    accountSetId: filters.accountSetId,
    statusCondition,
    startDate,
    endDate,
    startBaseYearStart,
    endBaseYearStart,
    yearStartDate,
    values: [
      { prefix: 'fx', expr: 'COALESCE(ve.foreign_amount, 0)' },
      { prefix: 'amt', expr: 've.amount' },
    ],
  })

  /** 期初余额：起始年度年初余额 + [年初, startDate) 凭证净额（按科目方向签名） */
  const initBalanceExpr = (prefix: string, cols: InitBalanceColumnSet, withPreBook: boolean) => `
          ${
            withPreBook
              ? buildAccountOpeningBalanceExpr('a.id', initIncludesPreBook, cols)
              : buildAccountInitBalanceExpr('a.id', cols)
          } + ${aggSignedNet(prefix, 'init')}`

  /** 期末余额：结束年度年初余额 + [年初, endDate] 凭证净额 */
  const endBalanceExpr = (prefix: string, cols: InitBalanceColumnSet, withPreBook: boolean) => `
          ${
            withPreBook
              ? buildAccountOpeningBalanceExpr('a.id', endIncludesPreBook, cols)
              : buildAccountInitBalanceExpr('a.id', cols)
          } + ${aggSignedNet(prefix, 'end')}`

  /** 区间内某方向的发生额 */
  const sideExpr = (
    prefix: string,
    cols: InitBalanceColumnSet,
    bucket: 'cur' | 'year',
    side: 'debit' | 'credit',
    includePreBook: boolean
  ) => `
          ${includePreBook ? `${buildAccountPreBookSideExpr('a.id', side, true, cols)} +` : ''} ${aggCol(prefix, bucket, side)}`

  const AC = AMOUNT_INIT_COLUMNS
  const FC = FOREIGN_INIT_COLUMNS
  const fxCurrentPreBook = fxPreBookEnabled && currentIncludesPreBook
  const fxYearPreBook = fxPreBookEnabled && yearIncludesPreBook

  return {
    sql: `
      WITH ${agg.sql}
      SELECT * FROM (
        SELECT
          a.id as account_id,
          a.code as account_code,
          a.name as account_name,
          a.direction,
          a.level,
          UPPER(COALESCE(a.currency_code, '')) as currency_code,
          ${initBalanceExpr('fx', FC, fxPreBookEnabled)} as foreign_init_balance,
          ${initBalanceExpr('amt', AC, preBookEnabled)} as init_balance,
          ${sideExpr('fx', FC, 'cur', 'debit', fxCurrentPreBook)} as foreign_current_debit,
          ${sideExpr('amt', AC, 'cur', 'debit', currentIncludesPreBook)} as current_debit,
          ${sideExpr('fx', FC, 'cur', 'credit', fxCurrentPreBook)} as foreign_current_credit,
          ${sideExpr('amt', AC, 'cur', 'credit', currentIncludesPreBook)} as current_credit,
          ${sideExpr('fx', FC, 'year', 'debit', fxYearPreBook)} as foreign_year_debit,
          ${sideExpr('amt', AC, 'year', 'debit', yearIncludesPreBook)} as year_debit,
          ${sideExpr('fx', FC, 'year', 'credit', fxYearPreBook)} as foreign_year_credit,
          ${sideExpr('amt', AC, 'year', 'credit', yearIncludesPreBook)} as year_credit,
          ${endBalanceExpr('fx', FC, fxPreBookEnabled)} as foreign_end_balance,
          ${endBalanceExpr('amt', AC, preBookEnabled)} as end_balance
        FROM accounts a
        LEFT JOIN entry_agg m ON m.account_id = a.id
        ${buildWhereClause(accountConditions)}
      ) WHERE 1=1 ${havingClause}
      ORDER BY currency_code, account_code
    `,
    // 占位符顺序与上面 SQL 严格对应：CTE 在最前，随后每个口径「原币在前、本位币在后」各一份
    // init_balances 子查询。buildAccountPreBookSideExpr 的 include=false 分支不产生占位符，故按条件 push。
    params: (() => {
      const p: SqlParam[] = [...agg.params]
      // 期初：原币、本位币各一份
      for (const _ of [0, 1]) p.push(filters.accountSetId, startBaseYear)
      // 本期借方（原币、本位币）、本期贷方（原币、本位币）
      for (const isForeignSide of [true, false, true, false]) {
        if (isForeignSide ? fxCurrentPreBook : currentIncludesPreBook) {
          p.push(filters.accountSetId, preBookYear)
        }
      }
      // 本年累计借方（原币、本位币）、本年累计贷方（原币、本位币）
      for (const isForeignSide of [true, false, true, false]) {
        if (isForeignSide ? fxYearPreBook : yearIncludesPreBook) {
          p.push(filters.accountSetId, preBookYear)
        }
      }
      // 期末：原币、本位币各一份
      for (const _ of [0, 1]) p.push(filters.accountSetId, endBaseYear)
      p.push(...accountParams)
      return p
    })(),
  }
}
