/**
 * 宽松日期解析：手工录入日期时支持多种简写，统一成 YYYY-MM-DD。
 *
 * - 2026-10-01 / 2026/10/1 / 2026.10.1
 * - 20261001（8 位）
 * - 10-1 / 10/1 / 10.1 / 1001（4 位 MMDD）→ 参考年份
 * - 1 ~ 31（1-2 位，只有日）→ 参考年月
 *
 * 无法解析或不是真实日期时返回 null；空串返回 ''。
 */
export function parseLooseDate(input: string, ref: Date = new Date()): string | null {
  const s = String(input ?? '').trim()
  if (!s) return ''
  let y = ref.getFullYear()
  let m = ref.getMonth() + 1
  let d: number

  let match: RegExpMatchArray | null
  if ((match = s.match(/^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?$/))) {
    y = +match[1]
    m = +match[2]
    d = +match[3]
  } else if ((match = s.match(/^(\d{4})(\d{2})(\d{2})$/))) {
    y = +match[1]
    m = +match[2]
    d = +match[3]
  } else if ((match = s.match(/^(\d{1,2})[-/.月](\d{1,2})日?$/))) {
    m = +match[1]
    d = +match[2]
  } else if ((match = s.match(/^(\d{2})(\d{2})$/))) {
    m = +match[1]
    d = +match[2]
  } else if ((match = s.match(/^(\d{1,2})日?$/))) {
    d = +match[1]
  } else {
    return null
  }

  const dt = new Date(y, m - 1, d)
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null
  return formatYmd(dt)
}

export function formatYmd(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export type QuickDateKey = 'today' | 'week' | 'month' | 'lastMonth' | 'quarter' | 'year'

/** 快捷日期区间（结束日期统一到区间末日，便于查整月 / 整季 / 整年） */
export function quickDateRange(key: QuickDateKey, today: Date = new Date()): [string, string] {
  const y = today.getFullYear()
  const mo = today.getMonth()
  switch (key) {
    case 'today':
      return [formatYmd(today), formatYmd(today)]
    case 'week': {
      const day = today.getDay()
      const monday = new Date(y, mo, today.getDate() - (day === 0 ? 6 : day - 1))
      const sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6)
      return [formatYmd(monday), formatYmd(sunday)]
    }
    case 'month':
      return [formatYmd(new Date(y, mo, 1)), formatYmd(new Date(y, mo + 1, 0))]
    case 'lastMonth':
      return [formatYmd(new Date(y, mo - 1, 1)), formatYmd(new Date(y, mo, 0))]
    case 'quarter': {
      const qs = Math.floor(mo / 3) * 3
      return [formatYmd(new Date(y, qs, 1)), formatYmd(new Date(y, qs + 3, 0))]
    }
    case 'year':
      return [`${y}-01-01`, `${y}-12-31`]
  }
}
