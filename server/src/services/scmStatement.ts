/**
 * 对账单（单据化，第四份反馈 Q2）。
 *
 * 口径：
 *  - 业务明细（line）：已审核的入库 / 出库 / 退货 / 委外 / 独立发票的明细行，金额取价税合计，退货为负；
 *    由来源单下推的发票行（有 source_line_id）只是校正来源单金额，不单独进对账单。
 *  - 收付款（log）：收付款单按明细写的往来台账行，作为冲减项。
 *  - 一行只能进一张对账单（唯一索引，草稿也算占用）；上次没勾的行下次生成时继续带出。
 *  - 对账单审核后，被引用的源单不能反审核；草稿对账单不拦截，源单反审核时自动移出草稿。
 */
import type Database from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'
import { todayStr } from '../utils/localDate.js'
import { arapSideSql } from './scmArAp.js'
import { nextAuxNo } from './scmNoRule.js'

export type StatementDirection = 'ar' | 'ap'

/** 各方向参与对账的业务单据类型（与往来台账口径一致） */
const LINE_DOC_TYPES: Record<StatementDirection, string[]> = {
  ap: ['PI', 'WI', 'OP', 'PR', 'RP', 'AS'],
  ar: ['SO', 'SR', 'RS', 'AS'],
}
/** 组装单（AS）按加工方式归属：受托加工 → 应收，委托加工 → 应付；只取成品行的加工费 */
const ASSEMBLY_MODE: Record<StatementDirection, string> = { ar: 'contract', ap: 'entrust' }
const PAYMENT_DOC_TYPE: Record<StatementDirection, string> = { ap: 'PAY', ar: 'RCV' }
const RETURN_TYPES = ['PR', 'SR']

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100

export interface StatementSourceRow {
  src_kind: 'line' | 'log'
  src_doc_id: string
  src_doc_type: string
  src_doc_no: string
  src_doc_date: string
  src_line_id: string | null
  src_log_id: string | null
  item_code: string | null
  item_name: string | null
  spec: string | null
  unit: string | null
  qty: number | null
  price: number | null
  amount: number
  tax_amount: number
  amount_with_tax: number
  sign: 1 | -1
  remark: string | null
  /** 已被哪张对账单占用（明细表 / 编辑时用） */
  statement_id?: string | null
  stmt_no?: string | null
  stmt_status?: string | null
}

function assertDirection(direction: any): StatementDirection {
  if (direction !== 'ar' && direction !== 'ap') throw new Error('对账方向无效（ar 应收 / ap 应付）')
  return direction
}

/** 应收对账单只能选客户、应付只能选供应商；「两者」或未设类型的单位不限（第五份反馈） */
function assertPartnerMatchesDirection(db: Database.Database, aid: string, partnerCode: string, direction: StatementDirection) {
  const p = db.prepare('SELECT name, partner_type FROM scm_partner WHERE account_set_id=? AND code=?').get(aid, partnerCode) as
    | { name: string; partner_type: string | null }
    | undefined
  const t = String(p?.partner_type || '')
  if (!p || !t || t === 'both') return
  if (direction === 'ar' && t === 'supplier') throw new Error(`${partnerCode} ${p.name} 是供应商，不能做应收对账单`)
  if (direction === 'ap' && t === 'customer') throw new Error(`${partnerCode} ${p.name} 是客户，不能做应付对账单`)
}

interface SourceQuery {
  direction: StatementDirection
  partner_code?: string
  date_from?: string
  date_to?: string
  /** 只取未被占用的行；传入 statement_id 时，本单已占用的行也算可选 */
  onlyFree?: boolean
  statement_id?: string
  /** 指定行（保存时按 id 取快照） */
  line_ids?: string[]
  log_ids?: string[]
}

/** 统一取「可对账来源行」：业务明细行 + 收付款台账行，左连已占用的对账单 */
function querySourceRows(db: Database.Database, aid: string, q: SourceQuery): StatementSourceRow[] {
  const lineTypes = LINE_DOC_TYPES[q.direction]
  const payType = PAYMENT_DOC_TYPE[q.direction]
  const out: StatementSourceRow[] = []

  // ── 业务明细行 ──
  if (!q.log_ids || q.line_ids) {
    const conds = [`d.account_set_id=?`, `d.status='audited'`, `d.doc_type IN (${lineTypes.map(() => '?').join(',')})`,
      // 下推发票行只校正来源单金额，不单独对账
      `NOT (d.doc_type IN ('RP','RS') AND l.source_line_id IS NOT NULL)`,
      `(d.doc_type<>'AS' OR (l.line_role='product' AND d.process_mode=? AND COALESCE(l.process_fee,0)*COALESCE(l.qty,0)>0))`]
    const ps: any[] = [aid, ...lineTypes, ASSEMBLY_MODE[q.direction]]
    if (q.partner_code) { conds.push('d.partner_code=?'); ps.push(q.partner_code) }
    if (q.date_from) { conds.push('d.doc_date>=?'); ps.push(q.date_from) }
    if (q.date_to) { conds.push('d.doc_date<=?'); ps.push(q.date_to) }
    if (q.line_ids) {
      if (!q.line_ids.length) conds.push('1=0')
      else { conds.push(`l.id IN (${q.line_ids.map(() => '?').join(',')})`); ps.push(...q.line_ids) }
    }
    if (q.onlyFree) {
      conds.push(`(sl.id IS NULL${q.statement_id ? ' OR sl.statement_id=?' : ''})`)
      if (q.statement_id) ps.push(q.statement_id)
    }
    const rows = db.prepare(`SELECT l.id AS line_id, d.id AS doc_id, d.doc_type, d.doc_no, d.doc_date, d.partner_code,
        l.item_code, i.name AS item_name, i.spec, i.unit, l.qty, l.price, l.amount, l.tax_amount, l.remark, l.process_fee,
        sl.statement_id, s.stmt_no, s.status AS stmt_status
      FROM scm_doc_line l
      JOIN scm_doc d ON d.id=l.doc_id
      LEFT JOIN scm_item i ON i.account_set_id=d.account_set_id AND i.code=l.item_code
      LEFT JOIN scm_statement_line sl ON sl.account_set_id=d.account_set_id AND sl.src_line_id=l.id
      LEFT JOIN scm_statement s ON s.id=sl.statement_id
      WHERE ${conds.join(' AND ')}
      ORDER BY d.doc_date, d.doc_no, l.seq`).all(...ps) as any[]
    for (const r of rows) {
      const sign: 1 | -1 = RETURN_TYPES.includes(r.doc_type) ? -1 : 1
      // 组装单：对账金额 = 数量 × 加工单价（不含税），税额取加工费税额
      const isAs = r.doc_type === 'AS'
      if (isAs) r.price = Number(r.process_fee) || 0
      const amount = isAs ? r2((Number(r.qty) || 0) * r.price) : r2(r.amount), tax = r2(r.tax_amount)
      out.push({
        src_kind: 'line', src_doc_id: r.doc_id, src_doc_type: r.doc_type, src_doc_no: r.doc_no, src_doc_date: r.doc_date,
        src_line_id: r.line_id, src_log_id: null,
        item_code: r.item_code || null, item_name: r.item_name || null, spec: r.spec || null, unit: r.unit || null,
        qty: r.qty == null ? null : Number(r.qty), price: r.price == null ? null : Number(r.price),
        amount, tax_amount: tax, amount_with_tax: r2(amount + tax), sign, remark: r.remark || null,
        statement_id: r.statement_id || null, stmt_no: r.stmt_no || null, stmt_status: r.stmt_status || null,
      })
    }
  }

  // ── 收付款台账行 ──
  if (!q.line_ids || q.log_ids) {
    const conds = [`lg.account_set_id=?`, `lg.doc_type=?`, `lg.direction='out'`, `d.status='audited'`]
    const ps: any[] = [aid, payType]
    if (q.partner_code) { conds.push('lg.partner_code=?'); ps.push(q.partner_code) }
    if (q.date_from) { conds.push('lg.doc_date>=?'); ps.push(q.date_from) }
    if (q.date_to) { conds.push('lg.doc_date<=?'); ps.push(q.date_to) }
    if (q.log_ids) {
      if (!q.log_ids.length) conds.push('1=0')
      else { conds.push(`lg.id IN (${q.log_ids.map(() => '?').join(',')})`); ps.push(...q.log_ids) }
    }
    if (q.onlyFree) {
      conds.push(`(sl.id IS NULL${q.statement_id ? ' OR sl.statement_id=?' : ''})`)
      if (q.statement_id) ps.push(q.statement_id)
    }
    const rows = db.prepare(`SELECT lg.id AS log_id, d.id AS doc_id, lg.doc_type, lg.doc_no, lg.doc_date,
        COALESCE(lg.amount_fc, lg.amount) AS amount, lg.remark,
        sl.statement_id, s.stmt_no, s.status AS stmt_status
      FROM scm_ar_ap_log lg
      JOIN scm_doc d ON d.account_set_id=lg.account_set_id AND d.doc_type=lg.doc_type AND d.doc_no=lg.doc_no
      LEFT JOIN scm_statement_line sl ON sl.account_set_id=lg.account_set_id AND sl.src_log_id=lg.id
      LEFT JOIN scm_statement s ON s.id=sl.statement_id
      WHERE ${conds.join(' AND ')}
      ORDER BY lg.doc_date, lg.doc_no, lg.rowid`).all(...ps) as any[]
    for (const r of rows) {
      const amount = r2(r.amount)
      out.push({
        src_kind: 'log', src_doc_id: r.doc_id, src_doc_type: r.doc_type, src_doc_no: r.doc_no, src_doc_date: r.doc_date,
        src_line_id: null, src_log_id: r.log_id,
        item_code: null, item_name: null, spec: null, unit: null, qty: null, price: null,
        amount, tax_amount: 0, amount_with_tax: amount, sign: -1, remark: r.remark || null,
        statement_id: r.statement_id || null, stmt_no: r.stmt_no || null, stmt_status: r.stmt_status || null,
      })
    }
  }
  out.sort((a, b) => String(a.src_doc_date).localeCompare(String(b.src_doc_date)) || String(a.src_doc_no).localeCompare(String(b.src_doc_no)))
  return out
}

/** 截止日往来余额（in − out，按应收 / 应付口径） */
export function partnerLedgerBalance(db: Database.Database, aid: string, direction: StatementDirection, partnerCode: string, endDate: string): number {
  // 往来余额口径同 scmArAp（arap_side 优先，否则按单据类型）
  const row = db.prepare(`SELECT SUM(CASE WHEN direction='in' THEN COALESCE(amount_fc, amount) ELSE -COALESCE(amount_fc, amount) END) AS bal
    FROM scm_ar_ap_log WHERE account_set_id=? AND partner_code=? AND doc_date<=? AND ${arapSideSql()}=?`)
    .get(aid, partnerCode, endDate, direction) as any
  return r2(row?.bal)
}

/** 生成对账单时的候选行：截止日（含）之前、未被其他对账单占用的明细 */
export function getStatementCandidates(db: Database.Database, aid: string, params: {
  direction: string; partner_code: string; end_date: string; start_date?: string; statement_id?: string
}) {
  const direction = assertDirection(params.direction)
  if (!params.partner_code) throw new Error('请选择往来单位')
  if (!params.end_date) throw new Error('请选择截止日期')
  const rows = querySourceRows(db, aid, {
    direction, partner_code: params.partner_code, date_from: params.start_date || undefined, date_to: params.end_date,
    onlyFree: true, statement_id: params.statement_id,
  })
  return {
    rows: rows.map(r => ({ ...r, selected_by_self: !!params.statement_id && r.statement_id === params.statement_id })),
    ledger_balance: partnerLedgerBalance(db, aid, direction, params.partner_code, params.end_date),
  }
}

function nextStatementNo(db: Database.Database, aid: string, date: string): string {
  const custom = nextAuxNo(db, aid, 'DZ', 'scm_statement', 'stmt_no', date)
  if (custom) return custom
  const ym = /^(\d{4})-(\d{2})/.exec(date || '') || /^(\d{4})-(\d{2})/.exec(todayStr())!
  const prefix = `DZ-${ym[1]}${ym[2]}-`
  const rows = db.prepare('SELECT stmt_no FROM scm_statement WHERE account_set_id=? AND stmt_no LIKE ?').all(aid, `${prefix}%`) as any[]
  let max = 0
  for (const r of rows) {
    const m = String(r.stmt_no).match(/(\d+)$/)
    if (m) max = Math.max(max, parseInt(m[1], 10))
  }
  return prefix + String(max + 1).padStart(3, '0')
}

export interface StatementInput {
  direction: string
  partner_code: string
  stmt_date?: string
  start_date?: string | null
  end_date: string
  remark?: string | null
  /** 勾选的来源行 */
  lines: Array<{ src_kind: 'line' | 'log'; src_line_id?: string | null; src_log_id?: string | null }>
}

/** 按勾选的来源 id 取最新快照并校验归属 / 占用 */
function buildSnapshot(db: Database.Database, aid: string, input: StatementInput, selfId?: string) {
  const direction = assertDirection(input.direction)
  if (!input.partner_code) throw new Error('请选择往来单位')
  assertPartnerMatchesDirection(db, aid, input.partner_code, direction)
  if (!input.end_date) throw new Error('请选择截止日期')
  const lineIds = [...new Set((input.lines || []).filter(l => l.src_kind === 'line' && l.src_line_id).map(l => String(l.src_line_id)))]
  const logIds = [...new Set((input.lines || []).filter(l => l.src_kind === 'log' && l.src_log_id).map(l => String(l.src_log_id)))]
  if (!lineIds.length && !logIds.length) throw new Error('请至少勾选一行明细')
  const rows = querySourceRows(db, aid, { direction, partner_code: input.partner_code, date_to: input.end_date, line_ids: lineIds, log_ids: logIds })
  const found = new Set(rows.map(r => r.src_line_id || r.src_log_id))
  const missing = [...lineIds, ...logIds].filter(id => !found.has(id))
  if (missing.length) throw new Error(`有 ${missing.length} 行明细已不可对账（源单已反审核、不属于该往来单位或晚于截止日），请重新取明细`)
  const taken = rows.filter(r => r.statement_id && r.statement_id !== selfId)
  if (taken.length) {
    const nos = [...new Set(taken.map(r => r.stmt_no))].join('、')
    throw new Error(`有 ${taken.length} 行明细已在对账单 ${nos} 中，不能重复对账`)
  }
  const docAmount = r2(rows.filter(r => r.src_kind === 'line').reduce((s, r) => s + r.amount_with_tax * r.sign, 0))
  const paymentAmount = r2(rows.filter(r => r.src_kind === 'log').reduce((s, r) => s + r.amount_with_tax, 0))
  return { direction, rows, docAmount, paymentAmount, netAmount: r2(docAmount - paymentAmount) }
}

function writeLines(db: Database.Database, aid: string, statementId: string, rows: StatementSourceRow[]) {
  db.prepare('DELETE FROM scm_statement_line WHERE statement_id=?').run(statementId)
  const ins = db.prepare(`INSERT INTO scm_statement_line
    (id, account_set_id, statement_id, seq, src_kind, src_doc_id, src_doc_type, src_doc_no, src_doc_date, src_line_id, src_log_id,
     item_code, item_name, spec, unit, qty, price, amount, tax_amount, amount_with_tax, sign, remark)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
  rows.forEach((r, i) => ins.run(uuidv4(), aid, statementId, i + 1, r.src_kind, r.src_doc_id, r.src_doc_type, r.src_doc_no, r.src_doc_date,
    r.src_line_id, r.src_log_id, r.item_code, r.item_name, r.spec, r.unit, r.qty, r.price, r.amount, r.tax_amount, r.amount_with_tax, r.sign, r.remark))
}

function uniqueError(e: any): never {
  if (/UNIQUE constraint failed: scm_statement_line/.test(String(e?.message || ''))) {
    throw new Error('有明细已被其他对账单占用，请重新取明细')
  }
  throw e
}

export function createStatement(db: Database.Database, aid: string, input: StatementInput, operator: string) {
  const run = db.transaction(() => {
    const snap = buildSnapshot(db, aid, input)
    const id = uuidv4()
    const stmtDate = input.stmt_date || todayStr()
    const no = nextStatementNo(db, aid, stmtDate)
    db.prepare(`INSERT INTO scm_statement (id, account_set_id, stmt_no, stmt_date, direction, partner_code, start_date, end_date,
        doc_amount, payment_amount, net_amount, ledger_balance, status, remark, maker)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'draft',?,?)`).run(
      id, aid, no, stmtDate, snap.direction, input.partner_code, input.start_date || null, input.end_date,
      snap.docAmount, snap.paymentAmount, snap.netAmount,
      partnerLedgerBalance(db, aid, snap.direction, input.partner_code, input.end_date), input.remark || null, operator || null)
    writeLines(db, aid, id, snap.rows)
    return { id, stmt_no: no }
  })
  try { return run.immediate() } catch (e) { uniqueError(e) }
}

function getHead(db: Database.Database, aid: string, id: string) {
  const s = db.prepare('SELECT * FROM scm_statement WHERE id=? AND account_set_id=?').get(id, aid) as any
  if (!s) throw new Error('对账单不存在')
  return s
}

export function updateStatement(db: Database.Database, aid: string, id: string, input: StatementInput) {
  const run = db.transaction(() => {
    const s = getHead(db, aid, id)
    if (s.status !== 'draft') throw new Error('仅草稿对账单可修改')
    const snap = buildSnapshot(db, aid, input, id)
    db.prepare(`UPDATE scm_statement SET stmt_date=?, direction=?, partner_code=?, start_date=?, end_date=?, doc_amount=?, payment_amount=?,
        net_amount=?, ledger_balance=?, remark=?, updated_at=datetime('now') WHERE id=?`).run(
      input.stmt_date || s.stmt_date, snap.direction, input.partner_code, input.start_date || null, input.end_date,
      snap.docAmount, snap.paymentAmount, snap.netAmount,
      partnerLedgerBalance(db, aid, snap.direction, input.partner_code, input.end_date), input.remark ?? null, id)
    writeLines(db, aid, id, snap.rows)
    return { id, stmt_no: s.stmt_no }
  })
  try { return run.immediate() } catch (e) { uniqueError(e) }
}

export function deleteStatement(db: Database.Database, aid: string, id: string) {
  const s = getHead(db, aid, id)
  if (s.status !== 'draft') throw new Error('已审核的对账单不能删除，请先反审核')
  db.transaction(() => {
    db.prepare('DELETE FROM scm_statement_line WHERE statement_id=?').run(id)
    db.prepare('DELETE FROM scm_statement WHERE id=?').run(id)
  })()
  return { ok: true }
}

export function auditStatement(db: Database.Database, aid: string, id: string, operator: string) {
  const s = getHead(db, aid, id)
  if (s.status !== 'draft') throw new Error('仅草稿对账单可审核')
  const cnt = (db.prepare('SELECT COUNT(*) c FROM scm_statement_line WHERE statement_id=?').get(id) as any).c
  if (!cnt) throw new Error('对账单没有明细，不能审核')
  db.prepare(`UPDATE scm_statement SET status='audited', auditor=?, audited_at=datetime('now') WHERE id=?`).run(operator || null, id)
  return { ok: true }
}

export function unauditStatement(db: Database.Database, aid: string, id: string) {
  const s = getHead(db, aid, id)
  if (s.status !== 'audited') throw new Error('仅已审核对账单可反审核')
  db.prepare(`UPDATE scm_statement SET status='draft', auditor=NULL, audited_at=NULL WHERE id=?`).run(id)
  return { ok: true }
}

export function getStatement(db: Database.Database, aid: string, id: string) {
  const s = db.prepare(`SELECT s.*, p.name AS partner_name FROM scm_statement s
    LEFT JOIN scm_partner p ON p.account_set_id=s.account_set_id AND p.code=s.partner_code
    WHERE s.id=? AND s.account_set_id=?`).get(id, aid) as any
  if (!s) return null
  s.lines = db.prepare('SELECT * FROM scm_statement_line WHERE statement_id=? ORDER BY seq').all(id)
  return s
}

export function listStatements(db: Database.Database, aid: string, q: {
  direction?: string; partner_code?: string; status?: string; keyword?: string; date_from?: string; date_to?: string
  page?: number; page_size?: number
}) {
  const conds = ['s.account_set_id=?']; const ps: any[] = [aid]
  if (q.direction === 'ar' || q.direction === 'ap') { conds.push('s.direction=?'); ps.push(q.direction) }
  if (q.partner_code) { conds.push('s.partner_code=?'); ps.push(q.partner_code) }
  if (q.status) { conds.push('s.status=?'); ps.push(q.status) }
  if (q.date_from) { conds.push('s.stmt_date>=?'); ps.push(q.date_from) }
  if (q.date_to) { conds.push('s.stmt_date<=?'); ps.push(q.date_to) }
  if (q.keyword) {
    conds.push('(s.stmt_no LIKE ? OR s.partner_code LIKE ? OR p.name LIKE ? OR s.remark LIKE ?)')
    ps.push(...Array(4).fill(`%${q.keyword}%`))
  }
  const where = conds.join(' AND ')
  const total = (db.prepare(`SELECT COUNT(*) c FROM scm_statement s LEFT JOIN scm_partner p ON p.account_set_id=s.account_set_id AND p.code=s.partner_code WHERE ${where}`).get(...ps) as any).c
  const size = Math.min(500, Math.max(1, Number(q.page_size) || 50))
  const page = Math.max(1, Number(q.page) || 1)
  const list = db.prepare(`SELECT s.*, p.name AS partner_name,
      (SELECT COUNT(*) FROM scm_statement_line sl WHERE sl.statement_id=s.id) AS line_count
    FROM scm_statement s LEFT JOIN scm_partner p ON p.account_set_id=s.account_set_id AND p.code=s.partner_code
    WHERE ${where} ORDER BY s.stmt_date DESC, s.stmt_no DESC LIMIT ? OFFSET ?`).all(...ps, size, (page - 1) * size)
  return { list, total }
}

/**
 * 对账明细表：某时间范围内某方向（可选往来单位）的全部可对账明细，标注已对账 / 对账中 / 未对账。
 * status：reconciled 已对账（对账单已审核）/ pending 对账中（草稿）/ unreconciled 未对账 / 空=全部
 */
export function getStatementDetailReport(db: Database.Database, aid: string, q: {
  direction: string; partner_code?: string; date_from?: string; date_to?: string; status?: string
}) {
  const direction = assertDirection(q.direction)
  const rows = querySourceRows(db, aid, { direction, partner_code: q.partner_code || undefined, date_from: q.date_from || undefined, date_to: q.date_to || undefined })
  const docIds = [...new Set(rows.map(r => r.src_doc_id))]
  const partnerByDoc = new Map<string, { code: string; name: string }>()
  if (docIds.length) {
    for (let i = 0; i < docIds.length; i += 500) {
      const chunk = docIds.slice(i, i + 500)
      const ds = db.prepare(`SELECT d.id, d.partner_code, p.name FROM scm_doc d
        LEFT JOIN scm_partner p ON p.account_set_id=d.account_set_id AND p.code=d.partner_code
        WHERE d.id IN (${chunk.map(() => '?').join(',')})`).all(...chunk) as any[]
      for (const d of ds) partnerByDoc.set(d.id, { code: d.partner_code, name: d.name || '' })
    }
  }
  const withStatus = rows.map(r => {
    const recon_status = !r.statement_id ? 'unreconciled' : r.stmt_status === 'audited' ? 'reconciled' : 'pending'
    const p = partnerByDoc.get(r.src_doc_id)
    return { ...r, recon_status, partner_code: p?.code || '', partner_name: p?.name || '', signed_amount: r2(r.amount_with_tax * r.sign) }
  })
  const list = q.status ? withStatus.filter(r => r.recon_status === q.status) : withStatus
  const sum = (arr: typeof list) => r2(arr.reduce((s, r) => s + r.signed_amount, 0))
  return {
    list,
    summary: {
      total: sum(list),
      reconciled: sum(list.filter(r => r.recon_status === 'reconciled')),
      pending: sum(list.filter(r => r.recon_status === 'pending')),
      unreconciled: sum(list.filter(r => r.recon_status === 'unreconciled')),
    },
  }
}

/**
 * 源单反审核前的对账单检查：被已审核对账单引用 → 返回拦截原因；
 * 只被草稿对账单引用 → 返回这些草稿，由调用方在反审核事务里调用 releaseDocFromDraftStatements 移出。
 */
export function getDocStatementLock(db: Database.Database, aid: string, docId: string): { error: string | null; drafts: string[] } {
  const rows = db.prepare(`SELECT DISTINCT s.id, s.stmt_no, s.status FROM scm_statement_line sl
    JOIN scm_statement s ON s.id=sl.statement_id
    WHERE sl.account_set_id=? AND sl.src_doc_id=?`).all(aid, docId) as any[]
  const audited = rows.filter(r => r.status === 'audited').map(r => r.stmt_no)
  if (audited.length) return { error: `该单据已被对账单 ${audited.join('、')} 锁定，请先反审核对账单`, drafts: [] }
  return { error: null, drafts: rows.map(r => r.stmt_no) }
}

/** 把源单的行从草稿对账单移出，并重算这些草稿的合计 */
export function releaseDocFromDraftStatements(db: Database.Database, aid: string, docId: string): string[] {
  const stmts = db.prepare(`SELECT DISTINCT s.id, s.stmt_no FROM scm_statement_line sl JOIN scm_statement s ON s.id=sl.statement_id
    WHERE sl.account_set_id=? AND sl.src_doc_id=? AND s.status='draft'`).all(aid, docId) as any[]
  if (!stmts.length) return []
  db.prepare(`DELETE FROM scm_statement_line WHERE account_set_id=? AND src_doc_id=?
    AND statement_id IN (SELECT id FROM scm_statement WHERE status='draft')`).run(aid, docId)
  const upd = db.prepare(`UPDATE scm_statement SET doc_amount=?, payment_amount=?, net_amount=?, updated_at=datetime('now') WHERE id=?`)
  for (const s of stmts) {
    const t = db.prepare(`SELECT
        COALESCE(SUM(CASE WHEN src_kind='line' THEN amount_with_tax*sign ELSE 0 END),0) AS doc_amount,
        COALESCE(SUM(CASE WHEN src_kind='log' THEN amount_with_tax ELSE 0 END),0) AS payment_amount
      FROM scm_statement_line WHERE statement_id=?`).get(s.id) as any
    upd.run(r2(t.doc_amount), r2(t.payment_amount), r2(t.doc_amount - t.payment_amount), s.id)
  }
  return stmts.map(s => s.stmt_no)
}

/** 单据被哪些对账单引用（单据页显示「已对账：DZ-xxx」） */
export function getDocStatements(db: Database.Database, aid: string, docId: string) {
  return db.prepare(`SELECT DISTINCT s.id, s.stmt_no, s.status FROM scm_statement_line sl
    JOIN scm_statement s ON s.id=sl.statement_id WHERE sl.account_set_id=? AND sl.src_doc_id=? ORDER BY s.stmt_no`).all(aid, docId) as any[]
}
