/**
 * 应交税金(增值税)明细账：把「应交增值税」下各末级科目的分录分列到借/贷多栏。
 *
 * 余额口径：按贷方性质轧差（余额 = 期初 + 贷方合计 − 借方合计），正数记「贷」、负数记「借」、零记「平」，
 * 与 ledgerQuery 中应交税费异方向子科目轧差到父科目的做法一致。
 */
import type Database from 'better-sqlite3'
import {
  VAT_COLUMN_SPECS,
  VAT_LEDGER_PARAM_KEY,
  VAT_PARENT_CODES,
  VAT_PARENT_NAMES,
  type VatColumnSpec,
} from '../config/vatLedger.js'
import { buildInitBalanceSumExpr, buildPreBookSumExpr, resolvePreBookDate } from './initBalanceScope.js'

export interface VatColumnSetting {
  key: string
  accountCode: string
  printName: string
  printNameEn: string
}

export interface ResolvedVatColumn {
  key: string
  label: string
  side: 'debit' | 'credit'
  accountId: string
  accountCode: string
  accountName: string
  /** 科目全称路径，如「应交税费\应交增值税\进项税额」 */
  accountPath: string
  printName: string
  printNameEn: string
  /** param：用户设置；code：默认编码命中；name：按名称探测；none：未找到 */
  source: 'param' | 'code' | 'name' | 'none'
}

interface AccountRow {
  id: string
  code: string
  name: string
  direction: 'debit' | 'credit'
  parent_id: string | null
}

function pickBest(db: Database.Database, accountSetId: string, rows: AccountRow[]): AccountRow | undefined {
  if (rows.length <= 1) return rows[0]
  const hasChild = db.prepare(
    'SELECT 1 FROM accounts WHERE account_set_id=? AND code<>? AND code LIKE ? LIMIT 1'
  )
  const scored = rows.map(row => ({ row, leaf: hasChild.get(accountSetId, row.code, `${row.code}%`) ? 0 : 1 }))
  scored.sort(
    (a, b) => b.leaf - a.leaf || a.row.code.length - b.row.code.length || a.row.code.localeCompare(b.row.code)
  )
  return scored[0].row
}

const ACCOUNT_COLS = 'id, code, name, direction, parent_id'

function findByCode(db: Database.Database, accountSetId: string, code: string): AccountRow | undefined {
  return db
    .prepare(`SELECT ${ACCOUNT_COLS} FROM accounts WHERE account_set_id=? AND code=? LIMIT 1`)
    .get(accountSetId, code) as AccountRow | undefined
}

function nameLooksRight(spec: VatColumnSpec, name: string): boolean {
  const text = String(name || '')
  if (!text) return false
  if ((spec.excludes || []).some(w => text.includes(w))) return false
  return spec.names.some(n => text.includes(n) || n.includes(text))
}

function findByNames(db: Database.Database, accountSetId: string, spec: VatColumnSpec): AccountRow | undefined {
  const excluded = (name: string) => (spec.excludes || []).some(w => name.includes(w))
  const exact = db.prepare(`SELECT ${ACCOUNT_COLS} FROM accounts WHERE account_set_id=? AND name=?`)
  for (const name of spec.names) {
    const rows = (exact.all(accountSetId, name) as AccountRow[]).filter(r => !excluded(r.name))
    const best = pickBest(db, accountSetId, rows)
    if (best) return best
  }
  const like = db.prepare(`SELECT ${ACCOUNT_COLS} FROM accounts WHERE account_set_id=? AND name LIKE ?`)
  for (const name of spec.names) {
    const rows = (like.all(accountSetId, `%${name}%`) as AccountRow[]).filter(r => !excluded(r.name))
    const best = pickBest(db, accountSetId, rows)
    if (best) return best
  }
  return undefined
}

/** 沿 parent_id 向上拼科目全称；parent_id 缺失时按编码前缀回退 */
function buildAccountPath(db: Database.Database, accountSetId: string, account: AccountRow): string {
  const names: string[] = [account.name]
  const byId = db.prepare(`SELECT ${ACCOUNT_COLS} FROM accounts WHERE id=? LIMIT 1`)
  const byCode = db.prepare(`SELECT ${ACCOUNT_COLS} FROM accounts WHERE account_set_id=? AND code=? LIMIT 1`)
  let cur: AccountRow | undefined = account
  let guard = 0
  while (cur && guard++ < 10) {
    let parent: AccountRow | undefined
    if (cur.parent_id) parent = byId.get(cur.parent_id) as AccountRow | undefined
    if (!parent) {
      // 编码前缀回退：逐位缩短，命中最长的上级
      const code = cur.code
      for (let len = code.length - 1; len >= 1 && !parent; len--) {
        const candidate = code.slice(0, len).replace(/\.$/, '')
        if (!candidate || candidate === code) continue
        parent = byCode.get(accountSetId, candidate) as AccountRow | undefined
      }
    }
    if (!parent) break
    names.unshift(parent.name)
    cur = parent
  }
  return names.join('\\')
}

export function readVatColumnSettings(db: Database.Database, accountSetId: string): VatColumnSetting[] {
  const row = db
    .prepare('SELECT param_value FROM system_params WHERE account_set_id=? AND param_key=?')
    .get(accountSetId, VAT_LEDGER_PARAM_KEY) as { param_value?: string } | undefined
  if (!row?.param_value) return []
  try {
    const parsed = JSON.parse(row.param_value)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter(item => item && typeof item.key === 'string')
      .map(item => ({
        key: String(item.key),
        accountCode: String(item.accountCode ?? '').trim(),
        printName: String(item.printName ?? '').trim(),
        printNameEn: String(item.printNameEn ?? '').trim(),
      }))
  } catch {
    return []
  }
}

export function saveVatColumnSettings(
  db: Database.Database,
  accountSetId: string,
  settings: VatColumnSetting[],
  newId: () => string
) {
  const allowed = new Set(VAT_COLUMN_SPECS.map(s => s.key))
  const cleaned = settings
    .filter(s => s && allowed.has(String(s.key)))
    .map(s => ({
      key: String(s.key),
      accountCode: String(s.accountCode ?? '').trim(),
      printName: String(s.printName ?? '').trim(),
      printNameEn: String(s.printNameEn ?? '').trim(),
    }))
  const existing = db
    .prepare('SELECT id FROM system_params WHERE account_set_id=? AND param_key=?')
    .get(accountSetId, VAT_LEDGER_PARAM_KEY) as { id: string } | undefined
  const value = JSON.stringify(cleaned)
  if (existing) {
    db.prepare('UPDATE system_params SET param_value=? WHERE id=?').run(value, existing.id)
  } else {
    db.prepare(
      'INSERT INTO system_params (id, account_set_id, param_key, param_value) VALUES (?, ?, ?, ?)'
    ).run(newId(), accountSetId, VAT_LEDGER_PARAM_KEY, value)
  }
  return cleaned
}

/** 解析 8 栏对应的科目：用户设置 → 默认编码（名称须相符）→ 按名称探测 */
export function resolveVatColumns(db: Database.Database, accountSetId: string): ResolvedVatColumn[] {
  const saved = new Map(readVatColumnSettings(db, accountSetId).map(s => [s.key, s]))
  return VAT_COLUMN_SPECS.map(spec => {
    const setting = saved.get(spec.key)
    let account: AccountRow | undefined
    let source: ResolvedVatColumn['source'] = 'none'
    if (setting?.accountCode) {
      account = findByCode(db, accountSetId, setting.accountCode)
      source = 'param'
    } else {
      for (const code of spec.codes) {
        const hit = findByCode(db, accountSetId, code)
        if (hit && nameLooksRight(spec, hit.name)) {
          account = hit
          source = 'code'
          break
        }
      }
      if (!account) {
        account = findByNames(db, accountSetId, spec)
        if (account) source = 'name'
      }
    }
    return {
      key: spec.key,
      label: spec.label,
      side: spec.side,
      accountId: account?.id || '',
      accountCode: account?.code || setting?.accountCode || '',
      accountName: account?.name || '',
      accountPath: account ? buildAccountPath(db, accountSetId, account) : '',
      printName: setting?.printName || spec.printName,
      printNameEn: setting?.printNameEn || spec.printNameEn,
      source: account ? source : 'none',
    }
  })
}

/** 「应交增值税」父科目（用于标题/说明，找不到返回 undefined） */
export function findVatParentAccount(db: Database.Database, accountSetId: string): AccountRow | undefined {
  for (const code of VAT_PARENT_CODES) {
    const hit = findByCode(db, accountSetId, code)
    if (hit && VAT_PARENT_NAMES.some(n => hit.name.includes(n))) return hit
  }
  const like = db.prepare(`SELECT ${ACCOUNT_COLS} FROM accounts WHERE account_set_id=? AND name LIKE ? ORDER BY code`)
  for (const n of VAT_PARENT_NAMES) {
    const rows = like.all(accountSetId, `%${n}%`) as AccountRow[]
    // 取编码最短的（最上级）
    rows.sort((a, b) => a.code.length - b.code.length || a.code.localeCompare(b.code))
    if (rows[0]) return rows[0]
  }
  return undefined
}

export type VatLedgerRowType = 'init' | 'entry' | 'month_total' | 'year_total'

export interface VatLedgerRow {
  row_type: VatLedgerRowType
  voucher_date: string
  year: number | ''
  month: number | ''
  day: number | ''
  voucher_id: string
  voucher_no: string
  voucher_type_name: string
  voucher_status: string
  summary: string
  account_id: string
  account_code: string
  account_name: string
  /** 各栏金额（key → 金额），与栏位方向相反的分录记负数 */
  amounts: Record<string, number>
  debit_total: number
  credit_total: number
  /** 贷方性质余额：正=贷，负=借 */
  balance: number
  direction_label: '借' | '贷' | '平' | ''
}

export interface VatLedgerQueryInput {
  accountSetId: string
  year: number
  startMonth: number
  endMonth: number
  includeUnposted?: boolean
  accountSetStartDate?: string
  preBookEnabled?: boolean
}

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100

function lastDayOfMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

function dirLabel(balance: number): VatLedgerRow['direction_label'] {
  if (Math.abs(balance) < 0.005) return '平'
  return balance > 0 ? '贷' : '借'
}

function emptyAmounts(columns: ResolvedVatColumn[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const c of columns) out[c.key] = 0
  return out
}

function makeRow(columns: ResolvedVatColumn[], partial: Partial<VatLedgerRow>): VatLedgerRow {
  return {
    row_type: 'entry',
    voucher_date: '',
    year: '',
    month: '',
    day: '',
    voucher_id: '',
    voucher_no: '',
    voucher_type_name: '',
    voucher_status: '',
    summary: '',
    account_id: '',
    account_code: '',
    account_name: '',
    amounts: emptyAmounts(columns),
    debit_total: 0,
    credit_total: 0,
    balance: 0,
    direction_label: '',
    ...partial,
  }
}

export function queryVatLedger(db: Database.Database, input: VatLedgerQueryInput) {
  const y = Number(input.year) || new Date().getFullYear()
  const startMonth = Math.min(12, Math.max(1, Number(input.startMonth) || 1))
  const endMonth = Math.min(12, Math.max(startMonth, Number(input.endMonth) || 12))
  const yearStart = `${y}-01-01`
  const rangeStart = `${y}-${String(startMonth).padStart(2, '0')}-01`
  const rangeEnd = `${y}-${String(endMonth).padStart(2, '0')}-${String(lastDayOfMonth(y, endMonth)).padStart(2, '0')}`
  const statusCondition = input.includeUnposted
    ? "v.status IN ('draft', 'audited', 'posted')"
    : "v.status = 'posted'"

  const columns = resolveVatColumns(db, input.accountSetId)
  const mapped = columns.filter(c => c.accountId)
  const columnByAccount = new Map(mapped.map(c => [c.accountId, c]))
  const accountIds = mapped.map(c => c.accountId)
  const parent = findVatParentAccount(db, input.accountSetId)

  const emptyResult = {
    columns,
    parent: parent ? { code: parent.code, name: parent.name } : null,
    range: { year: y, startMonth, endMonth, startDate: rangeStart, endDate: rangeEnd },
    initBalance: 0,
    rows: [] as VatLedgerRow[],
  }
  if (accountIds.length === 0) return emptyResult

  const inClause = accountIds.map(() => '?').join(', ')

  // 期初（贷方性质）：年初 init_balance（按科目方向签名）转为贷方性质 + 年初到区间起点前的分录
  const initRows = db
    .prepare(
      `SELECT ib.account_id, a.direction, ${buildInitBalanceSumExpr('ib')} as init_balance
       FROM init_balances ib
       JOIN accounts a ON a.id = ib.account_id
       WHERE ib.account_set_id = ? AND ib.year = ? AND ib.account_id IN (${inClause})
       GROUP BY ib.account_id`
    )
    .all(input.accountSetId, y, ...accountIds) as Array<{ account_id: string; direction: string; init_balance: number }>
  let initBalance = 0
  for (const r of initRows) {
    const signed = Number(r.init_balance) || 0
    initBalance += r.direction === 'credit' ? signed : -signed
  }
  if (rangeStart > yearStart) {
    const before = db
      .prepare(
        `SELECT
           COALESCE(SUM(CASE WHEN ve.direction = 'debit' THEN ve.amount ELSE 0 END), 0) as debit,
           COALESCE(SUM(CASE WHEN ve.direction = 'credit' THEN ve.amount ELSE 0 END), 0) as credit
         FROM voucher_entries ve
         JOIN vouchers v ON v.id = ve.voucher_id
         WHERE ve.account_set_id = ? AND ${statusCondition}
           AND v.voucher_date >= ? AND v.voucher_date < ?
           AND ve.account_id IN (${inClause})`
      )
      .get(input.accountSetId, yearStart, rangeStart, ...accountIds) as { debit: number; credit: number }
    initBalance += (Number(before.credit) || 0) - (Number(before.debit) || 0)
  }
  initBalance = round2(initBalance)

  // 本年累计起点：区间前各栏累计（含账前发生额）
  const yearAmounts = emptyAmounts(columns)
  if (rangeStart > yearStart) {
    const beforeByAccount = db
      .prepare(
        `SELECT ve.account_id, ve.direction, COALESCE(SUM(ve.amount), 0) as amount
         FROM voucher_entries ve
         JOIN vouchers v ON v.id = ve.voucher_id
         WHERE ve.account_set_id = ? AND ${statusCondition}
           AND v.voucher_date >= ? AND v.voucher_date < ?
           AND ve.account_id IN (${inClause})
         GROUP BY ve.account_id, ve.direction`
      )
      .all(input.accountSetId, yearStart, rangeStart, ...accountIds) as Array<{
      account_id: string
      direction: string
      amount: number
    }>
    for (const r of beforeByAccount) {
      const col = columnByAccount.get(r.account_id)
      if (!col) continue
      const signed = r.direction === col.side ? Number(r.amount) : -Number(r.amount)
      yearAmounts[col.key] += signed
    }
  }
  if (input.preBookEnabled) {
    const preBookDate = resolvePreBookDate(input.accountSetStartDate, y)
    if (preBookDate >= yearStart && preBookDate <= rangeEnd) {
      const preRows = db
        .prepare(
          `SELECT ib.account_id,
             ${buildPreBookSumExpr('debit', 'ib')} as pre_debit,
             ${buildPreBookSumExpr('credit', 'ib')} as pre_credit
           FROM init_balances ib
           WHERE ib.account_set_id = ? AND ib.year = ? AND ib.account_id IN (${inClause})
           GROUP BY ib.account_id`
        )
        .all(input.accountSetId, y, ...accountIds) as Array<{ account_id: string; pre_debit: number; pre_credit: number }>
      for (const r of preRows) {
        const col = columnByAccount.get(r.account_id)
        if (!col) continue
        const d = Number(r.pre_debit) || 0
        const c = Number(r.pre_credit) || 0
        yearAmounts[col.key] += col.side === 'debit' ? d - c : c - d
      }
    }
  }

  const entries = db
    .prepare(
      `SELECT ve.id, ve.voucher_id, ve.account_id, ve.account_code, ve.account_name, ve.direction, ve.amount, ve.summary,
              v.voucher_no, v.voucher_date, v.status as voucher_status, vt.name as voucher_type_name
       FROM voucher_entries ve
       JOIN vouchers v ON v.id = ve.voucher_id
       LEFT JOIN voucher_types vt ON vt.id = v.voucher_type_id
       WHERE ve.account_set_id = ? AND ${statusCondition}
         AND v.voucher_date >= ? AND v.voucher_date <= ?
         AND ve.account_id IN (${inClause})
       ORDER BY v.voucher_date, v.voucher_no, ve.seq`
    )
    .all(input.accountSetId, rangeStart, rangeEnd, ...accountIds) as Array<{
    id: string
    voucher_id: string
    account_id: string
    account_code: string
    account_name: string
    direction: 'debit' | 'credit'
    amount: number
    summary: string | null
    voucher_no: string
    voucher_date: string
    voucher_status: string
    voucher_type_name: string | null
  }>

  const rows: VatLedgerRow[] = []
  rows.push(
    makeRow(columns, {
      row_type: 'init',
      voucher_date: rangeStart,
      year: y,
      month: startMonth,
      day: '',
      summary: startMonth === 1 ? '上年结转' : '期初余额',
      balance: initBalance,
      direction_label: dirLabel(initBalance),
    })
  )

  let balance = initBalance
  let currentMonth = 0
  let monthAmounts = emptyAmounts(columns)
  const flushMonth = () => {
    if (!currentMonth) return
    let debit = 0
    let credit = 0
    for (const c of columns) {
      if (c.side === 'debit') debit += monthAmounts[c.key]
      else credit += monthAmounts[c.key]
    }
    rows.push(
      makeRow(columns, {
        row_type: 'month_total',
        voucher_date: `${y}-${String(currentMonth).padStart(2, '0')}-${String(lastDayOfMonth(y, currentMonth)).padStart(2, '0')}`,
        year: y,
        month: currentMonth,
        summary: '本月合计',
        amounts: Object.fromEntries(Object.entries(monthAmounts).map(([k, v]) => [k, round2(v)])),
        debit_total: round2(debit),
        credit_total: round2(credit),
        balance: round2(balance),
        direction_label: dirLabel(balance),
      })
    )
    for (const k of Object.keys(monthAmounts)) yearAmounts[k] += monthAmounts[k]
    monthAmounts = emptyAmounts(columns)
  }

  for (const e of entries) {
    const col = columnByAccount.get(e.account_id)
    if (!col) continue
    const d = new Date(`${e.voucher_date}T00:00:00Z`)
    const month = d.getUTCMonth() + 1
    if (month !== currentMonth) {
      flushMonth()
      currentMonth = month
    }
    const amount = Number(e.amount) || 0
    const signed = e.direction === col.side ? amount : -amount
    const amounts = emptyAmounts(columns)
    amounts[col.key] = round2(signed)
    const debitTotal = col.side === 'debit' ? signed : 0
    const creditTotal = col.side === 'credit' ? signed : 0
    balance += creditTotal - debitTotal
    monthAmounts[col.key] += signed
    rows.push(
      makeRow(columns, {
        row_type: 'entry',
        voucher_date: e.voucher_date,
        year: d.getUTCFullYear(),
        month,
        day: d.getUTCDate(),
        voucher_id: e.voucher_id,
        voucher_no: e.voucher_no,
        voucher_type_name: e.voucher_type_name || '',
        voucher_status: e.voucher_status,
        summary: e.summary || '',
        account_id: e.account_id,
        account_code: e.account_code,
        account_name: e.account_name,
        amounts,
        debit_total: round2(debitTotal),
        credit_total: round2(creditTotal),
        balance: round2(balance),
        direction_label: dirLabel(balance),
      })
    )
  }
  flushMonth()

  let yearDebit = 0
  let yearCredit = 0
  for (const c of columns) {
    if (c.side === 'debit') yearDebit += yearAmounts[c.key]
    else yearCredit += yearAmounts[c.key]
  }
  rows.push(
    makeRow(columns, {
      row_type: 'year_total',
      voucher_date: rangeEnd,
      year: y,
      month: endMonth,
      summary: '本年累计',
      amounts: Object.fromEntries(Object.entries(yearAmounts).map(([k, v]) => [k, round2(v)])),
      debit_total: round2(yearDebit),
      credit_total: round2(yearCredit),
      balance: round2(balance),
      direction_label: dirLabel(balance),
    })
  )

  return { ...emptyResult, initBalance, rows }
}
