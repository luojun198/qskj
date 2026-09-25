/**
 * 期初试算平衡（与期初录入页 leaf 节点口径一致）
 */

import { pickInitBalanceRows } from './initBalanceScope.js'

export interface InitBalanceTrialTotals {
  balanced: boolean
  totalDebit: number
  totalCredit: number
}

type InitBalanceRow = {
  opening_debit?: number | null
  opening_credit?: number | null
  pre_book_debit?: number | null
  pre_book_credit?: number | null
  init_debit?: number | null
  init_credit?: number | null
  aux_item_id?: string | null
}

function rowDebit(row: InitBalanceRow): number {
  const hasOpening =
    (row.opening_debit || 0) +
      (row.pre_book_debit || 0) +
      (row.opening_credit || 0) +
      (row.pre_book_credit || 0) !==
    0
  if (hasOpening) {
    return (row.opening_debit || 0) + (row.pre_book_debit || 0)
  }
  return row.init_debit || 0
}

function rowCredit(row: InitBalanceRow): number {
  const hasOpening =
    (row.opening_debit || 0) +
      (row.pre_book_debit || 0) +
      (row.opening_credit || 0) +
      (row.pre_book_credit || 0) !==
    0
  if (hasOpening) {
    return (row.opening_credit || 0) + (row.pre_book_credit || 0)
  }
  return row.init_credit || 0
}

/** 按末级科目汇总期初借贷（避免父科目重复累加；辅助科目取科目汇总行，见 initBalanceScope） */
export function getInitBalanceTrialTotals(
  db: { prepare: (sql: string) => any },
  accountSetId: string,
  year: number
): InitBalanceTrialTotals {
  // FIX-252：原实现先取全部末级科目再逐科目查 init_balances（923 科目 = 923 次查询，单次试算 15ms），
  // 而每张凭证过账都要跑一遍，是批量记账 17ms/张 的主要成本。改为一次取出该年度末级科目的全部期初行，
  // 在内存里按科目分组，口径（末级科目 + 汇总行优先）不变。
  const rows = db
    .prepare(
      `
      SELECT ib.account_id, ib.opening_debit, ib.opening_credit, ib.pre_book_debit, ib.pre_book_credit,
             ib.init_debit, ib.init_credit, ib.aux_item_id
      FROM init_balances ib
      JOIN accounts a ON a.id = ib.account_id
      WHERE ib.account_set_id = ? AND ib.year = ?
        AND a.account_set_id = ib.account_set_id
        AND NOT EXISTS (
          SELECT 1 FROM accounts c
          WHERE c.account_set_id = a.account_set_id AND c.parent_id = a.id
        )
    `
    )
    .all(accountSetId, year) as Array<InitBalanceRow & { account_id: string }>

  const byAccount = new Map<string, InitBalanceRow[]>()
  for (const row of rows) {
    const list = byAccount.get(row.account_id)
    if (list) list.push(row)
    else byAccount.set(row.account_id, [row])
  }

  let totalDebit = 0
  let totalCredit = 0

  for (const accountRows of byAccount.values()) {
    // FIX-104：与账簿/报表共用「汇总行优先」口径，多辅助类目不再成倍累加
    const rowsToSum = pickInitBalanceRows(accountRows)

    for (const row of rowsToSum) {
      totalDebit += rowDebit(row)
      totalCredit += rowCredit(row)
    }
  }

  return {
    balanced: Math.abs(totalDebit - totalCredit) < 0.01,
    totalDebit,
    totalCredit,
  }
}

/** 期初不平衡时的统一提示（单张/批量共用） */
export const INIT_BALANCE_UNBALANCED_ERROR = '年初不平，不允许记账'

export function isInitBalanceUnbalancedError(message: string): boolean {
  return (
    message === INIT_BALANCE_UNBALANCED_ERROR ||
    message.includes('年初不平') ||
    message.includes('期初借贷不平衡')
  )
}

/** 校验多个会计年度期初是否平衡，返回首个错误文案 */
export function validateInitBalanceBalancedForYears(
  db: Parameters<typeof getInitBalanceTrialTotals>[0],
  accountSetId: string,
  years: Iterable<number>
): string | null {
  for (const year of years) {
    const error = validateInitBalanceBalancedForPosting(db, accountSetId, year)
    if (error) return error
  }
  return null
}

/** 期初不平衡时返回错误文案，平衡则返回 null */
export function validateInitBalanceBalancedForPosting(
  db: Parameters<typeof getInitBalanceTrialTotals>[0],
  accountSetId: string,
  year: number
): string | null {
  const totals = getInitBalanceTrialTotals(db, accountSetId, year)
  if (totals.balanced) return null

  return INIT_BALANCE_UNBALANCED_ERROR
}
