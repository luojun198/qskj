import { describe, it, expect } from 'vitest'
import { buildVoucherListQuery, VOUCHER_TYPE_ORDER_BY_SQL } from '../services/voucherQuery.js'

describe('voucherQuery', () => {
  // 模拟数据库
  const mockDb = {
    prepare: (sql: string) => ({
      get: () => ({ count: 100 }),
      all: () => [],
    }),
  } as any

  describe('buildVoucherListQuery', () => {
    it('基础查询不应该 JOIN voucher_entries', () => {
      const filters = {
        accountSetId: 'test-set',
        page: 1,
        pageSize: 50,
      }
      const result = buildVoucherListQuery(filters, mockDb)

      expect(result.listSql).not.toContain('LEFT JOIN voucher_entries')
      expect(result.listSql).not.toContain('DISTINCT')
    })

    it('有科目筛选时应该 JOIN voucher_entries', () => {
      const filters = {
        accountSetId: 'test-set',
        page: 1,
        pageSize: 50,
        accountId: 'account-123',
      }
      const result = buildVoucherListQuery(filters, mockDb)

      expect(result.listSql).toContain('LEFT JOIN voucher_entries')
      expect(result.listSql).toContain('DISTINCT')
    })

    it('有辅助核算筛选时应该 JOIN voucher_entries', () => {
      const filters = {
        accountSetId: 'test-set',
        page: 1,
        pageSize: 50,
        auxItems: { dept: [1, 2, 3] },
      }
      const result = buildVoucherListQuery(filters, mockDb)

      expect(result.listSql).toContain('LEFT JOIN voucher_entries')
      expect(result.listSql).toContain('DISTINCT')
    })

    it('游标分页应该使用 LIMIT 而不是 OFFSET', () => {
      const filters = {
        accountSetId: 'test-set',
        page: 1,
        pageSize: 50,
        useCursor: true,
      }
      const result = buildVoucherListQuery(filters, mockDb)

      expect(result.listSql).toContain('LIMIT ?')
      expect(result.listSql).not.toContain('OFFSET')
      expect(result.listParams).toHaveLength(2) // accountSetId + pageSize
    })

    it('传统分页应该使用 LIMIT 和 OFFSET', () => {
      const filters = {
        accountSetId: 'test-set',
        page: 2,
        pageSize: 50,
        useCursor: false,
      }
      const result = buildVoucherListQuery(filters, mockDb)

      expect(result.listSql).toContain('LIMIT ?')
      expect(result.listSql).toContain('OFFSET')
      expect(result.listParams).toHaveLength(3) // accountSetId + pageSize + offset
      expect(result.listParams[2]).toBe(50) // (page-1) * pageSize = 1 * 50
    })

    it('游标分页应该添加游标条件', () => {
      const cursorData = { sortValue: '2026-05-13', voucherNo: '记-001' }
      const cursor = Buffer.from(JSON.stringify(cursorData)).toString('base64')

      const filters = {
        accountSetId: 'test-set',
        page: 1,
        pageSize: 50,
        useCursor: true,
        cursor,
        sortField: 'voucher_date',
        sortOrder: 'desc',
      }
      const result = buildVoucherListQuery(filters, mockDb)

      // 应该包含游标条件
      expect(result.listSql).toContain('v.voucher_date')
      // 降序排序应该使用 < 比较
      expect(result.listSql).toMatch(/v\.voucher_date\s*</)
    })

    it('pageSize 为 -1 时 capped 为 MAX_PAGE_SIZE', () => {
      const filters = {
        accountSetId: 'test-set',
        page: 1,
        pageSize: -1,
      }
      const result = buildVoucherListQuery(filters, mockDb)

      expect(result.listSql).toContain('LIMIT')
      expect(result.listParams[result.listParams.length - 2]).toBe(1000)
    })

    it('应该支持多种排序字段', () => {
      const sortFields = ['voucher_date', 'voucher_no', 'created_at']

      sortFields.forEach(field => {
        const filters = {
          accountSetId: 'test-set',
          page: 1,
          pageSize: 50,
          sortField: field,
          sortOrder: 'asc',
        }
        const result = buildVoucherListQuery(filters, mockDb)

        expect(result.listSql).toContain('ORDER BY')
        expect(result.listSql).toContain('ASC')
      })
    })

    it('应该防止 SQL 注入（非法排序字段）', () => {
      const filters = {
        accountSetId: 'test-set',
        page: 1,
        pageSize: 50,
        sortField: 'DROP TABLE vouchers; --',
        sortOrder: 'asc',
      }
      const result = buildVoucherListQuery(filters, mockDb)

      // 非法字段应该被忽略，使用默认排序
      expect(result.listSql).not.toContain('DROP TABLE')
      expect(result.listSql).toContain('v.voucher_date') // 默认排序字段
    })

    it('ORDER BY 应优先按凭证类型编码排序，再按用户字段', () => {
      const filters = {
        accountSetId: 'test-set',
        page: 1,
        pageSize: 50,
        sortField: 'voucher_date',
        sortOrder: 'desc',
      }
      const result = buildVoucherListQuery(filters, mockDb)

      expect(result.listSql).toContain('CAST(vt.code AS INTEGER)')
      expect(result.listSql).toContain('COALESCE(vt.code')
      expect(result.listSql).toContain('COALESCE(vt.sort_order')

      const orderByIndex = result.listSql.indexOf('ORDER BY')
      const typeCodeIndex = result.listSql.indexOf('vt.code', orderByIndex)
      const voucherDateIndex = result.listSql.indexOf('v.voucher_date', orderByIndex)
      expect(typeCodeIndex).toBeGreaterThan(orderByIndex)
      expect(voucherDateIndex).toBeGreaterThan(typeCodeIndex)
    })

    it('VOUCHER_TYPE_ORDER_BY_SQL 应包含数值编码排序规则', () => {
      expect(VOUCHER_TYPE_ORDER_BY_SQL).toContain("NOT GLOB '*[^0-9]*'")
      expect(VOUCHER_TYPE_ORDER_BY_SQL).toContain('CAST(vt.code AS INTEGER)')
    })
  })

  describe('查询优化验证', () => {
    it('条件性 JOIN 应该减少不必要的 DISTINCT', () => {
      const withoutJoin = buildVoucherListQuery(
        { accountSetId: 'test', page: 1, pageSize: 50 },
        mockDb
      )
      const withJoin = buildVoucherListQuery(
        { accountSetId: 'test', page: 1, pageSize: 50, accountId: 'acc-1' },
        mockDb
      )

      expect(withoutJoin.listSql).not.toContain('DISTINCT')
      expect(withJoin.listSql).toContain('DISTINCT')
    })

    it('游标分页应该比传统分页参数更少', () => {
      const traditional = buildVoucherListQuery(
        { accountSetId: 'test', page: 10, pageSize: 50 },
        mockDb
      )
      const cursor = buildVoucherListQuery(
        { accountSetId: 'test', page: 1, pageSize: 50, useCursor: true },
        mockDb
      )

      // 游标分页不需要 OFFSET，参数更少
      expect(cursor.listParams.length).toBeLessThan(traditional.listParams.length)
    })
  })
})
