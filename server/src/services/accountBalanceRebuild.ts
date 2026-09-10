import { v4 as uuidv4 } from 'uuid'
import type Database from 'better-sqlite3'
import { centsToYuan } from '../utils/amountUtils.js'
import { buildAuxItemId } from '../utils/auxItemId.js'
import { calcSignedBalance } from '../utils/accountBalance.js'

type RebuildDb = Database.Database

type PostedEntryRow = {
  account_id: string
  account_code: string
  account_name: string
  year: number
  period: number
  direction: 'debit' | 'credit'
  amount: number
  amount_cents: number | null
  foreign_amount: number | null
  dept_id: string | null
  project_id: string | null
  supplier_id: string | null
  person_id: string | null
  func_class_id: string | null
  aux_data: string | null
}

type BalanceBucket = {
  accountId: string
  accountCode: string
  accountName: string
  year: number
  period: number
  auxItemId: string
  currentDebit: number
  currentCredit: number
  foreignCurrentDebit: number
  foreignCurrentCredit: number
}

// aux_item_id 自身可能含 "|"（组合键），key 用控制字符分隔避免歧义
const SEP = '\x01'

/**
 * 按已记账凭证 + 期初余额全量重建某账套的 account_balances。
 *
 * 口径与 voucherPosting.applyVoucherPosting 保持一致：
 *   - 一行 = (科目, 年, 期, aux_item_id)，aux_item_id 由分录辅助字段经 buildAuxItemId 生成；
 *   - current_debit / current_credit = 该期该桶的发生额合计（优先用 amount_cents）；
 *   - foreign_* = 原币发生额合计；
 *   - init_balance / foreign_init_balance = init_balances 中同 (科目, 年, aux_item_id) 的期初合计；
 *   - 另为「有期初但当年无凭证」的科目补一行 period=1、发生额为 0 的行。
 */
export function rebuildAccountBalances(db: RebuildDb, accountSetId: string): { rows: number } {
  const accounts = db
    .prepare(`SELECT id, code, name, direction FROM accounts WHERE account_set_id = ?`)
    .all(accountSetId) as Array<{ id: string; code: string; name: string; direction: 'debit' | 'credit' }>
  const accountById = new Map(accounts.map(a => [a.id, a]))

  const postedEntries = db
    .prepare(
      `SELECT ve.account_id, ve.account_code, ve.account_name,
              v.year, v.period, ve.direction, ve.amount, ve.amount_cents, ve.foreign_amount,
              ve.dept_id, ve.project_id, ve.supplier_id, ve.person_id, ve.func_class_id, ve.aux_data
       FROM voucher_entries ve
       JOIN vouchers v ON v.id = ve.voucher_id
       WHERE ve.account_set_id = ? AND v.account_set_id = ? AND v.status = 'posted'`
    )
    .all(accountSetId, accountSetId) as PostedEntryRow[]

  const buckets = new Map<string, BalanceBucket>()
  for (const entry of postedEntries) {
    if (!accountById.has(entry.account_id)) continue
    const auxItemId = buildAuxItemId(entry)
    const key = [entry.account_id, entry.year, entry.period, auxItemId].join(SEP)
    let bucket = buckets.get(key)
    if (!bucket) {
      bucket = {
        accountId: entry.account_id,
        accountCode: entry.account_code,
        accountName: entry.account_name,
        year: entry.year,
        period: entry.period,
        auxItemId,
        currentDebit: 0,
        currentCredit: 0,
        foreignCurrentDebit: 0,
        foreignCurrentCredit: 0,
      }
      buckets.set(key, bucket)
    }
    const amount = entry.amount_cents ? centsToYuan(entry.amount_cents) : Number(entry.amount) || 0
    const foreignAmount = Number(entry.foreign_amount) || 0
    if (entry.direction === 'debit') {
      bucket.currentDebit += amount
      bucket.foreignCurrentDebit += foreignAmount
    } else {
      bucket.currentCredit += amount
      bucket.foreignCurrentCredit += foreignAmount
    }
  }

  const initRows = db
    .prepare(
      `SELECT account_id, year, COALESCE(aux_item_id, '') AS aux_item_id,
              SUM(COALESCE(init_balance, 0)) AS init_balance,
              SUM(COALESCE(foreign_init_balance, 0)) AS foreign_init_balance
       FROM init_balances
       WHERE account_set_id = ?
       GROUP BY account_id, year, COALESCE(aux_item_id, '')`
    )
    .all(accountSetId) as Array<{
    account_id: string
    year: number
    aux_item_id: string
    init_balance: number
    foreign_init_balance: number
  }>
  const initByKey = new Map<string, { init: number; foreignInit: number }>()
  for (const row of initRows) {
    initByKey.set([row.account_id, row.year, row.aux_item_id].join(SEP), {
      init: Number(row.init_balance) || 0,
      foreignInit: Number(row.foreign_init_balance) || 0,
    })
  }

  // 有期初但当年无任何凭证的科目：补一行 period=1 的零发生额行（仅科目汇总行）
  const yearsWithVouchers = new Map<string, Set<number>>()
  for (const bucket of buckets.values()) {
    const key = [bucket.accountId, bucket.year, bucket.auxItemId].join(SEP)
    if (!yearsWithVouchers.has(key)) yearsWithVouchers.set(key, new Set())
    yearsWithVouchers.get(key)!.add(bucket.period)
  }
  for (const row of initRows) {
    if (row.aux_item_id !== '') continue
    const hasInit =
      Math.abs(Number(row.init_balance) || 0) >= 0.005 ||
      Math.abs(Number(row.foreign_init_balance) || 0) >= 0.005
    if (!hasInit) continue
    const account = accountById.get(row.account_id)
    if (!account) continue
    const key = [row.account_id, row.year, ''].join(SEP)
    if (yearsWithVouchers.has(key)) continue
    buckets.set([row.account_id, row.year, 1, ''].join(SEP), {
      accountId: row.account_id,
      accountCode: account.code,
      accountName: account.name,
      year: row.year,
      period: 1,
      auxItemId: '',
      currentDebit: 0,
      currentCredit: 0,
      foreignCurrentDebit: 0,
      foreignCurrentCredit: 0,
    })
  }

  const insert = db.prepare(`
    INSERT INTO account_balances (
      id, account_set_id, account_id, account_code, account_name, direction, year, period,
      init_balance, current_debit, current_credit, end_balance, end_debit, end_credit, aux_item_id,
      foreign_init_balance, foreign_current_debit, foreign_current_credit, foreign_end_balance
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?)
  `)

  const run = db.transaction(() => {
    db.prepare(`DELETE FROM account_balances WHERE account_set_id = ?`).run(accountSetId)
    let rows = 0
    for (const bucket of buckets.values()) {
      const account = accountById.get(bucket.accountId)!
      const init = initByKey.get([bucket.accountId, bucket.year, bucket.auxItemId].join(SEP)) || {
        init: 0,
        foreignInit: 0,
      }
      const currentDebit = Math.round(bucket.currentDebit * 100) / 100
      const currentCredit = Math.round(bucket.currentCredit * 100) / 100
      const foreignCurrentDebit = Math.round(bucket.foreignCurrentDebit * 100) / 100
      const foreignCurrentCredit = Math.round(bucket.foreignCurrentCredit * 100) / 100
      insert.run(
        uuidv4(),
        accountSetId,
        bucket.accountId,
        bucket.accountCode || account.code,
        bucket.accountName || account.name,
        account.direction,
        bucket.year,
        bucket.period,
        init.init,
        currentDebit,
        currentCredit,
        calcSignedBalance(account.direction, init.init, currentDebit, currentCredit),
        bucket.auxItemId,
        init.foreignInit,
        foreignCurrentDebit,
        foreignCurrentCredit,
        calcSignedBalance(
          account.direction,
          init.foreignInit,
          foreignCurrentDebit,
          foreignCurrentCredit
        )
      )
      rows += 1
    }
    return rows
  })

  return { rows: run() }
}
