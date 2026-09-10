import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

import { buildForeignBalanceQuery } from '../services/ledgerQuery.js'

/**
 * 外币余额表新口径（凭证明细聚合）。
 *
 * 改造前它读 `account_balances.foreign_*`（过账后汇总表），拿不到日期区间、未记账凭证与
 * 本年累计，且与走凭证明细的辅助项目外币余额表对不上。这里锁定新口径的四个金额段。
 */

const SET = 'set-fxq'
const USD_ACC = 'acc-usd'
const HKD_ACC = 'acc-hkd'
const CNY_ACC = 'acc-cny'

function createDb() {
  const schemaPath = resolve(dirname(fileURLToPath(import.meta.url)), '../db/schema.sql')
  const db = new Database(':memory:')
  db.exec(readFileSync(schemaPath, 'utf-8'))
  db.prepare(
    `INSERT INTO account_sets (id, name, code, fiscal_year, start_date, status)
     VALUES (?, 'FXQ', 'FXQ', 2026, '2026-01-01', 'active')`
  ).run(SET)
  db.prepare(
    `INSERT INTO voucher_types (id, account_set_id, name, code, sort_order) VALUES ('vt', ?, '记账', '1', 1)`
  ).run(SET)
  const insAcc = db.prepare(
    `INSERT INTO accounts (id, account_set_id, code, name, direction, level, is_foreign, currency_code)
     VALUES (?, ?, ?, ?, ?, 1, ?, ?)`
  )
  insAcc.run(USD_ACC, SET, '1002001', '银行存款-美元', 'debit', 1, 'USD')
  insAcc.run(HKD_ACC, SET, '1002002', '银行存款-港币', 'debit', 1, 'HKD')
  insAcc.run(CNY_ACC, SET, '1001', '库存现金', 'debit', 0, null)
  return db
}

/** 期初：原币 foreign / 本位币 base，均为科目方向的正向余额 */
function seedInit(db: Database.Database, accountId: string, foreign: number, base: number) {
  db.prepare(
    `INSERT INTO init_balances (id, account_set_id, account_id, year, period, direction,
       init_balance, init_debit, init_credit, opening_debit, opening_credit,
       pre_book_debit, pre_book_credit, aux_item_id,
       foreign_init_balance, foreign_opening_debit, foreign_opening_credit,
       foreign_pre_book_debit, foreign_pre_book_credit)
     VALUES (?, ?, ?, 2026, 0, 'debit', ?, ?, 0, ?, 0, 0, 0, '', ?, ?, 0, 0, 0)`
  ).run(`ib-${accountId}`, SET, accountId, base, base, base, foreign, foreign)
}

let seq = 0
function seedVoucher(
  db: Database.Database,
  params: {
    accountId: string
    date: string
    direction: 'debit' | 'credit'
    amount: number
    foreignAmount?: number
    status?: 'draft' | 'audited' | 'posted'
  }
) {
  const vid = `v-${++seq}`
  const period = Number(params.date.slice(5, 7))
  db.prepare(
    `INSERT INTO vouchers (id, account_set_id, voucher_no, voucher_type_id, voucher_date, year, period, status, total_amount)
     VALUES (?, ?, ?, 'vt', ?, 2026, ?, ?, ?)`
  ).run(vid, SET, vid, params.date, period, params.status || 'posted', params.amount)
  const acc = db.prepare(`SELECT code, name, currency_code FROM accounts WHERE id = ?`).get(params.accountId) as {
    code: string
    name: string
    currency_code: string | null
  }
  db.prepare(
    `INSERT INTO voucher_entries (id, account_set_id, voucher_id, seq, account_id, account_code, account_name,
       direction, amount, currency_code, foreign_amount)
     VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    `${vid}-e`,
    SET,
    vid,
    params.accountId,
    acc.code,
    acc.name,
    params.direction,
    params.amount,
    acc.currency_code,
    params.foreignAmount ?? 0
  )
  return vid
}

function run(db: Database.Database, filters: Partial<Parameters<typeof buildForeignBalanceQuery>[0]> = {}) {
  const q = buildForeignBalanceQuery({
    accountSetId: SET,
    startDate: '2026-03-01',
    endDate: '2026-03-31',
    ...filters,
  })
  return db.prepare(q.sql).all(...q.params) as any[]
}

describe('外币余额表 buildForeignBalanceQuery', () => {
  let db: Database.Database
  beforeEach(() => {
    db = createDb()
    seq = 0
  })
  afterEach(() => db.close())

  it('只返回勾了外币核算的科目，本位币科目不进表', () => {
    seedInit(db, USD_ACC, 100, 700)
    seedInit(db, CNY_ACC, 0, 500)
    const rows = run(db)
    // CNY 科目未勾外币，不进表；HKD 科目虽无数据但已勾外币，未加筛选时仍会列出
    expect(rows.map(r => r.account_id).sort()).toEqual([HKD_ACC, USD_ACC].sort())
    expect(rows.find(r => r.account_id === USD_ACC).currency_code).toBe('USD')
  })

  it('期初 / 本期 / 本年累计 / 期末四段成对输出原币与本位币', () => {
    seedInit(db, USD_ACC, 100, 700)
    // 1 月：区间之前 → 计入期初与本年累计，不计入本期
    seedVoucher(db, { accountId: USD_ACC, date: '2026-01-10', direction: 'debit', amount: 140, foreignAmount: 20 })
    // 3 月：区间内 → 本期 + 本年累计
    seedVoucher(db, { accountId: USD_ACC, date: '2026-03-10', direction: 'debit', amount: 70, foreignAmount: 10 })
    seedVoucher(db, { accountId: USD_ACC, date: '2026-03-20', direction: 'credit', amount: 35, foreignAmount: 5 })

    const row = run(db).find(r => r.account_id === USD_ACC)
    expect(row.foreign_init_balance).toBe(120)
    expect(row.init_balance).toBe(840)
    expect(row.foreign_current_debit).toBe(10)
    expect(row.current_debit).toBe(70)
    expect(row.foreign_current_credit).toBe(5)
    expect(row.current_credit).toBe(35)
    // 本年累计从 1 月 1 日算起，含区间之前的 1 月凭证
    expect(row.foreign_year_debit).toBe(30)
    expect(row.year_debit).toBe(210)
    expect(row.foreign_year_credit).toBe(5)
    expect(row.year_credit).toBe(35)
    expect(row.foreign_end_balance).toBe(125)
    expect(row.end_balance).toBe(875)
  })

  it('include_unposted 决定草稿/已审核凭证是否计入', () => {
    seedVoucher(db, { accountId: USD_ACC, date: '2026-03-10', direction: 'debit', amount: 70, foreignAmount: 10 })
    seedVoucher(db, {
      accountId: USD_ACC,
      date: '2026-03-11',
      direction: 'debit',
      amount: 140,
      foreignAmount: 20,
      status: 'draft',
    })

    const usd = (rows: any[]) => rows.find(r => r.account_id === USD_ACC)
    expect(usd(run(db)).foreign_current_debit).toBe(10)
    expect(usd(run(db, { includeUnposted: true })).foreign_current_debit).toBe(30)
  })

  it('currencyCode 只保留该币种科目', () => {
    seedInit(db, USD_ACC, 100, 700)
    seedInit(db, HKD_ACC, 200, 180)
    expect(run(db).map(r => r.account_id).sort()).toEqual([HKD_ACC, USD_ACC].sort())
    const hkd = run(db, { currencyCode: 'hkd' })
    expect(hkd).toHaveLength(1)
    expect(hkd[0].account_id).toBe(HKD_ACC)
    expect(hkd[0].foreign_init_balance).toBe(200)
  })

  it('filterTypes 本位币与原币任一命中即保留', () => {
    seedInit(db, USD_ACC, 100, 700)
    // HKD 科目本期只有原币发生额（本位币为 0），has_amount 也应保留
    seedVoucher(db, { accountId: HKD_ACC, date: '2026-03-10', direction: 'debit', amount: 0, foreignAmount: 8 })

    expect(run(db, { filterTypes: ['init_balance'] }).map(r => r.account_id)).toEqual([USD_ACC])
    expect(run(db, { filterTypes: ['has_amount'] }).map(r => r.account_id)).toEqual([HKD_ACC])
    expect(run(db, { filterTypes: ['init_balance', 'has_amount'] })).toHaveLength(2)
  })

  it('accountCode 前缀筛选，结果按币种 + 科目编码排序', () => {
    seedInit(db, USD_ACC, 100, 700)
    seedInit(db, HKD_ACC, 200, 180)
    expect(run(db).map(r => r.account_code)).toEqual(['1002002', '1002001'])
    expect(run(db, { accountCode: '1002001' }).map(r => r.account_code)).toEqual(['1002001'])
  })

  it('贷方科目余额按方向签名：贷方发生额增加余额', () => {
    db.prepare(
      `INSERT INTO accounts (id, account_set_id, code, name, direction, level, is_foreign, currency_code)
       VALUES ('acc-loan', ?, '2001001', '短期借款-美元', 'credit', 1, 1, 'USD')`
    ).run(SET)
    seedVoucher(db, { accountId: 'acc-loan', date: '2026-03-10', direction: 'credit', amount: 700, foreignAmount: 100 })
    const row = run(db).find(r => r.account_id === 'acc-loan')
    expect(row.foreign_end_balance).toBe(100)
    expect(row.end_balance).toBe(700)
  })

  it('缺 foreign_opening / foreign_pre_book 列时原币期初回退到 foreign_init_balance', () => {
    seedInit(db, USD_ACC, 100, 700)
    const row = run(db, { foreignPreBookEnabled: false }).find(r => r.account_id === USD_ACC)
    expect(row.foreign_init_balance).toBe(100)
    expect(row.init_balance).toBe(700)
  })
})
