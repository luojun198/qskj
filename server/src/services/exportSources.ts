import type Database from 'better-sqlite3'
import { buildChronologicalQuery } from './ledgerQuery.js'
import { enrichJournalRows, listJournal } from './cashierQuery.js'
import { buildJournalWhere, getBalanceReport, getSummaryReport, hasJournalDetailFilter, parseReportFilterParams, searchJournalsReport, type SummaryNode } from './cashierReport.js'
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
  /**
   * FIX-326：导出所需权限码（任一即可）。参数模式导出走 /export/styled-xlsx，此前只校验登录，
   * 绕过了对应查询接口的权限码（如序时账要求 ledger:detail）。
   */
  permissions: readonly string[]
  /** 支持的列 key */
  keys: readonly string[]
  /** 支持的动态列 key 前缀（如辅助类别列 `aux:<类别id>`）；不在 keys 里的列 key 必须以其中之一开头才放行 */
  keyPrefixes?: readonly string[]
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
  permissions: ['ledger:detail'],
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

// ── 出纳日记账（FIX-326） ─────────────────────────────────
/**
 * 日记账接口改为强制分页后，页面「导出」不再拉全量到浏览器（25 万行时单次响应 170MB / 10s / 服务内存 ~1GB，
 * 并发时撑爆进程）。服务端按业务日期逐天取数（每批只排序当天流水），逐行累计余额，流式写 xlsx。
 */
const CASHIER_JOURNAL_KEYS = [
  'biz_date', 'seq', 'summary', 'settle_type', 'bill_no', 'counter_unit', 'counter_account',
  'debit', 'credit', 'balance', 'exchange_rate', 'base_debit', 'base_credit', 'reconciled', 'voucher',
] as const

function cashierJournalFilters(ctx: ExportSourceContext, params: Record<string, unknown>) {
  const accountCode = str(params.account_code)
  if (!accountCode) throw new Error('缺少出纳科目')
  return {
    accountCode, currency: str(params.currency), startDate: str(params.start_date), endDate: str(params.end_date),
    // 表头明细筛选（与页面 /cashier/journal 同一份参数解析）
    detail: parseReportFilterParams(params, ctx.accountSetId, ctx.accountScope),
  }
}

/** 命中表头明细筛选的流水 id（只在带筛选时计算）；导出仍逐行累计完整流水的余额，只输出命中行 */
function cashierJournalMatchingIds(
  ctx: ExportSourceContext,
  f: ReturnType<typeof cashierJournalFilters>,
  currency: string
): Set<string> | null {
  if (!hasJournalDetailFilter(f.detail)) return null
  const where = buildJournalWhere(
    ctx.db,
    { ...f.detail, accountSetId: ctx.accountSetId, accountCodes: undefined, currency: undefined },
    { skipDate: true, skipCurrency: true }
  )
  const join = where.needVoucherJoin ? 'LEFT JOIN vouchers v ON v.id = j.voucher_id' : ''
  const dateSql = `${f.startDate ? ' AND j.biz_date >= ?' : ''}${f.endDate ? ' AND j.biz_date <= ?' : ''}`
  const rows = ctx.db.prepare(
    `SELECT j.id FROM cashier_journal j ${join}
     WHERE j.account_code = ? AND j.currency = ?${dateSql} AND ${where.conds.join(' AND ')}`
  ).all(f.accountCode, currency, ...(f.startDate ? [f.startDate] : []), ...(f.endDate ? [f.endDate] : []), ...where.params) as Array<{ id: string }>
  return new Set(rows.map(r => r.id))
}

const cashierJournalSource: ExportSource = {
  permissions: ['cashier:journal'],
  keys: CASHIER_JOURNAL_KEYS,
  keyPrefixes: ['aux:'],
  count(ctx, params) {
    const f = cashierJournalFilters(ctx, params)
    const r = listJournalPage(ctx, f, 1, 1)
    return cashierJournalMatchingIds(ctx, f, r.currency)?.size ?? r.total
  },
  async *rows(ctx, params, keys) {
    const f = cashierJournalFilters(ctx, params)
    const first = listJournalPage(ctx, f, 1, 1)
    const currency = first.currency
    const matching = cashierJournalMatchingIds(ctx, f, currency)
    let running = first.opening
    const settleNames = new Map(
      (ctx.db.prepare('SELECT code, name FROM settle_type WHERE account_set_id = ?').all(ctx.accountSetId) as any[]).map(r => [r.code, r.name])
    )
    const accNames = new Map(
      (ctx.db.prepare('SELECT code, name FROM accounts WHERE account_set_id = ?').all(ctx.accountSetId) as any[]).map(r => [r.code, r.name])
    )
    const conds = ['account_set_id = ?', 'account_code = ?', 'currency = ?']
    const base: unknown[] = [ctx.accountSetId, f.accountCode, currency]
    if (f.startDate) { conds.push('biz_date >= ?'); base.push(f.startDate) }
    if (f.endDate) { conds.push('biz_date <= ?'); base.push(f.endDate) }
    const days = ctx.db
      .prepare(`SELECT DISTINCT biz_date d FROM cashier_journal WHERE ${conds.join(' AND ')} ORDER BY biz_date`)
      .all(...base) as Array<{ d: string }>
    const dayStmt = ctx.db.prepare(
      'SELECT * FROM cashier_journal WHERE account_set_id = ? AND account_code = ? AND currency = ? AND biz_date = ? ORDER BY seq, created_at'
    )
    let n = 0
    for (const { d } of days) {
      const dayRows = dayStmt.all(ctx.accountSetId, f.accountCode, currency, d) as any[]
      enrichJournalRows(ctx.db, ctx.accountSetId, dayRows)
      for (const r of dayRows) {
        running += (Number(r.debit) || 0) - (Number(r.credit) || 0)
        if (matching && !matching.has(r.id)) continue   // 余额照常累计，只输出命中行
        yield keys.map(key => {
          switch (key) {
            case 'settle_type': return r.settle_type ? settleNames.get(r.settle_type) || r.settle_type : ''
            case 'counter_account': return r.counter_account ? `${r.counter_account}${accNames.get(r.counter_account) ? ' ' + accNames.get(r.counter_account) : ''}` : ''
            case 'debit': return Number(r.debit) || ''
            case 'credit': return Number(r.credit) || ''
            case 'exchange_rate': return Number(r.exchange_rate) > 0 ? Number(r.exchange_rate) : ''
            case 'base_debit': return Number(r.base_debit) || ''
            case 'base_credit': return Number(r.base_credit) || ''
            case 'balance': return Math.round(running * 100) / 100
            case 'reconciled': return r.reconciled ? '是' : ''
            case 'voucher': return r.voucher_no ? `${r.voucher_year}-${String(r.voucher_month).padStart(2, '0')} ${r.voucher_no}` : ''
            default: return key.startsWith('aux:') ? (r.aux_values?.[key.slice(4)] ?? '') : (r[key] ?? '')
          }
        })
        n += 1
        if (n % YIELD_EVERY_ROWS === 0) await new Promise<void>(resolve => setImmediate(resolve))
      }
      await new Promise<void>(resolve => setImmediate(resolve))
    }
  },
}

function listJournalPage(ctx: ExportSourceContext, f: ReturnType<typeof cashierJournalFilters>, page: number, pageSize: number) {
  return listJournal({
    accountSetId: ctx.accountSetId,
    accountCode: f.accountCode,
    currency: f.currency,
    startDate: f.startDate,
    endDate: f.endDate,
    page,
    pageSize,
  })
}


// ── 出纳报表改造：综合查询 / 余额表 / 多维汇总（全量、服务端流式，含辅助列） ─────────────────

const CASHIER_SEARCH_KEYS = [
  'account_code', 'account_name', 'biz_date', 'currency', 'summary', 'settle_type', 'bill_no', 'counter_unit',
  'counter_account', 'debit', 'credit', 'base_debit', 'base_credit', 'reconciled', 'voucher', 'voucher_status',
] as const

const VOUCHER_STATUS_LABEL: Record<string, string> = { draft: '草稿', audited: '已审核', posted: '已记账' }

const cashierSearchSource: ExportSource = {
  permissions: ['cashier:journal', 'cashier:report'],
  keys: CASHIER_SEARCH_KEYS,
  keyPrefixes: ['aux:'],
  count(ctx, params) {
    const f = parseReportFilterParams(params, ctx.accountSetId, ctx.accountScope)
    return searchJournalsReport(ctx.db, f, 1, 1).total
  },
  async *rows(ctx, params, keys) {
    const f = parseReportFilterParams(params, ctx.accountSetId, ctx.accountScope)
    const PAGE = 2000
    for (let page = 1; ; page++) {
      const r = searchJournalsReport(ctx.db, f, page, PAGE)
      for (const row of r.list) {
        yield keys.map(key => {
          switch (key) {
            case 'account_code': return row.account_code
            case 'account_name': return row.account_name
            case 'settle_type': return row.settle_type_name || row.settle_type || ''
            case 'counter_account': return row.counter_account ? `${row.counter_account}${row.counter_account_name ? ' ' + row.counter_account_name : ''}` : ''
            case 'debit': return Number(row.debit) || ''
            case 'credit': return Number(row.credit) || ''
            case 'base_debit': return Number(row.base_debit) || ''
            case 'base_credit': return Number(row.base_credit) || ''
            case 'reconciled': return row.reconciled ? '是' : ''
            case 'voucher': return row.voucher_no ? `${row.voucher_year}-${String(row.voucher_month).padStart(2, '0')} ${row.voucher_no}` : ''
            case 'voucher_status': return row.voucher_status ? (VOUCHER_STATUS_LABEL[row.voucher_status] || row.voucher_status) : ''
            default: return key.startsWith('aux:') ? (row.aux_values?.[key.slice(4)] ?? '') : ((row as any)[key] ?? '')
          }
        })
      }
      if (page * PAGE >= r.total || r.list.length === 0) break
      await new Promise<void>(resolve => setImmediate(resolve))
    }
  },
}

const CASHIER_BALANCE_KEYS = [
  'account_code', 'account_name', 'currency', 'opening', 'income', 'expense', 'closing',
  'income_base', 'expense_base', 'closing_base', 'count', 'unreconciled_count', 'unreconciled_net',
] as const

function balanceFor(ctx: ExportSourceContext, params: Record<string, unknown>) {
  const f = parseReportFilterParams(params, ctx.accountSetId, ctx.accountScope)
  if (!f.startDate || !f.endDate) throw new Error('日期区间不能为空')
  return getBalanceReport(ctx.db, f as any, { includeZero: flag(params.include_zero) })
}

const cashierBalanceSource: ExportSource = {
  permissions: ['cashier:report', 'cashier:journal'],
  keys: CASHIER_BALANCE_KEYS,
  count: (ctx, params) => balanceFor(ctx, params).rows.length,
  async *rows(ctx, params, keys) {
    for (const r of balanceFor(ctx, params).rows) {
      yield keys.map(key => {
        const v = (r as any)[key]
        return typeof v === 'number' ? v : (v ?? '')
      })
    }
  },
}

/** 汇总树展开成带层级的行：分组行（最底层）+ 各级小计 + 合计。dim_N 列放第 N 级名称 */
const CASHIER_SUMMARY_KEYS = ['dim_0', 'dim_1', 'dim_2', 'dim_3', 'income', 'expense', 'net', 'count', 'income_ratio', 'expense_ratio'] as const

function flattenSummary(root: SummaryNode, depth: number): Array<Record<string, string | number>> {
  const out: Array<Record<string, string | number>> = []
  const cell = (n: SummaryNode, names: string[], label?: string) => {
    const row: Record<string, string | number> = {
      income: n.income, expense: n.expense, net: n.net, count: n.count,
      income_ratio: Math.round(n.income_ratio * 10000) / 100, expense_ratio: Math.round(n.expense_ratio * 10000) / 100,
    }
    names.forEach((name, i) => { row[`dim_${i}`] = name })
    if (label) row[`dim_${Math.max(0, names.length - 1)}`] = label
    return row
  }
  const walk = (n: SummaryNode, names: string[]) => {
    const here = [...names, n.name]
    if (n.children?.length) {
      n.children.forEach(c => walk(c, here))
      if (here.length < depth) out.push(cell(n, here, `${n.name} 小计`))
    } else {
      out.push(cell(n, here))
    }
  }
  root.children?.forEach(c => walk(c, []))
  out.push(cell(root, [''], '合计'))
  return out
}

function summaryFor(ctx: ExportSourceContext, params: Record<string, unknown>) {
  const f = parseReportFilterParams(params, ctx.accountSetId, ctx.accountScope)
  const groupBy = Array.isArray(params.group_by) ? (params.group_by as unknown[]).map(String) : []
  return getSummaryReport(ctx.db, f, groupBy)
}

const cashierSummarySource: ExportSource = {
  permissions: ['cashier:report', 'cashier:journal'],
  keys: CASHIER_SUMMARY_KEYS,
  count: (ctx, params) => flattenSummary(summaryFor(ctx, params).root, (params.group_by as unknown[] | undefined)?.length || 1).length,
  async *rows(ctx, params, keys) {
    const rep = summaryFor(ctx, params)
    for (const row of flattenSummary(rep.root, rep.group_by.length)) {
      yield keys.map(key => row[key] ?? '')
    }
  },
}

export const EXPORT_SOURCES: Record<string, ExportSource> = {
  chronological: chronologicalSource,
  cashierJournal: cashierJournalSource,
  cashierSearch: cashierSearchSource,
  cashierBalance: cashierBalanceSource,
  cashierSummary: cashierSummarySource,
}
