import { formatAmount } from './format'

export function formatBalanceDirection(netBalance: number): string {
  if (Math.abs(netBalance) < 0.005) return '平'
  return netBalance > 0 ? '借' : '贷'
}

export function formatInitBalanceDirection(row: {
  init_balance: number
  direction: string
}): string {
  if (row.init_balance === 0) return ''
  if (row.init_balance > 0) return row.direction === 'debit' ? '借' : '贷'
  return row.direction === 'debit' ? '贷' : '借'
}

export function formatEndBalanceDirection(row: {
  end_balance: number
  direction: string
}): string {
  if (row.end_balance === 0) return ''
  if (row.end_balance > 0) return row.direction === 'debit' ? '借' : '贷'
  return row.direction === 'debit' ? '贷' : '借'
}

/** 金额保留两位小数（导出/计算用） */
export function roundAmount(value: number): number {
  return Math.round(value * 100) / 100
}

export function formatSignedBalanceAmount(
  balance: number,
  hideZero = false
): number | '' {
  if (balance === 0) return hideZero ? '' : 0
  return roundAmount(Math.abs(balance))
}

/** 带符号余额的界面展示（两位小数 + 千分位，取绝对值） */
export function formatSignedBalanceDisplay(
  balance: number | null | undefined,
  hideZero = false
): string {
  const raw = balance ?? 0
  if (raw === 0) return hideZero ? '' : formatAmount(0)
  return formatAmount(Math.abs(raw))
}

export function formatPositiveAmount(
  amount: number | null | undefined,
  hideZero = false
): number | '' {
  const value = amount || 0
  if (value <= 0) return hideZero ? '' : 0
  return roundAmount(value)
}

export function splitBalanceToDebitCredit(balance: number, direction: string) {
  const amount = Math.abs(balance || 0)
  const onDebitSide =
    balance === 0 ? direction === 'debit' : balance > 0 ? direction === 'debit' : direction !== 'debit'
  return onDebitSide ? { debit: amount, credit: 0 } : { debit: 0, credit: amount }
}

export function applyEntryToSignedBalance(
  balance: number,
  amount: number,
  entryDirection: 'debit' | 'credit',
  accountDirection: 'debit' | 'credit'
): number {
  const isSameDirection = accountDirection === entryDirection
  return balance + (isSameDirection ? amount : -amount)
}

export function sumBalanceSides(
  rows: Array<{ init_balance?: number; end_balance?: number; direction: string }>,
  field: 'init_balance' | 'end_balance'
) {
  return rows.reduce(
    (acc, row) => {
      const { debit, credit } = splitBalanceToDebitCredit(row[field] || 0, row.direction)
      acc.debit += debit
      acc.credit += credit
      return acc
    },
    { debit: 0, credit: 0 }
  )
}

/** 合计行应参与的科目：优先取一级科目（已含下级汇总），否则取当前数据集叶节点 */
export function getSummaryAccountRows<T extends { level: number; account_code: string }>(
  data: T[],
  _accountLevel?: number | null
): T[] {
  if (!data.length) return []
  const level1Rows = data.filter(row => row.level === 1)
  if (level1Rows.length > 0) return level1Rows
  return data.filter(
    row =>
      !data.some(
        r => r.account_code !== row.account_code && r.account_code.startsWith(row.account_code)
      )
  )
}

export function formatAmountForExport(value: number | string | null | undefined): number | '' {
  if (value === '' || value === null || value === undefined) return ''
  const num = typeof value === 'string' ? parseFloat(value) : value
  if (Number.isNaN(num)) return ''
  return num
}

export { formatAmount }
