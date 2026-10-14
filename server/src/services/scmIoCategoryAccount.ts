/**
 * 其他入库 / 其他出库按「收发类别」取对方科目（第五份反馈）
 *
 * 没有启用生产模块的客户，用其他出库做「生产领用」、其他入库做「成品入库」。原来对方科目一律取
 * scm:acc_other（待处理财产损溢），领料不进生产成本。现在按单据的收发类别（scm_doc.io_category）取：
 *   1) 进销存凭证设置里为该类别指定了科目 → 用指定科目；
 *   2) 内置规则：生产领用 / 领料 / 成品入库 / 完工入库 → 生产成本（scm:acc_production）；
 *   3) 其余 → 原来的其他出入库对方科目（scm:acc_other）。
 * 映射存系统参数 scm:io_category_accounts（JSON：{ 类别名: 科目编码 }）。
 */
import type Database from 'better-sqlite3'

export const IO_CATEGORY_ACCOUNTS_KEY = 'scm:io_category_accounts'

/** 内置收发类别：没在字典里配也能直接选 */
export const BUILTIN_IO_CATEGORIES: { in: string[]; out: string[] } = {
  in: ['成品入库', '盘盈', '其他入库'],
  out: ['生产领用', '盘亏', '报废', '其他出库'],
}

/** 内置规则：该类别默认走生产成本还是其他出入库对方科目 */
export function builtinIoCategoryRole(category: string): 'production' | 'other' {
  return /生产领用|生产领料|领料|成品入库|完工入库|产成品/.test(String(category || '')) ? 'production' : 'other'
}

export function loadIoCategoryAccounts(db: Database.Database, aid: string): Record<string, string> {
  const row = db
    .prepare('SELECT param_value FROM system_params WHERE account_set_id=? AND param_key=?')
    .get(aid, IO_CATEGORY_ACCOUNTS_KEY) as { param_value?: string } | undefined
  if (!row?.param_value) return {}
  try {
    const parsed = JSON.parse(row.param_value)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(parsed)) {
      const key = String(k).trim()
      const code = String(v ?? '').trim()
      if (key && code) out[key] = code
    }
    return out
  } catch {
    return {}
  }
}

export function normalizeIoCategoryAccounts(input: unknown): Record<string, string> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {}
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    const key = String(k).trim()
    const code = String(v ?? '').trim()
    if (key && code) out[key] = code
  }
  return out
}

/** 其他出入库的对方科目：指定 > 内置规则 */
export function resolveIoCategoryAccount(
  mapping: Record<string, string>,
  category: string | null | undefined,
  fallback: { production: string; other: string }
): string {
  const key = String(category || '').trim()
  if (key && mapping[key]) return mapping[key]
  return builtinIoCategoryRole(key) === 'production' ? fallback.production : fallback.other
}

/** 设置页展示用：内置 + 字典里的全部收发类别 */
export function listIoCategories(db: Database.Database, aid: string): Array<{ category: string; dir: 'in' | 'out' | '' }> {
  const row = db
    .prepare("SELECT param_value FROM system_params WHERE account_set_id=? AND param_key='scm:io_categories'")
    .get(aid) as { param_value?: string } | undefined
  const dict = String(row?.param_value || '')
    .split(/[,，\s]+/)
    .map(x => x.trim())
    .filter(Boolean)
  const seen = new Set<string>()
  const out: Array<{ category: string; dir: 'in' | 'out' | '' }> = []
  for (const c of BUILTIN_IO_CATEGORIES.in) { seen.add(c); out.push({ category: c, dir: 'in' }) }
  for (const c of BUILTIN_IO_CATEGORIES.out) { seen.add(c); out.push({ category: c, dir: 'out' }) }
  for (const c of dict) if (!seen.has(c)) { seen.add(c); out.push({ category: c, dir: '' }) }
  for (const c of Object.keys(loadIoCategoryAccounts(db, aid))) if (!seen.has(c)) { seen.add(c); out.push({ category: c, dir: '' }) }
  return out
}
