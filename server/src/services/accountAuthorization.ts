import type Database from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'

export interface AccountScopeContext {
  /** 超管 * 权限，跳过科目限制 */
  bypass: boolean
  /** 是否启用科目白名单 */
  restricted: boolean
  /** 展开后的可访问科目 ID（restricted 时有效） */
  allowedAccountIds: Set<string>
}

export interface AccountScopeResolveInput {
  userId: string
  accountSetId: string
  roleId?: string | null
  permissions?: string[]
}

export interface AccountScopePayload {
  enabled: boolean
  account_ids: string[]
}

type ScopeRow = { account_id: string; include_children: number }

function hasUserRolesTable(database: Database.Database): boolean {
  const row = database
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'user_roles'`)
    .get()
  return !!row
}

function hasAccountScopeTables(database: Database.Database): boolean {
  const row = database
    .prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('role_account_scopes', 'user_account_scopes')`
    )
    .get()
  return !!row
}

function collectDescendantIds(
  database: Database.Database,
  accountSetId: string,
  parentId: string,
  target: Set<string>
) {
  const children = database
    .prepare('SELECT id FROM accounts WHERE parent_id = ? AND account_set_id = ?')
    .all(parentId, accountSetId) as Array<{ id: string }>

  for (const child of children) {
    if (!target.has(child.id)) {
      target.add(child.id)
      collectDescendantIds(database, accountSetId, child.id, target)
    }
  }
}

/** 将授权根节点展开为完整科目 ID 集合 */
export function expandScopeAccountIds(
  database: Database.Database,
  accountSetId: string,
  rows: ScopeRow[]
): Set<string> {
  const result = new Set<string>()
  for (const row of rows) {
    if (!row.account_id) continue
    result.add(row.account_id)
    if (row.include_children !== 0) {
      collectDescendantIds(database, accountSetId, row.account_id, result)
    }
  }
  return result
}

function loadRoleScopeRows(
  database: Database.Database,
  roleIds: string[],
  accountSetId: string
): ScopeRow[] {
  if (roleIds.length === 0) return []
  const placeholders = roleIds.map(() => '?').join(',')
  return database
    .prepare(
      `SELECT account_id, include_children
       FROM role_account_scopes
       WHERE account_set_id = ? AND role_id IN (${placeholders})`
    )
    .all(accountSetId, ...roleIds) as ScopeRow[]
}

/** 解析当前请求用户的科目授权范围 */
export function resolveUserAccountScope(
  database: Database.Database,
  input: AccountScopeResolveInput
): AccountScopeContext {
  const bypass = input.permissions?.includes('*') ?? false
  if (bypass) {
    return { bypass: true, restricted: false, allowedAccountIds: new Set() }
  }

  if (!hasAccountScopeTables(database)) {
    return { bypass: false, restricted: false, allowedAccountIds: new Set() }
  }

  const enabledRoleIds: string[] = []
  if (hasUserRolesTable(database)) {
    const roles = database
      .prepare(
        `SELECT r.id
         FROM user_roles ur
         JOIN roles r ON ur.role_id = r.id
         WHERE ur.user_id = ? AND ur.account_set_id = ? AND r.account_scope_enabled = 1`
      )
      .all(input.userId, input.accountSetId) as Array<{ id: string }>
    enabledRoleIds.push(...roles.map(r => r.id))
  }

  if (enabledRoleIds.length === 0 && input.roleId) {
    const legacyRole = database
      .prepare(
        `SELECT id FROM roles
         WHERE id = ? AND account_set_id = ? AND account_scope_enabled = 1`
      )
      .get(input.roleId, input.accountSetId) as { id: string } | undefined
    if (legacyRole) enabledRoleIds.push(legacyRole.id)
  }

  const userEnabled = database
    .prepare(
      `SELECT account_scope_enabled FROM users WHERE id = ? AND account_set_id = ?`
    )
    .get(input.userId, input.accountSetId) as { account_scope_enabled: number } | undefined

  const userScopeOn = userEnabled?.account_scope_enabled === 1
  const roleScopeOn = enabledRoleIds.length > 0

  if (!userScopeOn && !roleScopeOn) {
    return { bypass: false, restricted: false, allowedAccountIds: new Set() }
  }

  const allowed = new Set<string>()

  if (roleScopeOn) {
    const roleRows = loadRoleScopeRows(database, enabledRoleIds, input.accountSetId)
    expandScopeAccountIds(database, input.accountSetId, roleRows).forEach(id => allowed.add(id))
  }

  if (userScopeOn) {
    const userRows = database
      .prepare(
        `SELECT account_id, include_children
         FROM user_account_scopes
         WHERE user_id = ? AND account_set_id = ?`
      )
      .all(input.userId, input.accountSetId) as ScopeRow[]
    expandScopeAccountIds(database, input.accountSetId, userRows).forEach(id => allowed.add(id))
  }

  return { bypass: false, restricted: true, allowedAccountIds: allowed }
}

export function buildAccountIdInClause(accountIds: Set<string>): {
  sql: string
  params: string[]
} {
  const ids = Array.from(accountIds)
  if (ids.length === 0) {
    return { sql: 'NULL', params: [] }
  }
  return { sql: ids.map(() => '?').join(', '), params: ids }
}

/**
 * 凭证可见性：全部分录科目均在授权范围内（无分录或 account_id 为空视为不可见）
 */
export function buildVoucherAllEntriesInScopeSql(
  ctx: AccountScopeContext,
  voucherIdRef: string,
  accountSetId: string
): { sql: string; params: Array<string> } {
  if (ctx.bypass || !ctx.restricted) {
    return { sql: '1=1', params: [] }
  }
  if (ctx.allowedAccountIds.size === 0) {
    return { sql: '1=0', params: [] }
  }

  const { sql: inSql, params: inParams } = buildAccountIdInClause(ctx.allowedAccountIds)
  return {
    sql: `NOT EXISTS (
      SELECT 1 FROM voucher_entries ve_scope
      WHERE ve_scope.voucher_id = ${voucherIdRef}
        AND ve_scope.account_set_id = ?
        AND (
          ve_scope.account_id IS NULL
          OR ve_scope.account_id = ''
          OR ve_scope.account_id NOT IN (${inSql})
        )
    ) AND EXISTS (
      SELECT 1 FROM voucher_entries ve_has
      WHERE ve_has.voucher_id = ${voucherIdRef}
        AND ve_has.account_set_id = ?
        AND ve_has.account_id IS NOT NULL
        AND ve_has.account_id != ''
    )`,
    params: [accountSetId, ...inParams, accountSetId],
  }
}

export function isVoucherVisibleInAccountScope(
  database: Database.Database,
  ctx: AccountScopeContext,
  voucherId: string,
  accountSetId: string
): boolean {
  const { sql, params } = buildVoucherAllEntriesInScopeSqlForVoucher(
    ctx,
    voucherId,
    accountSetId
  )
  const row = database.prepare(`SELECT (${sql}) as ok`).get(...params) as { ok: number }
  return row?.ok === 1
}

/** 按凭证 ID 校验可见性（参数化查询） */
export function buildVoucherAllEntriesInScopeSqlForVoucher(
  ctx: AccountScopeContext,
  voucherId: string,
  accountSetId: string
): { sql: string; params: string[] } {
  if (ctx.bypass || !ctx.restricted) {
    return { sql: '1=1', params: [] }
  }
  if (ctx.allowedAccountIds.size === 0) {
    return { sql: '1=0', params: [] }
  }

  const { sql: inSql, params: inParams } = buildAccountIdInClause(ctx.allowedAccountIds)
  return {
    sql: `NOT EXISTS (
      SELECT 1 FROM voucher_entries ve_scope
      WHERE ve_scope.voucher_id = ?
        AND ve_scope.account_set_id = ?
        AND (
          ve_scope.account_id IS NULL
          OR ve_scope.account_id = ''
          OR ve_scope.account_id NOT IN (${inSql})
        )
    ) AND EXISTS (
      SELECT 1 FROM voucher_entries ve_has
      WHERE ve_has.voucher_id = ?
        AND ve_has.account_set_id = ?
        AND ve_has.account_id IS NOT NULL
        AND ve_has.account_id != ''
    )`,
    params: [voucherId, accountSetId, ...inParams, voucherId, accountSetId],
  }
}

export function assertVoucherEntriesInAccountScope(
  ctx: AccountScopeContext,
  accountIds: Array<string | null | undefined>
): string | null {
  if (ctx.bypass || !ctx.restricted) return null
  if (ctx.allowedAccountIds.size === 0) {
    return '未配置任何可操作的会计科目'
  }

  for (const accountId of accountIds) {
    if (!accountId) {
      return '分录必须选择会计科目'
    }
    if (!ctx.allowedAccountIds.has(accountId)) {
      return '分录包含未授权的会计科目'
    }
  }
  return null
}

export function getRoleAccountScopePayload(
  database: Database.Database,
  roleId: string,
  accountSetId: string
): AccountScopePayload {
  const role = database
    .prepare('SELECT account_scope_enabled FROM roles WHERE id = ? AND account_set_id = ?')
    .get(roleId, accountSetId) as { account_scope_enabled: number } | undefined

  if (!role) {
    return { enabled: false, account_ids: [] }
  }

  const rows = database
    .prepare(
      `SELECT account_id FROM role_account_scopes WHERE role_id = ? AND account_set_id = ? ORDER BY account_id`
    )
    .all(roleId, accountSetId) as Array<{ account_id: string }>

  return {
    enabled: role.account_scope_enabled === 1,
    account_ids: rows.map(r => r.account_id),
  }
}

export function getUserAccountScopePayload(
  database: Database.Database,
  userId: string,
  accountSetId: string
): AccountScopePayload {
  const user = database
    .prepare('SELECT account_scope_enabled FROM users WHERE id = ? AND account_set_id = ?')
    .get(userId, accountSetId) as { account_scope_enabled: number } | undefined

  if (!user) {
    return { enabled: false, account_ids: [] }
  }

  const rows = database
    .prepare(
      `SELECT account_id FROM user_account_scopes WHERE user_id = ? AND account_set_id = ? ORDER BY account_id`
    )
    .all(userId, accountSetId) as Array<{ account_id: string }>

  return {
    enabled: user.account_scope_enabled === 1,
    account_ids: rows.map(r => r.account_id),
  }
}

export function saveRoleAccountScopes(
  database: Database.Database,
  roleId: string,
  accountSetId: string,
  payload: AccountScopePayload
) {
  const accountIds = Array.isArray(payload.account_ids)
    ? [...new Set(payload.account_ids.filter(Boolean))]
    : []

  const tx = database.transaction(() => {
    database
      .prepare('UPDATE roles SET account_scope_enabled = ? WHERE id = ? AND account_set_id = ?')
      .run(payload.enabled ? 1 : 0, roleId, accountSetId)

    database
      .prepare('DELETE FROM role_account_scopes WHERE role_id = ? AND account_set_id = ?')
      .run(roleId, accountSetId)

    if (payload.enabled && accountIds.length > 0) {
      const insert = database.prepare(
        `INSERT INTO role_account_scopes (id, role_id, account_set_id, account_id, include_children)
         VALUES (?, ?, ?, ?, 1)`
      )
      for (const accountId of accountIds) {
        const exists = database
          .prepare('SELECT id FROM accounts WHERE id = ? AND account_set_id = ?')
          .get(accountId, accountSetId)
        if (exists) {
          insert.run(uuidv4(), roleId, accountSetId, accountId)
        }
      }
    }
  })
  tx()
}

export function saveUserAccountScopes(
  database: Database.Database,
  userId: string,
  accountSetId: string,
  payload: AccountScopePayload
) {
  const accountIds = Array.isArray(payload.account_ids)
    ? [...new Set(payload.account_ids.filter(Boolean))]
    : []

  const tx = database.transaction(() => {
    database
      .prepare('UPDATE users SET account_scope_enabled = ? WHERE id = ? AND account_set_id = ?')
      .run(payload.enabled ? 1 : 0, userId, accountSetId)

    database
      .prepare('DELETE FROM user_account_scopes WHERE user_id = ? AND account_set_id = ?')
      .run(userId, accountSetId)

    if (payload.enabled && accountIds.length > 0) {
      const insert = database.prepare(
        `INSERT INTO user_account_scopes (id, user_id, account_set_id, account_id, include_children)
         VALUES (?, ?, ?, ?, 1)`
      )
      for (const accountId of accountIds) {
        const exists = database
          .prepare('SELECT id FROM accounts WHERE id = ? AND account_set_id = ?')
          .get(accountId, accountSetId)
        if (exists) {
          insert.run(uuidv4(), userId, accountSetId, accountId)
        }
      }
    }
  })
  tx()
}

/** 过滤科目 ID 列表，仅保留授权范围内 */
export function filterAccountIdsByScope(
  ctx: AccountScopeContext | undefined,
  accountIds: string[]
): string[] {
  if (!ctx || ctx.bypass || !ctx.restricted) return accountIds
  if (ctx.allowedAccountIds.size === 0) return []
  return accountIds.filter(id => ctx.allowedAccountIds.has(id))
}

/** 过滤科目列表：仅保留授权范围内的科目 */
export function filterAccountsByScope<T extends { id: string }>(
  ctx: AccountScopeContext,
  accounts: T[]
): T[] {
  if (ctx.bypass || !ctx.restricted) return accounts
  if (ctx.allowedAccountIds.size === 0) return []
  return accounts.filter(a => ctx.allowedAccountIds.has(a.id))
}

/** 向 SQL 条件追加科目白名单（column 如 a.id、ve.account_id） */
export function appendAccountScopeCondition(
  ctx: AccountScopeContext | undefined,
  column: string,
  conditions: string[],
  params: string[]
): void {
  if (!ctx || ctx.bypass || !ctx.restricted) return
  if (ctx.allowedAccountIds.size === 0) {
    conditions.push('1=0')
    return
  }
  const { sql: inSql, params: inParams } = buildAccountIdInClause(ctx.allowedAccountIds)
  conditions.push(`${column} IN (${inSql})`)
  params.push(...inParams)
}

export function isAccountIdInScope(
  ctx: AccountScopeContext | undefined,
  accountId: string | null | undefined
): boolean {
  if (!ctx || ctx.bypass || !ctx.restricted) return true
  if (!accountId) return false
  return ctx.allowedAccountIds.has(accountId)
}

export function assertAccountIdInScope(
  ctx: AccountScopeContext | undefined,
  accountId: string | null | undefined
): string | null {
  if (!ctx || ctx.bypass || !ctx.restricted) return null
  if (!accountId) return '缺少会计科目'
  if (ctx.allowedAccountIds.size === 0) return '未配置任何可操作的会计科目'
  if (!ctx.allowedAccountIds.has(accountId)) return '无权操作该会计科目'
  return null
}

/** 批量校验科目 ID；任一越权则返回错误信息 */
export function assertAccountIdsInScope(
  ctx: AccountScopeContext | undefined,
  accountIds: string[] | undefined
): string | null {
  if (!accountIds?.length) return null
  for (const id of accountIds) {
    const err = assertAccountIdInScope(ctx, id)
    if (err) return err
  }
  return null
}

/**
 * 校验某张凭证的全部分录科目都在授权范围内（用于出纳/资产生成凭证后的科目授权校验）。
 * 在同一事务内调用（凭证及分录已插入但未提交），越权返回错误信息以便抛出回滚。
 */
export function assertVoucherEntriesInScopeById(
  database: Database.Database,
  ctx: AccountScopeContext | undefined,
  voucherId: string,
  accountSetId: string
): string | null {
  if (!ctx || ctx.bypass || !ctx.restricted) return null
  const rows = database
    .prepare('SELECT account_id FROM voucher_entries WHERE voucher_id = ? AND account_set_id = ?')
    .all(voucherId, accountSetId) as Array<{ account_id: string | null }>
  return assertAccountIdsInScope(ctx, rows.map(r => r.account_id || ''))
}

/** 期初/清理：受限且未指定科目时，仅操作授权科目列表 */
export function resolveScopedAccountIdsForClear(
  ctx: AccountScopeContext | undefined,
  accountIds: string[] | undefined
): string[] | undefined {
  if (!ctx || ctx.bypass || !ctx.restricted) return accountIds
  if (accountIds?.length) return accountIds
  if (ctx.allowedAccountIds.size === 0) return []
  return Array.from(ctx.allowedAccountIds)
}

/** 受限用户不可执行全账套辅助期初清理 */
export function assertAuxAllAccountsClearAllowed(
  ctx: AccountScopeContext | undefined
): string | null {
  if (!ctx || ctx.bypass || !ctx.restricted) return null
  return '无权执行全账套辅助期初清理'
}

/** 账簿结果行按 account_id 过滤（用于汇总后剔除未授权科目） */
export function filterLedgerRowsByScope<T extends { account_id?: string }>(
  ctx: AccountScopeContext | undefined,
  rows: T[]
): T[] {
  if (!ctx || ctx.bypass || !ctx.restricted) return rows
  if (ctx.allowedAccountIds.size === 0) return []
  return rows.filter(row => row.account_id && ctx.allowedAccountIds.has(row.account_id))
}

/** 校验科目编码前缀是否落在授权范围内（至少有一个匹配科目已授权） */
export function assertAccountCodePrefixInScope(
  database: Database.Database,
  ctx: AccountScopeContext | undefined,
  accountSetId: string,
  codePrefix: string | undefined
): string | null {
  if (!ctx || ctx.bypass || !ctx.restricted || !codePrefix?.trim()) return null
  const row = database
    .prepare(
      `SELECT id FROM accounts
       WHERE account_set_id = ? AND code LIKE ? AND is_enabled = 1
       LIMIT 1`
    )
    .get(accountSetId, `${codePrefix.trim()}%`) as { id: string } | undefined
  if (!row) return null
  if (!ctx.allowedAccountIds.has(row.id)) return '无权查看该科目范围的数据'
  return null
}
