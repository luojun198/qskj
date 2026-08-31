import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import {
  buildEntriesFromTransferItems,
  resolveVoucherTypeIdByRef,
} from '../services/autoTransfer.js'

/**
 * 支出结转的核心约束：借贷必须平衡
 *
 * 支出（5xxx，借方科目）→ 本年利润（4xxx，贷方科目）：
 *   借：本年利润 X（toDirection=debit，因为 from 是 debit 方向）
 *   贷：管理费用 X（fromDirection=credit，反向冲销）
 *
 * 收入（6xxx，贷方科目）→ 本年利润（4xxx，贷方科目）：
 *   借：主营业务收入 X（fromDirection=debit，反向冲销）
 *   贷：本年利润 X（toDirection=credit）
 *
 * 关键：转入方向 = 转出源科目余额方向（不是转入目标自身方向）
 */
describe('buildEntriesFromTransferItems - 借贷平衡', () => {
  const accounts = [
    { id: 'a-5101', code: '5101', name: '管理费用', direction: 'debit' },
    { id: 'a-5102', code: '5102', name: '销售费用', direction: 'debit' },
    { id: 'a-6001', code: '6001', name: '主营业务收入', direction: 'credit' },
    { id: 'a-4101', code: '4101', name: '本年利润', direction: 'credit' },
  ]

  function makeItem(overrides: Partial<{
    id: string
    type_code: string
    from_code: string | null
    to_code: string | null
    summary: string | null
    transfer_type: 'all' | 'partial'
    ratio: number | null
    sort_order: number | null
  }>) {
    return {
      id: overrides.id || 'item-1',
      type_code: overrides.type_code || 'expense',
      from_code: overrides.from_code ?? null,
      to_code: overrides.to_code ?? null,
      summary: overrides.summary ?? null,
      from_name: null,
      to_name: null,
      transfer_type: overrides.transfer_type || 'all',
      ratio: overrides.ratio ?? null,
      sort_order: overrides.sort_order ?? null,
    }
  }

  it('支出结转（汇总模式）：多个支出科目 → 本年利润，借贷平衡', () => {
    const items = [
      makeItem({ id: 'i1', from_code: '5101', to_code: null }), // source: 管理费用
      makeItem({ id: 'i2', from_code: '5102', to_code: null }), // source: 销售费用
      makeItem({ id: 'i3', from_code: null, to_code: '4101' }), // target: 本年利润
    ]
    const balances: Record<string, { end_balance: number }> = {
      '5101': { end_balance: 100 },
      '5102': { end_balance: 200 },
    }

    const result = buildEntriesFromTransferItems({
      period: 5,
      items,
      accounts,
      getBalanceByCode: code => balances[code] || null,
    })

    const debitTotal = result.entries
      .filter(e => e.direction === 'debit')
      .reduce((s, e) => s + e.amount, 0)
    const creditTotal = result.entries
      .filter(e => e.direction === 'credit')
      .reduce((s, e) => s + e.amount, 0)

    expect(result.entries.length).toBeGreaterThan(0)
    expect(debitTotal).toBeCloseTo(creditTotal, 2)
    expect(debitTotal).toBeCloseTo(300, 2)

    // 转出（管理费用 / 销售费用）应该是 credit（冲销借方余额）
    const fromEntries = result.entries.filter(e => e.account_code === '5101' || e.account_code === '5102')
    expect(fromEntries.every(e => e.direction === 'credit')).toBe(true)

    // 转入（本年利润）应该是 debit（因为转出源是 debit 方向）
    const toEntry = result.entries.find(e => e.account_code === '4101')
    expect(toEntry?.direction).toBe('debit')
    expect(toEntry?.amount).toBeCloseTo(300, 2)
  })

  it('收入结转（汇总模式）：收入科目 → 本年利润，借贷平衡', () => {
    const items = [
      makeItem({ id: 'i1', from_code: '6001', to_code: null }), // source: 主营业务收入
      makeItem({ id: 'i2', from_code: null, to_code: '4101' }), // target: 本年利润
    ]
    const balances: Record<string, { end_balance: number }> = {
      '6001': { end_balance: 500 },
    }

    const result = buildEntriesFromTransferItems({
      period: 5,
      items,
      accounts,
      getBalanceByCode: code => balances[code] || null,
    })

    const debitTotal = result.entries
      .filter(e => e.direction === 'debit')
      .reduce((s, e) => s + e.amount, 0)
    const creditTotal = result.entries
      .filter(e => e.direction === 'credit')
      .reduce((s, e) => s + e.amount, 0)

    expect(debitTotal).toBeCloseTo(creditTotal, 2)
    expect(debitTotal).toBeCloseTo(500, 2)

    // 转出（收入）= debit（冲销贷方）
    const fromEntry = result.entries.find(e => e.account_code === '6001')
    expect(fromEntry?.direction).toBe('debit')

    // 转入（本年利润）= credit（因为转出源是 credit 方向）
    const toEntry = result.entries.find(e => e.account_code === '4101')
    expect(toEntry?.direction).toBe('credit')
  })

  it('支出结转（一对一模式 pair）：管理费用 → 本年利润，借贷平衡', () => {
    const items = [
      makeItem({ id: 'i1', from_code: '5101', to_code: '4101' }),
    ]
    const balances: Record<string, { end_balance: number }> = {
      '5101': { end_balance: 80 },
    }

    const result = buildEntriesFromTransferItems({
      period: 5,
      items,
      accounts,
      getBalanceByCode: code => balances[code] || null,
    })

    const debitTotal = result.entries
      .filter(e => e.direction === 'debit')
      .reduce((s, e) => s + e.amount, 0)
    const creditTotal = result.entries
      .filter(e => e.direction === 'credit')
      .reduce((s, e) => s + e.amount, 0)

    expect(debitTotal).toBeCloseTo(creditTotal, 2)
    expect(debitTotal).toBeCloseTo(80, 2)

    const fromEntry = result.entries.find(e => e.account_code === '5101')
    expect(fromEntry?.direction).toBe('credit') // 冲销借方余额

    const toEntry = result.entries.find(e => e.account_code === '4101')
    expect(toEntry?.direction).toBe('debit') // 本年利润借方减少
  })

  it('回归：target + pair 混用时不应重复结转（曾出现 501 → 1002 翻倍 bug）', () => {
    // 模拟用户实际配置：一个 target（4103 本年利润）+ 一个 pair（6001 → 4103）
    // 修复前：pair 项会被 sourceItems(汇总模式) 处理一次 + 又被 pairItems(独立模式)
    // 处理一次，导致 6001 借方分录翻倍，损益科目永远清不空。
    const accountsLocal = [
      { id: 'a-6001', code: '6001', name: '主营业务收入', direction: 'credit' },
      { id: 'a-4103', code: '4103', name: '本年利润', direction: 'credit' },
    ]
    const items = [
      makeItem({ id: 'i1', from_code: '6001', to_code: '4103' }), // pair
      makeItem({ id: 'i2', from_code: null, to_code: '4103' }), // 独立 target
    ]
    const balances: Record<string, { end_balance: number }> = {
      '6001': { end_balance: 501 },
    }

    const result = buildEntriesFromTransferItems({
      period: 5,
      items,
      accounts: accountsLocal,
      getBalanceByCode: code => balances[code] || null,
    })

    // 6001 借方分录应当只出现一次，且金额 = 501（不是 1002）
    const from6001 = result.entries.filter(e => e.account_code === '6001' && e.direction === 'debit')
    expect(from6001).toHaveLength(1)
    expect(from6001[0].amount).toBeCloseTo(501, 2)

    // 借贷总额平衡
    const debitTotal = result.entries.filter(e => e.direction === 'debit').reduce((s, e) => s + e.amount, 0)
    const creditTotal = result.entries.filter(e => e.direction === 'credit').reduce((s, e) => s + e.amount, 0)
    expect(debitTotal).toBeCloseTo(creditTotal, 2)
    expect(debitTotal).toBeCloseTo(501, 2)
  })

  it('支出结转（一对一模式 pair + 父科目）：父级管理费用 → 本年利润，借贷平衡', () => {
    const accountsWithChild = [
      ...accounts,
      { id: 'a-5101-01', code: '510101', name: '办公费', direction: 'debit' },
      { id: 'a-5101-02', code: '510102', name: '差旅费', direction: 'debit' },
    ]
    const items = [
      makeItem({ id: 'i1', from_code: '5101', to_code: '4101' }),
    ]
    // 模拟父科目返回数组（多个子科目余额）
    const balances: Record<string, any> = {
      '5101': [
        { account_id: 'a-5101-01', account_code: '510101', account_name: '办公费', end_balance: 60 },
        { account_id: 'a-5101-02', account_code: '510102', account_name: '差旅费', end_balance: 40 },
      ],
    }

    const result = buildEntriesFromTransferItems({
      period: 5,
      items,
      accounts: accountsWithChild,
      getBalanceByCode: code => balances[code] || null,
    })

    const debitTotal = result.entries
      .filter(e => e.direction === 'debit')
      .reduce((s, e) => s + e.amount, 0)
    const creditTotal = result.entries
      .filter(e => e.direction === 'credit')
      .reduce((s, e) => s + e.amount, 0)

    expect(debitTotal).toBeCloseTo(creditTotal, 2)
    expect(debitTotal).toBeCloseTo(100, 2)

    // 子科目转出 = credit
    const child1 = result.entries.find(e => e.account_code === '510101')
    const child2 = result.entries.find(e => e.account_code === '510102')
    expect(child1?.direction).toBe('credit')
    expect(child2?.direction).toBe('credit')

    // 本年利润 = debit
    const toEntry = result.entries.find(e => e.account_code === '4101')
    expect(toEntry?.direction).toBe('debit')
    expect(toEntry?.amount).toBeCloseTo(100, 2)
  })
})

describe('resolveVoucherTypeIdByRef', () => {
  function createDb() {
    const db = new Database(':memory:')
    db.exec(`
      CREATE TABLE voucher_types (
        id TEXT PRIMARY KEY,
        account_set_id TEXT,
        name TEXT,
        code TEXT,
        sort_order INTEGER DEFAULT 0
      );
    `)
    db.prepare(
      `INSERT INTO voucher_types (id, account_set_id, name, code, sort_order) VALUES (?, ?, ?, ?, ?)`
    ).run('vt-jz', 'set-1', '记账', 'JZ', 0)
    db.prepare(
      `INSERT INTO voucher_types (id, account_set_id, name, code, sort_order) VALUES (?, ?, ?, ?, ?)`
    ).run('vt-zz', 'set-1', '转账', 'ZZ', 1)
    return db
  }

  it('按凭证字名称匹配', () => {
    const db = createDb()
    const id = resolveVoucherTypeIdByRef({
      db,
      accountSetId: 'set-1',
      voucherTypeRef: '转账',
    })
    expect(id).toBe('vt-zz')
  })

  it('配置为「结转」但账套只有「转账」时，回退到转/结类凭证字', () => {
    const db = createDb()
    const id = resolveVoucherTypeIdByRef({
      db,
      accountSetId: 'set-1',
      voucherTypeRef: '结转',
    })
    expect(id).toBe('vt-zz')
  })

  it('按凭证字编码匹配', () => {
    const db = createDb()
    const id = resolveVoucherTypeIdByRef({
      db,
      accountSetId: 'set-1',
      voucherTypeRef: 'JZ',
    })
    expect(id).toBe('vt-jz')
  })
})
