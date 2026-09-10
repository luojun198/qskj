/**
 * 财务分析（科目分析）取数与派生列计算。
 * 后端返回每个科目 12 个月的借/贷发生额（已排除结转凭证），这里按「取数方式」切片并算比例、月均。
 */

export type SubjectAnalysisValueMode = 'balance' | 'debit' | 'credit'

export interface SubjectAnalysisMonth {
  debit: number
  credit: number
}

export interface SubjectAnalysisRow {
  account_id: string | number
  account_code: string
  account_name: string
  direction: 'debit' | 'credit' | string
  level: number
  is_leaf: boolean
  init_balance: number
  months: SubjectAnalysisMonth[]
  year_debit: number
  year_credit: number
  end_balance: number
}

export interface AnnualAnalysisRow {
  account_code: string
  account_name: string
  level: number
  /** 下标 0..11 对应 1..12 月 */
  months: number[]
  total: number
  average: number
  ratio: number
}

export interface MonthlyAnalysisRow {
  account_code: string
  account_name: string
  level: number
  current: number
  currentRatio: number
  ytd: number
  ytdRatio: number
}

/**
 * 把一行折算成 12 个月的数值。
 * - 借/贷方发生额：直接取当月发生额
 * - 余额：以期初为基数逐月累计，取各月末余额（按科目方向定加减）。
 *   费用类排除结转后不会归零，因此年初无余额时月末余额 = 累计发生额。
 */
export function monthlyValues(row: SubjectAnalysisRow, mode: SubjectAnalysisValueMode): number[] {
  const months = row.months || []
  if (mode === 'debit') return months.map(m => Number(m.debit) || 0)
  if (mode === 'credit') return months.map(m => Number(m.credit) || 0)
  const isCredit = row.direction === 'credit'
  let bal = Number(row.init_balance) || 0
  return months.map(m => {
    const d = Number(m.debit) || 0
    const c = Number(m.credit) || 0
    bal += isCredit ? c - d : d - c
    return bal
  })
}

/** 余额不可跨月相加：年度「合计」取 12 月末余额，累计取该月末余额 */
export function isBalanceMode(mode: SubjectAnalysisValueMode): boolean {
  return mode === 'balance'
}

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

function ratioOf(part: number, whole: number): number {
  if (!whole) return 0
  return round2((part / whole) * 100)
}

/**
 * 只保留最末级行参与合计，避免父子重复计数。
 * 被分析的根科目自身（若有下级）也会被过滤掉，与示范图一致。
 */
export function leafRows<T extends { is_leaf: boolean }>(rows: T[]): T[] {
  return rows.filter(r => r.is_leaf)
}

export function buildAnnualRows(
  rows: SubjectAnalysisRow[],
  mode: SubjectAnalysisValueMode
): { rows: AnnualAnalysisRow[]; totals: number[]; total: number; average: number } {
  const leaves = leafRows(rows)
  const totals = Array.from({ length: 12 }, () => 0)
  const balance = isBalanceMode(mode)
  const mapped = leaves.map(r => {
    const months = monthlyValues(r, mode).map((v, i) => {
      const rounded = round2(v)
      totals[i] += rounded
      return rounded
    })
    const total = round2(balance ? months[11] ?? 0 : months.reduce((s, v) => s + v, 0))
    return {
      account_code: r.account_code,
      account_name: r.account_name,
      level: r.level,
      months,
      total,
      average: round2(total / 12),
      ratio: 0,
    }
  })
  const roundedTotals = totals.map(round2)
  const total = round2(balance ? roundedTotals[11] ?? 0 : roundedTotals.reduce((s, v) => s + v, 0))
  for (const row of mapped) row.ratio = ratioOf(row.total, total)
  return {
    rows: mapped,
    totals: roundedTotals,
    total,
    average: round2(total / 12),
  }
}

export function buildMonthlyRows(
  rows: SubjectAnalysisRow[],
  period: number,
  mode: SubjectAnalysisValueMode
): { rows: MonthlyAnalysisRow[]; currentTotal: number; ytdTotal: number } {
  const p = Math.min(12, Math.max(1, Math.trunc(period)))
  const leaves = leafRows(rows)
  const balance = isBalanceMode(mode)
  const mapped = leaves
    .map(r => {
      const values = monthlyValues(r, mode)
      // 余额口径下「本月数」取当月净变动，「本年累计」取月末余额；发生额口径为当月与 1~N 月之和
      const prevBalance = p >= 2 ? values[p - 2] : Number(r.init_balance) || 0
      const current = round2(balance ? values[p - 1] - prevBalance : values[p - 1])
      const ytd = balance ? values[p - 1] : values.slice(0, p).reduce((s, v) => s + v, 0)
      return {
        account_code: r.account_code,
        account_name: r.account_name,
        level: r.level,
        current,
        currentRatio: 0,
        ytd: round2(ytd),
        ytdRatio: 0,
      }
    })
    // 示范图：无发生额的明细行不展示
    .filter(r => Math.abs(r.current) >= 0.005 || Math.abs(r.ytd) >= 0.005)
  const currentTotal = round2(mapped.reduce((s, r) => s + r.current, 0))
  const ytdTotal = round2(mapped.reduce((s, r) => s + r.ytd, 0))
  for (const row of mapped) {
    row.currentRatio = ratioOf(row.current, currentTotal)
    row.ytdRatio = ratioOf(row.ytd, ytdTotal)
  }
  return { rows: mapped, currentTotal, ytdTotal }
}
