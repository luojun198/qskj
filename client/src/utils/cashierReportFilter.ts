/**
 * 出纳报表统一筛选状态：页面状态 ⇄ 接口请求体 ⇄ 路由查询参数（钻取）。
 *
 * 口径：辅助项目 = 流水「对方科目」的辅助核算。余额表只应用账户级条件（科目 / 账户类型 / 币种 / 日期），
 * 明细类条件（对方科目、结算方式、辅助项目、凭证状态…）由汇总 / 综合查询使用。
 */
import { formatDate } from '@/utils/format'

/** 辅助项目筛选里表示「未指定该类别辅助」的特殊项目 id（与后端 AUX_NONE 一致） */
export const AUX_NONE = '__none__'
/** 币种下拉里表示「全部币种，按本位币折算」 */
export const ALL_CURRENCIES = 'ALL'

export type VoucherStatus = 'none' | 'draft' | 'audited' | 'posted'

export interface AuxSelection { categoryId: string; itemIds: string[] }

export interface CashierReportFilterState {
  dateRange: [string, string] | null
  accountCodes: string[]
  accountType: 'all' | 'cash' | 'bank'
  /** 具体币种 | ALL；空串 = 由页面决定默认（本位币） */
  currency: string
  counterAccounts: string[]
  settleTypes: string[]
  aux: AuxSelection[]
  voucherStatus: VoucherStatus[]
  reconciled: 0 | 1 | undefined
  summary: string
  billNo: string
  counterUnit: string
  amountDirection: 'all' | 'income' | 'expense'
  minAmount: number | undefined
  maxAmount: number | undefined
}

export const VOUCHER_STATUS_OPTIONS: Array<{ value: VoucherStatus; label: string }> = [
  { value: 'none', label: '未生成凭证' },
  { value: 'draft', label: '草稿凭证' },
  { value: 'audited', label: '已审核凭证' },
  { value: 'posted', label: '已记账凭证' },
]

export function currentMonthRange(now = new Date()): [string, string] {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  return [`${y}-${m}-01`, formatDate(now)]
}

export function defaultCashierFilter(): CashierReportFilterState {
  return {
    dateRange: currentMonthRange(),
    accountCodes: [],
    accountType: 'all',
    currency: '',
    counterAccounts: [],
    settleTypes: [],
    aux: [],
    voucherStatus: [],
    reconciled: undefined,
    summary: '',
    billNo: '',
    counterUnit: '',
    amountDirection: 'all',
    minAmount: undefined,
    maxAmount: undefined,
  }
}

/** 快捷日期：本月 / 上月 / 本季 / 本年 */
export function quickDateRange(kind: 'month' | 'lastMonth' | 'quarter' | 'year', now = new Date()): [string, string] {
  const y = now.getFullYear()
  const m = now.getMonth()
  const ymd = (d: Date) => formatDate(d)
  switch (kind) {
    case 'month': return [ymd(new Date(y, m, 1)), ymd(now)]
    case 'lastMonth': return [ymd(new Date(y, m - 1, 1)), ymd(new Date(y, m, 0))]
    case 'quarter': return [ymd(new Date(y, Math.floor(m / 3) * 3, 1)), ymd(now)]
    case 'year': return [ymd(new Date(y, 0, 1)), ymd(now)]
  }
}

/** 页面状态 → 接口请求体（snake_case；空条件不传） */
export function toReportPayload(s: CashierReportFilterState): Record<string, unknown> {
  const p: Record<string, unknown> = {}
  if (s.dateRange?.[0]) p.start_date = s.dateRange[0]
  if (s.dateRange?.[1]) p.end_date = s.dateRange[1]
  if (s.accountCodes.length) p.account_codes = s.accountCodes
  if (s.accountType !== 'all') p.account_type = s.accountType
  if (s.currency) p.currency = s.currency
  if (s.counterAccounts.length) p.counter_accounts = s.counterAccounts
  if (s.settleTypes.length) p.settle_types = s.settleTypes
  const aux = s.aux.filter(a => a.categoryId)
  if (aux.length) p.aux = aux.map(a => ({ category_id: a.categoryId, item_ids: a.itemIds }))
  if (s.voucherStatus.length) p.voucher_status = s.voucherStatus
  if (s.reconciled === 0 || s.reconciled === 1) p.reconciled = s.reconciled
  if (s.summary.trim()) p.summary = s.summary.trim()
  if (s.billNo.trim()) p.bill_no = s.billNo.trim()
  if (s.counterUnit.trim()) p.counter_unit = s.counterUnit.trim()
  if (s.amountDirection !== 'all') p.amount_direction = s.amountDirection
  if (s.minAmount !== undefined && s.minAmount !== null) p.min_amount = s.minAmount
  if (s.maxAmount !== undefined && s.maxAmount !== null) p.max_amount = s.maxAmount
  return p
}

/** 综合查询是 GET：数组用逗号拼，aux 用 JSON 字符串 */
export function toSearchParams(s: CashierReportFilterState): Record<string, unknown> {
  const p = toReportPayload(s)
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(p)) {
    if (k === 'aux') out.aux = JSON.stringify(v)
    else out[k] = Array.isArray(v) ? v.join(',') : v
  }
  return out
}

/** 已启用的筛选条件数（日期不计）——用于「更多筛选」角标 */
export function activeFilterCount(s: CashierReportFilterState): number {
  let n = 0
  if (s.accountCodes.length) n++
  if (s.accountType !== 'all') n++
  if (s.currency) n++
  if (s.counterAccounts.length) n++
  if (s.settleTypes.length) n++
  if (s.aux.some(a => a.categoryId)) n++
  if (s.voucherStatus.length) n++
  if (s.reconciled !== undefined) n++
  if (s.summary.trim() || s.billNo.trim() || s.counterUnit.trim()) n++
  if (s.amountDirection !== 'all' || s.minAmount !== undefined || s.maxAmount !== undefined) n++
  return n
}

/** 钻取：把当前筛选序列化进路由 query.f（单个 JSON 参数，避免拼一长串 query） */
export function filterToRouteQuery(s: CashierReportFilterState, extra?: Record<string, string>): Record<string, string> {
  return { f: JSON.stringify(s), ...(extra || {}) }
}

/** 从路由 query.f 还原筛选状态；无效或缺失返回 null（缺省字段回落到默认值） */
export function filterFromRouteQuery(q: Record<string, unknown>): CashierReportFilterState | null {
  const raw = q?.f
  if (typeof raw !== 'string' || !raw) return null
  try {
    const obj = JSON.parse(raw)
    if (!obj || typeof obj !== 'object') return null
    return { ...defaultCashierFilter(), ...obj }
  } catch {
    return null
  }
}

/** 汇总树节点路径（维度 + key）→ 叠加到筛选条件上，用于从汇总表钻取到明细 */
export function applyDrillPath(
  base: CashierReportFilterState,
  path: Array<{ dimension: string; key: string }>
): CashierReportFilterState {
  const s: CashierReportFilterState = JSON.parse(JSON.stringify(base))
  for (const { dimension, key } of path) {
    switch (dimension) {
      case 'account': s.accountCodes = [key]; break
      case 'currency': s.currency = key; break
      case 'settle_type':
        // 空 key = 未指定结算方式，现有明细筛选无法表达「为空」，钻取时不收窄（合计仍由汇总表给出）
        if (key) s.settleTypes = [key]
        break
      case 'counter_account': if (key) s.counterAccounts = [key]; break
      case 'year': s.dateRange = [`${key}-01-01`, `${key}-12-31`]; break
      case 'month': {
        const [y, m] = key.split('-').map(Number)
        const last = new Date(y, m, 0).getDate()
        s.dateRange = [`${key}-01`, `${key}-${String(last).padStart(2, '0')}`]
        break
      }
      case 'day': s.dateRange = [key, key]; break
      default:
        if (dimension.startsWith('aux:')) {
          const categoryId = dimension.slice(4)
          const rest = s.aux.filter(a => a.categoryId !== categoryId)
          s.aux = [...rest, { categoryId, itemIds: [key || AUX_NONE] }]
        }
    }
  }
  return s
}

/** 筛选条件的文字摘要（打印页眉 / 导出副标题） */
export function describeFilter(
  s: CashierReportFilterState,
  names: { accounts?: Record<string, string>; currencyLabel?: string } = {}
): string {
  const parts: string[] = []
  if (s.dateRange?.[0] || s.dateRange?.[1]) parts.push(`期间：${s.dateRange?.[0] || '起'} 至 ${s.dateRange?.[1] || '止'}`)
  if (s.accountCodes.length) parts.push(`科目：${s.accountCodes.map(c => names.accounts?.[c] || c).join('、')}`)
  else if (s.accountType !== 'all') parts.push(`账户类型：${s.accountType === 'cash' ? '现金' : '银行'}`)
  if (names.currencyLabel) parts.push(`币种：${names.currencyLabel}`)
  if (s.voucherStatus.length) {
    const label = Object.fromEntries(VOUCHER_STATUS_OPTIONS.map(o => [o.value, o.label]))
    parts.push(`凭证：${s.voucherStatus.map(v => label[v]).join('、')}`)
  }
  return parts.join('　')
}

/** 某辅助类别当前选中的项目 id（未筛选返回空数组） */
export function auxItemIdsOf(s: CashierReportFilterState, categoryId: string): string[] {
  return s.aux.find(a => a.categoryId === categoryId)?.itemIds || []
}

/** 设置某辅助类别的项目筛选；ids 为空 = 取消该类别筛选（表头筛选「重置」）。返回新状态，不修改原对象 */
export function withAuxItemIds(s: CashierReportFilterState, categoryId: string, ids: string[]): CashierReportFilterState {
  const rest = s.aux.filter(a => a.categoryId !== categoryId)
  return { ...s, aux: ids.length ? [...rest, { categoryId, itemIds: ids }] : rest }
}

/**
 * 流水账表头筛选只带「明细类」条件（账户 / 日期 / 币种由流水账自己的筛选条决定），
 * 序列化成 GET 查询参数，空条件不传。
 */
export function toJournalDetailParams(s: CashierReportFilterState): Record<string, unknown> {
  const all = toSearchParams(s)
  const keep = ['summary', 'settle_types', 'bill_no', 'counter_unit', 'counter_accounts', 'aux', 'voucher_status', 'reconciled']
  return Object.fromEntries(Object.entries(all).filter(([k]) => keep.includes(k)))
}

/** 表头明细筛选是否生效、以及生效项数（用于「已筛选 N 项 · 清除」提示） */
export function journalDetailCount(s: CashierReportFilterState): number {
  let n = 0
  if (s.summary.trim()) n++
  if (s.billNo.trim()) n++
  if (s.counterUnit.trim()) n++
  if (s.counterAccounts.length) n++
  if (s.settleTypes.length) n++
  n += s.aux.filter(a => a.categoryId).length
  if (s.voucherStatus.length) n++
  if (s.reconciled !== undefined) n++
  return n
}
