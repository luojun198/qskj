import { formatAccountSelectLabel } from './accountSelectDisplay'

/**
 * 科目「完整路径」展示：把末级科目拼成 `编码 上级名称/.../末级名称`。
 * 全部在前端按 baseDataStore.accounts（含 parent_id / code）自算，不依赖后端字段。
 */

/** 路径分隔符（与凭证界面开关的展示一致） */
export const ACCOUNT_PATH_SEPARATOR = '/'

interface AccountLike {
  id?: string
  code?: string
  name?: string
  parent_id?: string | null
}

/**
 * 解析科目的父级 id：parent_id 优先；缺失时按编码最长前缀兜底。
 * 与 composables/useAccountTree.ts 的树形转换共用同一套规则。
 */
export function resolveAccountParentId(
  item: AccountLike,
  map: Record<string, AccountLike>
): string | null {
  if (item.parent_id && map[item.parent_id]) return item.parent_id
  const code = String(item.code || '')
  if (!code) return null
  let bestId: string | null = null
  let bestLen = 0
  for (const candidate of Object.values(map)) {
    if (candidate.id === item.id) continue
    const parentCode = String(candidate.code || '')
    if (
      parentCode.length > 0 &&
      parentCode.length < code.length &&
      code.startsWith(parentCode) &&
      parentCode.length > bestLen
    ) {
      bestId = candidate.id as string
      bestLen = parentCode.length
    }
  }
  return bestId
}

/** 按 accounts 数组引用缓存路径索引，避免每次渲染重算（科目可能上千条） */
const pathIndexCache = new WeakMap<object, Map<string, string>>()

/**
 * 构建 id -> 全路径名称（如「银行存款/建行」）的索引。
 * 同一个 accounts 数组引用只计算一次。
 */
export function buildAccountPathIndex(accounts: AccountLike[]): Map<string, string> {
  const cacheKey = accounts as unknown as object
  const cached = pathIndexCache.get(cacheKey)
  if (cached) return cached

  const map: Record<string, AccountLike> = {}
  for (const acc of accounts) {
    if (acc?.id) map[acc.id] = acc
  }

  const index = new Map<string, string>()
  for (const acc of accounts) {
    if (!acc?.id) continue
    const names: string[] = []
    // visited 防止脏数据形成环导致死循环
    const visited = new Set<string>()
    let cursor: AccountLike | undefined = acc
    while (cursor?.id && !visited.has(cursor.id)) {
      visited.add(cursor.id)
      const name = String(cursor.name || '').trim()
      if (name) names.unshift(name)
      const parentId = resolveAccountParentId(cursor, map)
      cursor = parentId ? map[parentId] : undefined
    }
    index.set(acc.id, names.join(ACCOUNT_PATH_SEPARATOR))
  }

  pathIndexCache.set(cacheKey, index)
  return index
}

/**
 * 科目全路径展示：`编码 上级/.../末级`。
 * 找不到路径时退化为「编码 名称」，保证永不返回空串。
 */
export function formatAccountFullPath(
  code: string | number | null | undefined,
  id: string | null | undefined,
  accounts: AccountLike[],
  fallbackName?: string | null
): string {
  const c = String(code ?? '').trim()
  if (id) {
    const path = buildAccountPathIndex(accounts).get(id)
    if (path) return c ? `${c} ${path}` : path
  }
  return formatAccountSelectLabel(c, fallbackName ?? '')
}
