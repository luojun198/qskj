/**
 * 供应链编号规则引擎：单据号（按单据类型独立）+ 主数据编码（客户/供应商/材料/成品独立）。
 *
 * 模板占位符：{YYYY}{YY}{MM}{DD}{CODE}{SEQ:n}。流水号按「{SEQ} 之前的前缀」分别累计，
 * 因此模板里带 {DD} 即按日重置、带 {MM} 按月、仅 {YYYY} 按年、都不带则连续编号。
 * 存储在 system_params（按账套隔离）：
 *   scm:doc_no_rules  JSON { [单据类型/编号键]: 模板 }
 *   scm:code_rules    JSON { customer|supplier|material|product|item:<物料属性键>: 模板 }
 *                     material=原辅材料(0)，同时是未单独设置属性的兜底；product=成品(9)；
 *                     item:<键> 为其他物料属性（半成品 6、自定义属性等）单独规则，缺省沿用 material
 * 未配置时回退旧全局规则 scm:doc_no_rule / 历史默认前缀，行为与改造前一致。
 */
import type Database from 'better-sqlite3'

export const DEFAULT_DOC_NO_TPL = '{YYYY}{MM}-{CODE}-{SEQ:3}'

/** 不在 scm_doc 里的辅助单号：键 → 名称 / 默认模板（与历史格式一致） */
export const AUX_NO_KEYS: Array<{ key: string; name: string; tpl: string }> = [
  { key: 'RT', name: '工艺路线', tpl: '{CODE}-{YYYY}{MM}-{SEQ:3}' },
  { key: 'WR', name: '生产报工', tpl: '{CODE}-{YYYY}{MM}-{SEQ:3}' },
  { key: 'IQC', name: '来料检验', tpl: '{CODE}-{YYYY}{MM}-{SEQ:3}' },
  { key: 'FQC', name: '成品检验', tpl: '{CODE}-{YYYY}{MM}-{SEQ:3}' },
  { key: 'IPQC', name: '过程检验', tpl: '{CODE}-{YYYY}{MM}-{SEQ:3}' },
  { key: 'PC', name: '生产计划变更', tpl: '{CODE}-{YYYY}{MM}-{SEQ:3}' },
  { key: 'POC', name: '采购订单变更', tpl: '{CODE}-{YYYY}{MM}-{SEQ:3}' },
  { key: 'SOC', name: '销售订单变更', tpl: '{CODE}-{YYYY}{MM}-{SEQ:3}' },
  { key: 'WC', name: '在制盘点', tpl: '{CODE}-{YYYY}{MM}-{SEQ:3}' },
  { key: 'HX', name: '核销单', tpl: '{CODE}-{YYYY}{MM}-{SEQ:3}' },
  { key: 'DZ', name: '对账单', tpl: '{CODE}-{YYYY}{MM}-{SEQ:3}' },
  { key: 'PP', name: '生产计划（工单）', tpl: '{YYYY}{MM}-{CODE}-{SEQ:3}' },
  { key: 'OUT', name: '委外计划（工单）', tpl: '{YYYY}{MM}-{CODE}-{SEQ:3}' },
  { key: 'BOM', name: 'BOM', tpl: '{CODE}{SEQ:4}' },
]

/** 编码模板里可用的业务字段（{F:key} 或 {F:key:n} 取前 n 位），按规则对象区分 */
export const NO_RULE_FIELDS: Record<'doc' | 'partner' | 'item', Array<{ key: string; label: string }>> = {
  doc: [
    { key: 'partner_code', label: '往来单位编码' },
    { key: 'warehouse_code', label: '仓库编码' },
    { key: 'dept_code', label: '部门编码' },
    { key: 'biz_person', label: '业务员' },
  ],
  partner: [],
  item: [
    { key: 'category_code', label: '物料大类' },
    { key: 'subcategory_code', label: '物料小类' },
    { key: 'item_type', label: '物料属性' },
  ],
}
const ALL_FIELD_KEYS = new Set(Object.values(NO_RULE_FIELDS).flat().map(f => f.key))
/** 渲染时用的业务字段取值；缺失 / 为空的字段该段输出为空 */
export type NoRuleCtx = Record<string, string | number | null | undefined>

export type CodeKind = 'customer' | 'supplier' | 'material' | 'product'
export interface CodeRule { prefix: string; sep: string; seqLen: number; withDate: boolean }

export const DEFAULT_CODE_RULES: Record<CodeKind, CodeRule> = {
  customer: { prefix: 'KH', sep: '', seqLen: 4, withDate: false },
  supplier: { prefix: 'GYS', sep: '', seqLen: 4, withDate: false },
  material: { prefix: 'WL', sep: '', seqLen: 4, withDate: false },
  product: { prefix: 'WL', sep: '', seqLen: 4, withDate: false },
}

function readParam(db: Database.Database, aid: string, key: string): string {
  const row = db.prepare('SELECT param_value FROM system_params WHERE account_set_id=? AND param_key=?').get(aid, key) as any
  return String(row?.param_value ?? '').trim()
}

function readJson(db: Database.Database, aid: string, key: string): Record<string, any> {
  const raw = readParam(db, aid, key)
  if (!raw) return {}
  try {
    const v = JSON.parse(raw)
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {}
  } catch {
    return {}
  }
}

/** 解析日期（YYYY-MM-DD 开头），缺省取当前 */
export function parseNoDate(date?: string | null): Date {
  return typeof date === 'string' && /^\d{4}-\d{2}-\d{2}/.test(date)
    ? new Date(`${date.slice(0, 10)}T00:00:00`)
    : new Date()
}

export interface RenderedTpl { text: string; token: string; width: number; prefix: string }

/** 渲染模板：替换日期/类型占位符，保留 {SEQ} 位置；模板缺 {SEQ} 时末尾补 -{SEQ:3} */
export function renderTpl(tpl: string, code: string, date?: string | null, ctx?: NoRuleCtx): RenderedTpl {
  const now = parseNoDate(date)
  let rule = String(tpl || '').trim() || DEFAULT_DOC_NO_TPL
  if (!/\{SEQ(:\d+)?\}/.test(rule)) rule += '-{SEQ:3}'
  const YYYY = String(now.getFullYear())
  const text = rule
    .replace(/\{YYYY\}/g, YYYY).replace(/\{YY\}/g, YYYY.slice(2))
    .replace(/\{MM\}/g, String(now.getMonth() + 1).padStart(2, '0'))
    .replace(/\{DD\}/g, String(now.getDate()).padStart(2, '0'))
    .replace(/\{CODE\}/g, code)
    .replace(/\{F:([a-z_]+)(?::(\d+))?\}/g, (_m, key: string, n?: string) => {
      const v = String(ctx?.[key] ?? '').trim()
      return n ? v.slice(0, Math.min(20, parseInt(n, 10))) : v
    })
  const m = text.match(/\{SEQ(?::(\d+))?\}/)!
  const width = Math.min(10, Math.max(1, m[1] ? parseInt(m[1], 10) : 3))
  return { text, token: m[0], width, prefix: text.slice(0, text.indexOf(m[0])) }
}

/** 在已有编号集合里取同前缀最大流水 +1 */
export function nextFromValues(r: RenderedTpl, values: Iterable<string>): string {
  let max = 0
  for (const v of values) {
    const s = String(v || '')
    if (!s.startsWith(r.prefix)) continue
    const m = s.slice(r.prefix.length).match(/^(\d+)/)
    if (m) max = Math.max(max, parseInt(m[1], 10))
  }
  return r.text.replace(r.token, String(max + 1).padStart(r.width, '0'))
}

/** 单据类型（或辅助键）当前生效的模板；辅助键未配置时返回 null（调用方走历史逻辑） */
export function getDocNoTpl(db: Database.Database, aid: string, key: string): string | null {
  const rules = readJson(db, aid, 'scm:doc_no_rules')
  const own = typeof rules[key] === 'string' ? rules[key].trim() : ''
  if (own) return own
  return null
}

/** 业务单据（scm_doc）模板：单据类型规则 → 旧全局规则 → 内置默认 */
export function resolveDocTpl(db: Database.Database, aid: string, docType: string): string {
  return getDocNoTpl(db, aid, docType) || readParam(db, aid, 'scm:doc_no_rule') || DEFAULT_DOC_NO_TPL
}

/** 辅助单号：已配置规则则按规则取号，未配置返回 null */
export function nextAuxNo(
  db: Database.Database, aid: string, key: string,
  table: string, col: string, date?: string | null,
): string | null {
  const tpl = getDocNoTpl(db, aid, key)
  if (!tpl) return null
  const r = renderTpl(tpl, key, date)
  const rows = db.prepare(`SELECT ${col} v FROM ${table} WHERE account_set_id=? AND ${col} LIKE ?`).all(aid, `${r.prefix}%`) as any[]
  return nextFromValues(r, rows.map(x => x.v))
}

export function codeRuleToTpl(rule: CodeRule): string {
  const sep = rule.sep || ''
  return `${rule.prefix}${sep}${rule.withDate ? `{YYYY}{MM}${sep}` : ''}{SEQ:${rule.seqLen}}`
}

/** 解析某类编码的模板：新结构为字符串模板；旧结构（prefix/sep/seqLen/withDate）自动转换 */
export function getCodeTpl(db: Database.Database, aid: string, kind: CodeKind): string {
  const saved = readJson(db, aid, 'scm:code_rules')[kind]
  if (typeof saved === 'string' && saved.trim()) return saved.trim()
  const d = DEFAULT_CODE_RULES[kind]
  if (saved && typeof saved === 'object') {
    const len = parseInt(saved.seqLen, 10)
    return codeRuleToTpl({
      prefix: typeof saved.prefix === 'string' ? saved.prefix : d.prefix,
      sep: typeof saved.sep === 'string' ? saved.sep : d.sep,
      seqLen: Number.isFinite(len) ? Math.min(10, Math.max(1, len)) : d.seqLen,
      withDate: !!saved.withDate,
    })
  }
  return codeRuleToTpl(d)
}

/** 物料编码模板：属性单独规则 item:<type> → 成品(9) 用 product → 其余沿用 material */
export function resolveItemCodeTpl(db: Database.Database, aid: string, itemType?: string | number | null): string {
  const t = String(itemType ?? '').trim()
  if (t) {
    const own = readJson(db, aid, 'scm:code_rules')[`item:${t}`]
    if (typeof own === 'string' && own.trim()) return own.trim()
  }
  return getCodeTpl(db, aid, t === '9' ? 'product' : 'material')
}

/** 物料编码：按物料属性对应规则取号 */
export function nextItemCode(
  db: Database.Database, aid: string, itemType?: string | number | null, ctx?: NoRuleCtx,
): string {
  return nextCodeByTpl(db, aid, resolveItemCodeTpl(db, aid, itemType), 'scm_item', ctx)
}

function nextCodeByTpl(
  db: Database.Database, aid: string, tpl: string, table: 'scm_partner' | 'scm_item', ctx?: NoRuleCtx,
): string {
  const r = renderTpl(tpl, '', undefined, ctx)
  const rows = db.prepare(`SELECT code FROM ${table} WHERE account_set_id=? AND code LIKE ?`).all(aid, `${r.prefix.replace(/[%_]/g, '')}%`) as any[]
  return nextFromValues(r, rows.map(x => x.code))
}

/** 主数据编码：按类别规则取号。table 内 code 列按 account_set_id 过滤 */
export function nextMasterCode(
  db: Database.Database, aid: string, kind: CodeKind, table: 'scm_partner' | 'scm_item', ctx?: NoRuleCtx,
): string {
  return nextCodeByTpl(db, aid, getCodeTpl(db, aid, kind), table, ctx)
}

/** 校验单个模板：占位符白名单、至多一个 {SEQ}、位宽 1~10、业务字段在白名单内 */
function validateTpl(label: string, tpl: string): string {
  if (!tpl) return ''
  if (tpl.length > 80) return `${label} 的规则过长`
  const left = tpl.replace(/\{(YYYY|YY|MM|DD|CODE|SEQ(:\d+)?|F:[a-z_]+(:\d+)?)\}/g, '')
  if (/[{}]/.test(left)) return `${label} 含未知占位符`
  if ((tpl.match(/\{SEQ(:\d+)?\}/g) || []).length > 1) return `${label} 只能有一个流水号`
  const seq = tpl.match(/\{SEQ:(\d+)\}/)
  if (seq && (+seq[1] < 1 || +seq[1] > 10)) return `${label} 的流水位数须为 1~10`
  for (const f of tpl.matchAll(/\{F:([a-z_]+)/g)) {
    if (!ALL_FIELD_KEYS.has(f[1])) return `${label} 含未知业务字段 ${f[1]}`
  }
  return ''
}

/** 校验保存的两个 JSON 参数，返回错误信息或空串 */
export function validateNoRuleParam(key: string, val: string): string {
  if (key !== 'scm:doc_no_rules' && key !== 'scm:code_rules') return ''
  if (!val) return ''
  let obj: any
  try { obj = JSON.parse(val) } catch { return '编号规则格式无效' }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return '编号规则格式无效'
  if (key === 'scm:doc_no_rules') {
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v !== 'string') return `单据类型 ${k} 的规则无效`
      const err = validateTpl(`单据类型 ${k}`, v.trim())
      if (err) return err
    }
    return ''
  }
  const FIXED_KINDS = ['customer', 'supplier', 'material', 'product']
  for (const [kind, r] of Object.entries(obj)) {
    if (!FIXED_KINDS.includes(kind)) {
      // 物料属性单独规则 item:<属性键>，只接受字符串模板；空串表示沿用材料规则
      if (!/^item:[0-9A-Za-z_]{1,20}$/.test(kind)) return `未知的编码规则 ${kind}`
      if (typeof r !== 'string') return `${kind} 编码规则无效`
      const err = validateTpl(`${kind} 编码规则`, r.trim())
      if (err) return err
      continue
    }
    if (r === undefined) continue
    if (typeof r === 'string') {
      const err = validateTpl(`${kind} 编码规则`, r.trim())
      if (err) return err
      continue
    }
    // 旧结构：prefix / sep / seqLen / withDate
    if (!r || typeof r !== 'object') return `${kind} 编码规则无效`
    if (!/^[A-Za-z0-9\-_]{0,10}$/.test(String(r.prefix ?? ''))) return '编码前缀仅支持字母、数字、-、_，最长 10 位'
    if (!/^[-_]?$/.test(String(r.sep ?? ''))) return '分隔符仅支持 - 或 _ 或留空'
    const n = Number(r.seqLen)
    if (!Number.isInteger(n) || n < 1 || n > 10) return '流水位数须为 1~10'
  }
  return ''
}
