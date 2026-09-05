import { Router } from 'express'
import dayjs from 'dayjs'
import { getDb } from '../db/index.js'
import { authMiddleware, AuthRequest, requirePermission } from '../middleware/index.js'
import {
  buildAccountCategoryPredicate,
  getDashboardCategoryConfig,
  type DashboardCategoryPredicates,
} from '../services/dashboardCategoryConfig.js'
import {
  appendAccountScopeCondition,
  buildVoucherAllEntriesInScopeSql,
  type AccountScopeContext,
} from '../services/accountAuthorization.js'
import { getLicensedModules } from '../services/licenseService.js'

const router = Router()
router.use(authMiddleware)
router.use(requirePermission('system:dashboard'))

router.use((req: AuthRequest, res, next) => {
  if (!req.accountSetId) {
    return res.status(400).json({ code: 400, message: '账套未选择，请重新登录' })
  }
  next()
})

/**
 * 决定"本期"的语义：
 *   1. 优先：period_closing 表里最大已结账期的"下一期"（即第一个未结账期）。
 *      用 ORDER BY year DESC, period DESC LIMIT 1 取最后一条 closed，加 1。
 *   2. 退化：vouchers 表最新 (year, period)。
 *   3. 兜底：账套 fiscal_year + 当前自然月。
 */
export function getDashboardPeriod(db: ReturnType<typeof getDb>, accountSetId?: string) {
  // 1) period_closing 推导
  const lastClosed = db
    .prepare(
      `SELECT year, period FROM period_closing
       WHERE account_set_id=? AND status='closed'
       ORDER BY year DESC, period DESC LIMIT 1`
    )
    .get(accountSetId) as any
  if (lastClosed?.year && lastClosed?.period) {
    let y = Number(lastClosed.year)
    let m = Number(lastClosed.period) + 1
    if (m > 12) { m = 1; y += 1 }
    return { year: y, period: m }
  }

  // 2) 最新已记账凭证。草稿/已审核凭证不能改变首页会计期间。
  const latestVoucher = db
    .prepare(
      `SELECT year, period FROM vouchers
       WHERE account_set_id=? AND status='posted'
       ORDER BY year DESC, period DESC, voucher_date DESC, voucher_no DESC
       LIMIT 1`
    )
    .get(accountSetId) as any
  if (latestVoucher?.year && latestVoucher?.period) {
    return { year: Number(latestVoucher.year), period: Number(latestVoucher.period) }
  }

  // 3) 兜底
  const accountSet = db
    .prepare('SELECT fiscal_year FROM account_sets WHERE id=?')
    .get(accountSetId) as any
  const now = dayjs()
  return {
    year: Number(accountSet?.fiscal_year) || now.year(),
    period: now.month() + 1,
  }
}

export interface DashboardReportLink {
  code: string
  name: string
  path: string
}

/**
 * 首页“本期盈余”应进入当前账套的财务成果报表，不能依赖固定模板编号。
 * 政府会计优先收入费用表，企业类制度优先利润表；仅匹配已启用模板。
 */
export function getFinancialResultReportLink(
  db: ReturnType<typeof getDb>,
  accountSetId: string,
  accountingStandard: string
): DashboardReportLink | null {
  const tableExists = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='report_definitions'")
    .get()
  if (!tableExists) return null

  const templates = db
    .prepare(
      `SELECT code, name
       FROM report_definitions
       WHERE account_set_id=? AND COALESCE(is_enabled, 1)=1
       ORDER BY sort_order ASC, code ASC`
    )
    .all(accountSetId) as Array<{ code: string; name: string }>

  const preferredNames = accountingStandard === 'government'
    ? ['收入费用表', '利润表', '损益表']
    : ['利润表', '收入费用表', '损益表']
  const normalizeName = (value: string) => String(value || '').replace(/\s+/g, '')

  let matched: { code: string; name: string } | undefined
  for (const preferredName of preferredNames) {
    matched = templates.find(template => normalizeName(template.name) === preferredName)
    if (matched) break
  }
  if (!matched) {
    for (const preferredName of preferredNames) {
      matched = templates.find(template => normalizeName(template.name).includes(preferredName))
      if (matched) break
    }
  }
  if (!matched?.code) return null

  return {
    code: matched.code,
    name: matched.name,
    path: `/report/dynamic/${encodeURIComponent(matched.code)}?view=1`,
  }
}

/**
 * 损益判定（兼容旧测试导出）：名称关键字 + 方向
 */
export const INCOME_PREDICATE = `a.name LIKE '%收入%' AND a.direction='credit'`
export const EXPENSE_PREDICATE = `(a.name LIKE '%支出%' OR a.name LIKE '%费用%' OR a.name LIKE '%成本%') AND a.direction='debit'`
export const PURE_EXPENSE_PREDICATE = `a.name LIKE '%支出%' AND a.direction='debit'`
export const FEE_PREDICATE = `a.name LIKE '%费用%' AND a.direction='debit'`
export const COST_PREDICATE = `a.name LIKE '%成本%' AND a.direction='debit'`

export { buildAccountCategoryPredicate }

export const INCOME_CATEGORY_PREDICATE = buildAccountCategoryPredicate('收入', 'credit')
export const PURE_EXPENSE_CATEGORY_PREDICATE = buildAccountCategoryPredicate('支出', 'debit')
export const FEE_CATEGORY_PREDICATE = buildAccountCategoryPredicate('费用', 'debit')
export const COST_CATEGORY_PREDICATE = buildAccountCategoryPredicate('成本', 'debit')
export const EXPENSE_CATEGORY_PREDICATE = `(${PURE_EXPENSE_CATEGORY_PREDICATE} OR ${FEE_CATEGORY_PREDICATE} OR ${COST_CATEGORY_PREDICATE})`

// 排除自动结转生成的凭证
// 把损益清零，混入会导致 Dashboard 上"本期收入/支出"显示为 0 或负数。
export const EXCLUDE_TRANSFER_VOUCHERS = `NOT EXISTS (SELECT 1 FROM auto_transfer_runs atr WHERE atr.account_set_id=v.account_set_id AND atr.voucher_id=v.id)`

export interface PeriodFlowRow {
  income: number
  pureExpense: number
  fee: number
  cost: number
  expense: number
}

export function queryPeriodFlow(
  db: ReturnType<typeof getDb>,
  accountSetId: string | undefined,
  year: number,
  period: number,
  predicates?: DashboardCategoryPredicates
): PeriodFlowRow {
  const resolvedPredicates =
    predicates ??
    (accountSetId
      ? getDashboardCategoryConfig(db, accountSetId).predicates
      : {
          income: INCOME_CATEGORY_PREDICATE,
          pureExpense: PURE_EXPENSE_CATEGORY_PREDICATE,
          fee: FEE_CATEGORY_PREDICATE,
          cost: COST_CATEGORY_PREDICATE,
          expense: EXPENSE_CATEGORY_PREDICATE,
        })

  const row = db
    .prepare(
      `
    SELECT
      COALESCE(SUM(CASE
        WHEN ${resolvedPredicates.income}
          THEN CASE WHEN ve.direction='credit' THEN ve.amount ELSE -ve.amount END
        ELSE 0
      END), 0) as income,
      COALESCE(SUM(CASE
        WHEN ${resolvedPredicates.pureExpense}
          AND NOT (${resolvedPredicates.fee} OR ${resolvedPredicates.cost})
          THEN CASE WHEN ve.direction='debit' THEN ve.amount ELSE -ve.amount END
        ELSE 0
      END), 0) as pureExpense,
      COALESCE(SUM(CASE
        WHEN ${resolvedPredicates.fee}
          AND NOT ${resolvedPredicates.cost}
          THEN CASE WHEN ve.direction='debit' THEN ve.amount ELSE -ve.amount END
        ELSE 0
      END), 0) as fee,
      COALESCE(SUM(CASE
        WHEN ${resolvedPredicates.cost}
          THEN CASE WHEN ve.direction='debit' THEN ve.amount ELSE -ve.amount END
        ELSE 0
      END), 0) as cost,
      COALESCE(SUM(CASE
        WHEN ${resolvedPredicates.expense}
          THEN CASE WHEN ve.direction='debit' THEN ve.amount ELSE -ve.amount END
        ELSE 0
      END), 0) as expense
    FROM voucher_entries ve
    JOIN vouchers v ON v.id = ve.voucher_id
    JOIN accounts a ON a.id = ve.account_id
    WHERE ve.account_set_id=? AND v.year=? AND v.period=?
      AND v.status='posted' AND ${EXCLUDE_TRANSFER_VOUCHERS}
  `
    )
    .get(accountSetId, year, period) as any

  const income = Number(row?.income || 0)
  const pureExpense = Number(row?.pureExpense || 0)
  const fee = Number(row?.fee || 0)
  const cost = Number(row?.cost || 0)
  const expense = Number(row?.expense || 0)

  return { income, pureExpense, fee, cost, expense }
}

function getPeriodEndDate(year: number, period: number) {
  return dayjs(`${year}-${String(period).padStart(2, '0')}-01`).endOf('month').format('YYYY-MM-DD')
}

function buildBalanceExpression(alias = 'a', entryAlias = 've') {
  return `CASE WHEN ${alias}.direction='debit'
    THEN CASE WHEN ${entryAlias}.direction='debit' THEN ${entryAlias}.amount ELSE -${entryAlias}.amount END
    ELSE CASE WHEN ${entryAlias}.direction='credit' THEN ${entryAlias}.amount ELSE -${entryAlias}.amount END
  END`
}

interface CashBankAccountRow {
  id: string
  code: string
  name: string
  balance: number
}

export function getCashBankLeavesByRootCode(
  db: ReturnType<typeof getDb>,
  accountSetId: string | undefined,
  rootCode: string,
  year: number,
  periodEnd: string
) {
  const yearStart = dayjs(`${year}-01-01`).format('YYYY-MM-DD')
  return db
    .prepare(
      `
    WITH RECURSIVE descendants AS (
      SELECT id, code, name, direction, account_set_id
      FROM accounts
      WHERE account_set_id=? AND code=? AND is_enabled=1
      UNION ALL
      SELECT c.id, c.code, c.name, c.direction, c.account_set_id
      FROM accounts c
      JOIN descendants d ON d.id = c.parent_id
      WHERE c.account_set_id=? AND c.is_enabled=1
    ),
    leaf_accounts AS (
      SELECT d.id, d.code, d.name, d.direction, d.account_set_id
      FROM descendants d
      WHERE NOT EXISTS (
        SELECT 1 FROM accounts c
        WHERE c.account_set_id=d.account_set_id
          AND c.parent_id=d.id
          AND c.is_enabled=1
      )
    ),
    init_bals AS (
      SELECT ib.account_id, SUM(ib.init_balance) as balance
      FROM init_balances ib
      JOIN leaf_accounts l ON l.id = ib.account_id
      WHERE ib.account_set_id=? AND ib.year=?
      GROUP BY ib.account_id
    ),
    flows AS (
      SELECT ve.account_id,
        SUM(CASE WHEN l.direction='debit'
          THEN CASE WHEN ve.direction='debit' THEN ve.amount ELSE -ve.amount END
          ELSE CASE WHEN ve.direction='credit' THEN ve.amount ELSE -ve.amount END
        END) as balance
      FROM voucher_entries ve
      JOIN vouchers v ON v.id = ve.voucher_id
      JOIN leaf_accounts l ON l.id = ve.account_id
      WHERE ve.account_set_id=?
        AND v.voucher_date >= ? AND v.voucher_date <= ?
      GROUP BY ve.account_id
    )
    SELECT l.id, l.code, l.name,
      COALESCE(i.balance, 0) + COALESCE(f.balance, 0) as balance
    FROM leaf_accounts l
    LEFT JOIN init_bals i ON i.account_id = l.id
    LEFT JOIN flows f ON f.account_id = l.id
    ORDER BY l.code
  `
    )
    .all(accountSetId, rootCode, accountSetId, accountSetId, year, accountSetId, yearStart, periodEnd) as CashBankAccountRow[]
}

function getCashBankLeavesByFlag(
  db: ReturnType<typeof getDb>,
  accountSetId: string | undefined,
  flag: 'is_cash' | 'is_bank',
  year: number,
  periodEnd: string,
  accountScope?: AccountScopeContext
) {
  const yearStart = dayjs(`${year}-01-01`).format('YYYY-MM-DD')
  const scopeConditions: string[] = []
  const scopeParams: string[] = []
  appendAccountScopeCondition(accountScope, 'l.id', scopeConditions, scopeParams)
  const scopeWhere = scopeConditions.length ? `WHERE ${scopeConditions.join(' AND ')}` : ''

  return db
    .prepare(
      `
    WITH leaf_accounts AS (
      SELECT a.id, a.code, a.name, a.direction, a.account_set_id
      FROM accounts a
      WHERE a.account_set_id=?
        AND a.is_enabled=1
        AND a.${flag}=1
        AND NOT EXISTS (
          SELECT 1 FROM accounts c
          WHERE c.account_set_id=a.account_set_id
            AND c.parent_id=a.id
            AND c.is_enabled=1
        )
    ),
    init_bals AS (
      SELECT ib.account_id, SUM(ib.init_balance) as balance
      FROM init_balances ib
      JOIN leaf_accounts l ON l.id = ib.account_id
      WHERE ib.account_set_id=? AND ib.year=?
      GROUP BY ib.account_id
    ),
    flows AS (
      SELECT ve.account_id,
        SUM(CASE WHEN l.direction='debit'
          THEN CASE WHEN ve.direction='debit' THEN ve.amount ELSE -ve.amount END
          ELSE CASE WHEN ve.direction='credit' THEN ve.amount ELSE -ve.amount END
        END) as balance
      FROM voucher_entries ve
      JOIN vouchers v ON v.id = ve.voucher_id
      JOIN leaf_accounts l ON l.id = ve.account_id
      WHERE ve.account_set_id=?
        AND v.status='posted'
        AND v.voucher_date >= ? AND v.voucher_date <= ?
      GROUP BY ve.account_id
    )
    SELECT l.id, l.code, l.name,
      COALESCE(i.balance, 0) + COALESCE(f.balance, 0) as balance
    FROM leaf_accounts l
    LEFT JOIN init_bals i ON i.account_id = l.id
    LEFT JOIN flows f ON f.account_id = l.id
    ${scopeWhere}
    ORDER BY l.code
  `
    )
    .all(accountSetId, accountSetId, year, accountSetId, yearStart, periodEnd, ...scopeParams) as CashBankAccountRow[]
}

function getCashBankStructure(
  db: ReturnType<typeof getDb>,
  accountSetId: string | undefined,
  year: number,
  periodEnd: string,
  accountScope?: AccountScopeContext
) {
  const groups = [
    { flag: 'is_cash' as const, name: '现金' },
    { flag: 'is_bank' as const, name: '银行及其他货币资金' },
  ]

  return groups
    .map(group => {
      const rows = getCashBankLeavesByFlag(
        db,
        accountSetId,
        group.flag,
        year,
        periodEnd,
        accountScope
      )
      const children = rows.map(row => ({
        code: row.code,
        name: row.name,
        balance: Number(row.balance || 0),
      }))
      return {
        name: group.name,
        balance: children.reduce((sum, item) => sum + item.balance, 0),
        children,
      }
    })
    .filter(group => group.children.length > 0)
}

// ===================== 工作台数据 =====================
function getDashboardRequestContext(req: AuthRequest) {
  const carrier = req as AuthRequest & { __dashboardContext?: Record<string, any> }
  carrier.__dashboardContext ||= {}
  return carrier.__dashboardContext
}

function getDashboardPeriodForRequest(req: AuthRequest, db: ReturnType<typeof getDb>) {
  const context = getDashboardRequestContext(req)
  context.period ||= getDashboardPeriod(db, req.accountSetId)
  return context.period as { year: number; period: number }
}

function getDashboardConfigForRequest(req: AuthRequest, db: ReturnType<typeof getDb>) {
  const context = getDashboardRequestContext(req)
  context.categoryConfig ||= getDashboardCategoryConfig(db, req.accountSetId!)
  return context.categoryConfig as ReturnType<typeof getDashboardCategoryConfig>
}

function getCashStructureForRequest(
  req: AuthRequest,
  db: ReturnType<typeof getDb>,
  year: number,
  periodEnd: string
) {
  const context = getDashboardRequestContext(req)
  context.cashStructure ||= getCashBankStructure(
    db,
    req.accountSetId,
    year,
    periodEnd,
    req.accountScope
  )
  return context.cashStructure as ReturnType<typeof getCashBankStructure>
}

function getVoucherScopeSql(req: AuthRequest, voucherAlias = 'v') {
  if (!req.accountScope) return { sql: '1=1', params: [] as string[] }
  return buildVoucherAllEntriesInScopeSql(
    req.accountScope,
    `${voucherAlias}.id`,
    req.accountSetId!
  )
}

const dashboardStatsHandler = ((req: AuthRequest, res: any) => {
  const db = getDb()
  const { year, period } = getDashboardPeriodForRequest(req, db)
  const periodStart = dayjs(`${year}-${String(period).padStart(2, '0')}-01`)
  const monthEnd = periodStart.endOf('month').format('YYYY-MM-DD')
  const categoryConfig = getDashboardConfigForRequest(req, db)
  const { predicates } = categoryConfig
  const budgetPredicates = categoryConfig.budgetPredicates
  const voucherScope = getVoucherScopeSql(req)

  // 本月凭证数
  const voucherCount = db
    .prepare(
      `
    SELECT COUNT(*) as cnt FROM vouchers v
    WHERE v.account_set_id=? AND v.year=? AND v.period=? AND ${voucherScope.sql}
  `
    )
    .get(req.accountSetId, year, period, ...voucherScope.params) as any

  // 未记账凭证数（本期）：草稿+已审核都还没有完成记账
  const unpostedVoucherCount = db
    .prepare(
      `SELECT COUNT(*) as cnt FROM vouchers v
       WHERE v.account_set_id=? AND v.year=? AND v.period=?
         AND v.status IN ('draft', 'audited') AND ${voucherScope.sql}`
    )
    .get(req.accountSetId, year, period, ...voucherScope.params) as any

  const cashBankStructure = getCashStructureForRequest(req, db, year, monthEnd)

  // 本期收入/支出只统计已记账凭证；草稿和已审核凭证只进入流程待办。
  const flowConditions = [
    've.account_set_id=?',
    'v.year=?',
    'v.period=?',
    "v.status='posted'",
    EXCLUDE_TRANSFER_VOUCHERS,
  ]
  const flowScopeParams: string[] = []
  appendAccountScopeCondition(req.accountScope, 've.account_id', flowConditions, flowScopeParams)
  const monthlyFlow = db
    .prepare(
      `
    SELECT
      COALESCE(SUM(CASE
        WHEN ${predicates.income}
          THEN CASE WHEN ve.direction='credit' THEN ve.amount ELSE -ve.amount END
        ELSE 0
      END), 0) as income,
      COALESCE(SUM(CASE
        WHEN ${predicates.expense}
          THEN CASE WHEN ve.direction='debit' THEN ve.amount ELSE -ve.amount END
        ELSE 0
      END), 0) as expense,
      COALESCE(SUM(CASE
        WHEN ${budgetPredicates.income}
          THEN CASE WHEN ve.direction='credit' THEN ve.amount ELSE -ve.amount END
        ELSE 0
      END), 0) as budgetIncome,
      COALESCE(SUM(CASE
        WHEN ${budgetPredicates.expense}
          THEN CASE WHEN ve.direction='debit' THEN ve.amount ELSE -ve.amount END
        ELSE 0
      END), 0) as budgetExpense
    FROM voucher_entries ve
    JOIN vouchers v ON v.id = ve.voucher_id
    JOIN accounts a ON a.id = ve.account_id
    WHERE ${flowConditions.join(' AND ')}
  `
    )
    .get(req.accountSetId, year, period, ...flowScopeParams) as any

  const cashBalance = cashBankStructure.reduce((sum, item) => sum + item.balance, 0)
  const monthlyIncome = Number(monthlyFlow?.income || 0)
  const monthlyExpense = Number(monthlyFlow?.expense || 0)
  const budgetIncome = Number(monthlyFlow?.budgetIncome || 0)
  const budgetExpense = Number(monthlyFlow?.budgetExpense || 0)
  const financialResultReport = getFinancialResultReportLink(
    db,
    req.accountSetId!,
    categoryConfig.standard
  )

  res.json({
    code: 0,
    data: {
      currentYear: year,
      currentPeriod: period,
      voucherCount: voucherCount?.cnt || 0,
      unpostedVoucherCount: unpostedVoucherCount?.cnt || 0,
      pendingVoucherCount: unpostedVoucherCount?.cnt || 0,
      auditPending: unpostedVoucherCount?.cnt || 0,
      cashBalance,
      monthlyIncome,
      monthlyExpense,
      monthlySurplus: monthlyIncome - monthlyExpense,
      budgetIncome,
      budgetExpense,
      budgetBalance: budgetIncome - budgetExpense,
      accountingStandard: categoryConfig.standard,
      accountingStandardName: categoryConfig.standardName,
      dashboardRuleMode: categoryConfig.dashboardRuleMode,
      financialResultReportPath: financialResultReport?.path || '',
      financialResultReportName: financialResultReport?.name || '',
    },
  })
})

// 近6个月收支趋势
const dashboardTrendHandler = ((req: AuthRequest, res: any) => {
  const db = getDb()
  const { year, period } = getDashboardPeriodForRequest(req, db)
  const categoryConfig = getDashboardConfigForRequest(req, db)
  const { predicates } = categoryConfig
  const budgetPredicates = categoryConfig.budgetPredicates

  // 计算最近6个月的范围
  const endMonth = year * 12 + (period - 1)
  const startMonth = endMonth - 5
  
  const startYear = Math.floor(startMonth / 12)
  const startPeriod = (startMonth % 12) + 1

  const trendConditions = [
    've.account_set_id=?',
    '(v.year * 12 + v.period - 1) BETWEEN ? AND ?',
    "v.status='posted'",
    EXCLUDE_TRANSFER_VOUCHERS,
  ]
  const trendScopeParams: string[] = []
  appendAccountScopeCondition(req.accountScope, 've.account_id', trendConditions, trendScopeParams)

  // 单次查询获取 6 个月已记账数据
  const rows = db.prepare(`
    SELECT
      v.year, v.period,
      COALESCE(SUM(CASE
        WHEN ${predicates.income}
          THEN CASE WHEN ve.direction='credit' THEN ve.amount ELSE -ve.amount END
        ELSE 0
      END), 0) as income,
      COALESCE(SUM(CASE
        WHEN ${predicates.pureExpense}
          AND NOT (${predicates.fee} OR ${predicates.cost})
          THEN CASE WHEN ve.direction='debit' THEN ve.amount ELSE -ve.amount END
        ELSE 0
      END), 0) as pureExpense,
      COALESCE(SUM(CASE
        WHEN ${predicates.fee}
          AND NOT ${predicates.cost}
          THEN CASE WHEN ve.direction='debit' THEN ve.amount ELSE -ve.amount END
        ELSE 0
      END), 0) as fee,
      COALESCE(SUM(CASE
        WHEN ${predicates.cost}
          THEN CASE WHEN ve.direction='debit' THEN ve.amount ELSE -ve.amount END
        ELSE 0
      END), 0) as cost,
      COALESCE(SUM(CASE
        WHEN ${predicates.expense}
          THEN CASE WHEN ve.direction='debit' THEN ve.amount ELSE -ve.amount END
        ELSE 0
      END), 0) as expense,
      COALESCE(SUM(CASE
        WHEN ${budgetPredicates.income}
          THEN CASE WHEN ve.direction='credit' THEN ve.amount ELSE -ve.amount END
        ELSE 0
      END), 0) as budgetIncome,
      COALESCE(SUM(CASE
        WHEN ${budgetPredicates.expense}
          THEN CASE WHEN ve.direction='debit' THEN ve.amount ELSE -ve.amount END
        ELSE 0
      END), 0) as budgetExpense
    FROM voucher_entries ve
    JOIN vouchers v ON v.id = ve.voucher_id
    JOIN accounts a ON a.id = ve.account_id
    WHERE ${trendConditions.join(' AND ')}
    GROUP BY v.year, v.period
  `).all(req.accountSetId, startMonth, endMonth, ...trendScopeParams) as any[]

  const results = []
  for (let i = 5; i >= 0; i--) {
    const d = dayjs(`${year}-${String(period).padStart(2, '0')}-01`).subtract(i, 'month')
    const y = d.year()
    const m = d.month() + 1
    const row = rows.find(r => r.year === y && r.period === m)
    results.push({
      month: `${y}-${String(m).padStart(2, '0')}`,
      income: Number(row?.income || 0),
      pureExpense: Number(row?.pureExpense || 0),
      fee: Number(row?.fee || 0),
      cost: Number(row?.cost || 0),
      expense: Number(row?.expense || 0),
      budgetIncome: Number(row?.budgetIncome || 0),
      budgetExpense: Number(row?.budgetExpense || 0),
      budgetBalance: Number(row?.budgetIncome || 0) - Number(row?.budgetExpense || 0),
    })
  }

  res.json({
    code: 0,
    data: results,
    meta: {
      accountingStandard: categoryConfig.standard,
      accountingStandardName: categoryConfig.standardName,
      dashboardRuleMode: categoryConfig.dashboardRuleMode,
    },
  })
})

// 工作台洞察：待办风险、资金结构、科目活跃度
const dashboardInsightsHandler = ((req: AuthRequest, res: any) => {
  const db = getDb()
  const { year, period } = getDashboardPeriodForRequest(req, db)
  const periodEnd = getPeriodEndDate(year, period)
  const voucherScope = getVoucherScopeSql(req)

  const statusRow = db
    .prepare(
      `
    SELECT
      COALESCE(SUM(CASE WHEN status='draft' THEN 1 ELSE 0 END), 0) as draftCount,
      COALESCE(SUM(CASE WHEN status='audited' THEN 1 ELSE 0 END), 0) as auditedCount,
      COALESCE(SUM(CASE WHEN status='posted' THEN 1 ELSE 0 END), 0) as postedCount
    FROM vouchers v
    WHERE v.account_set_id=? AND v.year=? AND v.period=? AND ${voucherScope.sql}
  `
    )
    .get(req.accountSetId, year, period, ...voucherScope.params) as any

  const auxConditions = ['ve.account_set_id=?', 'v.year=?', 'v.period=?', 'a.is_aux=1']
  const auxScopeParams: string[] = []
  appendAccountScopeCondition(req.accountScope, 've.account_id', auxConditions, auxScopeParams)
  const auxMissing = db
    .prepare(
      `
    SELECT COUNT(*) as count
    FROM voucher_entries ve
    JOIN accounts a ON a.id = ve.account_id
    JOIN vouchers v ON v.id = ve.voucher_id
    WHERE ${auxConditions.join(' AND ')}
      AND (ve.aux_data IS NULL OR ve.aux_data='' OR ve.aux_data='{}')
  `
    )
    .get(req.accountSetId, year, period, ...auxScopeParams) as any

  const cashStructure = getCashStructureForRequest(req, db, year, periodEnd)
  const negativeCashCount = cashStructure.reduce(
    (count, group) => count + group.children.filter(item => item.balance < 0).length,
    0
  )

  const activityConditions = [
    've.account_set_id=?',
    'v.year=?',
    'v.period=?',
    "v.status='posted'",
    EXCLUDE_TRANSFER_VOUCHERS,
  ]
  const activityScopeParams: string[] = []
  appendAccountScopeCondition(
    req.accountScope,
    've.account_id',
    activityConditions,
    activityScopeParams
  )
  const activityTop = db
    .prepare(
      `
    WITH leaf_accounts AS (
      SELECT id, code, name
      FROM accounts a
      WHERE account_set_id=?
        AND is_enabled=1
        AND NOT EXISTS (
          SELECT 1 FROM accounts c
          WHERE c.account_set_id=a.account_set_id AND c.parent_id=a.id
        )
    )
    SELECT a.code, a.name,
      COALESCE(SUM(ve.amount), 0) as amount
    FROM voucher_entries ve
    JOIN vouchers v ON v.id = ve.voucher_id
    JOIN leaf_accounts a ON a.id = ve.account_id
    WHERE ${activityConditions.join(' AND ')}
    GROUP BY a.id, a.code, a.name
    HAVING amount <> 0
    ORDER BY ABS(amount) DESC
    LIMIT 5
  `
    )
    .all(req.accountSetId, req.accountSetId, year, period, ...activityScopeParams) as any[]

  const riskItems = [
    {
      key: 'draft',
      title: '草稿凭证',
      count: Number(statusRow?.draftCount || 0),
      level: Number(statusRow?.draftCount || 0) > 0 ? 'warning' : 'normal',
      actionPath: '/voucher/audit',
    },
    {
      key: 'audited',
      title: '待记账凭证',
      count: Number(statusRow?.auditedCount || 0),
      level: Number(statusRow?.auditedCount || 0) > 0 ? 'warning' : 'normal',
      actionPath: '/voucher/audit',
    },
    {
      key: 'negative-cash',
      title: '货币资金负数',
      count: negativeCashCount,
      level: negativeCashCount > 0 ? 'danger' : 'normal',
      actionPath: '/ledger/balance',
    },
    {
      key: 'aux-missing',
      title: '辅助核算缺失',
      count: Number(auxMissing?.count || 0),
      level: Number(auxMissing?.count || 0) > 0 ? 'danger' : 'normal',
      actionPath: '/voucher/audit',
    },
  ]

  res.json({
    code: 0,
    data: {
      currentYear: year,
      currentPeriod: period,
      statusCounts: {
        draft: Number(statusRow?.draftCount || 0),
        audited: Number(statusRow?.auditedCount || 0),
        posted: Number(statusRow?.postedCount || 0),
      },
      riskItems,
      cashStructure,
      activityTop,
      expenseTop: activityTop,
    },
  })
})

// 科目余额Top5（按余额绝对值降序，仅叶子科目）
// 余额定义：当年期初 + 当年已记账凭证（v.status='posted'）累计；按科目方向取符号
router.get('/top-accounts', (req: AuthRequest, res) => {
  const db = getDb()
  const { year } = getDashboardPeriod(db, req.accountSetId)

  // 1. 获取所有叶子科目
  const leafAccounts = db.prepare(`
    SELECT a.id, a.code, a.name, a.direction
    FROM accounts a
    WHERE a.account_set_id = ?
      AND a.is_enabled = 1
      AND NOT EXISTS (
        SELECT 1 FROM accounts c
        WHERE c.account_set_id = a.account_set_id
          AND c.parent_id = a.id
          AND c.is_enabled = 1
      )
  `).all(req.accountSetId) as any[]

  if (leafAccounts.length === 0) {
    return res.json({ code: 0, data: [] })
  }

  const leafIds = leafAccounts.map(a => a.id)
  
  // 2. 批量查询期初和发生额
  const list = db
    .prepare(
      `
    WITH leaf_ids(id) AS (
      SELECT value FROM json_each(?)
    ),
    init_bals AS (
      SELECT ib.account_id, SUM(ib.init_balance) as balance
      FROM init_balances ib
      JOIN leaf_ids l ON l.id = ib.account_id
      WHERE ib.account_set_id = ? AND ib.year = ?
      GROUP BY ib.account_id
    ),
    flows AS (
      SELECT ve.account_id,
        SUM(CASE WHEN a.direction = 'debit'
          THEN CASE WHEN ve.direction = 'debit' THEN ve.amount ELSE -ve.amount END
          ELSE CASE WHEN ve.direction = 'credit' THEN ve.amount ELSE -ve.amount END
        END) as balance
      FROM voucher_entries ve
      JOIN vouchers v ON v.id = ve.voucher_id
      JOIN accounts a ON a.id = ve.account_id
      JOIN leaf_ids l ON l.id = ve.account_id
      WHERE ve.account_set_id = ?
        AND v.status = 'posted'
        AND v.year = ?
      GROUP BY ve.account_id
    )
    SELECT a.code, a.name, a.direction,
      (COALESCE(i.balance, 0) + COALESCE(f.balance, 0)) as balance
    FROM accounts a
    JOIN leaf_ids l ON l.id = a.id
    LEFT JOIN init_bals i ON i.account_id = a.id
    LEFT JOIN flows f ON f.account_id = a.id
    WHERE balance <> 0
    ORDER BY ABS(balance) DESC
    LIMIT 5
  `
    )
    .all(JSON.stringify(leafIds), req.accountSetId, year, req.accountSetId, year)

  res.json({ code: 0, data: list })
})

// 近期凭证（最近10条）
const dashboardRecentVouchersHandler = ((req: AuthRequest, res: any) => {
  const db = getDb()
  const voucherScope = getVoucherScopeSql(req)
  const list = db
    .prepare(
      `
    WITH top_vouchers AS (
      SELECT id, voucher_no, voucher_date, remark, status, year, period,
             maker_name, auditor_name, poster_name, attachments
      FROM vouchers v
      WHERE v.account_set_id=? AND ${voucherScope.sql}
      ORDER BY voucher_date DESC, voucher_no DESC
      LIMIT 10
    )
    SELECT v.id, v.voucher_no as voucherNo, v.voucher_date as voucherDate,
           v.remark as abstract, v.status, v.year, v.period,
           v.maker_name as makerName, v.auditor_name as auditorName,
           v.poster_name as posterName, v.attachments,
           COUNT(ve.id) as entryCount,
           SUM(CASE WHEN ve.direction='debit' THEN ve.amount ELSE 0 END) as totalAmount,
           GROUP_CONCAT(DISTINCT ve.account_code || ' ' || ve.account_name) as accountSummary
    FROM top_vouchers v
    LEFT JOIN voucher_entries ve ON ve.voucher_id = v.id
    GROUP BY v.id
    ORDER BY v.voucher_date DESC, v.voucher_no DESC
  `
    )
    .all(req.accountSetId, ...voucherScope.params)

  res.json({ code: 0, data: list })
})

function captureDashboardSection(
  handler: (req: AuthRequest, res: any) => unknown,
  req: AuthRequest
) {
  let payload: any
  const response = {
    status() { return response },
    json(value: any) {
      payload = value
      return response
    },
  }
  handler(req, response)
  if (!payload || payload.code !== 0) {
    throw new Error(payload?.message || '工作台数据加载失败')
  }
  return payload.data
}

router.get('/stats', dashboardStatsHandler)
router.get('/trend', dashboardTrendHandler)
router.get('/insights', dashboardInsightsHandler)
router.get('/recent-vouchers', dashboardRecentVouchersHandler)

// ── 工作台待办与分模块汇总 ────────────────────────────────────────────────

type TodoLevel = 'normal' | 'warning' | 'danger'

interface WorkbenchTodo {
  key: string
  title: string
  count: number
  level: TodoLevel
  actionPath: string
  /** 所属注册模块，前端按授权过滤 */
  module: 'gl' | 'cashier' | 'asset' | 'scm' | 'production' | 'outsource'
  /** 任一权限满足即展示 */
  permission: string[]
  hint?: string
}

function tableExists(db: ReturnType<typeof getDb>, name: string): boolean {
  const row = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`)
    .get(name) as { name: string } | undefined
  return !!row
}

/** 查询失败（如旧库缺表/缺列）时返回 fallback，不让整个工作台报错 */
function safeQuery<T>(fn: () => T, fallback: T): T {
  try {
    return fn()
  } catch (error) {
    console.warn('[dashboard/todos] 查询失败，已跳过:', (error as Error)?.message)
    return fallback
  }
}

function levelByCount(count: number, dangerFrom = Infinity): TodoLevel {
  if (count <= 0) return 'normal'
  return count >= dangerFrom ? 'danger' : 'warning'
}

const dashboardTodosHandler = (req: AuthRequest, res: any) => {
  const db = getDb()
  const accountSetId = req.accountSetId!
  const { year, period } = getDashboardPeriodForRequest(req, db)
  const licensed = new Set(getLicensedModules(db))
  const hasScm = licensed.has('scm') || licensed.has('production') || licensed.has('outsource')
  const todos: WorkbenchTodo[] = []

  // ── 总账 ──
  if (licensed.has('gl')) {
    const voucherScope = getVoucherScopeSql(req)
    const statusRow = safeQuery(
      () =>
        db
          .prepare(
            `SELECT
               SUM(CASE WHEN v.status='draft' THEN 1 ELSE 0 END) AS draftCount,
               SUM(CASE WHEN v.status='audited' THEN 1 ELSE 0 END) AS auditedCount
             FROM vouchers v
             WHERE v.account_set_id=? AND ${voucherScope.sql}`
          )
          .get(accountSetId, ...voucherScope.params) as any,
      null
    )
    const draft = Number(statusRow?.draftCount || 0)
    const audited = Number(statusRow?.auditedCount || 0)
    todos.push(
      {
        key: 'voucher-draft',
        title: '待审核凭证',
        count: draft,
        level: levelByCount(draft),
        actionPath: '/voucher/audit',
        module: 'gl',
        permission: ['voucher:audit'],
        hint: '草稿状态，等待审核',
      },
      {
        key: 'voucher-audited',
        title: '待记账凭证',
        count: audited,
        level: levelByCount(audited),
        actionPath: '/voucher/audit',
        module: 'gl',
        permission: ['voucher:post'],
        hint: '已审核，等待记账',
      }
    )
  }

  // ── 出纳 ──
  let cashier: { accountCount: number; totalBalance: number; unreconciledCount: number } | null = null
  if (licensed.has('cashier') && tableExists(db, 'cashier_journal')) {
    cashier = safeQuery(() => {
      const init = db
        .prepare(
          `SELECT COUNT(DISTINCT account_code) AS cnt, COALESCE(SUM(balance),0) AS total
           FROM cashier_init_balance WHERE account_set_id=?`
        )
        .get(accountSetId) as any
      const flow = db
        .prepare(
          `SELECT COUNT(DISTINCT account_code) AS cnt,
                  COALESCE(SUM(debit),0) - COALESCE(SUM(credit),0) AS net,
                  SUM(CASE WHEN reconciled=0 THEN 1 ELSE 0 END) AS unreconciled
           FROM cashier_journal WHERE account_set_id=?`
        )
        .get(accountSetId) as any
      return {
        accountCount: Math.max(Number(init?.cnt || 0), Number(flow?.cnt || 0)),
        totalBalance: Number(init?.total || 0) + Number(flow?.net || 0),
        unreconciledCount: Number(flow?.unreconciled || 0),
      }
    }, null)
  }

  // ── 固定资产 ──
  let asset: { assetCount: number; undepreciatedCount: number } | null = null
  if (licensed.has('asset') && tableExists(db, 'fixed_asset')) {
    asset = safeQuery(() => {
      const total = db
        .prepare(`SELECT COUNT(*) AS cnt FROM fixed_asset WHERE account_set_id=?`)
        .get(accountSetId) as any
      const done = db
        .prepare(
          `SELECT COUNT(DISTINCT asset_no) AS cnt FROM fixed_asset_depr
           WHERE account_set_id=? AND year=? AND month=?`
        )
        .get(accountSetId, year, period) as any
      const assetCount = Number(total?.cnt || 0)
      return { assetCount, undepreciatedCount: Math.max(0, assetCount - Number(done?.cnt || 0)) }
    }, null)
    if (asset && asset.assetCount > 0) {
      todos.push({
        key: 'asset-depreciation',
        title: '本期未计提折旧',
        count: asset.undepreciatedCount,
        level: levelByCount(asset.undepreciatedCount),
        actionPath: '/asset/depreciation',
        module: 'asset',
        permission: ['asset:edit'],
        hint: `${year} 年第 ${period} 期`,
      })
    }
  }

  // ── 供应链 ──
  let scm: {
    draftDocCount: number
    monthSalesAmount: number
    monthPurchaseAmount: number
    stockAlertCount: number
    openReceivable: number
    openPayable: number
    dueSoonCount: number
  } | null = null
  if (hasScm && tableExists(db, 'scm_doc')) {
    const monthStart = dayjs(`${year}-${String(period).padStart(2, '0')}-01`)
    const monthEnd = monthStart.endOf('month')
    const startStr = monthStart.format('YYYY-MM-DD')
    const endStr = monthEnd.format('YYYY-MM-DD')

    const draftByCategory = safeQuery(
      () =>
        db
          .prepare(
            `SELECT COALESCE(t.category, 'other') AS category, COUNT(*) AS cnt
             FROM scm_doc d
             LEFT JOIN scm_doc_type t ON t.account_set_id=d.account_set_id AND t.code=d.doc_type
             WHERE d.account_set_id=? AND d.status='draft'
             GROUP BY COALESCE(t.category, 'other')`
          )
          .all(accountSetId) as Array<{ category: string; cnt: number }>,
      []
    )
    const draftCount = (category: string) =>
      Number(draftByCategory.find(row => row.category === category)?.cnt || 0)

    const categoryTodos: Array<{
      category: string
      key: string
      title: string
      path: string
      module: WorkbenchTodo['module']
      permission: string[]
    }> = [
      { category: 'purchase', key: 'scm-draft-purchase', title: '待审核采购单据', path: '/scm/docs?doc_type=PO&status=draft', module: 'scm', permission: ['scm:purchase'] },
      { category: 'sale', key: 'scm-draft-sale', title: '待审核销售单据', path: '/scm/docs?doc_type=SOa&status=draft', module: 'scm', permission: ['scm:sale'] },
      { category: 'inventory', key: 'scm-draft-inventory', title: '待审核库存单据', path: '/scm/docs?doc_type=OI&status=draft', module: 'scm', permission: ['scm:inventory'] },
      { category: 'finance', key: 'scm-draft-finance', title: '待审核收付款单', path: '/scm/docs?doc_type=RCV&status=draft', module: 'scm', permission: ['scm:arap'] },
      { category: 'production', key: 'scm-draft-production', title: '待审核生产单据', path: '/scm/docs?doc_type=PL&status=draft', module: 'production', permission: ['scm:production'] },
      { category: 'outsource', key: 'scm-draft-outsource', title: '待审核委外单据', path: '/scm/docs?doc_type=WO&status=draft', module: 'outsource', permission: ['scm:outsource'] },
    ]
    for (const entry of categoryTodos) {
      if (!licensed.has(entry.module)) continue
      const count = draftCount(entry.category)
      todos.push({
        key: entry.key,
        title: entry.title,
        count,
        level: levelByCount(count),
        actionPath: entry.path,
        module: entry.module,
        permission: entry.permission,
      })
    }

    const stockAlertCount = safeQuery(
      () =>
        Number(
          (
            db
              .prepare(
                `SELECT COUNT(*) AS cnt FROM scm_item i
                 WHERE i.account_set_id=? AND i.enabled<>0 AND COALESCE(i.safety_stock,0) > 0
                   AND COALESCE((SELECT SUM(s.qty) FROM scm_stock s
                                 WHERE s.account_set_id=i.account_set_id AND s.item_code=i.code),0) < i.safety_stock`
              )
              .get(accountSetId) as any
          )?.cnt || 0
        ),
      0
    )

    const monthAmounts = safeQuery(
      () =>
        db
          .prepare(
            `SELECT
               COALESCE(SUM(CASE WHEN doc_type='SO' THEN total_amount WHEN doc_type='SR' THEN -total_amount ELSE 0 END),0) AS sales,
               COALESCE(SUM(CASE WHEN doc_type='PI' THEN total_amount WHEN doc_type='PR' THEN -total_amount ELSE 0 END),0) AS purchase
             FROM scm_doc
             WHERE account_set_id=? AND status='audited' AND doc_date>=? AND doc_date<=?`
          )
          .get(accountSetId, startStr, endStr) as any,
      null
    )

    const arap = tableExists(db, 'scm_ar_ap_log')
      ? safeQuery(
          () =>
            db
              .prepare(
                `SELECT
                   COALESCE(SUM(CASE WHEN direction='in' AND doc_type IN ('SO','SR','RS') THEN amount - COALESCE(verified_amount,0) ELSE 0 END),0) AS receivable,
                   COALESCE(SUM(CASE WHEN direction='in' AND doc_type IN ('PI','PR','RP','WI') THEN amount - COALESCE(verified_amount,0) ELSE 0 END),0) AS payable,
                   SUM(CASE WHEN direction='in' AND (amount - COALESCE(verified_amount,0)) > 0.005
                             AND julianday(COALESCE(due_date, doc_date)) <= julianday('now') + 7 THEN 1 ELSE 0 END) AS dueSoon
                 FROM scm_ar_ap_log
                 WHERE account_set_id=?`
              )
              .get(accountSetId) as any,
          null
        )
      : null

    scm = {
      draftDocCount: draftByCategory.reduce((sum, row) => sum + Number(row.cnt || 0), 0),
      monthSalesAmount: Number(monthAmounts?.sales || 0),
      monthPurchaseAmount: Number(monthAmounts?.purchase || 0),
      stockAlertCount,
      openReceivable: Number(arap?.receivable || 0),
      openPayable: Number(arap?.payable || 0),
      dueSoonCount: Number(arap?.dueSoon || 0),
    }

    if (licensed.has('scm')) {
      todos.push(
        {
          key: 'stock-alert',
          title: '库存低于安全库存',
          count: stockAlertCount,
          level: levelByCount(stockAlertCount, 10),
          actionPath: '/scm/report/stock-alert',
          module: 'scm',
          permission: ['scm:report', 'scm:stock'],
        },
        {
          key: 'arap-due',
          title: '7 日内到期应收应付',
          count: scm.dueSoonCount,
          level: levelByCount(scm.dueSoonCount, 5),
          actionPath: '/scm/arap-due',
          module: 'scm',
          permission: ['scm:arap'],
          hint: '含已逾期未核销',
        }
      )
    }
  }

  res.json({
    code: 0,
    data: {
      currentYear: year,
      currentPeriod: period,
      todos,
      cashier,
      asset,
      scm,
    },
  })
}

router.get('/todos', dashboardTodosHandler)

router.get('/overview', (req: AuthRequest, res) => {
  try {
    const context = getDashboardRequestContext(req)
    for (const key of Object.keys(context)) delete context[key]
    const stats = captureDashboardSection(dashboardStatsHandler, req)
    const recentVouchers = captureDashboardSection(dashboardRecentVouchersHandler, req)
    const trend = captureDashboardSection(dashboardTrendHandler, req)
    const insights = captureDashboardSection(dashboardInsightsHandler, req)
    res.json({ code: 0, data: { stats, recentVouchers, trend, insights } })
  } catch (error: any) {
    res.status(500).json({ code: 500, message: error.message || '工作台数据加载失败' })
  }
})

export default router
