import { v4 as uuidv4 } from 'uuid'
import type { Database } from 'better-sqlite3'
import { accountHasAuxAccounting } from '../utils/auxItemId.js'
import {
  assertOpeningDebitCreditExclusive,
  normalizeOpeningDebitCredit,
} from '../utils/initBalanceOpening.js'
import { formatAccountDisplayLabel, formatRowLabel } from '../utils/displayLabel.js'

export interface InitBalanceBatchItem {
  account_id: string
  direction: string
  opening_debit?: number
  opening_credit?: number
  pre_book_debit?: number
  pre_book_credit?: number
  period?: number
  aux_item_id?: string
}

function normalizeAuxItemId(value: unknown) {
  return typeof value === 'string' ? value : ''
}

function calcInitBalance(direction: string, totalDebit: number, totalCredit: number) {
  return direction === 'credit' ? totalCredit - totalDebit : totalDebit - totalCredit
}

function assertAccountEditableForDirectInit(db: Database, accountSetId: string, accountId: string) {
  const account = db
    .prepare(`SELECT is_aux, aux_types FROM accounts WHERE id=? AND account_set_id=?`)
    .get(accountId, accountSetId) as { is_aux?: number; aux_types?: string } | undefined
  if (account && accountHasAuxAccounting(account)) {
    throw new Error('该科目已启用辅助核算，请通过「辅助期初」录入，不能直接修改科目期初')
  }
}

function buildAccountLabelMap(db: Database, accountSetId: string, accountIds: string[]) {
  const uniqueIds = [...new Set(accountIds.filter(Boolean))]
  if (uniqueIds.length === 0) return new Map<string, { code: string; name: string }>()

  const placeholders = uniqueIds.map(() => '?').join(',')
  const rows = db
    .prepare(
      `SELECT id, code, name FROM accounts WHERE account_set_id = ? AND id IN (${placeholders})`
    )
    .all(accountSetId, ...uniqueIds) as Array<{ id: string; code: string; name: string }>

  return new Map(rows.map(row => [row.id, { code: row.code, name: row.name }]))
}

export interface InitBalanceBatchResult {
  success: number
  failed: number
  errors: Array<{ id: string; label: string; error: string }>
}

export function saveInitBalanceBatchItems(
  db: Database,
  accountSetId: string,
  year: number,
  items: InitBalanceBatchItem[],
  options?: {
    onProgress?: (processed: number, total: number, success: number, failed: number) => void
  }
): InitBalanceBatchResult {
  const findExisting = db.prepare(
    `SELECT id FROM init_balances WHERE account_set_id=? AND account_id=? AND year=? AND period=? AND aux_item_id=?`
  )
  const updateStmt = db.prepare(`
    UPDATE init_balances SET
      direction=?, init_balance=?, init_debit=?, init_credit=?, aux_item_id=?,
      opening_debit=?, opening_credit=?, pre_book_debit=?, pre_book_credit=?
    WHERE id=?
  `)
  const insertStmt = db.prepare(`
    INSERT INTO init_balances
      (id, account_set_id, account_id, direction, year, period,
       init_balance, init_debit, init_credit, aux_item_id,
       opening_debit, opening_credit, pre_book_debit, pre_book_credit)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  let success = 0
  let failed = 0
  const errors: Array<{ id: string; label: string; error: string }> = []
  const total = items.length
  const accountLabelMap = buildAccountLabelMap(
    db,
    accountSetId,
    items.map(item => item.account_id)
  )

  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    try {
      const auxItemId = normalizeAuxItemId(item.aux_item_id)
      if (auxItemId === '') {
        assertAccountEditableForDirectInit(db, accountSetId, item.account_id)
      }

      assertOpeningDebitCreditExclusive(item.opening_debit || 0, item.opening_credit || 0)
      const opening = normalizeOpeningDebitCredit(item.opening_debit || 0, item.opening_credit || 0)
      const od = opening.opening_debit
      const oc = opening.opening_credit
      const pd = item.pre_book_debit || 0
      const pc = item.pre_book_credit || 0
      const totalDebit = od + pd
      const totalCredit = oc + pc
      const initBalance = calcInitBalance(item.direction, totalDebit, totalCredit)
      const p = item.period || 1

      const existing = findExisting.get(accountSetId, item.account_id, year, p, auxItemId) as
        | { id: string }
        | undefined

      if (existing) {
        updateStmt.run(
          item.direction,
          initBalance,
          totalDebit,
          totalCredit,
          auxItemId,
          od,
          oc,
          pd,
          pc,
          existing.id
        )
      } else {
        insertStmt.run(
          uuidv4(),
          accountSetId,
          item.account_id,
          item.direction,
          year,
          p,
          initBalance,
          totalDebit,
          totalCredit,
          auxItemId,
          od,
          oc,
          pd,
          pc
        )
      }
      success++
    } catch (error: any) {
      failed++
      errors.push({
        id: item.account_id || `row-${i + 1}`,
        label: item.account_id
          ? formatAccountDisplayLabel(accountLabelMap.get(item.account_id))
          : formatRowLabel(i + 1),
        error: error.message || '保存失败',
      })
    }

    options?.onProgress?.(i + 1, total, success, failed)
  }

  return { success, failed, errors }
}
