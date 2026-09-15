import { describe, expect, it } from 'vitest'
import {
  buildForeignBalanceQuery,
  buildGeneralLedgerQuery,
  buildLedgerDetailQuery,
  buildLedgerGeneralQuery,
  buildQuantityBalanceQuery,
} from '../services/ledgerQuery.js'

/**
 * 优化建议 §13：各 builder 的 params 都是手工按顺序 push，极易漂移。
 * 这里对每个 builder 跑账前发生额（preBook）四种归属组合 × 常见筛选，断言 `?` 数量 === params 数量。
 */
function count(sql: string) {
  return (sql.match(/\?/g) || []).length
}

// 账套启用日不同 → resolvePreBookRangeFlags 的 init/current/year/end 四个布尔取不同组合
const START_DATES = ['2025-01-01', '2026-01-01', '2026-03-15', '2026-06-20', undefined]
const RANGES = [
  { startDate: '2026-04-01', endDate: '2026-04-30' },
  { startDate: '2026-01-01', endDate: '2026-12-31' },
  { startDate: '2025-12-01', endDate: '2026-01-31' },
]

describe('ledgerQuery 占位符与参数对齐', () => {
  for (const preBookEnabled of [true, false]) {
    for (const accountSetStartDate of START_DATES) {
      for (const range of RANGES) {
        const label = `preBook=${preBookEnabled} start=${accountSetStartDate} range=${range.startDate}~${range.endDate}`
        it(`buildLedgerGeneralQuery ${label}`, () => {
          const q = buildLedgerGeneralQuery({
            accountSetId: 'as',
            ...range,
            accountCode: '1002',
            preBookEnabled,
            accountSetStartDate,
            resolveOpeningBaseYear: y => y - 1,
          })
          expect(count(q.sql)).toBe(q.params.length)
        })
        it(`buildQuantityBalanceQuery ${label}`, () => {
          const q = buildQuantityBalanceQuery({
            accountSetId: 'as',
            ...range,
            preBookEnabled,
            accountSetStartDate,
          })
          expect(count(q.sql)).toBe(q.params.length)
        })
        it(`buildForeignBalanceQuery ${label}`, () => {
          const q = buildForeignBalanceQuery({
            accountSetId: 'as',
            ...range,
            currencyCode: 'USD',
            preBookEnabled,
            accountSetStartDate,
            foreignPreBookEnabled: preBookEnabled,
          })
          expect(count(q.sql)).toBe(q.params.length)
        })
        it(`buildLedgerDetailQuery ${label}`, () => {
          for (const scope of [{ accountId: 'a1' }, { accountCodeStart: '1002' }, { accountCodeStart: '1002', accountCodeEnd: '1002zzz' }, {}]) {
            const q = buildLedgerDetailQuery({
              accountSetId: 'as',
              ...range,
              page: 1,
              pageSize: 50,
              preBookEnabled,
              accountSetStartDate,
              auxType: 'dept',
              auxId: 'd1',
              ...scope,
            })
            expect(count(q.listSql)).toBe(q.listParams.length)
            expect(count(q.initBalanceSql)).toBe(q.initBalanceParams.length)
            expect(count(q.foreignInitBalanceSql)).toBe(q.foreignInitBalanceParams.length)
            expect(count(q.preBookSql)).toBe(q.preBookParams.length)
          }
        })
      }
      it(`buildGeneralLedgerQuery preBook=${preBookEnabled} start=${accountSetStartDate}`, () => {
        for (const excludeTransfer of [true, false]) {
          const q = buildGeneralLedgerQuery({
            accountSetId: 'as',
            year: 2026,
            accountCode: '6602',
            preBookEnabled,
            accountSetStartDate,
            excludeTransfer,
          })
          expect(count(q.sql)).toBe(q.params.length)
        }
      })
    }
  }
})
