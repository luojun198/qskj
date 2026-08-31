import { AUX_LEGACY_COLUMNS } from '../utils/auxLedgerQuery.js'
import { buildSignedEntryAmountSql } from '../utils/accountBalance.js'
import {
  appendAccountScopeCondition,
  type AccountScopeContext,
} from './accountAuthorization.js'

type SqlParam = string | number

// P1-16：期初金额须按科目方向签名（与 calcInitBalanceFromDebitCredit 一致）。
// 旧实现恒 init_debit - init_credit，贷方科目辅助期初符号相反（贷 1000 被算成 -1000），
// 再与方向签名的凭证期初相加导致辅助明细账期初方向/金额错误。需 accounts a 在作用域内提供 a.direction。
const INIT_BALANCE_AMOUNT_EXPR = `CASE WHEN ib.init_debit != 0 OR ib.init_credit != 0
  THEN (CASE WHEN a.direction = 'credit' THEN ib.init_credit - ib.init_debit ELSE ib.init_debit - ib.init_credit END)
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

/**
 * 按科目汇总期初：有辅助期初明细（aux_item_id≠''）时只计辅助行；
 * 否则只计科目级（aux_item_id=''），避免与科目期初重复相加。
 */
export const INIT_BALANCE_GROUP_BY_ACCOUNT_SQL = `
  SELECT account_id,
    CASE
      WHEN COUNT(CASE WHEN aux_item_id != '' THEN 1 END) > 0
      THEN SUM(CASE WHEN aux_item_id != '' THEN init_balance ELSE 0 END)
      ELSE SUM(CASE WHEN COALESCE(aux_item_id, '') = '' THEN init_balance ELSE 0 END)
    END as init_balance
  FROM init_balances
  WHERE year = ? AND account_set_id = ?
  GROUP BY account_id
`

/** 单科目期初子查询（关联 accounts 别名），占位符：account_set_id, year */
export function buildAccountInitBalanceExpr(accountIdRef: string): string {
  return `COALESCE(
    (SELECT
       CASE
         WHEN COUNT(CASE WHEN ib.aux_item_id != '' THEN 1 END) > 0
         THEN SUM(CASE WHEN ib.aux_item_id != '' THEN ib.init_balance ELSE 0 END)
         ELSE SUM(CASE WHEN COALESCE(ib.aux_item_id, '') = '' THEN ib.init_balance ELSE 0 END)
       END
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
        CASE
          WHEN COUNT(CASE WHEN ib.aux_item_id != '' THEN 1 END) > 0
          THEN SUM(CASE WHEN ib.aux_item_id != '' THEN ib.init_balance ELSE 0 END)
          ELSE SUM(CASE WHEN COALESCE(ib.aux_item_id, '') = '' THEN ib.init_balance ELSE 0 END)
        END as init_balance
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
}) {
  // 如果没有指定日期，使用当前年月
  const now = new Date()
  const defaultStartDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
  const defaultEndDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()).padStart(2, '0')}`

  const startDate = filters.startDate || defaultStartDate
  const endDate = filters.endDate || defaultEndDate

  // FIX-002 / P0-4：分别计算「起始年度年初」和「结束年度年初」
  // - 期初余额 = 起始年度年初余额 + 起始年度内 [年初, startDate) 的凭证累计
  // - 期末余额 = 结束年度年初余额 + 结束年度内 [年初, endDate] 的凭证累计
  // 跨年查询时不能用 endDate 年的 init_balances 去加 startDate 年的凭证（会重复计算）
  const startDateYear = new Date(startDate).getFullYear()
  const endDateYear = new Date(endDate).getFullYear()
  const startDateYearStart = `${startDateYear}-01-01`
  const endDateYearStart = `${endDateYear}-01-01`
  // 本年累计的起始日期：endDate 所在年度的 1 月 1 日（中国财务"本年累计"按 endDate 所在年统计）
  const yearStartDate = endDateYearStart

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

  // 从 accounts 表出发，计算日期区间内的发生额
  // 将 UNION ALL 包在子查询中，外层再应用 filter_types 过滤
  return {
    sql: `
      SELECT * FROM (
        SELECT * FROM (
          SELECT
            a.id as account_id,
            a.code as account_code,
            a.name as account_name,
            a.direction,
            a.level,
            ${buildAccountInitBalanceExpr('a.id')} + COALESCE(
              (SELECT
                 CASE WHEN a.direction = 'debit'
                   THEN SUM(CASE WHEN ve.direction = 'debit' THEN ve.amount ELSE -ve.amount END)
                   ELSE SUM(CASE WHEN ve.direction = 'credit' THEN ve.amount ELSE -ve.amount END)
                 END
               FROM voucher_entries ve
               JOIN vouchers v ON v.id = ve.voucher_id
               WHERE ve.account_id = a.id
                 AND ve.account_set_id = ?
                 AND ${statusCondition}
                 AND v.voucher_date >= ?      -- FIX-002：限制在起始年度内
                 AND v.voucher_date < ?),
              0
            ) as init_balance,
            COALESCE(
              (SELECT SUM(ve.amount)
               FROM voucher_entries ve
               JOIN vouchers v ON v.id = ve.voucher_id
               WHERE ve.account_id = a.id
                 AND ve.account_set_id = ?
                 AND ve.direction = 'debit'
                 AND ${statusCondition}
                 AND v.voucher_date >= ?
                 AND v.voucher_date <= ?),
              0
            ) as current_debit,
            COALESCE(
              (SELECT SUM(ve.amount)
               FROM voucher_entries ve
               JOIN vouchers v ON v.id = ve.voucher_id
               WHERE ve.account_id = a.id
                 AND ve.account_set_id = ?
                 AND ve.direction = 'credit'
                 AND ${statusCondition}
                 AND v.voucher_date >= ?
                 AND v.voucher_date <= ?),
              0
            ) as current_credit,
            COALESCE(
              (SELECT SUM(ve.amount)
               FROM voucher_entries ve
               JOIN vouchers v ON v.id = ve.voucher_id
               WHERE ve.account_id = a.id
                 AND ve.account_set_id = ?
                 AND ve.direction = 'debit'
                 AND ${statusCondition}
                 AND v.voucher_date >= ?
                 AND v.voucher_date <= ?),
              0
            ) as year_debit,
            COALESCE(
              (SELECT SUM(ve.amount)
               FROM voucher_entries ve
               JOIN vouchers v ON v.id = ve.voucher_id
               WHERE ve.account_id = a.id
                 AND ve.account_set_id = ?
                 AND ve.direction = 'credit'
                 AND ${statusCondition}
                 AND v.voucher_date >= ?
                 AND v.voucher_date <= ?),
              0
            ) as year_credit,
            ${buildAccountInitBalanceExpr('a.id')} + COALESCE(
              (SELECT
                 CASE WHEN a.direction = 'debit'
                   THEN SUM(CASE WHEN ve.direction = 'debit' THEN ve.amount ELSE -ve.amount END)
                   ELSE SUM(CASE WHEN ve.direction = 'credit' THEN ve.amount ELSE -ve.amount END)
                 END
               FROM voucher_entries ve
               JOIN vouchers v ON v.id = ve.voucher_id
               WHERE ve.account_id = a.id
                 AND ve.account_set_id = ?
                 AND ${statusCondition}
                 AND v.voucher_date >= ?      -- FIX-002：限制在结束年度内
                 AND v.voucher_date <= ?),
              0
            ) as end_balance
          FROM accounts a
          ${buildWhereClause(accountConditions)}
        ) WHERE 1=1 ${havingClause}
      ) WHERE 1=1
      ORDER BY account_code
    `,
    params: [
      // FIX-002 / P0-4：期初余额取 startDate 所在年度的 init_balances，
      // 凭证累加范围 [startDateYearStart, startDate)
      filters.accountSetId, // buildAccountInitBalanceExpr → account_set_id
      startDateYear, // buildAccountInitBalanceExpr → year
      filters.accountSetId, // 凭证子查询 account_set_id
      startDateYearStart, // voucher_date >= 起始年初
      startDate, // voucher_date < startDate
      // 本期借方
      filters.accountSetId,
      startDate,
      endDate,
      // 本期贷方
      filters.accountSetId,
      startDate,
      endDate,
      // 本年累计借方
      filters.accountSetId,
      yearStartDate,
      endDate,
      // 本年累计贷方
      filters.accountSetId,
      yearStartDate,
      endDate,
      // FIX-002 / P0-4：期末余额取 endDate 所在年度的 init_balances，
      // 凭证累加范围 [endDateYearStart, endDate]
      filters.accountSetId, // buildAccountInitBalanceExpr → account_set_id
      endDateYear, // buildAccountInitBalanceExpr → year
      filters.accountSetId, // 凭证子查询 account_set_id
      endDateYearStart, // voucher_date >= 结束年初
      endDate, // voucher_date <= endDate
      ...accountParams,
    ],
  }
}

export function buildLedgerBalanceQuery(filters: {
  accountSetId: string
  year?: string | number
  period?: string | number
  accountScope?: AccountScopeContext
}) {
  const y = Number(filters.year) || new Date().getFullYear()
  const p = Number(filters.period) || new Date().getMonth() + 1

  const accountConditions = ['a.account_set_id = ?', 'a.is_enabled = 1']
  const accountParams: SqlParam[] = [filters.accountSetId]
  appendAccountScopeCondition(filters.accountScope, 'a.id', accountConditions, accountParams)

  // 期初余额子查询：有辅助明细时只汇总辅助行，避免与科目级期初重复
  const initBalanceSubquery = INIT_BALANCE_GROUP_BY_ACCOUNT_SQL

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
          COALESCE(cb.current_debit, 0) as current_debit,
          COALESCE(cb.current_credit, 0) as current_credit,
          CASE WHEN a.direction = 'debit'
            THEN COALESCE(ib.init_balance, 0) + COALESCE(cb.cum_debit, 0) - COALESCE(cb.cum_credit, 0)
            ELSE COALESCE(ib.init_balance, 0) + COALESCE(cb.cum_credit, 0) - COALESCE(cb.cum_debit, 0)
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
}) {
  const y = Number(filters.year) || new Date().getFullYear()

  // 构建凭证状态过滤条件
  const statusCondition = filters.includeUnposted
    ? "v.status IN ('draft', 'audited', 'posted')"
    : "v.status = 'posted'"

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

  const cteConditions = [
    've.account_set_id = ?',
    statusCondition,
    'v.voucher_date >= ?',
    'v.voucher_date <= ?',
  ]
  const cteParams: SqlParam[] = [filters.accountSetId, `${y}-01-01`, `${y}-12-31`]
  appendAccountScopeCondition(filters.accountScope, 've.account_id', cteConditions, cteParams)

  // 构建月份列的输出
  const monthColumns: string[] = []
  for (let month = 1; month <= 12; month++) {
    monthColumns.push(`COALESCE(am.month${month}_debit, 0) as month${month}_debit`)
    monthColumns.push(`COALESCE(am.month${month}_credit, 0) as month${month}_credit`)
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
        FROM voucher_entries ve
        JOIN vouchers v ON v.id = ve.voucher_id
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
      )
      SELECT
        a.id as account_id,
        a.code as account_code,
        a.name as account_name,
        a.direction,
        a.level,
        a.parent_id,
        -- 期初余额 = init_balances + 该年1月1日之前的凭证累计
        ${buildAccountInitBalanceExpr('a.id')} + COALESCE(
          (SELECT
             CASE WHEN a.direction = 'debit'
               THEN SUM(CASE WHEN ve.direction = 'debit' THEN ve.amount ELSE -ve.amount END)
               ELSE SUM(CASE WHEN ve.direction = 'credit' THEN ve.amount ELSE -ve.amount END)
             END
           FROM voucher_entries ve
           JOIN vouchers v ON v.id = ve.voucher_id
           WHERE ve.account_id = a.id
             AND ve.account_set_id = ?
             AND ${statusCondition}
             AND v.voucher_date < ?),
          0
        ) as init_balance,
        -- 各月发生额（从 CTE 中获取，无子查询）
        ${monthColumns.join(',\n        ')}
      FROM accounts a
      LEFT JOIN account_monthly am ON a.id = am.account_id
      ${buildWhereClause(conditions)}
    `,
    params: [
      // monthly_amounts CTE
      ...cteParams,
      // init_balances 期初余额
      filters.accountSetId,
      y,
      // 期初余额凭证查询
      filters.accountSetId,
      `${y}-01-01`,
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
}) {
  const startDateYear = filters.startDate ? new Date(filters.startDate).getFullYear() : undefined
  const y = Number(filters.year) || startDateYear || new Date().getFullYear()

  // 构建凭证状态过滤条件
  const statusCondition = filters.includeUnposted
    ? "v.status IN ('draft', 'audited', 'posted')"
    : "v.status = 'posted'"

  const conditions = ['ve.account_set_id = ?', statusCondition]
  const params: SqlParam[] = [filters.accountSetId]

  // 科目筛选：优先使用编码范围（父科目汇总），其次使用科目ID（叶子科目）
  if (filters.accountCodeStart && filters.accountCodeEnd) {
    const scopeParts: string[] = []
    const scopeParams: SqlParam[] = []
    appendAccountScopeCondition(filters.accountScope, 'id', scopeParts, scopeParams)
    const scopeSql = scopeParts.length > 0 ? ` AND ${scopeParts.join(' AND ')}` : ''
    conditions.push(`ve.account_id IN (
      SELECT id FROM accounts
      WHERE account_set_id = ?
      AND code >= ?
      AND code <= ?${scopeSql}
    )`)
    params.push(filters.accountSetId, filters.accountCodeStart, filters.accountCodeEnd, ...scopeParams)
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
  let auxVoucherField: string | undefined
  if (filters.auxType && filters.auxId) {
    const legacy = AUX_LEGACY_COLUMNS[filters.auxType]
    if (legacy) {
      auxVoucherField = legacy.id
      conditions.push(`ve.${legacy.id} = ?`)
      params.push(filters.auxId)
    }
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

  const buildVoucherInitBeforeStartSql = (accountWhereSql: string, extraParams: SqlParam[]) => {
    const auxClause = auxVoucherField ? ` AND ve.${auxVoucherField} = ?` : ''
    return {
      sql: `(SELECT SUM(
             CASE WHEN a.direction = 'debit'
               THEN CASE WHEN ve.direction = 'debit' THEN ve.amount ELSE -ve.amount END
               ELSE CASE WHEN ve.direction = 'credit' THEN ve.amount ELSE -ve.amount END
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
        yearStartDate,
        balanceStartDate,
        ...extraParams,
        ...(auxVoucherField ? [filters.auxId as string] : []),
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
          y,
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
        params: [accountId, filters.accountSetId, y] as SqlParam[],
      }
    }
    return {
      sql: buildScopedInitBalanceSumSql(accountWhereSql),
      params: [filters.accountSetId, y, ...accountParams],
    }
  }

  let initBalanceSql: string
  let initBalanceParams: SqlParam[]
  const balanceStartDate = filters.startDate || `${y}-01-01`
  const yearStartDate = `${y}-01-01`

  if (filters.accountCodeStart && filters.accountCodeEnd) {
    const initTable = buildInitFromTableSql(
      'AND a.account_set_id = ? AND a.code >= ? AND a.code <= ?',
      [filters.accountSetId, filters.accountCodeStart, filters.accountCodeEnd]
    )
    const voucherInit = buildVoucherInitBeforeStartSql(
      'AND a.account_set_id = ? AND a.code >= ? AND a.code <= ?',
      [filters.accountSetId, filters.accountCodeStart, filters.accountCodeEnd]
    )
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
          params: [filters.accountId, filters.accountSetId, y] as SqlParam[],
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

  const whereClause = buildWhereClause(conditions)

  return {
    initBalanceSql,
    initBalanceParams,
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
}) {
  const hasDateRange = Boolean(filters.startDate || filters.endDate)
  const y = Number(filters.year) || new Date().getFullYear()
  const p = Number(filters.period) || new Date().getMonth() + 1

  // 构建凭证状态过滤条件
  const statusCondition = filters.includeUnposted
    ? "v.status IN ('draft', 'audited', 'posted')"
    : "v.status = 'posted'"

  const conditions = ['v.account_set_id = ?', statusCondition]
  const params: SqlParam[] = [filters.accountSetId]

  if (!hasDateRange) {
    conditions.push('v.year = ?', 'v.period = ?')
    params.push(y, p)
  }

  if (filters.startDate) {
    conditions.push('v.voucher_date >= ?')
    params.push(filters.startDate)
  }

  if (filters.endDate) {
    conditions.push('v.voucher_date <= ?')
    params.push(filters.endDate)
  }

  if (filters.summaryKeyword) {
    conditions.push('ve.summary LIKE ?')
    params.push(`%${filters.summaryKeyword}%`)
  }

  if (filters.minAmount) {
    conditions.push('ve.amount >= ?')
    params.push(Number(filters.minAmount))
  }

  if (filters.maxAmount) {
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
      SELECT ve.*, v.voucher_no, v.voucher_date, vt.name as voucher_type_name, v.maker_name, v.status as voucher_status
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
          .prepare('SELECT code, name, direction, level FROM accounts WHERE code = ? AND account_set_id = ?')
          .get(parentCode, accountSetId) as any

        const parentRow = {
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
): { account_code: string; direction?: string; init_balance?: number; end_balance?: number; current_debit?: number; current_credit?: number; year_debit?: number; year_credit?: number } | null {
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
          .prepare('SELECT code, name, direction, level FROM accounts WHERE code = ? AND account_set_id = ?')
          .get(parentCode, accountSetId) as any

        const parentRow: any = {
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
