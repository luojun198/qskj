import { buildSingleCategoryAuxItemId } from '@/utils/auxItemId'
import { calcInitBalanceFromAmounts } from '@/utils/initBalanceOpening'
import type { AuxGridItem, AuxGridRow } from '@/utils/initBalanceAuxGrid'

export function lineHasAmount(line: AuxGridRow) {
  return (
    (line.opening_debit || 0) !== 0 ||
    (line.opening_credit || 0) !== 0 ||
    (line.pre_book_debit || 0) !== 0 ||
    (line.pre_book_credit || 0) !== 0
  )
}

/** 当前标签页行：仅含该类目项目 */
export function isLineSelectionComplete(line: AuxGridRow, activeCategoryId: string) {
  return !!line.selection[activeCategoryId]
}

/** 当前标签页：仅展示已录入/已保存的项目行（不为全量项目预生成空行） */
export function buildTabGridRows(params: {
  activeCategoryId: string
  itemsByCategory: Record<string, AuxGridItem[]>
  combinationStore: Map<string, AuxGridRow>
}): AuxGridRow[] {
  const { activeCategoryId, itemsByCategory, combinationStore } = params
  const activeItems = itemsByCategory[activeCategoryId] || []
  const rows: AuxGridRow[] = []

  for (const line of combinationStore.values()) {
    const activeItemId = line.selection[activeCategoryId]
    if (!activeItemId) continue
    rows.push({ ...line, selection: { [activeCategoryId]: activeItemId } })
  }

  const codeMap = new Map(activeItems.map(i => [i.id, i.code || '']))
  rows.sort((a, b) => {
    const codeA = codeMap.get(a.selection[activeCategoryId]) || ''
    const codeB = codeMap.get(b.selection[activeCategoryId]) || ''
    return codeA > codeB ? 1 : codeA < codeB ? -1 : 0
  })

  return rows
}

export function syncLineToCombinationStore(
  line: AuxGridRow,
  store: Map<string, AuxGridRow>,
  activeCategoryId: string,
  codeByCategoryId: Record<string, string>
): string {
  const itemId = line.selection[activeCategoryId]
  const stableKey = itemId
    ? buildSingleCategoryAuxItemId(codeByCategoryId, activeCategoryId, itemId)
    : ''
  const key = stableKey || line.key
  const prevKey = line.key
  const payload: AuxGridRow = {
    ...line,
    key,
    selection: itemId ? { [activeCategoryId]: itemId } : {},
  }
  if (itemId) {
    store.set(key, payload)
  } else if (prevKey) {
    store.delete(prevKey)
  }
  if (prevKey !== key && prevKey) store.delete(prevKey)
  line.key = key
  return key
}

export function countCategoryFilled(
  categoryId: string,
  itemsByCategory: Record<string, AuxGridItem[]>,
  store: Map<string, AuxGridRow>
) {
  const total = itemsByCategory[categoryId]?.length || 0
  const filledItems = new Set<string>()
  for (const line of store.values()) {
    const itemId = line.selection[categoryId]
    if (itemId && lineHasAmount(line)) filledItems.add(itemId)
  }
  return { filled: filledItems.size, total }
}

export interface CategoryAmountTotals {
  opening_debit: number
  opening_credit: number
  pre_book_debit: number
  pre_book_credit: number
}

export function sumCategoryTotals(
  categoryId: string,
  store: Map<string, AuxGridRow>,
  onlyWithAmount = false
): CategoryAmountTotals {
  const totals = {
    opening_debit: 0,
    opening_credit: 0,
    pre_book_debit: 0,
    pre_book_credit: 0,
  }
  for (const line of store.values()) {
    if (!line.selection[categoryId]) continue
    if (onlyWithAmount && !lineHasAmount(line)) continue
    totals.opening_debit += line.opening_debit || 0
    totals.opening_credit += line.opening_credit || 0
    totals.pre_book_debit += line.pre_book_debit || 0
    totals.pre_book_credit += line.pre_book_credit || 0
  }
  return totals
}

export function categoryInitBalance(
  direction: string,
  totals: CategoryAmountTotals
) {
  return calcInitBalanceFromAmounts(
    direction,
    totals.opening_debit,
    totals.opening_credit,
    totals.pre_book_debit,
    totals.pre_book_credit
  ).initBalance
}

export function totalsNet(t: CategoryAmountTotals) {
  return (
    t.opening_debit +
    t.pre_book_debit -
    t.opening_credit -
    t.pre_book_credit
  )
}

/** 按科目方向比较期初余额（借贷分列不同但余额相同时应通过） */
export function totalsClose(
  direction: string,
  a: CategoryAmountTotals,
  b: CategoryAmountTotals,
  eps = 0.02
) {
  return Math.abs(categoryInitBalance(direction, a) - categoryInitBalance(direction, b)) < eps
}
