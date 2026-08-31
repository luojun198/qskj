import type Database from 'better-sqlite3'
import {
  buildVoucherAllEntriesInScopeSql,
  type AccountScopeContext,
} from './accountAuthorization.js'
import { MAX_PAGE_SIZE, parsePageSizeParam } from '../utils/listLimits.js'

export interface VoucherListFilters {
  accountSetId: string
  page: number
  pageSize: number
  year?: string | number
  period?: string | number
  status?: string
  keyword?: string
  startDate?: string
  endDate?: string
  accountId?: string
  accountIds?: number[]
  auditorId?: string
  voucherTypeIds?: string[]
  auxItems?: Record<string, number[]>
  auxFields?: Record<string, string>
  sortField?: string
  sortOrder?: string
  minAmount?: number
  maxAmount?: number
  makerName?: string
  auditorName?: string
  posterName?: string
  // 游标分页参数
  cursor?: string // 上次查询的最后一条记录的游标（base64 编码的 JSON）
  useCursor?: boolean // 是否使用游标分页
  accountScope?: AccountScopeContext
}

export interface BatchVoucherQueryFilters {
  voucherTypeIds: string[]
  accountSetId: string
  startDate: string
  endDate: string
  startNo?: string | number | null
  endNo?: string | number | null
}

export function buildBatchVoucherQuery(
  {
    voucherTypeIds,
    accountSetId,
    startDate,
    endDate,
    startNo,
    endNo,
  }: BatchVoucherQueryFilters,
  accountScope?: AccountScopeContext
) {
  const placeholders = voucherTypeIds.map(() => '?').join(',')
  const conditions = [
    'account_set_id=?',
    `voucher_type_id IN (${placeholders})`,
    'voucher_date>=?',
    'voucher_date<=?',
  ]
  const params: Array<string | number> = [accountSetId, ...voucherTypeIds, startDate, endDate]

  const hasStartNo = startNo !== undefined && startNo !== null && String(startNo).trim() !== ''
  const hasEndNo = endNo !== undefined && endNo !== null && String(endNo).trim() !== ''

  if (hasStartNo) {
    conditions.push("CAST(SUBSTR(voucher_no, INSTR(voucher_no, '-') + 1) AS INTEGER) >= ?")
    params.push(Number(startNo))
  }

  if (hasEndNo) {
    conditions.push("CAST(SUBSTR(voucher_no, INSTR(voucher_no, '-') + 1) AS INTEGER) <= ?")
    params.push(Number(endNo))
  }

  let scopeSql = ''
  const scopeParams: string[] = []
  if (accountScope) {
    const scope = buildVoucherAllEntriesInScopeSql(accountScope, 'vouchers.id', accountSetId)
    scopeSql = ` AND (${scope.sql})`
    scopeParams.push(...scope.params)
  }

  return {
    sql: `SELECT id, voucher_no, status, maker_id FROM vouchers WHERE ${conditions.join(' AND ')}${scopeSql} ORDER BY voucher_date ASC, voucher_no ASC`,
    params: [...params, ...scopeParams],
  }
}

/** 与 baseVoucherType 列表一致的凭证类型编码排序前缀（vt 别名需已 JOIN） */
export const VOUCHER_TYPE_ORDER_BY_SQL = `
  CASE WHEN vt.code IS NOT NULL AND vt.code != '' AND vt.code NOT GLOB '*[^0-9]*' THEN 0 ELSE 1 END ASC,
  CASE WHEN vt.code IS NOT NULL AND vt.code != '' AND vt.code NOT GLOB '*[^0-9]*' THEN CAST(vt.code AS INTEGER) END ASC,
  COALESCE(vt.code, '') COLLATE NOCASE ASC,
  COALESCE(vt.sort_order, 0) ASC`.trim()

export function buildVoucherListQuery(filters: VoucherListFilters, db: Database.Database) {
  const conditions = ['v.account_set_id = ?']
  const params: Array<string | number> = [filters.accountSetId]

  // 判断是否需要 JOIN voucher_entries（仅在需要分录级过滤时）
  const needsEntryJoin = !!(
    filters.accountId ||
    (filters.accountIds && filters.accountIds.length > 0) ||
    filters.auxItems ||
    filters.auxFields
  )

  if (filters.year !== undefined && filters.year !== '') {
    conditions.push('v.year = ?')
    params.push(Number(filters.year))
  }

  if (filters.period !== undefined && filters.period !== '') {
    conditions.push('v.period = ?')
    params.push(Number(filters.period))
  }

  if (filters.status) {
    conditions.push('v.status = ?')
    params.push(filters.status)
  }

  if (filters.startDate) {
    conditions.push('v.voucher_date >= ?')
    params.push(filters.startDate)
  }

  if (filters.endDate) {
    conditions.push('v.voucher_date <= ?')
    params.push(filters.endDate)
  }

  if (filters.auditorId) {
    conditions.push('v.auditor_id = ?')
    params.push(filters.auditorId)
  }

  if (filters.keyword) {
    // 使用 FTS5 全文索引进行搜索
    // unicode61 分词器将连续中文字符视为一个 token（如"安盾安保服务有限公司"）
    // 因此需要追加 * 做前缀匹配，否则 MATCH '安盾' 找不到"安盾安保服务有限公司"
    const rawKeyword = filters.keyword.trim()
    // 追加 * 做前缀匹配，否则 unicode61 分词器下 MATCH '安盾' 找不到"安盾安保服务有限公司"
    const ftsQuery = rawKeyword.endsWith('*') ? rawKeyword : `${rawKeyword}*`

    // 从 FTS5 表中搜索匹配的凭证 ID
    const voucherFtsResults = db
      .prepare(
        `
      SELECT DISTINCT voucher_id FROM vouchers_fts
      WHERE vouchers_fts MATCH ?
    `
      )
      .all(ftsQuery) as Array<{ voucher_id: number }>

    // 从分录 FTS5 表中搜索匹配的凭证 ID
    const entryFtsResults = db
      .prepare(
        `
      SELECT DISTINCT voucher_id FROM voucher_entries_fts
      WHERE voucher_entries_fts MATCH ?
    `
      )
      .all(ftsQuery) as Array<{ voucher_id: number }>

    // 合并两个结果集
    const matchedVoucherIds = new Set<number>()
    voucherFtsResults.forEach(r => matchedVoucherIds.add(r.voucher_id))
    entryFtsResults.forEach(r => matchedVoucherIds.add(r.voucher_id))

    // 如果有匹配结果，添加到查询条件
    if (matchedVoucherIds.size > 0) {
      const voucherIdList = Array.from(matchedVoucherIds)
      const placeholders = voucherIdList.map(() => '?').join(',')
      conditions.push(`v.rowid IN (${placeholders})`)
      params.push(...voucherIdList)
    } else {
      // 没有匹配结果，返回空
      conditions.push('1 = 0')
    }
  }

  if (filters.accountId) {
    conditions.push('EXISTS (SELECT 1 FROM voucher_entries WHERE voucher_id=v.id AND account_id=?)')
    params.push(filters.accountId)
  }

  // 科目多选筛选
  if (filters.accountIds && filters.accountIds.length > 0) {
    const placeholders = filters.accountIds.map(() => '?').join(',')
    conditions.push(
      `EXISTS (SELECT 1 FROM voucher_entries WHERE voucher_id=v.id AND account_id IN (${placeholders}))`
    )
    params.push(...filters.accountIds)
  }

  if (filters.voucherTypeIds && filters.voucherTypeIds.length > 0) {
    const placeholders = filters.voucherTypeIds.map(() => '?').join(',')
    conditions.push(`v.voucher_type_id IN (${placeholders})`)
    params.push(...filters.voucherTypeIds)
  }

  // 辅助核算项目筛选（支持多选）
  // aux_data 格式：{ category_code: { id: itemId, field_values: {...} } }
  // filters.auxItems 的 key 已经是 categoryCode（在路由层转换）
  if (filters.auxItems) {
    for (let [categoryCode, itemIds] of Object.entries(filters.auxItems)) {
      categoryCode = (categoryCode || '').replace(/[^a-zA-Z0-9_]/g, '')
      if (!categoryCode) continue
      if (itemIds && Array.isArray(itemIds) && itemIds.length > 0) {
        const placeholders = itemIds.map(() => '?').join(',')
        conditions.push(
          `EXISTS (SELECT 1 FROM voucher_entries ve2
           WHERE ve2.voucher_id = v.id
           AND json_extract(ve2.aux_data, '$.${categoryCode}.id') IN (${placeholders}))`
        )
        params.push(...itemIds)
      }
    }
  }

  // 辅助核算自定义字段筛选
  // field_values 存储在 aux_data 的 category_code.field_values 中
  // filters.auxFields 的 key 格式：categoryCode_fieldKey（在路由层转换）
  if (filters.auxFields) {
    for (const [key, value] of Object.entries(filters.auxFields)) {
      if (value) {
        // key 格式：categoryCode_fieldKey
        const parts = key.split('_')
        if (parts.length >= 2) {
          const categoryCode = (parts[0] || '').replace(/[^a-zA-Z0-9_]/g, '')
          const fieldKey = (parts.slice(1).join('_') || '').replace(/[^a-zA-Z0-9_]/g, '')
          if (!categoryCode || !fieldKey) continue
          conditions.push(
            `EXISTS (SELECT 1 FROM voucher_entries ve3
             WHERE ve3.voucher_id = v.id
             AND json_extract(ve3.aux_data, '$.${categoryCode}.field_values.${fieldKey}') LIKE ?)`
          )
          params.push(`%${value}%`)
        }
      }
    }
  }

  // 金额范围筛选
  if (filters.minAmount !== undefined && filters.minAmount !== null) {
    conditions.push('v.total_amount >= ?')
    params.push(filters.minAmount)
  }
  if (filters.maxAmount !== undefined && filters.maxAmount !== null) {
    conditions.push('v.total_amount <= ?')
    params.push(filters.maxAmount)
  }

  // 经办人筛选（模糊匹配）
  if (filters.makerName) {
    conditions.push('v.maker_name LIKE ?')
    params.push(`%${filters.makerName}%`)
  }
  if (filters.auditorName) {
    conditions.push('v.auditor_name LIKE ?')
    params.push(`%${filters.auditorName}%`)
  }
  if (filters.posterName) {
    conditions.push('v.poster_name LIKE ?')
    params.push(`%${filters.posterName}%`)
  }

  if (filters.accountScope) {
    const scope = buildVoucherAllEntriesInScopeSql(
      filters.accountScope,
      'v.id',
      filters.accountSetId
    )
    conditions.push(`(${scope.sql})`)
    params.push(...scope.params)
  }

  const whereClause = `WHERE ${conditions.join(' AND ')}`

  // 动态排序：仅允许安全字段，防止 SQL 注入
  const allowedSortFields: Record<string, string> = {
    voucher_date: 'v.voucher_date',
    voucher_no: 'v.voucher_no',
    created_at: 'v.created_at',
    debit_amount:
      "COALESCE((SELECT SUM(amount) FROM voucher_entries WHERE voucher_id=v.id AND direction='debit'), 0)",
    credit_amount:
      "COALESCE((SELECT SUM(amount) FROM voucher_entries WHERE voucher_id=v.id AND direction='credit'), 0)",
  }
  const sortExpr = allowedSortFields[filters.sortField || 'voucher_date'] || 'v.voucher_date'
  const sortDir = filters.sortOrder === 'asc' ? 'ASC' : 'DESC'
  const orderBy = `ORDER BY ${VOUCHER_TYPE_ORDER_BY_SQL}, ${sortExpr} ${sortDir}, v.voucher_no ASC`

  // 游标分页支持
  let cursorCondition = ''
  if (filters.useCursor && filters.cursor) {
    try {
      const cursorData = JSON.parse(Buffer.from(filters.cursor, 'base64').toString('utf-8'))
      const { sortValue, voucherNo } = cursorData

      // 根据排序方向构建游标条件
      if (filters.sortOrder === 'asc') {
        cursorCondition = ` AND ((${sortExpr} > ?) OR (${sortExpr} = ? AND v.voucher_no > ?))`
      } else {
        cursorCondition = ` AND ((${sortExpr} < ?) OR (${sortExpr} = ? AND v.voucher_no > ?))`
      }
      params.push(sortValue, sortValue, voucherNo)
    } catch (err) {
      console.error('解析游标失败:', err)
    }
  }

  const finalWhereClause = whereClause + cursorCondition

  const effectivePageSize = parsePageSizeParam(filters.pageSize, 50)
  const limitClause = filters.useCursor
    ? '\n      LIMIT ?'
    : '\n      LIMIT ? OFFSET ?'

  // 条件性 JOIN：仅在需要分录级过滤时才 JOIN voucher_entries
  // 这样可以避免 5x 行膨胀和 DISTINCT 开销
  const entryJoinClause = needsEntryJoin
    ? 'LEFT JOIN voucher_entries ve ON v.id = ve.voucher_id'
    : ''
  const distinctClause = needsEntryJoin ? 'DISTINCT' : ''

  return {
    countSql: needsEntryJoin
      ? `SELECT COUNT(DISTINCT v.id) as count FROM vouchers v ${entryJoinClause} ${whereClause}`
      : `SELECT COUNT(*) as count FROM vouchers v ${whereClause}`,
    listSql: `
      SELECT ${distinctClause} v.*, vt.name as voucher_type_name
      FROM vouchers v
      LEFT JOIN voucher_types vt ON v.voucher_type_id = vt.id
      ${entryJoinClause}
      ${finalWhereClause}
      ${orderBy}${limitClause}
    `,
    countParams: params.slice(0, params.length - (filters.useCursor && filters.cursor ? 3 : 0)),
    listParams: filters.useCursor
      ? [...params, effectivePageSize]
      : [...params, effectivePageSize, (filters.page - 1) * effectivePageSize],
  }
}
