/**
 * 期初试算平衡（与期初录入页 leaf 节点口径一致）
 */

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

/** 按末级科目汇总期初借贷（避免父科目重复累加；辅助科目只计 aux 明细行） */
export function getInitBalanceTrialTotals(
  db: {
    prepare: (sql: string) => {
      all: (...args: unknown[]) => Array<{ id: string } | InitBalanceRow>
    }
  },
  accountSetId: string,
  year: number
): InitBalanceTrialTotals {
  const leafAccounts = db
    .prepare(
      `
      SELECT a.id
      FROM accounts a
      WHERE a.account_set_id = ?
        AND NOT EXISTS (
          SELECT 1 FROM accounts c
          WHERE c.account_set_id = a.account_set_id AND c.parent_id = a.id
        )
    `
    )
    .all(accountSetId) as Array<{ id: string }>

  const loadRows = db.prepare(
    `
    SELECT opening_debit, opening_credit, pre_book_debit, pre_book_credit,
           init_debit, init_credit, aux_item_id
    FROM init_balances
    WHERE account_set_id = ? AND account_id = ? AND year = ?
  `
  )

  let totalDebit = 0
  let totalCredit = 0

  for (const { id: accountId } of leafAccounts) {
    const rows = loadRows.all(accountSetId, accountId, year) as InitBalanceRow[]
    if (rows.length === 0) continue

    const auxRows = rows.filter(r => r.aux_item_id)
    const rowsToSum = auxRows.length > 0 ? auxRows : rows.filter(r => !r.aux_item_id)

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
