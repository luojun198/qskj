import type { Database } from 'better-sqlite3'
import type { AccountScopeContext } from './accountAuthorization.js'
import { isCashFlowEnabledForAccountSet } from './voucherEntry.js'
import { getDirectMethodActivityTotals } from './cashFlowAmount.js'
import {
  buildIndirectMethodSchedule,
  type CashFlowReportScope,
  type IndirectMethodSchedule,
} from './cashFlowIndirectMethod.js'
import { getDynamicCashFlowTotals, type DynamicCashFlowTotals } from './cashFlowDynamicExtract.js'

type ReportWarning = {
  type: string
  message: string
  severity: 'error' | 'warning' | 'info'
}

export type ReportValidationResult = {
  isValid: boolean
  warnings: ReportWarning[]
  suggestions: string[]
}

export type StaticCashFlowReportData = {
  operatingActivities?: Record<string, number>
  investingActivities?: Record<string, number>
  financingActivities?: Record<string, number>
  netCashChange?: number
  beginCash?: number
  endCash?: number
  cashBalanceCheck?: boolean
}

export type CashFlowReconciliation = {
  validation: ReportValidationResult
  indirectMethod?: IndirectMethodSchedule
  directMethod?: {
    operating: number
    investing: number
    financing: number
    net: number
    itemsWithData: number
    itemCount: number
    scope: CashFlowReportScope
    fromPeriod: number
    toPeriod: number
  }
  comparison?: {
    operatingDiff: number
    investingDiff: number
    financingDiff: number
    netDiff: number
    note: string
  }
  indirectComparison?: {
    staticOperatingDiff: number
    directOperatingDiff: number
    note: string
  }
  dynamicMethod?: DynamicCashFlowTotals
  dynamicComparison?: {
    operatingDiff: number
    investingDiff: number
    financingDiff: number
    netDiff: number
    note: string
  }
}

function activityNet(activities: Record<string, number> | undefined): number {
  return Number(activities?.['净额'] ?? 0)
}

/** 校验静态现金流量表 API 返回结构 */
export function validateStaticCashFlowReport(data: StaticCashFlowReportData): ReportValidationResult {
  const warnings: ReportWarning[] = []
  const suggestions: string[] = []

  const netOperating = activityNet(data.operatingActivities)
  const netInvesting = activityNet(data.investingActivities)
  const netFinancing = activityNet(data.financingActivities)
  const netCashChange = Number(data.netCashChange ?? 0)
  const calculatedNet = netOperating + netInvesting + netFinancing
  const sumDiff = Math.abs(netCashChange - calculatedNet)

  if (sumDiff > 0.01) {
    warnings.push({
      type: 'cashflow_sum_mismatch',
      message: `三大活动净额之和（${calculatedNet.toFixed(2)}）与现金净增加额（${netCashChange.toFixed(2)}）不一致，差额 ${sumDiff.toFixed(2)} 元`,
      severity: 'error',
    })
    suggestions.push('请检查经营活动、投资活动、筹资活动各行汇总公式')
  }

  const beginCash = Number(data.beginCash ?? 0)
  const endCash = Number(data.endCash ?? 0)
  const cashDiff = Math.abs(endCash - beginCash - netCashChange)
  const balanceOk = data.cashBalanceCheck === true || cashDiff < 0.01

  if (!balanceOk) {
    warnings.push({
      type: 'cash_balance_mismatch',
      message: `期初现金 ${beginCash.toFixed(2)} + 净增加额 ${netCashChange.toFixed(2)} ≠ 期末现金 ${endCash.toFixed(2)}，差额 ${cashDiff.toFixed(2)} 元`,
      severity: 'error',
    })
    suggestions.push('请核对库存现金、银行存款等科目期初/期末余额与本期凭证')
  }

  return {
    isValid: warnings.filter(w => w.severity === 'error').length === 0,
    warnings,
    suggestions,
  }
}

const COMPARE_THRESHOLD = 0.01

function round2(v: number): number {
  return Math.round(v * 100) / 100
}

/** 静态表 vs 分录现金流量项目（直接法）差异诊断 */
export function buildCashFlowReconciliation(
  db: Database,
  accountSetId: string,
  year: number,
  period: number,
  staticData: StaticCashFlowReportData,
  scope: CashFlowReportScope = 'month',
  accountScope?: AccountScopeContext
): CashFlowReconciliation {
  const validation = validateStaticCashFlowReport(staticData)
  const result: CashFlowReconciliation = { validation }

  const indirect = buildIndirectMethodSchedule(db, accountSetId, year, period, scope, accountScope)
  result.indirectMethod = indirect

  const netOperatingStatic = activityNet(staticData.operatingActivities)
  const staticOperatingDiff = round2(indirect.operatingCashNet - netOperatingStatic)
  result.indirectComparison = {
    staticOperatingDiff,
    directOperatingDiff: 0,
    note: '间接法经营活动净额与主表直接法（科目发生额）对比',
  }

  if (Math.abs(staticOperatingDiff) > COMPARE_THRESHOLD) {
    validation.warnings.push({
      type: 'indirect_vs_static_operating',
      message: `间接法经营活动净额（${indirect.operatingCashNet.toFixed(2)}）与主表直接法经营净额（${netOperatingStatic.toFixed(2)}）相差 ${staticOperatingDiff.toFixed(2)} 元`,
      severity: 'info',
    })
  }

  const dynamic = getDynamicCashFlowTotals(db, accountSetId, year, period, scope, accountScope)
  if (dynamic) {
    result.dynamicMethod = dynamic
    const netOperatingStatic = activityNet(staticData.operatingActivities)
    const netInvestingStatic = activityNet(staticData.investingActivities)
    const netFinancingStatic = activityNet(staticData.financingActivities)
    const netCashChange = Number(staticData.netCashChange ?? 0)
    result.dynamicComparison = {
      operatingDiff: round2(netOperatingStatic - dynamic.operating),
      investingDiff: round2(netInvestingStatic - dynamic.investing),
      financingDiff: round2(netFinancingStatic - dynamic.financing),
      netDiff: round2(netCashChange - dynamic.net),
      note: `与动态模板「${dynamic.templateName}」${dynamic.columnLabel}列对比`,
    }
    if (
      Math.abs(result.dynamicComparison.operatingDiff) > COMPARE_THRESHOLD ||
      Math.abs(result.dynamicComparison.netDiff) > COMPARE_THRESHOLD
    ) {
      validation.warnings.push({
        type: 'static_vs_dynamic_template',
        message: `静态估算与动态现金流量表存在差异：经营 ${result.dynamicComparison.operatingDiff.toFixed(2)}，合计 ${result.dynamicComparison.netDiff.toFixed(2)}`,
        severity: 'info',
      })
    }
  }

  if (!isCashFlowEnabledForAccountSet(db, accountSetId)) {
    validation.isValid = validation.warnings.filter(w => w.severity === 'error').length === 0
    return result
  }

  // P1-18：直接法取数区间须与 scope 一致（ytd 取 1..period 累计，month 取本期），
  // 否则 ytd 下静态表为累计、直接法只含单月，comparison 产生大额虚假差异告警
  const direct = getDirectMethodActivityTotals(
    db,
    accountSetId,
    year,
    scope === 'ytd' ? 1 : period,
    period,
    accountScope
  )
  result.directMethod = {
    operating: direct.operating,
    investing: direct.investing,
    financing: direct.financing,
    net: direct.net,
    itemsWithData: direct.itemsWithData,
    itemCount: direct.itemCount,
    scope,
    fromPeriod: scope === 'ytd' ? 1 : period,
    toPeriod: period,
  }

  if (direct.itemsWithData === 0) {
    validation.warnings.push({
      type: 'direct_method_empty',
      message:
        '本期已过账凭证没有现金收付，或收付凭证的对方科目均未设置现金流量项目，动态报表 @xj_je 将为 0',
      severity: 'warning',
    })
    validation.suggestions.push('到「基础资料 → 科目现金流量项目」为科目设置现金流量项目')
    validation.isValid = validation.warnings.filter(w => w.severity === 'error').length === 0
    result.comparison = {
      operatingDiff: 0,
      investingDiff: 0,
      financingDiff: 0,
      netDiff: 0,
      note: '直接法无数据，跳过数值对比',
    }
    return result
  }

  const netOperating = activityNet(staticData.operatingActivities)
  const netInvesting = activityNet(staticData.investingActivities)
  const netFinancing = activityNet(staticData.financingActivities)
  const netCashChange = Number(staticData.netCashChange ?? 0)

  const operatingDiff = netOperating - direct.operating
  const investingDiff = netInvesting - direct.investing
  const financingDiff = netFinancing - direct.financing
  const netDiff = netCashChange - direct.net

  result.comparison = {
    operatingDiff,
    investingDiff,
    financingDiff,
    netDiff,
    note:
      scope === 'month'
        ? '静态表与分录直接法均为本月口径'
        : '静态表与分录直接法均为本年累计口径（1月至查询月）',
  }

  if (result.indirectComparison) {
    const directOperatingDiff = round2(indirect.operatingCashNet - direct.operating)
    result.indirectComparison.directOperatingDiff = directOperatingDiff
    result.indirectComparison.note =
      scope === 'month'
        ? '间接法附注与分录直接法均为本月口径'
        : '间接法附注与分录直接法均为本年累计口径'
    if (Math.abs(directOperatingDiff) > COMPARE_THRESHOLD) {
      validation.warnings.push({
        type: 'indirect_vs_direct_operating',
        message: `间接法经营净额与分录直接法相差 ${directOperatingDiff.toFixed(2)} 元`,
        severity: 'info',
      })
    }
  }

  if (
    Math.abs(operatingDiff) > COMPARE_THRESHOLD ||
    Math.abs(investingDiff) > COMPARE_THRESHOLD ||
    Math.abs(financingDiff) > COMPARE_THRESHOLD ||
    Math.abs(netDiff) > COMPARE_THRESHOLD
  ) {
    validation.warnings.push({
      type: 'static_vs_direct_diff',
      message: `静态表与直接法（@xj_je）净额存在差异：经营 ${operatingDiff.toFixed(2)}，投资 ${investingDiff.toFixed(2)}，筹资 ${financingDiff.toFixed(2)}，合计 ${netDiff.toFixed(2)}`,
      severity: 'info',
    })
  }

  validation.isValid = validation.warnings.filter(w => w.severity === 'error').length === 0
  return result
}
