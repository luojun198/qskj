import { describe, expect, it } from 'vitest'
import { findDuplicateEntries, type VoucherEntryInput } from '../services/voucherEntry.js'

const mk = (overrides: Partial<VoucherEntryInput>): VoucherEntryInput =>
  ({
    account_id: 'a',
    account_code: '1001',
    account_name: '银行存款',
    direction: 'debit',
    amount: 100,
    ...overrides,
  }) as any

describe('FIX-011 / P1-15 findDuplicateEntries 含现金流量维度', () => {
  it('同账户同方向同辅助 → 报重复', () => {
    const w = findDuplicateEntries([
      mk({ dept_id: 'd1' }),
      mk({ dept_id: 'd1' }),
    ])
    expect(w).toHaveLength(1)
    expect(w[0].count).toBe(2)
  })

  it('同账户同方向同辅助但不同 cash_flow_code → 不报重复（旧 BUG 会误报）', () => {
    const w = findDuplicateEntries([
      mk({ dept_id: 'd1', cash_flow_code: '01' }),
      mk({ dept_id: 'd1', cash_flow_code: '02' }),
    ])
    expect(w).toHaveLength(0)
  })

  it('同账户同方向同 cash_flow_code 但不同部门 → 不报重复', () => {
    const w = findDuplicateEntries([
      mk({ dept_id: 'd1', cash_flow_code: '01' }),
      mk({ dept_id: 'd2', cash_flow_code: '01' }),
    ])
    expect(w).toHaveLength(0)
  })

  it('所有维度完全相同（包括 cash_flow_code）→ 报重复 3 次', () => {
    const w = findDuplicateEntries([
      mk({ cash_flow_code: '01' }),
      mk({ cash_flow_code: '01' }),
      mk({ cash_flow_code: '01' }),
    ])
    expect(w).toHaveLength(1)
    expect(w[0].count).toBe(3)
  })

  it('一边有 cash_flow_code 一边没有 → 不报重复（视为不同维度组合）', () => {
    const w = findDuplicateEntries([
      mk({ cash_flow_code: '01' }),
      mk({}), // 无现金流量
    ])
    expect(w).toHaveLength(0)
  })

  it('借贷方向不同始终不报', () => {
    const w = findDuplicateEntries([
      mk({ direction: 'debit', cash_flow_code: '01' }),
      mk({ direction: 'credit', cash_flow_code: '01' }),
    ])
    expect(w).toHaveLength(0)
  })
})
