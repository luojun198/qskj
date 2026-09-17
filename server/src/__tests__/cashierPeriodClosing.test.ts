import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { up as cashierPeriodClosingUp } from '../db/migrations/20260916_cashier_period_closing.js'
import {
  assertCashierPeriodOpen,
  assertCashierRangeOpen,
  closeCashierPeriod,
  getLatestClosedCashierPeriod,
  listCashierPeriodStatus,
  normalizeBizDate,
  reopenCashierPeriod,
} from '../services/cashierPeriodClosing.js'

const AS = 'as1'

function makeDb() {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE cashier_journal (
      id TEXT PRIMARY KEY, account_set_id TEXT NOT NULL, account_code TEXT, biz_date TEXT NOT NULL,
      debit REAL DEFAULT 0, credit REAL DEFAULT 0, voucher_no INTEGER
    );
    CREATE TABLE period_closing (
      id TEXT PRIMARY KEY, account_set_id TEXT NOT NULL, year INTEGER, period INTEGER, status TEXT
    );
  `)
  cashierPeriodClosingUp(db)
  const ins = db.prepare('INSERT INTO cashier_journal (id, account_set_id, account_code, biz_date, debit, voucher_no) VALUES (?,?,?,?,?,?)')
  ins.run('j1', AS, '1001', '2026-07-05', 100, 1)
  ins.run('j2', AS, '1001', '2026-08-10', 200, null)
  ins.run('j3', AS, '1001', '2026-08-20', 300, 2)
  ins.run('j4', AS, '1001', '2026-09-01', 400, null)
  db.prepare("INSERT INTO period_closing (id, account_set_id, year, period, status) VALUES ('p1', ?, 2026, 7, 'closed')").run(AS)
  return db
}

describe('cashierPeriodClosing', () => {
  let db: Database.Database
  beforeEach(() => { db = makeDb() })

  it('状态视图：笔数 / 未生成凭证数 / 总账结账标记 / 可结账判定', () => {
    const rows = listCashierPeriodStatus(db, AS, 2026)
    expect(rows).toHaveLength(12)
    const aug = rows.find(r => r.month === 8)!
    expect(aug).toMatchObject({ status: 'open', journalCount: 2, unvoucheredCount: 1, glClosed: false })
    expect(rows.find(r => r.month === 7)!.glClosed).toBe(true)
    // 7 月有数据且未结，8 月不能先结
    expect(aug.canClose).toBe(false)
    expect(aug.blockReason).toContain('7月')
    expect(rows.find(r => r.month === 7)!.canClose).toBe(true)
  })

  it('按顺序结账，结账后闸口生效，反结账只能倒序', () => {
    expect(() => closeCashierPeriod({ db, accountSetId: AS, year: 2026, month: 8 })).toThrow(/7月尚未结账/)
    closeCashierPeriod({ db, accountSetId: AS, year: 2026, month: 7, userId: 'u1', userName: '张三' })
    const jul = listCashierPeriodStatus(db, AS, 2026).find(r => r.month === 7)!
    expect(jul.status).toBe('closed')
    expect(jul.closed_by_name).toBe('张三')
    expect(() => assertCashierPeriodOpen(db, AS, '2026-07-15')).toThrow(/7月出纳已结账/)
    expect(() => assertCashierPeriodOpen(db, AS, '2026-08-15')).not.toThrow()
    expect(() => assertCashierRangeOpen(db, AS, '2026-07-01', '2026-08-31')).toThrow(/7月/)
    expect(() => assertCashierRangeOpen(db, AS, '2026-08-01', '2026-08-31')).not.toThrow()
    expect(() => assertCashierRangeOpen(db, AS, undefined, undefined)).toThrow()

    closeCashierPeriod({ db, accountSetId: AS, year: 2026, month: 8 })
    // 不能回头结更早月份 / 不能先反结 7 月
    expect(() => closeCashierPeriod({ db, accountSetId: AS, year: 2026, month: 6 })).toThrow(/不能回头/)
    expect(() => reopenCashierPeriod({ db, accountSetId: AS, year: 2026, month: 7 })).toThrow(/8月/)
    reopenCashierPeriod({ db, accountSetId: AS, year: 2026, month: 8 })
    reopenCashierPeriod({ db, accountSetId: AS, year: 2026, month: 7 })
    expect(() => assertCashierPeriodOpen(db, AS, '2026-07-15')).not.toThrow()
    expect(() => reopenCashierPeriod({ db, accountSetId: AS, year: 2026, month: 7 })).toThrow(/未结账/)
  })

  it('无数据的空月份可以直接结账（不要求前面无数据月份先结）', () => {
    // 6 月无数据：更早无未结的有数据月份 → 可结
    expect(listCashierPeriodStatus(db, AS, 2026).find(r => r.month === 6)!.canClose).toBe(true)
  })

  // ── 2026-09-17 综合评审 P1-7 / P1-8 / P1-9 ────────────────────────

  it('P1-8：年月必须为整数且在合法范围，畸形年份不会写入并锁死结账', () => {
    expect(() => closeCashierPeriod({ db, accountSetId: AS, year: 2026.5, month: 9 })).toThrow(/年份不合法/)
    expect(() => closeCashierPeriod({ db, accountSetId: AS, year: NaN, month: 9 })).toThrow(/年份不合法/)
    expect(() => closeCashierPeriod({ db, accountSetId: AS, year: 2026, month: 0 })).toThrow(/月份不合法/)
    expect(() => reopenCashierPeriod({ db, accountSetId: AS, year: 2026.5, month: 9 })).toThrow(/年份不合法/)
    // 即便库里已有脏行，也不会被当作"最近已结月"
    db.prepare(
      "INSERT INTO cashier_period_closing (id, account_set_id, year, month, status) VALUES ('dirty', ?, 2026.5, 9, 'closed')"
    ).run(AS)
    expect(getLatestClosedCashierPeriod(db, AS)).toBeNull()
    expect(() => closeCashierPeriod({ db, accountSetId: AS, year: 2026, month: 7 })).not.toThrow()
  })

  it('P1-9：不能结晚于当前自然月的月份', () => {
    const now = new Date()
    const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1)
    const y = nextMonth.getFullYear()
    const m = nextMonth.getMonth() + 1
    expect(() => closeCashierPeriod({ db, accountSetId: AS, year: y, month: m })).toThrow(/尚未到来/)
    const row = listCashierPeriodStatus(db, AS, y).find(r => r.month === m)!
    expect(row.canClose).toBe(false)
    expect(row.blockReason).toMatch(/尚未到来/)
  })

  it('P1-7：闸口 fail-closed，异形日期不再静默放行', () => {
    closeCashierPeriod({ db, accountSetId: AS, year: 2026, month: 7 })
    for (const bad of ['2026/07/15', '2026-7-5', '2026-13-01', '45876', '', null, undefined]) {
      expect(() => assertCashierPeriodOpen(db, AS, bad as any)).toThrow(/日期格式不合法|出纳已结账/)
    }
    expect(() => assertCashierPeriodOpen(db, AS, '2026-08-01T00:00:00')).not.toThrow()
  })

  it('normalizeBizDate：常见异形日期统一为 YYYY-MM-DD，不存在的日期抛错', () => {
    expect(normalizeBizDate('2026-07-05')).toBe('2026-07-05')
    expect(normalizeBizDate('2026/7/5')).toBe('2026-07-05')
    expect(normalizeBizDate('2026.07.05')).toBe('2026-07-05')
    expect(normalizeBizDate('2026年7月5日')).toBe('2026-07-05')
    expect(normalizeBizDate('20260705')).toBe('2026-07-05')
    expect(normalizeBizDate('2026-07-05 10:20:30')).toBe('2026-07-05')
    expect(normalizeBizDate(45876)).toBe('2025-08-07')
    expect(normalizeBizDate(new Date(2026, 6, 5))).toBe('2026-07-05')
    expect(() => normalizeBizDate('2026-13-01')).toThrow(/不合法/)
    expect(() => normalizeBizDate('2026-02-30')).toThrow(/不存在/)
    expect(() => normalizeBizDate('abc')).toThrow(/格式不合法/)
    expect(() => normalizeBizDate('')).toThrow(/不能为空/)
  })
})
