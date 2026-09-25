import type Database from 'better-sqlite3'
import { buildChronologicalQuery } from './ledgerQuery.js'
import type { AccountScopeContext } from './accountAuthorization.js'

/**
 * FIX-254（十万级压测 P1-2 / P1-3）：「参数模式」导出的数据源。
 *
 * 旧链路：前端分页循环把 24 万行拉到浏览器（每页服务端重新排序 4s × 25 页 = 45s）→ 变换 → 解析成单元格矩阵
 * → 再 POST 回服务端生成 xlsx，浏览器 JS 堆冲到 3GB。
 * 参数模式：前端只提交筛选参数 + 列定义（每列带 `key`），服务端一次查询、逐行映射、流式写 xlsx，
 * 浏览器全程不持有数据。每个数据源声明自己支持的列 key；未知 key 直接 400，避免静默空列。
 */

export type ExportCellValue = string | number | null

export interface ExportSourceContext {
  db: Database.Database
  accountSetId: string
  accountScope?: AccountScopeContext
}

export interface ExportSource {
  /** 支持的列 key */
  keys: readonly string[]
  /** 行数（用于上限保护），可比实际输出行少（不含小计行） */
  count(ctx: ExportSourceContext, params: Record<string, unknown>): number
  /** 按 keys 顺序产出单元格行 */
  rows(
    ctx: ExportSourceContext,
    params: Record<string, unknown>,
    keys: string[]
  ): AsyncIterable<ExportCellValue[]>
}

function flag(raw: unknown): boolean {
  return raw === true || raw === 1 || raw === 'true' || raw === '1'
}

function str(raw: unknown): string | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined
  return String(raw)
}

/** 每映射这么多行让出一次事件循环（与 xlsx 写入侧的让出叠加） */
const YIELD_EVERY_ROWS = 5000

/** 序时账：与 client/src/views/ledger/Chronological.vue 的导出列及月合计口径一致 */
const CHRONOLOGICAL_KEYS = [
  'voucher_date',
  'voucher_type_name',
  'voucher_no',
  'account_code',
  'account_name',
  'summary',
  'debit',
  'credit',
  'maker_name',
] as const

function buildChronologicalFilters(ctx: ExportSourceContext, params: Record<string, unknown>) {
  return {
    accountSetId: ctx.accountSetId,
    year: str(params.year),
    period: str(params.period),
    startDate: str(params.start_date),
    endDate: str(params.end_date),
    includeUnposted: flag(params.include_unposted),
    summaryKeyword: str(params.summary_keyword),
    minAmount: str(params.min_amount),
    maxAmount: str(params.max_amount),
    makerName: str(params.maker_name),
    auditorName: str(params.auditor_name),
    accountScope: ctx.accountScope,
    selectColumns: 've.account_code, ve.account_name, ve.summary, ve.direction, ve.amount',
    page: 1,
    // 一次取全：LIMIT 只是占位，上限由 count() + MAX_EXPORT_ROWS 把关
    pageSize: 1_000_000,
  }
}

function mapChronologicalRow(row: any, keys: string[]): ExportCellValue[] {
  return keys.map(key => {
    switch (key) {
      case 'debit':
        if (row.is_monthly_subtotal) return row.monthly_debit
        return row.direction === 'debit' ? row.amount : ''
      case 'credit':
        if (row.is_monthly_subtotal) return row.monthly_credit
        return row.direction === 'credit' ? row.amount : ''
      default:
        return row[key] ?? ''
    }
  })
}

const chronologicalSource: ExportSource = {
  keys: CHRONOLOGICAL_KEYS,
  count(ctx, params) {
    const q = buildChronologicalQuery(buildChronologicalFilters(ctx, params))
    return Number((ctx.db.prepare(q.countSql).get(...q.countParams) as any)?.count) || 0
  },
  async *rows(ctx, params, keys) {
    const filters = buildChronologicalFilters(ctx, params)
    // 按月分批取数：排序键以 voucher_date 开头，逐月取与一次取全顺序一致，但同时只驻留一个月的行
    // （24 万行一次 .all() 实测 RSS 700MB+、同步阻塞 3s）。不用 iterate() 游标，因为 better-sqlite3
    // 游标未关闭期间同一连接不能执行其他语句，让出事件循环就没有意义。
    const windows = resolveMonthlyWindows(ctx, filters)
    let currentMonth = ''
    let monthlyDebit = 0
    let monthlyCredit = 0
    let n = 0
    const subtotalRow = (month: string) => ({
      voucher_date: `${month}-31`,
      voucher_type_name: '',
      voucher_no: '',
      account_code: '',
      account_name: '',
      summary: '本月合计',
      maker_name: '',
      is_monthly_subtotal: true,
      monthly_debit: monthlyDebit,
      monthly_credit: monthlyCredit,
    })
    for (const dateWindow of windows) {
      const q = buildChronologicalQuery({ ...filters, dateWindow })
      const entries = ctx.db.prepare(q.listSql).all(...q.listParams) as any[]
      for (const entry of entries) {
        const month = String(entry.voucher_date || '').slice(0, 7)
        if (currentMonth && month !== currentMonth) {
          yield mapChronologicalRow(subtotalRow(currentMonth), keys)
          monthlyDebit = 0
          monthlyCredit = 0
        }
        if (entry.direction === 'debit') monthlyDebit += entry.amount
        else if (entry.direction === 'credit') monthlyCredit += entry.amount
        currentMonth = month
        yield mapChronologicalRow(entry, keys)
        n += 1
        if (n % YIELD_EVERY_ROWS === 0) await new Promise<void>(resolve => setImmediate(resolve))
      }
      await new Promise<void>(resolve => setImmediate(resolve))
    }
    if (currentMonth) yield mapChronologicalRow(subtotalRow(currentMonth), keys)
  },
}

/** 把筛选条件对应的整体日期范围切成逐月窗口（含首尾不完整月） */
function resolveMonthlyWindows(
  ctx: ExportSourceContext,
  filters: ReturnType<typeof buildChronologicalFilters>
): { from: string; to: string }[] {
  let from = filters.startDate
  let to = filters.endDate
  if (!from && !to) {
    const y = Number(filters.year)
    const p = Number(filters.period)
    if (y && p) {
      from = `${y}-${String(p).padStart(2, '0')}-01`
      to = `${y}-${String(p).padStart(2, '0')}-31`
    } else if (y) {
      from = `${y}-01-01`
      to = `${y}-12-31`
    }
  }
  if (!from || !to) {
    // 开区间：用账套凭证的实际首末日期补齐
    const bounds = ctx.db
      .prepare('SELECT MIN(voucher_date) a, MAX(voucher_date) b FROM vouchers WHERE account_set_id = ?')
      .get(ctx.accountSetId) as { a?: string; b?: string } | undefined
    from = from || bounds?.a || '1900-01-01'
    to = to || bounds?.b || '2999-12-31'
  }
  const windows: { from: string; to: string }[] = []
  let cursor = from
  while (cursor <= to) {
    const [y, m] = cursor.split('-').map(Number)
    const monthEnd = `${y}-${String(m).padStart(2, '0')}-31`
    windows.push({ from: cursor, to: monthEnd < to ? monthEnd : to })
    const ny = m === 12 ? y + 1 : y
    const nm = m === 12 ? 1 : m + 1
    cursor = `${ny}-${String(nm).padStart(2, '0')}-01`
  }
  return windows
}

export const EXPORT_SOURCES: Record<string, ExportSource> = {
  chronological: chronologicalSource,
}
