import { describe, expect, it } from 'vitest'
import {
  buildVoucherEntryPayloads,
  calculateNewBalance,
  getNextVoucherNo,
  findVoucherNoConflict,
  parseVoucherNoSeq,
  validateVoucherEntriesNoNegativeBalance,
  validateVoucherEntriesCashFlow,
  VOUCHER_ENTRY_INSERT_PARAM_COUNT,
  isCashFlowEnabledForAccountSet,
  type VoucherEntryInput,
} from '../services/voucherEntry.js'

describe('voucherEntry no-negative balance validation', () => {
  it('借方余额科目贷方发生会减少余额并被拦截', () => {
    const error = validateVoucherEntriesNoNegativeBalance({
      entries: [
        buildEntry({
          account_id: 'cash',
          account_name: '库存现金',
          direction: 'credit',
          amount: 150,
        }),
      ],
      getAccountById: () => ({ no_negative: 1, direction: 'debit' }),
      getBalanceByAccountId: () => 100,
    })

    expect(error?.message).toContain('库存现金')
    expect(error?.message).toContain('-50.00')
    expect(error?.violations).toHaveLength(1)
  })

  it('贷方余额科目借方发生会减少余额并被拦截', () => {
    const error = validateVoucherEntriesNoNegativeBalance({
      entries: [
        buildEntry({
          account_id: 'payable',
          account_name: '应付账款',
          direction: 'debit',
          amount: 150,
        }),
      ],
      getAccountById: () => ({ no_negative: 1, direction: 'credit' }),
      getBalanceByAccountId: () => 100,
    })

    expect(error?.message).toContain('应付账款')
    expect(error?.message).toContain('-50.00')
  })

  it('启用辅助核算时按各辅助项目分项校验余额', () => {
    const error = validateVoucherEntriesNoNegativeBalance({
      entries: [
        buildEntry({
          account_id: 'bank',
          account_name: '外埠存款',
          direction: 'credit',
          amount: 50,
          person_id: 'person-1',
        }),
      ],
      getAccountById: () => ({
        id: 'bank',
        no_negative: 1,
        direction: 'debit',
        is_aux: 1,
        aux_types: JSON.stringify(['cat-person']),
      }),
      getBalanceByAccountId: () => 0,
      getAuxBalanceByCategory: () => 100,
      getEnabledCategoryCodesForAccount: () => ['person'],
      getAuxCategoryName: () => '个人',
      getAuxItemName: () => '安总',
    })

    expect(error).toBeNull()
  })

  it('多辅助项目任一为负则全部列出', () => {
    const error = validateVoucherEntriesNoNegativeBalance({
      entries: [
        buildEntry({
          account_id: 'bank',
          account_name: '外埠存款',
          direction: 'credit',
          amount: 150,
          person_id: 'person-1',
          dept_id: 'dept-1',
        }),
      ],
      getAccountById: () => ({
        id: 'bank',
        no_negative: 1,
        direction: 'debit',
        is_aux: 1,
        aux_types: JSON.stringify(['cat-person', 'cat-dept']),
      }),
      getBalanceByAccountId: () => 1000,
      getAuxBalanceByCategory: (_aid, code) => (code === 'person' ? 100 : 1000),
      getEnabledCategoryCodesForAccount: () => ['person', 'dept'],
      getAuxCategoryName: code => (code === 'person' ? '个人' : '部门'),
      getAuxItemName: (_code, id) => (id === 'person-1' ? '安总' : '行政部'),
    })

    expect(error?.violations).toHaveLength(1)
    expect(error?.violations?.[0].auxCategoryName).toBe('个人')
    expect(error?.violations?.[0].auxItemName).toBe('安总')
    expect(error?.violations?.[0].projectedBalance).toBeCloseTo(-50, 2)
  })

  it('多项辅助违规一次性全部返回', () => {
    const error = validateVoucherEntriesNoNegativeBalance({
      entries: [
        buildEntry({
          account_id: 'bank',
          account_name: '外埠存款',
          direction: 'credit',
          amount: 200,
          person_id: 'person-1',
          dept_id: 'dept-1',
        }),
      ],
      getAccountById: () => ({
        id: 'bank',
        no_negative: 1,
        direction: 'debit',
        is_aux: 1,
        aux_types: JSON.stringify(['cat-person', 'cat-dept']),
      }),
      getBalanceByAccountId: () => 1000,
      getAuxBalanceByCategory: (_aid, code) => (code === 'person' ? 100 : 50),
      getEnabledCategoryCodesForAccount: () => ['person', 'dept'],
      getAuxCategoryName: code => (code === 'person' ? '个人' : '部门'),
      getAuxItemName: (_code, id) => (id === 'person-1' ? '安总' : '行政部'),
    })

    expect(error?.violations).toHaveLength(2)
    expect(error?.message).toContain('2 项')
  })

  it('同一科目多行分录按净影响判断', () => {
    const error = validateVoucherEntriesNoNegativeBalance({
      entries: [
        buildEntry({
          account_id: 'cash',
          account_name: '库存现金',
          direction: 'credit',
          amount: 150,
        }),
        buildEntry({
          account_id: 'cash',
          account_name: '库存现金',
          direction: 'debit',
          amount: 100,
        }),
      ],
      getAccountById: () => ({ no_negative: 1, direction: 'debit' }),
      getBalanceByAccountId: () => 100,
    })

    expect(error).toBeNull()
  })

  it('根据分录方向和科目方向计算新余额', () => {
    expect(
      calculateNewBalance({
        currentBalance: 100,
        amount: 30,
        entryDirection: 'debit',
        accountDirection: 'debit',
      })
    ).toBe(130)
    expect(
      calculateNewBalance({
        currentBalance: 100,
        amount: 30,
        entryDirection: 'debit',
        accountDirection: 'credit',
      })
    ).toBe(70)
  })
})

describe('voucherEntry automatic voucher type selection', () => {
  it('本月已有凭证时沿用最后录入凭证的类型并递增该类型编号', () => {
    const db = createNextNoDb({
      lastVoucherTypeId: 'type-2',
      types: {
        'type-1': { id: 'type-1', name: '记账', code: '1' },
        'type-2': { id: 'type-2', name: '结转', code: '2' },
      },
      maxNo: 7,
    })

    const result = getNextVoucherNo({
      db,
      accountSetId: 'account-set',
      year: 2026,
      period: 5,
    })

    expect(result.effectiveTypeId).toBe('type-2')
    expect(result.voucherNo).toBe('结-008')
  })

  it('本月没有凭证时选择凭证类型编码最小的一项', () => {
    const db = createNextNoDb({
      lastVoucherTypeId: null,
      firstTypeId: 'type-1',
      types: {
        'type-1': { id: 'type-1', name: '记账', code: '1' },
        'type-2': { id: 'type-2', name: '结转', code: '2' },
      },
      maxNo: null,
    })

    const result = getNextVoucherNo({
      db,
      accountSetId: 'account-set',
      year: 2026,
      period: 5,
    })

    expect(result.effectiveTypeId).toBe('type-1')
    expect(result.voucherNo).toBe('记-001')
  })

  it('不同年月应从 1 重新开始编号', () => {
    const db = createNextNoDb({
      lastVoucherTypeId: 'type-1',
      types: {
        'type-1': { id: 'type-1', name: '记账', code: '1' },
      },
      maxNoByPeriod: {
        '2026-5': 8,
        '2026-6': null,
      },
    })

    const may = getNextVoucherNo({
      db,
      accountSetId: 'account-set',
      year: 2026,
      period: 5,
      voucherTypeId: 'type-1',
    })
    expect(may.voucherNo).toBe('记-009')

    const june = getNextVoucherNo({
      db,
      accountSetId: 'account-set',
      year: 2026,
      period: 6,
      voucherTypeId: 'type-1',
    })
    expect(june.voucherNo).toBe('记-001')
  })
})

describe('voucher number helpers', () => {
  it('parseVoucherNoSeq 兼容带前缀与纯数字格式', () => {
    expect(parseVoucherNoSeq('记-008')).toBe(8)
    expect(parseVoucherNoSeq('16')).toBe(16)
    expect(parseVoucherNoSeq('bad')).toBeNull()
  })

  it('findVoucherNoConflict 限定同年同月同类型', () => {
    const db = createConflictDb()
    expect(
      findVoucherNoConflict({
        db,
        accountSetId: 'as1',
        year: 2026,
        period: 5,
        voucherTypeId: 'type-1',
        voucherNo: '记-001',
      })
    ).toBeUndefined()
    expect(
      findVoucherNoConflict({
        db,
        accountSetId: 'as1',
        year: 2026,
        period: 6,
        voucherTypeId: 'type-1',
        voucherNo: '记-001',
      })
    ).toBeUndefined()
    expect(
      findVoucherNoConflict({
        db,
        accountSetId: 'as1',
        year: 2026,
        period: 5,
        voucherTypeId: 'type-1',
        voucherNo: '记-002',
      })?.id
    ).toBe('v2')
  })
})

function buildEntry(params: Partial<VoucherEntryInput>): VoucherEntryInput {
  return {
    account_id: 'account',
    account_code: '1001',
    account_name: '测试科目',
    direction: 'debit',
    amount: 0,
    ...params,
  }
}

function createNextNoDb(params: {
  lastVoucherTypeId: string | null
  firstTypeId?: string
  types: Record<string, { id: string; name: string; code: string }>
  maxNo?: number | null
  maxNoByPeriod?: Record<string, number | null>
}) {
  return {
    prepare(sql: string) {
      return {
        get(...args: any[]) {
          if (sql.includes('SELECT voucher_type_id')) {
            return params.lastVoucherTypeId ? { voucher_type_id: params.lastVoucherTypeId } : undefined
          }
          if (sql.includes('FROM voucher_types') && sql.includes('ORDER BY')) {
            const fallbackId = params.firstTypeId || Object.values(params.types)[0]?.id
            return fallbackId ? { id: fallbackId } : undefined
          }
          if (sql.includes('SELECT name FROM voucher_types WHERE id=?')) {
            return params.types[String(args[0])] || undefined
          }
          if (sql.includes('SELECT MAX(')) {
            if (params.maxNoByPeriod) {
              const year = args[1]
              const period = args[2]
              const key = `${year}-${period}`
              return { max_no: params.maxNoByPeriod[key] ?? null }
            }
            return { max_no: params.maxNo ?? null }
          }
          return undefined
        },
      }
    },
  }
}

function createConflictDb() {
  const rows = [
    { id: 'v2', account_set_id: 'as1', year: 2026, period: 5, voucher_type_id: 'type-1', voucher_no: '记-002' },
  ]
  return {
    prepare(sql: string) {
      return {
        get(...args: any[]) {
          const [accountSetId, year, period, voucherNo, typeId, , excludeId] = args
          return rows.find(row =>
            row.account_set_id === accountSetId &&
            row.year === year &&
            row.period === period &&
            row.voucher_no === voucherNo &&
            row.voucher_type_id === typeId &&
            row.id !== excludeId
          )
        },
      }
    },
  }
}

describe('buildVoucherEntryPayloads', () => {
  it('分录参数个数与 INSERT 占位符一致（含 amount_cents、现金流量）', () => {
    const payloads = buildVoucherEntryPayloads({
      accountSetId: 'as1',
      voucherId: 'v1',
      entries: [
        buildEntry({ account_id: 'a1', amount: 100, cash_flow_code: '1101', cash_flow_name: '收现' }),
        buildEntry({ account_id: 'a2', direction: 'credit', amount: 100 }),
      ],
      categories: [{ id: 'c1', code: 'dept', fields: [] }],
      itemMap: {},
    })
    expect(payloads).toHaveLength(2)
    for (const payload of payloads) {
      expect(payload).toHaveLength(VOUCHER_ENTRY_INSERT_PARAM_COUNT)
    }
    expect(payloads[0][9]).toBe(10000)
    expect(payloads[0][22]).toBe('1101')
    expect(payloads[0][23]).toBe('收现')
  })
})

describe('validateVoucherEntriesCashFlow', () => {
  it('未启用现金流时不校验', () => {
    const db = {
      prepare(sql: string) {
        return {
          get() {
            if (sql.includes('enable_cash_flow')) return { param_value: 'false' }
            return undefined
          },
        }
      },
    }
    expect(
      validateVoucherEntriesCashFlow(db as any, 'as1', [
        buildEntry({ account_id: 'a1', amount: 100 }),
      ])
    ).toBeNull()
  })

  it('现金科目未填现金流量项目时拦截', () => {
    const db = {
      prepare(sql: string) {
        return {
          get(...args: any[]) {
            if (sql.includes('enable_cash_flow')) return { param_value: 'true' }
            if (sql.includes('FROM accounts')) {
              return { name: '库存现金', require_cash_flow: 0, is_cash: 1, is_bank: 0 }
            }
            return undefined
          },
        }
      },
    }
    expect(
      validateVoucherEntriesCashFlow(db as any, 'as1', [
        buildEntry({ account_id: 'cash', amount: 10 }),
      ])
    ).toContain('现金流量项目')
  })

  it('仅 require_cash_flow=1 且非现金/银行科目时不拦截', () => {
    const db = {
      prepare(sql: string) {
        return {
          get() {
            if (sql.includes('enable_cash_flow')) return { param_value: 'true' }
            if (sql.includes('FROM accounts')) {
              return { name: '其他应收款', require_cash_flow: 1, is_cash: 0, is_bank: 0 }
            }
            return undefined
          },
        }
      },
    }
    expect(
      validateVoucherEntriesCashFlow(db as any, 'as1', [
        buildEntry({ account_id: 'other', amount: 10 }),
      ])
    ).toBeNull()
  })
})
