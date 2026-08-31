import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'
import {
  resolveUserAccountScope,
  expandScopeAccountIds,
  assertVoucherEntriesInAccountScope,
  buildVoucherAllEntriesInScopeSql,
  isVoucherVisibleInAccountScope,
  appendAccountScopeCondition,
  filterAccountIdsByScope,
} from '../services/accountAuthorization.js'
import { up as migrateAccountScopes } from '../db/migrations/20260526_add_account_scopes.js'

function createDb() {
  const db = new Database(':memory:')
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE account_sets (id TEXT PRIMARY KEY, name TEXT NOT NULL);
    CREATE TABLE users (
      id TEXT PRIMARY KEY, account_set_id TEXT, username TEXT, role_id TEXT,
      account_scope_enabled INTEGER DEFAULT 0
    );
    CREATE TABLE roles (
      id TEXT PRIMARY KEY, account_set_id TEXT, name TEXT, code TEXT,
      account_scope_enabled INTEGER DEFAULT 0
    );
    CREATE TABLE user_roles (
      id TEXT PRIMARY KEY, user_id TEXT, role_id TEXT, account_set_id TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE accounts (
      id TEXT PRIMARY KEY, account_set_id TEXT, code TEXT, name TEXT,
      direction TEXT, parent_id TEXT
    );
    CREATE TABLE vouchers (
      id TEXT PRIMARY KEY, account_set_id TEXT, voucher_no TEXT, status TEXT
    );
    CREATE TABLE voucher_entries (
      id TEXT PRIMARY KEY, account_set_id TEXT, voucher_id TEXT, account_id TEXT, seq INTEGER
    );
  `)
  migrateAccountScopes(db)
  return db
}

describe('accountAuthorization', () => {
  let db: Database.Database
  const setId = 'set-1'
  const userId = 'user-1'
  const roleId = 'role-1'
  const parentId = 'acc-parent'
  const childId = 'acc-child'
  const otherId = 'acc-other'

  beforeEach(() => {
    db = createDb()
    db.prepare('INSERT INTO account_sets (id, name) VALUES (?, ?)').run(setId, '测试账套')
    db.prepare('INSERT INTO users (id, account_set_id, username) VALUES (?, ?, ?)').run(
      userId,
      setId,
      'u1'
    )
    db.prepare(
      'INSERT INTO roles (id, account_set_id, name, code, account_scope_enabled) VALUES (?, ?, ?, ?, ?)'
    ).run(roleId, setId, '财务', 'acct', 1)
    db.prepare(
      'INSERT INTO user_roles (id, user_id, role_id, account_set_id) VALUES (?, ?, ?, ?)'
    ).run(uuidv4(), userId, roleId, setId)
    db.prepare(
      'INSERT INTO accounts (id, account_set_id, code, name, direction, parent_id) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(parentId, setId, '1001', '现金', 'debit', null)
    db.prepare(
      'INSERT INTO accounts (id, account_set_id, code, name, direction, parent_id) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(childId, setId, '100101', '人民币', 'debit', parentId)
    db.prepare(
      'INSERT INTO accounts (id, account_set_id, code, name, direction, parent_id) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(otherId, setId, '2001', '银行存款', 'debit', null)
    db.prepare(
      'INSERT INTO role_account_scopes (id, role_id, account_set_id, account_id, include_children) VALUES (?, ?, ?, ?, ?)'
    ).run(uuidv4(), roleId, setId, parentId, 1)
  })

  afterEach(() => db.close())

  it('未启用科目限制时返回 unrestricted', () => {
    db.prepare('UPDATE roles SET account_scope_enabled = 0').run()
    const ctx = resolveUserAccountScope(db, { userId, accountSetId: setId })
    expect(ctx.restricted).toBe(false)
    expect(ctx.bypass).toBe(false)
  })

  it('角色授权父科目时展开子孙', () => {
    const ctx = resolveUserAccountScope(db, { userId, accountSetId: setId })
    expect(ctx.restricted).toBe(true)
    expect(ctx.allowedAccountIds.has(parentId)).toBe(true)
    expect(ctx.allowedAccountIds.has(childId)).toBe(true)
    expect(ctx.allowedAccountIds.has(otherId)).toBe(false)
  })

  it('超管 * 跳过限制', () => {
    const ctx = resolveUserAccountScope(db, {
      userId,
      accountSetId: setId,
      permissions: ['*'],
    })
    expect(ctx.bypass).toBe(true)
    expect(ctx.restricted).toBe(false)
  })

  it('分录科目校验拒绝未授权科目', () => {
    const ctx = resolveUserAccountScope(db, { userId, accountSetId: setId })
    expect(assertVoucherEntriesInAccountScope(ctx, [parentId])).toBeNull()
    expect(assertVoucherEntriesInAccountScope(ctx, [otherId])).toMatch(/未授权/)
  })

  it('凭证全分录在范围内才可见', () => {
    const ctx = resolveUserAccountScope(db, { userId, accountSetId: setId })
    const vOk = 'v-ok'
    const vBad = 'v-bad'
    db.prepare('INSERT INTO vouchers VALUES (?, ?, ?, ?)').run(vOk, setId, '1', 'draft')
    db.prepare('INSERT INTO vouchers VALUES (?, ?, ?, ?)').run(vBad, setId, '2', 'draft')
    db.prepare(
      'INSERT INTO voucher_entries (id, account_set_id, voucher_id, account_id, seq) VALUES (?, ?, ?, ?, 1)'
    ).run(uuidv4(), setId, vOk, parentId)
    db.prepare(
      'INSERT INTO voucher_entries (id, account_set_id, voucher_id, account_id, seq) VALUES (?, ?, ?, ?, 1)'
    ).run(uuidv4(), setId, vBad, parentId)
    db.prepare(
      'INSERT INTO voucher_entries (id, account_set_id, voucher_id, account_id, seq) VALUES (?, ?, ?, ?, 2)'
    ).run(uuidv4(), setId, vBad, otherId)

    expect(isVoucherVisibleInAccountScope(db, ctx, vOk, setId)).toBe(true)
    expect(isVoucherVisibleInAccountScope(db, ctx, vBad, setId)).toBe(false)
  })

  it('expandScopeAccountIds 含子孙', () => {
    const expanded = expandScopeAccountIds(db, setId, [
      { account_id: parentId, include_children: 1 },
    ])
    expect(expanded.has(childId)).toBe(true)
  })

  it('filterAccountIdsByScope 仅保留授权科目', () => {
    const ctx = resolveUserAccountScope(db, { userId, accountSetId: setId })
    const filtered = filterAccountIdsByScope(ctx, [parentId, otherId, childId])
    expect(filtered).toEqual([parentId, childId])
  })

  it('appendAccountScopeCondition 受限时追加 IN 条件', () => {
    const ctx = resolveUserAccountScope(db, { userId, accountSetId: setId })
    const conditions: string[] = ['1=1']
    const params: string[] = []
    appendAccountScopeCondition(ctx, 'a.id', conditions, params)
    expect(conditions.some(c => c.includes('IN'))).toBe(true)
    expect(params.length).toBeGreaterThan(0)
  })

  it('buildVoucherAllEntriesInScopeSql 无限制时为 1=1', () => {
    const { sql } = buildVoucherAllEntriesInScopeSql(
      { bypass: false, restricted: false, allowedAccountIds: new Set() },
      'v.id',
      setId
    )
    expect(sql).toBe('1=1')
  })
})
