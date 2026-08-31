import { describe, expect, it } from 'vitest'
import {
  buildAccountInitBalanceExpr,
  buildCashJournalQuery,
  buildGeneralLedgerQuery,
  buildLedgerDetailQuery,
  buildLedgerGeneralQuery,
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
    expect(query.initBalanceSql).toContain('ve.dept_id = ?')
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
})
