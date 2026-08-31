import type { Database } from 'better-sqlite3'
import { buildAuxItemIdMatchCondition } from './ledgerQuery.js'
import {
  appendAuxItemMatchParams,
  buildAuxItemMatchCondition,
} from '../utils/auxLedgerQuery.js'

export type AuxDeleteBlockReason = 'init_balance' | 'voucher'

export interface AuxItemRelatedVoucher {
  id: string
  voucher_no: string
  voucher_date: string
  status: 'draft' | 'audited' | 'posted'
  voucher_type_name?: string
  summary?: string
}

export interface AuxItemDeleteCheckResult {
  blocked: boolean
  reason?: AuxDeleteBlockReason
  message?: string
  item?: { id: string; code: string; name: string }
  vouchers?: AuxItemRelatedVoucher[]
  voucherTotal?: number
  initBalanceCount?: number
}

interface AuxItemContext {
  id: string
  type: string
  code: string
  name: string
  categoryCode: string
}

function getAuxItemContext(
  db: Database,
  accountSetId: string,
  itemId: string
): AuxItemContext | null {
  const row = db
    .prepare(
      `SELECT ai.id, ai.type, ai.code, ai.name, ac.code as category_code
       FROM aux_items ai
       JOIN aux_categories ac ON ac.id = ai.type AND ac.account_set_id = ai.account_set_id
       WHERE ai.id = ? AND ai.account_set_id = ?`
    )
    .get(itemId, accountSetId) as
    | { id: string; type: string; code: string; name: string; category_code: string }
    | undefined

  if (!row) return null

  return {
    id: row.id,
    type: row.type,
    code: row.code,
    name: row.name,
    categoryCode: row.category_code,
  }
}

/** 辅助项目是否在辅助期初（init_balances.aux_item_id）中被引用 */
export function isAuxItemUsedInInitBalance(
  db: Database,
  accountSetId: string,
  itemId: string,
  categoryCode: string
): boolean {
  const auxItemKey = `${categoryCode}:${itemId}`
  const matchSql = buildAuxItemIdMatchCondition('aux_item_id')
  const row = db
    .prepare(
      `SELECT id FROM init_balances
       WHERE account_set_id = ? AND aux_item_id != '' AND ${matchSql}
       LIMIT 1`
    )
    .get(accountSetId, auxItemKey, auxItemKey, auxItemKey, auxItemKey) as { id: string } | undefined

  return !!row
}

/** 辅助项目是否在凭证分录中被引用（固定列 + aux_data） */
export function isAuxItemUsedInVoucherEntries(
  db: Database,
  accountSetId: string,
  itemId: string,
  categoryCode: string
): boolean {
  const matchSql = buildAuxItemMatchCondition(categoryCode, '?')
  const params: unknown[] = [accountSetId]
  appendAuxItemMatchParams(params, categoryCode, [itemId])

  const row = db
    .prepare(
      `SELECT ve.id FROM voucher_entries ve
       WHERE ve.account_set_id = ? AND ${matchSql}
       LIMIT 1`
    )
    .get(...params) as { id: string } | undefined

  return !!row
}

const AUX_ITEM_VOUCHER_LIST_LIMIT = 50

/** 查询引用该辅助项目的凭证列表（去重，按日期倒序） */
export function getAuxItemRelatedVouchers(
  db: Database,
  accountSetId: string,
  itemId: string,
  categoryCode: string,
  categoryId: string,
  itemCode: string,
  limit = AUX_ITEM_VOUCHER_LIST_LIMIT
): AuxItemRelatedVoucher[] {
  const matchSql = buildAuxItemMatchCondition(categoryCode, '?', {
    categoryId,
    itemCodes: [itemCode],
    matchItemCodesInJsonId: true,
  })
  const params: unknown[] = [accountSetId]
  appendAuxItemMatchParams(params, categoryCode, [itemId], {
    categoryId,
    itemCodes: [itemCode],
    matchItemCodesInJsonId: true,
  })
  params.push(limit)

  return db
    .prepare(
      `SELECT
         v.id,
         v.voucher_no,
         v.voucher_date,
         v.status,
         vt.name AS voucher_type_name,
         MIN(ve.summary) AS summary
       FROM voucher_entries ve
       JOIN vouchers v ON v.id = ve.voucher_id AND v.account_set_id = ve.account_set_id
       LEFT JOIN voucher_types vt ON vt.id = v.voucher_type_id
       WHERE ve.account_set_id = ? AND ${matchSql}
       GROUP BY v.id
       ORDER BY v.voucher_date DESC, v.voucher_no DESC
       LIMIT ?`
    )
    .all(...params) as AuxItemRelatedVoucher[]
}

export function countAuxItemRelatedVouchers(
  db: Database,
  accountSetId: string,
  itemId: string,
  categoryCode: string,
  categoryId: string,
  itemCode: string
): number {
  const matchSql = buildAuxItemMatchCondition(categoryCode, '?', {
    categoryId,
    itemCodes: [itemCode],
    matchItemCodesInJsonId: true,
  })
  const params: unknown[] = [accountSetId]
  appendAuxItemMatchParams(params, categoryCode, [itemId], {
    categoryId,
    itemCodes: [itemCode],
    matchItemCodesInJsonId: true,
  })

  const row = db
    .prepare(
      `SELECT COUNT(DISTINCT v.id) AS cnt
       FROM voucher_entries ve
       JOIN vouchers v ON v.id = ve.voucher_id AND v.account_set_id = ve.account_set_id
       WHERE ve.account_set_id = ? AND ${matchSql}`
    )
    .get(...params) as { cnt: number }

  return row?.cnt ?? 0
}

export function countAuxItemInitBalanceRefs(
  db: Database,
  accountSetId: string,
  itemId: string,
  categoryCode: string
): number {
  const auxItemKey = `${categoryCode}:${itemId}`
  const matchSql = buildAuxItemIdMatchCondition('aux_item_id')
  const row = db
    .prepare(
      `SELECT COUNT(*) AS cnt FROM init_balances
       WHERE account_set_id = ? AND aux_item_id != '' AND ${matchSql}`
    )
    .get(accountSetId, auxItemKey, auxItemKey, auxItemKey, auxItemKey) as { cnt: number }

  return row?.cnt ?? 0
}

export function getAuxItemDeleteBlockReason(
  db: Database,
  accountSetId: string,
  itemId: string
): AuxItemDeleteCheckResult {
  const item = getAuxItemContext(db, accountSetId, itemId)
  if (!item) {
    return { blocked: true, message: '核算项目不存在' }
  }

  const label = `「${item.name}（${item.code}）」`
  const itemInfo = { id: item.id, code: item.code, name: item.name }

  if (isAuxItemUsedInInitBalance(db, accountSetId, itemId, item.categoryCode)) {
    const initBalanceCount = countAuxItemInitBalanceRefs(
      db,
      accountSetId,
      itemId,
      item.categoryCode
    )
    return {
      blocked: true,
      reason: 'init_balance',
      message: `辅助项目${label}已有辅助期初数据，无法删除`,
      item: itemInfo,
      initBalanceCount,
    }
  }

  if (isAuxItemUsedInVoucherEntries(db, accountSetId, itemId, item.categoryCode)) {
    const voucherTotal = countAuxItemRelatedVouchers(
      db,
      accountSetId,
      itemId,
      item.categoryCode,
      item.type,
      item.code
    )
    const vouchers = getAuxItemRelatedVouchers(
      db,
      accountSetId,
      itemId,
      item.categoryCode,
      item.type,
      item.code
    )
    return {
      blocked: true,
      reason: 'voucher',
      message: `辅助项目${label}已被 ${voucherTotal} 张凭证使用，无法删除`,
      item: itemInfo,
      vouchers,
      voucherTotal,
    }
  }

  return { blocked: false }
}

export function assertAuxItemDeletable(
  db: Database,
  accountSetId: string,
  itemId: string
): void {
  const result = getAuxItemDeleteBlockReason(db, accountSetId, itemId)
  if (result.blocked) {
    throw new Error(result.message || '该辅助项目无法删除')
  }
}

export interface AuxCategoryDeleteCheckResult {
  blocked: boolean
  message?: string
  blockedItems?: Array<{ id: string; code: string; name: string; reason: AuxDeleteBlockReason }>
}

/** 辅助类目：其下任一项目有期初或凭证引用则不可删 */
export function getAuxCategoryDeleteBlockReason(
  db: Database,
  accountSetId: string,
  categoryId: string
): AuxCategoryDeleteCheckResult {
  const category = db
    .prepare('SELECT id, code, name FROM aux_categories WHERE id = ? AND account_set_id = ?')
    .get(categoryId, accountSetId) as { id: string; code: string; name: string } | undefined

  if (!category) {
    return { blocked: true, message: '辅助类目不存在' }
  }

  const items = db
    .prepare('SELECT id, code, name FROM aux_items WHERE account_set_id = ? AND type = ?')
    .all(accountSetId, categoryId) as Array<{ id: string; code: string; name: string }>

  if (items.length === 0) {
    return { blocked: false }
  }

  const blockedItems: Array<{ id: string; code: string; name: string; reason: AuxDeleteBlockReason }> =
    []

  for (const item of items) {
    const check = getAuxItemDeleteBlockReason(db, accountSetId, item.id)
    if (check.blocked && check.reason) {
      blockedItems.push({ ...item, reason: check.reason })
    }
  }

  if (blockedItems.length > 0) {
    const initCount = blockedItems.filter(i => i.reason === 'init_balance').length
    const voucherCount = blockedItems.filter(i => i.reason === 'voucher').length
    const parts: string[] = []
    if (initCount > 0) parts.push(`${initCount} 个项目有辅助期初`)
    if (voucherCount > 0) parts.push(`${voucherCount} 个项目已被凭证使用`)
    return {
      blocked: true,
      message: `辅助类目「${category.name}」下有 ${parts.join('，')}，无法删除`,
      blockedItems,
    }
  }

  if (items.length > 0) {
    return {
      blocked: true,
      message: `该辅助类目下有 ${items.length} 个辅助项目，请先删除这些项目后再删除类目`,
    }
  }

  return { blocked: false }
}

export function assertAuxCategoryDeletable(
  db: Database,
  accountSetId: string,
  categoryId: string
): void {
  const result = getAuxCategoryDeleteBlockReason(db, accountSetId, categoryId)
  if (result.blocked) {
    throw new Error(result.message || '该辅助类目无法删除')
  }
}

/** 科目是否可删：有期初或凭证则不可删（不含报表模板等额外规则） */
export function getAccountInitOrVoucherBlockReason(
  db: Database,
  accountId: string
): string | null {
  const initBalance = db
    .prepare('SELECT COUNT(*) as count FROM init_balances WHERE account_id = ?')
    .get(accountId) as { count: number }

  if (initBalance.count > 0) {
    return '该科目有期初余额，请先清除期初余额'
  }

  const used = db
    .prepare('SELECT COUNT(*) as count FROM voucher_entries WHERE account_id = ?')
    .get(accountId) as { count: number }

  if (used.count > 0) {
    return '该科目已被凭证使用，无法删除'
  }

  return null
}

/** 批量任务失败详情展示用：名称（编码），避免暴露 UUID */
export function formatAuxItemDisplayLabel(
  item?: { code?: string; name?: string } | null,
  fallbackId?: string
): string {
  const name = item?.name?.trim()
  const code = item?.code?.trim()
  if (name && code) return `${name}（${code}）`
  if (name) return name
  if (code) return code
  return fallbackId || '未知项目'
}

export function getAuxItemDisplayLabelById(db: Database, itemId: string): string {
  const row = db
    .prepare('SELECT code, name FROM aux_items WHERE id = ?')
    .get(itemId) as { code: string; name: string } | undefined
  return formatAuxItemDisplayLabel(row, undefined)
}
