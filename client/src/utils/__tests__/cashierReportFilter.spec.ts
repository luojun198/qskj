import { describe, expect, it } from 'vitest'
import {
  AUX_NONE, applyDrillPath, defaultCashierFilter, filterFromRouteQuery, filterToRouteQuery,
  quickDateRange, toReportPayload, toSearchParams, activeFilterCount,
  auxItemIdsOf, withAuxItemIds, toJournalDetailParams, journalDetailCount,
} from '../cashierReportFilter'

describe('cashierReportFilter', () => {
  it('空条件不进请求体，辅助项目转 snake_case', () => {
    const s = defaultCashierFilter()
    s.dateRange = ['2026-09-01', '2026-09-30']
    s.aux = [{ categoryId: 'c1', itemIds: ['i1', AUX_NONE] }]
    s.voucherStatus = ['draft']
    const p = toReportPayload(s)
    expect(p).toEqual({
      start_date: '2026-09-01', end_date: '2026-09-30',
      aux: [{ category_id: 'c1', item_ids: ['i1', AUX_NONE] }],
      voucher_status: ['draft'],
    })
    const q = toSearchParams(s)
    expect(q.voucher_status).toBe('draft')
    expect(JSON.parse(q.aux as string)).toEqual([{ category_id: 'c1', item_ids: ['i1', AUX_NONE] }])
  })

  it('路由往返：钻取参数能还原，损坏参数返回 null', () => {
    const s = defaultCashierFilter()
    s.accountCodes = ['1002']
    s.counterAccounts = ['6602']
    const q = filterToRouteQuery(s)
    expect(filterFromRouteQuery(q)?.accountCodes).toEqual(['1002'])
    expect(filterFromRouteQuery({ f: '{bad' })).toBeNull()
    expect(filterFromRouteQuery({})).toBeNull()
  })

  it('汇总钻取：路径叠加到筛选（科目 / 月份 / 辅助项目 / 未指定）', () => {
    const base = defaultCashierFilter()
    const s = applyDrillPath(base, [
      { dimension: 'account', key: '1001' },
      { dimension: 'month', key: '2026-02' },
      { dimension: 'aux:cat1', key: 'item1' },
    ])
    expect(s.accountCodes).toEqual(['1001'])
    expect(s.dateRange).toEqual(['2026-02-01', '2026-02-28'])
    expect(s.aux).toEqual([{ categoryId: 'cat1', itemIds: ['item1'] }])
    const none = applyDrillPath(base, [{ dimension: 'aux:cat1', key: '' }])
    expect(none.aux[0].itemIds).toEqual([AUX_NONE])
    // 不修改原对象
    expect(base.accountCodes).toEqual([])
  })

  it('快捷日期与筛选计数', () => {
    const now = new Date(2026, 8, 30)
    expect(quickDateRange('lastMonth', now)).toEqual(['2026-08-01', '2026-08-31'])
    expect(quickDateRange('quarter', now)).toEqual(['2026-07-01', '2026-09-30'])
    expect(quickDateRange('year', now)).toEqual(['2026-01-01', '2026-09-30'])
    const s = defaultCashierFilter()
    expect(activeFilterCount(s)).toBe(0)
    s.settleTypes = ['01']; s.minAmount = 10
    expect(activeFilterCount(s)).toBe(2)
  })

  it('表头筛选：辅助类别项目的读写，重置（空数组）取消该类别筛选', () => {
    const s = defaultCashierFilter()
    const a = withAuxItemIds(s, 'c1', ['i1', 'i2'])
    expect(auxItemIdsOf(a, 'c1')).toEqual(['i1', 'i2'])
    const b = withAuxItemIds(a, 'c2', ['x'])
    expect(b.aux).toHaveLength(2)
    const c = withAuxItemIds(b, 'c1', [])
    expect(c.aux).toEqual([{ categoryId: 'c2', itemIds: ['x'] }])
    expect(s.aux).toEqual([]) // 不修改原对象
  })

  it('流水账表头筛选：只带明细条件（不带日期 / 账户 / 币种），并统计生效项数', () => {
    const s = defaultCashierFilter()
    s.dateRange = ['2026-09-01', '2026-09-30']
    s.accountCodes = ['1002']
    s.settleTypes = ['01']
    s.summary = '差旅'
    s.reconciled = 0
    s.aux = [{ categoryId: 'c1', itemIds: [AUX_NONE] }]
    const p = toJournalDetailParams(s)
    expect(Object.keys(p).sort()).toEqual(['aux', 'reconciled', 'settle_types', 'summary'])
    expect(p.settle_types).toBe('01')
    expect(p.reconciled).toBe(0)
    expect(journalDetailCount(s)).toBe(4)
    expect(journalDetailCount(defaultCashierFilter())).toBe(0)
  })
})
