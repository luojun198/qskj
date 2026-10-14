/**
 * 科目「必填辅助核算」判定（业务凭证共用）
 *
 * 与过账检查 checkPostingIntegrity 同一口径：accounts.is_aux = 1 且 aux_types 中列出的类别都必须有项目。
 * 进销存 / 出纳 / 固定资产在审核或生成凭证前用它提前拦截，避免生成出过不了账的凭证。
 */
import type { Database } from 'better-sqlite3'
import { entryHasAuxSelection, parseAccountAuxCategoryIds } from '../utils/auxItemId.js'

export interface AuxCategoryBrief { id: string; code: string; name: string }
export interface AccountAuxRequirement { code: string; name: string; categories: AuxCategoryBrief[] }
export interface MissingAuxEntry { accountCode: string; accountName: string; categoryId: string; categoryName: string }

function hasTable(db: Database, name: string): boolean {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name)
}

/**
 * 返回按科目编码查询必填辅助类别的函数（带缓存）。科目不存在 / 未挂辅助返回 null。
 * aux_types 里的键既可能是类别 id 也可能是类别 code，两种都认。
 */
export function createAccountAuxRequirementLookup(db: Database, accountSetId: string) {
  // 精简建表的单测库可能没有辅助核算表 / 列：视为本账套未启用辅助核算
  const accCols = new Set((db.prepare("PRAGMA table_info('accounts')").all() as Array<{ name: string }>).map(c => c.name))
  const ready = hasTable(db, 'aux_categories') && accCols.has('is_aux') && accCols.has('aux_types')
  const cats = ready
    ? db.prepare('SELECT id, code, name FROM aux_categories WHERE account_set_id=?').all(accountSetId) as AuxCategoryBrief[]
    : []
  const catByKey = new Map<string, AuxCategoryBrief>()
  for (const c of cats) { catByKey.set(String(c.id), c); if (c.code) catByKey.set(String(c.code), c) }
  const stmt = ready ? db.prepare('SELECT code, name, is_aux, aux_types FROM accounts WHERE account_set_id=? AND code=? LIMIT 1') : null
  const cache = new Map<string, AccountAuxRequirement | null>()
  const lookup = (accountCode: string): AccountAuxRequirement | null => {
    const code = String(accountCode || '').trim()
    if (!code || !stmt) return null
    if (cache.has(code)) return cache.get(code)!
    const row = stmt.get(accountSetId, code) as { code: string; name: string; is_aux?: number; aux_types?: string } | undefined
    let out: AccountAuxRequirement | null = null
    if (row && Number(row.is_aux) === 1 && row.aux_types) {
      const seen = new Set<string>()
      const categories: AuxCategoryBrief[] = []
      for (const key of parseAccountAuxCategoryIds(row.aux_types)) {
        const cat = catByKey.get(String(key))
        if (!cat || seen.has(cat.id)) continue
        seen.add(cat.id)
        categories.push(cat)
      }
      if (categories.length) out = { code: row.code, name: row.name, categories }
    }
    cache.set(code, out)
    return out
  }
  return Object.assign(lookup, { categoryByKey: (key: string) => catByKey.get(String(key)) || null })
}
export type AccountAuxRequirementLookup = ReturnType<typeof createAccountAuxRequirementLookup>

/** 分录（VoucherEntryInput 形态：_code_id / code_id / 固定列 / aux_data）是否已填该类别 */
export function entryHasAuxCategory(entry: Record<string, any>, cat: AuxCategoryBrief): boolean {
  const dyn = entry[`_${cat.code}_id`] ?? entry[`${cat.code}_id`]
  if (dyn != null && String(dyn) !== '') return true
  return entryHasAuxSelection(entry as any, cat.code, cat.id)
}

/** 一批即将写入的分录中，必填辅助缺失的（科目 × 类别去重） */
export function findEntriesMissingAux(
  lookup: AccountAuxRequirementLookup,
  entries: Array<Record<string, any> & { account_code: string }>,
): MissingAuxEntry[] {
  const out = new Map<string, MissingAuxEntry>()
  for (const e of entries) {
    const req = lookup(e.account_code)
    if (!req) continue
    for (const cat of req.categories) {
      if (entryHasAuxCategory(e, cat)) continue
      const k = `${req.code}|${cat.id}`
      if (!out.has(k)) out.set(k, { accountCode: req.code, accountName: req.name, categoryId: cat.id, categoryName: cat.name })
    }
  }
  return [...out.values()]
}

export function describeMissingAux(list: MissingAuxEntry[], limit = 5): string {
  const parts = list.slice(0, limit).map(m => `科目 ${m.accountCode} ${m.accountName} 缺少「${m.categoryName}」`)
  return parts.join('；') + (list.length > limit ? ` 等 ${list.length} 项` : '')
}
