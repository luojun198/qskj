/**
 * 折旧查询（/asset/depr/query）表格行：逐条明细 + 每月「小计」+ 跨月时末尾「合计」。
 * 参照润衡「折旧查询」：单月只在末尾显示一行小计。
 */
import type { DeprQueryRow } from '@/api/fixedAsset'

export type DeprQueryDisplayRow =
  | (DeprQueryRow & { kind: 'data'; seq: number; label?: undefined })
  | (Partial<DeprQueryRow> & { kind: 'subtotal' | 'total'; seq?: undefined; label: string; month_depr: number })

const round2 = (n: number) => Math.round(n * 100) / 100

export function buildDeprQueryDisplayRows(rows: DeprQueryRow[]): DeprQueryDisplayRow[] {
  const out: DeprQueryDisplayRow[] = []
  let seq = 0
  let total = 0
  let monthSum = 0
  let monthWorkload = 0
  let hasWorkload = false
  let months = 0
  let cur: string | null = null

  const flush = () => {
    if (cur === null) return
    out.push({
      kind: 'subtotal',
      label: '小计',
      month_depr: round2(monthSum),
      month_workload: hasWorkload ? round2(monthWorkload) : null,
    })
    months++
  }

  for (const r of rows) {
    const key = `${r.year}-${r.month}`
    if (key !== cur) {
      flush()
      cur = key
      monthSum = 0
      monthWorkload = 0
      hasWorkload = false
    }
    seq++
    const depr = Number(r.month_depr) || 0
    monthSum += depr
    total += depr
    if (r.month_workload != null) {
      monthWorkload += Number(r.month_workload) || 0
      hasWorkload = true
    }
    out.push({ ...r, kind: 'data', seq })
  }
  flush()
  if (months > 1) out.push({ kind: 'total', label: '合计', month_depr: round2(total) })
  return out
}
