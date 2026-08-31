type SqlParam = string | number

function buildWhereClause(conditions: string[]) {
  if (conditions.length === 0) {
    return ''
  }

  return ` WHERE ${conditions.join(' AND ')}`
}

/** 操作日志 IP 筛选：本机回环地址互通，其余模糊匹配 */
export function buildLogIpAddressFilter(ipAddress: string): { sql: string; params: SqlParam[] } {
  const ip = ipAddress.trim()
  const isLoopbackQuery = /127\.0\.0\.1|::1|0:0:0:0:0:0:0:1|本机/i.test(ip)

  if (isLoopbackQuery) {
    return {
      sql: '(ip_address LIKE ? OR ip_address LIKE ? OR ip_address LIKE ? OR ip_address = ?)',
      params: ['%127.0.0.1%', '%::1%', '%::ffff:127.0.0.1%', '127.0.0.1'],
    }
  }

  return {
    sql: 'ip_address LIKE ?',
    params: [`%${ip}%`],
  }
}

export function buildSystemUsersQuery(filters: {
  currentAccountSetId: string
}) {
  const conditions = ['u.account_set_id = ?']
  const params: SqlParam[] = [filters.currentAccountSetId]

  return {
    sql: `
      SELECT u.id, u.username, u.nickname, u.email, u.phone, u.status, u.last_login_at, u.created_at,
             u.account_set_id, u.role_id, u.permission_mode, u.custom_permissions, a.name as account_set_name,
             r.name as role_name, r.is_personal as is_personal_role
      FROM users u
      LEFT JOIN roles r ON u.role_id = r.id AND r.account_set_id = u.account_set_id
      LEFT JOIN account_sets a ON a.id = u.account_set_id
      ${buildWhereClause(conditions)}
    `,
    params,
  }
}

export function getUserRoles(db: any, userId: string, accountSetId: string): Array<{ role_id: string; role_name: string }> {
  return db
    .prepare(`
      SELECT ur.role_id, r.name as role_name
      FROM user_roles ur
      LEFT JOIN roles r ON ur.role_id = r.id
      WHERE ur.user_id = ? AND ur.account_set_id = ?
      ORDER BY ur.created_at
    `)
    .all(userId, accountSetId) as Array<{ role_id: string; role_name: string }>
}

export function buildSystemLogsQuery(filters: {
  accountSetId: string
  page: number
  pageSize: number
  userId?: string
  action?: string
  module?: string
  ipAddress?: string
  startDate?: string
  endDate?: string
}) {
  const conditions = ['account_set_id = ?']
  const params: SqlParam[] = [filters.accountSetId]

  if (filters.userId) {
    conditions.push('user_id = ?')
    params.push(filters.userId)
  }

  if (filters.action) {
    conditions.push('action LIKE ?')
    params.push(`%${filters.action}%`)
  }

  if (filters.module) {
    conditions.push('module = ?')
    params.push(filters.module)
  }

  if (filters.ipAddress) {
    const ipFilter = buildLogIpAddressFilter(filters.ipAddress)
    conditions.push(ipFilter.sql)
    params.push(...ipFilter.params)
  }

  if (filters.startDate) {
    conditions.push('created_at >= ?')
    params.push(filters.startDate)
  }

  if (filters.endDate) {
    conditions.push('created_at <= ?')
    params.push(`${filters.endDate} 23:59:59`)
  }

  const whereClause = buildWhereClause(conditions)
  const offset = (filters.page - 1) * filters.pageSize

  return {
    countSql: `SELECT COUNT(*) as count FROM operation_logs${whereClause}`,
    listSql: `
      SELECT * FROM operation_logs
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `,
    countParams: params,
    listParams: [...params, filters.pageSize, offset],
  }
}
