import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import Database from 'better-sqlite3'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

let testDb: Database.Database

vi.mock('../db/index.js', () => ({
  getDb: () => testDb,
}))

import {
  previewFxRevaluation,
  resolveClosingExchangeRate,
  revokeFxRevaluation,
  runFxRevaluation,
  FX_REVAL_SOURCE,
} from '../services/fxRevaluation.js'
import { buildForeignBalanceQuery } from '../services/ledgerQuery.js'

const SET = 'set-fx'
const USD_ACC = 'acc-usd'
const GAIN_ACC = 'acc-6603'
const CASH_ACC = 'acc-1001'
const LOAN_ACC = 'acc-loan'

function createDb() {
  const schemaPath = resolve(dirname(fileURLToPath(import.meta.url)), '../db/schema.sql')
  const db = new Database(':memory:')
  db.exec(readFileSync(schemaPath, 'utf-8'))
  // vouchers.source 由迁移 20260601_add_voucher_source 追加，schema.sql 未含
  db.exec(`ALTER TABLE vouchers ADD COLUMN source TEXT DEFAULT NULL`)
  db.prepare(
    `INSERT INTO account_sets (id, name, code, fiscal_year, start_date, status) VALUES (?, 'FX', 'FX', 2026, '2026-01-01', 'active')`
  ).run(SET)
  db.prepare(`INSERT INTO users (id, account_set_id, username, password) VALUES ('u1', ?, 'zs', 'x')`).run(SET)
  db.prepare(
    `INSERT INTO system_params (id, account_set_id, param_key, param_value) VALUES ('p1', ?, 'enable_foreign_currency', 'true')`
  ).run(SET)
  db.prepare(
    `INSERT INTO voucher_types (id, account_set_id, name, code, sort_order) VALUES ('vt-jz', ?, '记账', '1', 1)`
  ).run(SET)
  db.prepare(
    `INSERT INTO currencies (id, account_set_id, code, name, is_base, default_rate, begin_rate, end_rate) VALUES ('c-usd', ?, 'USD', '美元', 0, 7.0, 7.0, 7.0)`
  ).run(SET)
  const insAcc = db.prepare(
    `INSERT INTO accounts (id, account_set_id, code, name, direction, level, is_foreign, currency_code) VALUES (?, ?, ?, ?, ?, 1, ?, ?)`
  )
  insAcc.run(USD_ACC, SET, '1002001', '银行存款-美元', 'debit', 1, 'USD')
  insAcc.run(LOAN_ACC, SET, '2001001', '短期借款-美元', 'credit', 1, 'USD')
  insAcc.run(GAIN_ACC, SET, '6603', '财务费用-汇兑损益', 'debit', 0, null)
  insAcc.run(CASH_ACC, SET, '1001', '库存现金', 'debit', 0, null)
  return db
}

function setGainAccount(db: Database.Database, code: string | null) {
  db.prepare(`DELETE FROM system_params WHERE account_set_id = ? AND param_key = 'exchange_gain_account_code'`).run(SET)
  if (code) {
    db.prepare(
      `INSERT INTO system_params (id, account_set_id, param_key, param_value) VALUES ('p-gain', ?, 'exchange_gain_account_code', ?)`
    ).run(SET, code)
  }
}

/**
 * 落一张已过账凭证造出余额：原币 foreign，本位币 base（均为科目方向的正向余额）。
 *
 * 外币余额表已统一为凭证明细口径（不再读 account_balances），调汇取数随之改走同一条路径，
 * 因此这里必须造真实凭证而不是直接写 account_balances，否则测出来的是一张空表。
 */
function seedBalance(
  db: Database.Database,
  accountId: string,
  direction: 'debit' | 'credit',
  foreign: number,
  base: number,
  period = 3
) {
  const vid = `v-seed-${accountId}-${period}`
  const date = `2026-${String(period).padStart(2, '0')}-15`
  db.prepare(
    `INSERT INTO vouchers (id, account_set_id, voucher_no, voucher_type_id, voucher_date, year, period, status, total_amount)
     VALUES (?, ?, ?, 'vt-jz', ?, 2026, ?, 'posted', ?)`
  ).run(vid, SET, `seed-${accountId}-${period}`, date, period, base)

  const acc = db.prepare(`SELECT code, name, currency_code FROM accounts WHERE id = ?`).get(accountId) as {
    code: string
    name: string
    currency_code: string | null
  }
  db.prepare(
    `INSERT INTO voucher_entries (id, account_set_id, voucher_id, seq, account_id, account_code, account_name,
       direction, amount, currency_code, exchange_rate, foreign_amount)
     VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    `${vid}-e1`,
    SET,
    vid,
    accountId,
    acc.code,
    acc.name,
    direction,
    base,
    acc.currency_code,
    foreign ? base / foreign : null,
    foreign
  )
  // 对方科目走本位币，保证凭证借贷平衡且不影响外币科目取数
  const cash = db.prepare(`SELECT code, name FROM accounts WHERE id = ?`).get(CASH_ACC) as {
    code: string
    name: string
  }
  db.prepare(
    `INSERT INTO voucher_entries (id, account_set_id, voucher_id, seq, account_id, account_code, account_name,
       direction, amount)
     VALUES (?, ?, ?, 2, ?, ?, ?, ?, ?)`
  ).run(
    `${vid}-e2`,
    SET,
    vid,
    CASH_ACC,
    cash.code,
    cash.name,
    direction === 'debit' ? 'credit' : 'debit',
    base
  )
}

function foreignRow(db: Database.Database, accountId: string) {
  const q = buildForeignBalanceQuery({
    accountSetId: SET,
    startDate: '2026-03-01',
    endDate: '2026-03-31',
    includeUnposted: false,
  })
  const rows = db.prepare(q.sql).all(...q.params) as any[]
  return rows.find(r => r.account_id === accountId)
}

describe('期末调汇 fxRevaluation', () => {
  beforeEach(() => {
    testDb = createDb()
    setGainAccount(testDb, '6603')
  })
  afterEach(() => testDb.close())

  it('本期有未记账凭证时拦住调汇，并且不把调汇凭证自身算进去', () => {
    seedBalance(testDb, USD_ACC, 'debit', 100, 700)
    testDb.prepare(`UPDATE currencies SET end_rate = 7.25 WHERE id = 'c-usd'`).run()

    // 造一张本期未过账凭证
    testDb
      .prepare(
        `INSERT INTO vouchers (id, account_set_id, voucher_no, voucher_type_id, voucher_date, year, period, status, total_amount)
         VALUES ('v-draft', ?, 'D001', 'vt-jz', '2026-03-20', 2026, 3, 'draft', 100)`
      )
      .run(SET)

    const blocked = previewFxRevaluation({ db: testDb, accountSetId: SET, year: 2026, period: 3 })
    expect(blocked.unpostedVoucherCount).toBe(1)
    expect(blocked.blockedReason).toContain('未记账')
    // 明细仍要算出来，用户才知道差在哪
    expect(blocked.rows).toHaveLength(1)
    expect(runFxRevaluation({ db: testDb, accountSetId: SET, year: 2026, period: 3 }).error).toContain('未记账')

    // 过账后放行
    testDb.prepare(`UPDATE vouchers SET status = 'posted' WHERE id = 'v-draft'`).run()
    const ok = previewFxRevaluation({ db: testDb, accountSetId: SET, year: 2026, period: 3 })
    expect(ok.unpostedVoucherCount).toBe(0)
    expect(ok.blockedReason).toBeNull()

    const run = runFxRevaluation({ db: testDb, accountSetId: SET, year: 2026, period: 3 })
    expect(run.error).toBeNull()
    // 生成后再预览：不得因为调汇凭证自身而报「还有未记账凭证」
    const after = previewFxRevaluation({ db: testDb, accountSetId: SET, year: 2026, period: 3 })
    expect(after.unpostedVoucherCount).toBe(0)
  })

  it('汇率来源逐档回退：期间 closing_rate → 期间 rate → 外币类型期末汇率 → 最近一期 → 默认', () => {
    seedBalance(testDb, USD_ACC, 'debit', 100, 700)
    const sourceOf = () =>
      previewFxRevaluation({ db: testDb, accountSetId: SET, year: 2026, period: 3 }).rows[0]
        .closing_rate_source

    // 只有 currencies.end_rate（createDb 里是 7.0）
    expect(sourceOf()).toBe('currency-end')

    // 上一期有汇率 → 最近一期（end_rate 为 NOT NULL 列，用 0 表示「未维护」）
    testDb.prepare(`UPDATE currencies SET end_rate = 0 WHERE id = 'c-usd'`).run()
    testDb
      .prepare(
        `INSERT INTO exchange_rates (id, account_set_id, currency_code, year, period, rate) VALUES ('r-prev', ?, 'USD', 2026, 2, 6.9)`
      )
      .run(SET)
    expect(sourceOf()).toBe('nearest-period')

    // 本期有 rate → 期间汇率（此时即使外币类型页填了期末汇率也会被盖住）
    testDb.prepare(`UPDATE currencies SET end_rate = 7.5 WHERE id = 'c-usd'`).run()
    testDb
      .prepare(
        `INSERT INTO exchange_rates (id, account_set_id, currency_code, year, period, rate) VALUES ('r-cur', ?, 'USD', 2026, 3, 7.1)`
      )
      .run(SET)
    const periodRate = previewFxRevaluation({ db: testDb, accountSetId: SET, year: 2026, period: 3 }).rows[0]
    expect(periodRate.closing_rate_source).toBe('period-rate')
    expect(periodRate.closing_rate).toBe(7.1)

    // 本期有 closing_rate → 期间期末汇率
    testDb.prepare(`UPDATE exchange_rates SET closing_rate = 7.3 WHERE id = 'r-cur'`).run()
    const closing = previewFxRevaluation({ db: testDb, accountSetId: SET, year: 2026, period: 3 }).rows[0]
    expect(closing.closing_rate_source).toBe('period-closing')
    expect(closing.closing_rate).toBe(7.3)
  })

  it('resolveClosingExchangeRate：期间 closing_rate → rate → currencies.end_rate', () => {
    expect(resolveClosingExchangeRate(testDb, SET, 'USD', 2026, 3)).toBe(7.0)
    testDb
      .prepare(
        `INSERT INTO exchange_rates (id, account_set_id, currency_code, year, period, rate, closing_rate) VALUES ('r1', ?, 'USD', 2026, 3, 7.1, NULL)`
      )
      .run(SET)
    expect(resolveClosingExchangeRate(testDb, SET, 'USD', 2026, 3)).toBe(7.1)
    testDb.prepare(`UPDATE exchange_rates SET closing_rate = 7.25 WHERE id = 'r1'`).run()
    expect(resolveClosingExchangeRate(testDb, SET, 'USD', 2026, 3)).toBe(7.25)
  })

  it('借方外币科目汇率上升：借外币科目 / 贷汇兑损益，原币余额不变', () => {
    // USD 100 按 7.0 入账 = 700；期末汇率 7.25 → 725，差额 +25
    seedBalance(testDb, USD_ACC, 'debit', 100, 700)
    testDb.prepare(`UPDATE currencies SET end_rate = 7.25 WHERE id = 'c-usd'`).run()

    const preview = previewFxRevaluation({ db: testDb, accountSetId: SET, year: 2026, period: 3 })
    expect(preview.blockedReason).toBeNull()
    expect(preview.rows).toHaveLength(1)
    expect(preview.rows[0].adjustment).toBe(25)
    expect(preview.rows[0].entry_direction).toBe('debit')
    expect(preview.totalGain).toBe(25)
    expect(preview.entries.map(e => [e.account_id, e.direction, e.amount])).toEqual([
      [USD_ACC, 'debit', 25],
      [GAIN_ACC, 'credit', 25],
    ])

    const run = runFxRevaluation({ db: testDb, accountSetId: SET, year: 2026, period: 3, userId: 'u1', userName: '张三' })
    expect(run.error).toBeNull()
    expect(run.voucherNo).toBeTruthy()

    const voucher = testDb.prepare('SELECT * FROM vouchers WHERE id = ?').get(run.voucherId) as any
    expect(voucher.status).toBe('posted')
    expect(voucher.source).toBe(FX_REVAL_SOURCE)
    expect(voucher.remark).toBe('2026年3期期末调汇')
    expect(voucher.voucher_date).toBe('2026-03-31')

    const entries = testDb.prepare('SELECT * FROM voucher_entries WHERE voucher_id = ? ORDER BY seq').all(run.voucherId) as any[]
    expect(entries).toHaveLength(2)
    // 只调本位币，不带原币
    expect(entries.every(e => e.foreign_amount == null && e.currency_code == null)).toBe(true)

    const after = foreignRow(testDb, USD_ACC)
    expect(after.foreign_end_balance).toBe(100)
    expect(after.end_balance).toBe(725)

    // 再预览：无差额、已生成
    const again = previewFxRevaluation({ db: testDb, accountSetId: SET, year: 2026, period: 3 })
    expect(again.alreadyGenerated).toBe(true)
    expect(again.rows[0].adjustment).toBe(0)
    expect(again.entries).toHaveLength(0)
  })

  it('借方科目汇率下降 → 贷外币科目 / 借汇兑损益；贷方科目汇率上升 → 贷外币科目 / 借损益', () => {
    seedBalance(testDb, USD_ACC, 'debit', 100, 725)
    seedBalance(testDb, LOAN_ACC, 'credit', 200, 1400)
    testDb.prepare(`UPDATE currencies SET end_rate = 7.1 WHERE id = 'c-usd'`).run()

    const preview = previewFxRevaluation({ db: testDb, accountSetId: SET, year: 2026, period: 3 })
    const usd = preview.rows.find(r => r.account_id === USD_ACC)!
    const loan = preview.rows.find(r => r.account_id === LOAN_ACC)!
    // 725 → 710：借方科目余额减少 15，贷记外币科目、借记损益（损失）
    expect(usd.adjustment).toBe(-15)
    expect(usd.entry_direction).toBe('credit')
    // 1400 → 1420：贷方科目余额增加 20，贷记外币科目、借记损益（损失）
    expect(loan.adjustment).toBe(20)
    expect(loan.entry_direction).toBe('credit')
    expect(preview.totalLoss).toBe(35)
    expect(preview.totalGain).toBe(0)

    const run = runFxRevaluation({ db: testDb, accountSetId: SET, year: 2026, period: 3 })
    expect(run.error).toBeNull()
    expect(foreignRow(testDb, USD_ACC).end_balance).toBe(710)
    expect(foreignRow(testDb, LOAN_ACC).end_balance).toBe(1420)
    expect(foreignRow(testDb, LOAN_ACC).foreign_end_balance).toBe(200)
  })

  it('无差额不生成；缺汇兑损益科目 / 未开外币 / 期间已结账 / 重复生成均拒绝', () => {
    seedBalance(testDb, USD_ACC, 'debit', 100, 700)
    expect(runFxRevaluation({ db: testDb, accountSetId: SET, year: 2026, period: 3 }).error).toContain('无需调汇')

    testDb.prepare(`UPDATE currencies SET end_rate = 7.25 WHERE id = 'c-usd'`).run()

    setGainAccount(testDb, null)
    expect(runFxRevaluation({ db: testDb, accountSetId: SET, year: 2026, period: 3 }).error).toContain('汇兑损益科目')
    setGainAccount(testDb, '6603')

    testDb.prepare(`UPDATE system_params SET param_value = 'false' WHERE param_key = 'enable_foreign_currency'`).run()
    expect(runFxRevaluation({ db: testDb, accountSetId: SET, year: 2026, period: 3 }).error).toContain('未启用外币')
    testDb.prepare(`UPDATE system_params SET param_value = 'true' WHERE param_key = 'enable_foreign_currency'`).run()

    testDb
      .prepare(`INSERT INTO period_closing (id, account_set_id, year, period, status) VALUES ('pc', ?, 2026, 3, 'closed')`)
      .run(SET)
    expect(runFxRevaluation({ db: testDb, accountSetId: SET, year: 2026, period: 3 }).error).toContain('已结账')
    expect(revokeFxRevaluation({ db: testDb, accountSetId: SET, year: 2026, period: 3 }).error).toContain('已结账')
    testDb.prepare(`DELETE FROM period_closing`).run()

    expect(runFxRevaluation({ db: testDb, accountSetId: SET, year: 2026, period: 3 }).error).toBeNull()
    expect(runFxRevaluation({ db: testDb, accountSetId: SET, year: 2026, period: 3 }).error).toContain('先反调汇')
  })

  it('原币为 0 但本位币有余额（历史科目后勾外币）：标记跳过，不把整笔余额冲成损益', () => {
    seedBalance(testDb, USD_ACC, 'debit', 0, 139841.29)
    testDb.prepare(`UPDATE currencies SET end_rate = 7.25 WHERE id = 'c-usd'`).run()

    const preview = previewFxRevaluation({ db: testDb, accountSetId: SET, year: 2026, period: 3 })
    expect(preview.rows).toHaveLength(1)
    expect(preview.rows[0].skip_reason).toContain('原币')
    expect(preview.rows[0].entry_direction).toBeNull()
    expect(preview.entries).toHaveLength(0)
    expect(runFxRevaluation({ db: testDb, accountSetId: SET, year: 2026, period: 3 }).error).toContain('无需调汇')
  })

  it('反调汇：反过账、删凭证与 run，余额回到调汇前，可再生成', () => {
    seedBalance(testDb, USD_ACC, 'debit', 100, 700)
    testDb.prepare(`UPDATE currencies SET end_rate = 7.25 WHERE id = 'c-usd'`).run()

    expect(revokeFxRevaluation({ db: testDb, accountSetId: SET, year: 2026, period: 3 }).error).toContain('未生成')

    const run = runFxRevaluation({ db: testDb, accountSetId: SET, year: 2026, period: 3 })
    expect(run.error).toBeNull()
    expect(foreignRow(testDb, USD_ACC).end_balance).toBe(725)

    const revoke = revokeFxRevaluation({ db: testDb, accountSetId: SET, year: 2026, period: 3 })
    expect(revoke.error).toBeNull()
    expect(revoke.voucherId).toBe(run.voucherId)
    // 只剩造余额的那张种子凭证（2 条分录），调汇凭证已被删除
    expect(testDb.prepare('SELECT COUNT(*) AS n FROM vouchers').get()).toEqual({ n: 1 })
    expect(testDb.prepare('SELECT COUNT(*) AS n FROM voucher_entries').get()).toEqual({ n: 2 })
    expect(
      testDb.prepare(`SELECT COUNT(*) AS n FROM vouchers WHERE source = ?`).get(FX_REVAL_SOURCE)
    ).toEqual({ n: 0 })
    expect(testDb.prepare('SELECT COUNT(*) AS n FROM fx_revaluation_runs').get()).toEqual({ n: 0 })
    expect(foreignRow(testDb, USD_ACC).end_balance).toBe(700)
    expect(foreignRow(testDb, GAIN_ACC)).toBeUndefined()

    const rerun = runFxRevaluation({ db: testDb, accountSetId: SET, year: 2026, period: 3 })
    expect(rerun.error).toBeNull()
    expect(foreignRow(testDb, USD_ACC).end_balance).toBe(725)
  })
})
