import { v4 as uuidv4 } from 'uuid'
import type { Database } from 'better-sqlite3'
import { buildAuxItemId, type VoucherEntryLike } from './voucherPosting.js'
import { MONEY_EPSILON } from '../utils/amountUtils.js'
import {
  detectStaticReportStandard,
  getProfitLossAccountCodePrefixes,
} from './staticReportConfig.js'

type Direction = 'debit' | 'credit'

export interface ClosePeriodParams {
  db: Database
  accountSetId: string
  year: number
  period: number
  userId?: string | null
}

export interface YearEndBalanceRow {
  accountId: string
  accountCode: string
  accountName: string
  direction: Direction
  auxItemId: string
  initBalance: number
  initDebit: number
  initCredit: number
  /** FIX-140：原币年末余额（按科目方向签名），老库无外币列时恒为 0 */
  foreignInitBalance: number
  foreignInitDebit: number
  foreignInitCredit: number
  /** FIX-140：数量年末结存（按科目方向签名），老库无数量列时恒为 0 */
  qtyInitBalance: number
  qtyInitDebit: number
  qtyInitCredit: number
}

/** FIX-140：init_balances / voucher_entries 是否具备外币、数量列（老库可能未迁移） */
export function detectYearCloseColumnSupport(db: Database) {
  const cols = (table: string) =>
    new Set((db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(c => c.name))
  const ib = cols('init_balances')
  const ve = cols('voucher_entries')
  return {
    foreign: ib.has('foreign_init_balance') && ib.has('foreign_opening_debit') && ve.has('foreign_amount'),
    qty: ib.has('qty_init_balance') && ib.has('qty_opening_debit') && ve.has('quantity'),
  }
}

const QTY_EPSILON = 1e-6
function roundQty(value: number) {
  return Math.round(value * 1e6) / 1e6
}

export interface ClosePeriodResult {
  closedYear: number
  closedPeriod: number
  nextYear?: number
  carriedCount: number
  /** 下一年已有凭证时，重新计算并覆盖了期初余额 */
  overwrittenNextYearOpening?: boolean
  /** FIX-003 / P0-9：因下年期初存在手工调整行而被保留、未覆盖的科目数 */
  preservedManualOpeningCount?: number
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

function normalizeAuxItemId(auxItemId: unknown) {
  return typeof auxItemId === 'string' ? auxItemId : ''
}

function toYearPeriod(value: number, label: string) {
  if (!Number.isInteger(value)) {
    throw new Error(`${label}必须是整数`)
  }
}

export function getPeriodClosingRecord(params: {
  db: Database
  accountSetId: string
  year: number
  period: number
}) {
  return params.db
    .prepare('SELECT * FROM period_closing WHERE account_set_id=? AND year=? AND period=?')
    .get(params.accountSetId, params.year, params.period) as
    | { id: string; status: string }
    | undefined
}

export function validateNoUnpostedVouchers(params: {
  db: Database
  accountSetId: string
  year: number
  period: number
}) {
  const row = params.db
    .prepare(
      `
      SELECT COUNT(*) as count
      FROM vouchers
      WHERE account_set_id = ?
        AND year = ?
        AND period = ?
        AND status <> 'posted'
    `
    )
    .get(params.accountSetId, params.year, params.period) as { count: number }

  if ((row?.count || 0) > 0) {
    throw new Error(`${params.year}年第${params.period}期存在未记账凭证，不能结账`)
  }
}

export function getFirstPeriodForYear(params: {
  db: Database
  accountSetId: string
  year: number
}) {
  const accountSet = params.db
    .prepare('SELECT start_date FROM account_sets WHERE id=?')
    .get(params.accountSetId) as { start_date?: string | null } | undefined
  const startDate = accountSet?.start_date || ''
  const startYear = Number(startDate.slice(0, 4))
  const startMonth = Number(startDate.slice(5, 7))
  return startYear === params.year && Number.isInteger(startMonth) && startMonth > 1
    ? startMonth
    : 1
}

export function validatePreviousPeriodsClosed(params: {
  db: Database
  accountSetId: string
  year: number
}) {
  const firstPeriod = getFirstPeriodForYear(params)

  const rows = params.db
    .prepare(
      `
      SELECT period
      FROM period_closing
      WHERE account_set_id = ?
        AND year = ?
        AND status = 'closed'
    `
    )
    .all(params.accountSetId, params.year) as Array<{ period: number }>
  const closedPeriods = new Set(rows.map(row => Number(row.period)))
  const missing: number[] = []
  for (let period = firstPeriod; period < 12; period += 1) {
    if (!closedPeriods.has(period)) {
      missing.push(period)
    }
  }

  if (missing.length > 0) {
    throw new Error(`年度结账前需先完成前序期间结账，未结账期间：${missing.join('、')}`)
  }
}

export function countYearVouchers(params: { db: Database; accountSetId: string; year: number }) {
  const row = params.db
    .prepare(
      `
      SELECT COUNT(*) as count
      FROM vouchers
      WHERE account_set_id = ?
        AND year = ?
    `
    )
    .get(params.accountSetId, params.year) as { count: number }

  return row?.count || 0
}

export function countYearOpeningBalanceRows(params: {
  db: Database
  accountSetId: string
  year: number
  period?: number
}) {
  const period = params.period ?? 1
  const row = params.db
    .prepare(
      `SELECT COUNT(*) as c FROM init_balances WHERE account_set_id = ? AND year = ? AND period = ?`
    )
    .get(params.accountSetId, params.year, period) as { c: number }

  return row?.c ?? 0
}

/** 反结账某月前：同年后续月份必须均为未结账 */
export function validateLaterPeriodsNotClosed(params: {
  db: Database
  accountSetId: string
  year: number
  period: number
}) {
  const row = params.db
    .prepare(
      `
      SELECT COUNT(*) as count
      FROM period_closing
      WHERE account_set_id = ?
        AND year = ?
        AND period > ?
        AND status = 'closed'
    `
    )
    .get(params.accountSetId, params.year, params.period) as { count: number }

  if ((row?.count || 0) > 0) {
    throw new Error('存在以后月份已结账，请先对较晚的会计期间执行反结账')
  }
}

/**
 * 撤销结账写入的下一年 1 月期初（仅删除年结自动生成行，不动用户手工调整行）。
 * FIX-003 / P0-9：只删除 source='year_close_auto' 的行，保护 source='manual'。
 */
export function deleteNextYearAutoOpeningBalances(params: {
  db: Database
  accountSetId: string
  nextYear: number
}) {
  const result = params.db
    .prepare(
      `DELETE FROM init_balances
       WHERE account_set_id=? AND year=? AND period=1 AND source='year_close_auto'`
    )
    .run(params.accountSetId, params.nextYear)
  return { deleted: Number(result.changes ?? 0) }
}

function getInitBalanceRows(
  db: Database,
  accountSetId: string,
  year: number,
  support: { foreign: boolean; qty: boolean }
) {
  return db
    .prepare(
      `
      SELECT
        ib.account_id,
        a.code as account_code,
        a.name as account_name,
        a.direction,
        COALESCE(ib.aux_item_id, '') as aux_item_id,
        SUM(COALESCE(ib.init_balance, 0)) as init_balance,
        ${support.foreign ? 'SUM(COALESCE(ib.foreign_init_balance, 0))' : '0'} as foreign_init_balance,
        ${support.qty ? 'SUM(COALESCE(ib.qty_init_balance, 0))' : '0'} as qty_init_balance
      FROM init_balances ib
      JOIN accounts a ON a.id = ib.account_id
      WHERE ib.account_set_id = ?
        AND ib.year = ?
        AND a.account_set_id = ?
      GROUP BY ib.account_id, aux_item_id
    `
    )
    .all(accountSetId, year, accountSetId) as Array<{
    account_id: string
    account_code: string
    account_name: string
    direction: Direction
    aux_item_id: string | null
    init_balance: number | null
    foreign_init_balance: number | null
    qty_init_balance: number | null
  }>
}

function getPostedEntryRows(db: Database, accountSetId: string, year: number) {
  return db
    .prepare(
      `
      SELECT
        ve.*,
        a.direction as account_direction,
        a.code as account_code,
        a.name as account_name
      FROM voucher_entries ve
      JOIN vouchers v ON v.id = ve.voucher_id
      JOIN accounts a ON a.id = ve.account_id
      WHERE ve.account_set_id = ?
        AND v.account_set_id = ?
        AND v.year = ?
        AND v.status = 'posted'
      ORDER BY v.voucher_date, v.voucher_no, ve.seq
    `
    )
    .all(accountSetId, accountSetId, year) as Array<
    VoucherEntryLike & {
      account_direction: Direction
    }
  >
}

function makeBalanceKey(accountId: string, auxItemId: string) {
  return `${accountId}\u0000${auxItemId}`
}

export function splitSignedBalance(direction: Direction, signedBalance: number) {
  const value = roundMoney(signedBalance)
  if (Math.abs(value) < MONEY_EPSILON) {
    return { initBalance: 0, initDebit: 0, initCredit: 0 }
  }

  if (direction === 'debit') {
    return value > 0
      ? { initBalance: value, initDebit: value, initCredit: 0 }
      : { initBalance: value, initDebit: 0, initCredit: Math.abs(value) }
  }

  return value > 0
    ? { initBalance: value, initDebit: 0, initCredit: value }
    : { initBalance: value, initDebit: Math.abs(value), initCredit: 0 }
}

function splitSignedQuantity(direction: Direction, signedQty: number) {
  const value = roundQty(signedQty)
  if (Math.abs(value) < QTY_EPSILON) {
    return { initBalance: 0, initDebit: 0, initCredit: 0 }
  }
  const positive = value > 0
  if (direction === 'debit') {
    return positive
      ? { initBalance: value, initDebit: value, initCredit: 0 }
      : { initBalance: value, initDebit: 0, initCredit: Math.abs(value) }
  }
  return positive
    ? { initBalance: value, initDebit: 0, initCredit: value }
    : { initBalance: value, initDebit: Math.abs(value), initCredit: 0 }
}

export function buildYearEndBalances(
  db: Database,
  accountSetId: string,
  year: number
): YearEndBalanceRow[] {
  const balances = new Map<string, YearEndBalanceRow>()
  const support = detectYearCloseColumnSupport(db)
  const emptyExtra = {
    foreignInitBalance: 0,
    foreignInitDebit: 0,
    foreignInitCredit: 0,
    qtyInitBalance: 0,
    qtyInitDebit: 0,
    qtyInitCredit: 0,
  }

  for (const row of getInitBalanceRows(db, accountSetId, year, support)) {
    const auxItemId = normalizeAuxItemId(row.aux_item_id)
    const key = makeBalanceKey(row.account_id, auxItemId)
    balances.set(key, {
      accountId: row.account_id,
      accountCode: row.account_code,
      accountName: row.account_name,
      direction: row.direction,
      auxItemId,
      initBalance: roundMoney(Number(row.init_balance || 0)),
      initDebit: 0,
      initCredit: 0,
      ...emptyExtra,
      foreignInitBalance: roundMoney(Number(row.foreign_init_balance || 0)),
      qtyInitBalance: roundQty(Number(row.qty_init_balance || 0)),
    })
  }

  for (const entry of getPostedEntryRows(db, accountSetId, year)) {
    const auxItemId = buildAuxItemId(entry)
    const key = makeBalanceKey(entry.account_id, auxItemId)
    const current = balances.get(key) || {
      accountId: entry.account_id,
      accountCode: entry.account_code,
      accountName: entry.account_name,
      direction: entry.account_direction,
      auxItemId,
      initBalance: 0,
      initDebit: 0,
      initCredit: 0,
      ...emptyExtra,
    }
    const amount = Number(entry.amount || 0)
    const sameDirection = entry.direction === current.direction
    const sign = sameDirection ? 1 : -1
    current.initBalance = roundMoney(current.initBalance + sign * amount)
    // FIX-140：外币 / 数量随本位币同步累计，年结后下年期初不再丢原币与数量
    if (support.foreign) {
      const foreignAmount = Number((entry as any).foreign_amount || 0)
      current.foreignInitBalance = roundMoney(current.foreignInitBalance + sign * foreignAmount)
    }
    if (support.qty) {
      const quantity = Number((entry as any).quantity || 0)
      current.qtyInitBalance = roundQty(current.qtyInitBalance + sign * quantity)
    }
    balances.set(key, current)
  }

  return [...balances.values()]
    .map(row => {
      const foreign = splitSignedBalance(row.direction, row.foreignInitBalance)
      const qty = splitSignedQuantity(row.direction, row.qtyInitBalance)
      return {
        ...row,
        ...splitSignedBalance(row.direction, row.initBalance),
        foreignInitBalance: foreign.initBalance,
        foreignInitDebit: foreign.initDebit,
        foreignInitCredit: foreign.initCredit,
        qtyInitBalance: qty.initBalance,
        qtyInitDebit: qty.initDebit,
        qtyInitCredit: qty.initCredit,
      }
    })
    .filter(
      row =>
        Math.abs(row.initBalance) >= MONEY_EPSILON ||
        Math.abs(row.foreignInitBalance) >= MONEY_EPSILON ||
        Math.abs(row.qtyInitBalance) >= QTY_EPSILON
    )
    .sort(
      (a, b) => a.accountCode.localeCompare(b.accountCode) || a.auxItemId.localeCompare(b.auxItemId)
    )
}

export interface WriteNextYearInitResult {
  /** 实际新插入的年结自动行数 */
  inserted: number
  /** 因(科目, 辅助)已存在手工行而被保留、跳过自动覆盖的行数 */
  preservedManual: number
  /** 被替换的旧年结自动行数（上次年结遗留） */
  replacedAuto: number
}

/**
 * FIX-004 / P0-8：年度结账前校验损益类科目年末余额为 0。
 *
 * 中国会计准则要求损益类（收入/成本/费用）科目年末余额必须为 0：
 *   - 月末或年末需通过"结转损益"凭证把余额结转到「本年利润」
 *   - 否则下一年度期初余额会包含本年的损益数字，导致下年报表错乱
 *
 * 本函数：
 *   1) 取 buildYearEndBalances 已聚合好的年末余额（已含期初 + 全年凭证净额）
 *   2) 过滤出会计准则对应的损益类科目（按编码前缀）
 *   3) 余额 abs >= MONEY_EPSILON 视为未结转
 *   4) 若存在未结转科目则抛错，错误信息列出科目编码、名称、余额（至多 10 项）
 *
 * 调用方：closeAccountingPeriod / closeAllAccountingPeriods 在 period=12 时调用。
 */
export function validateProfitLossClosedFromRows(
  rows: YearEndBalanceRow[],
  prefixes: string[]
) {
  if (prefixes.length === 0) return
  const unclosed = rows.filter(
    row =>
      prefixes.some(p => row.accountCode.startsWith(p)) &&
      Math.abs(row.initBalance) >= MONEY_EPSILON
  )
  if (unclosed.length === 0) return

  const shown = unclosed.slice(0, 10)
  const detail = shown
    .map(r => {
      const aux = r.auxItemId ? `（${r.auxItemId}）` : ''
      return `${r.accountCode} ${r.accountName}${aux} 余额 ${r.initBalance.toFixed(2)}`
    })
    .join('；')
  const more =
    unclosed.length > shown.length ? `（共 ${unclosed.length} 项，仅显示前 ${shown.length} 项）` : ''
  throw new Error(
    `年度结账前损益类科目余额必须为 0，请先在"凭证 → 自动结转"中执行"结转损益"，` +
      `将以下科目余额结转至本年利润后再做年结：${detail}${more}`
  )
}

export function writeNextYearInitBalances(params: {
  db: Database
  accountSetId: string
  sourceYear: number
  rows: YearEndBalanceRow[]
}): WriteNextYearInitResult {
  const nextYear = params.sourceYear + 1

  // FIX-003 / P0-9：只删上次年结自动生成的行；手工录入行（source='manual'）保留
  const delResult = params.db
    .prepare(
      `DELETE FROM init_balances
       WHERE account_set_id=? AND year=? AND period=1 AND source='year_close_auto'`
    )
    .run(params.accountSetId, nextYear)
  const replacedAuto = Number(delResult.changes ?? 0)

  // 检测某 (account, aux) 是否已存在手工行
  const manualExistsStmt = params.db.prepare(
    `SELECT 1 FROM init_balances
     WHERE account_set_id=? AND account_id=? AND year=? AND period=1
       AND aux_item_id=? AND source='manual' LIMIT 1`
  )

  // FIX-140：外币 / 数量期初随年结写入下年（老库缺列时跳过对应列）
  const support = detectYearCloseColumnSupport(params.db)
  const foreignCols = support.foreign
    ? ', foreign_init_balance, foreign_opening_debit, foreign_opening_credit, foreign_pre_book_debit, foreign_pre_book_credit'
    : ''
  const foreignVals = support.foreign ? ', ?, ?, ?, 0, 0' : ''
  const qtyCols = support.qty
    ? ', qty_init_balance, qty_opening_debit, qty_opening_credit, qty_pre_book_debit, qty_pre_book_credit'
    : ''
  const qtyVals = support.qty ? ', ?, ?, ?, 0, 0' : ''
  const insert = params.db.prepare(
    `
    INSERT INTO init_balances (
      id, account_set_id, account_id, direction, year, period,
      init_balance, init_debit, init_credit, aux_item_id,
      opening_debit, opening_credit, pre_book_debit, pre_book_credit,
      source, created_at${foreignCols}${qtyCols}
    )
    VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, 0, 0, 'year_close_auto', datetime('now')${foreignVals}${qtyVals})
  `
  )

  let inserted = 0
  let preservedManual = 0
  for (const row of params.rows) {
    if (manualExistsStmt.get(params.accountSetId, row.accountId, nextYear, row.auxItemId)) {
      preservedManual += 1
      continue
    }
    insert.run(
      uuidv4(),
      params.accountSetId,
      row.accountId,
      row.direction,
      nextYear,
      row.initBalance,
      row.initDebit,
      row.initCredit,
      row.auxItemId,
      row.initDebit,
      row.initCredit,
      ...(support.foreign ? [row.foreignInitBalance, row.foreignInitDebit, row.foreignInitCredit] : []),
      ...(support.qty ? [row.qtyInitBalance, row.qtyInitDebit, row.qtyInitCredit] : [])
    )
    inserted += 1
  }

  return { inserted, preservedManual, replacedAuto }
}

export function closePeriodRecord(params: ClosePeriodParams) {
  const existing = getPeriodClosingRecord(params)
  if (existing?.status === 'closed') {
    throw new Error(`${params.year}年第${params.period}期已结账，不能重复结账`)
  }

  params.db
    .prepare(
      `
      INSERT INTO period_closing (id, account_set_id, year, period, status, closed_by, closed_at, created_at)
      VALUES (?, ?, ?, ?, 'closed', ?, datetime('now'), datetime('now'))
      ON CONFLICT(account_set_id, year, period) DO UPDATE SET
        status='closed',
        closed_by=excluded.closed_by,
        closed_at=excluded.closed_at
    `
    )
    .run(
      existing?.id || uuidv4(),
      params.accountSetId,
      params.year,
      params.period,
      params.userId || null
    )
}

export function closeAccountingPeriod(params: ClosePeriodParams): ClosePeriodResult {
  toYearPeriod(params.year, '会计年度')
  toYearPeriod(params.period, '会计期间')
  if (params.period < 1 || params.period > 12) {
    throw new Error('会计期间必须在1到12之间')
  }

  validateNoUnpostedVouchers(params)

  if (params.period !== 12) {
    const transaction = params.db.transaction(() => {
      closePeriodRecord(params)
    })
    transaction()
    return {
      closedYear: params.year,
      closedPeriod: params.period,
      carriedCount: 0,
    }
  }

  validatePreviousPeriodsClosed({
    db: params.db,
    accountSetId: params.accountSetId,
    year: params.year,
  })

  const nextYear = params.year + 1
  const nextYearVoucherCount = countYearVouchers({
    db: params.db,
    accountSetId: params.accountSetId,
    year: nextYear,
  })

  // FIX-004 / P0-8：先在事务外计算并校验损益，避免事务回滚浪费
  const rows = buildYearEndBalances(params.db, params.accountSetId, params.year)
  const standard = detectStaticReportStandard(params.db, params.accountSetId)
  validateProfitLossClosedFromRows(rows, getProfitLossAccountCodePrefixes(standard))

  let carriedCount = 0
  let preservedManualOpeningCount = 0
  const transaction = params.db.transaction(() => {
    const writeResult = writeNextYearInitBalances({
      db: params.db,
      accountSetId: params.accountSetId,
      sourceYear: params.year,
      rows,
    })
    closePeriodRecord(params)
    carriedCount = rows.length
    preservedManualOpeningCount = writeResult.preservedManual
  })

  transaction()
  return {
    closedYear: params.year,
    closedPeriod: params.period,
    nextYear,
    carriedCount,
    overwrittenNextYearOpening: nextYearVoucherCount > 0,
    preservedManualOpeningCount,
  }
}

export interface OpenPeriodResult {
  openedYear: number
  openedPeriod: number
  removedNextYearOpening?: boolean
  nextYear?: number
  /** 下一年已有凭证数量（反结账后下年期初待恢复） */
  nextYearVoucherCount?: number
}

/**
 * 反结账：打开指定期间；若为 12 月年结，则同时删除下一年度由年结自动生成的 1 月期初余额。
 */
export function openAccountingPeriod(params: ClosePeriodParams): OpenPeriodResult {
  toYearPeriod(params.year, '会计年度')
  toYearPeriod(params.period, '会计期间')
  if (params.period < 1 || params.period > 12) {
    throw new Error('会计期间必须在1到12之间')
  }

  validateLaterPeriodsNotClosed({
    db: params.db,
    accountSetId: params.accountSetId,
    year: params.year,
    period: params.period,
  })

  const existing = getPeriodClosingRecord(params)
  if (existing?.status !== 'closed') {
    throw new Error(`${params.year}年第${params.period}期未结账或已反结账，无需反结账`)
  }

  if (params.period !== 12) {
    const transaction = params.db.transaction(() => {
      params.db
        .prepare(
          `UPDATE period_closing SET status='open' WHERE account_set_id=? AND year=? AND period=?`
        )
        .run(params.accountSetId, params.year, params.period)
    })
    transaction()
    return { openedYear: params.year, openedPeriod: params.period }
  }

  const nextYear = params.year + 1
  const nextYearVoucherCount = countYearVouchers({
    db: params.db,
    accountSetId: params.accountSetId,
    year: nextYear,
  })

  const transaction = params.db.transaction(() => {
    deleteNextYearAutoOpeningBalances({
      db: params.db,
      accountSetId: params.accountSetId,
      nextYear,
    })
    params.db
      .prepare(
        `UPDATE period_closing SET status='open' WHERE account_set_id=? AND year=? AND period=?`
      )
      .run(params.accountSetId, params.year, params.period)
  })
  transaction()

  return {
    openedYear: params.year,
    openedPeriod: params.period,
    removedNextYearOpening: true,
    nextYear,
    nextYearVoucherCount,
  }
}

export interface CloseAllPeriodsResult {
  year: number
  firstPeriod: number
  closedPeriods: number[]
  skippedPeriods: number[]
  nextYear?: number
  carriedCount: number
  overwrittenNextYearOpening?: boolean
  /** FIX-003 / P0-9：因下年期初存在手工调整行而被保留、未覆盖的科目数 */
  preservedManualOpeningCount?: number
}

export interface OpenAllPeriodsResult {
  year: number
  firstPeriod: number
  openedPeriods: number[]
  skippedPeriods: number[]
  removedNextYearOpening?: boolean
  nextYear?: number
  nextYearVoucherCount?: number
}

/** 全年结账：按期间顺序月结，最后一期执行年结 */
export function closeAllAccountingPeriods(params: ClosePeriodParams): CloseAllPeriodsResult {
  toYearPeriod(params.year, '会计年度')
  const firstPeriod = getFirstPeriodForYear(params)
  const closedPeriods: number[] = []
  const skippedPeriods: number[] = []
  let carriedCount = 0
  let overwrittenNextYearOpening = false
  let preservedManualOpeningCount = 0
  const nextYear = params.year + 1

  const nextYearVoucherCount = countYearVouchers({
    db: params.db,
    accountSetId: params.accountSetId,
    year: nextYear,
  })

  const transaction = params.db.transaction(() => {
    for (let period = firstPeriod; period <= 12; period += 1) {
      const existing = getPeriodClosingRecord({ ...params, period })
      if (existing?.status === 'closed') {
        skippedPeriods.push(period)
        continue
      }

      validateNoUnpostedVouchers({ ...params, period })

      if (period !== 12) {
        closePeriodRecord({ ...params, period })
        closedPeriods.push(period)
        continue
      }

      validatePreviousPeriodsClosed(params)
      const rows = buildYearEndBalances(params.db, params.accountSetId, params.year)
      // FIX-004 / P0-8：年结前强制校验损益类科目余额为 0（事务内抛错会回滚整个全年结账）
      const standard = detectStaticReportStandard(params.db, params.accountSetId)
      validateProfitLossClosedFromRows(rows, getProfitLossAccountCodePrefixes(standard))
      const writeResult = writeNextYearInitBalances({
        db: params.db,
        accountSetId: params.accountSetId,
        sourceYear: params.year,
        rows,
      })
      closePeriodRecord({ ...params, period: 12 })
      closedPeriods.push(12)
      carriedCount = rows.length
      overwrittenNextYearOpening = nextYearVoucherCount > 0
      preservedManualOpeningCount = writeResult.preservedManual
    }
  })

  transaction()

  if (closedPeriods.length === 0) {
    throw new Error(`${params.year}年全年均已结账，无需重复操作`)
  }

  return {
    year: params.year,
    firstPeriod,
    closedPeriods,
    skippedPeriods,
    nextYear: closedPeriods.includes(12) ? nextYear : undefined,
    carriedCount,
    overwrittenNextYearOpening: closedPeriods.includes(12) ? overwrittenNextYearOpening : undefined,
    preservedManualOpeningCount: closedPeriods.includes(12)
      ? preservedManualOpeningCount
      : undefined,
  }
}

/** 全年反结账：按后进先出依次打开已结期间 */
export function openAllAccountingPeriods(params: ClosePeriodParams): OpenAllPeriodsResult {
  toYearPeriod(params.year, '会计年度')
  const firstPeriod = getFirstPeriodForYear(params)
  const openedPeriods: number[] = []
  const skippedPeriods: number[] = []
  const nextYear = params.year + 1
  let removedNextYearOpening = false

  const transaction = params.db.transaction(() => {
    for (let period = 12; period >= firstPeriod; period -= 1) {
      const existing = getPeriodClosingRecord({ ...params, period })
      if (existing?.status !== 'closed') {
        skippedPeriods.push(period)
        continue
      }

      if (period === 12) {
        deleteNextYearAutoOpeningBalances({
          db: params.db,
          accountSetId: params.accountSetId,
          nextYear,
        })
        removedNextYearOpening = true
      }

      params.db
        .prepare(
          `UPDATE period_closing SET status='open' WHERE account_set_id=? AND year=? AND period=?`
        )
        .run(params.accountSetId, params.year, period)
      openedPeriods.push(period)
    }
  })

  transaction()

  if (openedPeriods.length === 0) {
    throw new Error(`${params.year}年全年均未结账，无需反结账`)
  }

  const nextYearVoucherCount = removedNextYearOpening
    ? countYearVouchers({
        db: params.db,
        accountSetId: params.accountSetId,
        year: nextYear,
      })
    : undefined

  return {
    year: params.year,
    firstPeriod,
    openedPeriods,
    skippedPeriods,
    removedNextYearOpening,
    nextYear: removedNextYearOpening ? nextYear : undefined,
    nextYearVoucherCount,
  }
}

/** 合并 12 个月显示状态（无记录视为未结账/open） */
export function buildYearPeriodStatusView(params: {
  db: Database
  accountSetId: string
  year: number
}) {
  const rows = params.db
    .prepare(`SELECT * FROM period_closing WHERE account_set_id=? AND year=? ORDER BY period`)
    .all(params.accountSetId, params.year) as Array<{
    period: number
    status: string
    closed_at?: string | null
    closed_by?: string | null
  }>

  const byPeriod = new Map(rows.map(r => [Number(r.period), r]))
  const months: Array<{
    period: number
    status: 'open' | 'closed'
    closedAt?: string | null
  }> = []

  for (let p = 1; p <= 12; p += 1) {
    const rec = byPeriod.get(p)
    const closed = rec?.status === 'closed'
    months.push({
      period: p,
      status: closed ? 'closed' : 'open',
      closedAt: closed ? (rec?.closed_at ?? null) : undefined,
    })
  }

  let yearEnd:
    | { nextYear: number; openingBalanceRowCount: number; voucherCount: number }
    | undefined
  if (months[11]?.status === 'closed') {
    const nextYear = params.year + 1
    yearEnd = {
      nextYear,
      openingBalanceRowCount: countYearOpeningBalanceRows({
        db: params.db,
        accountSetId: params.accountSetId,
        year: nextYear,
      }),
      voucherCount: countYearVouchers({
        db: params.db,
        accountSetId: params.accountSetId,
        year: nextYear,
      }),
    }
  }

  const nextYear = params.year + 1
  const nextYearVoucherCount = countYearVouchers({
    db: params.db,
    accountSetId: params.accountSetId,
    year: nextYear,
  })
  const nextYearOpeningCount = countYearOpeningBalanceRows({
    db: params.db,
    accountSetId: params.accountSetId,
    year: nextYear,
  })
  const nextYearPendingOpening =
    nextYearVoucherCount > 0 && nextYearOpeningCount === 0
      ? { nextYear, voucherCount: nextYearVoucherCount }
      : undefined

  const currentYearVoucherCount = countYearVouchers({
    db: params.db,
    accountSetId: params.accountSetId,
    year: params.year,
  })
  const currentYearOpeningCount = countYearOpeningBalanceRows({
    db: params.db,
    accountSetId: params.accountSetId,
    year: params.year,
  })
  const openingPending =
    currentYearVoucherCount > 0 && currentYearOpeningCount === 0
      ? { year: params.year, voucherCount: currentYearVoucherCount }
      : undefined

  return {
    year: params.year,
    months,
    yearEnd,
    nextYearPendingOpening,
    openingPending,
  }
}

/** 期间结账页年份导航：开账年、账末年及可选范围 */
export function getPeriodCloseYearBounds(db: Database, accountSetId: string) {
  const accountSet = db
    .prepare('SELECT start_date FROM account_sets WHERE id=?')
    .get(accountSetId) as { start_date?: string } | undefined

  const calendarYear = new Date().getFullYear()
  let openingYear = calendarYear
  if (accountSet?.start_date) {
    const parsed = Number(String(accountSet.start_date).slice(0, 4))
    if (Number.isInteger(parsed)) openingYear = parsed
  }

  const lastRow = db
    .prepare(
      `SELECT MAX(CAST(strftime('%Y', voucher_date) AS INTEGER)) as year
       FROM vouchers
       WHERE account_set_id = ? AND status IN ('draft', 'audited', 'posted')`
    )
    .get(accountSetId) as { year: number | null } | undefined

  const lastVoucherYear = lastRow?.year ?? null
  const maxYear = Math.max(calendarYear + 1, lastVoucherYear ?? calendarYear, openingYear)

  return {
    openingYear,
    lastVoucherYear,
    minYear: openingYear,
    maxYear,
  }
}
