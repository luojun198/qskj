import type { Database } from 'better-sqlite3'
import { appendAccountScopeCondition, type AccountScopeContext } from './accountAuthorization.js'
import type { BalanceQueryDb } from './reportBalance.js'

/**
 * 按现金流量项目编码汇总已过账分录金额（@xj_je 口径）
 * 返回非负绝对值，流向由 cash_flow_items.direction 决定符号
 */
export function getCashFlowAmount(
  db: BalanceQueryDb | Database,
  accountSetId: string,
  cashFlowCode: string,
  year: number,
  fromPeriod: number,
  toPeriod: number,
  accountScope?: AccountScopeContext
): number {
  const conditions = [
    'v.account_set_id = ?',
    'v.year = ?',
    'v.period >= ?',
    'v.period <= ?',
    "v.status = 'posted'",
    've.cash_flow_code = ?',
  ]
  const params: Array<string | number> = [
    accountSetId,
    year,
    fromPeriod,
    toPeriod,
    cashFlowCode,
  ]
  appendAccountScopeCondition(accountScope, 've.account_id', conditions, params)

  const rows = db
    .prepare(
      `
      SELECT ve.direction, SUM(ve.amount) as amount
      FROM voucher_entries ve
      JOIN vouchers v ON v.id = ve.voucher_id
      WHERE ${conditions.join(' AND ')}
      GROUP BY ve.direction
      `
    )
    .all(...params) as Array<{
    direction: 'debit' | 'credit'
    amount: number | null
  }>

  const item = db
    .prepare(
      `SELECT direction FROM cash_flow_items WHERE account_set_id = ? AND code = ? LIMIT 1`
    )
    .get(accountSetId, cashFlowCode) as { direction?: string } | undefined

  const debit = rows
    .filter(row => row.direction === 'debit')
    .reduce((sum, row) => sum + Number(row.amount || 0), 0)
  const credit = rows
    .filter(row => row.direction === 'credit')
    .reduce((sum, row) => sum + Number(row.amount || 0), 0)

  if (item?.direction === 'outflow') {
    return Math.abs(debit - credit)
  }
  if (item?.direction === 'inflow') {
    return Math.abs(credit - debit)
  }
  return Math.abs(debit - credit)
}

/** 带符号净额：流入为正、流出为负（用于三大活动合计） */
export function getSignedCashFlowAmount(
  db: BalanceQueryDb | Database,
  accountSetId: string,
  cashFlowCode: string,
  year: number,
  fromPeriod: number,
  toPeriod: number,
  accountScope?: AccountScopeContext
): number {
  const magnitude = getCashFlowAmount(
    db,
    accountSetId,
    cashFlowCode,
    year,
    fromPeriod,
    toPeriod,
    accountScope
  )
  if (magnitude < 0.0001) return 0

  const item = db
    .prepare(
      `SELECT direction FROM cash_flow_items WHERE account_set_id = ? AND code = ? LIMIT 1`
    )
    .get(accountSetId, cashFlowCode) as { direction?: string } | undefined

  if (item?.direction === 'outflow') return -magnitude
  if (item?.direction === 'inflow') return magnitude
  return magnitude
}

export type DirectMethodActivityTotals = {
  operating: number
  investing: number
  financing: number
  net: number
  itemCount: number
  itemsWithData: number
}

/** 直接法：按现金流量项目编码段（1/2/3）汇总当期净额 */
export function getDirectMethodActivityTotals(
  db: BalanceQueryDb | Database,
  accountSetId: string,
  year: number,
  fromPeriod: number,
  toPeriod: number,
  accountScope?: AccountScopeContext
): DirectMethodActivityTotals {
  const items = db
    .prepare(
      `SELECT code FROM cash_flow_items WHERE account_set_id = ? AND is_active = 1 ORDER BY code`
    )
    .all(accountSetId) as Array<{ code: string }>

  let operating = 0
  let investing = 0
  let financing = 0
  let itemsWithData = 0

  for (const { code } of items) {
    const signed = getSignedCashFlowAmount(
      db,
      accountSetId,
      code,
      year,
      fromPeriod,
      toPeriod,
      accountScope
    )
    if (Math.abs(signed) < 0.0001) continue
    itemsWithData++
    const segment = code.trim().charAt(0)
    if (segment === '1') operating += signed
    else if (segment === '2') investing += signed
    else if (segment === '3') financing += signed
  }

  return {
    operating,
    investing,
    financing,
    net: operating + investing + financing,
    itemCount: items.length,
    itemsWithData,
  }
}
