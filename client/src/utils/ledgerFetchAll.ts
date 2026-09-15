/**
 * FIX-158：账簿导出 / 打印的全量拉取统一走分页循环。
 *
 * 此前 Detail / Chronological / CashJournal 各自写死单次 10000 条，超过即静默截断，
 * 「本年累计 / 期末」按截断分录计算直接错；AuxDetail 已有 while 循环，这里抽成共享函数。
 *
 * 结束条件：本页为空 / 本页不足一页 / 已达服务端 total（total 缺失时不提前 break）。
 */
export interface FetchAllPagesResult<T, R> {
  rows: T[]
  /** 第一页的完整响应（期初、账前发生额等只在首页返回） */
  first: R | null
  total: number
}

export async function fetchAllPages<T, R extends { data?: T[]; total?: number } = { data?: T[]; total?: number }>(
  fetchPage: (page: number, pageSize: number) => Promise<R>,
  options: {
    pageSize?: number
    onProgress?: (loaded: number, total: number) => void
    /** 每页之间让出主线程（大数据量时避免卡死界面） */
    yieldBetweenPages?: () => Promise<void>
    /** 安全上限，防止服务端 total 异常时无限循环 */
    maxPages?: number
  } = {}
): Promise<FetchAllPagesResult<T, R>> {
  const pageSize = options.pageSize ?? 10000
  const maxPages = options.maxPages ?? 1000
  const rows: T[] = []
  let first: R | null = null
  let total = 0
  for (let page = 1; page <= maxPages; page++) {
    const res = await fetchPage(page, pageSize)
    const batch = (res?.data || []) as T[]
    if (page === 1) {
      first = res
      total = Number(res?.total)
    }
    rows.push(...batch)
    const knownTotal = Number.isFinite(total) && total > 0 ? total : rows.length
    options.onProgress?.(rows.length, knownTotal)
    if (batch.length === 0 || batch.length < pageSize) break
    if (Number.isFinite(total) && total > 0 && rows.length >= total) break
    if (options.yieldBetweenPages) await options.yieldBetweenPages()
  }
  return { rows, first, total: Number.isFinite(total) && total > 0 ? total : rows.length }
}
