/**
 * 折旧历史（/asset/depr/history）按期间分组，供「折旧计提」历史页签与「取消折旧」页共用。
 */

export interface DeprHistoryRow {
  year: number
  month: number
  month_depr: number
  voucher_no?: string | null
  /** 凭证状态：draft / audited / posted，未生成凭证时为空 */
  voucher_status?: string | null
  [key: string]: any
}

export interface DeprPeriodGroup {
  /** YYYY-MM */
  period: string
  year: number
  month: number
  count: number
  total: number
  voucherNo: string | null
  voucherStatus: string | null
}

export const VOUCHER_STATUS_LABELS: Record<string, string> = {
  draft: '草稿',
  audited: '已审核',
  posted: '已记账',
}

/** 按 year-month 分组，结果按期间倒序（最新期在前） */
export function groupDeprHistoryByPeriod(rows: DeprHistoryRow[]): DeprPeriodGroup[] {
  const map = new Map<string, DeprPeriodGroup>()
  for (const r of rows) {
    const key = `${r.year}-${String(r.month).padStart(2, '0')}`
    if (!map.has(key)) {
      map.set(key, { period: key, year: r.year, month: r.month, count: 0, total: 0, voucherNo: null, voucherStatus: null })
    }
    const g = map.get(key)!
    g.count++
    g.total += r.month_depr || 0
    if (r.voucher_no) {
      g.voucherNo = r.voucher_no
      g.voucherStatus = r.voucher_status || null
    }
  }
  for (const g of map.values()) g.total = Math.round(g.total * 100) / 100
  return [...map.values()].sort((a, b) => b.period.localeCompare(a.period))
}

/** 反折旧只能从最新期倒序撤销：返回该期不可反折旧的原因，可反时返回 null */
export function reverseBlockReason(group: DeprPeriodGroup, groups: DeprPeriodGroup[]): string | null {
  const latest = groups[0]
  if (latest && latest.period !== group.period) return `需先反折旧更晚期间 ${latest.period}`
  if (group.voucherStatus === 'posted') return '折旧凭证已记账，请先取消记账'
  return null
}
