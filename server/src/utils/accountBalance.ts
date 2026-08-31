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
