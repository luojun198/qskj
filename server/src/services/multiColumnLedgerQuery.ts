import type Database from 'better-sqlite3'
import { buildLedgerOpeningExpr, buildPreBookSumExpr, resolvePreBookRangeFlags } from './initBalanceScope.js'

export const MULTI_COLUMN_PARAM_KEY = 'ledger:multi_column_map'

type AccountDirection = 'debit' | 'credit'

export interface MultiColumnSetting {
  accountId: string
  enabled: boolean
  printName: string
  printNameEn: string
  sortOrder: number
}

export interface MultiColumnAccount {
  key: string
  accountId: string
  label: string
  side: AccountDirection
  accountCode: string
  accountName: string
  accountPath: string
  printName: string
  printNameEn: string
  enabled: boolean
  sortOrder: number
}

export type MultiColumnRowType = 'init' | 'entry' | 'month_total' | 'year_total'

export interface MultiColumnLedgerRow {
  row_type: MultiColumnRowType
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
  amounts: Record<string, number>
  debit_total: number
  credit_total: number
  balance: number
  direction_label: '借' | '贷' | '平' | ''
}

export interface MultiColumnQueryInput {
  accountSetId: string
  mainAccountId: string
  year: number
  startMonth: number
  endMonth: number
  includeUnposted?: boolean
  accountSetStartDate?: string
  preBookEnabled?: boolean
}

interface AccountRow {
  id: string
  code: string
  name: string
  direction: AccountDirection
  parent_id: string | null
  level: number
}

const ACCOUNT_COLUMNS = 'id, code, name, direction, parent_id, level'
const round2 = (value: number) => Math.round((Number(value) || 0) * 100) / 100

function monthEnd(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

function directionLabel(balance: number): MultiColumnLedgerRow['direction_label'] {
  if (Math.abs(balance) < 0.005) return '平'
  return balance > 0 ? '借' : '贷'
}

function findAccount(db: Database.Database, accountSetId: string, accountId: string) {
  return db
    .prepare(`SELECT ${ACCOUNT_COLUMNS} FROM accounts WHERE account_set_id=? AND id=? AND is_enabled=1 LIMIT 1`)
    .get(accountSetId, accountId) as AccountRow | undefined
}

function buildAccountPath(db: Database.Database, accountSetId: string, account: AccountRow) {
  const byId = db.prepare(`SELECT ${ACCOUNT_COLUMNS} FROM accounts WHERE account_set_id=? AND id=? LIMIT 1`)
  const byCode = db.prepare(`SELECT ${ACCOUNT_COLUMNS} FROM accounts WHERE account_set_id=? AND code=? LIMIT 1`)
  const names = [account.name]
  let current: AccountRow | undefined = account
  let guard = 0
  while (current && guard++ < 12) {
    let parent: AccountRow | undefined
    if (current.parent_id) parent = byId.get(accountSetId, current.parent_id) as AccountRow | undefined
    if (!parent) {
      for (let length = current.code.length - 1; length > 0 && !parent; length -= 1) {
        parent = byCode.get(accountSetId, current.code.slice(0, length)) as AccountRow | undefined
      }
    }
    if (!parent) break
    names.unshift(parent.name)
    current = parent
  }
  return names.join('\\')
}

function hasChild(db: Database.Database, accountSetId: string, account: AccountRow) {
  const byParent = db
    .prepare('SELECT 1 FROM accounts WHERE account_set_id=? AND parent_id=? AND is_enabled=1 LIMIT 1')
    .get(accountSetId, account.id)
  if (byParent) return true
  return !!db
    .prepare('SELECT 1 FROM accounts WHERE account_set_id=? AND code LIKE ? AND code<>? AND is_enabled=1 LIMIT 1')
    .get(accountSetId, `${account.code}%`, account.code)
}

function findDescendantLeaves(db: Database.Database, accountSetId: string, main: AccountRow) {
  const candidates = db
    .prepare(
      `SELECT ${ACCOUNT_COLUMNS}
       FROM accounts
       WHERE account_set_id=? AND is_enabled=1 AND code LIKE ? AND code<>?
       ORDER BY code`
    )
    .all(accountSetId, `${main.code}%`, main.code) as AccountRow[]
  return candidates.filter(account => !hasChild(db, accountSetId, account))
}

export function readMultiColumnSettings(db: Database.Database, accountSetId: string, mainAccountId: string) {
  const row = db
    .prepare('SELECT param_value FROM system_params WHERE account_set_id=? AND param_key=?')
    .get(accountSetId, MULTI_COLUMN_PARAM_KEY) as { param_value?: string } | undefined
  if (!row?.param_value) return []
  try {
    const parsed = JSON.parse(row.param_value)
    if (!parsed || typeof parsed !== 'object') return []
    const settings = (parsed as Record<string, unknown>)[mainAccountId]
    if (!Array.isArray(settings)) return []
    return settings
      .filter(item => item && typeof item.accountId === 'string')
      .map(item => ({
        accountId: String(item.accountId),
        enabled: item.enabled !== false,
        printName: String(item.printName ?? '').trim(),
        printNameEn: String(item.printNameEn ?? '').trim(),
        sortOrder: Number.isFinite(Number(item.sortOrder)) ? Number(item.sortOrder) : 0,
      })) as MultiColumnSetting[]
  } catch {
    return []
  }
}

export function saveMultiColumnSettings(
  db: Database.Database,
  accountSetId: string,
  mainAccountId: string,
  settings: MultiColumnSetting[],
  newId: () => string
) {
  const existing = db
    .prepare('SELECT id, param_value FROM system_params WHERE account_set_id=? AND param_key=?')
    .get(accountSetId, MULTI_COLUMN_PARAM_KEY) as { id: string; param_value?: string } | undefined
  let all: Record<string, MultiColumnSetting[]> = {}
  if (existing?.param_value) {
    try {
      const parsed = JSON.parse(existing.param_value)
      if (parsed && typeof parsed === 'object') all = parsed as Record<string, MultiColumnSetting[]>
    } catch {
      all = {}
    }
  }
  all[mainAccountId] = settings
    .filter(setting => setting && typeof setting.accountId === 'string')
    .map((setting, index) => ({
      accountId: String(setting.accountId),
      enabled: setting.enabled !== false,
      printName: String(setting.printName ?? '').trim(),
      printNameEn: String(setting.printNameEn ?? '').trim(),
      sortOrder: Number.isFinite(Number(setting.sortOrder)) ? Number(setting.sortOrder) : index,
    }))
  const value = JSON.stringify(all)
  if (existing) {
    db.prepare('UPDATE system_params SET param_value=?, updated_at=datetime(\'now\') WHERE id=?').run(value, existing.id)
  } else {
    db.prepare(
      'INSERT INTO system_params (id, account_set_id, param_key, param_value) VALUES (?, ?, ?, ?)'
    ).run(newId(), accountSetId, MULTI_COLUMN_PARAM_KEY, value)
  }
  return all[mainAccountId]
}

export function resolveMultiColumnAccounts(
  db: Database.Database,
  accountSetId: string,
  mainAccountId: string
): { main: AccountRow | null; columns: MultiColumnAccount[] } {
  const main = findAccount(db, accountSetId, mainAccountId)
  if (!main) return { main: null, columns: [] }
  const saved = new Map(readMultiColumnSettings(db, accountSetId, mainAccountId).map(item => [item.accountId, item]))
  const leaves = findDescendantLeaves(db, accountSetId, main)
  const columns = leaves
    .map((account, index) => {
      const setting = saved.get(account.id)
      return {
        key: account.id,
        accountId: account.id,
        label: account.name,
        side: account.direction,
        accountCode: account.code,
        accountName: account.name,
        accountPath: buildAccountPath(db, accountSetId, account),
        printName: setting?.printName || account.name,
        printNameEn: setting?.printNameEn || account.name,
        enabled: setting?.enabled !== false,
        sortOrder: setting?.sortOrder ?? index,
      }
    })
    .filter(column => column.enabled)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.accountCode.localeCompare(b.accountCode))
    .map((column, index) => ({ ...column, sortOrder: index }))
  return { main, columns }
}

function emptyAmounts(columns: MultiColumnAccount[]) {
  return Object.fromEntries(columns.map(column => [column.key, 0])) as Record<string, number>
}

function makeRow(columns: MultiColumnAccount[], partial: Partial<MultiColumnLedgerRow>): MultiColumnLedgerRow {
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

export function queryMultiColumnLedger(db: Database.Database, input: MultiColumnQueryInput) {
  const year = Number(input.year) || new Date().getFullYear()
  const startMonth = Math.min(12, Math.max(1, Number(input.startMonth) || 1))
  const endMonth = Math.min(12, Math.max(startMonth, Number(input.endMonth) || 12))
  const rangeStart = `${year}-${String(startMonth).padStart(2, '0')}-01`
  const rangeEnd = `${year}-${String(endMonth).padStart(2, '0')}-${String(monthEnd(year, endMonth)).padStart(2, '0')}`
  const yearStart = `${year}-01-01`
  const statusCondition = input.includeUnposted
    ? "v.status IN ('draft', 'audited', 'posted')"
    : "v.status = 'posted'"
  const resolved = resolveMultiColumnAccounts(db, input.accountSetId, input.mainAccountId)
  const { main, columns } = resolved
  const base = {
    main: main ? { id: main.id, code: main.code, name: main.name, direction: main.direction } : null,
    columns,
    range: { year, startMonth, endMonth, startDate: rangeStart, endDate: rangeEnd },
    initBalance: 0,
    rows: [] as MultiColumnLedgerRow[],
  }
  if (!main || columns.length === 0) return base

  const accountIds = columns.map(column => column.accountId)
  const inClause = accountIds.map(() => '?').join(', ')
  const columnByAccount = new Map(columns.map(column => [column.accountId, column]))

  // FIX-149 / FIX-150：账前发生额归属与总账/余额表同口径——归属日早于区间起点并入期初，
  // 落在本年内且不晚于区间终点计入本年累计；期初用年初余额（opening）而非启用时点余额
  const preBook = resolvePreBookRangeFlags({
    accountSetStartDate: input.accountSetStartDate,
    preBookEnabled: input.preBookEnabled,
    startDate: rangeStart,
    endDate: rangeEnd,
    yearStartDate: yearStart,
  })
  const initRows = db
    .prepare(
      `SELECT ib.account_id, a.direction, ${buildLedgerOpeningExpr({
        preBookEnabled: preBook.preBookEnabled,
        initIncludesPreBook: preBook.initIncludesPreBook,
      })} as init_balance
       FROM init_balances ib JOIN accounts a ON a.id=ib.account_id
       WHERE ib.account_set_id=? AND ib.year=? AND ib.account_id IN (${inClause})
       GROUP BY ib.account_id`
    )
    .all(input.accountSetId, year, ...accountIds) as Array<{ account_id: string; direction: AccountDirection; init_balance: number }>
  let initBalance = 0
  for (const row of initRows) {
    const amount = Number(row.init_balance) || 0
    initBalance += main.direction === 'debit'
      ? row.direction === 'debit' ? amount : -amount
      : row.direction === 'credit' ? amount : -amount
  }

  if (rangeStart > yearStart) {
    const before = db
      .prepare(
        `SELECT ve.account_id, ve.direction, COALESCE(SUM(ve.amount),0) as amount
         FROM voucher_entries ve JOIN vouchers v ON v.id=ve.voucher_id
         WHERE ve.account_set_id=? AND ${statusCondition}
           AND v.voucher_date>=? AND v.voucher_date<? AND ve.account_id IN (${inClause})
         GROUP BY ve.account_id, ve.direction`
      )
      .all(input.accountSetId, yearStart, rangeStart, ...accountIds) as Array<{ account_id: string; direction: AccountDirection; amount: number }>
    for (const row of before) {
      const column = columnByAccount.get(row.account_id)
      if (!column) continue
      const amount = Number(row.amount) || 0
      initBalance += main.direction === 'debit'
        ? row.direction === 'debit' ? amount : -amount
        : row.direction === 'credit' ? amount : -amount
    }
  }
  initBalance = round2(initBalance)

  const yearAmounts = emptyAmounts(columns)
  if (preBook.yearIncludesPreBook) {
    const preRows = db
      .prepare(
        `SELECT ib.account_id,
           ${buildPreBookSumExpr('debit', 'ib')} as pre_debit,
           ${buildPreBookSumExpr('credit', 'ib')} as pre_credit
         FROM init_balances ib
         WHERE ib.account_set_id=? AND ib.year=? AND ib.account_id IN (${inClause})
         GROUP BY ib.account_id`
      )
      .all(input.accountSetId, year, ...accountIds) as Array<{ account_id: string; pre_debit: number; pre_credit: number }>
    for (const r of preRows) {
      const column = columnByAccount.get(r.account_id)
      if (!column) continue
      const d = Number(r.pre_debit) || 0
      const c = Number(r.pre_credit) || 0
      yearAmounts[column.key] += column.side === 'debit' ? d - c : c - d
    }
  }
  if (rangeStart > yearStart) {
    const before = db
      .prepare(
        `SELECT ve.account_id, ve.direction, COALESCE(SUM(ve.amount),0) as amount
         FROM voucher_entries ve JOIN vouchers v ON v.id=ve.voucher_id
         WHERE ve.account_set_id=? AND ${statusCondition}
           AND v.voucher_date>=? AND v.voucher_date<? AND ve.account_id IN (${inClause})
         GROUP BY ve.account_id, ve.direction`
      )
      .all(input.accountSetId, yearStart, rangeStart, ...accountIds) as Array<{ account_id: string; direction: AccountDirection; amount: number }>
    for (const row of before) {
      const column = columnByAccount.get(row.account_id)
      if (column) yearAmounts[column.key] += row.direction === column.side ? Number(row.amount) || 0 : -(Number(row.amount) || 0)
    }
  }

  const entries = db
    .prepare(
      `SELECT ve.voucher_id, ve.account_id, ve.account_code, ve.account_name, ve.direction, ve.amount, ve.summary,
              v.voucher_no, v.voucher_date, v.status as voucher_status, vt.name as voucher_type_name
       FROM voucher_entries ve JOIN vouchers v ON v.id=ve.voucher_id
       LEFT JOIN voucher_types vt ON vt.id=v.voucher_type_id
       WHERE ve.account_set_id=? AND ${statusCondition}
         AND v.voucher_date>=? AND v.voucher_date<=? AND ve.account_id IN (${inClause})
       ORDER BY v.voucher_date, v.voucher_no, ve.seq`
    )
    .all(input.accountSetId, rangeStart, rangeEnd, ...accountIds) as Array<{
      voucher_id: string
      account_id: string
      account_code: string
      account_name: string
      direction: AccountDirection
      amount: number
      summary: string | null
      voucher_no: string
      voucher_date: string
      voucher_status: string
      voucher_type_name: string | null
    }>

  const rows: MultiColumnLedgerRow[] = []
  rows.push(makeRow(columns, {
    row_type: 'init',
    voucher_date: rangeStart,
    year,
    month: startMonth,
    summary: startMonth === 1 ? '上年结转' : '期初余额',
    balance: initBalance,
    direction_label: directionLabel(initBalance),
  }))

  let balance = initBalance
  let currentMonth = 0
  let monthAmounts = emptyAmounts(columns)
  const flushMonth = () => {
    if (!currentMonth) return
    let debitTotal = 0
    let creditTotal = 0
    for (const column of columns) {
      if (column.side === 'debit') debitTotal += monthAmounts[column.key]
      else creditTotal += monthAmounts[column.key]
      yearAmounts[column.key] += monthAmounts[column.key]
    }
    rows.push(makeRow(columns, {
      row_type: 'month_total',
      voucher_date: `${year}-${String(currentMonth).padStart(2, '0')}-${String(monthEnd(year, currentMonth)).padStart(2, '0')}`,
      year,
      month: currentMonth,
      summary: '本月合计',
      amounts: Object.fromEntries(Object.entries(monthAmounts).map(([key, value]) => [key, round2(value)])),
      debit_total: round2(debitTotal),
      credit_total: round2(creditTotal),
      balance: round2(balance),
      direction_label: directionLabel(balance),
    }))
    monthAmounts = emptyAmounts(columns)
  }

  for (const entry of entries) {
    const column = columnByAccount.get(entry.account_id)
    if (!column) continue
    const date = new Date(`${entry.voucher_date}T00:00:00Z`)
    const month = date.getUTCMonth() + 1
    if (month !== currentMonth) {
      flushMonth()
      currentMonth = month
    }
    const amount = Number(entry.amount) || 0
    const signed = entry.direction === column.side ? amount : -amount
    const debitTotal = entry.direction === 'debit' ? amount : 0
    const creditTotal = entry.direction === 'credit' ? amount : 0
    balance += main.direction === 'debit' ? debitTotal - creditTotal : creditTotal - debitTotal
    monthAmounts[column.key] += signed
    const amounts = emptyAmounts(columns)
    amounts[column.key] = round2(signed)
    rows.push(makeRow(columns, {
      row_type: 'entry',
      voucher_date: entry.voucher_date,
      year: date.getUTCFullYear(),
      month,
      day: date.getUTCDate(),
      voucher_id: entry.voucher_id,
      voucher_no: entry.voucher_no,
      voucher_type_name: entry.voucher_type_name || '',
      voucher_status: entry.voucher_status,
      summary: entry.summary || '',
      account_id: entry.account_id,
      account_code: entry.account_code,
      account_name: entry.account_name,
      amounts,
      debit_total: round2(debitTotal),
      credit_total: round2(creditTotal),
      balance: round2(balance),
      direction_label: directionLabel(balance),
    }))
  }
  flushMonth()

  let yearDebit = 0
  let yearCredit = 0
  for (const column of columns) {
    if (column.side === 'debit') yearDebit += yearAmounts[column.key]
    else yearCredit += yearAmounts[column.key]
  }
  rows.push(makeRow(columns, {
    row_type: 'year_total',
    voucher_date: rangeEnd,
    year,
    month: endMonth,
    summary: '本年累计',
    amounts: Object.fromEntries(Object.entries(yearAmounts).map(([key, value]) => [key, round2(value)])),
    debit_total: round2(yearDebit),
    credit_total: round2(yearCredit),
    balance: round2(balance),
    direction_label: directionLabel(balance),
  }))

  return { ...base, initBalance, rows }
}
