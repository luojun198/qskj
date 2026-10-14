/**
 * 总账开账日期下限守卫：各模块凭证 / 业务单据日期不得早于 account_sets.start_date
 */
import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import {
  assertNotBeforeGlStart,
  assertPeriodNotBeforeGlStart,
  getGlStartDateError,
} from '../services/voucherMutationGuard.js'
import { assertJournalDateWritable } from '../services/cashierJournalImport.js'

const AID = 'AS-START'

function createDb(startDate = '2026-04-15') {
  const db = new Database(':memory:')
  db.exec(`CREATE TABLE account_sets (id TEXT PRIMARY KEY, start_date TEXT, fiscal_year INTEGER)`)
  db.prepare('INSERT INTO account_sets (id, start_date, fiscal_year) VALUES (?, ?, 2026)').run(AID, startDate)
  return db
}

describe('总账开账日期守卫', () => {
  it('早于开账日期拒绝，当天及之后放行（月中开账按日比较）', () => {
    const db = createDb()
    expect(getGlStartDateError(db, AID, '2026-04-14')).toContain('不能早于总账开账日期（2026-04-15）')
    expect(getGlStartDateError(db, AID, '2026-04-15')).toBeNull()
    expect(getGlStartDateError(db, AID, '2026-05-01')).toBeNull()
    expect(() => assertNotBeforeGlStart(db, AID, '2026-03-31', '单据日期')).toThrow(/单据日期（2026-03-31）/)
  })

  it('日期为空或格式不合法时不在此处拦截（交给格式校验）', () => {
    const db = createDb()
    expect(getGlStartDateError(db, AID, '')).toBeNull()
    expect(getGlStartDateError(db, AID, null)).toBeNull()
  })

  it('按期间判断：开账月及之后放行，开账月之前拒绝', () => {
    const db = createDb()
    expect(() => assertPeriodNotBeforeGlStart(db, AID, 2026, 4)).not.toThrow()
    expect(() => assertPeriodNotBeforeGlStart(db, AID, 2026, 3)).toThrow(/早于总账开账日期/)
    expect(() => assertPeriodNotBeforeGlStart(db, AID, 2025, 12)).toThrow()
  })

  it('无 account_sets 表的精简库不拦截', () => {
    const db = new Database(':memory:')
    expect(getGlStartDateError(db, AID, '2000-01-01')).toBeNull()
    expect(() => assertPeriodNotBeforeGlStart(db, AID, 2000, 1)).not.toThrow()
  })

  it('出纳日记账日期早于开账日期被拒绝', () => {
    const db = createDb('2026-04-01')
    expect(() => assertJournalDateWritable(db, AID, '2026-03-31')).toThrow(/日记账日期.*不能早于总账开账日期/)
    expect(assertJournalDateWritable(db, AID, '2026-04-01')).toBe('2026-04-01')
  })
})
