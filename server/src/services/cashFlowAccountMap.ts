/**
 * 科目现金流量项目：映射的读取、默认预设、编辑、复制
 *
 * 映射表 account_cash_flow_map：一行 = 一个科目的 主表贷方 / 主表借方 / 附表贷方 / 附表借方 项目编码。
 * 取数时科目没有行则继承最近一个有行的上级；整个账套一行都没有时按默认规则在内存里推出（不落库），
 * 首次打开设置页时再把默认规则写进库里，用户在页面上核对修改。
 */
import type { Database } from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'
import {
  CASH_EQUIVALENT_ACCOUNT_NAMES,
  CATEGORY_FALLBACK_RULES,
  MAIN_SLOTS,
  SUPPLEMENT_ITEMS,
  SUPPLEMENT_NET_PROFIT_CODE,
  type AccountCashFlowRule,
  type CashFlowActivity,
  type CashFlowFlow,
  type MainSlot,
} from '../config/cashFlowAccountDefaults.js'
import {
  CASH_FLOW_PROFILES,
  profileRules,
  type AccountClass,
  type AccountTab,
  type CashFlowStandardKey,
  type CashFlowStandardProfile,
} from '../config/cashFlowStandards.js'
import { getAccountingStandardParam } from './accountingStandard.js'

export type { AccountClass, AccountTab, CashFlowStandardKey, CashFlowStandardProfile }

/** 只读查询需要的最小 db 能力（报表引擎传进来的可能是只读包装） */
export interface CashFlowQueryDb {
  prepare: (sql: string) => {
    get: (...params: any[]) => any
    all: (...params: any[]) => any[]
  }
}

export interface CashFlowAccountRow {
  id: string
  code: string
  name: string
  level: number
  parent_id: string | null
  direction: 'debit' | 'credit'
  is_cash: number
  is_bank: number
  is_enabled: number
}

export interface CashFlowMapCodes {
  main_credit_code: string | null
  main_debit_code: string | null
  supp_credit_code: string | null
  supp_debit_code: string | null
}

export interface CashFlowItemLite {
  code: string
  name: string
  direction: string
  kind: string
  is_leaf: number
  parent_code: string | null
}

export interface ItemClass {
  activity: CashFlowActivity | null
  flow: CashFlowFlow | null
}

const EMPTY_CODES: CashFlowMapCodes = {
  main_credit_code: null,
  main_debit_code: null,
  supp_credit_code: null,
  supp_debit_code: null,
}

// ───────────────────────── 映射版本（供取数缓存失效） ─────────────────────────
let mapEpoch = 0
export function getCashFlowMapEpoch() {
  return mapEpoch
}
export function bumpCashFlowMapEpoch() {
  mapEpoch += 1
}

// ───────────────────────── 表结构探测 ─────────────────────────
function hasTable(db: CashFlowQueryDb, name: string): boolean {
  try {
    return !!db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`).get(name)
  } catch {
    return false
  }
}

function hasColumn(db: CashFlowQueryDb, table: string, column: string): boolean {
  try {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
    return cols.some(c => c.name === column)
  } catch {
    return false
  }
}

// ───────────────────────── 科目 ─────────────────────────
export function loadCashFlowAccounts(db: CashFlowQueryDb, accountSetId: string): CashFlowAccountRow[] {
  return db
    .prepare(
      `SELECT id, code, name, level, parent_id, direction,
              COALESCE(is_cash, 0) AS is_cash, COALESCE(is_bank, 0) AS is_bank,
              COALESCE(is_enabled, 1) AS is_enabled
       FROM accounts WHERE account_set_id = ? ORDER BY code`
    )
    .all(accountSetId) as CashFlowAccountRow[]
}

/** 按准则档案推导科目类别（topName = 一级科目名称，通用档案按名称判断） */
export function classifyAccountCode(code: string, standard: CashFlowStandardKey, topName = ''): AccountClass {
  return CASH_FLOW_PROFILES[standard].classify(code, topName)
}

/** 每个科目的一级科目名称 */
function buildTopNames(accounts: CashFlowAccountRow[]): Map<string, string> {
  const byId = new Map(accounts.map(a => [a.id, a]))
  const out = new Map<string, string>()
  for (const acc of accounts) {
    let cur = acc
    for (let i = 0; i < 20 && cur.parent_id && byId.has(cur.parent_id); i++) cur = byId.get(cur.parent_id)!
    out.set(acc.id, cur.name)
  }
  return out
}

export function buildAccountClassMap(accounts: CashFlowAccountRow[], profile: CashFlowStandardProfile): Map<string, AccountClass> {
  const topNames = buildTopNames(accounts)
  return new Map(accounts.map(a => [a.id, profile.classify(a.code, topNames.get(a.id) || a.name)]))
}

/**
 * 确定账套用哪套现金流量准则档案：
 *  1. 参数 accounting_standard 明确为 企业 / 小企业 / 政府 时直接用；
 *  2. 否则按科目探测（民非 → 企业 → 小企业 → 政府）；
 *  3. 都不像 → generic（合作社、村集体、工会等按名称通用规则），不再一律当政府。
 */
export function resolveCashFlowStandardKey(
  db: CashFlowQueryDb,
  accountSetId: string,
  accounts?: CashFlowAccountRow[]
): CashFlowStandardKey {
  try {
    const param = getAccountingStandardParam(db as unknown as Database, accountSetId)
    if (param === 'enterprise' || param === 'small_business' || param === 'government') return param
  } catch {
    // 老库 / 测试库无 system_params：走探测
  }
  return detectCashFlowStandardKey(accounts ?? loadCashFlowAccounts(db, accountSetId))
}

export function detectCashFlowStandardKey(accounts: Array<Pick<CashFlowAccountRow, 'code' | 'name' | 'parent_id'>>): CashFlowStandardKey {
  const tops = accounts.filter(a => !a.parent_id)
  const names = new Set(tops.map(a => String(a.name).trim()))
  const nameOf = new Map(tops.map(a => [String(a.code).replace(/\D/g, ''), String(a.name)]))
  const has = (code: string, name: string) => (nameOf.get(code) || '').includes(name)
  if (names.has('捐赠收入') && (names.has('非限定性净资产') || names.has('限定性净资产') || names.has('会费收入'))) return 'npo'
  if (has('6001', '主营业务收入') || has('6401', '主营业务成本') || has('6601', '销售费用') || has('6602', '管理费用')) return 'enterprise'
  if (has('5001', '主营业务收入') || has('5401', '主营业务成本') || has('5602', '管理费用')) return 'small_business'
  if (names.has('累计盈余') || names.has('业务活动费用') || names.has('财政拨款收入') || names.has('单位管理费用')) return 'government'
  return 'generic'
}

export function resolveCashFlowProfile(db: CashFlowQueryDb, accountSetId: string, accounts?: CashFlowAccountRow[]): CashFlowStandardProfile {
  return CASH_FLOW_PROFILES[resolveCashFlowStandardKey(db, accountSetId, accounts)]
}

/** 现金及现金等价物科目：自身或任一上级勾了现金 / 银行，或名称为库存现金 / 银行存款 / 其他货币资金等 */
export function computeCashEquivalentIds(accounts: CashFlowAccountRow[]): Set<string> {
  const byId = new Map(accounts.map(a => [a.id, a]))
  const memo = new Map<string, boolean>()
  const names = new Set(CASH_EQUIVALENT_ACCOUNT_NAMES)
  const visit = (a: CashFlowAccountRow, depth = 0): boolean => {
    const hit = memo.get(a.id)
    if (hit !== undefined) return hit
    let result = a.is_cash === 1 || a.is_bank === 1 || (a.level <= 1 && names.has(String(a.name).trim()))
    if (!result && a.parent_id && depth < 20) {
      const parent = byId.get(a.parent_id)
      if (parent) result = visit(parent, depth + 1)
    }
    memo.set(a.id, result)
    return result
  }
  const out = new Set<string>()
  for (const a of accounts) if (visit(a)) out.add(a.id)
  return out
}

// ───────────────────────── 现金流量项目 ─────────────────────────
export function loadCashFlowItemsLite(db: CashFlowQueryDb, accountSetId: string): CashFlowItemLite[] {
  if (!hasTable(db, 'cash_flow_items')) return []
  const kindExpr = hasColumn(db, 'cash_flow_items', 'kind') ? `COALESCE(kind, 'main')` : `'main'`
  const leafExpr = hasColumn(db, 'cash_flow_items', 'is_leaf') ? 'COALESCE(is_leaf, 1)' : '1'
  const parentExpr = hasColumn(db, 'cash_flow_items', 'parent_code') ? 'parent_code' : 'NULL'
  return db
    .prepare(
      `SELECT code, name, direction, ${kindExpr} AS kind, ${leafExpr} AS is_leaf, ${parentExpr} AS parent_code
       FROM cash_flow_items WHERE account_set_id = ? AND COALESCE(is_active, 1) = 1 ORDER BY code`
    )
    .all(accountSetId) as CashFlowItemLite[]
}

const OPERATING_WORDS = ['经营', '销售', '购买', '购货', '职工', '税费', '劳务', '日常活动']
const INVESTING_WORDS = ['投资活动', '收回投资', '投资收益', '处置', '购建', '投资支付', '投资付现', '对外投资']
const FINANCING_WORDS = ['筹资', '借款', '偿还', '吸收投资', '分配', '股利', '利息', '拨款']

/** 推断主表项目属于哪类活动、流入还是流出 */
export function classifyCashFlowItem(item: Pick<CashFlowItemLite, 'code' | 'name' | 'direction'>): ItemClass {
  const code = String(item.code || '').trim()
  const name = String(item.name || '')
  const m = /^([123])([012])/.exec(code)
  let activity: CashFlowActivity | null = null
  let flow: CashFlowFlow | null = null
  if (m) {
    activity = m[1] === '1' ? 'operating' : m[1] === '2' ? 'investing' : 'financing'
    if (m[2] === '1') flow = 'in'
    else if (m[2] === '2') flow = 'out'
    else return { activity, flow: null } // x0xx：现金内部流转等中性项目
  } else if (/^4/.test(code)) {
    return { activity: null, flow: null } // 汇率影响等
  }
  if (!activity) {
    if (FINANCING_WORDS.some(w => name.includes(w))) activity = 'financing'
    else if (INVESTING_WORDS.some(w => name.includes(w))) activity = 'investing'
    else if (OPERATING_WORDS.some(w => name.includes(w))) activity = 'operating'
  }
  if (!flow) {
    if (item.direction === 'inflow') flow = 'in'
    else if (item.direction === 'outflow') flow = 'out'
    else if (/收到|收回|收现|取得|吸收|返还/.test(name)) flow = 'in'
    else if (/支付|付现|偿还|购建|分配|上缴/.test(name)) flow = 'out'
  }
  return { activity, flow }
}

/** 主表语义槽位 → 本账套项目编码 */
export function resolveMainSlot(slot: MainSlot, items: CashFlowItemLite[], strict = false): string | null {
  const candidates = items
    .filter(i => i.kind !== 'supplement' && i.is_leaf !== 0)
    .map(i => ({ item: i, cls: classifyCashFlowItem(i) }))
  const tried = new Set<MainSlot>()
  const tryOne = (s: MainSlot): string | null => {
    if (tried.has(s)) return null
    tried.add(s)
    const def = MAIN_SLOTS[s]
    const pool = candidates.filter(c => c.cls.activity === def.activity && c.cls.flow === def.flow)
    for (const kw of def.keywords) {
      const hit = pool.find(
        c => c.item.name.includes(kw) && !(def.exclude || []).some(ex => c.item.name.includes(ex))
      )
      if (hit) return hit.item.code
    }
    if (strict) return null
    for (const fb of def.fallback || []) {
      const code = tryOne(fb)
      if (code) return code
    }
    return null
  }
  const direct = tryOne(slot)
  if (direct || strict) return direct
  // 兜底：同活动同流向的第一个项目
  const def = MAIN_SLOTS[slot]
  const any = candidates.find(c => c.cls.activity === def.activity && c.cls.flow === def.flow)
  return any ? any.item.code : null
}

// ───────────────────────── 默认规则 ─────────────────────────
function ruleMatches(rule: AccountCashFlowRule, name: string, topName = ''): boolean {
  const n = String(name || '').trim()
  if (rule.underTop && !rule.underTop.some(t => topName.includes(t))) return false
  if ((rule.exclude || []).some(ex => n.includes(ex))) return false
  if ((rule.exact || []).includes(n)) return true
  return rule.keywords.some(kw => n.includes(kw))
}

function toCodes(
  rule: Pick<AccountCashFlowRule, 'mc' | 'md' | 'sc' | 'sd'>,
  slotCache: Map<MainSlot, string | null>,
  items: CashFlowItemLite[],
  withSupplement: boolean
): CashFlowMapCodes {
  const slot = (s: MainSlot | null) => {
    if (!s) return null
    if (!slotCache.has(s)) slotCache.set(s, resolveMainSlot(s, items))
    return slotCache.get(s) ?? null
  }
  return {
    main_credit_code: slot(rule.mc),
    main_debit_code: slot(rule.md),
    supp_credit_code: withSupplement ? rule.sc : null,
    supp_debit_code: withSupplement ? rule.sd : null,
  }
}

/**
 * 按默认规则推出整个账套的映射（不含现金等价物、预算会计科目）。
 * 一级科目按名称命中规则；下级默认继承上级，只有 anyLevel 规则能让下级按自己的名称改判。
 */
export function computeDefaultCashFlowMapping(
  accounts: CashFlowAccountRow[],
  profile: CashFlowStandardProfile,
  items: CashFlowItemLite[]
): Map<string, CashFlowMapCodes> {
  const cashIds = computeCashEquivalentIds(accounts)
  const byId = new Map(accounts.map(a => [a.id, a]))
  const topNames = buildTopNames(accounts)
  const slotCache = new Map<MainSlot, string | null>()
  const rules = profileRules(profile)
  const anyLevelRules = rules.filter(r => r.anyLevel)
  const topRules = rules.filter(r => !r.anyLevel)
  const result = new Map<string, CashFlowMapCodes>()
  const codesOf = (rule: Pick<AccountCashFlowRule, 'mc' | 'md' | 'sc' | 'sd'>) =>
    toCodes(rule, slotCache, items, profile.hasSupplement)

  const sorted = [...accounts].sort((a, b) => (a.level - b.level) || a.code.localeCompare(b.code))
  for (const acc of sorted) {
    if (cashIds.has(acc.id)) continue
    const topName = topNames.get(acc.id) || acc.name
    const cls = profile.classify(acc.code, topName)
    if (!cls.tab) continue

    const own = anyLevelRules.find(r => ruleMatches(r, acc.name, topName))
    if (own) {
      result.set(acc.id, codesOf(own))
      continue
    }
    const parent = acc.parent_id ? byId.get(acc.parent_id) : undefined
    if (parent && result.has(parent.id)) {
      result.set(acc.id, { ...result.get(parent.id)! })
      continue
    }
    const rule = topRules.find(r => ruleMatches(r, acc.name, topName))
    const fallback = cls.fallbackKey ? CATEGORY_FALLBACK_RULES[cls.fallbackKey] : null
    const picked = rule || fallback
    if (!picked) continue
    result.set(acc.id, codesOf(picked))
  }
  return result
}

// ───────────────────────── 生效映射（取数用） ─────────────────────────
export interface EffectiveCashFlowMapping {
  standard: CashFlowStandardKey
  profile: CashFlowStandardProfile
  /** 科目 → 科目大类（是否损益、所属页签） */
  accountClass: Map<string, AccountClass>
  accounts: CashFlowAccountRow[]
  accountById: Map<string, CashFlowAccountRow>
  cashIds: Set<string>
  /** 科目 → 生效的 4 个编码（已按上级继承） */
  codes: Map<string, CashFlowMapCodes>
  items: CashFlowItemLite[]
  itemClass: Map<string, ItemClass>
  /** 映射来自数据库（false = 账套尚未保存过，按默认规则临时推算） */
  persisted: boolean
}

function loadMapRows(db: CashFlowQueryDb, accountSetId: string): Map<string, CashFlowMapCodes> {
  const out = new Map<string, CashFlowMapCodes>()
  if (!hasTable(db, 'account_cash_flow_map')) return out
  const rows = db
    .prepare(
      `SELECT account_id, main_credit_code, main_debit_code, supp_credit_code, supp_debit_code
       FROM account_cash_flow_map WHERE account_set_id = ?`
    )
    .all(accountSetId) as Array<CashFlowMapCodes & { account_id: string }>
  for (const r of rows) {
    out.set(r.account_id, {
      main_credit_code: r.main_credit_code || null,
      main_debit_code: r.main_debit_code || null,
      supp_credit_code: r.supp_credit_code || null,
      supp_debit_code: r.supp_debit_code || null,
    })
  }
  return out
}

export function getEffectiveCashFlowMapping(db: CashFlowQueryDb, accountSetId: string): EffectiveCashFlowMapping {
  const accounts = loadCashFlowAccounts(db, accountSetId)
  const profile = resolveCashFlowProfile(db, accountSetId, accounts)
  const standard = profile.key
  const accountClass = buildAccountClassMap(accounts, profile)
  const accountById = new Map(accounts.map(a => [a.id, a]))
  const cashIds = computeCashEquivalentIds(accounts)
  const loaded = loadCashFlowItemsLite(db, accountSetId)
  // 没有补充资料的准则：不认附表项目，映射里的附表列也忽略
  const items = profile.hasSupplement ? withSupplementItems(loaded) : loaded.filter(i => i.kind !== 'supplement')
  const itemClass = new Map(items.map(i => [i.code, classifyCashFlowItem(i)]))

  const stored = loadMapRows(db, accountSetId)
  const persisted = stored.size > 0
  const own = persisted ? stored : computeDefaultCashFlowMapping(accounts, profile, items)

  const codes = new Map<string, CashFlowMapCodes>()
  const resolve = (acc: CashFlowAccountRow, depth = 0): CashFlowMapCodes | null => {
    if (codes.has(acc.id)) return codes.get(acc.id)!
    let found = own.get(acc.id) || null
    if (!found && acc.parent_id && depth < 20) {
      const parent = accountById.get(acc.parent_id)
      if (parent) found = resolve(parent, depth + 1)
    }
    if (found) {
      if (!profile.hasSupplement && (found.supp_credit_code || found.supp_debit_code)) {
        found = { ...found, supp_credit_code: null, supp_debit_code: null }
      }
      codes.set(acc.id, found)
    }
    return found
  }
  for (const acc of accounts) {
    if (cashIds.has(acc.id)) continue
    resolve(acc)
  }
  // 预设之后新增的一级科目（及其下级）库里没有行：按默认规则补上，不让它变成「未设置」
  if (persisted) {
    const missing = accounts.filter(a => !cashIds.has(a.id) && !codes.has(a.id))
    if (missing.length > 0) {
      const defaults = computeDefaultCashFlowMapping(accounts, profile, items)
      for (const acc of missing) {
        const d = defaults.get(acc.id)
        if (d) codes.set(acc.id, d)
      }
    }
  }
  return { standard, profile, accountClass, accounts, accountById, cashIds, codes, items, itemClass, persisted }
}

/** 库里还没补附表项目时，取数侧仍能认出 F01~F16 */
function withSupplementItems(items: CashFlowItemLite[]): CashFlowItemLite[] {
  const have = new Set(items.filter(i => i.kind === 'supplement').map(i => i.code))
  const extra = SUPPLEMENT_ITEMS.filter(s => !have.has(s.code)).map(s => ({
    code: s.code,
    name: s.name,
    direction: 'neutral',
    kind: 'supplement',
    is_leaf: 1,
    parent_code: null,
  }))
  return extra.length ? [...items, ...extra] : items
}

// ───────────────────────── 写入：补项目 / 预设 / 编辑 / 复制 ─────────────────────────
/** 补齐附表项目（kind = supplement）；没有补充资料的准则不补 */
export function ensureSupplementItems(db: Database, accountSetId: string, profile?: CashFlowStandardProfile): number {
  if (!hasColumn(db, 'cash_flow_items', 'kind')) return 0
  if (!(profile ?? resolveCashFlowProfile(db, accountSetId)).hasSupplement) return 0
  const existing = new Set(
    (db.prepare(`SELECT code FROM cash_flow_items WHERE account_set_id = ?`).all(accountSetId) as Array<{ code: string }>).map(
      r => r.code
    )
  )
  const insert = db.prepare(
    `INSERT INTO cash_flow_items (id, account_set_id, code, name, direction, parent_code, level, is_leaf, sort_order, is_active, kind)
     VALUES (?, ?, ?, ?, 'neutral', NULL, 1, 1, ?, 1, 'supplement')`
  )
  let n = 0
  SUPPLEMENT_ITEMS.forEach((s, idx) => {
    if (existing.has(s.code)) {
      db.prepare(`UPDATE cash_flow_items SET kind = 'supplement', is_active = 1 WHERE account_set_id = ? AND code = ?`).run(
        accountSetId,
        s.code
      )
      return
    }
    insert.run(uuidv4(), accountSetId, s.code, s.name, 900 + idx)
    n++
  })
  return n
}

/**
 * 按准则档案补主表项目：
 *  - 账套一个主表项目都没有（空白建账）→ 按档案整套补建（编码与该准则 ACD 模板一致）；
 *  - 已有项目 → 只补「按名称语义匹配不到、编码也没被占用」的档案项目（如政府模板缺的 1204 支付的各项税费）。
 * 同时把 x0xx（现金内部流转）/ 4xxx（汇率影响）的流向纠正为 neutral。
 */
export function ensureMainItems(db: Database, accountSetId: string, profile?: CashFlowStandardProfile): number {
  const prof = profile ?? resolveCashFlowProfile(db, accountSetId)
  const withKind = hasColumn(db, 'cash_flow_items', 'kind')
  const kindExpr = withKind ? `COALESCE(kind,'main')` : `'main'`
  const existing = db
    .prepare(`SELECT code, name, direction, is_active FROM cash_flow_items WHERE account_set_id = ? AND ${kindExpr} = 'main'`)
    .all(accountSetId) as Array<{ code: string; name: string; direction: string; is_active: number }>
  const occupied = new Set(existing.map(r => r.code))
  const active: CashFlowItemLite[] = existing
    .filter(r => r.is_active !== 0)
    .map(r => ({ code: r.code, name: r.name, direction: r.direction, kind: 'main', is_leaf: 1, parent_code: null }))

  const insert = db.prepare(
    `INSERT OR IGNORE INTO cash_flow_items (id, account_set_id, code, name, direction, parent_code, level, is_leaf, sort_order, is_active${withKind ? ', kind' : ''})
     VALUES (?, ?, ?, ?, ?, NULL, 1, 1, ?, 1${withKind ? ", 'main'" : ''})`
  )
  let n = 0
  prof.items.forEach((item, idx) => {
    if (occupied.has(item.code)) return
    if (active.length > 0) {
      if (!item.slot) return // 中性项目只在整套补建时加
      if (resolveMainSlot(item.slot, active, true)) return
    }
    insert.run(uuidv4(), accountSetId, item.code, item.name, item.direction, idx + 1)
    n++
  })

  db.prepare(
    `UPDATE cash_flow_items SET direction = 'neutral'
     WHERE account_set_id = ? AND direction != 'neutral' AND (code GLOB '[123]0[0-9][0-9]' OR code GLOB '4[0-9][0-9][0-9]')`
  ).run(accountSetId)
  return n
}

/** 建账入口用：初始化现金流量，失败只记日志 / 警告，不中断建账 */
export function initCashFlowForAccountSetSafe(db: Database, accountSetId: string, warnings?: string[]): void {
  try {
    const r = initCashFlowForAccountSet(db, accountSetId)
    console.log(`[现金流量] 账套 ${accountSetId} 按「${r.standard}」初始化：补项目 ${r.items} 个，预设科目 ${r.written} 个`)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[现金流量] 初始化失败:', error)
    warnings?.push(`科目现金流量项目预设失败（可到「基础资料 → 科目现金流量项目」点恢复默认）：${message}`)
  }
}

/**
 * 新建账套后初始化现金流量：按准则补齐主表 / 附表项目并写入科目现金流量项目预设。
 * 各建账入口（标准模板、旧模板、重新初始化、ACD 导入）在科目导入完成后调用；失败不影响建账。
 */
export function initCashFlowForAccountSet(
  db: Database,
  accountSetId: string
): { standard: CashFlowStandardKey; written: number; items: number } {
  if (!hasTable(db, 'cash_flow_items')) return { standard: 'generic', written: 0, items: 0 }
  const profile = resolveCashFlowProfile(db, accountSetId)
  let items = 0
  db.transaction(() => {
    items += ensureMainItems(db, accountSetId, profile)
    items += ensureSupplementItems(db, accountSetId, profile)
  })()
  const hasAccounts = !!db.prepare(`SELECT 1 AS x FROM accounts WHERE account_set_id = ? LIMIT 1`).get(accountSetId)
  const written =
    hasAccounts && hasTable(db, 'account_cash_flow_map')
      ? presetCashFlowMapping(db, accountSetId, { overwrite: false }).written
      : 0
  return { standard: profile.key, written, items }
}

const UPSERT_SQL = `
  INSERT INTO account_cash_flow_map (id, account_set_id, account_id, main_credit_code, main_debit_code, supp_credit_code, supp_debit_code, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
  ON CONFLICT(account_set_id, account_id) DO UPDATE SET
    main_credit_code = excluded.main_credit_code,
    main_debit_code = excluded.main_debit_code,
    supp_credit_code = excluded.supp_credit_code,
    supp_debit_code = excluded.supp_debit_code,
    updated_at = excluded.updated_at`

/**
 * 按默认规则写入映射
 * @param overwrite false = 只补没有行的科目；true = 覆盖（「恢复默认」）
 * @param tab 只处理某一类科目
 */
export function presetCashFlowMapping(
  db: Database,
  accountSetId: string,
  options: { overwrite?: boolean; tab?: AccountTab } = {}
): { written: number } {
  let written = 0
  db.transaction(() => {
    const accounts = loadCashFlowAccounts(db, accountSetId)
    const profile = resolveCashFlowProfile(db, accountSetId, accounts)
    ensureMainItems(db, accountSetId, profile)
    ensureSupplementItems(db, accountSetId, profile)
    const classes = buildAccountClassMap(accounts, profile)
    const items = loadCashFlowItemsLite(db, accountSetId).filter(i => profile.hasSupplement || i.kind !== 'supplement')
    const defaults = computeDefaultCashFlowMapping(accounts, profile, items)
    const stored = loadMapRows(db, accountSetId)
    const upsert = db.prepare(UPSERT_SQL)
    for (const acc of accounts) {
      const codes = defaults.get(acc.id)
      if (!codes) continue
      if (options.tab && classes.get(acc.id)?.tab !== options.tab) continue
      if (!options.overwrite && stored.has(acc.id)) continue
      upsert.run(
        uuidv4(),
        accountSetId,
        acc.id,
        codes.main_credit_code,
        codes.main_debit_code,
        codes.supp_credit_code,
        codes.supp_debit_code
      )
      written++
    }
  })()
  bumpCashFlowMapEpoch()
  return { written }
}

/** 账套还没有任何映射行时写入默认值（设置页首次打开 / 新建账套） */
export function ensureCashFlowMappingSeeded(db: Database, accountSetId: string): boolean {
  if (!hasTable(db, 'account_cash_flow_map')) return false
  const row = db
    .prepare(`SELECT 1 AS x FROM account_cash_flow_map WHERE account_set_id = ? LIMIT 1`)
    .get(accountSetId)
  if (row) {
    ensureSupplementItems(db, accountSetId)
    return false
  }
  presetCashFlowMapping(db, accountSetId, { overwrite: false })
  return true
}

export interface CashFlowMapListRow extends CashFlowMapCodes {
  account_id: string
  code: string
  name: string
  level: number
  parent_id: string | null
  direction: 'debit' | 'credit'
  is_enabled: number
  category_label: string
  is_cash_equivalent: boolean
  has_children: boolean
  /** 本行是否为自己的设置（false = 继承上级） */
  own: boolean
}

export function listCashFlowMapRows(db: Database, accountSetId: string, tab: AccountTab): CashFlowMapListRow[] {
  const mapping = getEffectiveCashFlowMapping(db, accountSetId)
  const accounts = mapping.accounts
  const cashIds = mapping.cashIds
  const stored = loadMapRows(db, accountSetId)
  const effective = mapping.codes
  const parentIds = new Set(accounts.map(a => a.parent_id).filter(Boolean) as string[])
  const rows: CashFlowMapListRow[] = []
  for (const acc of accounts) {
    const cls = mapping.accountClass.get(acc.id)
    if (!cls || cls.tab !== tab) continue
    const isCash = cashIds.has(acc.id)
    const codes = isCash ? EMPTY_CODES : effective.get(acc.id) || EMPTY_CODES
    rows.push({
      account_id: acc.id,
      code: acc.code,
      name: acc.name,
      level: acc.level,
      parent_id: acc.parent_id,
      direction: acc.direction,
      is_enabled: acc.is_enabled,
      category_label: cls.label,
      is_cash_equivalent: isCash,
      has_children: parentIds.has(acc.id),
      own: stored.has(acc.id),
      ...codes,
    })
  }
  return rows
}

function normalizeCode(v: unknown): string | null {
  const s = v === undefined || v === null ? '' : String(v).trim()
  return s ? s : null
}

/** 校验编码存在且种类对得上；净利润行 F01 不能被选 */
export function validateMapCodes(db: Database, accountSetId: string, codes: CashFlowMapCodes): string | null {
  const items = loadCashFlowItemsLite(db, accountSetId)
  const byCode = new Map(items.map(i => [i.code, i]))
  const check = (code: string | null, kind: 'main' | 'supplement', label: string) => {
    if (!code) return null
    const item = byCode.get(code)
    if (!item) return `${label}「${code}」不存在或已停用`
    if ((item.kind === 'supplement') !== (kind === 'supplement')) return `${label}「${item.name}」不是${kind === 'main' ? '主表' : '附表'}项目`
    if (code === SUPPLEMENT_NET_PROFIT_CODE) return '「净利润」由系统计算，不能指定给科目'
    return null
  }
  return (
    check(codes.main_credit_code, 'main', '主表贷方项目') ||
    check(codes.main_debit_code, 'main', '主表借方项目') ||
    check(codes.supp_credit_code, 'supplement', '附表贷方项目') ||
    check(codes.supp_debit_code, 'supplement', '附表借方项目')
  )
}

/** 改一个科目的映射；applyToChildren 时所有下级一并改成同样的设置 */
export function updateCashFlowMapRow(
  db: Database,
  accountSetId: string,
  accountId: string,
  patch: Partial<CashFlowMapCodes>,
  applyToChildren = false
): { updated: number; error?: string } {
  const accounts = loadCashFlowAccounts(db, accountSetId)
  const target = accounts.find(a => a.id === accountId)
  if (!target) return { updated: 0, error: '科目不存在' }
  const cashIds = computeCashEquivalentIds(accounts)
  if (cashIds.has(accountId)) {
    return { updated: 0, error: '现金及现金等价物科目不需要设置现金流量项目' }
  }

  const current = getEffectiveCashFlowMapping(db, accountSetId).codes.get(accountId) || EMPTY_CODES
  const next: CashFlowMapCodes = { ...current }
  for (const key of ['main_credit_code', 'main_debit_code', 'supp_credit_code', 'supp_debit_code'] as const) {
    if (key in patch) next[key] = normalizeCode(patch[key])
  }
  const err = validateMapCodes(db, accountSetId, next)
  if (err) return { updated: 0, error: err }

  const ids = [accountId]
  if (applyToChildren) {
    const childrenOf = new Map<string, string[]>()
    for (const a of accounts) {
      if (!a.parent_id) continue
      const list = childrenOf.get(a.parent_id) || []
      list.push(a.id)
      childrenOf.set(a.parent_id, list)
    }
    const stack = [...(childrenOf.get(accountId) || [])]
    while (stack.length) {
      const id = stack.pop()!
      ids.push(id)
      stack.push(...(childrenOf.get(id) || []))
    }
  }

  let updated = 0
  db.transaction(() => {
    // 首次编辑前账套没有任何行：先把默认值落库，避免其他科目从「临时推算」变成「未设置」
    ensureCashFlowMappingSeeded(db, accountSetId)
    const upsert = db.prepare(UPSERT_SQL)
    for (const id of ids) {
      if (cashIds.has(id)) continue
      upsert.run(uuidv4(), accountSetId, id, next.main_credit_code, next.main_debit_code, next.supp_credit_code, next.supp_debit_code)
      updated++
    }
  })()
  bumpCashFlowMapEpoch()
  return { updated }
}

/**
 * 复制到其他账套：按「科目编码」对应科目；项目先按编码、再按名称对应目标账套的项目。
 * 目标账套缺的科目 / 项目跳过并计数。
 */
export function copyCashFlowMappingToAccountSets(
  db: Database,
  sourceAccountSetId: string,
  targetAccountSetIds: string[]
): Array<{ accountSetId: string; copied: number; skippedAccounts: number; skippedItems: number }> {
  ensureCashFlowMappingSeeded(db, sourceAccountSetId)
  const src = getEffectiveCashFlowMapping(db, sourceAccountSetId)
  const srcItemByCode = new Map(src.items.map(i => [i.code, i]))
  const results: Array<{ accountSetId: string; copied: number; skippedAccounts: number; skippedItems: number }> = []

  for (const targetId of targetAccountSetIds) {
    if (!targetId || targetId === sourceAccountSetId) continue
    let copied = 0
    let skippedAccounts = 0
    let skippedItems = 0
    db.transaction(() => {
      const targetProfile = resolveCashFlowProfile(db, targetId)
      ensureMainItems(db, targetId, targetProfile)
      ensureSupplementItems(db, targetId, targetProfile)
      const targetAccounts = loadCashFlowAccounts(db, targetId)
      const targetByCode = new Map(targetAccounts.map(a => [a.code, a]))
      const targetCash = computeCashEquivalentIds(targetAccounts)
      const targetItems = loadCashFlowItemsLite(db, targetId)
      const targetCodes = new Set(targetItems.map(i => i.code))
      const targetByName = new Map(targetItems.map(i => [normalizeName(i.name), i.code]))
      const mapItem = (code: string | null): string | null => {
        if (!code) return null
        const srcItem = srcItemByCode.get(code)
        if (targetCodes.has(code) && (!srcItem || normalizeName(srcItem.name) === normalizeName(targetItems.find(i => i.code === code)!.name))) {
          return code
        }
        const byName = srcItem ? targetByName.get(normalizeName(srcItem.name)) : undefined
        if (byName) return byName
        if (targetCodes.has(code)) return code
        skippedItems++
        return null
      }
      const upsert = db.prepare(UPSERT_SQL)
      for (const acc of src.accounts) {
        const codes = src.codes.get(acc.id)
        if (!codes) continue
        const target = targetByCode.get(acc.code)
        if (!target || targetCash.has(target.id)) {
          skippedAccounts++
          continue
        }
        upsert.run(
          uuidv4(),
          targetId,
          target.id,
          mapItem(codes.main_credit_code),
          mapItem(codes.main_debit_code),
          targetProfile.hasSupplement ? mapItem(codes.supp_credit_code) : null,
          targetProfile.hasSupplement ? mapItem(codes.supp_debit_code) : null
        )
        copied++
      }
    })()
    results.push({ accountSetId: targetId, copied, skippedAccounts, skippedItems })
  }
  bumpCashFlowMapEpoch()
  return results
}

function normalizeName(name: string): string {
  return String(name || '').replace(/[\s、，,（）()“”"'：:－\-]/g, '')
}

export const CASH_FLOW_ACCOUNT_TABS: Array<{ key: AccountTab; label: string }> = [
  { key: 'asset', label: '资产' },
  { key: 'liability', label: '负债' },
  { key: 'common', label: '共同' },
  { key: 'equity', label: '权益' },
  { key: 'cost', label: '成本' },
  { key: 'pl', label: '损益' },
]
