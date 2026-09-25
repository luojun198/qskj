/**
 * 银行对账单导入「映射方案」：命名保存工作表 / 表头行 / 金额模式 / 列映射，账套内所有银行科目共用，
 * 同一银行格式的流水可直接套用。存 system_params（param_key = cashier:bank_import_scheme:<id>），无需迁移。
 */
import type Database from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'
import { validateMapping, type AmountMode } from './bankStatementImport.js'

export interface BankImportScheme {
  id: string
  name: string
  sheet_name?: string
  header_row: number
  data_start_row: number
  amount_mode: AmountMode
  mapping: Record<string, number>
  direction_in_values: string[]
  header_labels: string[]
  updated_at: string
}

export const SCHEME_KEY_PREFIX = 'cashier:bank_import_scheme:'
const NAME_MAX = 40
const FIELDS = new Set([
  'biz_date', 'debit', 'credit', 'amount', 'direction',
  'summary', 'counter_name', 'counter_account', 'balance', 'bill_no', 'settle_type',
])

function toInt(v: unknown, fallback: number): number {
  const n = Number(v)
  return Number.isInteger(n) ? n : fallback
}

export function listImportSchemes(db: Database.Database, asid: string): BankImportScheme[] {
  const rows = db.prepare(
    'SELECT param_key, param_value, updated_at FROM system_params WHERE account_set_id=? AND param_key LIKE ?'
  ).all(asid, `${SCHEME_KEY_PREFIX}%`) as Array<{ param_key: string; param_value: string; updated_at: string }>
  const out: BankImportScheme[] = []
  for (const r of rows) {
    try {
      const v = JSON.parse(r.param_value)
      out.push({ ...v, id: r.param_key.slice(SCHEME_KEY_PREFIX.length), updated_at: r.updated_at })
    } catch { /* 损坏的记录跳过 */ }
  }
  return out.sort((a, b) => String(a.name).localeCompare(String(b.name), 'zh-CN'))
}

/** 新建或覆盖方案：带 id 按 id 覆盖；不带 id 时同名方案视为覆盖，否则新建。校验失败抛 Error（文案给用户看） */
export function saveImportScheme(db: Database.Database, asid: string, input: any): BankImportScheme {
  const name = String(input?.name ?? '').trim()
  if (!name) throw new Error('请填写方案名称')
  if (name.length > NAME_MAX) throw new Error(`方案名称不能超过 ${NAME_MAX} 个字`)
  const mode: AmountMode = input?.amount_mode === 'single' ? 'single' : 'dc'
  const mapping: Record<string, number> = {}
  for (const [k, v] of Object.entries(input?.mapping || {})) {
    const n = Number(v)
    if (FIELDS.has(k) && Number.isInteger(n) && n >= 0) mapping[k] = n
  }
  const err = validateMapping(mapping, mode)
  if (err) throw new Error(err)

  const existing = listImportSchemes(db, asid)
  let id = String(input?.id || '')
  if (id && !existing.some(s => s.id === id)) throw new Error('方案不存在或已被删除')
  if (!id) id = existing.find(s => s.name === name)?.id || uuidv4()
  if (existing.some(s => s.name === name && s.id !== id)) throw new Error(`已有同名方案「${name}」`)

  const headerRow = toInt(input?.header_row, -1)
  const value = {
    name,
    sheet_name: input?.sheet_name ? String(input.sheet_name) : undefined,
    header_row: headerRow,
    data_start_row: Math.max(0, toInt(input?.data_start_row, headerRow + 1)),
    amount_mode: mode,
    mapping,
    direction_in_values: (Array.isArray(input?.direction_in_values) ? input.direction_in_values : [])
      .map((v: unknown) => String(v).trim()).filter(Boolean),
    header_labels: (Array.isArray(input?.header_labels) ? input.header_labels : [])
      .slice(0, 500).map((v: unknown) => String(v ?? '').trim()),
  }
  db.prepare(`
    INSERT INTO system_params (id, account_set_id, param_key, param_value, description)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(account_set_id, param_key) DO UPDATE SET
      param_value=excluded.param_value, description=excluded.description, updated_at=datetime('now')
  `).run(uuidv4(), asid, SCHEME_KEY_PREFIX + id, JSON.stringify(value), `银行对账单导入映射方案: ${name}`)
  return listImportSchemes(db, asid).find(s => s.id === id)!
}

export function deleteImportScheme(db: Database.Database, asid: string, id: string): boolean {
  const r = db.prepare('DELETE FROM system_params WHERE account_set_id=? AND param_key=?').run(asid, SCHEME_KEY_PREFIX + id)
  return r.changes > 0
}
