/**
 * 业务凭证中心（财务总账 → 日常业务 → 业务凭证）
 *
 * 把分散在各模块的业务类凭证汇总到一处：进销存单据、出纳流水、固定资产。
 * 只做查询与汇总；生成 / 删除仍走各模块已有的业务逻辑（进销存逐张调用 genVoucherHandler，
 * 出纳、固定资产由前端直接调用各自接口），保证口径与原入口完全一致。
 */
import type Database from 'better-sqlite3'
import { listAssetVouchers, type AssetVoucherKind, type AssetVoucherRow } from './assetVoucherManage.js'
import { parseReportFilterParams, searchJournalsReport } from './cashierReport.js'
import type { AccountScopeContext } from './accountAuthorization.js'
import { getPaymentVoucherMode } from './paymentVoucherMode.js'

type Db = Database.Database

/** 会生成凭证的进销存单据类型（调拨 / 盘点 / 询价订单报价 / 缺料 / MRP 不生成） */
export const SCM_VOUCHER_DOC_TYPES = [
  'PI', 'PR', 'RP', 'SO', 'SR', 'RS', 'RCV', 'PAY',
  'IS', 'OI', 'OO',
  'PL', 'PB', 'PF', 'PS', 'PJ', 'CA', 'AS', 'DS',
  'WO', 'WI', 'OP',
] as const

export type BizVoucherStatus = 'pending' | 'generated' | 'all'

export interface DateRange { startDate?: string; endDate?: string }

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
export function normalizeRange(start?: unknown, end?: unknown): DateRange {
  const s = String(start ?? '').trim(); const e = String(end ?? '').trim()
  return { startDate: DATE_RE.test(s) ? s : undefined, endDate: DATE_RE.test(e) ? e : undefined }
}

// ── 进销存 ─────────────────────────────────────────────────────────────

export interface ScmDocFilter extends DateRange {
  /** 当前用户可见的单据类型（已按业务域权限过滤） */
  allowedTypes: string[]
  status: BizVoucherStatus
  docType?: string
  keyword?: string
}

function scmWhere(aid: string, f: ScmDocFilter): { sql: string; params: unknown[] } {
  const types = f.docType ? f.allowedTypes.filter(t => t === f.docType) : f.allowedTypes
  if (!types.length) return { sql: '1=0', params: [] }
  const conds = [`d.account_set_id=?`, `d.status='audited'`, `d.doc_type IN (${types.map(() => '?').join(',')})`]
  const params: unknown[] = [aid, ...types]
  // external_voucher=1：润衡等原系统导入的历史单据，原系统已制证，视同已生成、不再进待生成
  if (f.status === 'pending') conds.push('d.voucher_id IS NULL AND COALESCE(d.external_voucher,0)=0')
  else if (f.status === 'generated') conds.push('(d.voucher_id IS NOT NULL OR COALESCE(d.external_voucher,0)=1)')
  if (f.startDate) { conds.push('d.doc_date>=?'); params.push(f.startDate) }
  if (f.endDate) { conds.push('d.doc_date<=?'); params.push(f.endDate) }
  const kw = (f.keyword || '').trim()
  if (kw) {
    conds.push('(d.doc_no LIKE ? OR d.partner_code LIKE ? OR p.name LIKE ? OR d.remark LIKE ? OR v.voucher_no LIKE ?)')
    params.push(...Array(5).fill(`%${kw}%`))
  }
  return { sql: conds.join(' AND '), params }
}

const SCM_FROM = `FROM scm_doc d
  LEFT JOIN scm_partner p ON p.account_set_id=d.account_set_id AND p.code=d.partner_code
  LEFT JOIN vouchers v ON v.id=d.voucher_id
  LEFT JOIN scm_doc_type t ON t.account_set_id=d.account_set_id AND t.code=d.doc_type`

export function listScmVoucherDocs(db: Db, aid: string, f: ScmDocFilter, page = 1, pageSize = 50) {
  const w = scmWhere(aid, f)
  const total = (db.prepare(`SELECT COUNT(*) c ${SCM_FROM} WHERE ${w.sql}`).get(...w.params) as { c: number }).c
  const size = Math.min(Math.max(pageSize, 1), 500)
  const offset = (Math.max(page, 1) - 1) * size
  const list = db.prepare(
    `SELECT d.id, d.doc_type, t.name AS doc_type_name, d.doc_no, d.doc_date, d.partner_code, p.name AS partner_name,
            d.dept_code, d.total_amount, d.total_tax, d.currency, d.remark, d.source_doc_id,
            d.voucher_id, COALESCE(d.external_voucher,0) AS external_voucher,
            v.voucher_no, v.status AS voucher_status, v.year AS voucher_year, v.period AS voucher_period
     ${SCM_FROM} WHERE ${w.sql}
     ORDER BY (d.voucher_id IS NULL AND COALESCE(d.external_voucher,0)=0) DESC, d.doc_date DESC, d.doc_no DESC
     LIMIT ? OFFSET ?`,
  ).all(...w.params, size, offset)
  return { list, total, page: Math.max(page, 1), page_size: size }
}

export function countScm(db: Db, aid: string, allowedTypes: string[], range: DateRange) {
  const count = (status: BizVoucherStatus) => {
    const w = scmWhere(aid, { allowedTypes, status, ...range })
    return (db.prepare(`SELECT COUNT(*) c ${SCM_FROM} WHERE ${w.sql}`).get(...w.params) as { c: number }).c
  }
  return { pending: count('pending'), generated: count('generated') }
}

// ── 出纳 ───────────────────────────────────────────────────────────────

export function countCashier(db: Db, aid: string, scope: AccountScopeContext | undefined, range: DateRange) {
  // 收付款单直接制证模式：收付款单写入的流水在进销存一侧计待生成，出纳这边不重复计
  const excludeScm = getPaymentVoucherMode(db, aid) === 'scm'
  const total = (voucherStatus: string[], exclude = false) => {
    const f = parseReportFilterParams(
      { voucher_status: voucherStatus, currency: 'ALL', start_date: range.startDate, end_date: range.endDate, exclude_scm_payment: exclude ? 1 : 0 },
      aid,
      scope,
    )
    return searchJournalsReport(db, f, 1, 1).total
  }
  return { pending: total(['none'], excludeScm), generated: total(['draft', 'audited', 'posted']) }
}

// ── 固定资产 ───────────────────────────────────────────────────────────

/** 期间 (年, 月) 是否落在日期区间所覆盖的月份内 */
function periodInRange(year: number | null | undefined, period: number | null | undefined, range: DateRange): boolean {
  if (!year || !period) return !range.startDate && !range.endDate
  const ym = year * 100 + period
  const toYm = (d?: string) => (d ? Number(d.slice(0, 4)) * 100 + Number(d.slice(5, 7)) : null)
  const s = toYm(range.startDate); const e = toYm(range.endDate)
  return (s === null || ym >= s) && (e === null || ym <= e)
}

/** listAssetVouchers 单页最多 500：逐页取全，再按月份区间过滤 */
export function listAllAssetVouchers(
  db: Db, aid: string,
  f: DateRange & { kind?: AssetVoucherKind; status?: 'generated' | 'missing'; keyword?: string },
): AssetVoucherRow[] {
  const rows: AssetVoucherRow[] = []
  for (let page = 1; ; page++) {
    const r = listAssetVouchers(db, aid, { kind: f.kind, status: f.status, keyword: f.keyword, page, pageSize: 500 })
    rows.push(...r.list)
    if (rows.length >= r.total || r.list.length === 0) break
  }
  return rows.filter(r => periodInRange(r.year, r.period, f))
}

export function countAsset(db: Db, aid: string, range: DateRange) {
  const rows = listAllAssetVouchers(db, aid, range)
  const generated = rows.filter(r => r.hasVoucher).length
  return { pending: rows.length - generated, generated }
}
