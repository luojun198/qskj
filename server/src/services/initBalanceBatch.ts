import { v4 as uuidv4 } from 'uuid'
import type { Database } from 'better-sqlite3'
import { accountHasAuxAccounting } from '../utils/auxItemId.js'
import {
  assertOpeningDebitCreditExclusive,
  normalizeOpeningDebitCredit,
} from '../utils/initBalanceOpening.js'
import {
  calcForeignInitBalance,
  normalizeForeignOpeningDebitCredit,
} from '../utils/initBalanceForeign.js'
import {
  calcQuantityInitBalance,
  normalizeQuantityOpeningDebitCredit,
} from '../utils/initBalanceQuantity.js'
import { formatAccountDisplayLabel, formatRowLabel } from '../utils/displayLabel.js'
import { syncInitBalanceAuxSummary } from './initBalanceAux.js'

export interface InitBalanceBatchItem {
  account_id: string
  direction: string
  opening_debit?: number
  opening_credit?: number
  pre_book_debit?: number
  pre_book_credit?: number
  foreign_opening_debit?: number
  foreign_opening_credit?: number
  foreign_pre_book_debit?: number
  foreign_pre_book_credit?: number
  qty_opening_debit?: number
  qty_opening_credit?: number
  qty_pre_book_debit?: number
  qty_pre_book_credit?: number
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
      opening_debit=?, opening_credit=?, pre_book_debit=?, pre_book_credit=?,
      foreign_init_balance=?, foreign_opening_debit=?, foreign_opening_credit=?,
      foreign_pre_book_debit=?, foreign_pre_book_credit=?,
      qty_init_balance=?, qty_opening_debit=?, qty_opening_credit=?,
      qty_pre_book_debit=?, qty_pre_book_credit=?
    WHERE id=?
  `)
  const insertStmt = db.prepare(`
    INSERT INTO init_balances
      (id, account_set_id, account_id, direction, year, period,
       init_balance, init_debit, init_credit, aux_item_id,
       opening_debit, opening_credit, pre_book_debit, pre_book_credit,
       foreign_init_balance, foreign_opening_debit, foreign_opening_credit,
       foreign_pre_book_debit, foreign_pre_book_credit,
       qty_init_balance, qty_opening_debit, qty_opening_credit,
       qty_pre_book_debit, qty_pre_book_credit)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  let success = 0
  let failed = 0
  /** 本次写过辅助明细的 (科目, 期间)，循环结束后统一重算科目汇总行 */
  const auxTouched = new Map<string, { accountId: string; period: number }>()
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
      const foreignOpening = normalizeForeignOpeningDebitCredit(
        item.foreign_opening_debit,
        item.foreign_opening_credit
      )
      const fod = foreignOpening.foreign_opening_debit
      const foc = foreignOpening.foreign_opening_credit
      const fpd = Number(item.foreign_pre_book_debit) || 0
      const fpc = Number(item.foreign_pre_book_credit) || 0
      const foreignInitBalance = calcForeignInitBalance(item.direction, fod, foc, fpd, fpc)
      const qtyOpening = normalizeQuantityOpeningDebitCredit(
        item.qty_opening_debit,
        item.qty_opening_credit
      )
      const qod = qtyOpening.qty_opening_debit
      const qoc = qtyOpening.qty_opening_credit
      const qpd = Number(item.qty_pre_book_debit) || 0
      const qpc = Number(item.qty_pre_book_credit) || 0
      const qtyInitBalance = calcQuantityInitBalance(item.direction, qod, qoc, qpd, qpc)
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
          foreignInitBalance,
          fod,
          foc,
          fpd,
          fpc,
          qtyInitBalance,
          qod,
          qoc,
          qpd,
          qpc,
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
          pc,
          foreignInitBalance,
          fod,
          foc,
          fpd,
          fpc,
          qtyInitBalance,
          qod,
          qoc,
          qpd,
          qpc
        )
      }
      // FIX-104：批量写入辅助明细后必须补维护科目汇总行，否则账簿 / 报表按
      // 「汇总行优先」取数时该科目期初会退回到累加辅助明细（多类目场景成倍放大）。
      if (auxItemId !== '') {
        auxTouched.set(`${item.account_id}|${p}`, { accountId: item.account_id, period: p })
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

  for (const { accountId, period } of auxTouched.values()) {
    try {
      syncInitBalanceAuxSummary(db, accountSetId, accountId, year, period)
    } catch (error: any) {
      failed++
      errors.push({
        id: accountId,
        label: formatAccountDisplayLabel(accountLabelMap.get(accountId)),
        error: `辅助期初汇总行重算失败：${error?.message || '未知错误'}`,
      })
    }
  }

  return { success, failed, errors }
}
