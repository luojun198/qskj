import type Database from 'better-sqlite3'
import { applyLegacySchemaEnsures, getDb } from './index.js'
import { repairDatabaseReferentialIntegrity } from '../services/databaseIntegrityRepair.js'
import { getCurrentVersion, runMigrations, repairStampedSchema } from './migrations.js'
import { migrations } from './migrationList.js'

/** 当前程序期望的数据库迁移版本 */
export const TARGET_DB_VERSION = migrations.reduce((max, item) => Math.max(max, item.version), 0)

/** 旧库兼容：必须存在的表与字段（随新版本扩展） */
export const COMPATIBILITY_REQUIREMENTS = {
  tables: [
    'account_sets',
    'users',
    'roles',
    'user_roles',
    'user_login_sessions',
    'vouchers',
    'voucher_entries',
    'accounts',
    'init_balances',
    'backups',
    'budget_surplus_adjustments',
    'aux_category_fields',
    'currencies',
    'exchange_rates',
  ],
  columns: {
    users: ['account_set_id', 'status', 'nickname', 'permission_mode', 'custom_permissions'],
    roles: ['account_set_id', 'is_personal', 'owner_user_id'],
    accounts: ['no_negative', 'is_foreign', 'currency_code', 'is_quantity', 'quantity_unit'],
    account_sets: ['import_source'],
    aux_categories: ['default_item_id'],
    aux_items: ['field_values'],
    init_balances: [
      'opening_debit',
      'opening_credit',
      'pre_book_debit',
      'pre_book_credit',
      'foreign_init_balance',
      'foreign_opening_debit',
      'foreign_opening_credit',
      'foreign_pre_book_debit',
      'foreign_pre_book_credit',
      'qty_init_balance',
      'qty_opening_debit',
      'qty_opening_credit',
      'qty_pre_book_debit',
      'qty_pre_book_credit',
    ],
    voucher_entries: [
      'currency_code',
      'exchange_rate',
      'foreign_amount',
      'quantity',
      'unit_price',
      'unit',
    ],
    account_balances: [
      'foreign_init_balance',
      'foreign_current_debit',
      'foreign_current_credit',
      'foreign_end_balance',
    ],
  },
} as const

export interface CompatibilityIssue {
  type: 'missing_table' | 'missing_column' | 'migration_behind'
  table?: string
  column?: string
  message: string
}

export interface CompatibilityReport {
  migrationVersion: number
  targetVersion: number
  isCompatible: boolean
  issues: CompatibilityIssue[]
}

export interface CompatibilityUpgradeResult {
  before: CompatibilityReport
  after: CompatibilityReport
  migrationVersionBefore: number
  migrationVersionAfter: number
  migrationsApplied: number
  /** 版本号已标记为已应用、但表其实缺失而被补建的迁移 */
  repairedMigrations: string[]
  fixedIssues: CompatibilityIssue[]
  schemaRepairsApplied: boolean
}

function tableExists(db: Database.Database, table: string) {
  return !!db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
    .get(table)
}

function getColumnNames(db: Database.Database, table: string) {
  if (!tableExists(db, table)) return new Set<string>()
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  return new Set(rows.map(row => row.name))
}

/** 比对当前库结构与程序期望，不做任何修改 */
export function inspectDatabaseCompatibility(db: Database.Database): CompatibilityReport {
  const migrationVersion = getCurrentVersion(db)
  const issues: CompatibilityIssue[] = []

  for (const table of COMPATIBILITY_REQUIREMENTS.tables) {
    if (!tableExists(db, table)) {
      issues.push({
        type: 'missing_table',
        table,
        message: `缺少数据表 ${table}`,
      })
    }
  }

  for (const [table, columns] of Object.entries(COMPATIBILITY_REQUIREMENTS.columns)) {
    const existing = getColumnNames(db, table)
    if (existing.size === 0) continue
    for (const column of columns) {
      if (!existing.has(column)) {
        issues.push({
          type: 'missing_column',
          table,
          column,
          message: `表 ${table} 缺少字段 ${column}`,
        })
      }
    }
  }

  if (migrationVersion < TARGET_DB_VERSION) {
    issues.push({
      type: 'migration_behind',
      message: `数据库迁移版本 ${migrationVersion} 低于程序要求 ${TARGET_DB_VERSION}`,
    })
  }

  return {
    migrationVersion,
    targetVersion: TARGET_DB_VERSION,
    isCompatible: issues.length === 0,
    issues,
  }
}

function diffFixedIssues(before: CompatibilityReport, after: CompatibilityReport): CompatibilityIssue[] {
  const afterKeys = new Set(
    after.issues.map(issue =>
      issue.type === 'missing_column'
        ? `column:${issue.table}.${issue.column}`
        : issue.type === 'missing_table'
          ? `table:${issue.table}`
          : `migration`
    )
  )

  return before.issues.filter(issue => {
    const key =
      issue.type === 'missing_column'
        ? `column:${issue.table}.${issue.column}`
        : issue.type === 'missing_table'
          ? `table:${issue.table}`
          : `migration`
    return !afterKeys.has(key)
  })
}

/**
 * 导入/恢复旧库后：先比对，再补齐 schema 与迁移，最后再比对。
 * 适用于服务启动与备份恢复场景。
 */
export function upgradeDatabaseCompatibility(
  database: Database.Database = getDb(),
  options?: { skipMigrations?: boolean }
): CompatibilityUpgradeResult {
  const before = inspectDatabaseCompatibility(database)
  const migrationVersionBefore = before.migrationVersion

  applyLegacySchemaEnsures(database)
  repairDatabaseReferentialIntegrity(database)

  let migrationVersionAfter = migrationVersionBefore
  let repairedMigrations: string[] = []
  if (!options?.skipMigrations) {
    runMigrations(migrations)
    migrationVersionAfter = getCurrentVersion(database)
    // 版本号可能已经是最新，但历史上迁移中途失败导致模块表并未真正建出来，
    // 此时 runMigrations 会把它们当作已应用而永久跳过，需要按实际表结构补建。
    repairedMigrations = repairStampedSchema(migrations, database)
  }

  const after = inspectDatabaseCompatibility(database)

  return {
    before,
    after,
    migrationVersionBefore,
    migrationVersionAfter,
    migrationsApplied: Math.max(0, migrationVersionAfter - migrationVersionBefore),
    repairedMigrations,
    fixedIssues: diffFixedIssues(before, after),
    schemaRepairsApplied:
      before.issues.length > after.issues.length ||
      migrationVersionAfter > migrationVersionBefore ||
      repairedMigrations.length > 0,
  }
}

export function formatCompatibilityUpgradeSummary(result: CompatibilityUpgradeResult): string {
  if (
    result.before.isCompatible &&
    result.after.isCompatible &&
    result.migrationsApplied === 0 &&
    result.repairedMigrations.length === 0
  ) {
    return '数据库结构已兼容当前版本，无需升级'
  }

  const parts: string[] = []
  if (result.repairedMigrations.length > 0) {
    parts.push(`已补建 ${result.repairedMigrations.length} 项缺失的迁移表（${result.repairedMigrations.join('、')}）`)
  }
  if (result.migrationsApplied > 0) {
    parts.push(`已执行 ${result.migrationsApplied} 项数据库迁移（v${result.migrationVersionBefore} → v${result.migrationVersionAfter}）`)
  }
  if (result.fixedIssues.length > 0) {
    parts.push(`已修复 ${result.fixedIssues.length} 处结构差异`)
  }
  if (!result.after.isCompatible) {
    parts.push(`仍有 ${result.after.issues.length} 项待人工处理`)
  } else {
    parts.push('结构兼容检查通过')
  }
  return parts.join('；')
}
