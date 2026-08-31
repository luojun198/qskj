import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import {
  inspectDatabaseCompatibility,
  upgradeDatabaseCompatibility,
  TARGET_DB_VERSION,
} from '../db/databaseCompatibility.js'
import { applyLegacySchemaEnsures } from '../db/index.js'

function createLegacyDb() {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL DEFAULT (datetime('now')));
    INSERT INTO schema_migrations (version, name) VALUES (${TARGET_DB_VERSION}, 'legacy_marker');

    CREATE TABLE account_sets (id TEXT PRIMARY KEY, name TEXT, code TEXT, start_date TEXT);
    INSERT INTO account_sets VALUES ('set1', '测试账套', 'ZT001', '2024-01-01');

    CREATE TABLE roles (id TEXT PRIMARY KEY, account_set_id TEXT, name TEXT, code TEXT, permissions TEXT);
    INSERT INTO roles VALUES ('role1', 'set1', '管理员', 'admin', '["*"]');

    CREATE TABLE users (
      id TEXT PRIMARY KEY, account_set_id TEXT, username TEXT, password TEXT,
      nickname TEXT, role_id TEXT, status TEXT DEFAULT 'active'
    );
    INSERT INTO users VALUES ('u1', 'set1', 'admin', 'hash', '管理员', 'role1', 'active');

    CREATE TABLE accounts (id TEXT PRIMARY KEY, account_set_id TEXT, code TEXT, name TEXT, direction TEXT);
    CREATE TABLE vouchers (id TEXT PRIMARY KEY, account_set_id TEXT, voucher_no TEXT, voucher_date TEXT, year INTEGER, period INTEGER, status TEXT);
    CREATE TABLE voucher_entries (id TEXT PRIMARY KEY, account_set_id TEXT, voucher_id TEXT, seq INTEGER, account_id TEXT, account_code TEXT, account_name TEXT, direction TEXT, amount REAL);
    CREATE TABLE init_balances (id TEXT PRIMARY KEY, account_set_id TEXT, account_id TEXT, year INTEGER, period INTEGER, init_balance REAL, init_debit REAL, init_credit REAL, aux_item_id TEXT);
    CREATE TABLE backups (id TEXT PRIMARY KEY, account_set_id TEXT, filename TEXT, filepath TEXT, size INTEGER, type TEXT, status TEXT, created_at TEXT);
    CREATE TABLE aux_categories (id TEXT PRIMARY KEY, account_set_id TEXT, code TEXT, name TEXT);
    CREATE TABLE aux_items (id TEXT PRIMARY KEY, account_set_id TEXT, type TEXT, code TEXT, name TEXT);
  `)
  return db
}

describe('databaseCompatibility', () => {
  let db: Database.Database

  beforeEach(() => {
    db = createLegacyDb()
  })

  it('inspectDatabaseCompatibility 能识别旧库缺失字段', () => {
    const report = inspectDatabaseCompatibility(db)
    expect(report.isCompatible).toBe(false)
    expect(report.issues.some(issue => issue.column === 'custom_permissions')).toBe(true)
    expect(report.issues.some(issue => issue.table === 'user_roles')).toBe(true)
  })

  it('upgradeDatabaseCompatibility 可自动修复旧库关键结构', () => {
    applyLegacySchemaEnsures(db)
    const report = inspectDatabaseCompatibility(db)
    expect(report.issues.some(issue => issue.column === 'custom_permissions')).toBe(false)
    expect(report.issues.some(issue => issue.table === 'user_roles')).toBe(false)
    expect(report.issues.some(issue => issue.table === 'user_login_sessions')).toBe(false)
  })

  it('upgradeDatabaseCompatibility 返回修复摘要', () => {
    const result = upgradeDatabaseCompatibility(db, { skipMigrations: true })
    expect(result.fixedIssues.length).toBeGreaterThan(0)
    expect(result.after.issues.length).toBeLessThan(result.before.issues.length)
  })
})
