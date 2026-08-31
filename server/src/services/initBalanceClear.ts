import type { Database } from 'better-sqlite3'
import { syncInitBalanceAuxSummary } from './initBalanceAux.js'

export type InitBalanceClearMode = 'direct' | 'aux'

export interface InitBalanceEditableCheck {
  canEdit: boolean
  reason: string | null
}

export function checkInitBalanceEditable(
  db: Database,
  accountSetId: string,
  year: number
): InitBalanceEditableCheck {
  const result = db
    .prepare(
      `SELECT COUNT(*) as cnt FROM vouchers
       WHERE account_set_id = ? AND strftime('%Y', voucher_date) = ?
       AND status IN ('audited', 'posted')`
    )
    .get(accountSetId, String(year)) as { cnt: number } | undefined

  const count = result?.cnt || 0
  if (count > 0) {
    return {
      canEdit: false,
      reason: `${year}年已有 ${count} 张已审核/已记账凭证，期初余额不允许修改`,
    }
  }
  return { canEdit: true, reason: null }
}

/** 辅助期初：当年有已记账凭证或任一月份已结账则不可编辑 */
export function checkInitBalanceAuxEditable(
  db: Database,
  accountSetId: string,
  year: number
): InitBalanceEditableCheck {
  const posted = db
    .prepare(
      `SELECT COUNT(*) as cnt FROM vouchers
       WHERE account_set_id = ? AND strftime('%Y', voucher_date) = ?
       AND status = 'posted'`
    )
    .get(accountSetId, String(year)) as { cnt: number } | undefined

  const postedCount = posted?.cnt || 0
  if (postedCount > 0) {
    return {
      canEdit: false,
      reason: `${year}年已有 ${postedCount} 张已记账凭证，辅助期初不允许修改`,
    }
  }

  const closedPeriods = db
    .prepare(
      `SELECT period FROM period_closing
       WHERE account_set_id = ? AND year = ? AND status = 'closed'
       ORDER BY period`
    )
    .all(accountSetId, year) as Array<{ period: number }>

  if (closedPeriods.length > 0) {
    const labels = closedPeriods.map(row => `${row.period}月`).join('、')
    return {
      canEdit: false,
      reason: `${year}年已有 ${closedPeriods.length} 个期间已结账（${labels}），辅助期初不允许修改`,
    }
  }

  return { canEdit: true, reason: null }
}

export function assertInitBalanceAuxEditable(
  db: Database,
  accountSetId: string,
  year: number
): void {
  const check = checkInitBalanceAuxEditable(db, accountSetId, year)
  if (!check.canEdit) {
    throw new Error(check.reason || '当前年度辅助期初不允许修改')
  }
}

export function assertInitBalanceEditable(
  db: Database,
  accountSetId: string,
  year: number
): void {
  const check = checkInitBalanceEditable(db, accountSetId, year)
  if (!check.canEdit) {
    throw new Error(check.reason || '当前年度期初余额不允许修改')
  }
}

function buildAccountIdFilter(accountIds?: string[]) {
  if (!accountIds?.length) {
    return { sql: '', params: [] as string[] }
  }
  const placeholders = accountIds.map(() => '?').join(',')
  return {
    sql: ` AND account_id IN (${placeholders})`,
    params: accountIds,
  }
}

export function countInitBalanceClearTargets(
  db: Database,
  accountSetId: string,
  year: number,
  mode: InitBalanceClearMode,
  options?: { accountIds?: string[]; period?: number }
): number {
  const period = options?.period ?? 1
  const accountFilter = buildAccountIdFilter(options?.accountIds)
  const auxCond = mode === 'direct' ? `aux_item_id=''` : `aux_item_id!=''`
  const row = db
    .prepare(
      `SELECT COUNT(*) as count FROM init_balances
       WHERE account_set_id=? AND year=? AND period=? AND ${auxCond}${accountFilter.sql}`
    )
    .get(accountSetId, year, period, ...accountFilter.params) as { count: number }
  return row?.count || 0
}

export function clearDirectInitBalances(
  db: Database,
  accountSetId: string,
  year: number,
  options?: { accountIds?: string[]; period?: number }
): { deletedCount: number } {
  assertInitBalanceEditable(db, accountSetId, year)
  const period = options?.period ?? 1
  const accountFilter = buildAccountIdFilter(options?.accountIds)

  const run = db.transaction(() => {
    const result = db
      .prepare(
        `DELETE FROM init_balances
         WHERE account_set_id=? AND year=? AND period=? AND aux_item_id=''${accountFilter.sql}`
      )
      .run(accountSetId, year, period, ...accountFilter.params)
    return result.changes
  })

  return { deletedCount: run() }
}

function buildAuxCategoryMatchSql(categoryCode: string) {
  return `(aux_item_id LIKE ? OR aux_item_id LIKE ?)`
}

function buildAuxCategoryMatchParams(categoryCode: string) {
  return [`${categoryCode}:%`, `%|${categoryCode}:%`]
}

export type AuxInitClearScope = 'account' | 'category' | 'all_accounts'

export function countAuxInitClearTargets(
  db: Database,
  accountSetId: string,
  year: number,
  scope: AuxInitClearScope,
  options?: { accountId?: string; categoryCode?: string; period?: number }
): number {
  const period = options?.period ?? 1
  if (scope === 'account' && !options?.accountId) {
    throw new Error('缺少 account_id')
  }
  if (scope === 'category' && (!options?.accountId || !options?.categoryCode)) {
    throw new Error('缺少 account_id 或 category_code')
  }

  const params: unknown[] = [accountSetId, year, period]
  let extraSql = ''

  if (scope === 'account') {
    extraSql += ' AND account_id=?'
    params.push(options!.accountId!)
  } else if (scope === 'category') {
    extraSql += ' AND account_id=?'
    params.push(options!.accountId!)
    extraSql += ` AND ${buildAuxCategoryMatchSql(options!.categoryCode!)}`
    params.push(...buildAuxCategoryMatchParams(options!.categoryCode!))
  }

  const row = db
    .prepare(
      `SELECT COUNT(*) as count FROM init_balances
       WHERE account_set_id=? AND year=? AND period=? AND aux_item_id!=''${extraSql}`
    )
    .get(...params) as { count: number }
  return row?.count || 0
}

export function clearAuxInitBalances(
  db: Database,
  accountSetId: string,
  year: number,
  scope: AuxInitClearScope,
  options?: { accountId?: string; categoryCode?: string; period?: number }
): { deletedCount: number; affectedAccounts: number } {
  assertInitBalanceAuxEditable(db, accountSetId, year)
  const period = options?.period ?? 1

  if (scope === 'account' && !options?.accountId) {
    throw new Error('缺少 account_id')
  }
  if (scope === 'category' && (!options?.accountId || !options?.categoryCode)) {
    throw new Error('缺少 account_id 或 category_code')
  }

  const params: unknown[] = [accountSetId, year, period]
  let extraSql = ''

  if (scope === 'account') {
    extraSql += ' AND account_id=?'
    params.push(options!.accountId!)
  } else if (scope === 'category') {
    extraSql += ' AND account_id=?'
    params.push(options!.accountId!)
    extraSql += ` AND ${buildAuxCategoryMatchSql(options!.categoryCode!)}`
    params.push(...buildAuxCategoryMatchParams(options!.categoryCode!))
  }

  const affectedAccountRows = db
    .prepare(
      `SELECT DISTINCT account_id FROM init_balances
       WHERE account_set_id=? AND year=? AND period=? AND aux_item_id!=''${extraSql}`
    )
    .all(...params) as Array<{ account_id: string }>

  const run = db.transaction(() => {
    const result = db
      .prepare(
        `DELETE FROM init_balances
         WHERE account_set_id=? AND year=? AND period=? AND aux_item_id!=''${extraSql}`
      )
      .run(...params)

    for (const row of affectedAccountRows) {
      cleanupAccountSummaryAfterAuxClear(db, accountSetId, row.account_id, year, period)
    }

    return result.changes
  })

  return {
    deletedCount: run(),
    affectedAccounts: affectedAccountRows.length,
  }
}

function cleanupAccountSummaryAfterAuxClear(
  db: Database,
  accountSetId: string,
  accountId: string,
  year: number,
  period: number
) {
  const remaining = db
    .prepare(
      `SELECT COUNT(*) as count FROM init_balances
       WHERE account_set_id=? AND account_id=? AND year=? AND period=? AND aux_item_id!=''`
    )
    .get(accountSetId, accountId, year, period) as { count: number }

  if ((remaining?.count || 0) === 0) {
    db.prepare(
      `DELETE FROM init_balances
       WHERE account_set_id=? AND account_id=? AND year=? AND period=? AND aux_item_id=''`
    ).run(accountSetId, accountId, year, period)
    return
  }

  syncInitBalanceAuxSummary(db, accountSetId, accountId, year, period)
}
