/**
 * 进销存 ACD 导入：表读取层
 *
 * 润衡 .acd 备份自带 data_stru.txt（全部建表语句），这里据此把每张表的行转成「列名 → 值」对象，
 * 业务代码一律按列名取值，不依赖下标——不同版本的润衡列顺序可能不同。
 */
import { parseAcdEntries } from '../importAcdSupplyChain.js'

export type AcdRecord = Record<string, string>

export interface AcdTableSet {
  /** 表名（小写，不含 .txt）→ 列名数组 */
  columns: Map<string, string[]>
  /** 表名 → 按列名展开的行 */
  get(table: string): AcdRecord[]
  /** 原始行数（含无结构定义的表） */
  count(table: string): number
  has(table: string): boolean
}

/** 从 CREATE TABLE 语句解析列名（去掉主键 / 约束子句） */
export function parseCreateTable(sql: string): { table: string; columns: string[] } | null {
  const m = sql.match(/create\s+table\s+"?(\w+)"?\s*\(([\s\S]*)\)\s*$/i)
  if (!m) return null
  const body = m[2]
  const columns: string[] = []
  let depth = 0
  let cur = ''
  const parts: string[] = []
  for (const ch of body) {
    if (ch === '(') depth++
    if (ch === ')') depth--
    if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; continue }
    cur += ch
  }
  if (cur.trim()) parts.push(cur)
  for (const p of parts) {
    const t = p.trim()
    if (!t || /^primary\s+key/i.test(t) || /^unique/i.test(t) || /^foreign/i.test(t)) continue
    const name = t.match(/^"?(\w+)"?/)
    if (name) columns.push(name[1].toLowerCase())
  }
  return { table: m[1].toLowerCase(), columns }
}

export function buildAcdTableSet(raw: Map<string, string[][]>): AcdTableSet {
  const columns = new Map<string, string[]>()
  for (const row of raw.get('data_stru.txt') || []) {
    const sql = row.join('\t')
    const parsed = parseCreateTable(sql)
    if (parsed) columns.set(parsed.table, parsed.columns)
  }
  const cache = new Map<string, AcdRecord[]>()
  return {
    columns,
    has: (t) => raw.has(`${t}.txt`),
    count: (t) => raw.get(`${t}.txt`)?.length || 0,
    get(table: string) {
      const hit = cache.get(table)
      if (hit) return hit
      const cols = columns.get(table)
      const rows = raw.get(`${table}.txt`) || []
      const out = rows.map(r => {
        const rec: AcdRecord = {}
        if (cols) cols.forEach((c, i) => { rec[c] = String(r[i] ?? '').trim() })
        else r.forEach((v, i) => { rec[`c${i}`] = String(v ?? '').trim() })
        return rec
      })
      cache.set(table, out)
      return out
    },
  }
}

export function readAcdTables(buffer: Buffer): AcdTableSet {
  return buildAcdTableSet(parseAcdEntries(buffer))
}

/**
 * 润衡日期：`26.10.5` / `2026.10.5` / `2026-10-05` / `20261005` → `2026-10-05`；无法识别返回 null。
 * 两位年份按 2000 年后处理（润衡进销存 8.x 起的数据）。
 */
export function parseAcdDate(v: unknown): string | null {
  const s = String(v ?? '').trim()
  if (!s) return null
  const pad = (n: number) => String(n).padStart(2, '0')
  const compact = s.match(/^(\d{4})(\d{2})(\d{2})$/)
  if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`
  const m = s.match(/^(\d{2}|\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/)
  if (!m) return null
  const y = m[1].length === 2 ? 2000 + Number(m[1]) : Number(m[1])
  const mo = Number(m[2]); const d = Number(m[3])
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null
  return `${y}-${pad(mo)}-${pad(d)}`
}

export const acdNum = (v: unknown): number => {
  const n = parseFloat(String(v ?? '').trim())
  return Number.isFinite(n) ? n : 0
}

export const acdStr = (v: unknown): string | null => {
  const s = String(v ?? '').trim()
  return s || null
}

/** 判断是否为进销存（POS）备份：有单据 / 物料表；财务凭证表为空或不存在 */
export function detectScmAcd(t: AcdTableSet): { ok: boolean; reason?: string } {
  if (!t.has('cpda') || !t.has('pjnr1')) {
    return { ok: false, reason: '文件中没有进销存的物料 / 单据表，不是润衡进销存备份' }
  }
  if (t.count('pz') > 0) {
    return { ok: false, reason: '文件中含有财务凭证，属于财务账套备份，请在「账套管理」中用 ACD 导入账套' }
  }
  return { ok: true }
}

/** 系统参数（xt / xt_data）：单位名称、关联财务账套、版本号 */
export function readAcdMeta(t: AcdTableSet) {
  const kv = new Map<string, string>()
  for (const r of t.get('xt')) if (r.mc) kv.set(r.mc, r.nr || '')
  for (const r of t.get('xt_data')) if (r.mc) kv.set(r.mc, r.nr || '')
  return {
    company: kv.get('xt_dwmc') || '',
    linkedAccountSet: kv.get('zw_c_tz') || '',
    version: kv.get('bbh') || kv.get('gs_bbh') || '',
  }
}
