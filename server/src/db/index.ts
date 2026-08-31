import Database from 'better-sqlite3'
import type { Database as DatabaseType } from 'better-sqlite3'
import { readFileSync, existsSync, mkdirSync } from 'fs'
import { resolve, dirname, basename, join } from 'path'
import { fileURLToPath } from 'url'
import { v4 as uuidv4 } from 'uuid'
import dotenv from 'dotenv'
import { PRESET_ROLES } from './permissions.js'
import { ensureUserRoleLink } from '../services/userRoleLinks.js'
import { ensureDynamicReportSchema } from './ensureDynamicReportSchema.js'

// ES module 的 import 会在模块求值前提升，server/src/index.ts 的 dotenv.config()
// 可能在本模块顶层常量求值后才执行，导致 DB_PATH/DB_DIR 等环境变量读不到。
// 这里在求值前主动加载一次 .env（dotenv.config 幂等，重复调用无副作用）。
// 兼容开发模式（__dirname = server/src/db/）和部署模式（__dirname = deploy-final/server/dist/）
{
  const __dbModuleDir = dirname(fileURLToPath(import.meta.url))
  const candidateEnvPaths = [
    join(__dbModuleDir, '.env'), // server/src/db/.env（一般不存在）
    join(__dbModuleDir, '..', '.env'), // server/src/.env（一般不存在）
    join(__dbModuleDir, '..', '..', '.env'), // server/.env（开发环境）
  ]
  const envFile = candidateEnvPaths.find(p => existsSync(p))
  if (envFile) {
    try {
      dotenv.config({ path: envFile })
    } catch {
      /* 忽略异常，沿用上层 index.ts 的加载结果 */
    }
  }
}

const MODULE_FILE = fileURLToPath(import.meta.url)
const MODULE_DIR = dirname(MODULE_FILE)
const SERVER_SRC_DIR = resolve(MODULE_DIR, '..')
const SERVER_ROOT_DIR = resolve(SERVER_SRC_DIR, '..')
const PROJECT_ROOT_DIR = resolve(SERVER_ROOT_DIR, '..')

// 便携部署：process.execPath = deploy/node/node.exe，DB 在 deploy/data/
// pkg 部署：process.pkg 标识，DB 在 exe 同目录/data/
// 开发环境：使用项目根目录
export function getDeployDir(): string {
  const execPath = process.execPath || ''
  const isPkg = !!(process as any).pkg

  if (isPkg) {
    // pkg exe: deploy/cw-finance.exe → deploy/
    return dirname(execPath)
  }

  // 检查是否是便携部署（deploy/node/node.exe）
  // 通过检查 execPath 的父目录名是否为 'node' 来判断
  const parentDir = dirname(execPath)
  const parentDirName = basename(parentDir)
  
  if (execPath.endsWith('node.exe') && parentDirName === 'node') {
    // 便携 Node.js: deploy/node/node.exe → deploy/
    return dirname(parentDir)
  }

  // 开发环境：使用项目根目录
  return PROJECT_ROOT_DIR
}

const DEPLOY_DIR = getDeployDir()
const DB_DIR = process.env.DB_DIR || resolve(DEPLOY_DIR, 'data')
// DB_PATH 支持相对路径：相对路径以当前工作目录(cwd)为基准 resolve。
// 开发模式下 cwd = server/，故 ../data/finance-0523.db → cw0523/data/finance-0523.db
// 绝对路径原样使用。不提供时回退到 DB_DIR/finance.db。
const DB_PATH = process.env.DB_PATH
  ? resolve(process.env.DB_PATH)
  : resolve(DB_DIR, 'finance.db')

let db: Database.Database | null = null
let __DB_PATH_LOGGED = false

/** 兼容旧库/导入备份：补齐 users 表登录页所需字段 */
export function ensureUsersTableSchema(database: Database.Database) {
  const tableExists = database
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'users'")
    .get()
  if (!tableExists) return

  const columns = database.prepare('PRAGMA table_info(users)').all() as Array<{ name: string }>
  const names = new Set(columns.map(column => column.name))

  if (!names.has('account_set_id')) {
    database.exec('ALTER TABLE users ADD COLUMN account_set_id TEXT REFERENCES account_sets(id)')
  }
  if (!names.has('status')) {
    database.exec("ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'active'")
  }
  if (!names.has('nickname')) {
    database.exec('ALTER TABLE users ADD COLUMN nickname TEXT')
  }
  if (!names.has('permission_mode')) {
    database.exec(
      "ALTER TABLE users ADD COLUMN permission_mode TEXT DEFAULT 'role' CHECK(permission_mode IN ('role', 'custom'))"
    )
  }
  if (!names.has('custom_permissions')) {
    database.exec('ALTER TABLE users ADD COLUMN custom_permissions TEXT')
  }
}

function ensureInitBalanceDetailColumns(database: Database.Database) {
  const tableExists = database
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'init_balances'")
    .get()
  if (!tableExists) return

  const columns = database.prepare('PRAGMA table_info(init_balances)').all() as Array<{ name: string }>
  const names = new Set(columns.map(column => column.name))
  if (!names.has('opening_debit')) {
    database.exec('ALTER TABLE init_balances ADD COLUMN opening_debit REAL NOT NULL DEFAULT 0')
  }
  if (!names.has('opening_credit')) {
    database.exec('ALTER TABLE init_balances ADD COLUMN opening_credit REAL NOT NULL DEFAULT 0')
  }
  if (!names.has('pre_book_debit')) {
    database.exec('ALTER TABLE init_balances ADD COLUMN pre_book_debit REAL NOT NULL DEFAULT 0')
  }
  if (!names.has('pre_book_credit')) {
    database.exec('ALTER TABLE init_balances ADD COLUMN pre_book_credit REAL NOT NULL DEFAULT 0')
  }
}

/** 恢复旧备份后 schema_migrations 可能已是最新但缺列，补齐关键结构 */
export function repairDatabaseSchemaCompatibility(database: Database.Database) {
  ensureUsersTableSchema(database)

  const rolesExists = database
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'roles'")
    .get()
  if (rolesExists) {
    const roleColumns = database.prepare('PRAGMA table_info(roles)').all() as Array<{ name: string }>
    const roleNames = new Set(roleColumns.map(column => column.name))
    if (!roleNames.has('is_personal')) {
      database.exec('ALTER TABLE roles ADD COLUMN is_personal INTEGER DEFAULT 0')
    }
    if (!roleNames.has('owner_user_id')) {
      database.exec('ALTER TABLE roles ADD COLUMN owner_user_id TEXT REFERENCES users(id)')
    }
  }

  const userRolesExists = database
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'user_roles'")
    .get()
  if (!userRolesExists) {
    database.exec(`
      CREATE TABLE user_roles (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
        account_set_id TEXT NOT NULL REFERENCES account_sets(id),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(user_id, role_id, account_set_id)
      );
      CREATE INDEX IF NOT EXISTS idx_user_roles_user ON user_roles(user_id, account_set_id);
      CREATE INDEX IF NOT EXISTS idx_user_roles_role ON user_roles(role_id, account_set_id);
      CREATE INDEX IF NOT EXISTS idx_user_roles_account ON user_roles(account_set_id);
    `)

    const usersWithRoles = database
      .prepare('SELECT id, role_id, account_set_id FROM users WHERE role_id IS NOT NULL')
      .all() as Array<{ id: string; role_id: string; account_set_id: string }>

    if (usersWithRoles.length > 0) {
      const insertStmt = database.prepare(`
        INSERT OR IGNORE INTO user_roles (id, user_id, role_id, account_set_id)
        VALUES (?, ?, ?, ?)
      `)
      for (const user of usersWithRoles) {
        insertStmt.run(uuidv4(), user.id, user.role_id, user.account_set_id)
      }
    }
  }
}

function ensureUserLoginSessionsTable(database: Database.Database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS user_login_sessions (
      id TEXT PRIMARY KEY,
      account_set_id TEXT NOT NULL REFERENCES account_sets(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      username TEXT NOT NULL,
      login_ip TEXT,
      user_agent TEXT,
      login_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'forced', 'logout', 'expired')),
      forced_logout_at TEXT,
      forced_by_ip TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_user_login_sessions_user_status ON user_login_sessions(user_id, account_set_id, status);
    CREATE INDEX IF NOT EXISTS idx_user_login_sessions_active_ip ON user_login_sessions(user_id, account_set_id, login_ip, status);
  `)
}

/** 旧库结构补齐（不含 schema.sql 基础建表，不含迁移脚本） */
export function applyLegacySchemaEnsures(database: Database.Database) {
  ensureAccountsNoNegativeColumn(database)
  ensureDynamicReportSchema(database)
  ensureAuxCategoryDefaultItem(database)
  ensureAuxCategoryFieldsTable(database)
  ensureVoucherIndexes(database)
  ensureBudgetSurplusAdjustmentsTable(database)
  ensureUsersTableSchema(database)
  ensureInitBalanceDetailColumns(database)
  repairDatabaseSchemaCompatibility(database)
  ensureUserLoginSessionsTable(database)
  ensureAccountSetImportSourceColumn(database)
}

function ensureAccountsNoNegativeColumn(database: Database.Database) {
  const columns = database.prepare('PRAGMA table_info(accounts)').all() as Array<{ name: string }>
  const hasNoNegative = columns.some(column => column.name === 'no_negative')

  if (!hasNoNegative) {
    database.exec('ALTER TABLE accounts ADD COLUMN no_negative INTEGER DEFAULT 0')
  }
}

function ensureAccountSetImportSourceColumn(database: Database.Database) {
  const tableExists = database
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'account_sets'")
    .get()
  if (!tableExists) return

  const columns = database.prepare('PRAGMA table_info(account_sets)').all() as Array<{ name: string }>
  const hasImportSource = columns.some(column => column.name === 'import_source')

  if (!hasImportSource) {
    database.exec(`ALTER TABLE account_sets ADD COLUMN import_source TEXT DEFAULT 'manual'`)
    database.exec(`
      UPDATE account_sets
      SET import_source = 'acd'
      WHERE id IN (
        SELECT DISTINCT account_set_id
        FROM users
        WHERE username = 'MANAGER'
      )
    `)
  }
}

function ensureAuxCategoryDefaultItem(database: Database.Database) {
  const columns = database.prepare('PRAGMA table_info(aux_categories)').all() as Array<{ name: string }>
  const hasDefaultItem = columns.some(column => column.name === 'default_item_id')

  if (!hasDefaultItem) {
    database.exec('ALTER TABLE aux_categories ADD COLUMN default_item_id TEXT')
  }
}

function ensureVoucherIndexes(database: Database.Database) {
  // 确保 vouchers 表有 (account_set_id, year, period, status) 复合索引，加速日记账等查询
  const indexes = database.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='vouchers'").all() as Array<{ name: string }>
  const hasPeriodStatusIndex = indexes.some(idx => idx.name === 'idx_vouchers_period_status')
  if (!hasPeriodStatusIndex) {
    database.exec('CREATE INDEX IF NOT EXISTS idx_vouchers_period_status ON vouchers(account_set_id, year, period, status)')
  }
}

function ensureBudgetSurplusAdjustmentsTable(database: Database.Database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS budget_surplus_adjustments (
      id TEXT PRIMARY KEY,
      account_set_id TEXT NOT NULL REFERENCES account_sets(id) ON DELETE CASCADE,
      source_seq INTEGER,
      item_code TEXT NOT NULL,
      item_name TEXT,
      year INTEGER NOT NULL,
      period INTEGER NOT NULL,
      amount REAL NOT NULL DEFAULT 0,
      account_code TEXT,
      alt_amount REAL NOT NULL DEFAULT 0,
      item_type TEXT,
      balance_direction TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(account_set_id, source_seq)
    );

    CREATE INDEX IF NOT EXISTS idx_budget_surplus_adjustments_period
      ON budget_surplus_adjustments(account_set_id, year, period, item_code);
  `)
}

function ensureAuxCategoryFieldsTable(database: Database.Database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS aux_category_fields (
      id TEXT PRIMARY KEY,
      category_id TEXT NOT NULL REFERENCES aux_categories(id) ON DELETE CASCADE,
      field_key TEXT NOT NULL,
      field_name TEXT NOT NULL,
      field_type TEXT NOT NULL DEFAULT 'text' CHECK(field_type IN ('text', 'number', 'date', 'select')),
      options_json TEXT,
      show_in_voucher INTEGER DEFAULT 0,
      required_in_voucher INTEGER DEFAULT 0,
      required_in_archive INTEGER DEFAULT 0,
      sort_order INTEGER DEFAULT 0,
      is_enabled INTEGER DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(category_id, field_key)
    )
  `)

  // aux_items 新增 field_values 列
  const itemColumns = database.prepare('PRAGMA table_info(aux_items)').all() as Array<{ name: string }>
  const hasFieldValues = itemColumns.some(column => column.name === 'field_values')
  if (!hasFieldValues) {
    database.exec("ALTER TABLE aux_items ADD COLUMN field_values TEXT DEFAULT '{}'")
  }

  // 索引
  database.exec('CREATE INDEX IF NOT EXISTS idx_aux_category_fields_category ON aux_category_fields(category_id, sort_order)')
}

export function getDb(): Database.Database {
  if (!db) {
    // 确保数据库文件所在目录存在（DB_PATH 可能不在默认 DB_DIR 下）
    const dbFileDir = dirname(DB_PATH)
    if (!existsSync(dbFileDir)) {
      mkdirSync(dbFileDir, { recursive: true })
    }
    db = new Database(DB_PATH)
    db.pragma('journal_mode = WAL')
    db.pragma('foreign_keys = ON')
    db.pragma('synchronous = NORMAL')
    db.pragma('busy_timeout = 30000')
    db.pragma('wal_autocheckpoint = 1000')
    const configuredCacheMb = Number(process.env.SQLITE_CACHE_MB || 32)
    const cacheMb = Number.isFinite(configuredCacheMb)
      ? Math.min(1024, Math.max(1, Math.trunc(configuredCacheMb)))
      : 32
    db.pragma(`cache_size = -${cacheMb * 1024}`)
    db.pragma('temp_store = MEMORY')
    if (!__DB_PATH_LOGGED) {
      const mode = (process as any).pkg ? 'pkg' : process.execPath?.endsWith('node.exe') ? 'portable' : 'dev'
      console.log(
        `[DB] Init DB path: DEPLOY_DIR=${DEPLOY_DIR}, DB_DIR=${DB_DIR}, DB_PATH=${DB_PATH}, MODE=${mode}`
      )
      __DB_PATH_LOGGED = true
    }
    ensureAccountSetImportSourceColumn(db)
  }
  return db
}

/** 关闭并重置数据库连接（用于备份恢复后重建连接） */
export function closeAndResetDb() {
  if (db) {
    try { db.close() } catch { /* ignore */ }
    db = null
  }
}

export function initDatabase(): DatabaseType {
  const database = getDb()

  let schemaPath: string
  if (process.env.SCHEMA_DIR) {
    schemaPath = resolve(process.env.SCHEMA_DIR, 'schema.sql')
  } else if ((process as any).pkg) {
    schemaPath = resolve(DEPLOY_DIR, 'server', 'schema.sql')
  } else if ((process.execPath || '').endsWith('node.exe')) {
    // portable Node.js: schema.sql is in deploy/server/schema.sql
    schemaPath = resolve(DEPLOY_DIR, 'server', 'schema.sql')
  } else {
    schemaPath = resolve(SERVER_SRC_DIR, 'db', 'schema.sql')
  }

  const schema = readFileSync(schemaPath, 'utf-8')
  database.exec(schema)
  applyLegacySchemaEnsures(database)
  return database
}

export function seedRoles(accountSetId?: string) {
  const database = getDb()
  const targetAccountSetIds = accountSetId
    ? [accountSetId]
    : (database.prepare('SELECT id FROM account_sets').all() as Array<{ id: string }>).map(row => row.id)

  const hasAccountSetColumn = (database.prepare('PRAGMA table_info(roles)').all() as Array<{ name: string }>).some(
    column => column.name === 'account_set_id'
  )

  if (!hasAccountSetColumn) {
    const insert = database.prepare(
      'INSERT OR IGNORE INTO roles (id, name, code, description, is_system, permissions) VALUES (?, ?, ?, ?, ?, ?)'
    )
    for (const r of PRESET_ROLES) {
      // 确保 code 字段不为空
      if (!r.code) {
        console.error('Role code is missing:', r)
        continue
      }
      insert.run(uuidv4(), r.name, r.code, r.description || '', r.is_system, JSON.stringify(r.permissions))
    }
    return database.prepare('SELECT * FROM roles').all()
  }

  const insert = database.prepare(
    `INSERT OR IGNORE INTO roles (id, account_set_id, name, code, description, is_system, permissions)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
  for (const asId of targetAccountSetIds) {
    for (const r of PRESET_ROLES) {
      // 确保 code 字段不为空
      if (!r.code) {
        console.error('Role code is missing:', r)
        continue
      }
      insert.run(uuidv4(), asId, r.name, r.code, r.description || '', r.is_system, JSON.stringify(r.permissions))
    }
  }
  return accountSetId
    ? database.prepare('SELECT * FROM roles WHERE account_set_id = ?').all(accountSetId)
    : database.prepare('SELECT * FROM roles').all()
}

export function ensureAccountSetSecurityBootstrap(accountSetId: string) {
  const database = getDb()
  ensureUsersTableSchema(database)
  seedRoles(accountSetId)

  const roleColumns = database.prepare('PRAGMA table_info(roles)').all() as Array<{ name: string }>
  const rolesScopedByAccountSet = roleColumns.some(column => column.name === 'account_set_id')
  const adminRole = (
    rolesScopedByAccountSet
      ? database
          .prepare('SELECT id FROM roles WHERE account_set_id = ? AND code = ? LIMIT 1')
          .get(accountSetId, 'admin')
      : database.prepare('SELECT id FROM roles WHERE code = ? LIMIT 1').get('admin')
  ) as { id: string } | undefined

  if (!adminRole?.id) {
    console.error('[bootstrap] 未找到 admin 角色，账套:', accountSetId)
    return
  }

  const existingAdmin = database
    .prepare('SELECT id FROM users WHERE username = ? AND account_set_id = ?')
    .get('admin', accountSetId)
  if (existingAdmin) return

  const adminUserId = uuidv4()
  database.prepare(
    `INSERT INTO users (id, account_set_id, username, password, nickname, role_id, status, created_at, updated_at)
     VALUES (?, ?, 'admin', ?, '系统管理员', ?, 'active', datetime('now'), datetime('now'))`
  ).run(
    adminUserId,
    accountSetId,
    '$2a$10$Dj9DCcIGNtjYZmfcub6td.wly0mkJT.bLPc.yeFAStW77WqkQu5ie',
    adminRole.id
  )
  ensureUserRoleLink(database, adminUserId, adminRole.id, accountSetId)
}

/** 校验数据库完整性，损坏时抛出可读错误（常见于 WAL 文件不同步） */
export function assertDatabaseIntegrity(database: Database.Database = getDb()) {
  const result = database.pragma('integrity_check', { simple: true }) as string
  if (result === 'ok') return

  throw new Error(
    `数据库文件已损坏（${result}）。请停止服务，删除 data 目录下的 finance.db、finance.db-wal、finance.db-shm 后重新启动；` +
      '若仍失败，请重新解压部署包或联系技术支持。'
  )
}

/** 将 WAL 日志合并回主库，降低部署/异常退出后的损坏风险 */
export function checkpointDatabase(database: Database.Database = getDb()) {
  try {
    database.pragma('wal_checkpoint(TRUNCATE)')
  } catch (error) {
    console.warn('[DB] wal_checkpoint 失败:', error)
  }
}

export { DB_PATH, DEPLOY_DIR }
