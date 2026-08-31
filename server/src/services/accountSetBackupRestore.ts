import Database from 'better-sqlite3'
import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { basename, join } from 'path'
import { v4 as uuidv4 } from 'uuid'
import { getDb, ensureAccountSetSecurityBootstrap } from '../db/index.js'
import {
  allocateAccountSetCode,
  resolveAccountSetStartDate,
  syncAccountSetStartDate,
} from './accountSetDefaults.js'
import { cleanupAccountSetCascade } from './accountSetCleanup.js'

export type BackupScopeType = 'full' | 'single_account_set'

export type BackupScope = {
  type: BackupScopeType
  accountSetCount: number
  sourceAccountSetId?: string
  sourceAccountSetName?: string
}

export type AccountSetRestoreStats = {
  accounts: number
  vouchers: number
  voucherEntries: number
  initBalances: number
  auxCategories: number
  auxItems: number
  sourceAccountSetName: string | null
  users?: number
}

/** 期初/余额表 aux_item_id 为「类目编码:项目ID」，恢复时需重映射项目 ID */
export function remapAuxItemIdString(auxItemId: string, itemIdMap: Map<string, string>): string {
  if (!auxItemId) return ''
  return auxItemId
    .split('|')
    .map(part => {
      const sep = part.indexOf(':')
      if (sep <= 0) return part
      const code = part.slice(0, sep)
      const oldItemId = part.slice(sep + 1)
      const newItemId = itemIdMap.get(oldItemId) ?? oldItemId
      return `${code}:${newItemId}`
    })
    .join('|')
}

function auxItemIdValueTransform(itemIdMap: Map<string, string>) {
  return (value: unknown) =>
    typeof value === 'string' ? remapAuxItemIdString(value, itemIdMap) : value
}

/** 科目 aux_types 键为辅助类目 UUID，恢复后需映射到新类目 ID */
export function remapAccountAuxTypes(auxTypes: unknown, categoryIdMap: Map<string, string>): unknown {
  if (auxTypes == null || auxTypes === '') return auxTypes

  const remapObjectKeys = (obj: Record<string, unknown>): Record<string, unknown> => {
    const result: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(obj)) {
      const newKey = categoryIdMap.get(key) ?? key
      result[newKey] = value
    }
    return result
  }

  if (typeof auxTypes === 'string') {
    const trimmed = auxTypes.trim()
    if (!trimmed) return auxTypes
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed)
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          return JSON.stringify(remapObjectKeys(parsed as Record<string, unknown>))
        }
      } catch {
        return auxTypes
      }
    }
    return auxTypes
  }

  if (typeof auxTypes === 'object' && !Array.isArray(auxTypes)) {
    return remapObjectKeys(auxTypes as Record<string, unknown>)
  }

  return auxTypes
}

/** 凭证分录 aux_data：键可为类目 code 或 UUID，值.id 为辅助项目 ID */
export function remapVoucherAuxDataJson(
  auxData: unknown,
  categoryIdMap: Map<string, string>,
  categoryCodeByOldId: Map<string, string>,
  itemIdMap: Map<string, string>
): unknown {
  if (auxData == null || auxData === '') return auxData

  let obj: Record<string, unknown>
  if (typeof auxData === 'string') {
    const trimmed = auxData.trim()
    if (!trimmed || trimmed === '{}') return auxData
    try {
      obj = JSON.parse(trimmed) as Record<string, unknown>
    } catch {
      return auxData
    }
  } else if (typeof auxData === 'object' && !Array.isArray(auxData)) {
    obj = auxData as Record<string, unknown>
  } else {
    return auxData
  }

  const result: Record<string, unknown> = {}
  for (const [key, rawVal] of Object.entries(obj)) {
    if (!rawVal || typeof rawVal !== 'object' || Array.isArray(rawVal)) {
      result[key] = rawVal
      continue
    }
    const entry = { ...(rawVal as Record<string, unknown>) }
    if (typeof entry.id === 'string' && entry.id) {
      entry.id = itemIdMap.get(entry.id) ?? entry.id
    }
    const newKey = categoryIdMap.get(key) ?? key
    result[newKey] = entry
    const code = categoryCodeByOldId.get(key)
    if (code && code !== newKey) {
      result[code] = entry
    }
  }

  return typeof auxData === 'string' ? JSON.stringify(result) : result
}

const VOUCHER_TEMPLATE_ENTRY_ID_FIELDS = [
  'account_id',
  'dept_id',
  'project_id',
  'supplier_id',
  'person_id',
  'func_class_id',
] as const

/** 凭证模板 entries_data JSON 内 ID 重映射 */
export function remapVoucherTemplateEntriesDataJson(
  entriesData: unknown,
  maps: {
    accountMap: Map<string, string>
    auxItemMap: Map<string, string>
    categoryIdMap: Map<string, string>
    categoryCodeByOldId: Map<string, string>
  }
): unknown {
  if (entriesData == null || entriesData === '') return entriesData

  let entries: unknown[]
  if (typeof entriesData === 'string') {
    try {
      entries = JSON.parse(entriesData) as unknown[]
    } catch {
      return entriesData
    }
  } else if (Array.isArray(entriesData)) {
    entries = entriesData
  } else {
    return entriesData
  }

  const remapped = entries.map(entry => {
    if (!entry || typeof entry !== 'object') return entry
    const row = { ...(entry as Record<string, unknown>) }
    for (const field of VOUCHER_TEMPLATE_ENTRY_ID_FIELDS) {
      const oldId = row[field]
      if (typeof oldId === 'string' && oldId) {
        const map = field === 'account_id' ? maps.accountMap : maps.auxItemMap
        row[field] = map.get(oldId) ?? oldId
      }
    }
    if (row.aux_data != null) {
      row.aux_data = remapVoucherAuxDataJson(
        row.aux_data,
        maps.categoryIdMap,
        maps.categoryCodeByOldId,
        maps.auxItemMap
      )
    }
    return row
  })

  return typeof entriesData === 'string' ? JSON.stringify(remapped) : remapped
}

function syncAuxCategoryDefaultItems(params: {
  sourceDb: Database.Database
  targetDb: Database.Database
  sourceAccountSetId: string
  categoryIdMap: Map<string, string>
  itemIdMap: Map<string, string>
}) {
  const { sourceDb, targetDb, sourceAccountSetId, categoryIdMap, itemIdMap } = params
  if (!tableExists(sourceDb, 'aux_categories') || !tableExists(targetDb, 'aux_categories')) return

  const columns = getTableColumns(targetDb, 'aux_categories')
  if (!columns.includes('default_item_id')) return

  const rows = sourceDb
    .prepare('SELECT id, default_item_id FROM aux_categories WHERE account_set_id = ?')
    .all(sourceAccountSetId) as Array<{ id: string; default_item_id: string | null }>

  const update = targetDb.prepare('UPDATE aux_categories SET default_item_id = ? WHERE id = ?')
  for (const row of rows) {
    const newCategoryId = categoryIdMap.get(row.id)
    if (!newCategoryId) continue
    const newDefault = row.default_item_id ? itemIdMap.get(row.default_item_id) ?? null : null
    update.run(newDefault, newCategoryId)
  }
}

const BUSINESS_CLEAR_TABLES = [
  'voucher_attachments',
  'auto_transfer_runs',
  'voucher_entries',
  'vouchers',
  'account_balances',
  'period_closing',
  'budget_surplus_adjustments',
  'init_balances',
  'transfer_items',
  'transfer_types',
  'report_templates',
  'print_templates',
  'voucher_templates',
  'cash_flow_items',
  'aux_items',
  'aux_categories',
  'voucher_types',
  'accounts',
  'role_account_scopes',
  'user_account_scopes',
]

function deleteByAccountSetId(db: Database.Database, table: string, accountSetId: string) {
  if (!tableExists(db, table)) return
  const columns = getTableColumns(db, table)
  if (!columns.includes('account_set_id')) return
  db.prepare(`DELETE FROM ${table} WHERE account_set_id = ?`).run(accountSetId)
}

function tableExists(db: Database.Database, table: string): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
    .get(table) as { name?: string } | undefined
  return !!row?.name
}

function getTableColumns(db: Database.Database, table: string): string[] {
  if (!tableExists(db, table)) return []
  return (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(
    column => column.name
  )
}

/** 判断备份文件是全库备份还是单账套备份 */
export function detectBackupScope(sourcePath: string): BackupScope {
  const backupDb = new Database(sourcePath, { readonly: true })
  try {
    if (!tableExists(backupDb, 'account_sets')) {
      throw new Error('备份文件缺少 account_sets 表')
    }

    const accountSets = backupDb.prepare('SELECT id, name FROM account_sets ORDER BY created_at').all() as Array<{
      id: string
      name: string
    }>
    const hasBackupsTable = tableExists(backupDb, 'backups')
    const hasLicenseTable = tableExists(backupDb, 'license_activation')

    if (accountSets.length === 0) {
      throw new Error('备份文件中没有账套数据')
    }

    const isSingleAccountSetBackup =
      accountSets.length === 1 && !hasBackupsTable && !hasLicenseTable

    if (isSingleAccountSetBackup) {
      return {
        type: 'single_account_set',
        accountSetCount: 1,
        sourceAccountSetId: accountSets[0].id,
        sourceAccountSetName: accountSets[0].name,
      }
    }

    return {
      type: 'full',
      accountSetCount: accountSets.length,
      sourceAccountSetId: accountSets[0]?.id,
      sourceAccountSetName: accountSets[0]?.name,
    }
  } finally {
    backupDb.close()
  }
}

function clearAccountSetReportDefinitions(db: Database.Database, accountSetId: string) {
  if (!tableExists(db, 'report_definitions')) return

  if (tableExists(db, 'report_cells') && tableExists(db, 'report_sheets')) {
    db.prepare(
      `DELETE FROM report_cells WHERE report_sheet_id IN (
        SELECT id FROM report_sheets WHERE report_definition_id IN (
          SELECT id FROM report_definitions WHERE account_set_id = ?
        )
      )`
    ).run(accountSetId)
  }
  if (tableExists(db, 'report_template_sources')) {
    db.prepare(
      `DELETE FROM report_template_sources WHERE report_definition_id IN (
        SELECT id FROM report_definitions WHERE account_set_id = ?
      )`
    ).run(accountSetId)
  }
  if (tableExists(db, 'report_sheets')) {
    db.prepare(
      `DELETE FROM report_sheets WHERE report_definition_id IN (
        SELECT id FROM report_definitions WHERE account_set_id = ?
      )`
    ).run(accountSetId)
  }
  db.prepare('DELETE FROM report_definitions WHERE account_set_id = ?').run(accountSetId)
  deleteByAccountSetId(db, 'report_formula_functions', accountSetId)
}

function clearAccountSetBusinessData(db: Database.Database, accountSetId: string) {
  const run = db.transaction(() => {
    for (const table of BUSINESS_CLEAR_TABLES) {
      deleteByAccountSetId(db, table, accountSetId)
    }

    if (tableExists(db, 'report_template_items') && tableExists(db, 'report_templates')) {
      db.prepare(
        'DELETE FROM report_template_items WHERE template_id IN (SELECT id FROM report_templates WHERE account_set_id = ?)'
      ).run(accountSetId)
    }

    clearAccountSetReportDefinitions(db, accountSetId)

    if (tableExists(db, 'aux_category_fields') && tableExists(db, 'aux_categories')) {
      db.prepare(
        'DELETE FROM aux_category_fields WHERE category_id IN (SELECT id FROM aux_categories WHERE account_set_id = ?)'
      ).run(accountSetId)
    }

    deleteByAccountSetId(db, 'ai_config', accountSetId)

    if (tableExists(db, 'system_params')) {
      db.prepare(
        "DELETE FROM system_params WHERE account_set_id = ? AND param_key NOT LIKE 'backup:%'"
      ).run(accountSetId)
    }
  })
  run()
}

function buildCategoryCodeByOldId(
  sourceDb: Database.Database,
  sourceAccountSetId: string
): Map<string, string> {
  if (!tableExists(sourceDb, 'aux_categories')) return new Map()
  const rows = sourceDb
    .prepare('SELECT id, code FROM aux_categories WHERE account_set_id = ?')
    .all(sourceAccountSetId) as Array<{ id: string; code: string }>
  return new Map(rows.map(row => [row.id, row.code]))
}

function buildRoleIdMap(
  sourceDb: Database.Database,
  targetDb: Database.Database,
  sourceAccountSetId: string,
  targetAccountSetId: string
): Map<string, string> {
  if (!tableExists(sourceDb, 'roles') || !tableExists(targetDb, 'roles')) return new Map()

  const targetByCode = new Map(
    (
      targetDb
        .prepare('SELECT id, code FROM roles WHERE account_set_id = ?')
        .all(targetAccountSetId) as Array<{ id: string; code: string }>
    ).map(row => [row.code, row.id])
  )

  const map = new Map<string, string>()
  for (const row of sourceDb
    .prepare('SELECT id, code FROM roles WHERE account_set_id = ?')
    .all(sourceAccountSetId) as Array<{ id: string; code: string }>) {
    const newId = targetByCode.get(row.code)
    if (newId) map.set(row.id, newId)
  }
  return map
}

function userIdMapToStringMap(userIdMap: Map<string, string | null>): Map<string, string> {
  const map = new Map<string, string>()
  for (const [oldId, newId] of userIdMap) {
    if (newId) map.set(oldId, newId)
  }
  return map
}

function importAccountScopesFromBackup(params: {
  sourceDb: Database.Database
  targetDb: Database.Database
  sourceAccountSetId: string
  targetAccountSetId: string
  roleMap: Map<string, string>
  userIdMap: Map<string, string | null>
  accountMap: Map<string, string>
}) {
  const { sourceDb, targetDb, sourceAccountSetId, targetAccountSetId, roleMap, userIdMap, accountMap } =
    params
  const userMap = userIdMapToStringMap(userIdMap)

  if (tableExists(targetDb, 'role_account_scopes')) {
    insertMappedRows({
      sourceDb,
      targetDb,
      table: 'role_account_scopes',
      sourceAccountSetId,
      targetAccountSetId,
      idMap: new Map<string, string>(),
      foreignKeyMaps: { role_id: roleMap, account_id: accountMap },
    })
  }

  if (tableExists(targetDb, 'user_account_scopes')) {
    insertMappedRows({
      sourceDb,
      targetDb,
      table: 'user_account_scopes',
      sourceAccountSetId,
      targetAccountSetId,
      idMap: new Map<string, string>(),
      foreignKeyMaps: { user_id: userMap, account_id: accountMap },
    })
  }
}

function restoreReportDefinitionTables(params: {
  sourceDb: Database.Database
  targetDb: Database.Database
  sourceAccountSetId: string
  targetAccountSetId: string
}): number {
  const { sourceDb, targetDb, sourceAccountSetId, targetAccountSetId } = params
  if (!tableExists(sourceDb, 'report_definitions') || !tableExists(targetDb, 'report_definitions')) {
    return 0
  }

  const reportDefMap = new Map<string, string>()
  const sheetMap = new Map<string, string>()

  const defCount = insertMappedRows({
    sourceDb,
    targetDb,
    table: 'report_definitions',
    sourceAccountSetId,
    targetAccountSetId,
    idMap: reportDefMap,
  })

  if (defCount === 0) return 0

  if (tableExists(sourceDb, 'report_sheets') && tableExists(targetDb, 'report_sheets')) {
    insertMappedRows({
      sourceDb,
      targetDb,
      table: 'report_sheets',
      sourceAccountSetId,
      targetAccountSetId,
      idMap: sheetMap,
      foreignKeyMaps: { report_definition_id: reportDefMap },
      customQuery: `SELECT rs.* FROM report_sheets rs
        INNER JOIN report_definitions rd ON rs.report_definition_id = rd.id
        WHERE rd.account_set_id = ? ORDER BY rs.sheet_index`,
      customParams: [sourceAccountSetId],
    })
  }

  if (
    tableExists(sourceDb, 'report_cells') &&
    tableExists(targetDb, 'report_cells') &&
    sheetMap.size > 0
  ) {
    insertMappedRows({
      sourceDb,
      targetDb,
      table: 'report_cells',
      sourceAccountSetId,
      targetAccountSetId,
      idMap: new Map<string, string>(),
      foreignKeyMaps: { report_sheet_id: sheetMap },
      customQuery: `SELECT rc.* FROM report_cells rc
        INNER JOIN report_sheets rs ON rc.report_sheet_id = rs.id
        INNER JOIN report_definitions rd ON rs.report_definition_id = rd.id
        WHERE rd.account_set_id = ?`,
      customParams: [sourceAccountSetId],
    })
  }

  if (tableExists(sourceDb, 'report_template_sources') && tableExists(targetDb, 'report_template_sources')) {
    insertMappedRows({
      sourceDb,
      targetDb,
      table: 'report_template_sources',
      sourceAccountSetId,
      targetAccountSetId,
      idMap: new Map<string, string>(),
      foreignKeyMaps: { report_definition_id: reportDefMap },
      customQuery: `SELECT rts.* FROM report_template_sources rts
        INNER JOIN report_definitions rd ON rts.report_definition_id = rd.id
        WHERE rd.account_set_id = ?`,
      customParams: [sourceAccountSetId],
    })
  }

  if (tableExists(sourceDb, 'report_formula_functions') && tableExists(targetDb, 'report_formula_functions')) {
    insertMappedRows({
      sourceDb,
      targetDb,
      table: 'report_formula_functions',
      sourceAccountSetId,
      targetAccountSetId,
      idMap: new Map<string, string>(),
    })
  }

  return defCount
}

/** 单账套备份库内嵌凭证附件二进制表（仅存在于备份文件） */
export const BACKUP_ATTACHMENT_TABLE = '_backup_attachment_files'

function safeAttachmentFilename(filename: unknown): string | null {
  if (typeof filename !== 'string' || !filename) return null
  const base = basename(filename)
  if (!base || base.includes('..')) return null
  return base
}

/** 从备份库内嵌附件表写回 uploads/attachments */
export function restoreAttachmentFilesFromBackup(sourceDb: Database.Database): number {
  if (!tableExists(sourceDb, BACKUP_ATTACHMENT_TABLE)) return 0

  const uploadDir = join(process.cwd(), 'uploads', 'attachments')
  if (!existsSync(uploadDir)) {
    mkdirSync(uploadDir, { recursive: true })
  }

  const rows = sourceDb
    .prepare(`SELECT filename, content FROM ${BACKUP_ATTACHMENT_TABLE}`)
    .all() as Array<{ filename: string; content: Buffer }>

  let written = 0
  for (const row of rows) {
    const safeName = safeAttachmentFilename(row.filename)
    if (!safeName || !row.content?.length) continue
    writeFileSync(join(uploadDir, safeName), row.content)
    written++
  }
  return written
}

function buildUserIdMap(
  sourceDb: Database.Database,
  targetDb: Database.Database,
  sourceAccountSetId: string,
  targetAccountSetId: string
): Map<string, string | null> {
  const map = new Map<string, string | null>()

  const targetUsers = targetDb
    .prepare('SELECT id, username FROM users WHERE account_set_id = ?')
    .all(targetAccountSetId) as Array<{ id: string; username: string }>
  const targetByUsername = new Map(targetUsers.map(user => [user.username, user.id]))

  const sourceUsers = sourceDb
    .prepare('SELECT id, username FROM users WHERE account_set_id = ?')
    .all(sourceAccountSetId) as Array<{ id: string; username: string }>

  for (const user of sourceUsers) {
    map.set(user.id, targetByUsername.get(user.username) || null)
  }

  return map
}

function remapValue(value: unknown, idMap?: Map<string, string>): unknown {
  if (value == null || !idMap) return value
  if (typeof value !== 'string') return value
  if (!value) return value
  return idMap.get(value) ?? null
}

function insertMappedRows(params: {
  sourceDb: Database.Database
  targetDb: Database.Database
  table: string
  sourceAccountSetId: string
  targetAccountSetId: string
  idMap: Map<string, string>
  foreignKeyMaps?: Record<string, Map<string, string>>
  userIdMap?: Map<string, string | null>
  userColumns?: string[]
  selfParent?: boolean
  orderBy?: string
  customQuery?: string
  customParams?: unknown[]
  skipColumns?: string[]
  valueTransforms?: Record<string, (value: unknown) => unknown>
}) {
  const {
    sourceDb,
    targetDb,
    table,
    sourceAccountSetId,
    targetAccountSetId,
    idMap,
    foreignKeyMaps = {},
    userIdMap,
    userColumns = [],
    selfParent = false,
    orderBy,
    customQuery,
    customParams = [],
    skipColumns = [],
    valueTransforms = {},
  } = params

  if (!tableExists(sourceDb, table) || !tableExists(targetDb, table)) return 0

  const columns = getTableColumns(targetDb, table).filter(column => !skipColumns.includes(column))
  if (columns.length === 0) return 0

  const query =
    customQuery ||
    `SELECT * FROM ${table} WHERE account_set_id = ?${orderBy ? ` ORDER BY ${orderBy}` : ''}`
  const queryParams = customQuery ? customParams : [sourceAccountSetId]
  const rows = sourceDb.prepare(query).all(...queryParams) as Record<string, unknown>[]
  if (rows.length === 0) return 0

  const placeholders = columns.map(() => '?').join(', ')
  const insertStmt = targetDb.prepare(
    `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`
  )

  for (const row of rows) {
    const oldId = typeof row.id === 'string' ? row.id : null
    const values = columns.map(column => {
      if (column === 'account_set_id') return targetAccountSetId
      if (column === 'id') {
        const newId = uuidv4()
        if (oldId) idMap.set(oldId, newId)
        return newId
      }
      if (selfParent && column === 'parent_id') {
        return remapValue(row[column], idMap)
      }
      if (foreignKeyMaps[column]) {
        return remapValue(row[column], foreignKeyMaps[column])
      }
      if (userColumns.includes(column)) {
        const oldUserId = row[column]
        if (typeof oldUserId === 'string' && userIdMap?.has(oldUserId)) {
          return userIdMap.get(oldUserId)
        }
      }
      if (valueTransforms[column]) {
        return valueTransforms[column](row[column])
      }
      return row[column]
    })
    insertStmt.run(...values)
  }

  return rows.length
}

function importSecurityFromBackup(params: {
  sourceDb: Database.Database
  targetDb: Database.Database
  sourceAccountSetId: string
  targetAccountSetId: string
}): number {
  const { sourceDb, targetDb, sourceAccountSetId, targetAccountSetId } = params
  const roleMap = new Map<string, string>()
  const userMap = new Map<string, string>()

  targetDb.pragma('foreign_keys = OFF')
  try {
    insertMappedRows({
      sourceDb,
      targetDb,
      table: 'roles',
      sourceAccountSetId,
      targetAccountSetId,
      idMap: roleMap,
      skipColumns: ['owner_user_id'],
    })

    const userCount = insertMappedRows({
      sourceDb,
      targetDb,
      table: 'users',
      sourceAccountSetId,
      targetAccountSetId,
      idMap: userMap,
      foreignKeyMaps: { role_id: roleMap },
    })

    insertMappedRows({
      sourceDb,
      targetDb,
      table: 'user_roles',
      sourceAccountSetId,
      targetAccountSetId,
      idMap: new Map<string, string>(),
      foreignKeyMaps: { user_id: userMap, role_id: roleMap },
    })

    if (tableExists(targetDb, 'roles') && getTableColumns(targetDb, 'roles').includes('owner_user_id')) {
      const owners = sourceDb
        .prepare(
          'SELECT id, owner_user_id FROM roles WHERE account_set_id = ? AND owner_user_id IS NOT NULL'
        )
        .all(sourceAccountSetId) as Array<{ id: string; owner_user_id: string }>
      const updateOwner = targetDb.prepare('UPDATE roles SET owner_user_id = ? WHERE id = ?')
      for (const row of owners) {
        const newRoleId = roleMap.get(row.id)
        const newOwnerId = userMap.get(row.owner_user_id)
        if (newRoleId && newOwnerId) {
          updateOwner.run(newOwnerId, newRoleId)
        }
      }
    }

    return userCount
  } finally {
    targetDb.pragma('foreign_keys = ON')
  }
}

/**
 * 登录页：将单账套备份导入为新账套（含用户/角色与全部业务数据）
 */
export function importSingleAccountSetBackupAsNewAccountSet(params: {
  sourcePath: string
  name: string
  fiscalYear?: number
  startDate?: string
}): {
  accountSetId: string
  code: string
  fiscalYear: number
  startDate: string
  stats: AccountSetRestoreStats
} {
  const scope = detectBackupScope(params.sourcePath)
  if (scope.type !== 'single_account_set' || !scope.sourceAccountSetId) {
    if (scope.type === 'full') {
      throw new Error('完整备份请在登录后进入「数据安全 → 备份恢复」导入；登录页仅支持单账套备份文件')
    }
    throw new Error('该备份不是有效的单账套备份文件')
  }

  const targetDb = getDb()
  const sourceDb = new Database(params.sourcePath, { readonly: true })
  let newAccountSetId = ''

  try {
    const backupAccountSet = sourceDb
      .prepare('SELECT * FROM account_sets WHERE id = ?')
      .get(scope.sourceAccountSetId) as Record<string, unknown> | undefined
    if (!backupAccountSet) {
      throw new Error('备份文件中没有账套数据')
    }

    const fiscalYear =
      params.fiscalYear ||
      Number(backupAccountSet.fiscal_year) ||
      new Date().getFullYear()
    const startDate = resolveAccountSetStartDate(
      params.startDate || String(backupAccountSet.start_date || ''),
      fiscalYear
    )
    const code = allocateAccountSetCode(targetDb)
    newAccountSetId = uuidv4()

    targetDb
      .prepare(
        `INSERT INTO account_sets (id, name, code, fiscal_year, start_date, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'active', datetime('now'), datetime('now'))`
      )
      .run(newAccountSetId, params.name, code, fiscalYear, startDate)

    let importedUsers = importSecurityFromBackup({
      sourceDb,
      targetDb,
      sourceAccountSetId: scope.sourceAccountSetId,
      targetAccountSetId: newAccountSetId,
    })
    if (importedUsers === 0) {
      ensureAccountSetSecurityBootstrap(newAccountSetId)
      importedUsers = 1
    }

    sourceDb.close()

    const stats = restoreSingleAccountSetFromBackup({
      targetAccountSetId: newAccountSetId,
      sourcePath: params.sourcePath,
    })
    stats.users = importedUsers

    syncAccountSetStartDate(targetDb, newAccountSetId, startDate)

    return {
      accountSetId: newAccountSetId,
      code,
      fiscalYear,
      startDate,
      stats,
    }
  } catch (error) {
    if (newAccountSetId) {
      try {
        cleanupAccountSetCascade(targetDb, newAccountSetId)
      } catch {
        /* ignore rollback errors */
      }
    }
    throw error
  } finally {
    try {
      sourceDb.close()
    } catch {
      /* ignore */
    }
  }
}

/**
 * 将单账套备份合并恢复到当前账套（不清除用户/角色，仅覆盖业务数据）
 */
export function restoreSingleAccountSetFromBackup(params: {
  targetAccountSetId: string
  sourcePath: string
  userId?: string
}): AccountSetRestoreStats {
  const { targetAccountSetId, sourcePath, userId } = params
  const scope = detectBackupScope(sourcePath)
  if (scope.type !== 'single_account_set' || !scope.sourceAccountSetId) {
    throw new Error('该备份不是单账套备份文件，请使用完整备份恢复')
  }

  const targetDb = getDb()
  const targetAccountSet = targetDb
    .prepare('SELECT id, name FROM account_sets WHERE id = ?')
    .get(targetAccountSetId) as { id: string; name: string } | undefined
  if (!targetAccountSet) {
    throw new Error('目标账套不存在')
  }

  const sourceDb = new Database(sourcePath, { readonly: true })
  const voucherTypeMap = new Map<string, string>()
  const accountMap = new Map<string, string>()
  const auxCategoryMap = new Map<string, string>()
  const auxItemMap = new Map<string, string>()
  const transferTypeMap = new Map<string, string>()
  const voucherMap = new Map<string, string>()
  const reportTemplateMap = new Map<string, string>()
  const userIdMap = buildUserIdMap(
    sourceDb,
    targetDb,
    scope.sourceAccountSetId,
    targetAccountSetId
  )
  const categoryCodeByOldId = buildCategoryCodeByOldId(sourceDb, scope.sourceAccountSetId)
  const roleMap = buildRoleIdMap(
    sourceDb,
    targetDb,
    scope.sourceAccountSetId,
    targetAccountSetId
  )

  let stats: AccountSetRestoreStats = {
    accounts: 0,
    vouchers: 0,
    voucherEntries: 0,
    initBalances: 0,
    auxCategories: 0,
    auxItems: 0,
    sourceAccountSetName: scope.sourceAccountSetName || null,
  }

  try {
    targetDb.pragma('foreign_keys = OFF')
    const run = targetDb.transaction(() => {
      clearAccountSetBusinessData(targetDb, targetAccountSetId)

      insertMappedRows({
        sourceDb,
        targetDb,
        table: 'voucher_types',
        sourceAccountSetId: scope.sourceAccountSetId!,
        targetAccountSetId,
        idMap: voucherTypeMap,
      })

      stats.auxCategories = insertMappedRows({
        sourceDb,
        targetDb,
        table: 'aux_categories',
        sourceAccountSetId: scope.sourceAccountSetId!,
        targetAccountSetId,
        idMap: auxCategoryMap,
        skipColumns: ['default_item_id'],
      })

      insertMappedRows({
        sourceDb,
        targetDb,
        table: 'aux_category_fields',
        sourceAccountSetId: scope.sourceAccountSetId!,
        targetAccountSetId,
        idMap: new Map<string, string>(),
        foreignKeyMaps: { category_id: auxCategoryMap },
        customQuery:
          'SELECT acf.* FROM aux_category_fields acf INNER JOIN aux_categories ac ON acf.category_id = ac.id WHERE ac.account_set_id = ?',
        customParams: [scope.sourceAccountSetId],
      })

      stats.auxItems = insertMappedRows({
        sourceDb,
        targetDb,
        table: 'aux_items',
        sourceAccountSetId: scope.sourceAccountSetId!,
        targetAccountSetId,
        idMap: auxItemMap,
        foreignKeyMaps: { type: auxCategoryMap },
      })

      syncAuxCategoryDefaultItems({
        sourceDb,
        targetDb,
        sourceAccountSetId: scope.sourceAccountSetId!,
        categoryIdMap: auxCategoryMap,
        itemIdMap: auxItemMap,
      })

      const auxTypesTransform = (value: unknown) => remapAccountAuxTypes(value, auxCategoryMap)
      stats.accounts = insertMappedRows({
        sourceDb,
        targetDb,
        table: 'accounts',
        sourceAccountSetId: scope.sourceAccountSetId!,
        targetAccountSetId,
        idMap: accountMap,
        selfParent: true,
        orderBy: 'level, code',
        valueTransforms: { aux_types: auxTypesTransform },
      })

      const auxItemIdTransform = auxItemIdValueTransform(auxItemMap)
      const auxDataTransform = (value: unknown) =>
        remapVoucherAuxDataJson(value, auxCategoryMap, categoryCodeByOldId, auxItemMap)
      const templateEntriesTransform = (value: unknown) =>
        remapVoucherTemplateEntriesDataJson(value, {
          accountMap,
          auxItemMap,
          categoryIdMap: auxCategoryMap,
          categoryCodeByOldId,
        })

      stats.initBalances = insertMappedRows({
        sourceDb,
        targetDb,
        table: 'init_balances',
        sourceAccountSetId: scope.sourceAccountSetId!,
        targetAccountSetId,
        idMap: new Map<string, string>(),
        foreignKeyMaps: { account_id: accountMap },
        valueTransforms: { aux_item_id: auxItemIdTransform },
      })

      insertMappedRows({
        sourceDb,
        targetDb,
        table: 'transfer_types',
        sourceAccountSetId: scope.sourceAccountSetId!,
        targetAccountSetId,
        idMap: transferTypeMap,
      })

      stats.vouchers = insertMappedRows({
        sourceDb,
        targetDb,
        table: 'vouchers',
        sourceAccountSetId: scope.sourceAccountSetId!,
        targetAccountSetId,
        idMap: voucherMap,
        foreignKeyMaps: { voucher_type_id: voucherTypeMap },
        userIdMap,
        userColumns: ['maker_id', 'auditor_id', 'poster_id'],
      })

      stats.voucherEntries = insertMappedRows({
        sourceDb,
        targetDb,
        table: 'voucher_entries',
        sourceAccountSetId: scope.sourceAccountSetId!,
        targetAccountSetId,
        idMap: new Map<string, string>(),
        foreignKeyMaps: {
          voucher_id: voucherMap,
          account_id: accountMap,
          dept_id: auxItemMap,
          project_id: auxItemMap,
          supplier_id: auxItemMap,
          person_id: auxItemMap,
          func_class_id: auxItemMap,
        },
        valueTransforms: { aux_data: auxDataTransform },
      })

      insertMappedRows({
        sourceDb,
        targetDb,
        table: 'transfer_items',
        sourceAccountSetId: scope.sourceAccountSetId!,
        targetAccountSetId,
        idMap: new Map<string, string>(),
      })

      insertMappedRows({
        sourceDb,
        targetDb,
        table: 'report_templates',
        sourceAccountSetId: scope.sourceAccountSetId!,
        targetAccountSetId,
        idMap: reportTemplateMap,
      })

      insertMappedRows({
        sourceDb,
        targetDb,
        table: 'report_template_items',
        sourceAccountSetId: scope.sourceAccountSetId!,
        targetAccountSetId,
        idMap: new Map<string, string>(),
        foreignKeyMaps: { template_id: reportTemplateMap },
        customQuery:
          'SELECT rti.* FROM report_template_items rti INNER JOIN report_templates rt ON rti.template_id = rt.id WHERE rt.account_set_id = ?',
        customParams: [scope.sourceAccountSetId],
      })

      insertMappedRows({
        sourceDb,
        targetDb,
        table: 'print_templates',
        sourceAccountSetId: scope.sourceAccountSetId!,
        targetAccountSetId,
        idMap: new Map<string, string>(),
      })

      insertMappedRows({
        sourceDb,
        targetDb,
        table: 'voucher_templates',
        sourceAccountSetId: scope.sourceAccountSetId!,
        targetAccountSetId,
        idMap: new Map<string, string>(),
        foreignKeyMaps: { voucher_type_id: voucherTypeMap },
        userIdMap,
        userColumns: ['created_by'],
        valueTransforms: { entries_data: templateEntriesTransform },
      })

      insertMappedRows({
        sourceDb,
        targetDb,
        table: 'voucher_attachments',
        sourceAccountSetId: scope.sourceAccountSetId!,
        targetAccountSetId,
        idMap: new Map<string, string>(),
        foreignKeyMaps: { voucher_id: voucherMap },
        userIdMap,
        userColumns: ['created_by'],
      })

      insertMappedRows({
        sourceDb,
        targetDb,
        table: 'account_balances',
        sourceAccountSetId: scope.sourceAccountSetId!,
        targetAccountSetId,
        idMap: new Map<string, string>(),
        foreignKeyMaps: { account_id: accountMap },
        valueTransforms: { aux_item_id: auxItemIdTransform },
      })

      insertMappedRows({
        sourceDb,
        targetDb,
        table: 'period_closing',
        sourceAccountSetId: scope.sourceAccountSetId!,
        targetAccountSetId,
        idMap: new Map<string, string>(),
      })

      insertMappedRows({
        sourceDb,
        targetDb,
        table: 'budget_surplus_adjustments',
        sourceAccountSetId: scope.sourceAccountSetId!,
        targetAccountSetId,
        idMap: new Map<string, string>(),
      })

      insertMappedRows({
        sourceDb,
        targetDb,
        table: 'cash_flow_items',
        sourceAccountSetId: scope.sourceAccountSetId!,
        targetAccountSetId,
        idMap: new Map<string, string>(),
      })

      insertMappedRows({
        sourceDb,
        targetDb,
        table: 'auto_transfer_runs',
        sourceAccountSetId: scope.sourceAccountSetId!,
        targetAccountSetId,
        idMap: new Map<string, string>(),
      })

      insertMappedRows({
        sourceDb,
        targetDb,
        table: 'system_params',
        sourceAccountSetId: scope.sourceAccountSetId!,
        targetAccountSetId,
        idMap: new Map<string, string>(),
        customQuery:
          "SELECT * FROM system_params WHERE account_set_id = ? AND param_key NOT LIKE 'backup:%'",
        customParams: [scope.sourceAccountSetId],
      })

      insertMappedRows({
        sourceDb,
        targetDb,
        table: 'ai_config',
        sourceAccountSetId: scope.sourceAccountSetId!,
        targetAccountSetId,
        idMap: new Map<string, string>(),
      })

      restoreReportDefinitionTables({
        sourceDb,
        targetDb,
        sourceAccountSetId: scope.sourceAccountSetId!,
        targetAccountSetId,
      })

      importAccountScopesFromBackup({
        sourceDb,
        targetDb,
        sourceAccountSetId: scope.sourceAccountSetId!,
        targetAccountSetId,
        roleMap,
        userIdMap,
        accountMap,
      })
    })

    run()
    restoreAttachmentFilesFromBackup(sourceDb)
  } finally {
    targetDb.pragma('foreign_keys = ON')
    sourceDb.close()
  }

  if (stats.accounts === 0 && stats.vouchers === 0) {
    throw new Error('备份文件中没有可恢复的业务数据')
  }

  return stats
}

export function formatAccountSetRestoreSummary(stats: AccountSetRestoreStats): string {
  const parts = [
    `科目 ${stats.accounts} 个`,
    `凭证 ${stats.vouchers} 张`,
    `分录 ${stats.voucherEntries} 条`,
  ]
  if (stats.auxCategories > 0 || stats.auxItems > 0) {
    parts.push(`辅助类目 ${stats.auxCategories} 个、辅助项目 ${stats.auxItems} 条`)
  }
  if (stats.initBalances > 0) {
    parts.push(`期初 ${stats.initBalances} 条`)
  }
  if (stats.sourceAccountSetName) {
    parts.unshift(`来源账套「${stats.sourceAccountSetName}」`)
  }
  return parts.join('，')
}
