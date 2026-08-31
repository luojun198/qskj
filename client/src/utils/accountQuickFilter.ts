/** 快速筛选固定项 */
export const ACCOUNT_QUICK_FILTER_OPTIONS = [
  { value: 'cash', label: '现金', tone: 'success' as const },
  { value: 'bank', label: '银行', tone: 'primary' as const },
  { value: 'no_negative', label: '不允许负数', tone: 'warning' as const },
] as const

export type AccountQuickFilterTone = (typeof ACCOUNT_QUICK_FILTER_OPTIONS)[number]['tone'] | 'aux'

export type AccountQuickFilterValue = (typeof ACCOUNT_QUICK_FILTER_OPTIONS)[number]['value'] | `aux:${string}`

export function buildAuxQuickFilterValue(categoryId: string): AccountQuickFilterValue {
  return `aux:${categoryId}`
}

export function parseAccountAuxCategoryIds(row: { is_aux?: number; aux_types?: unknown }): string[] {
  if (!row.is_aux || !row.aux_types) return []
  try {
    const parsed =
      typeof row.aux_types === 'string' ? JSON.parse(row.aux_types) : row.aux_types
    if (!parsed || typeof parsed !== 'object') return []
    return Object.keys(parsed as Record<string, unknown>)
  } catch {
    return []
  }
}

export function accountMatchesQuickFilter(
  row: {
    is_cash?: number
    is_bank?: number
    no_negative?: number
    is_aux?: number
    aux_types?: unknown
  },
  filter: string
): boolean {
  switch (filter) {
    case 'cash':
      return row.is_cash === 1
    case 'bank':
      return row.is_bank === 1
    case 'no_negative':
      return row.no_negative === 1
    default:
      if (filter.startsWith('aux:')) {
        const categoryId = filter.slice(4)
        if (!row.is_aux) return false
        return parseAccountAuxCategoryIds(row).includes(categoryId)
      }
      return false
  }
}

/** 多选时为「或」关系：满足任一条件即命中 */
export function accountMatchesQuickFilters(row: Parameters<typeof accountMatchesQuickFilter>[0], filters: string[]) {
  if (filters.length === 0) return true
  return filters.some(filter => accountMatchesQuickFilter(row, filter))
}

/** 保留命中科目及其全部上级，便于树形展示 */
export function filterAccountsWithAncestors<T extends { id: string; parent_id?: string | null }>(
  accounts: T[],
  filters: string[],
  matches: (row: T, filters: string[]) => boolean = accountMatchesQuickFilters
): T[] {
  if (filters.length === 0) return accounts

  const byId = new Map(accounts.map(account => [account.id, account]))
  const visibleIds = new Set<string>()

  for (const row of accounts) {
    if (!matches(row, filters)) continue
    visibleIds.add(row.id)
    let parentId = row.parent_id || null
    while (parentId && byId.has(parentId)) {
      visibleIds.add(parentId)
      parentId = byId.get(parentId)!.parent_id || null
    }
  }

  return accounts.filter(account => visibleIds.has(account.id))
}
