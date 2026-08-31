import Database from 'better-sqlite3'
import {
  accountHasAuxAccounting,
  entryHasAuxSelection,
  extractEntryAuxSelections,
  parseAccountAuxCategoryIds,
} from '../utils/auxItemId.js'
import { AUX_LEGACY_COLUMNS } from '../utils/auxLedgerQuery.js'
import {
  getAccountRealtimeAuxBalance,
  getAccountRealtimeBalance,
} from './accountRealtimeBalance.js'
import { applyEntryToSignedBalance } from '../utils/accountBalance.js'

/**
 * 记账前数据完整性检查
 */

export interface IntegrityCheckResult {
  isValid: boolean
  errors: string[]
  warnings: string[]
}

export interface VoucherEntry {
  account_id: string
  direction: 'debit' | 'credit'
  amount: number
  [key: string]: any
}

export interface PostingIntegrityOptions {
  /** 分录已在 voucher_entries（过账前检查默认 true），余额 = 期初 + 全部凭证，不再逐行累加 */
  entriesAlreadyPersisted?: boolean
  excludeVoucherId?: string
}

function applyEntryToBalance(
  balance: number,
  amount: number,
  entryDirection: 'debit' | 'credit',
  accountDirection: string
) {
  const isSameDirection = accountDirection === entryDirection
  return balance + (isSameDirection ? amount : -amount)
}

/**
 * 检查记账前的数据完整性
 */
export function checkPostingIntegrity(
  db: Database.Database,
  accountSetId: string,
  year: number,
  period: number,
  entries: VoucherEntry[],
  options?: PostingIntegrityOptions
): IntegrityCheckResult {
  const errors: string[] = []
  const warnings: string[] = []
  const entriesAlreadyPersisted = options?.entriesAlreadyPersisted !== false
  const accountImpactMap = new Map<
    string,
    {
      account: any
      constraint: any
      balance: number
    }
  >()
  const auxImpactMap = new Map<
    string,
    {
      account: any
      constraint: any
      entry: VoucherEntry
      categoryName: string
      itemName: string
      balance: number
    }
  >()
  const cashBankImpactMap = new Map<
    string,
    {
      account: any
      balance: number
    }
  >()
  const auxCategoryMap = new Map<string, { id: string; code: string; name: string } | null>()
  const accountCache = new Map<string, any>()
  const constraintCache = new Map<string, any>()
  const auxItemNameCache = new Map<string, string>()
  let auxItemNameStmt: Database.Statement | null = null

  function getAccount(id: string) {
    if (accountCache.has(id)) return accountCache.get(id)
    const row = db.prepare('SELECT * FROM accounts WHERE id = ?').get(id) as any
    accountCache.set(id, row || null)
    return row || null
  }

  function lookupAuxItemName(itemId: string): string {
    if (auxItemNameCache.has(itemId)) return auxItemNameCache.get(itemId) || itemId
    if (!auxItemNameStmt) {
      auxItemNameStmt = db.prepare('SELECT name FROM aux_items WHERE id=? AND account_set_id=?')
    }
    const row = auxItemNameStmt.get(itemId, accountSetId) as { name?: string } | undefined
    const name = row?.name?.trim() || itemId
    auxItemNameCache.set(itemId, name)
    return name
  }

  function getEnabledCategoryCodes(account: any): string[] {
    const ids = parseAccountAuxCategoryIds(account.aux_types)
    const codes: string[] = []
    for (const id of ids) {
      const category = getAuxCategory(db, accountSetId, id, auxCategoryMap)
      if (category?.code) codes.push(category.code)
    }
    return codes
  }

  function readAccountRealtimeBalance(accountId: string): number {
    const row = getAccountRealtimeBalance(db, {
      accountId,
      accountSetId,
      year,
      period,
      excludeVoucherId: entriesAlreadyPersisted ? undefined : options?.excludeVoucherId,
    })
    return row?.end_balance ?? 0
  }

  function readAuxRealtimeBalance(
    accountId: string,
    accountDirection: 'debit' | 'credit',
    categoryCode: string,
    itemId: string
  ): number {
    return getAccountRealtimeAuxBalance(db, {
      accountId,
      accountSetId,
      year,
      period,
      categoryCode,
      itemId,
      accountDirection,
      excludeVoucherId: entriesAlreadyPersisted ? undefined : options?.excludeVoucherId,
    }).end_balance
  }

  // 找到 accountId 自身或其最近 no_negative=1 的祖先科目（"约束源"）
  function findConstraintSource(accountId: string): any | null {
    if (constraintCache.has(accountId)) return constraintCache.get(accountId)
    const visited: string[] = []
    let cur = getAccount(accountId)
    let found: any = null
    const seen = new Set<string>()
    while (cur) {
      const cid = cur.id
      if (cid) {
        if (seen.has(cid)) break
        seen.add(cid)
        visited.push(cid)
      }
      if (cur.no_negative === 1) {
        found = cur
        break
      }
      if (!cur.parent_id) break
      cur = getAccount(cur.parent_id)
    }
    for (const vid of visited) {
      if (!constraintCache.has(vid)) constraintCache.set(vid, found)
    }
    return found
  }

  // 检查每个分录
  for (const entry of entries) {
    const account = getAccount(entry.account_id)

    if (!account) {
      const accountLabel =
        entry.account_name?.trim() ||
        entry.account_code?.trim() ||
        '未知科目'
      errors.push(`科目「${accountLabel}」不存在`)
      continue
    }

    const constraint = findConstraintSource(entry.account_id)
    if (constraint) {
      const useAuxDimension = account.is_aux === 1 && accountHasAuxAccounting(account)

      if (useAuxDimension) {
        const categoryCodes = getEnabledCategoryCodes(account)
        const selections = extractEntryAuxSelections(entry, categoryCodes)
        for (const sel of selections) {
          const auxKey = `${entry.account_id}|${sel.categoryCode}|${sel.itemId}`
          const category = getAuxCategory(db, accountSetId, sel.categoryCode, auxCategoryMap)
          const categoryName = category?.name || sel.categoryCode
          const itemName = lookupAuxItemName(sel.itemId)
          const cur = auxImpactMap.get(auxKey) || {
            account,
            constraint,
            entry,
            categoryName,
            itemName,
            balance: readAuxRealtimeBalance(
              entry.account_id,
              account.direction,
              sel.categoryCode,
              sel.itemId
            ),
          }
          if (!entriesAlreadyPersisted) {
            cur.balance = applyEntryToBalance(
              cur.balance,
              entry.amount,
              entry.direction,
              account.direction
            )
          }
          auxImpactMap.set(auxKey, cur)
        }
      } else {
        const current = accountImpactMap.get(entry.account_id) || {
          account,
          constraint,
          balance: readAccountRealtimeBalance(entry.account_id),
        }
        if (!entriesAlreadyPersisted) {
          current.balance = applyEntryToBalance(
            current.balance,
            entry.amount,
            entry.direction,
            account.direction
          )
        }
        accountImpactMap.set(entry.account_id, current)
      }
    }

    // 检查辅助核算是否完整（与 extractEntryAuxSelections 同一套识别规则）
    if (account.is_aux === 1 && account.aux_types) {
      const categoryKeys = parseAccountAuxCategoryIds(account.aux_types)
      if (categoryKeys.length === 0) {
        warnings.push(`科目"${account.name}"的辅助核算配置解析失败`)
      } else {
        for (const auxKey of categoryKeys) {
          const category = getAuxCategory(db, accountSetId, auxKey, auxCategoryMap)
          const categoryCode = category?.code || auxKey
          const categoryId = category?.id || auxKey
          if (!entryHasAuxSelection(entry, categoryCode, categoryId)) {
            errors.push(`科目"${account.name}"缺少${category?.name || auxKey}辅助核算项目`)
          }
        }
      }
    }

    // 检查现金/银行科目
    if (account.is_cash === 1 || account.is_bank === 1) {
      const current = cashBankImpactMap.get(entry.account_id) || {
        account,
        balance: readAccountRealtimeBalance(entry.account_id),
      }
      if (!entriesAlreadyPersisted) {
        current.balance = applyEntryToSignedBalance(
          current.balance,
          entry.amount,
          entry.direction,
          account.direction
        )
      }
      cashBankImpactMap.set(entry.account_id, current)
    }
  }

  if (entriesAlreadyPersisted) {
    for (const [accountId, data] of accountImpactMap) {
      data.balance = readAccountRealtimeBalance(accountId)
    }
    for (const [auxKey, data] of auxImpactMap) {
      const [, categoryCode, itemId] = auxKey.split('|')
      data.balance = readAuxRealtimeBalance(
        data.account.id,
        data.account.direction,
        categoryCode,
        itemId
      )
    }
    for (const [accountId, data] of cashBankImpactMap) {
      data.balance = readAccountRealtimeBalance(accountId)
    }
  }

  function buildHint(constraint: any, accountId?: string) {
    return constraint && constraint.id && accountId && constraint.id !== accountId
      ? `（受上级科目"${constraint.name}"约束）`
      : ''
  }

  for (const { account, constraint, balance } of accountImpactMap.values()) {
    if (balance < -0.01) {
      const hint = buildHint(constraint, account.id)
      errors.push(
        `科目"${account.name}"${hint}不允许负数余额，记账后余额将为 ${balance.toFixed(2)} 元`
      )
    }
  }

  for (const { account, constraint, categoryName, itemName, balance } of auxImpactMap.values()) {
    if (balance < -0.01) {
      const hint = buildHint(constraint, account.id)
      errors.push(
        `科目"${account.name}"辅助项目（${categoryName}：${itemName}）${hint}不允许负数余额，记账后余额将为 ${balance.toFixed(2)} 元`
      )
    }
  }

  for (const { account, balance } of cashBankImpactMap.values()) {
    if (balance < -0.01) {
      const accountType = account.is_cash === 1 ? '现金' : '银行存款'
      errors.push(
        `${accountType}科目"${account.name}"余额不允许为负数，记账后余额将为 ${balance.toFixed(2)} 元`
      )
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  }
}

function getAuxCategory(
  db: Database.Database,
  accountSetId: string,
  auxKey: string,
  cache: Map<string, { id: string; code: string; name: string } | null>
) {
  if (cache.has(auxKey)) return cache.get(auxKey) || null

  const category = db
    .prepare('SELECT id, code, name FROM aux_categories WHERE account_set_id = ? AND (id = ? OR code = ?)')
    .get(accountSetId, auxKey, auxKey) as { id: string; code: string; name: string } | undefined

  cache.set(auxKey, category || null)
  return category || null
}

