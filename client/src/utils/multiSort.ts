/**
 * 多级排序（第一排序 / 第二排序 / 第三排序 …）的前端公共逻辑。
 * - 服务端排序：序列化成 `key:asc,key2:desc` 传给后端（后端按白名单翻译，见 server/src/utils/multiSort.ts）；
 * - 前端排序：compareByKeys / sortRows 对已加载的整表排序（库存、物料树等）。
 */
export interface SortKey { key: string; order: 'asc' | 'desc' }
export interface SortOption { key: string; label: string }

export const MAX_SORT_LEVELS = 5

export function serializeSortKeys(keys: readonly SortKey[]): string {
  return keys.map(k => `${k.key}:${k.order}`).join(',')
}

export function parseSortKeys(raw: string | null | undefined): SortKey[] {
  if (!raw) return []
  const out: SortKey[] = []
  for (const part of raw.split(',')) {
    const text = part.trim()
    const cut = text.lastIndexOf(':')
    const tail = cut >= 0 ? text.slice(cut + 1).trim().toLowerCase() : ''
    const hasDir = tail === 'asc' || tail === 'desc'
    const key = (hasDir ? text.slice(0, cut) : text).trim()
    if (key) out.push({ key, order: hasDir ? (tail as 'asc' | 'desc') : 'asc' })
  }
  return out
}

/** 只保留允许的列、去重、限制级数；用于本地存储恢复 / 列可用性变化后的收敛 */
export function normalizeSortKeys(keys: readonly SortKey[] | null | undefined, allowed: ReadonlySet<string> | readonly string[], max = MAX_SORT_LEVELS): SortKey[] {
  const ok = allowed instanceof Set ? allowed : new Set(allowed as readonly string[])
  const seen = new Set<string>()
  const out: SortKey[] = []
  for (const k of keys || []) {
    if (!k || !ok.has(k.key) || seen.has(k.key)) continue
    seen.add(k.key)
    out.push({ key: k.key, order: k.order === 'desc' ? 'desc' : 'asc' })
    if (out.length >= max) break
  }
  return out
}

export function sameSortKeys(a: readonly SortKey[], b: readonly SortKey[]): boolean {
  return a.length === b.length && a.every((k, i) => k.key === b[i].key && k.order === b[i].order)
}

/** 面板按钮上的摘要，如「日期↓ › 单据号↑」 */
export function describeSortKeys(keys: readonly SortKey[], options: readonly SortOption[]): string {
  return keys.map(k => `${options.find(o => o.key === k.key)?.label || k.key}${k.order === 'desc' ? '↓' : '↑'}`).join(' › ')
}

export function loadSortKeys(storageKey: string): SortKey[] | null {
  try {
    const raw = localStorage.getItem(storageKey)
    if (raw == null) return null
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((k: any) => k && typeof k.key === 'string').map((k: any) => ({ key: k.key, order: k.order === 'desc' ? 'desc' : 'asc' })) : null
  } catch { return null }
}

export function saveSortKeys(storageKey: string, keys: readonly SortKey[]) {
  try { localStorage.setItem(storageKey, JSON.stringify(keys)) } catch { /* localStorage 不可用时忽略 */ }
}

// ── 前端排序 ─────────────────────────────────────────────
const isBlank = (v: unknown) => v === null || v === undefined || v === '' || (typeof v === 'number' && Number.isNaN(v))
const NUMERIC_TEXT = /^[+-]?\d+(\.\d+)?$/
const collator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' })

/** 单值比较：数字按数值，其余按中文 locale 比较（带自然数字序）；空值由调用方处理 */
export function compareValues(a: unknown, b: unknown): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b
  const sa = String(a).trim(), sb = String(b).trim()
  if (NUMERIC_TEXT.test(sa) && NUMERIC_TEXT.test(sb)) return Number(sa) - Number(sb)
  return collator.compare(sa, sb)
}

/**
 * 对数组做多级排序，返回新数组（稳定排序）。空值无论升降序一律排最后。
 * accessors：key → 取值函数的映射，或 (key) => 取值函数 的解析函数（应返回数值 / 日期文本 / 原始文本，不要返回带千分位的格式化文本）。
 * 没有 accessor 的 key 直接跳过。
 */
export type SortAccessors<T> = Record<string, (row: T) => unknown> | ((key: string) => ((row: T) => unknown) | undefined)

export function sortRows<T>(rows: readonly T[], keys: readonly SortKey[], accessors: SortAccessors<T>): T[] {
  const resolve = (key: string) => (typeof accessors === 'function' ? accessors(key) : accessors[key])
  const active = keys.map(k => ({ ...k, get: resolve(k.key) })).filter((k): k is SortKey & { get: (row: T) => unknown } => !!k.get)
  const indexed = rows.map((row, index) => ({ row, index }))
  if (!active.length) return indexed.map(x => x.row)
  indexed.sort((x, y) => {
    for (const k of active) {
      const get = k.get
      const a = get(x.row), b = get(y.row)
      const ba = isBlank(a), bb = isBlank(b)
      if (ba || bb) { if (ba && bb) continue; return ba ? 1 : -1 }
      const c = compareValues(a, b)
      if (c !== 0) return k.order === 'desc' ? -c : c
    }
    return x.index - y.index
  })
  return indexed.map(x => x.row)
}
