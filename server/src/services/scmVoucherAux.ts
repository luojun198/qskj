/**
 * 进销存凭证 ↔ 总账辅助核算 严格对应
 *
 * 进销存往来单位 / 部门 / 业务员与总账辅助核算项目（aux_items）是两套档案。原来生成凭证时分录
 * 不带任何辅助核算，应收 / 应付挂了「客户 / 供应商」辅助的账套，辅助明细账里就是空的。
 *
 * 规则：
 *   - 分录要填哪些辅助类别 **由科目决定**（accounts.is_aux / aux_types），科目没挂的一律不填；
 *   - 每个类别的值从单据哪里取，由「来源映射」决定（参数 scm:aux_source_map，可在设置页改）：
 *     往来单位 partner / 部门 dept / 业务员 person / 不填 none；
 *   - 先查对照表 scm_gl_aux_map（手工指定 / 采纳近似 / 自动新建），再按匹配模式做 **完全一致** 匹配；
 *   - 对不上时只给出近似候选，必须用户确认后写入对照表才生效，绝不自动采用。
 */
import type { Database } from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'
import { loadVoucherAuxiliaryData, type AuxCategoryLike, type AuxItemLike } from './voucherEntry.js'
import { parseAccountAuxCategoryIds } from '../utils/auxItemId.js'

export type ScmAuxSourceType = 'partner' | 'dept' | 'person'
export type ScmAuxSource = ScmAuxSourceType | 'none'
export type ScmAuxMatchMode = 'name' | 'code' | 'code_name' | 'name_code'
export type ScmAuxMatchHow = 'manual' | 'confirmed' | 'created' | 'code' | 'name'

export const SCM_AUX_MATCH_MODE_KEY = 'scm:aux_match_mode'
export const SCM_AUX_SOURCE_MAP_KEY = 'scm:aux_source_map'
export const SCM_AUX_MATCH_MODES: ScmAuxMatchMode[] = ['name', 'code', 'code_name', 'name_code']
export const SCM_AUX_SOURCES: ScmAuxSource[] = ['partner', 'dept', 'person', 'none']
export const SOURCE_TYPE_LABEL: Record<ScmAuxSourceType, string> = { partner: '往来单位', dept: '部门', person: '业务员' }

interface AuxItemRow { id: string; type: string; code: string; name: string; status: string | null }
interface MapRow { id: string; source_type: string; source_code: string; category_id: string; aux_item_id: string; match_source: string }

export interface ScmAuxCategory extends AuxCategoryLike { name: string }

export interface ScmAuxContext {
  db: Database
  accountSetId: string
  categories: ScmAuxCategory[]
  catById: Map<string, ScmAuxCategory>
  itemMap: Record<string, AuxItemLike>
  /** 每个类别下的全部项目（含停用，用于识别停用 / 已删） */
  itemsByCat: Map<string, AuxItemRow[]>
  itemById: Map<string, AuxItemRow>
  sourceMap: Record<string, ScmAuxSource>
  matchMode: ScmAuxMatchMode
  maps: Map<string, MapRow>
  accountCatCache: Map<string, { name: string; catIds: string[] } | null>
}

export interface AuxSuggestion { id: string; code: string; name: string; score: number }

export type AuxMatchResult =
  | { itemId: string; code: string; name: string; how: ScmAuxMatchHow; mapId?: string }
  | { itemId: null; ambiguous: boolean; suggestions: AuxSuggestion[] }

export interface ScmAuxProblem {
  kind: 'unmatched' | 'ambiguous' | 'no_source' | 'empty_source'
  accountCode: string
  accountName: string
  categoryId: string
  categoryName: string
  sourceType: ScmAuxSourceType | null
  sourceCode: string
  sourceName: string
  suggestions: AuxSuggestion[]
}

const mapKey = (type: string, code: string, catId: string) => `${type}|${code}|${catId}`

function readParam(db: Database, aid: string, key: string): string {
  const row = db.prepare('SELECT param_value FROM system_params WHERE account_set_id=? AND param_key=?')
    .get(aid, key) as { param_value?: string } | undefined
  return String(row?.param_value ?? '').trim()
}

function hasMapTable(db: Database): boolean {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='scm_gl_aux_map'").get()
}

/** 类别默认从哪里取值：部门→单据部门、人员→业务员、项目 / 现金流量 / 资金来源→不填、其余（客户 / 供应商 / 往来单位）→往来单位 */
export function guessAuxSource(category: { code: string; name?: string | null }): ScmAuxSource {
  const code = String(category.code || '').toLowerCase()
  const name = String(category.name || '')
  if (code === 'dept' || name.includes('部门')) return 'dept'
  if (code === 'person' || /个人|人员|职员|员工|业务员/.test(name)) return 'person'
  if (['project', 'cash_flow', 'fund_source', 'func_class'].includes(code) || /项目|现金流量|资金来源/.test(name)) return 'none'
  return 'partner'
}

export function readMatchMode(db: Database, aid: string): ScmAuxMatchMode {
  const v = readParam(db, aid, SCM_AUX_MATCH_MODE_KEY) as ScmAuxMatchMode
  return SCM_AUX_MATCH_MODES.includes(v) ? v : 'name'
}

export function readSourceMap(db: Database, aid: string, categories: ScmAuxCategory[]): Record<string, ScmAuxSource> {
  let saved: Record<string, string> = {}
  try { saved = JSON.parse(readParam(db, aid, SCM_AUX_SOURCE_MAP_KEY) || '{}') || {} } catch { saved = {} }
  const out: Record<string, ScmAuxSource> = {}
  for (const c of categories) {
    const v = saved[c.id] as ScmAuxSource
    out[c.id] = SCM_AUX_SOURCES.includes(v) ? v : guessAuxSource(c)
  }
  return out
}

export function loadScmAuxContext(db: Database, accountSetId: string): ScmAuxContext {
  // 精简建表的单测库可能没有辅助核算表：视为本账套未启用辅助核算
  const auxReady = !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='aux_categories'").get()
  if (!auxReady) {
    return {
      db, accountSetId, categories: [], catById: new Map(), itemMap: {}, itemsByCat: new Map(), itemById: new Map(),
      sourceMap: {}, matchMode: 'name', maps: new Map(), accountCatCache: new Map(),
    }
  }
  const { categories, itemMap } = loadVoucherAuxiliaryData({ db, accountSetId })
  const cats = categories as ScmAuxCategory[]
  const items = db.prepare('SELECT id, type, code, name, status FROM aux_items WHERE account_set_id=? ORDER BY code')
    .all(accountSetId) as AuxItemRow[]
  const itemsByCat = new Map<string, AuxItemRow[]>()
  const itemById = new Map<string, AuxItemRow>()
  for (const it of items) {
    itemById.set(it.id, it)
    const list = itemsByCat.get(it.type) || []
    list.push(it)
    itemsByCat.set(it.type, list)
  }
  const maps = new Map<string, MapRow>()
  if (hasMapTable(db)) {
    for (const m of db.prepare('SELECT * FROM scm_gl_aux_map WHERE account_set_id=?').all(accountSetId) as MapRow[]) {
      maps.set(mapKey(m.source_type, m.source_code, m.category_id), m)
    }
  }
  return {
    db, accountSetId,
    categories: cats,
    catById: new Map(cats.map(c => [c.id, c])),
    itemMap, itemsByCat, itemById,
    sourceMap: readSourceMap(db, accountSetId, cats),
    matchMode: readMatchMode(db, accountSetId),
    maps,
    accountCatCache: new Map(),
  }
}

/** 科目启用的辅助类别（只认本账套存在的类别） */
export function accountAuxCategoryIds(ctx: ScmAuxContext, accountCode: string): { name: string; catIds: string[] } | null {
  if (ctx.accountCatCache.has(accountCode)) return ctx.accountCatCache.get(accountCode)!
  if (!ctx.categories.length) return null
  const row = ctx.db.prepare('SELECT name, is_aux, aux_types FROM accounts WHERE account_set_id=? AND code=? LIMIT 1')
    .get(ctx.accountSetId, accountCode) as { name: string; is_aux?: number; aux_types?: string } | undefined
  const out = row
    ? { name: row.name, catIds: row.is_aux ? parseAccountAuxCategoryIds(row.aux_types).filter(id => ctx.catById.has(id)) : [] }
    : null
  ctx.accountCatCache.set(accountCode, out)
  return out
}

// ── 近似候选 ───────────────────────────────────────────────────────────

const COMPANY_SUFFIX = /(股份有限公司|有限责任公司|有限公司|集团公司|分公司|公司|厂|店|商行)$/
/** 归一化：去空白、全半角括号与标点、常见公司后缀，统一大小写 */
export function normalizeAuxText(text: string): string {
  return String(text || '')
    .replace(/[\s　]/g, '')
    .replace(/[（）()【】\[\]{}<>《》「」『』.,，。、·\-_—:：;；'"“”‘’]/g, '')
    .toLowerCase()
    .replace(COMPANY_SUFFIX, '')
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    prev = cur
  }
  return prev[b.length]
}

/** 0~1 相似度：归一后相等 0.95；包含关系按长度比；否则按编辑距离 */
export function auxSimilarity(a: string, b: string): number {
  const x = normalizeAuxText(a); const y = normalizeAuxText(b)
  if (!x || !y) return 0
  if (x === y) return 0.95
  const [s, l] = x.length <= y.length ? [x, y] : [y, x]
  if (l.includes(s)) return Math.round((0.6 + 0.3 * (s.length / l.length)) * 100) / 100
  return Math.round((1 - levenshtein(x, y) / l.length) * 0.85 * 100) / 100
}

function suggest(items: AuxItemRow[], code: string, name: string, limit = 3): AuxSuggestion[] {
  const scored: AuxSuggestion[] = []
  for (const it of items) {
    if (it.status === 'closed') continue
    let score = name ? auxSimilarity(name, it.name) : 0
    if (code && it.code) {
      if (it.code.trim().toLowerCase() === code.trim().toLowerCase()) score = Math.max(score, 0.9)
      else score = Math.max(score, auxSimilarity(code, it.code) * 0.6)
    }
    if (score >= 0.45) scored.push({ id: it.id, code: it.code, name: it.name, score })
  }
  return scored.sort((a, b) => b.score - a.score || a.code.localeCompare(b.code)).slice(0, limit)
}

// ── 匹配 ───────────────────────────────────────────────────────────────

/**
 * 在一个辅助类别下为一条进销存资料找对应项目。
 * 对照表优先；再按模式完全一致（去首尾空格）。来源只有编号或只有名称时，缺的那一项跳过、用另一项。
 * 同名 / 同编号命中多条时视为「不唯一」，不自动选。
 */
export function matchAuxItem(
  ctx: ScmAuxContext,
  categoryId: string,
  sourceType: ScmAuxSourceType,
  source: { code?: string | null; name?: string | null },
): AuxMatchResult {
  const code = String(source.code ?? '').trim()
  const name = String(source.name ?? '').trim()
  const items = ctx.itemsByCat.get(categoryId) || []
  const mapped = ctx.maps.get(mapKey(sourceType, sourceType === 'person' ? (code || name) : code, categoryId))
  if (mapped) {
    const it = ctx.itemById.get(mapped.aux_item_id)
    // 指向的项目已删 / 停用 / 换了类别 → 当作未匹配，不报错
    if (it && it.type === categoryId && it.status !== 'closed') {
      return { itemId: it.id, code: it.code, name: it.name, how: mapped.match_source as ScmAuxMatchHow, mapId: mapped.id }
    }
  }
  const active = items.filter(it => it.status !== 'closed')
  const order: Array<'code' | 'name'> =
    ctx.matchMode === 'code' ? ['code']
      : ctx.matchMode === 'code_name' ? ['code', 'name']
        : ctx.matchMode === 'name_code' ? ['name', 'code']
          : ['name']
  // 模式要求的字段缺失时，用另一个字段（例如部门只有编码、业务员只有名称）
  const fields = order.filter(f => (f === 'code' ? code : name))
  if (!fields.length) fields.push(code ? 'code' : 'name')
  let ambiguous = false
  for (const f of fields) {
    const value = f === 'code' ? code : name
    if (!value) continue
    const hits = active.filter(it => String(f === 'code' ? it.code : it.name).trim() === value)
    if (hits.length === 1) return { itemId: hits[0].id, code: hits[0].code, name: hits[0].name, how: f }
    if (hits.length > 1) { ambiguous = true; break }
  }
  return { itemId: null, ambiguous, suggestions: suggest(active, code, name) }
}

/** 进销存来源资料（编号 + 名称） */
export function loadSourceInfo(
  ctx: ScmAuxContext,
  sourceType: ScmAuxSourceType,
  sourceCode: string,
): { code: string; name: string; exists: boolean } {
  const code = String(sourceCode || '').trim()
  if (!code) return { code: '', name: '', exists: false }
  if (sourceType === 'partner') {
    const p = ctx.db.prepare('SELECT code, name FROM scm_partner WHERE account_set_id=? AND code=?')
      .get(ctx.accountSetId, code) as { code: string; name: string } | undefined
    return { code, name: p?.name || '', exists: !!p }
  }
  if (sourceType === 'dept') {
    // 单据部门存的是「部门」辅助项的编码（DocForm 从 code=dept 的类别取下拉），名称照此回查
    const deptCat = ctx.categories.find(c => c.code === 'dept')
    const hit = deptCat ? (ctx.itemsByCat.get(deptCat.id) || []).find(it => it.code === code) : undefined
    return { code, name: hit?.name || '', exists: true }
  }
  // 业务员只存名称
  return { code: '', name: code, exists: true }
}

/** 单据上某个来源的取值 */
function docSourceCode(doc: Record<string, any>, sourceType: ScmAuxSourceType): string {
  if (sourceType === 'partner') return String(doc.partner_code || '').trim()
  if (sourceType === 'dept') return String(doc.dept_code || '').trim()
  return String(doc.biz_person || '').trim()
}

/**
 * 为单据的一个科目解析辅助核算引用：
 *   refs     { _类别code_id: 项目id }，可直接展开到 VoucherEntryInput 上
 *   problems 对不上的原因（调用方据此拦截）
 */
export function resolveDocAuxRefs(
  ctx: ScmAuxContext,
  doc: Record<string, any>,
  accountCode: string,
): { refs: Record<string, string>; problems: ScmAuxProblem[] } {
  const refs: Record<string, string> = {}
  const problems: ScmAuxProblem[] = []
  const acc = accountAuxCategoryIds(ctx, accountCode)
  if (!acc) return { refs, problems }
  for (const catId of acc.catIds) {
    const cat = ctx.catById.get(catId)!
    const base = { accountCode, accountName: acc.name, categoryId: catId, categoryName: cat.name, suggestions: [] as AuxSuggestion[] }
    const source = ctx.sourceMap[catId] || 'none'
    if (source === 'none') {
      problems.push({ ...base, kind: 'no_source', sourceType: null, sourceCode: '', sourceName: '' })
      continue
    }
    const sourceCode = docSourceCode(doc, source)
    if (!sourceCode) {
      problems.push({ ...base, kind: 'empty_source', sourceType: source, sourceCode: '', sourceName: '' })
      continue
    }
    const info = loadSourceInfo(ctx, source, sourceCode)
    const result = matchAuxItem(ctx, catId, source, info)
    if (result.itemId !== null) {
      refs[`_${cat.code}_id`] = result.itemId
    } else {
      problems.push({
        ...base,
        kind: result.ambiguous ? 'ambiguous' : 'unmatched',
        sourceType: source,
        sourceCode,
        sourceName: info.name,
        suggestions: result.suggestions,
      })
    }
  }
  return { refs, problems }
}

/** 同一来源 × 类别只报一次 */
export function dedupeProblems(problems: ScmAuxProblem[]): ScmAuxProblem[] {
  const seen = new Map<string, ScmAuxProblem>()
  for (const p of problems) {
    const k = `${p.kind}|${p.categoryId}|${p.sourceType}|${p.sourceCode}`
    if (!seen.has(k)) seen.set(k, p)
  }
  return [...seen.values()]
}

export function describeProblem(p: ScmAuxProblem): string {
  const acc = `科目 ${p.accountCode} ${p.accountName} 的「${p.categoryName}」辅助核算`
  if (p.kind === 'no_source') return `${acc}未设置取值来源`
  const src = p.sourceType ? SOURCE_TYPE_LABEL[p.sourceType] : ''
  if (p.kind === 'empty_source') return `${acc}要取单据的${src}，但单据未填${src}`
  const who = `${src}「${[p.sourceCode && p.sourceType !== 'person' ? p.sourceCode : '', p.sourceName].filter(Boolean).join(' ')}」`
  if (p.kind === 'ambiguous') return `${who}在${acc}中对应到多个项目，无法唯一确定`
  return `${who}在${acc}中找不到对应项目`
}

export function buildAuxProblemMessage(problems: ScmAuxProblem[]): string {
  const list = dedupeProblems(problems)
  const head = list.slice(0, 5).map(describeProblem).join('；')
  const more = list.length > 5 ? `；等共 ${list.length} 项` : ''
  return `辅助核算对应不上，未生成凭证：${head}${more}。请在「基础资料 → 业务凭证设置 → 进销存凭证设置」中手工指定或自动新建。`
}

// ── 单据关键字段必填（审核拦截 / 保存提醒） ─────────────────────────────

export interface ScmAuxRequiredField {
  source: ScmAuxSourceType
  label: string
  /** 涉及的辅助类别名（去重） */
  categoryNames: string[]
  /** 涉及的科目「编码 名称」（去重） */
  accounts: string[]
}

/**
 * 单据将要用到的科目里，哪些辅助类别要从单据的往来单位 / 部门 / 业务员取值：
 *   required 这些来源字段必须填写；missing 其中单据上为空的。
 * 只判断「空不空」，对不对得上（unmatched / ambiguous）与「未设置取值来源」仍在生成凭证时处理。
 */
export function checkDocRequiredSources(
  ctx: ScmAuxContext,
  doc: Record<string, any>,
  accountCodes: string[],
): { required: ScmAuxRequiredField[]; missing: ScmAuxRequiredField[] } {
  const bySource = new Map<ScmAuxSourceType, ScmAuxRequiredField>()
  for (const code of new Set(accountCodes)) {
    const acc = accountAuxCategoryIds(ctx, code)
    if (!acc) continue
    for (const catId of acc.catIds) {
      const source = ctx.sourceMap[catId] || 'none'
      if (source === 'none') continue
      const cat = ctx.catById.get(catId)!
      const f = bySource.get(source) || { source, label: SOURCE_TYPE_LABEL[source], categoryNames: [], accounts: [] }
      if (!f.categoryNames.includes(cat.name)) f.categoryNames.push(cat.name)
      const accText = `${code} ${acc.name}`
      if (!f.accounts.includes(accText)) f.accounts.push(accText)
      bySource.set(source, f)
    }
  }
  const required = [...bySource.values()]
  return { required, missing: required.filter(f => !docSourceCode(doc, f.source)) }
}

export function describeRequiredFields(missing: ScmAuxRequiredField[]): string {
  return missing.map(f => {
    const accs = f.accounts.slice(0, 3).join('、') + (f.accounts.length > 3 ? ` 等 ${f.accounts.length} 个科目` : '')
    return `科目 ${accs} 挂了「${f.categoryNames.join('、')}」辅助核算，单据须填写${f.label}`
  }).join('；')
}

// ── 对照表维护 ─────────────────────────────────────────────────────────

export function saveAuxMap(
  db: Database,
  accountSetId: string,
  input: { sourceType: string; sourceCode: string; categoryId: string; auxItemId: string; matchSource?: string },
): { id: string } {
  const sourceType = input.sourceType as ScmAuxSourceType
  if (!SOURCE_TYPE_LABEL[sourceType]) throw new Error('来源类型无效')
  const sourceCode = String(input.sourceCode || '').trim()
  if (!sourceCode) throw new Error('来源编号不能为空')
  const matchSource = ['manual', 'confirmed', 'created'].includes(String(input.matchSource)) ? String(input.matchSource) : 'manual'
  const cat = db.prepare('SELECT id FROM aux_categories WHERE id=? AND account_set_id=?').get(input.categoryId, accountSetId)
  if (!cat) throw new Error('辅助核算类别不存在')
  const item = db.prepare('SELECT id, type, status FROM aux_items WHERE id=? AND account_set_id=?')
    .get(input.auxItemId, accountSetId) as { id: string; type: string; status: string } | undefined
  if (!item || item.type !== input.categoryId) throw new Error('辅助核算项目不存在或不属于该类别')
  if (item.status === 'closed') throw new Error('辅助核算项目已停用')
  const existing = db.prepare('SELECT id FROM scm_gl_aux_map WHERE account_set_id=? AND source_type=? AND source_code=? AND category_id=?')
    .get(accountSetId, sourceType, sourceCode, input.categoryId) as { id: string } | undefined
  if (existing) {
    db.prepare("UPDATE scm_gl_aux_map SET aux_item_id=?, match_source=?, updated_at=datetime('now') WHERE id=?")
      .run(input.auxItemId, matchSource, existing.id)
    return { id: existing.id }
  }
  const id = uuidv4()
  db.prepare('INSERT INTO scm_gl_aux_map (id, account_set_id, source_type, source_code, category_id, aux_item_id, match_source) VALUES (?,?,?,?,?,?,?)')
    .run(id, accountSetId, sourceType, sourceCode, input.categoryId, input.auxItemId, matchSource)
  return { id }
}

export function deleteAuxMap(db: Database, accountSetId: string, id: string): boolean {
  return db.prepare('DELETE FROM scm_gl_aux_map WHERE id=? AND account_set_id=?').run(id, accountSetId).changes > 0
}

export interface AuxCreateResult {
  sourceType: string
  sourceCode: string
  categoryId: string
  ok: boolean
  auxItemId?: string
  message: string
}

function nextNumericCode(items: AuxItemRow[]): string {
  let max = 0; let width = 3
  for (const it of items) {
    if (/^\d+$/.test(it.code)) { max = Math.max(max, Number(it.code)); width = Math.max(width, it.code.length) }
  }
  return String(max + 1).padStart(width, '0')
}

/**
 * 按进销存资料的编号 + 名称在指定类别下新建辅助项目并写对照表。
 * 已存在同编号同名称的项目直接对应；编号或名称被别的项目占用、类别有必填扩展字段时不新建，返回原因。
 */
export function createAuxItemsForSources(
  db: Database,
  accountSetId: string,
  rows: Array<{ sourceType: string; sourceCode: string; categoryId: string }>,
): AuxCreateResult[] {
  const ctx = loadScmAuxContext(db, accountSetId)
  const results: AuxCreateResult[] = []
  const run = db.transaction(() => {
    for (const row of rows) {
      const base = { sourceType: row.sourceType, sourceCode: row.sourceCode, categoryId: row.categoryId }
      const sourceType = row.sourceType as ScmAuxSourceType
      const cat = ctx.catById.get(row.categoryId)
      if (!SOURCE_TYPE_LABEL[sourceType] || !cat) { results.push({ ...base, ok: false, message: '来源类型或辅助类别无效' }); continue }
      const info = loadSourceInfo(ctx, sourceType, row.sourceCode)
      if (!info.name) { results.push({ ...base, ok: false, message: `${SOURCE_TYPE_LABEL[sourceType]}「${row.sourceCode}」没有名称，无法新建` }); continue }
      const required = db.prepare('SELECT field_name FROM aux_category_fields WHERE category_id=? AND is_enabled=1 AND required_in_archive=1')
        .all(cat.id) as Array<{ field_name: string }>
      const items = ctx.itemsByCat.get(cat.id) || []
      const code = info.code || nextNumericCode(items)
      const sameCode = items.find(it => it.code === code)
      const sameName = items.find(it => it.name === info.name)
      let itemId: string
      let message: string
      if (sameCode && sameCode.name === info.name) {
        if (sameCode.status === 'closed') { results.push({ ...base, ok: false, message: `「${cat.name}」已有同编号同名称项目但已停用，请先启用` }); continue }
        itemId = sameCode.id
        message = `「${cat.name}」已有同编号同名称项目，直接对应`
      } else if (sameCode) {
        results.push({ ...base, ok: false, message: `「${cat.name}」中编码 ${code} 已被「${sameCode.name}」占用，请手工指定` }); continue
      } else if (sameName) {
        results.push({ ...base, ok: false, message: `「${cat.name}」中已有同名项目（编码 ${sameName.code}），请手工指定` }); continue
      } else if (required.length) {
        results.push({ ...base, ok: false, message: `「${cat.name}」有必填扩展字段（${required.map(r => r.field_name).join('、')}），请到核算项目中手工新建` }); continue
      } else {
        itemId = uuidv4()
        db.prepare("INSERT INTO aux_items (id, account_set_id, type, code, name, remark, field_values) VALUES (?, ?, ?, ?, ?, ?, '{}')")
          .run(itemId, accountSetId, cat.id, code, info.name, '进销存凭证设置自动新建')
        const created: AuxItemRow = { id: itemId, type: cat.id, code, name: info.name, status: 'active' }
        items.push(created); ctx.itemsByCat.set(cat.id, items); ctx.itemById.set(itemId, created)
        message = `已在「${cat.name}」新建 ${code} ${info.name}`
      }
      saveAuxMap(db, accountSetId, {
        sourceType, sourceCode: sourceType === 'person' ? info.name : info.code,
        categoryId: cat.id, auxItemId: itemId, matchSource: 'created',
      })
      results.push({ ...base, ok: true, auxItemId: itemId, message })
    }
  })
  run()
  return results
}

// ── 预览 ───────────────────────────────────────────────────────────────

export type AuxPreviewStatus = 'matched' | 'suggested' | 'unmatched'

export interface AuxPreviewRow {
  key: string
  source_type: ScmAuxSourceType
  source_code: string
  source_name: string
  partner_type?: string | null
  accounts: string[]
  category_id: string
  category_name: string
  status: AuxPreviewStatus
  ambiguous: boolean
  item_id: string | null
  item_code: string | null
  item_name: string | null
  how: ScmAuxMatchHow | null
  map_id: string | null
  suggestions: AuxSuggestion[]
}

/** 进销存往来科目（单位自带的应收 / 应付科目优先） */
export interface ScmPreviewAccounts {
  ar: string
  ap: string
  /** 应收应付以外的对方科目（收入 / 成本 / 税等） */
  others: string[]
}

function previewRow(
  ctx: ScmAuxContext,
  sourceType: ScmAuxSourceType,
  info: { code: string; name: string },
  catId: string,
  accounts: string[],
  partnerType?: string | null,
): AuxPreviewRow {
  const cat = ctx.catById.get(catId)!
  const result = matchAuxItem(ctx, catId, sourceType, info)
  const sourceCode = sourceType === 'person' ? info.name : info.code
  return {
    key: mapKey(sourceType, sourceCode, catId),
    source_type: sourceType,
    source_code: sourceCode,
    source_name: info.name,
    partner_type: partnerType ?? null,
    accounts,
    category_id: catId,
    category_name: cat.name,
    ...(result.itemId !== null
      ? {
          status: 'matched' as const, ambiguous: false,
          item_id: result.itemId, item_code: result.code, item_name: result.name,
          how: result.how, map_id: result.mapId ?? null, suggestions: [],
        }
      : {
          status: result.suggestions.length ? 'suggested' as const : 'unmatched' as const, ambiguous: result.ambiguous,
          item_id: null, item_code: null, item_name: null, how: null, map_id: null, suggestions: result.suggestions,
        }),
  }
}

/** 某来源类型在这些科目上需要对应的类别 → 涉及科目 */
function categoriesFor(ctx: ScmAuxContext, sourceType: ScmAuxSourceType, accountCodes: string[]): Map<string, string[]> {
  const out = new Map<string, string[]>()
  for (const code of accountCodes) {
    if (!code) continue
    const acc = accountAuxCategoryIds(ctx, code)
    if (!acc) continue
    for (const catId of acc.catIds) {
      if (ctx.sourceMap[catId] !== sourceType) continue
      const list = out.get(catId) || []
      if (!list.includes(code)) list.push(code)
      out.set(catId, list)
    }
  }
  return out
}

export function buildAuxPreview(
  ctx: ScmAuxContext,
  sourceType: ScmAuxSourceType,
  accounts: ScmPreviewAccounts,
): { rows: AuxPreviewRow[]; notRequired: number } {
  const rows: AuxPreviewRow[] = []
  let notRequired = 0
  const db = ctx.db; const aid = ctx.accountSetId
  if (sourceType === 'partner') {
    const partners = db.prepare('SELECT code, name, partner_type, ar_account, ap_account FROM scm_partner WHERE account_set_id=? AND enabled=1 ORDER BY code')
      .all(aid) as Array<{ code: string; name: string; partner_type: string | null; ar_account: string | null; ap_account: string | null }>
    for (const p of partners) {
      const type = p.partner_type || 'both'
      const codes = [...accounts.others]
      if (type !== 'supplier') codes.push(p.ar_account || accounts.ar)
      if (type !== 'customer') codes.push(p.ap_account || accounts.ap)
      const cats = categoriesFor(ctx, 'partner', codes)
      if (!cats.size) { notRequired++; continue }
      for (const [catId, accs] of cats) rows.push(previewRow(ctx, 'partner', { code: p.code, name: p.name || '' }, catId, accs, type))
    }
    return { rows, notRequired }
  }
  // 部门 / 业务员：取单据里实际出现过的值
  const col = sourceType === 'dept' ? 'dept_code' : 'biz_person'
  const values = (db.prepare(`SELECT DISTINCT TRIM(${col}) v FROM scm_doc WHERE account_set_id=? AND TRIM(COALESCE(${col},''))<>'' ORDER BY v`)
    .all(aid) as Array<{ v: string }>).map(r => r.v)
  const allCodes = [accounts.ar, accounts.ap, ...accounts.others]
  const cats = categoriesFor(ctx, sourceType, allCodes)
  if (!cats.size) return { rows, notRequired: values.length }
  for (const v of values) {
    const info = loadSourceInfo(ctx, sourceType, v)
    for (const [catId, accs] of cats) rows.push(previewRow(ctx, sourceType, info, catId, accs))
  }
  return { rows, notRequired }
}
