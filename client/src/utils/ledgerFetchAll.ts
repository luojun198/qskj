/**
 * FIX-158：账簿导出 / 打印的全量拉取统一走分页循环。
 *
 * 此前 Detail / Chronological / CashJournal 各自写死单次 10000 条，超过即静默截断，
 * 「本年累计 / 期末」按截断分录计算直接错；AuxDetail 已有 while 循环，这里抽成共享函数。
 *
 * 结束条件：本页为空 / 本页不足一页 / 已达服务端 total（total 缺失时不提前 break）。
 *
 * FIX-251（十万级压测）：新增两道保护——
 *  - `largeTotal`：首页拿到 total 后超过阈值先回调确认（页面弹「数据量过大」），拒绝则抛 FetchAllPagesAborted；
 *  - `maxRows`：硬上限（默认 50 万），超过直接抛错，避免浏览器 JS 堆打满崩页。
 */
export interface FetchAllPagesResult<T, R> {
  rows: T[]
  /** 第一页的完整响应（期初、账前发生额等只在首页返回） */
  first: R | null
  total: number
}

/** 用户在「数据量过大」确认框里选择取消时抛出，调用方据此静默返回而不报错 */
export class FetchAllPagesAborted extends Error {
  constructor(public readonly total: number) {
    super(`已取消拉取 ${total} 行数据`)
    this.name = 'FetchAllPagesAborted'
  }
}

export const FETCH_ALL_DEFAULT_MAX_ROWS = 500000

export async function fetchAllPages<T, R extends { data?: T[]; total?: number } = { data?: T[]; total?: number }>(
  fetchPage: (page: number, pageSize: number) => Promise<R>,
  options: {
    pageSize?: number
    onProgress?: (loaded: number, total: number) => void
    /** 每页之间让出主线程（大数据量时避免卡死界面） */
    yieldBetweenPages?: () => Promise<void>
    /** 安全上限，防止服务端 total 异常时无限循环 */
    maxPages?: number
    /** 首页 total 超过 threshold 时回调确认；返回 false 中止 */
    largeTotal?: { threshold: number; confirm: (total: number) => Promise<boolean> }
    /** 行数硬上限，超过直接抛错 */
    maxRows?: number
  } = {}
): Promise<FetchAllPagesResult<T, R>> {
  const pageSize = options.pageSize ?? 10000
  const maxPages = options.maxPages ?? 1000
  const maxRows = options.maxRows ?? FETCH_ALL_DEFAULT_MAX_ROWS
  const rows: T[] = []
  let first: R | null = null
  let total = 0
  for (let page = 1; page <= maxPages; page++) {
    const res = await fetchPage(page, pageSize)
    const batch = (res?.data || []) as T[]
    if (page === 1) {
      first = res
      total = Number(res?.total)
      if (Number.isFinite(total) && total > maxRows) {
        throw new Error(`数据量 ${total.toLocaleString()} 行超过上限 ${maxRows.toLocaleString()} 行，请缩小科目 / 日期范围后再查询或导出`)
      }
      if (options.largeTotal && Number.isFinite(total) && total > options.largeTotal.threshold) {
        if (!(await options.largeTotal.confirm(total))) throw new FetchAllPagesAborted(total)
      }
    }
    rows.push(...batch)
    if (rows.length > maxRows) {
      throw new Error(`数据量超过上限 ${maxRows.toLocaleString()} 行，请缩小科目 / 日期范围后再查询或导出`)
    }
    const knownTotal = Number.isFinite(total) && total > 0 ? total : rows.length
    options.onProgress?.(rows.length, knownTotal)
    if (batch.length === 0 || batch.length < pageSize) break
    if (Number.isFinite(total) && total > 0 && rows.length >= total) break
    if (options.yieldBetweenPages) await options.yieldBetweenPages()
  }
  return { rows, first, total: Number.isFinite(total) && total > 0 ? total : rows.length }
}
