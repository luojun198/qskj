import type { Database } from 'better-sqlite3'
import {
  getCashFlowConfig,
  resolveStaticReportStandard,
  type ResolvedAccountingStandard,
} from './staticReportConfig.js'
import { expandFlowAccountCodes } from './staticCashFlowExpand.js'
import { computeCashFlowByMapping } from './cashFlowAutoEngine.js'
import { getBatchBalances } from './reportBalance.js'
import { isCashFlowEnabledForAccountSet } from './voucherEntry.js'
import {
  getCashFlowVoucherCheck,
  type CashFlowVoucherCheckEntry,
} from './cashFlowVoucherCheck.js'

export type CashFlowTrialBalanceScope = 'month' | 'ytd'

export type CashFlowActivityKey = 'operating' | 'investing' | 'financing' | 'other'

export type CashFlowTrialBalanceItem = {
  code: string
  name: string
  parentCode: string | null
  level: number
  direction: string
  activity: CashFlowActivityKey
  activityLabel: string
  debitTotal: number
  creditTotal: number
  signedNet: number
  voucherCount: number
}

export type CashFlowTrialBalanceEntry = {
  voucherId: string
  voucherNo: string
  voucherDate: string
  accountCode: string
  accountName: string
  direction: 'debit' | 'credit'
  amount: number
  status: string
  cashFlowCode?: string | null
  issueLabel?: string
}

function mapCheckEntry(entry: CashFlowVoucherCheckEntry): CashFlowTrialBalanceEntry {
  return {
    voucherId: entry.voucherId,
    voucherNo: entry.voucherNo,
    voucherDate: entry.voucherDate,
    accountCode: entry.accountCode,
    accountName: entry.accountName,
    direction: entry.direction,
    amount: entry.amount,
    status: entry.status,
    cashFlowCode: entry.cashFlowCode,
    issueLabel: entry.issueLabel,
  }
}

export type CashFlowTrialBalanceCheck = {
  id: string
  label: string
  expected: number | null
  actual: number | null
  diff: number
  passed: boolean
  severity: 'error' | 'warning' | 'info'
}

export type CashFlowTrialBalanceResult = {
  meta: {
    enabled: boolean
    accountingStandard: ResolvedAccountingStandard
    accountingStandardName: string
    activityLabels: {
      operating: string
      investing: string
      financing: string
    }
    cashAccountCodes: string[]
    scope: CashFlowTrialBalanceScope
    year: number
    period: number
    fromPeriod: number
    toPeriod: number
    includeUnposted: boolean
    scopeLabel: string
  }
  summary: {
    operatingNet: number
    investingNet: number
    financingNet: number
    totalNet: number
    cashAccountNetChange: number
    beginCash: number
    endCash: number
    diff: number
    balanced: boolean
    unmatchedCount: number
    itemsWithData: number
    itemCount: number
  }
  items: CashFlowTrialBalanceItem[]
  unmatchedCashEntries: CashFlowTrialBalanceEntry[]
  invalidCodeEntries: CashFlowTrialBalanceEntry[]
  orphanFlowEntries: CashFlowTrialBalanceEntry[]
  voucherCheck: {
    totalCashEntries: number
    missingCount: number
    invalidCodeCount: number
    orphanCount: number
    issueCount: number
    passed: boolean
  }
  balanceChecks: CashFlowTrialBalanceCheck[]
}

const EPS = 0.01

function round2(v: number): number {
  return Math.round(v * 100) / 100
}

function activityFromCode(code: string): CashFlowActivityKey {
  const seg = String(code || '').trim().charAt(0)
  if (seg === '1') return 'operating'
  if (seg === '2') return 'investing'
  if (seg === '3') return 'financing'
  return 'other'
}

function getActivityLabels(standard: ResolvedAccountingStandard) {
  if (standard === 'government') {
    return { operating: '日常活动', investing: '投资活动', financing: '筹资活动' }
  }
  return { operating: '经营活动', investing: '投资活动', financing: '筹资活动' }
}

function resolveStaticStandard(db: Database, accountSetId: string) {
  return resolveStaticReportStandard(db, accountSetId)
}

export function getCashFlowTrialBalance(
  db: Database,
  accountSetId: string,
  year: number,
  period: number,
  scope: CashFlowTrialBalanceScope = 'month',
  includeUnposted = false
): CashFlowTrialBalanceResult {
  const enabled = isCashFlowEnabledForAccountSet(db, accountSetId)
  const staticStandard = resolveStaticStandard(db, accountSetId)
  const config = getCashFlowConfig(staticStandard)
  const activityLabels = getActivityLabels(staticStandard)
  const cashAccountCodes = expandFlowAccountCodes(db, accountSetId, config.cashCodes)

  const fromPeriod = scope === 'ytd' ? 1 : period
  const toPeriod = period
  const scopeLabel =
    scope === 'ytd' ? `${year}年1-${period}月（本年累计）` : `${year}年${period}月`

  const auto = computeCashFlowByMapping(db, accountSetId, year, fromPeriod, toPeriod, undefined, {
    includeUnposted,
  })
  const flowItems = auto.items.filter(i => i.kind !== 'supplement')

  const items: CashFlowTrialBalanceItem[] = []
  for (const item of [...flowItems].sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }))) {
    const amt = auto.main.get(item.code)
    if (!amt) continue
    const cls = auto.itemClass.get(item.code)
    const activity: CashFlowActivityKey = cls?.activity || 'other'
    const activityLabel =
      activity === 'operating'
        ? activityLabels.operating
        : activity === 'investing'
          ? activityLabels.investing
          : activity === 'financing'
            ? activityLabels.financing
            : '其他'
    // 借方发生 = 现金类科目借方（流入），贷方发生 = 现金类科目贷方（流出）
    const debitTotal = round2(amt.inflow)
    const creditTotal = round2(amt.outflow)
    const signedNet = round2(amt.inflow - amt.outflow)
    if (debitTotal === 0 && creditTotal === 0) continue
    items.push({
      code: item.code,
      name: item.name,
      parentCode: item.parent_code || null,
      level: 1,
      direction: cls?.flow === 'out' ? 'outflow' : cls?.flow === 'in' ? 'inflow' : item.direction,
      activity,
      activityLabel,
      debitTotal,
      creditTotal,
      signedNet,
      voucherCount: amt.voucherCount || 0,
    })
  }

  const operatingNet = auto.activities.operating
  const investingNet = auto.activities.investing
  const financingNet = auto.activities.financing

  const itemCount = flowItems.length
  const itemsWithData = items.length

  // 现金及现金等价物科目本期净变动（与自动取数同一口径：含其他货币资金；未设置项目的金额体现在差额里）
  const cashAccountNetChange = auto.cashChange

  const beginPeriod = scope === 'month' && period > 1 ? period - 1 : 0
  const beginBalanceMap = getBatchBalances(db, accountSetId, cashAccountCodes, year, beginPeriod)
  const endBalanceMap = getBatchBalances(db, accountSetId, cashAccountCodes, year, period)
  let beginCash = 0
  let endCash = 0
  for (const code of cashAccountCodes) {
    beginCash += beginBalanceMap.get(code) || 0
    endCash += endBalanceMap.get(code) || 0
  }
  beginCash = round2(beginCash)
  endCash = round2(endCash)

  const totalNet = round2(operatingNet + investingNet + financingNet + auto.activities.other)
  const diff = round2(totalNet - cashAccountNetChange)
  const cashBalanceDiff = round2(endCash - beginCash - totalNet)

  const voucherCheckResult = getCashFlowVoucherCheck(
    db,
    accountSetId,
    year,
    period,
    scope,
    includeUnposted
  )
  const unmatchedCashEntries = voucherCheckResult.missingEntries.map(mapCheckEntry)
  const invalidCodeEntries = voucherCheckResult.invalidCodeEntries.map(mapCheckEntry)
  const orphanFlowEntries = voucherCheckResult.orphanEntries.map(mapCheckEntry)

  const balanceChecks: CashFlowTrialBalanceCheck[] = [
    {
      id: 'activities_sum',
      label: `${activityLabels.operating} + ${activityLabels.investing} + ${activityLabels.financing} = 现金流量净额`,
      expected: totalNet,
      actual: totalNet,
      diff: round2(totalNet - (operatingNet + investingNet + financingNet + auto.activities.other)),
      passed: Math.abs(totalNet - (operatingNet + investingNet + financingNet + auto.activities.other)) < EPS,
      severity: 'error',
    },
    {
      id: 'flow_vs_cash',
      label: '现金流量项目净额 = 现金类科目本期净变动',
      expected: cashAccountNetChange,
      actual: totalNet,
      diff,
      passed: Math.abs(diff) < EPS,
      severity: 'error',
    },
    {
      id: 'begin_end_cash',
      label: '期初现金 + 本期净增加 = 期末现金',
      expected: endCash,
      actual: round2(beginCash + totalNet),
      diff: cashBalanceDiff,
      passed: Math.abs(cashBalanceDiff) < EPS,
      severity: 'warning',
    },
    {
      id: 'unmatched_entries',
      label: '现金收付凭证的对方科目均已设置现金流量项目',
      expected: 0,
      actual: unmatchedCashEntries.length,
      diff: unmatchedCashEntries.length,
      passed: unmatchedCashEntries.length === 0,
      severity: 'error',
    },
  ]

  if (invalidCodeEntries.length > 0) {
    balanceChecks.push({
      id: 'invalid_code_entries',
      label: '科目设置的现金流量项目均有效',
      expected: 0,
      actual: invalidCodeEntries.length,
      diff: invalidCodeEntries.length,
      passed: false,
      severity: 'error',
    })
  }

  if (!enabled) {
    balanceChecks.push({
      id: 'cash_flow_disabled',
      label: '账套未启用现金流核算',
      expected: null,
      actual: null,
      diff: 0,
      passed: true,
      severity: 'info',
    })
  }

  if (orphanFlowEntries.length > 0) {
    balanceChecks.push({
      id: 'orphan_flow_entries',
      label: '非现金类科目指定了现金流量项目（参考提示）',
      expected: 0,
      actual: orphanFlowEntries.length,
      diff: orphanFlowEntries.length,
      passed: false,
      severity: 'info',
    })
  }

  const balanced =
    balanceChecks.filter(c => c.severity === 'error').every(c => c.passed) &&
    Math.abs(diff) < EPS

  return {
    meta: {
      enabled,
      accountingStandard: staticStandard,
      accountingStandardName: config.standardName,
      activityLabels,
      cashAccountCodes,
      scope,
      year,
      period,
      fromPeriod,
      toPeriod,
      includeUnposted,
      scopeLabel,
    },
    summary: {
      operatingNet,
      investingNet,
      financingNet,
      totalNet,
      cashAccountNetChange,
      beginCash,
      endCash,
      diff,
      balanced,
      unmatchedCount: unmatchedCashEntries.length + invalidCodeEntries.length,
      itemsWithData,
      itemCount,
    },
    items,
    unmatchedCashEntries,
    invalidCodeEntries,
    orphanFlowEntries,
    voucherCheck: {
      totalCashEntries: voucherCheckResult.summary.totalCashEntries,
      missingCount: voucherCheckResult.summary.missingCount,
      invalidCodeCount: voucherCheckResult.summary.invalidCodeCount,
      orphanCount: voucherCheckResult.summary.orphanCount,
      issueCount: voucherCheckResult.summary.issueCount,
      passed: voucherCheckResult.summary.passed,
    },
    balanceChecks,
  }
}
