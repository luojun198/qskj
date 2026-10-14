import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { up as cashierPeriodClosingUp } from '../db/migrations/20260916_cashier_period_closing.js'
import {
  assertGlPeriodOpen,
  getSourceImmutableReason,
  getVoucherImmutableReason,
  isCashVoucher,
  type VoucherMutation,
} from '../services/voucherMutationGuard.js'
import { closeCashierPeriod } from '../services/cashierPeriodClosing.js'
import { getVoucherUndeletableReason } from '../services/voucherDelete.js'

/**
 * 2026-09-17 综合评审 P0-1 / P1-12 ~ P1-15：凭证可变性统一守卫。
 * 覆盖：来源守卫 × 操作、总账期间闸、出纳期间闸（仅含现金 / 银行分录的凭证）。
 */

const AS = 'as1'
const OPS: VoucherMutation[] = ['update', 'edit_audited', 'unaudit', 'unpost', 'reverse', 'delete']

function makeDb() {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE accounts (id TEXT PRIMARY KEY, account_set_id TEXT, code TEXT, is_cash INTEGER DEFAULT 0, is_bank INTEGER DEFAULT 0);
    CREATE TABLE vouchers (
      id TEXT PRIMARY KEY, account_set_id TEXT, voucher_no TEXT, status TEXT, source TEXT,
      voucher_date TEXT, year INTEGER, period INTEGER
    );
    CREATE TABLE voucher_entries (id TEXT PRIMARY KEY, voucher_id TEXT, account_id TEXT);
    CREATE TABLE period_closing (id TEXT PRIMARY KEY, account_set_id TEXT, year INTEGER, period INTEGER, status TEXT);
    CREATE TABLE cashier_journal (id TEXT PRIMARY KEY, account_set_id TEXT, account_code TEXT, biz_date TEXT, debit REAL, credit REAL, voucher_no INTEGER);
  `)
  cashierPeriodClosingUp(db)
  db.prepare("INSERT INTO accounts VALUES ('a-cash', ?, '1001', 1, 0)").run(AS)
  db.prepare("INSERT INTO accounts VALUES ('a-exp', ?, '6602', 0, 0)").run(AS)
  const insV = db.prepare('INSERT INTO vouchers VALUES (?,?,?,?,?,?,?,?)')
  const insE = db.prepare('INSERT INTO voucher_entries VALUES (?,?,?)')
  // 手工现金凭证（7 月）
  insV.run('v-cash-jul', AS, '记-1', 'audited', 'manual', '2026-07-10', 2026, 7)
  insE.run('e1', 'v-cash-jul', 'a-cash')
  insE.run('e2', 'v-cash-jul', 'a-exp')
  // 手工非现金凭证（7 月）
  insV.run('v-plain-jul', AS, '记-2', 'audited', 'manual', '2026-07-11', 2026, 7)
  insE.run('e3', 'v-plain-jul', 'a-exp')
  // 出纳凭证（8 月）
  insV.run('v-cashier-aug', AS, '记-3', 'audited', 'cashier', '2026-08-05', 2026, 8)
  insE.run('e4', 'v-cashier-aug', 'a-cash')
  insE.run('e5', 'v-cashier-aug', 'a-exp')
  // 固资凭证（8 月）
  insV.run('v-asset-aug', AS, '记-4', 'audited', 'asset_depr', '2026-08-06', 2026, 8)
  insE.run('e6', 'v-asset-aug', 'a-exp')
  // 普通凭证（9 月，总账已结账）
  insV.run('v-plain-sep', AS, '记-5', 'audited', 'manual', '2026-09-03', 2026, 9)
  insE.run('e7', 'v-plain-sep', 'a-exp')
  db.prepare("INSERT INTO period_closing VALUES ('pc9', ?, 2026, 9, 'closed')").run(AS)
  return db
}

const get = (db: Database.Database, id: string) => db.prepare('SELECT * FROM vouchers WHERE id=?').get(id) as any

describe('voucherMutationGuard', () => {
  let db: Database.Database
  beforeEach(() => {
    db = makeDb()
  })

  it('isCashVoucher：含现金 / 银行科目分录才算', () => {
    expect(isCashVoucher(db, 'v-cash-jul')).toBe(true)
    expect(isCashVoucher(db, 'v-plain-jul')).toBe(false)
  })

  it('来源守卫：固资凭证拒改 / 删 / 冲红，放行反审核与反记账', () => {
    const v = get(db, 'v-asset-aug')
    for (const op of ['update', 'edit_audited', 'reverse', 'delete'] as VoucherMutation[]) {
      expect(getVoucherImmutableReason({ db, accountSetId: AS, voucher: v, operation: op })).toMatch(/固定资产/)
    }
    for (const op of ['unaudit', 'unpost'] as VoucherMutation[]) {
      expect(getVoucherImmutableReason({ db, accountSetId: AS, voucher: v, operation: op })).toBeNull()
    }
  })

  it('来源守卫：出纳凭证拒删 / 冲红 / 已审核直改，放行修改对方科目、反审核、反记账', () => {
    const v = get(db, 'v-cashier-aug')
    for (const op of ['delete', 'reverse', 'edit_audited'] as VoucherMutation[]) {
      expect(getVoucherImmutableReason({ db, accountSetId: AS, voucher: v, operation: op })).toMatch(/出纳/)
    }
    for (const op of ['update', 'unaudit', 'unpost'] as VoucherMutation[]) {
      expect(getVoucherImmutableReason({ db, accountSetId: AS, voucher: v, operation: op })).toBeNull()
    }
  })

  it('总账期间闸：已结账期间的凭证除冲红外全部拒绝；冲红看目标期间由调用方另判', () => {
    const v = get(db, 'v-plain-sep')
    for (const op of OPS.filter(o => o !== 'reverse')) {
      expect(getVoucherImmutableReason({ db, accountSetId: AS, voucher: v, operation: op })).toMatch(/2026年9期已结账/)
    }
    expect(getVoucherImmutableReason({ db, accountSetId: AS, voucher: v, operation: 'reverse' })).toBeNull()
    expect(() => assertGlPeriodOpen(db, AS, 2026, 9)).toThrow(/已结账/)
    expect(() => assertGlPeriodOpen(db, AS, 2026, 8)).not.toThrow()
  })

  it('出纳期间闸：出纳结账 7 月后，7 月含现金科目的凭证六种操作全部拒绝，非现金凭证不受影响', () => {
    closeCashierPeriod({ db, accountSetId: AS, year: 2026, month: 7 })
    const cash = get(db, 'v-cash-jul')
    const plain = get(db, 'v-plain-jul')
    for (const op of OPS) {
      const targetDate = op === 'reverse' ? '2026-07-31' : undefined
      expect(getVoucherImmutableReason({ db, accountSetId: AS, voucher: cash, operation: op, targetDate })).toMatch(
        /7月出纳已结账/
      )
      expect(getVoucherImmutableReason({ db, accountSetId: AS, voucher: plain, operation: op, targetDate })).toBeNull()
    }
    // 跨期冲红：红字凭证落到未结账的 8 月则放行
    expect(
      getVoucherImmutableReason({ db, accountSetId: AS, voucher: cash, operation: 'reverse', targetDate: '2026-08-31' })
    ).toBeNull()
    // 修改：把 8 月现金凭证的日期改到已结账的 7 月同样拒绝
    const aug = get(db, 'v-cashier-aug')
    expect(
      getVoucherImmutableReason({ db, accountSetId: AS, voucher: aug, operation: 'update', targetDate: '2026-07-20' })
    ).toMatch(/7月出纳已结账/)
  })

  it('getVoucherUndeletableReason 带 ctx 时接入期间闸，不带 ctx 保持旧行为', () => {
    const v = get(db, 'v-plain-sep')
    expect(getVoucherUndeletableReason(v)).toBeNull()
    expect(getVoucherUndeletableReason(v, { db, accountSetId: AS })).toMatch(/已结账/)
    expect(getVoucherUndeletableReason({ id: 'x', status: 'posted' }, { db, accountSetId: AS })).toContain('已记账')
  })

  it('进销存单据凭证：不能改 / 删 / 冲红 / 已审核直改，业务凭证中心回收入口可删；差异结转凭证不受限', () => {
    const scm = { id: 's1', status: 'draft', source: 'scm_so', year: 2026, period: 9 }
    for (const operation of ['update', 'edit_audited', 'reverse', 'delete'] as const) {
      expect(getSourceImmutableReason(scm, operation), operation).toContain('业务凭证中心')
    }
    expect(getSourceImmutableReason(scm, 'unaudit')).toBeNull()
    expect(getSourceImmutableReason({ ...scm, source: 'scm_variance' }, 'update')).toBeNull()
    // 回收入口跳过来源守卫（其余闸照常，这里用未结账的 10 月）
    const open = { ...scm, period: 10 }
    expect(getVoucherUndeletableReason(open, { db, accountSetId: AS })).toContain('业务凭证中心')
    expect(getVoucherUndeletableReason(open, { db, accountSetId: AS, bypassSourceGuard: true })).toBeNull()
  })
})
