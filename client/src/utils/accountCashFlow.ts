/** 专用基础档案，不在「核算项目」页签维护 */
export const AUX_CATEGORY_CODES_EXCLUDED_FROM_PROJECT = ['cash_flow', 'fund_source'] as const

/** 不得作为科目「辅助核算」挂接、凭证辅助栏、辅助账簿筛选（走专用档案或字段） */
export const AUX_CATEGORY_CODE_EXCLUDED_FROM_ACCOUNT = [
  'cash_flow',
  'fund_source',
] as const

export function isAuxCategoryExcludedFromProjectList(code: string | undefined | null): boolean {
  if (!code) return false
  return (AUX_CATEGORY_CODES_EXCLUDED_FROM_PROJECT as readonly string[]).includes(code)
}

export function isAuxCategoryExcludedFromAccount(code: string | undefined | null): boolean {
  if (!code) return false
  return (AUX_CATEGORY_CODE_EXCLUDED_FROM_ACCOUNT as readonly string[]).includes(code)
}

export function filterAuxCategoriesForProjectList<T extends { code: string }>(list: T[]): T[] {
  return list.filter(c => !isAuxCategoryExcludedFromProjectList(c.code))
}

export function filterAuxCategoriesForAccount<T extends { code: string }>(list: T[]): T[] {
  return list.filter(c => !isAuxCategoryExcludedFromAccount(c.code))
}

/** 凭证录入：仅现金/银行科目需指定现金流量项目 */
export function accountNeedsCashFlowItem(acc: {
  is_cash?: number | null
  is_bank?: number | null
  require_cash_flow?: number | null
} | null | undefined): boolean {
  if (!acc) return false
  return Number(acc.is_cash) === 1 || Number(acc.is_bank) === 1
}
