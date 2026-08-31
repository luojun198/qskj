import type { CategoryAmountTotals } from './initBalanceAuxTabRows'

export interface AuxCategoryMetaLike {
  id: string
  name: string
}

export const AUX_AMOUNT_FIELDS: Array<{
  key: keyof CategoryAmountTotals
  label: string
}> = [
  { key: 'opening_debit', label: '年初借方' },
  { key: 'opening_credit', label: '年初贷方' },
  { key: 'pre_book_debit', label: '帐前借方' },
  { key: 'pre_book_credit', label: '帐前贷方' },
]

export interface CategoryAmountSummary extends CategoryAmountTotals {
  category_id: string
  category_name: string
}

export interface CategoryAmountMismatchField {
  key: keyof CategoryAmountTotals
  label: string
  values: Array<{ category_id: string; category_name: string; value: number }>
}

export interface AuxCategoryConsistencyResult {
  consistent: boolean
  categorySummaries: CategoryAmountSummary[]
  mismatchedFields: CategoryAmountMismatchField[]
  message: string
}

function formatAmount(value: number) {
  const abs = Math.abs(value || 0)
  if (abs < 0.005) return '0.00'
  return abs.toFixed(2)
}

export function categoryAmountTotalsClose(
  a: CategoryAmountTotals,
  b: CategoryAmountTotals,
  eps = 0.02
) {
  for (const { key } of AUX_AMOUNT_FIELDS) {
    const av = Number(a[key] || 0)
    const bv = Number(b[key] || 0)
    if (Math.abs(av - bv) >= eps) return false
  }
  return true
}

export function collectCategoryAmountMismatches(
  categories: AuxCategoryMetaLike[],
  totalsByCategoryId: Map<string, CategoryAmountTotals>,
  eps = 0.02
): CategoryAmountMismatchField[] {
  if (categories.length <= 1) return []

  const refCat = categories[0]
  const refTotals = totalsByCategoryId.get(refCat.id) || emptyTotals()
  const mismatched: CategoryAmountMismatchField[] = []
  const seen = new Set<string>()

  for (const cat of categories.slice(1)) {
    const targetTotals = totalsByCategoryId.get(cat.id) || emptyTotals()
    for (const { key, label } of AUX_AMOUNT_FIELDS) {
      const refValue = Number(refTotals[key] || 0)
      const targetValue = Number(targetTotals[key] || 0)
      if (Math.abs(refValue - targetValue) >= eps && !seen.has(key)) {
        seen.add(key)
        mismatched.push({
          key,
          label,
          values: categories.map(c => ({
            category_id: c.id,
            category_name: c.name,
            value: Number((totalsByCategoryId.get(c.id) || emptyTotals())[key] || 0),
          })),
        })
      }
    }
  }

  return mismatched
}

export function buildCategoryConsistencyMessage(mismatchedFields: CategoryAmountMismatchField[]) {
  if (mismatchedFields.length === 0) return ''
  const segments = mismatchedFields.map(field => {
    const cells = field.values.map(
      v => `「${v.category_name}」${formatAmount(v.value)}`
    )
    return `${field.label}：${cells.join(' ≠ ')}`
  })
  return `各类目合计不一致：${segments.join('；')}`
}

export function checkAuxCategoryAmountConsistency(
  categories: AuxCategoryMetaLike[],
  totalsByCategoryId: Map<string, CategoryAmountTotals>,
  eps = 0.02
): AuxCategoryConsistencyResult | null {
  if (categories.length <= 1) return null

  const categorySummaries: CategoryAmountSummary[] = categories.map(cat => ({
    category_id: cat.id,
    category_name: cat.name,
    ...(totalsByCategoryId.get(cat.id) || emptyTotals()),
  }))

  const refTotals = totalsByCategoryId.get(categories[0].id) || emptyTotals()
  const allClose = categories.slice(1).every(cat =>
    categoryAmountTotalsClose(refTotals, totalsByCategoryId.get(cat.id) || emptyTotals(), eps)
  )

  if (allClose) return null

  const mismatchedFields = collectCategoryAmountMismatches(categories, totalsByCategoryId, eps)
  return {
    consistent: false,
    categorySummaries,
    mismatchedFields,
    message: buildCategoryConsistencyMessage(mismatchedFields),
  }
}

function emptyTotals(): CategoryAmountTotals {
  return {
    opening_debit: 0,
    opening_credit: 0,
    pre_book_debit: 0,
    pre_book_credit: 0,
  }
}
