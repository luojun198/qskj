/**
 * SQL 安全查询构建器
 * 提供参数化查询工具，消除 SQL 注入风险
 */

export interface QueryCondition {
  sql: string
  params: any[]
}

/**
 * 安全查询构建器类
 * 用于构建带参数化占位符的 SQL 查询
 */
export class SafeQueryBuilder {
  private conditions: string[] = []
  private params: any[] = []

  /**
   * 添加查询条件
   * @param condition SQL 条件字符串（使用 ? 占位符）
   * @param params 参数值
   */
  addCondition(condition: string, ...params: any[]): this {
    this.conditions.push(condition)
    this.params.push(...params)
    return this
  }

  /**
   * 添加可选条件（仅当值存在时添加）
   * @param value 条件值
   * @param condition SQL 条件字符串
   * @param params 参数值（如果不提供，使用 value）
   */
  addOptionalCondition(value: any, condition: string, ...params: any[]): this {
    if (value !== undefined && value !== null && value !== '') {
      const actualParams = params.length > 0 ? params : [value]
      this.addCondition(condition, ...actualParams)
    }
    return this
  }

  /**
   * 添加 IN 条件
   * @param column 列名
   * @param values 值数组
   */
  addInCondition(column: string, values: any[]): this {
    if (values && values.length > 0) {
      const placeholders = values.map(() => '?').join(',')
      this.addCondition(`${column} IN (${placeholders})`, ...values)
    }
    return this
  }

  /**
   * 添加日期范围条件
   * @param column 列名
   * @param startDate 开始日期
   * @param endDate 结束日期
   */
  addDateRangeCondition(column: string, startDate?: string, endDate?: string): this {
    if (startDate) {
      this.addCondition(`${column} >= ?`, startDate)
    }
    if (endDate) {
      this.addCondition(`${column} <= ?`, endDate)
    }
    return this
  }

  /**
   * 添加 LIKE 条件
   * @param column 列名
   * @param keyword 关键词
   * @param matchType 匹配类型：'contains' | 'startsWith' | 'endsWith'
   */
  addLikeCondition(column: string, keyword: string, matchType: 'contains' | 'startsWith' | 'endsWith' = 'contains'): this {
    if (keyword) {
      let pattern: string
      switch (matchType) {
        case 'startsWith':
          pattern = `${keyword}%`
          break
        case 'endsWith':
          pattern = `%${keyword}`
          break
        case 'contains':
        default:
          pattern = `%${keyword}%`
          break
      }
      this.addCondition(`${column} LIKE ?`, pattern)
    }
    return this
  }

  /**
   * 添加范围查询条件（用于科目编码等）
   * @param column 列名
   * @param code 编码前缀
   */
  addCodeRangeCondition(column: string, code: string): this {
    if (code) {
      // 使用范围查询替代 LIKE，性能更好
      const nextCode = code.slice(0, -1) + String.fromCharCode(code.charCodeAt(code.length - 1) + 1)
      this.addCondition(`${column} >= ? AND ${column} < ?`, code, nextCode)
    }
    return this
  }

  /**
   * 构建 WHERE 子句
   * @returns WHERE 子句和参数
   */
  build(): QueryCondition {
    return {
      sql: this.conditions.length > 0 ? `WHERE ${this.conditions.join(' AND ')}` : '',
      params: this.params
    }
  }

  /**
   * 构建 WHERE 子句（使用 OR 连接）
   * @returns WHERE 子句和参数
   */
  buildOr(): QueryCondition {
    return {
      sql: this.conditions.length > 0 ? `WHERE ${this.conditions.join(' OR ')}` : '',
      params: this.params
    }
  }

  /**
   * 获取条件数量
   */
  get count(): number {
    return this.conditions.length
  }

  /**
   * 清空所有条件
   */
  clear(): this {
    this.conditions = []
    this.params = []
    return this
  }
}

/**
 * 辅助函数：构建分页 SQL
 * @param pageSize 每页数量
 * @param page 页码（从 1 开始）
 */
export function buildPagination(pageSize: number, page: number): QueryCondition {
  const limit = Math.max(1, Math.min(pageSize, 1000)) // 限制最大 1000 条
  const offset = Math.max(0, (page - 1) * limit)
  return {
    sql: 'LIMIT ? OFFSET ?',
    params: [limit, offset]
  }
}

/**
 * 辅助函数：构建排序 SQL
 * @param orderBy 排序字段
 * @param order 排序方向
 */
export function buildOrderBy(orderBy?: string, order?: 'ASC' | 'DESC'): string {
  if (!orderBy) return ''

  // 白名单验证，防止 SQL 注入
  const allowedColumns = /^[a-zA-Z_][a-zA-Z0-9_]*(\.[a-zA-Z_][a-zA-Z0-9_]*)?$/
  if (!allowedColumns.test(orderBy)) {
    throw new Error('Invalid order by column')
  }

  const direction = order === 'DESC' ? 'DESC' : 'ASC'
  return `ORDER BY ${orderBy} ${direction}`
}

/**
 * 辅助函数：安全地转义 LIKE 模式中的特殊字符
 * @param pattern LIKE 模式
 */
export function escapeLikePattern(pattern: string): string {
  return pattern.replace(/[%_]/g, '\\$&')
}
