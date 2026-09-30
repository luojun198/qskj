/**
 * 本地时区的日期工具。
 * 不要用 new Date().toISOString().slice(0, 10)：那是 UTC 日期，东八区 00:00~08:00 会得到昨天。
 */

/** 本地时区的日期（YYYY-MM-DD），缺省为今天 */
export function todayStr(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/**
 * xlsx（cellDates: true）读出的日期单元格 → YYYY-MM-DD。
 * SheetJS 在东八区会把 Excel 的 0 点日期读成「前一天 23:59:17」，加 12 小时再取本地日期抵消偏移。
 */
export function excelDateToYmd(d: Date): string {
  return todayStr(new Date(d.getTime() + 12 * 3600 * 1000))
}
