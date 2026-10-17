import { describe, expect, it } from 'vitest'
import {
  buildAccountInitBalanceExpr,
  buildCashJournalQuery,
  buildGeneralLedgerQuery,
  buildLedgerDetailQuery,
  buildLedgerGeneralQuery,
  buildQuantityBalanceQuery,
  buildForeignBalanceQuery,
} from '../services/ledgerQuery.js'

describe('ledgerQuery', () => {
  it('科目余额表期初应区分辅助明细与科目级，避免重复汇总', () => {
    const query = buildLedgerGeneralQuery({
      accountSetId: 'as-1',
      startDate: '2026-01-01',
      endDate: '2026-01-31',
    })
    expect(query.sql).toContain("COALESCE(ib.aux_item_id, '') = ''")
    expect(query.sql).not.toMatch(
      /SELECT SUM\(ib\.init_balance\) FROM init_balances ib[\s\S]*?WHERE ib\.account_id = a\.id/
    )
  })

  it('buildAccountInitBalanceExpr 占位符顺序为 account_id, account_set_id, year', () => {
    const expr = buildAccountInitBalanceExpr('a.id')
    const idxAccount = expr.indexOf('ib.account_id')
    const idxSet = expr.indexOf('ib.account_set_id')
    const idxYear = expr.indexOf('ib.year')
    expect(idxAccount).toBeLessThan(idxSet)
    expect(idxSet).toBeLessThan(idxYear)
  })

  it('明细账按科目 ID 查询时，期初 SQL 参数数量应与占位符一致', () => {
    const query = buildLedgerDetailQuery({
      accountSetId: 'account-set-1',
      accountId: 'account-1',
      startDate: '2026-01-01',
      endDate: '2026-01-31',
      page: 1,
      pageSize: 20,
    })

    const placeholderCount = (query.initBalanceSql.match(/\?/g) || []).length

    expect(query.initBalanceParams).toHaveLength(placeholderCount)
  })

  it('总分类账期初应区分辅助明细与科目级，避免重复汇总', () => {
    const query = buildGeneralLedgerQuery({
      accountSetId: 'as-1',
      year: 2026,
    })
    expect(query.sql).toContain("COALESCE(ib.aux_item_id, '') = ''")
    expect(query.sql).not.toMatch(
      /SELECT SUM\(ib\.init_balance\) FROM init_balances ib[\s\S]*?WHERE ib\.account_id = a\.id/
    )
  })

  it('明细账期初应区分辅助明细与科目级', () => {
    const query = buildLedgerDetailQuery({
      accountSetId: 'as-1',
      accountId: 'acc-1',
      startDate: '2026-01-01',
      endDate: '2026-01-31',
      page: 1,
      pageSize: 20,
    })
    expect(query.initBalanceSql).toContain("COALESCE(ib.aux_item_id, '') = ''")
  })

  it('日记账结转 SQL 应按科目余额方向计算', () => {
    const query = buildCashJournalQuery({
      accountSetId: 'as-1',
      accountId: 'acc-1',
      startDate: '2026-01-01',
      endDate: '2026-01-31',
      page: 2,
      pageSize: 20,
    })
    expect(query.carryAmountSql).toContain('account_direction')
    expect(query.listSql).toContain('account_direction')
  })

  it('明细账按辅助项目筛选时只取对应 aux_item_id 期初', () => {
    const query = buildLedgerDetailQuery({
      accountSetId: 'as-1',
      accountId: 'acc-1',
      auxType: 'dept',
      auxId: 'dept-1',
      startDate: '2026-01-01',
      endDate: '2026-01-31',
      page: 1,
      pageSize: 20,
    })
    expect(query.initBalanceSql).toContain('ib.aux_item_id = ?')
    // FIX-152：辅助过滤改为 aux_data JSON + legacy 固定列双匹配
    expect(query.initBalanceSql).toContain('ve.dept_id IN (?)')
    expect(query.initBalanceSql).toContain("json_extract(ve.aux_data, '$.dept.id') IN (?)")
    expect(query.initBalanceParams).toContain('dept:dept-1')
    expect(query.initBalanceSql).not.toContain("COALESCE(ib.aux_item_id, '') = ''")
  })

  it('现金日记账期初应去重且仅汇总末级科目', () => {
    const query = buildCashJournalQuery({
      accountSetId: 'as-1',
      accountType: 'cash',
      year: 2026,
      period: 1,
      page: 1,
      pageSize: 20,
    })
    expect(query.initBalanceSql).toContain("COALESCE(ib.aux_item_id, '') = ''")
    expect(query.initBalanceSql).toContain('child.parent_id = a.id')
    const placeholderCount = (query.initBalanceSql.match(/\?/g) || []).length
    expect(query.initBalanceParams).toHaveLength(placeholderCount)
  })

  it('现金日记账按科目查询时期初参数数量应与占位符一致', () => {
    const query = buildCashJournalQuery({
      accountSetId: 'as-1',
      accountId: 'acc-1001',
      startDate: '2026-01-01',
      endDate: '2026-01-31',
      page: 1,
      pageSize: 20,
    })
    const placeholderCount = (query.initBalanceSql.match(/\?/g) || []).length
    expect(query.initBalanceParams).toHaveLength(placeholderCount)
    expect(query.initBalanceSql).not.toContain('ib.account_id = ? OR')
  })

  it('明细账按科目编码范围查询时，期初 SQL 参数数量应与占位符一致', () => {
    const query = buildLedgerDetailQuery({
      accountSetId: 'account-set-1',
      accountCodeStart: '1001',
      accountCodeEnd: '1001z',
      startDate: '2026-01-01',
      endDate: '2026-01-31',
      page: 1,
      pageSize: 20,
    })

    const placeholderCount = (query.initBalanceSql.match(/\?/g) || []).length

    expect(query.initBalanceParams).toHaveLength(placeholderCount)
  })

  it('明细账原币期初 SQL 在科目 id / 编码区间 / 无科目三种分支下参数数量都与占位符一致', () => {
    const cases = [
      { accountId: 'acc-1' },
      { accountCodeStart: '1002', accountCodeEnd: '10029999' },
      { accountCodeStart: '1002', accountCodeEnd: '10029999', currencyCode: 'usd' },
      {},
    ]
    for (const extra of cases) {
      const query = buildLedgerDetailQuery({
        accountSetId: 'as-1',
        startDate: '2026-03-01',
        endDate: '2026-03-31',
        page: 1,
        pageSize: 20,
        ...extra,
      })
      const placeholderCount = (query.foreignInitBalanceSql.match(/\?/g) || []).length
      expect(query.foreignInitBalanceParams).toHaveLength(placeholderCount)
      expect(query.foreignInitBalanceSql).toContain('foreign_init_balance')
    }
  })

  it('明细账编码区间带币种时，分录按分录币种过滤（空则回退科目缺省）', () => {
    const query = buildLedgerDetailQuery({
      accountSetId: 'as-1',
      accountCodeStart: '1002',
      accountCodeEnd: '10029999',
      currencyCode: 'usd',
      startDate: '2026-01-01',
      endDate: '2026-12-31',
      page: 1,
      pageSize: 20,
    })
    expect(query.listSql).toContain("UPPER(COALESCE(NULLIF(ve.currency_code, '')")
    expect(query.listParams).toContain('USD')
    expect(query.foreignInitBalanceSql).toContain("UPPER(COALESCE(NULLIF(ve.currency_code, ''), a.currency_code, '')) = ?")
    expect(query.foreignInitBalanceSql).toContain("UPPER(COALESCE(a.currency_code, '')) = ?")
    expect(query.foreignInitBalanceParams).toContain('USD')
    // 区间原币期初只取叶子科目，避免父科目重复
    expect(query.foreignInitBalanceSql).toContain('NOT EXISTS')
  })

  it('FIX-148：编码区间单边界（只传 start 或只传 end）时期初 / 原币期初 / 账前发生额也走区间分支且占位符对齐', () => {
    for (const extra of [{ accountCodeStart: '1002' }, { accountCodeEnd: '1002zzz' }]) {
      const query = buildLedgerDetailQuery({
        accountSetId: 'as-1',
        startDate: '2026-02-01',
        endDate: '2026-03-31',
        page: 1,
        pageSize: 20,
        preBookEnabled: true,
        accountSetStartDate: '2026-03-01', // 账前发生额归属 2026-02-28，落在区间内
        ...extra,
      })
      expect(query.initBalanceSql).not.toMatch(/SELECT 0 as init_balance/)
      expect(query.initBalanceSql).toContain('init_balances')
      expect((query.initBalanceSql.match(/\?/g) || []).length).toBe(query.initBalanceParams.length)
      expect((query.foreignInitBalanceSql.match(/\?/g) || []).length).toBe(query.foreignInitBalanceParams.length)
      expect(query.foreignInitBalanceSql).not.toMatch(/SELECT 0 as foreign_init_balance/)
      expect((query.preBookSql.match(/\?/g) || []).length).toBe(query.preBookParams.length)
      expect(query.preBookSql).not.toBe('SELECT 0 as pre_book_debit, 0 as pre_book_credit')
    }
  })

  // FIX-250：十万级压测 P0-1——余额表分录发生额必须走一次性聚合 CTE，不能回到逐科目相关子查询
  describe('余额表分录聚合（FIX-250）', () => {
    const base = { accountSetId: 'as-1', startDate: '2026-09-01', endDate: '2026-09-30' }
    const cases = [
      ['科目余额表', buildLedgerGeneralQuery(base)],
      ['数量金额表', buildQuantityBalanceQuery(base)],
      ['外币余额表', buildForeignBalanceQuery(base)],
    ] as const

    it.each(cases)('%s 使用 entry_agg CTE 且凭证驱动 CROSS JOIN', (_name, q) => {
      expect(q.sql).toMatch(/WITH entry_agg AS/)
      expect(q.sql).toMatch(/FROM vouchers v\s+CROSS JOIN voucher_entries ve/)
      expect(q.sql).toMatch(/LEFT JOIN entry_agg m ON m\.account_id = a\.id/)
      // 不允许再出现按科目逐个反查分录的相关子查询
      expect(q.sql).not.toMatch(/FROM voucher_entries ve[\s\S]*?WHERE ve\.account_id = a\.id/)
    })

    it.each(cases)('%s 占位符数量与参数一致', (_name, q) => {
      expect(q.params).toHaveLength((q.sql.match(/\?/g) || []).length)
    })

    it('缺省日期区间为当年全年而不是当月（避免窄区间劣化计划）', () => {
      const y = new Date().getFullYear()
      const q = buildLedgerGeneralQuery({ accountSetId: 'as-1' })
      expect(q.params).toContain(`${y}-01-01`)
      expect(q.params).toContain(`${y}-12-31`)
      // 不应出现任何「某月 1 日」形式的月初日期（年初除外）
      const monthStarts = q.params.filter(
        p => typeof p === 'string' && /^\d{4}-\d{2}-01$/.test(p) && !p.endsWith('-01-01')
      )
      expect(monthStarts).toEqual([])
    })
  })
})
