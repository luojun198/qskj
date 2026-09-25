/**
 * FIX-262：出纳对账 = 出纳日记账 ↔ 总账同科目「已记账」凭证分录。
 *
 * - 一个批次（cashier_gl_match.batch_id）= 若干出纳行 + 若干分录，净额相等即对上；手动对账只允许一对多 / 多对一。
 * - 金额口径：本位币科目取分录 amount；外币科目取分录 foreign_amount（且币种一致），与日记账原币比较。
 *   有符号净额：借（收入）为正，贷（支出）为负。
 * - 分录被删 / 凭证反记账 / 金额被改（与快照不符）/ 出纳行被改，批次自动失效（pruneStaleMatches）。
 * - cashier_journal.reconciled 为「已与总账对上」冗余标志，随批次维护。
 */
import type Database from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'
import { getCashierAccountCurrency, getCashierBaseCurrency } from './cashierQuery.js'
import { assertCashierPeriodOpen, isCashierPeriodClosed, parseBizDate } from './cashierPeriodClosing.js'
import { calcSignedBalance } from '../utils/accountBalance.js'

const EPS = 0.005
const round2 = (n: number) => Math.round(n * 100) / 100

/**
 * FIX-326：对账工作台 / 差异清单每侧明细最多返回的行数。此前两侧明细不设上限（25 万流水时单次响应上百 MB），
 * 合计 / 未达净额也是把全部明细取到 JS 再求和。现在合计一律 SQL 汇总（口径与截断无关），明细超出时带 truncated 提示缩小日期范围。
 */
// 页面两侧是普通 el-table（非虚拟滚动），每侧 5000 行时浏览器主线程卡 3 分钟，取 1000
export const GL_RECONCILE_LIST_LIMIT = 1000

export type MatchType = 'link' | 'auto' | 'manual'

export interface GlEntryRow {
  id: string
  voucher_id: string
  voucher_date: string
  voucher_no: string
  voucher_type_name: string | null
  summary: string | null
  debit: number
  credit: number
  batch_id: string | null
  match_type: MatchType | null
}

export interface CashierRow {
  id: string
  biz_date: string
  seq: number
  summary: string | null
  debit: number
  credit: number
  bill_no: string | null
  voucher_id: string | null
  batch_id: string | null
  match_type: MatchType | null
}

interface Scope {
  db: Database.Database
  accountSetId: string
  accountCode: string
}

function scopeCurrency(s: Scope) {
  const currency = getCashierAccountCurrency(s.db, s.accountSetId, s.accountCode)
  const foreign = currency !== getCashierBaseCurrency(s.db, s.accountSetId)
  return { currency, foreign }
}

/** 分录金额表达式（按对账币种） */
function glAmountSql(foreign: boolean) {
  return foreign ? 'COALESCE(ve.foreign_amount, 0)' : 've.amount'
}

/**
 * FIX-326：分录按科目定位走 (account_set_id, account_id) 索引。voucher_entries.account_code 无索引，
 * 只按它过滤会扫整个账套的分录（26 万分录时每次 ~1.1s，对账工作台一次请求要查 6~7 次）。account_code 条件保留，口径不变。
 */
function glAccountCond(s: Scope, params: unknown[]) {
  const acc = s.db.prepare('SELECT id FROM accounts WHERE account_set_id=? AND code=?').get(s.accountSetId, s.accountCode) as { id: string } | undefined
  if (!acc) { params.push(s.accountSetId, s.accountCode); return 've.account_set_id=? AND ve.account_code=?' }
  params.push(s.accountSetId, acc.id, s.accountCode)
  return 've.account_set_id=? AND ve.account_id=? AND ve.account_code=?'
}

function glWhere(s: Scope, foreign: boolean, currency: string, params: unknown[], start?: string, end?: string) {
  const conds = [glAccountCond(s, params), "v.status='posted'"]
  if (foreign) {
    conds.push("UPPER(COALESCE(ve.currency_code,''))=?")
    params.push(currency.toUpperCase())
  }
  if (start) { conds.push('v.voucher_date>=?'); params.push(start) }
  if (end) { conds.push('v.voucher_date<=?'); params.push(end) }
  return conds.join(' AND ')
}

/**
 * 批次失效检查：成员分录不存在 / 凭证非已记账 / 金额与快照不符 / 出纳行不存在或金额被改 → 整批删除并清 reconciled。
 * 返回失效批次数。
 */
export function pruneStaleMatches(s: Scope): number {
  const { db, accountSetId, accountCode } = s
  const { foreign, currency } = scopeCurrency(s)
  const members = db.prepare(
    'SELECT batch_id, side, ref_id, amount FROM cashier_gl_match WHERE account_set_id=? AND account_code=?'
  ).all(accountSetId, accountCode) as Array<{ batch_id: string; side: 'cashier' | 'gl'; ref_id: string; amount: number }>
  if (!members.length) return 0
  const cashierAmt = db.prepare('SELECT debit - credit AS a FROM cashier_journal WHERE id=? AND account_set_id=?')
  const glAmt = db.prepare(`
    SELECT CASE WHEN ve.direction='debit' THEN ${glAmountSql(foreign)} ELSE -${glAmountSql(foreign)} END AS a,
           v.status, ve.account_code, UPPER(COALESCE(ve.currency_code,'')) AS cur
    FROM voucher_entries ve JOIN vouchers v ON v.id=ve.voucher_id
    WHERE ve.id=? AND ve.account_set_id=?`)
  const stale = new Set<string>()
  for (const m of members) {
    if (stale.has(m.batch_id)) continue
    if (m.side === 'cashier') {
      const r = cashierAmt.get(m.ref_id, accountSetId) as { a: number } | undefined
      if (!r || Math.abs(r.a - m.amount) > EPS) stale.add(m.batch_id)
    } else {
      const r = glAmt.get(m.ref_id, accountSetId) as { a: number; status: string; account_code: string; cur: string } | undefined
      if (!r || r.status !== 'posted' || r.account_code !== accountCode || Math.abs(r.a - m.amount) > EPS
        || (foreign && r.cur !== currency.toUpperCase())) stale.add(m.batch_id)
    }
  }
  if (!stale.size) return 0
  db.transaction(() => { for (const b of stale) dropBatch(db, accountSetId, b) })()
  return stale.size
}

function dropBatch(db: Database.Database, accountSetId: string, batchId: string) {
  const ids = db.prepare(
    "SELECT ref_id FROM cashier_gl_match WHERE account_set_id=? AND batch_id=? AND side='cashier'"
  ).all(accountSetId, batchId) as Array<{ ref_id: string }>
  db.prepare('DELETE FROM cashier_gl_match WHERE account_set_id=? AND batch_id=?').run(accountSetId, batchId)
  const upd = db.prepare('UPDATE cashier_journal SET reconciled=0 WHERE id=? AND account_set_id=?')
  for (const r of ids) upd.run(r.ref_id, accountSetId)
}

function batchMap(db: Database.Database, accountSetId: string, accountCode: string, side: 'cashier' | 'gl') {
  const rows = db.prepare(
    'SELECT m.ref_id, m.batch_id, m.match_type FROM cashier_gl_match m WHERE m.account_set_id=? AND m.account_code=? AND m.side=?'
  ).all(accountSetId, accountCode, side) as Array<{ ref_id: string; batch_id: string; match_type: MatchType }>
  return new Map(rows.map(r => [r.ref_id, r]))
}

type ListOpts = { start?: string; end?: string; matched?: boolean; limit?: number }

function cashierWhere(s: Scope, currency: string, opts: ListOpts, params: unknown[]) {
  const conds = ['account_set_id=?', 'account_code=?', 'currency=?']
  params.push(s.accountSetId, s.accountCode, currency)
  if (opts.start) { conds.push('biz_date>=?'); params.push(opts.start) }
  if (opts.end) { conds.push('biz_date<=?'); params.push(opts.end) }
  if (opts.matched !== undefined) { conds.push('reconciled=?'); params.push(opts.matched ? 1 : 0) }
  return conds.join(' AND ')
}

/** 出纳日记账（该科目币种），带所属批次；limit 为返回行数上限（FIX-326） */
export function listCashierRows(s: Scope, opts: ListOpts = {}): CashierRow[] {
  const { db, accountSetId, accountCode } = s
  const { currency } = scopeCurrency(s)
  const params: unknown[] = []
  const where = cashierWhere(s, currency, opts, params)
  if (opts.limit) params.push(opts.limit)
  const rows = db.prepare(`
    SELECT id, biz_date, seq, summary, debit, credit, bill_no, voucher_id FROM cashier_journal
    WHERE ${where} ORDER BY biz_date, seq, created_at${opts.limit ? ' LIMIT ?' : ''}
  `).all(...params) as Array<Omit<CashierRow, 'batch_id' | 'match_type'>>
  const bm = batchMap(db, accountSetId, accountCode, 'cashier')
  return rows.map(r => ({ ...r, batch_id: bm.get(r.id)?.batch_id ?? null, match_type: bm.get(r.id)?.match_type ?? null }))
}

/** FIX-326：出纳侧 SQL 汇总（行数 / 借 / 贷），不取明细 */
export function sumCashierRows(s: Scope, opts: Omit<ListOpts, 'limit'> = {}): { n: number; debit: number; credit: number } {
  const { currency } = scopeCurrency(s)
  const params: unknown[] = []
  const where = cashierWhere(s, currency, opts, params)
  const r = s.db.prepare(
    `SELECT COUNT(*) n, COALESCE(SUM(debit),0) d, COALESCE(SUM(credit),0) c FROM cashier_journal WHERE ${where}`
  ).get(...params) as { n: number; d: number; c: number }
  return { n: r.n, debit: round2(r.d), credit: round2(r.c) }
}

/** 总账侧是否已进批次（SQL 条件，走 uq_cashier_gl_match_ref） */
function glMatchedCond(matched: boolean) {
  return `${matched ? '' : 'NOT '}EXISTS (SELECT 1 FROM cashier_gl_match m WHERE m.side='gl' AND m.ref_id=ve.id)`
}

/** FIX-326：总账侧 SQL 汇总（行数 / 借 / 贷），不取明细 */
export function sumGlEntries(s: Scope, opts: Omit<ListOpts, 'limit'> = {}): { n: number; debit: number; credit: number } {
  const { foreign, currency } = scopeCurrency(s)
  const params: unknown[] = []
  let where = glWhere(s, foreign, currency, params, opts.start, opts.end)
  if (opts.matched !== undefined) where += ` AND ${glMatchedCond(opts.matched)}`
  const amt = glAmountSql(foreign)
  const r = s.db.prepare(`
    SELECT COUNT(*) n,
           COALESCE(SUM(CASE WHEN ve.direction='debit' THEN ${amt} ELSE 0 END),0) d,
           COALESCE(SUM(CASE WHEN ve.direction='credit' THEN ${amt} ELSE 0 END),0) c
    FROM voucher_entries ve JOIN vouchers v ON v.id=ve.voucher_id WHERE ${where}`
  ).get(...params) as { n: number; d: number; c: number }
  return { n: r.n, debit: round2(r.d), credit: round2(r.c) }
}

/** 总账该科目已记账分录，带所属批次；另返回区间内未记账凭证张数 */
export function listGlEntries(s: Scope, opts: ListOpts = {}): {
  rows: GlEntryRow[]
  unposted: number
} {
  const { db, accountSetId, accountCode } = s
  const { foreign, currency } = scopeCurrency(s)
  const params: unknown[] = []
  let where = glWhere(s, foreign, currency, params, opts.start, opts.end)
  // FIX-326：已对 / 未对在 SQL 里过滤（原先取全部后在 JS 里筛），才能配合 LIMIT
  if (opts.matched !== undefined) where += ` AND ${glMatchedCond(opts.matched)}`
  if (opts.limit) params.push(opts.limit)
  const amt = glAmountSql(foreign)
  const all = db.prepare(`
    SELECT ve.id, ve.voucher_id, v.voucher_date, v.voucher_no, vt.name AS voucher_type_name,
           COALESCE(ve.summary, '') AS summary,
           CASE WHEN ve.direction='debit' THEN ${amt} ELSE 0 END AS debit,
           CASE WHEN ve.direction='credit' THEN ${amt} ELSE 0 END AS credit
    FROM voucher_entries ve
    JOIN vouchers v ON v.id=ve.voucher_id
    LEFT JOIN voucher_types vt ON vt.id=v.voucher_type_id
    WHERE ${where}
    ORDER BY v.voucher_date, v.voucher_no, ve.seq${opts.limit ? ' LIMIT ?' : ''}
  `).all(...params) as Array<Omit<GlEntryRow, 'batch_id' | 'match_type'>>
  const bm = batchMap(db, accountSetId, accountCode, 'gl')
  const rows: GlEntryRow[] = all.map(r => ({
    ...r,
    voucher_no: String(r.voucher_no ?? ''),
    batch_id: bm.get(r.id)?.batch_id ?? null,
    match_type: bm.get(r.id)?.match_type ?? null,
  }))
  return { rows, unposted: countUnposted(s, opts.start, opts.end) }
}

/** 区间内该科目未记账凭证张数 */
function countUnposted(s: Scope, start?: string, end?: string): number {
  const up: unknown[] = []
  const uc = [glAccountCond(s, up), "v.status<>'posted'"]
  if (start) { uc.push('v.voucher_date>=?'); up.push(start) }
  if (end) { uc.push('v.voucher_date<=?'); up.push(end) }
  return (s.db.prepare(`
    SELECT COUNT(DISTINCT v.id) n FROM voucher_entries ve JOIN vouchers v ON v.id=ve.voucher_id WHERE ${uc.join(' AND ')}
  `).get(...up) as { n: number }).n
}

function closedChecker(db: Database.Database, accountSetId: string) {
  const cache = new Map<string, boolean>()
  return (date: string) => {
    const ym = parseBizDate(date)
    if (!ym) return true
    const k = `${ym.year}-${ym.month}`
    if (!cache.has(k)) cache.set(k, isCashierPeriodClosed(db, accountSetId, ym.year, ym.month))
    return cache.get(k)!
  }
}

function insertBatch(
  s: Scope, currency: string, type: MatchType, user: string | null,
  cashier: Array<{ id: string; amount: number }>, gl: Array<{ id: string; amount: number }>
): string {
  const { db, accountSetId, accountCode } = s
  const batchId = uuidv4()
  const ins = db.prepare(`
    INSERT INTO cashier_gl_match (id, account_set_id, account_code, currency, batch_id, side, ref_id, amount, match_type, created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?)`)
  const mark = db.prepare('UPDATE cashier_journal SET reconciled=1 WHERE id=? AND account_set_id=?')
  for (const c of cashier) {
    ins.run(uuidv4(), accountSetId, accountCode, currency, batchId, 'cashier', c.id, round2(c.amount), type, user)
    mark.run(c.id, accountSetId)
  }
  for (const g of gl) ins.run(uuidv4(), accountSetId, accountCode, currency, batchId, 'gl', g.id, round2(g.amount), type, user)
  return batchId
}

const dayDiff = (a: string, b: string) => Math.abs((Date.parse(a) - Date.parse(b)) / 86400000)
const signed = (r: { debit: number; credit: number }) => round2((r.debit || 0) - (r.credit || 0))

/**
 * 自动对账：① 关联匹配（出纳生成的凭证：日记账 voucher_id = 分录凭证，且净额一致）；
 * ② 金额匹配（同方向同金额、日期差 ≤ dayTolerance，一对一；票据号 / 摘要相同、日期更近的优先）。
 * 出纳已结账月份的行不参与。
 */
export function autoMatch(s: Scope, opts: { start?: string; end?: string; dayTolerance?: number; user?: string | null } = {}): {
  linked: number
  matched: number
  stale: number
} {
  const stale = pruneStaleMatches(s)
  const { currency } = scopeCurrency(s)
  const closed = closedChecker(s.db, s.accountSetId)
  const tol = Math.max(0, Math.min(31, Math.floor(Number(opts.dayTolerance) || 0)))
  const cashier = listCashierRows(s, { start: opts.start, end: opts.end, matched: false }).filter(r => !closed(r.biz_date))
  // 总账一侧放宽日期区间，允许与区间边界外 tol 天内的分录配对
  const shift = (d: string | undefined, days: number) => {
    if (!d) return d
    const t = new Date(Date.parse(d) + days * 86400000)
    return t.toISOString().slice(0, 10)
  }
  const gl = listGlEntries(s, { start: shift(opts.start, -tol), end: shift(opts.end, tol), matched: false }).rows
  const usedC = new Set<string>()
  const usedG = new Set<string>()
  let linked = 0
  let matched = 0
  s.db.transaction(() => {
    // ① 关联：同一张凭证上该科目的分录净额 = 该日记账净额
    const glByVoucher = new Map<string, GlEntryRow[]>()
    for (const g of gl) {
      if (!glByVoucher.has(g.voucher_id)) glByVoucher.set(g.voucher_id, [])
      glByVoucher.get(g.voucher_id)!.push(g)
    }
    for (const c of cashier) {
      if (!c.voucher_id) continue
      const entries = (glByVoucher.get(c.voucher_id) || []).filter(g => !usedG.has(g.id))
      if (!entries.length) continue
      // 优先单条分录金额相同；否则该凭证全部分录净额相同也算
      const one = entries.find(g => Math.abs(signed(g) - signed(c)) < EPS)
      const pick = one ? [one] : (Math.abs(entries.reduce((t, g) => t + signed(g), 0) - signed(c)) < EPS ? entries : [])
      if (!pick.length) continue
      insertBatch(s, currency, 'link', opts.user ?? null, [{ id: c.id, amount: signed(c) }], pick.map(g => ({ id: g.id, amount: signed(g) })))
      usedC.add(c.id)
      pick.forEach(g => usedG.add(g.id))
      linked++
    }
    // ② 金额：同净额、日期差 ≤ tol
    for (const c of cashier) {
      if (usedC.has(c.id)) continue
      const amt = signed(c)
      if (Math.abs(amt) < EPS) continue
      let best: GlEntryRow | null = null
      let bestScore = Infinity
      for (const g of gl) {
        if (usedG.has(g.id) || Math.abs(signed(g) - amt) >= EPS) continue
        const d = dayDiff(g.voucher_date, c.biz_date)
        if (d > tol) continue
        const gs = g.summary || ''
        const sameText = (c.bill_no && gs.includes(c.bill_no)) || (c.summary && gs === c.summary)
        const score = d * 10 - (sameText ? 5 : 0)
        if (score < bestScore) { best = g; bestScore = score }
      }
      if (!best) continue
      insertBatch(s, currency, 'auto', opts.user ?? null, [{ id: c.id, amount: amt }], [{ id: best.id, amount: signed(best) }])
      usedC.add(c.id)
      usedG.add(best.id)
      matched++
    }
  })()
  return { linked, matched, stale }
}

/** 手动对账：一对多 / 多对一，净额必须相等 */
export function manualMatch(s: Scope, journalIds: string[], entryIds: string[], user: string | null = null):
  { ok: true; batch_id: string } | { error: string } {
  const { db, accountSetId, accountCode } = s
  pruneStaleMatches(s)
  const jIds = [...new Set((journalIds || []).map(String))]
  const eIds = [...new Set((entryIds || []).map(String))]
  if (!jIds.length || !eIds.length) return { error: '请至少各选一条出纳日记账和总账分录' }
  if (jIds.length > 1 && eIds.length > 1) return { error: '只支持一对多或多对一：出纳或总账一方只能选 1 条' }
  const { currency, foreign } = scopeCurrency(s)

  const cRows: Array<{ id: string; amount: number }> = []
  for (const id of jIds) {
    const r = db.prepare(
      'SELECT id, biz_date, debit, credit, reconciled, account_code, currency FROM cashier_journal WHERE id=? AND account_set_id=?'
    ).get(id, accountSetId) as any
    if (!r) return { error: '出纳日记账记录不存在' }
    if (r.account_code !== accountCode || r.currency !== currency) return { error: '所选出纳日记账不属于当前科目' }
    if (r.reconciled) return { error: `出纳日记账 ${r.biz_date} 已对账` }
    try { assertCashierPeriodOpen(db, accountSetId, r.biz_date) } catch (e: any) { return { error: e.message } }
    cRows.push({ id, amount: signed(r) })
  }
  const gRows: Array<{ id: string; amount: number }> = []
  const matchedGl = db.prepare("SELECT 1 FROM cashier_gl_match WHERE side='gl' AND ref_id=?")
  for (const id of eIds) {
    const r = db.prepare(`
      SELECT ve.id, ve.account_code, ve.direction, ${glAmountSql(foreign)} AS amt,
             UPPER(COALESCE(ve.currency_code,'')) AS cur, v.status, v.voucher_date
      FROM voucher_entries ve JOIN vouchers v ON v.id=ve.voucher_id WHERE ve.id=? AND ve.account_set_id=?`
    ).get(id, accountSetId) as any
    if (!r) return { error: '总账分录不存在' }
    if (r.account_code !== accountCode || (foreign && r.cur !== currency.toUpperCase())) return { error: '所选总账分录不属于当前科目' }
    if (r.status !== 'posted') return { error: '只能与已记账凭证的分录对账' }
    if (matchedGl.get(id)) return { error: `总账分录（${r.voucher_date}）已对账` }
    gRows.push({ id, amount: round2(r.direction === 'debit' ? r.amt : -r.amt) })
  }
  const cSum = round2(cRows.reduce((t, r) => t + r.amount, 0))
  const gSum = round2(gRows.reduce((t, r) => t + r.amount, 0))
  if (Math.abs(cSum - gSum) > EPS) return { error: `金额不一致：出纳 ${cSum.toFixed(2)}，总账 ${gSum.toFixed(2)}` }
  let batchId = ''
  db.transaction(() => { batchId = insertBatch(s, currency, 'manual', user, cRows, gRows) })()
  return { ok: true, batch_id: batchId }
}

/** 撤销对账：按任一成员（出纳行 id 或分录 id）撤销整批 */
export function cancelMatch(s: Scope, refId: string): { ok: true } | { error: string } {
  const { db, accountSetId, accountCode } = s
  const m = db.prepare(
    'SELECT batch_id FROM cashier_gl_match WHERE account_set_id=? AND account_code=? AND ref_id=?'
  ).get(accountSetId, accountCode, refId) as { batch_id: string } | undefined
  if (!m) return { error: '该记录未对账' }
  const dates = db.prepare(`
    SELECT j.biz_date FROM cashier_gl_match m JOIN cashier_journal j ON j.id=m.ref_id
    WHERE m.account_set_id=? AND m.batch_id=? AND m.side='cashier'`).all(accountSetId, m.batch_id) as Array<{ biz_date: string }>
  try { for (const d of dates) assertCashierPeriodOpen(db, accountSetId, d.biz_date) } catch (e: any) { return { error: e.message } }
  db.transaction(() => dropBatch(db, accountSetId, m.batch_id))()
  return { ok: true }
}

/** 某批次的成员（页面点已对行时展示） */
export function getBatchMembers(s: Scope, batchId: string): { cashier: string[]; gl: string[]; match_type: MatchType | null } {
  const rows = s.db.prepare(
    'SELECT side, ref_id, match_type FROM cashier_gl_match WHERE account_set_id=? AND account_code=? AND batch_id=?'
  ).all(s.accountSetId, s.accountCode, batchId) as Array<{ side: 'cashier' | 'gl'; ref_id: string; match_type: MatchType }>
  return {
    cashier: rows.filter(r => r.side === 'cashier').map(r => r.ref_id),
    gl: rows.filter(r => r.side === 'gl').map(r => r.ref_id),
    match_type: rows[0]?.match_type ?? null,
  }
}

/** 本期汇总：出纳 / 总账 期间借贷与期末余额 */
export function getPeriodSummary(s: Scope, start?: string, end?: string) {
  // FIX-326：合计 / 未对行数一律 SQL 汇总（原先取两侧全部明细到 JS 求和）
  const c = sumCashierRows(s, { start, end })
  const cu = sumCashierRows(s, { start, end, matched: false })
  const g = sumGlEntries(s, { start, end })
  const gu = sumGlEntries(s, { start, end, matched: false })
  // 未指定截止日：余额算到「今天」与两侧最晚业务日期中较晚者，保证与明细口径一致
  let asOf = end || new Date().toISOString().slice(0, 10)
  if (!end) {
    const { currency, foreign } = scopeCurrency(s)
    const cMax = (s.db.prepare('SELECT MAX(biz_date) d FROM cashier_journal WHERE account_set_id=? AND account_code=? AND currency=?' + (start ? ' AND biz_date>=?' : ''))
      .get(s.accountSetId, s.accountCode, currency, ...(start ? [start] : [])) as { d: string | null }).d
    const gp: unknown[] = []
    const gMax = (s.db.prepare(`SELECT MAX(v.voucher_date) d FROM voucher_entries ve JOIN vouchers v ON v.id=ve.voucher_id WHERE ${glWhere(s, foreign, currency, gp, start)}`)
      .get(...gp) as { d: string | null }).d
    if (cMax && cMax > asOf) asOf = cMax
    if (gMax && gMax > asOf) asOf = gMax
  }
  const report = getCashierGlReport(s, asOf, { skipPrune: true, listLimit: 0 })
  return {
    currency: report.currency,
    cashier: { debit: c.debit, credit: c.credit, balance: report.cashier_balance, unmatched: cu.n, count: c.n },
    gl: { debit: g.debit, credit: g.credit, balance: report.gl_balance, unmatched: gu.n, count: g.n },
    unposted: countUnposted(s, start, end),
  }
}

export interface CashierGlReport {
  account_code: string
  currency: string
  end_date: string
  init_date: string | null
  /** 出纳余额 = 出纳期初 + 截至日日记账净额 */
  cashier_balance: number
  /** 总账余额 = 当年年初 + 当年截至日已记账发生额 */
  gl_balance: number
  /** 出纳有、总账无（未对出纳行） */
  cashier_unmatched: Array<{ id: string; biz_date: string; summary: string | null; debit: number; credit: number; bill_no: string | null }>
  /** 总账有、出纳无（未对已记账分录，日期 ≥ 出纳启用日） */
  gl_unmatched: Array<{ id: string; voucher_date: string; voucher_no: string; voucher_type_name: string | null; summary: string | null; debit: number; credit: number }>
  /** FIX-326：两侧未达总行数与净额（SQL 汇总，不受明细上限影响）；明细最多 list_limit 行 */
  cashier_unmatched_total: number
  gl_unmatched_total: number
  cashier_unmatched_net: number
  gl_unmatched_net: number
  list_limit: number
  adjusted_cashier: number
  adjusted_gl: number
  /** 调节后差额（≠0 通常是出纳期初与总账启用前余额不一致） */
  difference: number
  unposted: number
  stale: number
}

/** 差异清单（出纳 ↔ 总账） */
export function getCashierGlReport(s: Scope, endDate: string, opts: { skipPrune?: boolean; listLimit?: number } = {}): CashierGlReport {
  const { db, accountSetId, accountCode } = s
  const stale = opts.skipPrune ? 0 : pruneStaleMatches(s)
  const { currency, foreign } = scopeCurrency(s)
  const ib = db.prepare(
    'SELECT balance, init_date FROM cashier_init_balance WHERE account_set_id=? AND account_code=? AND currency=?'
  ).get(accountSetId, accountCode, currency) as { balance: number; init_date: string | null } | undefined
  const initDate = ib?.init_date ?? (db.prepare(
    'SELECT init_date FROM cashier_init_balance WHERE account_set_id=? AND init_date IS NOT NULL LIMIT 1'
  ).get(accountSetId) as { init_date: string } | undefined)?.init_date ?? null
  const j = db.prepare(`
    SELECT COALESCE(SUM(debit),0) d, COALESCE(SUM(credit),0) c FROM cashier_journal
    WHERE account_set_id=? AND account_code=? AND currency=? AND biz_date<=?`
  ).get(accountSetId, accountCode, currency, endDate) as { d: number; c: number }
  const cashierBalance = round2((ib?.balance ?? 0) + j.d - j.c)

  // 总账余额：截至日所在年度年初 + 当年截至日已记账发生额（末级科目；外币取原币）
  const year = Number(endDate.slice(0, 4)) || new Date().getFullYear()
  const acc = db.prepare('SELECT id, direction FROM accounts WHERE account_set_id=? AND code=?')
    .get(accountSetId, accountCode) as { id: string; direction: 'debit' | 'credit' } | undefined
  let glBalance = 0
  if (acc) {
    const init = (db.prepare(`
      SELECT COALESCE(SUM(${foreign ? 'foreign_init_balance' : 'init_balance'}),0) v FROM init_balances
      WHERE account_set_id=? AND account_id=? AND year=? AND (aux_item_id IS NULL OR aux_item_id='')`
    ).get(accountSetId, acc.id, year) as { v: number }).v
    const fp: unknown[] = []
    const where = glWhere(s, foreign, currency, fp, `${year}-01-01`, endDate)
    const amt = glAmountSql(foreign)
    const f = db.prepare(`
      SELECT COALESCE(SUM(CASE WHEN ve.direction='debit' THEN ${amt} ELSE 0 END),0) d,
             COALESCE(SUM(CASE WHEN ve.direction='credit' THEN ${amt} ELSE 0 END),0) c
      FROM voucher_entries ve JOIN vouchers v ON v.id=ve.voucher_id WHERE ${where}`
    ).get(...fp) as { d: number; c: number }
    glBalance = round2(calcSignedBalance(acc.direction, init, f.d, f.c))
  }

  // FIX-326：未达净额 SQL 汇总；明细按上限截取（listLimit=0 时不取明细，仅汇总用）
  const listLimit = opts.listLimit ?? GL_RECONCILE_LIST_LIMIT
  const cSum = sumCashierRows(s, { end: endDate, matched: false })
  const gSum = sumGlEntries(s, { start: initDate ?? undefined, end: endDate, matched: false })
  const cashierUnmatched = listLimit > 0
    ? listCashierRows(s, { end: endDate, matched: false, limit: listLimit })
      .map(({ id, biz_date, summary, debit, credit, bill_no }) => ({ id, biz_date, summary, debit, credit, bill_no }))
    : []
  const glUnmatched = listLimit > 0
    ? listGlEntries(s, { start: initDate ?? undefined, end: endDate, matched: false, limit: listLimit }).rows
      .map(({ id, voucher_date, voucher_no, voucher_type_name, summary, debit, credit }) =>
        ({ id, voucher_date, voucher_no, voucher_type_name, summary, debit, credit }))
    : []
  const cashierNet = round2(cSum.debit - cSum.credit)
  const glNet = round2(gSum.debit - gSum.credit)
  const adjustedCashier = round2(cashierBalance - cashierNet)
  const adjustedGl = round2(glBalance - glNet)
  return {
    account_code: accountCode,
    currency,
    end_date: endDate,
    init_date: initDate,
    cashier_balance: cashierBalance,
    gl_balance: glBalance,
    cashier_unmatched: cashierUnmatched,
    gl_unmatched: glUnmatched,
    cashier_unmatched_total: cSum.n,
    gl_unmatched_total: gSum.n,
    cashier_unmatched_net: cashierNet,
    gl_unmatched_net: glNet,
    list_limit: listLimit,
    adjusted_cashier: adjustedCashier,
    adjusted_gl: adjustedGl,
    difference: round2(adjustedCashier - adjustedGl),
    unposted: countUnposted(s, initDate ?? undefined, endDate),
    stale,
  }
}
