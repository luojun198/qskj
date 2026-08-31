import type { Database } from 'better-sqlite3'
import type { CashFlowTrialBalanceScope } from './cashFlowTrialBalance.js'
import { isCashFlowEnabledForAccountSet } from './voucherEntry.js'

export type CashFlowVoucherCheckIssue = 'missing' | 'invalid_code' | 'orphan'

export type CashFlowVoucherCheckEntry = {
  voucherId: string
  voucherNo: string
  voucherDate: string
  accountCode: string
  accountName: string
  direction: 'debit' | 'credit'
  amount: number
  status: string
  cashFlowCode: string | null
  issueType: CashFlowVoucherCheckIssue
  issueLabel: string
}

export type CashFlowVoucherCheckResult = {
  meta: {
    enabled: boolean
    scope: CashFlowTrialBalanceScope
    year: number
    period: number
    fromPeriod: number
    toPeriod: number
    includeUnposted: boolean
    scopeLabel: string
  }
  summary: {
    totalCashEntries: number
    missingCount: number
    invalidCodeCount: number
    orphanCount: number
    issueCount: number
    passed: boolean
  }
  missingEntries: CashFlowVoucherCheckEntry[]
  invalidCodeEntries: CashFlowVoucherCheckEntry[]
  orphanEntries: CashFlowVoucherCheckEntry[]
}

function buildStatusCondition(includeUnposted: boolean): string {
  return includeUnposted
    ? "v.status IN ('draft', 'audited', 'posted')"
    : "v.status = 'posted'"
}

function buildScopeMeta(
  year: number,
  period: number,
  scope: CashFlowTrialBalanceScope,
  includeUnposted: boolean
) {
  const fromPeriod = scope === 'ytd' ? 1 : period
  const toPeriod = period
  const scopeLabel =
    scope === 'ytd' ? `${year}年1-${period}月（本年累计）` : `${year}年${period}月`
  return { fromPeriod, toPeriod, scopeLabel }
}

function countTotalCashEntries(
  db: Database,
  accountSetId: string,
  year: number,
  fromPeriod: number,
  toPeriod: number,
  includeUnposted: boolean
): number {
  const statusCondition = buildStatusCondition(includeUnposted)
  const row = db
    .prepare(
      `
      SELECT COUNT(*) AS cnt
      FROM voucher_entries ve
      JOIN vouchers v ON v.id = ve.voucher_id
      JOIN accounts a ON a.id = ve.account_id
      WHERE ve.account_set_id = ?
        AND v.year = ?
        AND v.period >= ?
        AND v.period <= ?
        AND ${statusCondition}
        AND (a.is_cash = 1 OR a.is_bank = 1)
      `
    )
    .get(accountSetId, year, fromPeriod, toPeriod) as { cnt: number } | undefined
  return row?.cnt || 0
}

function loadMissingCashFlowEntries(
  db: Database,
  accountSetId: string,
  year: number,
  fromPeriod: number,
  toPeriod: number,
  includeUnposted: boolean
): CashFlowVoucherCheckEntry[] {
  const statusCondition = buildStatusCondition(includeUnposted)
  const rows = db
    .prepare(
      `
      SELECT ve.voucher_id AS voucherId,
             v.voucher_no AS voucherNo,
             v.voucher_date AS voucherDate,
             ve.account_code AS accountCode,
             a.name AS accountName,
             ve.direction,
             ve.amount,
             v.status
      FROM voucher_entries ve
      JOIN vouchers v ON v.id = ve.voucher_id
      JOIN accounts a ON a.id = ve.account_id
      WHERE ve.account_set_id = ?
        AND v.year = ?
        AND v.period >= ?
        AND v.period <= ?
        AND ${statusCondition}
        AND (a.is_cash = 1 OR a.is_bank = 1)
        AND (ve.cash_flow_code IS NULL OR TRIM(ve.cash_flow_code) = '')
      ORDER BY v.voucher_date, v.voucher_no, ve.seq
      `
    )
    .all(accountSetId, year, fromPeriod, toPeriod) as Array<Omit<CashFlowVoucherCheckEntry, 'cashFlowCode' | 'issueType' | 'issueLabel'>>

  return rows.map(row => ({
    ...row,
    cashFlowCode: null,
    issueType: 'missing' as const,
    issueLabel: '未指定现金流量项目',
  }))
}

function loadInvalidCodeEntries(
  db: Database,
  accountSetId: string,
  year: number,
  fromPeriod: number,
  toPeriod: number,
  includeUnposted: boolean
): CashFlowVoucherCheckEntry[] {
  const statusCondition = buildStatusCondition(includeUnposted)
  const rows = db
    .prepare(
      `
      SELECT ve.voucher_id AS voucherId,
             v.voucher_no AS voucherNo,
             v.voucher_date AS voucherDate,
             ve.account_code AS accountCode,
             a.name AS accountName,
             ve.direction,
             ve.amount,
             v.status,
             TRIM(ve.cash_flow_code) AS cashFlowCode
      FROM voucher_entries ve
      JOIN vouchers v ON v.id = ve.voucher_id
      JOIN accounts a ON a.id = ve.account_id
      LEFT JOIN cash_flow_items cf
        ON cf.account_set_id = ve.account_set_id
       AND cf.code = TRIM(ve.cash_flow_code)
       AND cf.is_active = 1
      WHERE ve.account_set_id = ?
        AND v.year = ?
        AND v.period >= ?
        AND v.period <= ?
        AND ${statusCondition}
        AND (a.is_cash = 1 OR a.is_bank = 1)
        AND ve.cash_flow_code IS NOT NULL
        AND TRIM(ve.cash_flow_code) != ''
        AND cf.id IS NULL
      ORDER BY v.voucher_date, v.voucher_no, ve.seq
      `
    )
    .all(accountSetId, year, fromPeriod, toPeriod) as Array<
    Omit<CashFlowVoucherCheckEntry, 'issueType' | 'issueLabel'>
  >

  return rows.map(row => ({
    ...row,
    issueType: 'invalid_code' as const,
    issueLabel: `无效编码「${row.cashFlowCode}」`,
  }))
}

function loadOrphanFlowEntries(
  db: Database,
  accountSetId: string,
  year: number,
  fromPeriod: number,
  toPeriod: number,
  includeUnposted: boolean
): CashFlowVoucherCheckEntry[] {
  const statusCondition = buildStatusCondition(includeUnposted)
  const rows = db
    .prepare(
      `
      SELECT ve.voucher_id AS voucherId,
             v.voucher_no AS voucherNo,
             v.voucher_date AS voucherDate,
             ve.account_code AS accountCode,
             a.name AS accountName,
             ve.direction,
             ve.amount,
             v.status,
             TRIM(ve.cash_flow_code) AS cashFlowCode
      FROM voucher_entries ve
      JOIN vouchers v ON v.id = ve.voucher_id
      JOIN accounts a ON a.id = ve.account_id
      WHERE ve.account_set_id = ?
        AND v.year = ?
        AND v.period >= ?
        AND v.period <= ?
        AND ${statusCondition}
        AND ve.cash_flow_code IS NOT NULL
        AND TRIM(ve.cash_flow_code) != ''
        AND a.is_cash = 0
        AND a.is_bank = 0
      ORDER BY v.voucher_date, v.voucher_no, ve.seq
      `
    )
    .all(accountSetId, year, fromPeriod, toPeriod) as Array<
    Omit<CashFlowVoucherCheckEntry, 'issueType' | 'issueLabel'>
  >

  return rows.map(row => ({
    ...row,
    issueType: 'orphan' as const,
    issueLabel: '非现金类科目指定了现金流量项目',
  }))
}

export function getCashFlowVoucherCheck(
  db: Database,
  accountSetId: string,
  year: number,
  period: number,
  scope: CashFlowTrialBalanceScope = 'month',
  includeUnposted = false
): CashFlowVoucherCheckResult {
  const enabled = isCashFlowEnabledForAccountSet(db, accountSetId)
  const { fromPeriod, toPeriod, scopeLabel } = buildScopeMeta(year, period, scope, includeUnposted)

  if (!enabled) {
    return {
      meta: {
        enabled: false,
        scope,
        year,
        period,
        fromPeriod,
        toPeriod,
        includeUnposted,
        scopeLabel,
      },
      summary: {
        totalCashEntries: 0,
        missingCount: 0,
        invalidCodeCount: 0,
        orphanCount: 0,
        issueCount: 0,
        passed: true,
      },
      missingEntries: [],
      invalidCodeEntries: [],
      orphanEntries: [],
    }
  }

  const totalCashEntries = countTotalCashEntries(
    db,
    accountSetId,
    year,
    fromPeriod,
    toPeriod,
    includeUnposted
  )
  const missingEntries = loadMissingCashFlowEntries(
    db,
    accountSetId,
    year,
    fromPeriod,
    toPeriod,
    includeUnposted
  )
  const invalidCodeEntries = loadInvalidCodeEntries(
    db,
    accountSetId,
    year,
    fromPeriod,
    toPeriod,
    includeUnposted
  )
  const orphanEntries = loadOrphanFlowEntries(
    db,
    accountSetId,
    year,
    fromPeriod,
    toPeriod,
    includeUnposted
  )

  const missingCount = missingEntries.length
  const invalidCodeCount = invalidCodeEntries.length
  const orphanCount = orphanEntries.length
  const issueCount = missingCount + invalidCodeCount

  return {
    meta: {
      enabled: true,
      scope,
      year,
      period,
      fromPeriod,
      toPeriod,
      includeUnposted,
      scopeLabel,
    },
    summary: {
      totalCashEntries,
      missingCount,
      invalidCodeCount,
      orphanCount,
      issueCount,
      passed: issueCount === 0,
    },
    missingEntries,
    invalidCodeEntries,
    orphanEntries,
  }
}

/** 供试算平衡表复用：未指定 + 无效编码的 error 级问题数 */
export function countCashFlowVoucherErrors(result: CashFlowVoucherCheckResult): number {
  return result.summary.missingCount + result.summary.invalidCodeCount
}
