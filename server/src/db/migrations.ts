import Database from 'better-sqlite3'
import { getDb } from '../db/index.js'

/**
 * 数据库迁移系统
 * 用于版本化管理 schema 变更
 */

export interface Migration {
  version: number
  name: string
  up: (db: Database.Database) => void
  down: (db: Database.Database) => void
}

/**
 * 初始化迁移表
 */
function initMigrationTable(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)
}

/**
 * 获取当前数据库版本
 */
export function getCurrentVersion(db: Database.Database): number {
  initMigrationTable(db)
  const result = db.prepare('SELECT MAX(version) as version FROM schema_migrations').get() as any
  return result?.version || 0
}

/**
 * 执行迁移（向上）
 */
export function runMigrations(migrations: Migration[], targetVersion?: number) {
  const db = getDb()
  const currentVersion = getCurrentVersion(db)

  const pendingMigrations = migrations
    .filter(m => m.version > currentVersion)
    .filter(m => !targetVersion || m.version <= targetVersion)
    .sort((a, b) => a.version - b.version)

  if (pendingMigrations.length === 0) {
    console.log('No pending migrations')
    return
  }

  console.log(`Running ${pendingMigrations.length} migration(s)...`)

  for (const migration of pendingMigrations) {
    console.log(`Applying migration ${migration.version}: ${migration.name}`)

    const transaction = db.transaction(() => {
      migration.up(db)
      db.prepare('INSERT INTO schema_migrations (version, name) VALUES (?, ?)').run(
        migration.version,
        migration.name
      )
    })

    try {
      transaction()
      console.log(`✓ Migration ${migration.version} applied successfully`)
    } catch (error) {
      console.error(`✗ Migration ${migration.version} failed:`, error)
      throw error
    }
  }

  console.log('All migrations completed')
}

/**
 * 回滚迁移（向下）
 */
export function rollbackMigration(migrations: Migration[], targetVersion?: number) {
  const db = getDb()
  const currentVersion = getCurrentVersion(db)

  const migrationsToRollback = migrations
    .filter(m => m.version <= currentVersion)
    .filter(m => !targetVersion || m.version > targetVersion)
    .sort((a, b) => b.version - a.version)

  if (migrationsToRollback.length === 0) {
    console.log('No migrations to rollback')
    return
  }

  console.log(`Rolling back ${migrationsToRollback.length} migration(s)...`)

  for (const migration of migrationsToRollback) {
    console.log(`Rolling back migration ${migration.version}: ${migration.name}`)

    const transaction = db.transaction(() => {
      migration.down(db)
      db.prepare('DELETE FROM schema_migrations WHERE version = ?').run(migration.version)
    })

    try {
      transaction()
      console.log(`✓ Migration ${migration.version} rolled back successfully`)
    } catch (error) {
      console.error(`✗ Rollback ${migration.version} failed:`, error)
      throw error
    }
  }

  console.log('All rollbacks completed')
}

/**
 * 获取迁移状态
 */
export function getMigrationStatus(migrations: Migration[]) {
  const db = getDb()
  const currentVersion = getCurrentVersion(db)

  const appliedMigrations = db
    .prepare('SELECT version, name, applied_at FROM schema_migrations ORDER BY version')
    .all() as any[]

  return {
    currentVersion,
    appliedMigrations,
    pendingMigrations: migrations
      .filter(m => m.version > currentVersion)
      .map(m => ({ version: m.version, name: m.name })),
  }
}
