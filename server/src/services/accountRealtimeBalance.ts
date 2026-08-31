import type Database from 'better-sqlite3'
import {
  buildAuxVoucherEntryFilter,
  lookupAuxItemCode,
} from '../utils/auxLedgerQuery.js'
import {
  calcInitBalanceFromDebitCredit,
  calcSignedBalance,
  resolveBalanceDisplayDirection,
} from '../utils/accountBalance.js'

export interface RealtimeBalanceResult {
  init_balance: number
  current_debit: number
  current_credit: number
  end_balance: number
  direction: 'debit' | 'credit' | null
}

export interface RealtimeAuxBalanceItem {
  category_code: string
  item_id: string
  item_name: string
  init_balance: number
  current_debit: number
  current_credit: number
  end_balance: number
  direction: 'debit' | 'credit'
  is_same_side: boolean
}

function formatBalanceResult(
  accountDirection: 'debit' | 'credit',
  initBalance: number,
  totalDebit: number,
  totalCredit: number
): RealtimeBalanceResult {
  const endBalance = calcSignedBalance(accountDirection, initBalance, totalDebit, totalCredit)
  return {
    init_balance: initBalance,
    current_debit: totalDebit,
    current_credit: totalCredit,
    end_balance: endBalance,
    direction: accountDirection,
  }
}

function voucherExcludeClause(excludeVoucherId?: string) {
  return excludeVoucherId ? ' AND ve.voucher_id != ?' : ''
}

/** 科目总账实时余额（不含辅助维度） */
export function getAccountRealtimeBalance(
  db: Database.Database,
  params: {
    accountId: string
    accountSetId: string
    year: number
    period: number
    /** 修改凭证时排除本张凭证的旧分录 */
    excludeVoucherId?: string
  }
): RealtimeBalanceResult | null {
  const acc = db.prepare('SELECT direction FROM accounts WHERE id=?').get(params.accountId) as
    | { direction: 'debit' | 'credit' }
    | undefined
  if (!acc) return null

  const initBal = db
    .prepare(
      `SELECT COALESCE(SUM(init_balance), 0) as init_balance
       FROM init_balances
       WHERE account_id=? AND year=? AND account_set_id=? AND (aux_item_id IS NULL OR aux_item_id='')`
    )
    .get(params.accountId, params.year, params.accountSetId) as { init_balance: number }

  const voucherExclude = voucherExcludeClause(params.excludeVoucherId)
  const debitCreditParams: (string | number)[] = [
    params.accountId,
    params.accountSetId,
    params.year,
    params.period,
  ]
  if (params.excludeVoucherId) debitCreditParams.push(params.excludeVoucherId)

  const debitCredit = db
    .prepare(
      `SELECT
        COALESCE(SUM(CASE WHEN ve.direction='debit' THEN ve.amount ELSE 0 END), 0) as total_debit,
        COALESCE(SUM(CASE WHEN ve.direction='credit' THEN ve.amount ELSE 0 END), 0) as total_credit
       FROM voucher_entries ve
       JOIN vouchers v ON v.id = ve.voucher_id
       WHERE ve.account_id=? AND ve.account_set_id=? AND v.year=? AND v.period<=?${voucherExclude}`
    )
    .get(...debitCreditParams) as {
    total_debit: number
    total_credit: number
  }

  return formatBalanceResult(
    acc.direction,
    initBal?.init_balance || 0,
    debitCredit?.total_debit || 0,
    debitCredit?.total_credit || 0
  )
}

/** 单辅助类目 + 项目的实时余额 */
export function getAccountRealtimeAuxBalance(
  db: Database.Database,
  params: {
    accountId: string
    accountSetId: string
    year: number
    period: number
    categoryCode: string
    itemId: string
    accountDirection: 'debit' | 'credit'
    excludeVoucherId?: string
  }
): RealtimeAuxBalanceItem {
  const auxItemId = `${params.categoryCode}:${params.itemId}`
  const itemCode =
    params.categoryCode === 'cash_flow'
      ? lookupAuxItemCode(db, params.accountSetId, params.itemId)
      : null
  const entryFilter = buildAuxVoucherEntryFilter(params.categoryCode, params.itemId, itemCode)

  const initBal = db
    .prepare(
      `SELECT
        COALESCE(SUM(init_balance), 0) as init_balance,
        COALESCE(SUM(init_debit), 0) as init_debit,
        COALESCE(SUM(init_credit), 0) as init_credit
       FROM init_balances
       WHERE account_id=? AND year=? AND account_set_id=? AND aux_item_id=?`
    )
    .get(params.accountId, params.year, params.accountSetId, auxItemId) as {
    init_balance: number
    init_debit: number
    init_credit: number
  }

  const voucherExclude = voucherExcludeClause(params.excludeVoucherId)
  const debitCreditParams: (string | number)[] = [
    params.accountId,
    params.accountSetId,
    params.year,
    params.period,
    ...entryFilter.params,
  ]
  if (params.excludeVoucherId) debitCreditParams.push(params.excludeVoucherId)

  const debitCredit = db
    .prepare(
      `SELECT
        COALESCE(SUM(CASE WHEN ve.direction='debit' THEN ve.amount ELSE 0 END), 0) as total_debit,
        COALESCE(SUM(CASE WHEN ve.direction='credit' THEN ve.amount ELSE 0 END), 0) as total_credit
       FROM voucher_entries ve
       JOIN vouchers v ON v.id = ve.voucher_id
       WHERE ve.account_id=? AND ve.account_set_id=? AND v.year=? AND v.period<=?
         AND ${entryFilter.sql}${voucherExclude}`
    )
    .get(...debitCreditParams) as { total_debit: number; total_credit: number }

  const initBalance = calcInitBalanceFromDebitCredit(
    params.accountDirection,
    initBal?.init_debit || 0,
    initBal?.init_credit || 0,
    initBal?.init_balance || 0
  )
  const totalDebit = debitCredit?.total_debit || 0
  const totalCredit = debitCredit?.total_credit || 0
  const endBalance = calcSignedBalance(params.accountDirection, initBalance, totalDebit, totalCredit)
  const balanceDirection = resolveBalanceDisplayDirection(endBalance, params.accountDirection)

  return {
    category_code: params.categoryCode,
    item_id: params.itemId,
    item_name: '',
    init_balance: initBalance,
    current_debit: totalDebit,
    current_credit: totalCredit,
    end_balance: endBalance,
    direction: balanceDirection,
    is_same_side: balanceDirection === params.accountDirection,
  }
}

/** 解析 selections 查询参数：dept:id1,project:id2 */
export function parseAuxBalanceSelections(raw: string | undefined): { categoryCode: string; itemId: string }[] {
  if (!raw || !raw.trim()) return []
  return raw
    .split(',')
    .map(part => part.trim())
    .filter(Boolean)
    .map(part => {
      const idx = part.indexOf(':')
      if (idx <= 0) return null
      return { categoryCode: part.slice(0, idx), itemId: part.slice(idx + 1) }
    })
    .filter((x): x is { categoryCode: string; itemId: string } => x !== null)
}
