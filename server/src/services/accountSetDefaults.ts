import { v4 as uuidv4 } from 'uuid'
import type Database from 'better-sqlite3'
import { ensureDefaultPrintTemplateForAccountSet } from './printTemplateDefaults.js'

const START_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export function isValidAccountSetStartDate(value?: string | null): boolean {
  return START_DATE_RE.test(String(value || '').trim())
}

/** 解析建账日期，无效时回退为 fiscalYear 年 1 月 1 日 */
export function resolveAccountSetStartDate(
  startDate?: string | null,
  fiscalYear?: number | null
): string {
  const trimmed = String(startDate || '').trim()
  if (START_DATE_RE.test(trimmed)) return trimmed
  const year =
    fiscalYear != null && Number.isFinite(Number(fiscalYear))
      ? Number(fiscalYear)
      : new Date().getFullYear()
  return `${year}-01-01`
}

function getTableColumns(db: Database.Database, table: string): Set<string> {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  return new Set(rows.map(row => row.name))
}

const DEFAULT_ACCOUNT_CODE_LENGTHS = [4, 2, 2, 2, 2, 2, 2, 2, 2, 2]
const ZT_ACCOUNT_SET_CODE_PATTERN = /^ZT(\d+)$/

/** 分配唯一账套编码：优先使用未占用的 preferred，否则取 ZT 序号最大值 +1，再不行用时间戳 */
export function allocateAccountSetCode(
  db: Database.Database,
  preferred?: string | null
): string {
  const trimmedPreferred = String(preferred || '').trim()
  if (trimmedPreferred) {
    const occupied = db
      .prepare('SELECT id FROM account_sets WHERE code = ?')
      .get(trimmedPreferred)
    if (!occupied) {
      return trimmedPreferred
    }
  }

  const rows = db
    .prepare(`SELECT code FROM account_sets WHERE code LIKE 'ZT%'`)
    .all() as Array<{ code: string }>

  let maxNum = 0
  for (const row of rows) {
    const match = ZT_ACCOUNT_SET_CODE_PATTERN.exec(String(row.code ?? ''))
    if (match) {
      maxNum = Math.max(maxNum, parseInt(match[1], 10))
    }
  }

  for (let n = maxNum + 1; n < maxNum + 10000; n++) {
    const candidate = `ZT${String(n).padStart(3, '0')}`
    const exists = db.prepare('SELECT id FROM account_sets WHERE code = ?').get(candidate)
    if (!exists) {
      return candidate
    }
  }

  return `AS${Date.now()}`
}

/** 规范化科目级数与各级编码长度（存储为 10 级数组） */
export function normalizeAccountCodeConfig(
  accountLevels?: number | string | null,
  accountCodeLengths?: number[] | null
): { accountLevels: number; accountCodeLengths: number[] } {
  const levels = Math.min(10, Math.max(1, parseInt(String(accountLevels ?? ''), 10) || 6))
  const source =
    Array.isArray(accountCodeLengths) && accountCodeLengths.length > 0
      ? accountCodeLengths
      : DEFAULT_ACCOUNT_CODE_LENGTHS
  const lengths = source.map(n => Math.min(9, Math.max(1, Number(n) || 2)))
  while (lengths.length < 10) lengths.push(2)
  return { accountLevels: levels, accountCodeLengths: lengths }
}

/** 写入账套的科目级数与编码长度系统参数 */
export function applyAccountCodeConfigToDb(
  db: Database.Database,
  accountSetId: string,
  accountLevels?: number | string | null,
  accountCodeLengths?: number[] | null
) {
  const config = normalizeAccountCodeConfig(accountLevels, accountCodeLengths)
  upsertAccountSetSystemParam(
    db,
    accountSetId,
    'account_levels',
    String(config.accountLevels),
    '科目级数'
  )
  upsertAccountSetSystemParam(
    db,
    accountSetId,
    'account_code_lengths',
    JSON.stringify(config.accountCodeLengths),
    '科目编码长度配置'
  )
  return config
}

export function upsertAccountSetSystemParam(
  db: Database.Database,
  accountSetId: string,
  paramKey: string,
  paramValue: string,
  description?: string
) {
  const cols = getTableColumns(db, 'system_params')
  const existing = db
    .prepare(
      `SELECT id FROM system_params WHERE account_set_id IS ? AND param_key = ? LIMIT 1`
    )
    .get(accountSetId, paramKey) as { id?: string } | undefined

  if (existing?.id) {
    const sets = ['param_value = ?']
    const params: unknown[] = [paramValue]
    if (description && cols.has('description')) {
      sets.push('description = ?')
      params.push(description)
    }
    if (cols.has('updated_at')) {
      sets.push(`updated_at = datetime('now')`)
    }
    params.push(existing.id)
    db.prepare(`UPDATE system_params SET ${sets.join(', ')} WHERE id = ?`).run(...params)
    return
  }

  const fields = ['id', 'account_set_id', 'param_key', 'param_value']
  const placeholders = ['?', '?', '?', '?']
  const params: unknown[] = [uuidv4(), accountSetId, paramKey, paramValue]
  if (description && cols.has('description')) {
    fields.push('description')
    placeholders.push('?')
    params.push(description)
  }
  if (cols.has('created_at')) {
    fields.push('created_at')
    placeholders.push(`datetime('now')`)
  }
  if (cols.has('updated_at')) {
    fields.push('updated_at')
    placeholders.push(`datetime('now')`)
  }
  db.prepare(
    `INSERT INTO system_params (${fields.join(', ')}) VALUES (${placeholders.join(', ')})`
  ).run(...params)
}

/** 同步账套表与 system_params 中的建账日期 */
export function syncAccountSetStartDate(
  db: Database.Database,
  accountSetId: string,
  startDate: string
): string {
  const normalized = resolveAccountSetStartDate(startDate)
  const accountSetCols = getTableColumns(db, 'account_sets')
  if (accountSetCols.has('updated_at')) {
    db.prepare(
      `UPDATE account_sets SET start_date = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(normalized, accountSetId)
  } else {
    db.prepare(`UPDATE account_sets SET start_date = ? WHERE id = ?`).run(normalized, accountSetId)
  }
  upsertAccountSetSystemParam(db, accountSetId, 'start_date', normalized, '建账日期')
  return normalized
}

/** 新建账套后写入默认系统参数（含建账日期） */
export function bootstrapNewAccountSetDefaults(
  db: Database.Database,
  accountSetId: string,
  options: {
    start_date?: string | null
    fiscal_year?: number | null
    unit_name?: string | null
  } = {}
): string {
  const startDate = syncAccountSetStartDate(
    db,
    accountSetId,
    resolveAccountSetStartDate(options.start_date, options.fiscal_year)
  )

  const defaultParams: Array<{ key: string; value: string }> = [
    { key: 'require_audit', value: 'false' },
    { key: 'direct_print', value: 'true' },
    { key: 'voucher_time_control', value: 'false' },
    { key: 'enable_cash_flow', value: 'false' },
    // 兼容旧键名
    { key: 'voucher_audit_required', value: 'false' },
    { key: 'voucher_direct_print', value: 'true' },
    { key: 'voucher_sequence_control', value: 'false' },
  ]

  if (options.unit_name?.trim()) {
    defaultParams.push({ key: 'unit_name', value: options.unit_name.trim() })
  }

  for (const param of defaultParams) {
    upsertAccountSetSystemParam(db, accountSetId, param.key, param.value)
  }

  ensureDefaultPrintTemplateForAccountSet(db, accountSetId)
  ensureDefaultAssetDicts(db, accountSetId)

  return startDate
}

/** 读取建账日期：账套表优先，其次 system_params，最后按会计年度推算 */
export function readAccountSetStartDate(
  db: Database.Database,
  accountSetId: string
): string {
  const accountSet = db
    .prepare('SELECT start_date, fiscal_year FROM account_sets WHERE id = ?')
    .get(accountSetId) as { start_date?: string; fiscal_year?: number } | undefined

  const fromTable = String(accountSet?.start_date || '').trim()
  if (isValidAccountSetStartDate(fromTable)) {
    upsertAccountSetSystemParam(db, accountSetId, 'start_date', fromTable, '建账日期')
    return fromTable
  }

  const param = db
    .prepare(
      `SELECT param_value FROM system_params WHERE account_set_id = ? AND param_key = 'start_date' LIMIT 1`
    )
    .get(accountSetId) as { param_value?: string } | undefined
  const fromParam = String(param?.param_value || '').trim()
  if (isValidAccountSetStartDate(fromParam)) {
    syncAccountSetStartDate(db, accountSetId, fromParam)
    return fromParam
  }

  const resolved = resolveAccountSetStartDate(null, accountSet?.fiscal_year)
  syncAccountSetStartDate(db, accountSetId, resolved)
  return resolved
}

/** 预设固定资产字典的基础默认值（资产状态、增减方式等） */
export function ensureDefaultAssetDicts(db: Database.Database, accountSetId: string, specificType?: string) {
  // 1. 预设资产状态
  if (!specificType || specificType === 'status') {
    const statusCount = (db.prepare('SELECT COUNT(*) as c FROM fixed_asset_status WHERE account_set_id=?').get(accountSetId) as any).c
    if (statusCount === 0) {
      const insStatus = db.prepare('INSERT INTO fixed_asset_status (id, account_set_id, code, name, depreciable) VALUES (?, ?, ?, ?, ?)')
      insStatus.run(uuidv4(), accountSetId, '01', '在用', 1)
      insStatus.run(uuidv4(), accountSetId, '02', '未使用', 0)
      insStatus.run(uuidv4(), accountSetId, '03', '不需用', 0)
      insStatus.run(uuidv4(), accountSetId, '04', '已报废', 0)
    }
  }

  // 2. 预设增减方式
  if (!specificType || specificType === 'change_type') {
    try {
      const ctCount = (db.prepare('SELECT COUNT(*) as c FROM fixed_asset_change_type WHERE account_set_id=?').get(accountSetId) as any).c
      if (ctCount === 0) {
        const insCT = db.prepare('INSERT INTO fixed_asset_change_type (id, account_set_id, code, name, direction) VALUES (?, ?, ?, ?, ?)')
        // 增加方式
        insCT.run(uuidv4(), accountSetId, '01', '直接购入', 'increase')
        insCT.run(uuidv4(), accountSetId, '02', '投资者投入', 'increase')
        insCT.run(uuidv4(), accountSetId, '03', '接受捐赠', 'increase')
        insCT.run(uuidv4(), accountSetId, '04', '盘盈', 'increase')
        // 减少方式
        insCT.run(uuidv4(), accountSetId, '11', '报废', 'decrease')
        insCT.run(uuidv4(), accountSetId, '12', '出售', 'decrease')
        insCT.run(uuidv4(), accountSetId, '13', '盘亏', 'decrease')
        insCT.run(uuidv4(), accountSetId, '14', '毁损', 'decrease')
      }
    } catch (e) {
      // 忽略表可能不存在的情况
    }
  }

  // 3. 预设资产类别
  if (!specificType || specificType === 'category') {
    const catCount = (db.prepare('SELECT COUNT(*) as c FROM fixed_asset_category WHERE account_set_id=?').get(accountSetId) as any).c
    if (catCount === 0) {
      const insCat = db.prepare('INSERT INTO fixed_asset_category (id, account_set_id, code, name, salvage_rate, account_code, depr_account_code, clearing_account_code) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      insCat.run(uuidv4(), accountSetId, '01', '房屋及建筑物', 5, '1601', '1602', '1606')
      insCat.run(uuidv4(), accountSetId, '02', '机器设备', 5, '1601', '1602', '1606')
      insCat.run(uuidv4(), accountSetId, '03', '运输工具', 5, '1601', '1602', '1606')
      insCat.run(uuidv4(), accountSetId, '04', '电子设备', 5, '1601', '1602', '1606')
      insCat.run(uuidv4(), accountSetId, '05', '办公家具', 5, '1601', '1602', '1606')
    }
  }

  // 4. 预设资产用途
  if (!specificType || specificType === 'purpose') {
    const purpCount = (db.prepare('SELECT COUNT(*) as c FROM fixed_asset_purpose WHERE account_set_id=?').get(accountSetId) as any).c
    if (purpCount === 0) {
      const insPurp = db.prepare('INSERT INTO fixed_asset_purpose (id, account_set_id, code, name, expense_account) VALUES (?, ?, ?, ?, ?)')
      insPurp.run(uuidv4(), accountSetId, '01', '管理用', '6602')
      insPurp.run(uuidv4(), accountSetId, '02', '经营用', '6601')
      insPurp.run(uuidv4(), accountSetId, '03', '生产用', '5001')
    }
  }
  // 5. 预设使用部门
  if (!specificType || specificType === 'dept') {
    const deptCount = (db.prepare('SELECT COUNT(*) as c FROM fixed_asset_dept WHERE account_set_id=?').get(accountSetId) as any).c
    if (deptCount === 0) {
      const insDept = db.prepare('INSERT INTO fixed_asset_dept (id, account_set_id, code, name) VALUES (?, ?, ?, ?)')
      insDept.run(uuidv4(), accountSetId, '01', '办公室')
      insDept.run(uuidv4(), accountSetId, '02', '财务部')
      insDept.run(uuidv4(), accountSetId, '03', '人事部')
      insDept.run(uuidv4(), accountSetId, '04', '销售部')
      insDept.run(uuidv4(), accountSetId, '05', '技术部')
      insDept.run(uuidv4(), accountSetId, '06', '生产部')
      insDept.run(uuidv4(), accountSetId, '07', '采购部')
    }
  }
}
