import type { Database } from 'better-sqlite3'
import type { BalanceQueryDb } from './reportBalance.js'
import type { AccountScopeContext } from './accountAuthorization.js'
import { getBatchBalances, getPeriodRangeSumExcludeTransfer } from './reportBalance.js'
import { getIndirectMethodMapping } from '../config/staticCashFlowIndirectMappings.js'
import type { IndirectAdjustmentKind } from '../config/staticCashFlowIndirectMappings.js'
import {
  resolveStaticReportStandard,
  getIncomeStatementConfig,
  type StaticReportStandard,
} from './staticReportConfig.js'
import { expandFlowAccountCodes } from './staticCashFlowExpand.js'

export type IndirectMethodLine = {
  label: string
  amount: number
}

export type CashFlowReportScope = 'month' | 'ytd'

export type IndirectMethodSchedule = {
  standard: StaticReportStandard
  standardName: string
  profitLabel: string
  netProfit: number
  adjustments: IndirectMethodLine[]
  operatingCashNet: number
  scope: CashFlowReportScope
  scopeNote: string
}

function round2(v: number): number {
  return Math.round(v * 100) / 100
}

function sumExpandedBalance(
  db: BalanceQueryDb | Database,
  accountSetId: string,
  patterns: string[],
  year: number,
  period: number,
  accountScope?: AccountScopeContext
): number {
  const codes = expandFlowAccountCodes(db as any, accountSetId, patterns)
  if (codes.length === 0) return 0
  // FIX-142：间接法附注同样受科目授权范围约束，与主表直接法一致
  const map = getBatchBalances(db as any, accountSetId, codes, year, period, accountScope)
  let total = 0
  for (const code of codes) {
    total += map.get(code) || 0
  }
  return round2(total)
}

function balanceChange(
  db: BalanceQueryDb | Database,
  accountSetId: string,
  patterns: string[],
  year: number,
  period: number,
  scope: CashFlowReportScope,
  accountScope?: AccountScopeContext
): number {
  const end = sumExpandedBalance(db, accountSetId, patterns, year, period, accountScope)
  // P1-17：本月/本年累计的期初均为「上一期末余额」。period-1=0 即年初余额；
  // 旧实现 month + period<=1 误取 0，导致 1 月间接法把期末全额当本月变动。
  const begin =
    scope === 'ytd'
      ? sumExpandedBalance(db, accountSetId, patterns, year, 0, accountScope)
      : sumExpandedBalance(db, accountSetId, patterns, year, period - 1, accountScope)
  return round2(end - begin)
}

function adjustmentAmount(change: number, kind: IndirectAdjustmentKind): number {
  switch (kind) {
    case 'non_cash_add':
      return change
    case 'working_capital_asset':
      return round2(-change)
    case 'working_capital_liability':
      return change
    default:
      return 0
  }
}

/** 利润表口径净利润/本期盈余 */
export function calcNetProfitForPeriod(
  db: BalanceQueryDb | Database,
  accountSetId: string,
  year: number,
  period: number,
  standard?: StaticReportStandard,
  scope: CashFlowReportScope = 'ytd',
  accountScope?: AccountScopeContext
): { netProfit: number; profitLabel: string; standardName: string } {
  const resolvedStandard = standard ?? resolveStaticReportStandard(db as any, accountSetId)
  const incomeConfig = getIncomeStatementConfig(resolvedStandard)
  const indirectMapping = getIndirectMethodMapping(resolvedStandard)

  // P1-19：净利润统一用「排除结转凭证的发生额」计算（month 取本期、ytd 取 1..period 累计）。
  // 旧 ytd 分支用 getBatchBalances 取损益科目期末余额，月末结转损益后余额为 0 → 净利润恒 0。
  const fromPeriod = scope === 'month' ? period : 1

  let totalRevenue = 0
  for (const groupCodes of Object.values(incomeConfig.revenueGroups)) {
    for (const code of groupCodes) {
      const sum = getPeriodRangeSumExcludeTransfer(db, accountSetId, code, year, fromPeriod, period, accountScope)
      totalRevenue += Math.abs(sum.credit - sum.debit)
    }
  }

  let totalExpense = 0
  for (const groupCodes of Object.values(incomeConfig.expenseGroups)) {
    for (const code of groupCodes) {
      const sum = getPeriodRangeSumExcludeTransfer(db, accountSetId, code, year, fromPeriod, period, accountScope)
      totalExpense += sum.debit - sum.credit
    }
  }

  return {
    netProfit: round2(totalRevenue - totalExpense),
    profitLabel: indirectMapping.profitLabel,
    standardName: incomeConfig.standardName,
  }
}

/** 构建间接法附注调节表（估算口径，累计至查询期间） */
export function buildIndirectMethodSchedule(
  db: BalanceQueryDb | Database,
  accountSetId: string,
  year: number,
  period: number,
  scope: CashFlowReportScope = 'month',
  accountScope?: AccountScopeContext
): IndirectMethodSchedule {
  const standard = resolveStaticReportStandard(db as any, accountSetId)
  const mapping = getIndirectMethodMapping(standard)
  const { netProfit, profitLabel, standardName } = calcNetProfitForPeriod(
    db,
    accountSetId,
    year,
    period,
    standard,
    scope,
    accountScope
  )

  const adjustments: IndirectMethodLine[] = []
  let operatingCashNet = netProfit

  for (const line of mapping.adjustments) {
    const change = balanceChange(db, accountSetId, line.patterns, year, period, scope, accountScope)
    const amount = adjustmentAmount(change, line.kind)
    if (Math.abs(amount) < 0.005) continue
    adjustments.push({ label: line.label, amount })
    operatingCashNet = round2(operatingCashNet + amount)
  }

  const scopeNote =
    scope === 'month'
      ? '间接法附注按本期科目余额变动估算（与主表「本月」口径一致）'
      : '间接法附注按科目余额变动估算（累计至本期），与主表直接法行次口径可能不同'

  return {
    standard,
    standardName,
    profitLabel,
    netProfit,
    adjustments,
    operatingCashNet,
    scope,
    scopeNote,
  }
}
