import type { Database } from 'better-sqlite3'
import type { CashFlowTrialBalanceScope } from './cashFlowTrialBalance.js'
import { isCashFlowEnabledForAccountSet } from './voucherEntry.js'
import { computeCashFlowByMapping } from './cashFlowAutoEngine.js'

/**
 * 现金流量凭证检查（按「科目现金流量项目」自动取数口径）
 *
 * 凭证录入不再指定现金流量项目，检查的对象变成：含现金类科目的凭证里，
 * 对方科目没有设置主表项目（missing）或设的项目已停用 / 删除（invalid_code）的分录。
 * 修正方式是到「基础资料 → 科目现金流量项目」补设置，而不是改凭证。
 */
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
    /** 参与检查的含现金类科目凭证张数 */
    totalCashEntries: number
    missingCount: number
    invalidCodeCount: number
    orphanCount: number
    issueCount: number
    passed: boolean
  }
  missingEntries: CashFlowVoucherCheckEntry[]
  invalidCodeEntries: CashFlowVoucherCheckEntry[]
  /** 已废弃：凭证不再人工指定项目，恒为空 */
  orphanEntries: CashFlowVoucherCheckEntry[]
}

function buildScopeMeta(year: number, period: number, scope: CashFlowTrialBalanceScope) {
  const fromPeriod = scope === 'ytd' ? 1 : period
  const toPeriod = period
  const scopeLabel = scope === 'ytd' ? `${year}年1-${period}月（本年累计）` : `${year}年${period}月`
  return { fromPeriod, toPeriod, scopeLabel }
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
  const { fromPeriod, toPeriod, scopeLabel } = buildScopeMeta(year, period, scope)
  const meta = { enabled, scope, year, period, fromPeriod, toPeriod, includeUnposted, scopeLabel }

  if (!enabled) {
    return {
      meta,
      summary: { totalCashEntries: 0, missingCount: 0, invalidCodeCount: 0, orphanCount: 0, issueCount: 0, passed: true },
      missingEntries: [],
      invalidCodeEntries: [],
      orphanEntries: [],
    }
  }

  const result = computeCashFlowByMapping(db, accountSetId, year, fromPeriod, toPeriod, undefined, {
    includeUnposted,
    collectDetail: true,
  })

  const voucherIds = [...new Set(result.issues.map(i => i.voucher_id))]
  const voucherMeta = new Map<string, { voucher_no: string; voucher_date: string; status: string }>()
  for (let i = 0; i < voucherIds.length; i += 500) {
    const chunk = voucherIds.slice(i, i + 500)
    const rows = db
      .prepare(
        `SELECT id, voucher_no, voucher_date, status FROM vouchers WHERE id IN (${chunk.map(() => '?').join(',')})`
      )
      .all(...chunk) as Array<{ id: string; voucher_no: string; voucher_date: string; status: string }>
    for (const r of rows) voucherMeta.set(r.id, r)
  }
  const accountById = new Map(
    (db.prepare(`SELECT id, code, name FROM accounts WHERE account_set_id = ?`).all(accountSetId) as Array<{
      id: string
      code: string
      name: string
    }>).map(a => [a.id, a])
  )

  const entries: CashFlowVoucherCheckEntry[] = result.issues.map(issue => {
    const v = voucherMeta.get(issue.voucher_id)
    const acc = accountById.get(issue.account_id)
    const sideLabel = issue.side === 'credit' ? '贷方（现金流入）' : '借方（现金流出）'
    return {
      voucherId: issue.voucher_id,
      voucherNo: v?.voucher_no || '',
      voucherDate: v?.voucher_date || '',
      accountCode: acc?.code || '',
      accountName: acc?.name || '',
      direction: issue.side,
      amount: issue.amount,
      status: v?.status || '',
      cashFlowCode: issue.code,
      issueType: issue.issue,
      issueLabel:
        issue.issue === 'missing'
          ? `科目未设置主表${sideLabel}项目`
          : `科目设置的项目「${issue.code}」已停用或不存在`,
    }
  })
  entries.sort((a, b) => a.voucherDate.localeCompare(b.voucherDate) || a.voucherNo.localeCompare(b.voucherNo, undefined, { numeric: true }))

  const missingEntries = entries.filter(e => e.issueType === 'missing')
  const invalidCodeEntries = entries.filter(e => e.issueType === 'invalid_code')
  const issueCount = missingEntries.length + invalidCodeEntries.length

  return {
    meta,
    summary: {
      totalCashEntries: result.cashVoucherCount,
      missingCount: missingEntries.length,
      invalidCodeCount: invalidCodeEntries.length,
      orphanCount: 0,
      issueCount,
      passed: issueCount === 0,
    },
    missingEntries,
    invalidCodeEntries,
    orphanEntries: [],
  }
}

/** 供试算平衡表复用：未设置 + 无效编码的 error 级问题数 */
export function countCashFlowVoucherErrors(result: CashFlowVoucherCheckResult): number {
  return result.summary.missingCount + result.summary.invalidCodeCount
}
