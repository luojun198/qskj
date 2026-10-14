/**
 * 多级排序：把前端传来的 `sort=key:asc,key2:desc` 安全地翻译成 ORDER BY 子句。
 *
 * - 仅接受白名单里的 key（key → SQL 表达式），其余一律忽略，不拼接任何用户字符串，杜绝注入；
 * - 同一 key 只取第一次出现；最多 MAX_SORT_LEVELS 级；
 * - NULL / 空值一律排最后（无论升降序）；
 * - 末尾恒追加兜底列，保证分页时顺序稳定。
 */
export const MAX_SORT_LEVELS = 5

export interface SortSpec { key: string; order: 'asc' | 'desc' }

/** 动态 key（如自定义字段 cf:xxx）的解析器：返回 SQL 表达式，不认识则返回 null */
export type SortKeyResolver = (key: string) => string | null

export interface MultiSortOptions {
  /**
   * 白名单：key → SQL 表达式。
   * 值为数组时表示「一个排序键由多段表达式组成」（如凭证类型：先数字编码后文本），
   * 每段都套用同一个方向，且不做空值置后处理（由表达式自己保证）。
   */
  whitelist: Record<string, string | string[]>
  /** 可选：动态 key 解析（白名单未命中时尝试） */
  resolve?: SortKeyResolver
  /** 用户没有给出任何有效排序时使用的默认 ORDER BY 片段（不含 ORDER BY 关键字） */
  defaultOrderBy: string
  /** 恒追加在末尾的兜底排序（如 `d.id ASC`） */
  tieBreakers?: string[]
  /** 数值型表达式（升降序时无需处理空串）；其余视为文本，空串与 NULL 同样置后 */
  numericKeys?: ReadonlySet<string>
}

/** 解析 `key:asc,key2:desc`；缺省方向为 asc；空片段、重复 key 丢弃（未知 key 由白名单过滤）。 */
export function parseSortParam(raw: unknown): SortSpec[] {
  if (typeof raw !== 'string' || !raw.trim()) return []
  const out: SortSpec[] = []
  const seen = new Set<string>()
  for (const part of raw.split(',')) {
    // key 自身可含冒号（如 cf:字段键），方向取最后一个冒号之后；后缀不是 asc/desc 时整段当 key、方向 asc
    const text = part.trim()
    const cut = text.lastIndexOf(':')
    const tail = cut >= 0 ? text.slice(cut + 1).trim().toLowerCase() : ''
    const hasDir = tail === 'asc' || tail === 'desc'
    const key = (hasDir ? text.slice(0, cut) : text).trim()
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push({ key, order: hasDir ? (tail as 'asc' | 'desc') : 'asc' })
    if (out.length >= MAX_SORT_LEVELS) break
  }
  return out
}

export interface BuiltOrderBy {
  /** 完整的 `ORDER BY ...`（不含 LIMIT） */
  sql: string
  /** 实际生效的排序级别（已过白名单） */
  applied: SortSpec[]
}

export function buildMultiOrderBy(raw: unknown, opts: MultiSortOptions): BuiltOrderBy {
  const applied: SortSpec[] = []
  const parts: string[] = []
  for (const spec of parseSortParam(raw)) {
    const expr = opts.whitelist[spec.key] ?? opts.resolve?.(spec.key) ?? null
    if (!expr) continue
    applied.push(spec)
    const dir = spec.order === 'desc' ? 'DESC' : 'ASC'
    if (Array.isArray(expr)) { for (const term of expr) parts.push(`${term} ${dir}`); continue }
    const nullable = opts.numericKeys?.has(spec.key) ? `(${expr}) IS NULL` : `((${expr}) IS NULL OR (${expr}) = '')`
    parts.push(`${nullable} ASC`, `${expr} ${dir}`)
  }
  const tail = (opts.tieBreakers || []).join(', ')
  if (!parts.length) return { sql: `ORDER BY ${opts.defaultOrderBy}${tail ? `, ${tail}` : ''}`, applied }
  return { sql: `ORDER BY ${parts.join(', ')}${tail ? `, ${tail}` : ''}`, applied }
}
