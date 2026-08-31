import type { Database } from 'better-sqlite3'
import {
  detectStaticReportStandard,
  getCashFlowConfig,
  resolveAccountingStandard,
  type ResolvedAccountingStandard,
} from './staticReportConfig.js'
import { expandFlowAccountCodes } from './staticCashFlowExpand.js'
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
  const resolved = resolveAccountingStandard(db, accountSetId)
  if (resolved === 'custom') return detectStaticReportStandard(db, accountSetId)
  return resolved
}

function signedNetFromTotals(
  direction: string,
  debitTotal: number,
  creditTotal: number
): number {
  if (direction === 'outflow') {
    return round2(-Math.abs(debitTotal - creditTotal))
  }
  if (direction === 'inflow') {
    return round2(Math.abs(creditTotal - debitTotal))
  }
  return round2(debitTotal - creditTotal)
}

function buildStatusCondition(includeUnposted: boolean): string {
  return includeUnposted
    ? "v.status IN ('draft', 'audited', 'posted')"
    : "v.status = 'posted'"
}

function sumCashAccountNetChange(
  db: Database,
  accountSetId: string,
  year: number,
  fromPeriod: number,
  toPeriod: number,
  includeUnposted: boolean
): number {
  const statusCondition = buildStatusCondition(includeUnposted)
  const rows = db
    .prepare(
      `
      SELECT ve.direction, SUM(ve.amount) AS amount
      FROM voucher_entries ve
      JOIN vouchers v ON v.id = ve.voucher_id
      JOIN accounts a ON a.id = ve.account_id
      WHERE ve.account_set_id = ?
        AND v.year = ?
        AND v.period >= ?
        AND v.period <= ?
        AND ${statusCondition}
        AND (a.is_cash = 1 OR a.is_bank = 1)
      GROUP BY ve.direction
      `
    )
    .all(accountSetId, year, fromPeriod, toPeriod) as Array<{
    direction: 'debit' | 'credit'
    amount: number | null
  }>

  const debit = rows
    .filter(r => r.direction === 'debit')
    .reduce((s, r) => s + Number(r.amount || 0), 0)
  const credit = rows
    .filter(r => r.direction === 'credit')
    .reduce((s, r) => s + Number(r.amount || 0), 0)
  return round2(debit - credit)
}

function loadFlowItemTotals(
  db: Database,
  accountSetId: string,
  year: number,
  fromPeriod: number,
  toPeriod: number,
  includeUnposted: boolean
) {
  const statusCondition = buildStatusCondition(includeUnposted)
  return db
    .prepare(
      `
      SELECT ve.cash_flow_code AS code,
             ve.direction,
             SUM(ve.amount) AS amount,
             COUNT(DISTINCT ve.voucher_id) AS voucher_count
      FROM voucher_entries ve
      JOIN vouchers v ON v.id = ve.voucher_id
      WHERE ve.account_set_id = ?
        AND v.year = ?
        AND v.period >= ?
        AND v.period <= ?
        AND ${statusCondition}
        AND ve.cash_flow_code IS NOT NULL
        AND TRIM(ve.cash_flow_code) != ''
      GROUP BY ve.cash_flow_code, ve.direction
      `
    )
    .all(accountSetId, year, fromPeriod, toPeriod) as Array<{
    code: string
    direction: 'debit' | 'credit'
    amount: number | null
    voucher_count: number
  }>
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

  const flowItems = db
    .prepare(
      `SELECT code, name, parent_code, level, direction
       FROM cash_flow_items
       WHERE account_set_id = ? AND is_active = 1
       ORDER BY sort_order, code`
    )
    .all(accountSetId) as Array<{
    code: string
    name: string
    parent_code: string | null
    level: number
    direction: string
  }>

  const rawTotals = loadFlowItemTotals(db, accountSetId, year, fromPeriod, toPeriod, includeUnposted)
  const debitByCode = new Map<string, number>()
  const creditByCode = new Map<string, number>()
  const voucherCountByCode = new Map<string, number>()

  for (const row of rawTotals) {
    const code = String(row.code).trim()
    if (!code) continue
    if (row.direction === 'debit') {
      debitByCode.set(code, (debitByCode.get(code) || 0) + Number(row.amount || 0))
    } else {
      creditByCode.set(code, (creditByCode.get(code) || 0) + Number(row.amount || 0))
    }
    voucherCountByCode.set(code, Math.max(voucherCountByCode.get(code) || 0, Number(row.voucher_count || 0)))
  }

  const itemMeta = new Map(flowItems.map(i => [i.code, i]))
  const allCodes = new Set<string>([...flowItems.map(i => i.code), ...debitByCode.keys(), ...creditByCode.keys()])

  const items: CashFlowTrialBalanceItem[] = []
  for (const code of [...allCodes].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))) {
    const meta = itemMeta.get(code)
    const activity = activityFromCode(code)
    const activityLabel =
      activity === 'operating'
        ? activityLabels.operating
        : activity === 'investing'
          ? activityLabels.investing
          : activity === 'financing'
            ? activityLabels.financing
            : '其他'

    const debitTotal = round2(debitByCode.get(code) || 0)
    const creditTotal = round2(creditByCode.get(code) || 0)
    const signedNet = signedNetFromTotals(meta?.direction || 'neutral', debitTotal, creditTotal)
    if (debitTotal === 0 && creditTotal === 0 && signedNet === 0) continue

    items.push({
      code,
      name: meta?.name || code,
      parentCode: meta?.parent_code || null,
      level: meta?.level || 1,
      direction: meta?.direction || 'neutral',
      activity,
      activityLabel,
      debitTotal,
      creditTotal,
      signedNet,
      voucherCount: voucherCountByCode.get(code) || 0,
    })
  }

  let operatingNet = 0
  let investingNet = 0
  let financingNet = 0
  for (const item of items) {
    if (item.activity === 'operating') operatingNet += item.signedNet
    else if (item.activity === 'investing') investingNet += item.signedNet
    else if (item.activity === 'financing') financingNet += item.signedNet
  }
  operatingNet = round2(operatingNet)
  investingNet = round2(investingNet)
  financingNet = round2(financingNet)

  const itemCount = flowItems.length
  const itemsWithData = items.length

  const cashAccountNetChange = sumCashAccountNetChange(
    db,
    accountSetId,
    year,
    fromPeriod,
    toPeriod,
    includeUnposted
  )

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

  const totalNet = round2(operatingNet + investingNet + financingNet)
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
      diff: round2(totalNet - (operatingNet + investingNet + financingNet)),
      passed: Math.abs(totalNet - (operatingNet + investingNet + financingNet)) < EPS,
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
      label: '现金/银行分录均已指定现金流量项目',
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
      label: '现金流量项目编码均有效',
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
