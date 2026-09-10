export type AccountDirection = 'debit' | 'credit'
export type EntryDirection = 'debit' | 'credit'

/** 有符号余额：借方科目 init + 借 - 贷；贷方科目 init + 贷 - 借 */
export function calcSignedBalance(
  accountDirection: AccountDirection,
  initBalance: number,
  totalDebit: number,
  totalCredit: number
): number {
  if (accountDirection === 'debit') {
    return initBalance + totalDebit - totalCredit
  }
  return initBalance + totalCredit - totalDebit
}

/** 单笔分录对有余方向的科目余额的增量 */
export function applyEntryToSignedBalance(
  balance: number,
  amount: number,
  entryDirection: EntryDirection,
  accountDirection: AccountDirection
): number {
  const isSameDirection = accountDirection === entryDirection
  return balance + (isSameDirection ? amount : -amount)
}

/** 从期初借贷方或已保存的有符号期初计算期初余额 */
export function calcInitBalanceFromDebitCredit(
  accountDirection: AccountDirection,
  initDebit: number,
  initCredit: number,
  signedInitBalance?: number | null
): number {
  if (signedInitBalance != null && Math.abs(signedInitBalance) > 0.005) {
    return signedInitBalance
  }
  if (initDebit !== 0 || initCredit !== 0) {
    return accountDirection === 'credit' ? initCredit - initDebit : initDebit - initCredit
  }
  return signedInitBalance ?? 0
}

/** SQL：按科目余额方向将分录金额转为有符号增量 */
/**
 * 「按科目方向签名」的 SQL 片段：贷方科目取 贷-借，借方科目取 借-贷。
 * 期初余额、账前发生额、辅助明细等多处都要这条规则，此前各自手写 CASE，
 * 改一处漏几处。新增用法一律走本函数，勿再内联 `CASE WHEN direction = 'credit'`。
 *
 * @param accountDirectionRef 科目方向列引用，如 'a.direction'
 * @param debitExpr  借方金额表达式（调用方自行包好 COALESCE / SUM）
 * @param creditExpr 贷方金额表达式
 */
export function buildDirectionSignedNetSql(
  accountDirectionRef: string,
  debitExpr: string,
  creditExpr: string
): string {
  return `CASE WHEN ${accountDirectionRef} = 'credit'
    THEN (${creditExpr}) - (${debitExpr})
    ELSE (${debitExpr}) - (${creditExpr})
  END`
}

export function buildSignedEntryAmountSql(
  accountDirectionRef: string,
  entryDirectionRef: string,
  amountRef: string
): string {
  return `CASE WHEN ${accountDirectionRef} = 'debit'
    THEN CASE WHEN ${entryDirectionRef} = 'debit' THEN ${amountRef} ELSE -${amountRef} END
    ELSE CASE WHEN ${entryDirectionRef} = 'credit' THEN ${amountRef} ELSE -${amountRef} END
  END`
}

/** 有符号余额对应的展示方向（借/贷列） */
export function resolveBalanceDisplayDirection(
  signedBalance: number,
  accountDirection: AccountDirection
): AccountDirection {
  if (Math.abs(signedBalance) < 0.005) return accountDirection
  if (signedBalance > 0) return accountDirection
  return accountDirection === 'debit' ? 'credit' : 'debit'
}
