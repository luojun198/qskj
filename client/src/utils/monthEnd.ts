/**
 * 「YYYY-MM」→ 该月最后一天「YYYY-MM-DD」。
 * 评审 P2：账簿小计行原先一律拼「-31」，2 月 / 小月出现 2026-02-31 这类不存在的日期，导出与排序都会出错。
 */
export function monthEndDate(ym: string): string {
  const m = /^(\d{4})-(\d{1,2})/.exec(String(ym || ''))
  if (!m) return `${ym}-31`
  const y = Number(m[1])
  const mo = Number(m[2])
  const last = new Date(y, mo, 0).getDate()
  return `${m[1]}-${String(mo).padStart(2, '0')}-${String(last).padStart(2, '0')}`
}
