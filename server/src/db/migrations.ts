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


/** DDL 重复执行时 SQLite 抛出的“已经做过了”类错误 */
const ALREADY_APPLIED_RE = /duplicate column name|already exists/i

export function isAlreadyAppliedError(err: unknown): boolean {
  return ALREADY_APPLIED_RE.test(String((err as any)?.message ?? ''))
}

/**
 * 把多语句 SQL 拆成单条。
 * 识别单引号字符串、`--` 行注释与 CREATE TRIGGER 的 BEGIN…END 体，
 * 避免把触发器内部的分号当成语句分隔符。
 */
export function splitSqlStatements(sql: string): string[] {
  const statements: string[] = []
  let current = ''
  let inString = false
  let inLineComment = false

  const isUnfinishedTrigger = (text: string) =>
    /^\s*CREATE\s+(TEMP\s+|TEMPORARY\s+)?TRIGGER\b/i.test(text) && !/\bEND\s*$/i.test(text.trim())

  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i]

    if (inLineComment) {
      current += ch
      if (ch === '\n') inLineComment = false
      continue
    }
    if (inString) {
      current += ch
      if (ch === "'") {
        if (sql[i + 1] === "'") current += sql[++i]
        else inString = false
      }
      continue
    }
    if (ch === '-' && sql[i + 1] === '-') {
      inLineComment = true
      current += ch
      continue
    }
    if (ch === "'") {
      inString = true
      current += ch
      continue
    }
    if (ch === ';') {
      if (isUnfinishedTrigger(current)) {
        current += ch
        continue
      }
      statements.push(current)
      current = ''
      continue
    }
    current += ch
  }
  statements.push(current)

  return statements
    .map(item => item.trim())
    .filter(item => item.length > 0 && !/^(--[^\n]*\n?\s*)+$/.test(item))
}

/** 逐条执行 SQL，跳过“列/表已存在”的语句，其余错误照常抛出 */
export function execTolerant(db: Database.Database, sql: string) {
  for (const statement of splitSqlStatements(sql)) {
    try {
      db.exec(statement)
    } catch (error) {
      if (isAlreadyAppliedError(error)) continue
      throw error
    }
  }
}

/** 什么都不做的语句替身：用于已经生效过的 DDL */
const NOOP_STATEMENT = {
  run: () => ({ changes: 0, lastInsertRowid: 0 }),
  get: () => undefined,
  all: () => [],
  iterate: function* () {},
  pluck: function () { return this },
  expand: function () { return this },
  raw: function () { return this },
  bind: function () { return this },
} as unknown as Database.Statement

/**
 * 包一层 db：exec 逐条容错，prepare 出来的语句在 run 时也容错，
 * 其余方法透传原对象。迁移脚本两种写法都有，必须都覆盖。
 */
function createTolerantDb(db: Database.Database): Database.Database {
  return new Proxy(db, {
    get(target, prop) {
      if (prop === 'exec') {
        return (sql: string) => {
          execTolerant(target, sql)
          return target
        }
      }
      if (prop === 'prepare') {
        return (sql: string) => {
          let statement: Database.Statement
          try {
            statement = target.prepare(sql)
          } catch (error) {
            if (isAlreadyAppliedError(error)) return NOOP_STATEMENT
            throw error
          }
          return new Proxy(statement, {
            get(stmt, key) {
              if (key === 'run') {
                return (...args: unknown[]) => {
                  try {
                    return (stmt.run as (...a: unknown[]) => unknown)(...args)
                  } catch (error) {
                    if (isAlreadyAppliedError(error)) return { changes: 0, lastInsertRowid: 0 }
                    throw error
                  }
                }
              }
              const value = Reflect.get(stmt, key, stmt)
              return typeof value === 'function' ? value.bind(stmt) : value
            },
          })
        }
      }
      const value = Reflect.get(target, prop, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
  }) as Database.Database
}

function tableExists(db: Database.Database, table: string): boolean {
  return !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table)
}

function columnExists(db: Database.Database, table: string, column: string): boolean {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  return columns.some(item => item.name === column)
}

/** 从迁移源码里取出它负责创建的表名 */
function collectCreatedTables(source: string): string[] {
  const matches = source.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"'\[]?(\w+)/gi)
  return [...new Set([...matches].map(item => item[1]))]
}

/**
 * 从迁移源码里取出它负责新增的列（表名.列名）。
 * 两种写法都要认：直接写 ALTER TABLE，以及项目里常见的
 * `addColumn(db, '表名', '列名 类型')` / `addColumnIfMissing(db, '表名', '列名', '类型')`
 * 这类包装（拼串 DDL，正则看不到 ALTER）。
 */
function collectAddedColumns(source: string): Array<{ table: string; column: string }> {
  const patterns = [
    /ALTER\s+TABLE\s+[`"'\[]?(\w+)[`"'\]]?\s+ADD\s+(?:COLUMN\s+)?[`"'\[]?(\w+)/gi,
    /\badd\w*Column\w*\s*\(\s*\w+\s*,\s*['"`](\w+)['"`]\s*,\s*['"`](\w+)/gi,
  ]
  const seen = new Set<string>()
  const result: Array<{ table: string; column: string }> = []
  for (const pattern of patterns) {
    for (const item of source.matchAll(pattern)) {
      const key = `${item[1]}.${item[2]}`
      if (seen.has(key)) continue
      seen.add(key)
      result.push({ table: item[1], column: item[2] })
    }
  }
  return result
}

/**
 * 判断一个迁移能否安全重跑：
 * 调用方已确认这些表确实不存在，也就是说该迁移当初根本没跑完，
 * 重跑它的建表与数据回填正是应该发生的事，因此 DML 不受限制。
 *
 * 唯独排除「建临时表 → 搬数据 → DROP/RENAME 覆盖原表」这种重建型迁移：
 * 它成功之后临时表本就不存在，会被误判成“缺表”而每次启动都重跑一遍。
 */
function isSafeToReplay(source: string): boolean {
  if (/\bDROP\s+TABLE\b/i.test(source)) return false
  if (/\bRENAME\s+TO\b/i.test(source)) return false
  if (/\bDROP\s+COLUMN\b/i.test(source)) return false
  return true
}

/**
 * 修复“迁移版本号已经是最新、但建表/加列语句其实没跑过”的库。
 *
 * 出现原因：早期迁移在旧库上中途失败（如 schema.sql 里已有该列，ALTER 报
 * duplicate column），或版本号被外部写入，导致 version > currentVersion 的
 * 过滤条件把后面所有迁移永久跳过，模块表（固定资产/出纳/供应链等）一直缺失。
 *
 * 只重跑可安全重放的迁移，且逐条容错。返回被修复的迁移描述。
 *
 * 多跑几轮：靠后的迁移可能依赖靠前那条补出来的列，一轮补不齐；
 * 一轮下来没有任何进展就收手。
 */
export function repairStampedSchema(migrations: Migration[], database?: Database.Database): string[] {
  const db = database ?? getDb()
  initMigrationTable(db)

  const repaired: string[] = []
  const lastError = new Map<number, unknown>()
  const MAX_PASSES = 3

  for (let pass = 0; pass < MAX_PASSES; pass++) {
    let progressed = false

    for (const migration of migrations) {
      const source = String(migration.up)
      if (!isSafeToReplay(source)) continue

      const missingTables = collectCreatedTables(source).filter(table => !tableExists(db, table))
      // 表都不在时列自然也不在，交给建表逻辑一并补，这里只看表还在但缺列的情况
      const missingColumns = collectAddedColumns(source).filter(
        item => tableExists(db, item.table) && !columnExists(db, item.table, item.column)
      )
      if (missingTables.length === 0 && missingColumns.length === 0) continue

      const missingCount = missingTables.length + missingColumns.length

      try {
        db.transaction(() => {
          migration.up(createTolerantDb(db))
        })()
        lastError.delete(migration.version)
      } catch (error) {
        lastError.set(migration.version, error)
      }

      const stillMissing =
        missingTables.filter(table => !tableExists(db, table)).length +
        missingColumns.filter(
          item => tableExists(db, item.table) && !columnExists(db, item.table, item.column)
        ).length
      if (stillMissing < missingCount) {
        progressed = true
        const tag = `${migration.version}:${migration.name}`
        if (!repaired.includes(tag)) repaired.push(tag)
      }
    }

    if (!progressed) break
  }

  for (const [version, error] of lastError) {
    const migration = migrations.find(item => item.version === version)
    console.error(`✗ 补建迁移 ${version}(${migration?.name ?? '?'}) 失败:`, error)
  }
  if (repaired.length > 0) {
    console.log(`✓ 已补建缺失的迁移结构：${repaired.join(', ')}`)
  }
  return repaired
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

    const stamp = () =>
      db.prepare('INSERT INTO schema_migrations (version, name) VALUES (?, ?)').run(
        migration.version,
        migration.name
      )

    const transaction = db.transaction(() => {
      migration.up(db)
      stamp()
    })

    // 逐条容错重试：旧库/新库的 schema.sql 里可能已经带上了本迁移要加的列或表，
    // 严格执行会在 ALTER TABLE 处炸掉，进而把后面所有迁移一起跳过。
    const tolerantTransaction = db.transaction(() => {
      migration.up(createTolerantDb(db))
      stamp()
    })

    try {
      transaction()
      console.log(`✓ Migration ${migration.version} applied successfully`)
    } catch (error) {
      if (!isAlreadyAppliedError(error)) {
        console.error(`✗ Migration ${migration.version} failed:`, error)
        throw error
      }
      try {
        tolerantTransaction()
        console.log(
          `✓ Migration ${migration.version} applied successfully（已跳过重复的列/表定义）`
        )
      } catch (retryError) {
        console.error(`✗ Migration ${migration.version} failed:`, retryError)
        throw retryError
      }
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
