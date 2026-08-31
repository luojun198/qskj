import { v4 as uuidv4 } from 'uuid'
import {
  accountHasAuxAccounting,
  buildSingleCategoryAuxItemId,
  parseAccountAuxCategoryIds,
  parseAuxItemIdParts,
  resolveSingleCategorySelection,
} from '../utils/auxItemId.js'
import { assertOpeningDebitCreditExclusive } from '../utils/initBalanceOpening.js'
import { assertInitBalanceAuxEditable } from './initBalanceClear.js'

export interface InitBalanceAuxLineInput {
  selection: Record<string, string>
  /** 多辅助类目分标签录入时，标明当前行所属类目 */
  active_category_id?: string
  opening_debit?: number
  opening_credit?: number
  pre_book_debit?: number
  pre_book_credit?: number
}

export interface InitBalanceAuxLineRow {
  aux_item_id: string
  selection: Record<string, string>
  selection_labels: Record<string, string>
  display_code?: string
  display_name?: string
  opening_debit: number
  opening_credit: number
  pre_book_debit: number
  pre_book_credit: number
  init_debit: number
  init_credit: number
  init_balance: number
}

function normalizeAmount(value: unknown): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return 0
  return Math.round(n * 100) / 100
}

export function calcInitBalanceFromAmounts(
  direction: string,
  openingDebit: number,
  openingCredit: number,
  preBookDebit: number,
  preBookCredit: number
) {
  const initDebit = openingDebit + preBookDebit
  const initCredit = openingCredit + preBookCredit
  const initBalance =
    direction === 'credit' ? initCredit - initDebit : initDebit - initCredit
  return { initDebit, initCredit, initBalance }
}

function loadCategoryMaps(db: any, accountSetId: string) {
  const categories = db
    .prepare(
      `SELECT id, code, name FROM aux_categories WHERE account_set_id=? ORDER BY sort_order, code`
    )
    .all(accountSetId) as Array<{ id: string; code: string; name: string }>

  const codeById = new Map(categories.map(c => [c.id, c.code]))
  const nameById = new Map(categories.map(c => [c.id, c.name]))
  const idByCode = new Map(categories.map(c => [c.code, c.id]))

  return { categories, codeById, nameById, idByCode }
}

function parseFieldValues(raw: unknown): Record<string, string> {
  if (!raw) return {}
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (!parsed || typeof parsed !== 'object') return {}
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (v != null && String(v).trim() !== '') out[k] = String(v)
    }
    return out
  } catch {
    return {}
  }
}

function loadCategoryFields(db: any, categoryIds: string[]) {
  const map = new Map<string, Array<{ field_key: string; field_name: string }>>()
  if (categoryIds.length === 0) return map
  const placeholders = categoryIds.map(() => '?').join(',')
  const rows = db
    .prepare(
      `SELECT category_id, field_key, field_name FROM aux_category_fields
       WHERE category_id IN (${placeholders}) AND is_enabled=1
       ORDER BY sort_order, field_key`
    )
    .all(...categoryIds) as Array<{ category_id: string; field_key: string; field_name: string }>
  for (const row of rows) {
    if (!map.has(row.category_id)) map.set(row.category_id, [])
    map.get(row.category_id)!.push({ field_key: row.field_key, field_name: row.field_name })
  }
  return map
}

export type AuxItemForInitBalance = {
  id: string
  code: string
  name: string
  remark?: string
  field_values: string | Record<string, string>
}

function loadAuxItemsByCategory(
  db: any,
  accountSetId: string,
  categoryIds: string[],
  options?: { referencedIds?: Set<string>; pickerLimit?: number }
) {
  if (categoryIds.length === 0) return new Map<string, AuxItemForInitBalance[]>()
  const pickerLimit = options?.pickerLimit ?? 200
  const referencedIds = options?.referencedIds

  const map = new Map<string, AuxItemForInitBalance[]>()
  const seenIds = new Set<string>()
  for (const catId of categoryIds) {
    map.set(catId, [])
  }

  const pushItem = (item: {
    id: string
    code: string
    name: string
    type: string
    remark?: string
    field_values?: string
  }) => {
    if (seenIds.has(item.id)) return
    seenIds.add(item.id)
    const list = map.get(item.type)!
    list.push({
      id: item.id,
      code: item.code,
      name: item.name,
      remark: item.remark || '',
      field_values: item.field_values || '{}',
    })
  }

  if (referencedIds && referencedIds.size > 0) {
    const idList = [...referencedIds]
    const items = db
      .prepare(
        `SELECT a.id, a.code, a.name, a.type, a.remark, a.field_values 
         FROM json_each(?) j
         CROSS JOIN aux_items a ON a.id = j.value
         WHERE a.account_set_id=? AND a.status='active'`
      )
      .all(JSON.stringify(idList), accountSetId) as Array<{
      id: string
      code: string
      name: string
      type: string
      remark?: string
      field_values?: string
    }>
    for (const item of items) {
      if (map.has(item.type)) pushItem(item)
    }
  }

  for (const catId of categoryIds) {
    const list = map.get(catId)!
    if (list.length >= pickerLimit) continue
    const remaining = pickerLimit - list.length
    const existingIds = new Set(list.map(i => i.id))
    const extra = db
      .prepare(
        `SELECT id, code, name, type, remark, field_values FROM aux_items
         WHERE account_set_id=? AND type=? AND status='active'
         ORDER BY code LIMIT ?`
      )
      .all(accountSetId, catId, remaining + existingIds.size) as Array<{
      id: string
      code: string
      name: string
      type: string
      remark?: string
      field_values?: string
    }>
    for (const item of extra) {
      if (existingIds.has(item.id)) continue
      pushItem(item)
      if (map.get(catId)!.length >= pickerLimit) break
    }
  }

  for (const catId of categoryIds) {
    const list = map.get(catId)!
    if (list.length > 5000) {
      list.sort((a, b) => (a.code > b.code ? 1 : a.code < b.code ? -1 : 0))
    } else {
      list.sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }))
    }
  }
  return map
}

const resolverCache = new WeakMap<AuxItemForInitBalance[], {
  byId: Map<string, string>,
  byCode: Map<string, string>
}>()

/** 将录入值（id 或编码）解析为当前类目下有效的辅助项目 id */
export function resolveAuxItemIdInCategory(
  items: AuxItemForInitBalance[],
  itemIdOrCode: string
): string | null {
  const token = String(itemIdOrCode ?? '').trim()
  if (!token) return null

  let cache = resolverCache.get(items)
  if (!cache) {
    cache = { byId: new Map(), byCode: new Map() }
    for (const item of items) {
      cache.byId.set(item.id, item.id)
      const code = String(item.code || '').trim()
      if (code) {
        cache.byCode.set(code, item.id)
      }
    }
    resolverCache.set(items, cache)
  }

  if (cache.byId.has(token)) return cache.byId.get(token)!
  if (cache.byCode.has(token)) return cache.byCode.get(token)!

  if (/^\d+$/.test(token)) {
    const numeric = Number(token)
    const strNumeric = String(numeric)
    if (cache.byCode.has(strNumeric)) return cache.byCode.get(strNumeric)!
  }

  return null
}

function resolveAuxItemIdFromDb(
  db: any,
  accountSetId: string,
  categoryId: string,
  itemIdOrCode: string
): string | null {
  const token = String(itemIdOrCode ?? '').trim()
  if (!token) return null
  const byId = db
    .prepare(
      `SELECT id FROM aux_items WHERE account_set_id=? AND type=? AND id=? AND status='active'`
    )
    .get(accountSetId, categoryId, token) as { id: string } | undefined
  if (byId) return byId.id
  const byCode = db
    .prepare(
      `SELECT id FROM aux_items WHERE account_set_id=? AND type=? AND code=? AND status='active'`
    )
    .get(accountSetId, categoryId, token) as { id: string } | undefined
  if (byCode) return byCode.id
  if (/^\d+$/.test(token)) {
    const numeric = Number(token)
    const byNumeric = db
      .prepare(
        `SELECT id FROM aux_items
         WHERE account_set_id=? AND type=? AND status='active'
           AND code GLOB '[0-9]*' AND CAST(code AS INTEGER)=?`
      )
      .get(accountSetId, categoryId, numeric) as { id: string } | undefined
    if (byNumeric) return byNumeric.id
  }
  return null
}

function buildAuxItemResolverMap(
  db: any,
  accountSetId: string,
  categoryIds: string[]
): (categoryId: string, itemIdOrCode: string) => string | null {
  const byCategory = new Map<string, Map<string, string>>()

  for (const categoryId of categoryIds) {
    const tokenMap = new Map<string, string>()
    const items = db
      .prepare(
        `SELECT id, code FROM aux_items
         WHERE account_set_id=? AND type=? AND status='active'`
      )
      .all(accountSetId, categoryId) as Array<{ id: string; code: string }>

    for (const item of items) {
      tokenMap.set(item.id, item.id)
      const code = String(item.code ?? '').trim()
      if (code) {
        tokenMap.set(code, item.id)
        if (/^\d+$/.test(code)) {
          tokenMap.set(String(Number(code)), item.id)
        }
      }
    }
    byCategory.set(categoryId, tokenMap)
  }

  return (categoryId: string, itemIdOrCode: string) => {
    const token = String(itemIdOrCode ?? '').trim()
    if (!token) return null
    const map = byCategory.get(categoryId)
    if (!map) return null
    return map.get(token) ?? resolveAuxItemIdFromDb(db, accountSetId, categoryId, token)
  }
}

function collectReferencedIdsFromInitRows(
  db: any,
  accountSetId: string,
  rows: any[],
  enabledCategoryIds: string[],
  idByCode: Map<string, string>,
  resolveItem: (categoryId: string, itemIdOrCode: string) => string | null
): Set<string> {
  const ids = new Set<string>()
  for (const row of rows) {
    const parts = parseAuxItemIdParts(row.aux_item_id)
    for (const [code, token] of Object.entries(parts)) {
      const catId = idByCode.get(code)
      if (!catId || !enabledCategoryIds.includes(catId)) continue
      const resolved = resolveItem(catId, token)
      if (resolved) ids.add(resolved)
    }
  }
  return ids
}

const selectionLabelsCache = new WeakMap<Map<string, AuxItemForInitBalance[]>, Map<string, AuxItemForInitBalance>>()

function resolveSelectionLabels(
  selection: Record<string, string>,
  codeById: Map<string, string>,
  nameById: Map<string, string>,
  itemsByCategory: Map<string, AuxItemForInitBalance[]>
): Record<string, string> {
  const labels: Record<string, string> = {}
  let itemMap = selectionLabelsCache.get(itemsByCategory)
  if (!itemMap) {
    itemMap = new Map()
    for (const list of itemsByCategory.values()) {
      for (const item of list) {
        itemMap.set(item.id, item)
      }
    }
    selectionLabelsCache.set(itemsByCategory, itemMap)
  }

  for (const [catId, itemId] of Object.entries(selection)) {
    const catName = nameById.get(catId) || catId
    const item = itemMap.get(itemId)
    labels[catId] = item ? `${catName}:${item.name}` : catName
  }
  return labels
}

const AUX_ITEMS_REFERENCE_LOAD_LIMIT = 500000
const AUX_DETAILS_ALL_LIMIT = 5000

export interface InitBalanceAuxDetailsOptions {
  linesMode?: 'all' | 'none' | 'page'
  offset?: number
  limit?: number
  categoryId?: string
  keyword?: string
  sort?: 'code' | 'name' | 'opening_debit' | 'opening_credit' | 'pre_book_debit' | 'pre_book_credit' | 'init_balance'
  order?: 'asc' | 'desc'
  nonzeroOnly?: boolean
}

type AuxItemResolver = (categoryId: string, itemIdOrCode: string) => string | null

function initBalanceRowHasAmount(row: {
  opening_debit?: number
  opening_credit?: number
  pre_book_debit?: number
  pre_book_credit?: number
}) {
  return (
    (row.opening_debit || 0) !== 0 ||
    (row.opening_credit || 0) !== 0 ||
    (row.pre_book_debit || 0) !== 0 ||
    (row.pre_book_credit || 0) !== 0
  )
}

function countActiveAuxItemsByCategory(db: any, accountSetId: string, categoryIds: string[]) {
  const totals: Record<string, number> = {}
  for (const catId of categoryIds) {
    const row = db
      .prepare(
        `SELECT COUNT(*) AS c FROM aux_items
         WHERE account_set_id=? AND type=? AND status='active'`
      )
      .get(accountSetId, catId) as { c: number }
    totals[catId] = row?.c || 0
  }
  return totals
}

function selectionFromAuxItemIdWithResolver(
  auxItemId: string,
  enabledCategoryIds: string[],
  codeById: Map<string, string>,
  idByCode: Map<string, string>,
  itemsByCategory: Map<string, AuxItemForInitBalance[]>,
  resolveItem?: AuxItemResolver
): Record<string, string> {
  const parts = parseAuxItemIdParts(auxItemId)
  const codes = Object.keys(parts)
  const selection: Record<string, string> = {}

  const resolve = (catId: string, token: string) => {
    const items = itemsByCategory.get(catId) || []
    const fromList = resolveAuxItemIdInCategory(items, token)
    if (fromList) return fromList
    return resolveItem?.(catId, token) ?? null
  }

  if (codes.length === 1) {
    const code = codes[0]
    const catId = idByCode.get(code)
    if (!catId || !enabledCategoryIds.includes(catId)) return selection
    const resolved = resolve(catId, parts[code])
    if (resolved) selection[catId] = resolved
    return selection
  }

  for (const catId of enabledCategoryIds) {
    const code = codeById.get(catId)
    const raw = code ? parts[code] : undefined
    if (!raw) continue
    const resolved = resolve(catId, raw)
    if (resolved) selection[catId] = resolved
  }
  return selection
}

function computeCategoryTabStatsFromDbRows(
  dbRows: any[],
  enabledCategoryIds: string[],
  codeById: Map<string, string>,
  idByCode: Map<string, string>,
  itemsByCategory: Map<string, AuxItemForInitBalance[]>,
  resolveItem: AuxItemResolver | undefined,
  itemTotalsByCategory: Record<string, number>
) {
  const filledSets = new Map<string, Set<string>>()
  for (const catId of enabledCategoryIds) filledSets.set(catId, new Set())

  for (const row of dbRows) {
    if (!initBalanceRowHasAmount(row)) continue
    const selection = selectionFromAuxItemIdWithResolver(
      row.aux_item_id,
      enabledCategoryIds,
      codeById,
      idByCode,
      itemsByCategory,
      resolveItem
    )
    for (const [catId, itemId] of Object.entries(selection)) {
      if (itemId) filledSets.get(catId)?.add(itemId)
    }
  }

  const stats: Record<string, { filled: number; total: number }> = {}
  for (const catId of enabledCategoryIds) {
    stats[catId] = {
      filled: filledSets.get(catId)?.size || 0,
      total: itemTotalsByCategory[catId] ?? itemsByCategory.get(catId)?.length ?? 0,
    }
  }
  return stats
}

function loadAuxItemDisplayMetaMap(db: any, accountSetId: string, itemIds: Iterable<string>) {
  const map = new Map<string, { code: string; name: string }>()
  const idList = [...new Set(itemIds)].filter(Boolean)
  if (idList.length === 0) return map

  const items = db
    .prepare(
      `SELECT a.id, a.code, a.name 
       FROM json_each(?) j
       CROSS JOIN aux_items a ON a.id = j.value
       WHERE a.account_set_id=? AND a.status='active'`
    )
    .all(JSON.stringify(idList), accountSetId) as Array<{ id: string; code: string; name: string }>
    
  for (const item of items) {
    map.set(item.id, { code: item.code || '', name: item.name || '' })
  }
  return map
}

function buildInitBalanceAuxLinesFromDbRows(
  dbRows: any[],
  enabledCategoryIds: string[],
  codeById: Map<string, string>,
  idByCode: Map<string, string>,
  nameById: Map<string, string>,
  itemsByCategory: Map<string, AuxItemForInitBalance[]>,
  resolveItem?: AuxItemResolver,
  attachDisplayMeta?: Map<string, { code: string; name: string }>
): InitBalanceAuxLineRow[] {
  const lines: InitBalanceAuxLineRow[] = []

  for (const row of dbRows) {
    const selection = selectionFromAuxItemIdWithResolver(
      row.aux_item_id,
      enabledCategoryIds,
      codeById,
      idByCode,
      itemsByCategory,
      resolveItem
    )
    const filled = enabledCategoryIds.filter(id => selection[id])
    if (filled.length === 0) continue

    const parts = parseAuxItemIdParts(row.aux_item_id)
    const amountRow = {
      opening_debit: row.opening_debit || 0,
      opening_credit: row.opening_credit || 0,
      pre_book_debit: row.pre_book_debit || 0,
      pre_book_credit: row.pre_book_credit || 0,
      init_debit: row.init_debit || 0,
      init_credit: row.init_credit || 0,
      init_balance: row.init_balance || 0,
    }

    const pushLine = (lineSelection: Record<string, string>, auxItemId: string) => {
      const itemId = Object.values(lineSelection)[0]
      const meta = itemId && attachDisplayMeta ? attachDisplayMeta.get(itemId) : undefined
      lines.push({
        aux_item_id: auxItemId,
        selection: lineSelection,
        selection_labels: resolveSelectionLabels(
          lineSelection,
          codeById,
          nameById,
          itemsByCategory
        ),
        display_code: meta?.code,
        display_name: meta?.name,
        ...amountRow,
      })
    }

    if (Object.keys(parts).length === 1 && filled.length === 1) {
      pushLine(selection, row.aux_item_id)
      continue
    }

    for (const catId of filled) {
      const itemId = selection[catId]
      const code = codeById.get(catId)
      if (!code || !itemId) continue
      const auxItemId = buildSingleCategoryAuxItemId(codeById, catId, itemId)
      pushLine({ [catId]: itemId }, auxItemId || row.aux_item_id)
    }
  }

  return lines
}

function selectionFromAuxItemId(
  auxItemId: string,
  enabledCategoryIds: string[],
  codeById: Map<string, string>,
  idByCode: Map<string, string>,
  itemsByCategory: Map<string, AuxItemForInitBalance[]>
): Record<string, string> {
  const parts = parseAuxItemIdParts(auxItemId)
  const codes = Object.keys(parts)
  const selection: Record<string, string> = {}

  // 期初辅助按类目分标签录入：优先解析单类目 aux_item_id
  if (codes.length === 1) {
    const code = codes[0]
    const catId = idByCode.get(code)
    if (!catId || !enabledCategoryIds.includes(catId)) return selection
    const items = itemsByCategory.get(catId) || []
    const resolved = resolveAuxItemIdInCategory(items, parts[code])
    if (resolved) selection[catId] = resolved
    return selection
  }

  // 兼容历史组合 aux_item_id（dept:x|proj:y）
  for (const catId of enabledCategoryIds) {
    const code = codeById.get(catId)
    const raw = code ? parts[code] : undefined
    if (!raw) continue
    const items = itemsByCategory.get(catId) || []
    const resolved = resolveAuxItemIdInCategory(items, raw)
    if (resolved) selection[catId] = resolved
  }
  return selection
}

export function getInitBalanceAuxConfig(db: any, accountSetId: string) {
  const { categories, codeById, nameById } = loadCategoryMaps(db, accountSetId)

  const accounts = db
    .prepare(
      `SELECT a.id, a.code, a.name, a.direction, a.parent_id, a.is_aux, a.aux_types
       FROM accounts a
       WHERE a.account_set_id=? AND a.is_enabled=1
       ORDER BY a.code`
    )
    .all(accountSetId) as any[]

  const parentIds = new Set(
    accounts.filter((a: any) => a.parent_id).map((a: any) => a.parent_id)
  )

  const auxAccounts = accounts
    .filter((a: any) => !parentIds.has(a.id) && accountHasAuxAccounting(a))
    .map((a: any) => ({
      id: a.id,
      code: a.code,
      name: a.name,
      direction: a.direction,
      aux_category_ids: parseAccountAuxCategoryIds(a.aux_types),
    }))

  return {
    categories: categories.map(c => ({
      id: c.id,
      code: c.code,
      name: c.name,
    })),
    aux_accounts: auxAccounts,
    code_by_category_id: Object.fromEntries(codeById),
    name_by_category_id: Object.fromEntries(nameById),
  }
}

const AUX_DETAILS_SORT_SQL: Record<NonNullable<InitBalanceAuxDetailsOptions['sort']>, string> = {
  code: 'ai.code',
  name: 'ai.name',
  opening_debit: 'opening_debit',
  opening_credit: 'opening_credit',
  pre_book_debit: 'pre_book_debit',
  pre_book_credit: 'pre_book_credit',
  init_balance: 'init_balance',
}

function buildPagedInitBalanceAuxDetails(
  db: any,
  accountSetId: string,
  account: any,
  year: number,
  period: number,
  enabledCategoryIds: string[],
  codeById: Map<string, string>,
  nameById: Map<string, string>,
  options: InitBalanceAuxDetailsOptions,
  dbRowCount: number
) {
  const categoryId =
    options.categoryId && enabledCategoryIds.includes(options.categoryId)
      ? options.categoryId
      : enabledCategoryIds[0]
  if (!categoryId) throw new Error('当前科目没有可用的辅助类别')

  const categoryCode = codeById.get(categoryId) || ''
  const categoryName = nameById.get(categoryId) || ''
  const prefix = `${categoryCode}:`
  const offset = Math.max(0, Math.trunc(options.offset || 0))
  const limit = Math.min(500, Math.max(1, Math.trunc(options.limit || 50)))
  const keyword = String(options.keyword || '').trim()
  const order = options.order === 'desc' ? 'DESC' : 'ASC'
  const sortSql = AUX_DETAILS_SORT_SQL[options.sort || 'code']

  const balanceJoin = `
    LEFT JOIN init_balances ib
      ON ib.account_set_id=? AND ib.account_id=? AND ib.year=? AND ib.period=?
     AND ib.aux_item_id=(? || ai.id)`
  const joinParams = [accountSetId, account.id, year, period, prefix]
  const where: string[] = ["ai.account_set_id=?", "ai.type=?", "ai.status='active'"]
  const whereParams: any[] = [accountSetId, categoryId]
  if (keyword) {
    where.push('(ai.code LIKE ? OR ai.name LIKE ?)')
    const kw = `%${keyword}%`
    whereParams.push(kw, kw)
  }
  if (options.nonzeroOnly) {
    where.push(`(
      COALESCE(ib.opening_debit,0) != 0 OR COALESCE(ib.opening_credit,0) != 0 OR
      COALESCE(ib.pre_book_debit,0) != 0 OR COALESCE(ib.pre_book_credit,0) != 0
    )`)
  }
  const whereSql = where.join(' AND ')

  const countJoin = options.nonzeroOnly ? balanceJoin : ''
  const countJoinParams = options.nonzeroOnly ? joinParams : []
  const totalRow = db
    .prepare(`SELECT COUNT(*) AS total FROM aux_items ai ${countJoin} WHERE ${whereSql}`)
    .get(...countJoinParams, ...whereParams) as { total: number }
  const total = Number(totalRow?.total || 0)

  const pageRows =
    options.linesMode === 'none'
      ? []
      : (db
          .prepare(
            `SELECT ai.id, ai.code, ai.name,
                    COALESCE(ib.opening_debit,0) AS opening_debit,
                    COALESCE(ib.opening_credit,0) AS opening_credit,
                    COALESCE(ib.pre_book_debit,0) AS pre_book_debit,
                    COALESCE(ib.pre_book_credit,0) AS pre_book_credit,
                    COALESCE(ib.init_debit,0) AS init_debit,
                    COALESCE(ib.init_credit,0) AS init_credit,
                    COALESCE(ib.init_balance,0) AS init_balance
             FROM aux_items ai ${balanceJoin}
             WHERE ${whereSql}
             ORDER BY ${sortSql} ${order}, ai.id ASC
             LIMIT ? OFFSET ?`
          )
          .all(...joinParams, ...whereParams, limit, offset) as any[])

  const category_stats: Record<string, any> = {}
  for (const catId of enabledCategoryIds) {
    const code = codeById.get(catId) || ''
    const itemTotal = db
      .prepare(
        `SELECT COUNT(*) AS total FROM aux_items
         WHERE account_set_id=? AND type=? AND status='active'`
      )
      .get(accountSetId, catId) as { total: number }
    const stats = db
      .prepare(
        `SELECT SUM(CASE WHEN
                  COALESCE(opening_debit,0) != 0 OR COALESCE(opening_credit,0) != 0 OR
                  COALESCE(pre_book_debit,0) != 0 OR COALESCE(pre_book_credit,0) != 0
                THEN 1 ELSE 0 END) AS filled,
                SUM(COALESCE(opening_debit,0)) AS opening_debit,
                SUM(COALESCE(opening_credit,0)) AS opening_credit,
                SUM(COALESCE(pre_book_debit,0)) AS pre_book_debit,
                SUM(COALESCE(pre_book_credit,0)) AS pre_book_credit,
                SUM(COALESCE(init_balance,0)) AS init_balance
         FROM init_balances
         WHERE account_set_id=? AND account_id=? AND year=? AND period=?
           AND aux_item_id LIKE ?`
      )
      .get(accountSetId, account.id, year, period, `${code}:%`) as any
    category_stats[catId] = {
      total: Number(itemTotal?.total || 0),
      filled: Number(stats?.filled || 0),
      opening_debit: Number(stats?.opening_debit || 0),
      opening_credit: Number(stats?.opening_credit || 0),
      pre_book_debit: Number(stats?.pre_book_debit || 0),
      pre_book_credit: Number(stats?.pre_book_credit || 0),
      init_balance: Number(stats?.init_balance || 0),
    }
  }

  const itemsByCategory = loadAuxItemsByCategory(db, accountSetId, enabledCategoryIds, {
    pickerLimit: 200,
  })
  const items: Record<string, AuxItemForInitBalance[]> = {}
  for (const catId of enabledCategoryIds) items[catId] = itemsByCategory.get(catId) || []
  const categoryFieldsMap = loadCategoryFields(db, enabledCategoryIds)
  const category_fields: Record<string, Array<{ field_key: string; field_name: string }>> = {}
  for (const catId of enabledCategoryIds) category_fields[catId] = categoryFieldsMap.get(catId) || []
  const categories = enabledCategoryIds.map(catId => ({
    id: catId,
    code: codeById.get(catId) || '',
    name: nameById.get(catId) || '',
  }))
  const activeStats = category_stats[categoryId]
  const lines: InitBalanceAuxLineRow[] = pageRows.map(row => ({
    aux_item_id: `${prefix}${row.id}`,
    selection: { [categoryId]: row.id },
    selection_labels: { [categoryId]: `${categoryName}:${row.name}` },
    display_code: row.code || '',
    display_name: row.name || '',
    opening_debit: Number(row.opening_debit || 0),
    opening_credit: Number(row.opening_credit || 0),
    pre_book_debit: Number(row.pre_book_debit || 0),
    pre_book_credit: Number(row.pre_book_credit || 0),
    init_debit: Number(row.init_debit || 0),
    init_credit: Number(row.init_credit || 0),
    init_balance: Number(row.init_balance || 0),
  }))
  const accountSet = db.prepare('SELECT start_date FROM account_sets WHERE id=?').get(accountSetId) as
    | { start_date?: string }
    | undefined
  const startDate = accountSet?.start_date ? new Date(accountSet.start_date) : null
  const startMonth = startDate ? startDate.getMonth() + 1 : 1

  return {
    account: {
      id: account.id,
      code: account.code,
      name: account.name,
      direction: account.direction,
      aux_category_ids: enabledCategoryIds,
    },
    categories,
    items,
    category_fields,
    code_by_category_id: Object.fromEntries(codeById),
    lines,
    total,
    summary: activeStats,
    category_stats,
    has_more: offset + lines.length < total,
    db_row_count: dbRowCount,
    line_count: dbRowCount,
    // 所有数据量统一走服务端分页。否则小数据会回退到旧前端路径，
    // 旧路径只包含已有期初记录，尚未录入金额的辅助项目会被误判为空表。
    lines_paginated: true,
    items_omitted: Object.values(category_stats).some((stat: any) => stat.total > 200),
    isMidYear: startMonth > 1,
    startMonth,
  }
}

export function getInitBalanceAuxDetails(
  db: any,
  accountSetId: string,
  accountId: string,
  year: number,
  period = 1,
  options?: InitBalanceAuxDetailsOptions
) {
  const account = db
    .prepare(`SELECT * FROM accounts WHERE id=? AND account_set_id=?`)
    .get(accountId, accountSetId) as any

  if (!account) {
    throw new Error('科目不存在')
  }
  if (!accountHasAuxAccounting(account)) {
    throw new Error('该科目未启用辅助核算')
  }

  const enabledCategoryIds = parseAccountAuxCategoryIds(account.aux_types)
  const { codeById, nameById, idByCode } = loadCategoryMaps(db, accountSetId)

  const linesMode = options?.linesMode ?? 'all'
  const countRow = db
    .prepare(
      `SELECT COUNT(*) AS count FROM init_balances
       WHERE account_set_id=? AND account_id=? AND year=? AND period=? AND aux_item_id!=''`
    )
    .get(accountSetId, accountId, year, period) as { count: number }
  const dbRowCount = Number(countRow?.count || 0)

  if (linesMode === 'none' || linesMode === 'page') {
    return buildPagedInitBalanceAuxDetails(
      db,
      accountSetId,
      account,
      year,
      period,
      enabledCategoryIds,
      codeById,
      nameById,
      { ...options, linesMode },
      dbRowCount
    )
  }

  if (dbRowCount > AUX_DETAILS_ALL_LIMIT) {
    const error = new Error(
      `辅助期初明细共 ${dbRowCount} 行，超过全量读取上限 ${AUX_DETAILS_ALL_LIMIT} 行，请使用分页查询或后台导出。`
    ) as Error & { statusCode?: number; code?: string }
    error.statusCode = 422
    error.code = 'AUX_DETAILS_ALL_LIMIT_EXCEEDED'
    throw error
  }

  const rows = db
    .prepare(
      `SELECT * FROM init_balances
       WHERE account_set_id=? AND account_id=? AND year=? AND period=? AND aux_item_id != ''
       ORDER BY aux_item_id, id`
    )
    .all(accountSetId, accountId, year, period) as any[]

  const db_row_count = rows.length
  const lines_paginated = false
  const rowSlice = rows

  // We always need resolver map to extract selection
  const fullResolverMap = buildAuxItemResolverMap(db, accountSetId, enabledCategoryIds)

  const targetRowsForReference = rows
  const referencedIds = collectReferencedIdsFromInitRows(
    db,
    accountSetId,
    targetRowsForReference,
    enabledCategoryIds,
    idByCode,
    fullResolverMap
  )
  
  // If we are in page mode, we don't need to load the full items reference list because frontend already has it.
  const omitFullReferencedItems = referencedIds.size > AUX_ITEMS_REFERENCE_LOAD_LIMIT
  const resolveItem = omitFullReferencedItems ? fullResolverMap : undefined
  const itemsByCategory = loadAuxItemsByCategory(db, accountSetId, enabledCategoryIds, {
    referencedIds: omitFullReferencedItems ? undefined : referencedIds,
  })
  
  const itemTotalsByCategory = omitFullReferencedItems
    ? countActiveAuxItemsByCategory(db, accountSetId, enabledCategoryIds)
    : {}
  const category_stats = computeCategoryTabStatsFromDbRows(
    rows,
    enabledCategoryIds,
    codeById,
    idByCode,
    itemsByCategory,
    resolveItem,
    itemTotalsByCategory
  )

  const attachDisplayMeta =
    omitFullReferencedItems && rowSlice.length > 0
      ? loadAuxItemDisplayMetaMap(
          db,
          accountSetId,
          rowSlice.flatMap(row => {
            const selection = selectionFromAuxItemIdWithResolver(
              row.aux_item_id,
              enabledCategoryIds,
              codeById,
              idByCode,
              itemsByCategory,
              resolveItem
            )
            return Object.values(selection)
          })
        )
      : undefined
  const lines = buildInitBalanceAuxLinesFromDbRows(
    rowSlice,
    enabledCategoryIds,
    codeById,
    idByCode,
    nameById,
    itemsByCategory,
    resolveItem,
    attachDisplayMeta
  )

  const items: Record<string, AuxItemForInitBalance[]> = {}
  for (const catId of enabledCategoryIds) {
    items[catId] = itemsByCategory.get(catId) || []
  }

  const categoryFieldsMap = loadCategoryFields(db, enabledCategoryIds)
  const category_fields: Record<string, Array<{ field_key: string; field_name: string }>> = {}
  for (const catId of enabledCategoryIds) {
    category_fields[catId] = categoryFieldsMap.get(catId) || []
  }

  const categories = enabledCategoryIds.map(catId => ({
    id: catId,
    code: codeById.get(catId) || '',
    name: nameById.get(catId) || '',
  }))

  const accountSet = db
    .prepare('SELECT start_date FROM account_sets WHERE id=?')
    .get(accountSetId) as { start_date?: string } | undefined
  const startDate = accountSet?.start_date ? new Date(accountSet.start_date) : null
  const startMonth = startDate ? startDate.getMonth() + 1 : 1
  const isMidYear = startMonth > 1

  return {
    account: {
      id: account.id,
      code: account.code,
      name: account.name,
      direction: account.direction,
      aux_category_ids: enabledCategoryIds,
    },
    categories,
    items,
    category_fields,
    code_by_category_id: Object.fromEntries(codeById),
    lines,
    db_row_count,
    line_count: db_row_count,
    lines_paginated,
    category_stats,
    items_omitted: omitFullReferencedItems,
    isMidYear,
    startMonth,
  }
}

interface CategorySumBucket {
  opening_debit: number
  opening_credit: number
  pre_book_debit: number
  pre_book_credit: number
  hasAmount: boolean
}

function bucketHasAmount(b: CategorySumBucket) {
  return (
    b.hasAmount ||
    b.opening_debit !== 0 ||
    b.opening_credit !== 0 ||
    b.pre_book_debit !== 0 ||
    b.pre_book_credit !== 0
  )
}

function categoryInitBalanceFromBucket(direction: string, b: CategorySumBucket) {
  return calcInitBalanceFromAmounts(
    direction,
    b.opening_debit,
    b.opening_credit,
    b.pre_book_debit,
    b.pre_book_credit
  ).initBalance
}

/**
 * 4 个分项独立校验：期初借/期初贷/账前借/账前贷必须分别相等。
 * 不能只看 init_balance（净余额）—— 例如 类目 A: 期初借 100/账前贷 30 vs 类目 B: 期初借 0/账前借 100/账前贷 30
 * 净余额都是 70 但分项明显不一致。
 */
const AUX_BUCKET_AMOUNT_FIELDS: Array<{
  key: keyof CategorySumBucket
  label: string
}> = [
  { key: 'opening_debit', label: '期初借方' },
  { key: 'opening_credit', label: '期初贷方' },
  { key: 'pre_book_debit', label: '账前借方发生额' },
  { key: 'pre_book_credit', label: '账前贷方发生额' },
]

function amountsClose(a: CategorySumBucket, b: CategorySumBucket, eps = 0.02) {
  for (const { key } of AUX_BUCKET_AMOUNT_FIELDS) {
    const av = Number(a[key] || 0)
    const bv = Number(b[key] || 0)
    if (Math.abs(av - bv) >= eps) return false
  }
  return true
}

/** 返回 ref bucket 与目标 bucket 之间所有不一致的分项 */
function diffBucketFields(
  ref: CategorySumBucket,
  target: CategorySumBucket,
  eps = 0.02
): Array<{ key: keyof CategorySumBucket; label: string; refValue: number; targetValue: number }> {
  const diffs = []
  for (const { key, label } of AUX_BUCKET_AMOUNT_FIELDS) {
    const refValue = Number(ref[key] || 0)
    const targetValue = Number(target[key] || 0)
    if (Math.abs(refValue - targetValue) >= eps) {
      diffs.push({ key, label, refValue, targetValue })
    }
  }
  return diffs
}

export interface AuxCategoryBalanceSummary {
  category_id: string
  category_name: string
  opening_debit: number
  opening_credit: number
  pre_book_debit: number
  pre_book_credit: number
  init_balance: number
}

export interface InitBalanceAuxCategoryMismatch {
  account_id: string
  account_code: string
  account_name: string
  direction: string
  message: string
  categories: AuxCategoryBalanceSummary[]
  /** 不一致的分项字段：opening_debit/opening_credit/pre_book_debit/pre_book_credit */
  mismatched_fields: Array<{ key: string; label: string }>
}

function computeAccountAuxCategorySums(
  db: any,
  accountSetId: string,
  accountId: string,
  year: number,
  period: number
) {
  const account = db
    .prepare(`SELECT aux_types, direction FROM accounts WHERE id=? AND account_set_id=?`)
    .get(accountId, accountSetId) as { aux_types?: unknown; direction: string } | undefined
  if (!account) return null

  const enabledCategoryIds = parseAccountAuxCategoryIds(account.aux_types)
  if (enabledCategoryIds.length === 0) return null

  const { codeById, idByCode, nameById } = loadCategoryMaps(db, accountSetId)
  const sumCategory = db.prepare(
    `SELECT SUM(COALESCE(opening_debit,0)) AS opening_debit,
            SUM(COALESCE(opening_credit,0)) AS opening_credit,
            SUM(COALESCE(pre_book_debit,0)) AS pre_book_debit,
            SUM(COALESCE(pre_book_credit,0)) AS pre_book_credit
     FROM init_balances
     WHERE account_set_id=? AND account_id=? AND year=? AND period=? AND aux_item_id!=''
       AND (aux_item_id LIKE ? OR aux_item_id LIKE ?)`
  )
  const detailRows = enabledCategoryIds.map(catId => {
    const code = codeById.get(catId) || ''
    const row = sumCategory.get(
      accountSetId,
      accountId,
      year,
      period,
      `${code}:%`,
      `%|${code}:%`
    ) as any
    return {
      aux_item_id: `${code}:__summary__`,
      opening_debit: Number(row?.opening_debit || 0),
      opening_credit: Number(row?.opening_credit || 0),
      pre_book_debit: Number(row?.pre_book_debit || 0),
      pre_book_credit: Number(row?.pre_book_credit || 0),
    }
  }) as Array<{
    aux_item_id: string
    opening_debit: number
    opening_credit: number
    pre_book_debit: number
    pre_book_credit: number
  }>

  const sums = new Map<string, CategorySumBucket>()
  for (const catId of enabledCategoryIds) {
    sums.set(catId, {
      opening_debit: 0,
      opening_credit: 0,
      pre_book_debit: 0,
      pre_book_credit: 0,
      hasAmount: false,
    })
  }

  const addToCategory = (catId: string, row: (typeof detailRows)[0]) => {
    const b = sums.get(catId)
    if (!b) return
    const od = row.opening_debit || 0
    const oc = row.opening_credit || 0
    const pd = row.pre_book_debit || 0
    const pc = row.pre_book_credit || 0
    b.opening_debit += od
    b.opening_credit += oc
    b.pre_book_debit += pd
    b.pre_book_credit += pc
    if (od !== 0 || oc !== 0 || pd !== 0 || pc !== 0) b.hasAmount = true
  }

  for (const row of detailRows) {
    const parts = parseAuxItemIdParts(row.aux_item_id)
    const codes = Object.keys(parts)
    if (codes.length === 0) continue

    if (codes.length === 1) {
      const catId = idByCode.get(codes[0])
      if (catId) addToCategory(catId, row)
      continue
    }

    // 历史组合行：金额计入涉及的每个类目，便于分类目合计对齐
    for (const code of codes) {
      const catId = idByCode.get(code)
      if (catId) addToCategory(catId, row)
    }
  }

  return {
    enabledCategoryIds,
    sums,
    accountDirection: account.direction,
    nameById,
  }
}

function buildCategoryBalanceSummaries(
  direction: string,
  enabledCategoryIds: string[],
  sums: Map<string, CategorySumBucket>,
  nameById: Map<string, string>,
  onlyWithAmount = true
): AuxCategoryBalanceSummary[] {
  const ids = onlyWithAmount
    ? enabledCategoryIds.filter(id => bucketHasAmount(sums.get(id)!))
    : enabledCategoryIds
  return ids.map(catId => {
    const bucket = sums.get(catId)!
    return {
      category_id: catId,
      category_name: nameById.get(catId) || catId,
      opening_debit: bucket.opening_debit,
      opening_credit: bucket.opening_credit,
      pre_book_debit: bucket.pre_book_debit,
      pre_book_credit: bucket.pre_book_credit,
      init_balance: categoryInitBalanceFromBucket(direction, bucket),
    }
  })
}

function accountHasAnyCategoryAmount(
  enabledCategoryIds: string[],
  sums: Map<string, CategorySumBucket>
) {
  return enabledCategoryIds.some(id => bucketHasAmount(sums.get(id)!))
}

function isAccountAuxCategoryConsistent(
  enabledCategoryIds: string[],
  sums: Map<string, CategorySumBucket>
) {
  if (enabledCategoryIds.length <= 1) return true
  if (!accountHasAnyCategoryAmount(enabledCategoryIds, sums)) return true

  const ref = sums.get(enabledCategoryIds[0])!
  return enabledCategoryIds.slice(1).every(cid => amountsClose(ref, sums.get(cid)!))
}

/**
 * 找出所有"分项不一致"的字段（以第一个类目为基准）。
 * 用于错误消息：告诉用户具体哪个分项不一致、各类目的值。
 */
function collectMismatchedFields(
  enabledCategoryIds: string[],
  sums: Map<string, CategorySumBucket>
) {
  const mismatched: Array<{ key: keyof CategorySumBucket; label: string }> = []
  if (enabledCategoryIds.length <= 1) return mismatched
  const ref = sums.get(enabledCategoryIds[0])!
  const seen = new Set<string>()
  for (const cid of enabledCategoryIds.slice(1)) {
    const target = sums.get(cid)!
    for (const diff of diffBucketFields(ref, target)) {
      if (!seen.has(String(diff.key))) {
        seen.add(String(diff.key))
        mismatched.push({ key: diff.key, label: diff.label })
      }
    }
  }
  return mismatched
}

function buildAuxCategoryMismatchMessage(
  accountCode: string,
  accountName: string,
  categories: AuxCategoryBalanceSummary[],
  mismatchedFields: Array<{ key: keyof CategorySumBucket; label: string }>
) {
  // 如果只是 init_balance（净余额）层面差异，仍按原格式；
  // 4 个分项有差异时，按字段分别列出每个类目的值。
  if (mismatchedFields.length === 0) {
    const parts = categories.map(
      c => `「${c.category_name}」期初余额 ${formatInitBalanceAmount(c.init_balance)}`
    )
    return `${accountCode} ${accountName}：${parts.join(' ≠ ')}`
  }

  const fieldSegments = mismatchedFields.map(field => {
    const cells = categories.map(c => {
      const value = Number((c as any)[field.key] || 0)
      return `「${c.category_name}」${formatInitBalanceAmount(value)}`
    })
    return `${field.label}：${cells.join(' ≠ ')}`
  })

  return `${accountCode} ${accountName}：${fieldSegments.join('；')}`
}

function formatInitBalanceAmount(value: number) {
  const abs = Math.abs(value || 0)
  if (abs < 0.005) return '¥0'
  return `¥${abs.toFixed(2)}`
}

/** 校验全部辅助科目的各类目期初余额是否一致（如现金按部门合计 = 按人员合计） */
export function checkInitBalanceAuxCategoryConsistency(
  db: any,
  accountSetId: string,
  year: number,
  period = 1
) {
  const accounts = db
    .prepare(
      `SELECT id, code, name, direction, aux_types, is_aux
       FROM accounts
       WHERE account_set_id=? AND is_enabled=1`
    )
    .all(accountSetId) as Array<{
    id: string
    code: string
    name: string
    direction: string
    aux_types?: unknown
    is_aux?: number
  }>

  const mismatches: InitBalanceAuxCategoryMismatch[] = []

  for (const account of accounts) {
    if (!accountHasAuxAccounting(account)) continue
    const computed = computeAccountAuxCategorySums(db, accountSetId, account.id, year, period)
    if (!computed || computed.enabledCategoryIds.length <= 1) continue

    const { enabledCategoryIds, sums, accountDirection, nameById } = computed
    if (isAccountAuxCategoryConsistent(enabledCategoryIds, sums)) continue

    const categories = buildCategoryBalanceSummaries(
      accountDirection,
      enabledCategoryIds,
      sums,
      nameById,
      false
    )
    const mismatchedFields = collectMismatchedFields(enabledCategoryIds, sums)
    mismatches.push({
      account_id: account.id,
      account_code: account.code,
      account_name: account.name,
      direction: accountDirection,
      message: buildAuxCategoryMismatchMessage(account.code, account.name, categories, mismatchedFields),
      categories,
      mismatched_fields: mismatchedFields.map(f => ({ key: String(f.key), label: f.label })),
    })
  }

  return {
    consistent: mismatches.length === 0,
    mismatches,
  }
}

function recalcInitBalanceAuxSummary(
  db: any,
  accountSetId: string,
  accountId: string,
  accountDirection: string,
  year: number,
  period: number,
  options?: { activeCategoryId?: string; validateCategoryConsistency?: boolean }
) {
  const computed = computeAccountAuxCategorySums(db, accountSetId, accountId, year, period)
  if (!computed) throw new Error('科目不存在')
  const accountDirectionForCompare = computed.accountDirection || accountDirection
  const { enabledCategoryIds, sums } = computed

  const detailCount = db
    .prepare(
      `SELECT COUNT(*) AS count FROM init_balances
       WHERE account_set_id=? AND account_id=? AND year=? AND period=? AND aux_item_id != ''`
    )
    .get(accountSetId, accountId, year, period) as { count: number }

  const catsWithAmount = enabledCategoryIds.filter(id => bucketHasAmount(sums.get(id)!))

  if (
    options?.validateCategoryConsistency &&
    !isAccountAuxCategoryConsistent(enabledCategoryIds, sums)
  ) {
    const accountInfo = db
      .prepare(`SELECT code, name FROM accounts WHERE id=? AND account_set_id=?`)
      .get(accountId, accountSetId) as { code: string; name: string } | undefined
    const categories = buildCategoryBalanceSummaries(
      accountDirectionForCompare,
      enabledCategoryIds,
      sums,
      computed.nameById,
      false
    )
    const mismatchedFields = collectMismatchedFields(enabledCategoryIds, sums)
    throw new Error(
      buildAuxCategoryMismatchMessage(
        accountInfo?.code || accountId,
        accountInfo?.name || '',
        categories,
        mismatchedFields
      )
    )
  }

  const pickId =
    options?.activeCategoryId && catsWithAmount.includes(options.activeCategoryId)
      ? options.activeCategoryId
      : catsWithAmount[0] || enabledCategoryIds[0]

  const picked = sums.get(pickId) || {
    opening_debit: 0,
    opening_credit: 0,
    pre_book_debit: 0,
    pre_book_credit: 0,
    hasAmount: false,
  }

  let sumOd = picked.opening_debit
  let sumOc = picked.opening_credit
  let sumPd = picked.pre_book_debit
  let sumPc = picked.pre_book_credit

  const summaryAmounts = calcInitBalanceFromAmounts(
    accountDirection,
    sumOd,
    sumOc,
    sumPd,
    sumPc
  )

  const findSummary = db.prepare(
    `SELECT id FROM init_balances
     WHERE account_set_id=? AND account_id=? AND year=? AND period=? AND aux_item_id=''`
  )
  const updateDetail = db.prepare(`
    UPDATE init_balances SET
      direction=?, init_balance=?, init_debit=?, init_credit=?,
      opening_debit=?, opening_credit=?, pre_book_debit=?, pre_book_credit=?
    WHERE id=?
  `)
  const insertDetail = db.prepare(`
    INSERT INTO init_balances
      (id, account_set_id, account_id, direction, year, period,
       init_balance, init_debit, init_credit, aux_item_id,
       opening_debit, opening_credit, pre_book_debit, pre_book_credit)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const deleteById = db.prepare(`DELETE FROM init_balances WHERE id=?`)

  const summaryExisting = findSummary.get(accountSetId, accountId, year, period) as
    | { id: string }
    | undefined

  const hasAmount = sumOd !== 0 || sumOc !== 0 || sumPd !== 0 || sumPc !== 0
  if (summaryExisting) {
    if (!hasAmount) {
      deleteById.run(summaryExisting.id)
    } else {
      updateDetail.run(
        accountDirection,
        summaryAmounts.initBalance,
        summaryAmounts.initDebit,
        summaryAmounts.initCredit,
        sumOd,
        sumOc,
        sumPd,
        sumPc,
        summaryExisting.id
      )
    }
  } else if (hasAmount) {
    insertDetail.run(
      uuidv4(),
      accountSetId,
      accountId,
      accountDirection,
      year,
      period,
      summaryAmounts.initBalance,
      summaryAmounts.initDebit,
      summaryAmounts.initCredit,
      '',
      sumOd,
      sumOc,
      sumPd,
      sumPc
    )
  }

  return {
    opening_debit: sumOd,
    opening_credit: sumOc,
    pre_book_debit: sumPd,
    pre_book_credit: sumPc,
    init_debit: summaryAmounts.initDebit,
    init_credit: summaryAmounts.initCredit,
    init_balance: summaryAmounts.initBalance,
    line_count: Number(detailCount?.count || 0),
  }
}

/** 单行录入：失焦保存，不影响其他辅助组合行 */
export function upsertInitBalanceAuxLine(
  db: any,
  accountSetId: string,
  accountId: string,
  year: number,
  line: InitBalanceAuxLineInput,
  period = 1
) {
  assertInitBalanceAuxEditable(db, accountSetId, year)

  const account = db
    .prepare(`SELECT * FROM accounts WHERE id=? AND account_set_id=?`)
    .get(accountId, accountSetId) as any

  if (!account) throw new Error('科目不存在')
  if (!accountHasAuxAccounting(account)) {
    throw new Error('该科目未启用辅助核算')
  }

  const enabledCategoryIds = parseAccountAuxCategoryIds(account.aux_types)
  const { codeById, nameById } = loadCategoryMaps(db, accountSetId)
  const selection = line.selection || {}

  let categoryId: string
  let itemId: string
  try {
    ;({ categoryId, itemId } = resolveSingleCategorySelection(
      selection,
      enabledCategoryIds,
      line.active_category_id
    ))
  } catch (e: any) {
    throw new Error(e.message || '请选择辅助项目')
  }

  const resolvedItemId = resolveAuxItemIdFromDb(db, accountSetId, categoryId, itemId)
  if (!resolvedItemId) {
    throw new Error(
      `「${nameById.get(categoryId) || codeById.get(categoryId) || categoryId}」辅助项目无效`
    )
  }
  itemId = resolvedItemId

  const auxItemId = buildSingleCategoryAuxItemId(codeById, categoryId, itemId)
  if (!auxItemId) throw new Error('无法生成辅助核算标识')

  const openingDebit = normalizeAmount(line.opening_debit)
  const openingCredit = normalizeAmount(line.opening_credit)
  assertOpeningDebitCreditExclusive(openingDebit, openingCredit)
  const preBookDebit = normalizeAmount(line.pre_book_debit)
  const preBookCredit = normalizeAmount(line.pre_book_credit)
  const { initDebit, initCredit, initBalance } = calcInitBalanceFromAmounts(
    account.direction,
    openingDebit,
    openingCredit,
    preBookDebit,
    preBookCredit
  )

  const allZero =
    openingDebit === 0 &&
    openingCredit === 0 &&
    preBookDebit === 0 &&
    preBookCredit === 0

  const findDetail = db.prepare(
    `SELECT id FROM init_balances
     WHERE account_set_id=? AND account_id=? AND year=? AND period=? AND aux_item_id=?`
  )
  const updateDetail = db.prepare(`
    UPDATE init_balances SET
      direction=?, init_balance=?, init_debit=?, init_credit=?,
      opening_debit=?, opening_credit=?, pre_book_debit=?, pre_book_credit=?
    WHERE id=?
  `)
  const insertDetail = db.prepare(`
    INSERT INTO init_balances
      (id, account_set_id, account_id, direction, year, period,
       init_balance, init_debit, init_credit, aux_item_id,
       opening_debit, opening_credit, pre_book_debit, pre_book_credit)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const deleteById = db.prepare(`DELETE FROM init_balances WHERE id=?`)

  const runTx = db.transaction(() => {
    const existing = findDetail.get(accountSetId, accountId, year, period, auxItemId) as
      | { id: string }
      | undefined

    if (allZero) {
      if (existing) deleteById.run(existing.id)
    } else if (existing) {
      updateDetail.run(
        account.direction,
        initBalance,
        initDebit,
        initCredit,
        openingDebit,
        openingCredit,
        preBookDebit,
        preBookCredit,
        existing.id
      )
    } else {
      insertDetail.run(
        uuidv4(),
        accountSetId,
        accountId,
        account.direction,
        year,
        period,
        initBalance,
        initDebit,
        initCredit,
        auxItemId,
        openingDebit,
        openingCredit,
        preBookDebit,
        preBookCredit
      )
    }

    return recalcInitBalanceAuxSummary(
      db,
      accountSetId,
      accountId,
      account.direction,
      year,
      period,
      { activeCategoryId: categoryId, validateCategoryConsistency: false }
    )
  })

  return runTx()
}

export function saveInitBalanceAuxDetails(
  db: any,
  accountSetId: string,
  accountId: string,
  year: number,
  lines: InitBalanceAuxLineInput[],
  period = 1,
  options?: {
    onBuildProgress?: (processed: number, total: number) => void
  }
) {
  assertInitBalanceAuxEditable(db, accountSetId, year)

  const account = db
    .prepare(`SELECT * FROM accounts WHERE id=? AND account_set_id=?`)
    .get(accountId, accountSetId) as any

  if (!account) {
    throw new Error('科目不存在')
  }
  if (!accountHasAuxAccounting(account)) {
    throw new Error('该科目未启用辅助核算，请直接在科目行录入期初')
  }

  const enabledCategoryIds = parseAccountAuxCategoryIds(account.aux_types)
  const { codeById, nameById } = loadCategoryMaps(db, accountSetId)
  const resolveAuxItemId = buildAuxItemResolverMap(db, accountSetId, enabledCategoryIds)

  const builtLines: Array<{
    aux_item_id: string
    opening_debit: number
    opening_credit: number
    pre_book_debit: number
    pre_book_credit: number
    init_debit: number
    init_credit: number
    init_balance: number
  }> = []

  const seenAuxIds = new Set<string>()

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const selection = line.selection || {}

    let categoryId: string
    let itemId: string
    try {
      ;({ categoryId, itemId } = resolveSingleCategorySelection(
        selection,
        enabledCategoryIds,
        line.active_category_id
      ))
    } catch (e: any) {
      throw new Error(`第 ${i + 1} 行：${e.message || '请选择辅助项目'}`)
    }

    const resolvedItemId = resolveAuxItemId(categoryId, itemId)
    if (!resolvedItemId) {
      throw new Error(`第 ${i + 1} 行：辅助项目无效或不属于当前类别`)
    }
    itemId = resolvedItemId

    const auxItemId = buildSingleCategoryAuxItemId(codeById, categoryId, itemId)
    if (!auxItemId) {
      throw new Error(`第 ${i + 1} 行：无法生成辅助核算标识`)
    }
    if (seenAuxIds.has(auxItemId)) {
      throw new Error(`第 ${i + 1} 行：同一辅助项目重复`)
    }
    seenAuxIds.add(auxItemId)

    const openingDebit = normalizeAmount(line.opening_debit)
    const openingCredit = normalizeAmount(line.opening_credit)
    assertOpeningDebitCreditExclusive(openingDebit, openingCredit, `第 ${i + 1} 行`)
    const preBookDebit = normalizeAmount(line.pre_book_debit)
    const preBookCredit = normalizeAmount(line.pre_book_credit)
    const { initDebit, initCredit, initBalance } = calcInitBalanceFromAmounts(
      account.direction,
      openingDebit,
      openingCredit,
      preBookDebit,
      preBookCredit
    )

    const allZero =
      openingDebit === 0 &&
      openingCredit === 0 &&
      preBookDebit === 0 &&
      preBookCredit === 0
    if (allZero) continue

    builtLines.push({
      aux_item_id: auxItemId,
      opening_debit: openingDebit,
      opening_credit: openingCredit,
      pre_book_debit: preBookDebit,
      pre_book_credit: preBookCredit,
      init_debit: initDebit,
      init_credit: initCredit,
      init_balance: initBalance,
    })

    options?.onBuildProgress?.(i + 1, lines.length)
  }

  const existingRows = db
    .prepare(
      `SELECT id, aux_item_id FROM init_balances
       WHERE account_set_id=? AND account_id=? AND year=? AND period=? AND aux_item_id != ''`
    )
    .all(accountSetId, accountId, year, period) as Array<{
    id: string
    aux_item_id: string
  }>
  const existingByAuxId = new Map(existingRows.map(row => [row.aux_item_id, row]))

  const findSummary = db.prepare(
    `SELECT id FROM init_balances
     WHERE account_set_id=? AND account_id=? AND year=? AND period=? AND aux_item_id=''`
  )
  const updateDetail = db.prepare(`
    UPDATE init_balances SET
      direction=?, init_balance=?, init_debit=?, init_credit=?,
      opening_debit=?, opening_credit=?, pre_book_debit=?, pre_book_credit=?
    WHERE id=?
  `)
  const insertDetail = db.prepare(`
    INSERT INTO init_balances
      (id, account_set_id, account_id, direction, year, period,
       init_balance, init_debit, init_credit, aux_item_id,
       opening_debit, opening_credit, pre_book_debit, pre_book_credit)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const deleteById = db.prepare(`DELETE FROM init_balances WHERE id=?`)

  const runTx = db.transaction(() => {
    const keepIds = new Set(builtLines.map(l => l.aux_item_id))

    for (const row of existingRows) {
      if (!keepIds.has(row.aux_item_id)) {
        deleteById.run(row.id)
      }
    }

    for (const line of builtLines) {
      const existing = existingByAuxId.get(line.aux_item_id)
      if (existing) {
        updateDetail.run(
          account.direction,
          line.init_balance,
          line.init_debit,
          line.init_credit,
          line.opening_debit,
          line.opening_credit,
          line.pre_book_debit,
          line.pre_book_credit,
          existing.id
        )
      } else {
        insertDetail.run(
          uuidv4(),
          accountSetId,
          accountId,
          account.direction,
          year,
          period,
          line.init_balance,
          line.init_debit,
          line.init_credit,
          line.aux_item_id,
          line.opening_debit,
          line.opening_credit,
          line.pre_book_debit,
          line.pre_book_credit
        )
      }
    }

    const activeHint = lines.find(l => l.active_category_id)?.active_category_id
    return recalcInitBalanceAuxSummary(
      db,
      accountSetId,
      accountId,
      account.direction,
      year,
      period,
      { activeCategoryId: activeHint, validateCategoryConsistency: true }
    )
  })

  return runTx()
}

/** 批量清理辅助期初后，按剩余明细重算科目汇总行 */
export function syncInitBalanceAuxSummary(
  db: any,
  accountSetId: string,
  accountId: string,
  year: number,
  period = 1
) {
  const account = db
    .prepare(`SELECT direction FROM accounts WHERE id=? AND account_set_id=?`)
    .get(accountId, accountSetId) as { direction: string } | undefined
  if (!account) return
  recalcInitBalanceAuxSummary(db, accountSetId, accountId, account.direction, year, period)
}
