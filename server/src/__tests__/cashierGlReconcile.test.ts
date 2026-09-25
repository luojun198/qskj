/**
 * FIX-262：出纳对账 = 出纳日记账 ↔ 总账已记账分录。
 * 关联匹配、金额匹配（含日期容差）、一对多 / 多对一手动对账、N:N 与净额不等拒绝、未记账不可对、
 * 撤销整批、分录删除 / 反记账 / 改金额 / 出纳行改金额后批次失效、外币按原币、对账表调节与期初差异、已结账月份拦截。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { up as glMatchUp } from '../db/migrations/20260924_cashier_gl_match.js'
import { up as periodClosingUp } from '../db/migrations/20260916_cashier_period_closing.js'
import {
  autoMatch, manualMatch, cancelMatch, pruneStaleMatches, listCashierRows, listGlEntries, getCashierGlReport,
} from '../services/cashierGlReconcile.js'

const AS = 'as1'
const BANK = '1002'
const USD = '100202'

let db: Database.Database
const scope = (code = BANK) => ({ db, accountSetId: AS, accountCode: code })

function j(id: string, date: string, debit: number, credit: number, extra: { code?: string; cur?: string; voucher?: string; bill?: string; summary?: string } = {}) {
  db.prepare(`INSERT INTO cashier_journal (id, account_set_id, account_code, currency, biz_date, seq, summary, debit, credit, bill_no, voucher_id, reconciled)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,0)`).run(id, AS, extra.code ?? BANK, extra.cur ?? 'RMB', date, 1, extra.summary ?? null, debit, credit, extra.bill ?? null, extra.voucher ?? null)
}
function v(id: string, date: string, status = 'posted') {
  db.prepare('INSERT INTO vouchers (id, account_set_id, voucher_no, voucher_type_id, voucher_date, year, period, status) VALUES (?,?,?,?,?,?,?,?)')
    .run(id, AS, `记-${id}`, 'vt', date, Number(date.slice(0, 4)), Number(date.slice(5, 7)), status)
}
function e(id: string, voucher: string, direction: 'debit' | 'credit', amount: number, extra: { code?: string; foreign?: number; cur?: string } = {}) {
  const code = extra.code ?? BANK
  db.prepare(`INSERT INTO voucher_entries (id, account_set_id, voucher_id, seq, account_id, account_code, direction, amount, foreign_amount, currency_code, summary)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(id, AS, voucher, 1, `a${code}`, code, direction, amount, extra.foreign ?? null, extra.cur ?? null, `分录${id}`)
}

beforeEach(() => {
  db = new Database(':memory:')
  db.exec(`
    CREATE TABLE accounts (id TEXT PRIMARY KEY, account_set_id TEXT, code TEXT, direction TEXT, parent_id TEXT, is_foreign INTEGER, currency_code TEXT);
    CREATE TABLE cashier_journal (id TEXT PRIMARY KEY, account_set_id TEXT, account_code TEXT, currency TEXT, biz_date TEXT, seq INTEGER,
      summary TEXT, debit REAL, credit REAL, bill_no TEXT, voucher_id TEXT, reconciled INTEGER DEFAULT 0, match_batch TEXT, bank_statement_id TEXT,
      created_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE cashier_init_balance (id TEXT PRIMARY KEY, account_set_id TEXT, account_code TEXT, currency TEXT, balance REAL, init_date TEXT);
    CREATE TABLE vouchers (id TEXT PRIMARY KEY, account_set_id TEXT, voucher_no TEXT, voucher_type_id TEXT, voucher_date TEXT, year INTEGER, period INTEGER, status TEXT);
    CREATE TABLE voucher_types (id TEXT PRIMARY KEY, name TEXT);
    CREATE TABLE voucher_entries (id TEXT PRIMARY KEY, account_set_id TEXT, voucher_id TEXT, seq INTEGER, account_id TEXT, account_code TEXT,
      direction TEXT, amount REAL, foreign_amount REAL, currency_code TEXT, summary TEXT);
    CREATE TABLE init_balances (id TEXT, account_set_id TEXT, account_id TEXT, year INTEGER, init_balance REAL, foreign_init_balance REAL DEFAULT 0, aux_item_id TEXT);
  `)
  glMatchUp(db)
  periodClosingUp(db)
  db.exec(`
    INSERT INTO voucher_types VALUES ('vt', '记');
    INSERT INTO accounts VALUES ('a${BANK}', '${AS}', '${BANK}', 'debit', NULL, 0, NULL);
    INSERT INTO accounts VALUES ('a${USD}', '${AS}', '${USD}', 'debit', NULL, 1, 'USD');
  `)
})

describe('cashierGlReconcile', () => {
  it('自动对账：关联匹配（出纳生成的凭证）+ 金额匹配（日期容差）', () => {
    j('c1', '2026-09-02', 50000, 0, { voucher: 'v1' })
    v('v1', '2026-09-02'); e('g1', 'v1', 'debit', 50000)
    j('c2', '2026-09-05', 0, 12000)
    v('v2', '2026-09-06'); e('g2', 'v2', 'credit', 12000)
    // 同日期容差 0 时 c2 不配对
    let r = autoMatch(scope())
    expect(r).toMatchObject({ linked: 1, matched: 0 })
    r = autoMatch(scope(), { dayTolerance: 1 })
    expect(r).toMatchObject({ linked: 0, matched: 1 })
    expect(listCashierRows(scope(), { matched: false })).toHaveLength(0)
    expect(listGlEntries(scope(), { matched: false }).rows).toHaveLength(0)
    const c1 = db.prepare("SELECT reconciled FROM cashier_journal WHERE id='c1'").get() as any
    expect(c1.reconciled).toBe(1)
  })

  it('未记账凭证不参与，计入未记账张数；不能手动对账', () => {
    j('c1', '2026-09-02', 100, 0)
    v('v1', '2026-09-02', 'audited'); e('g1', 'v1', 'debit', 100)
    expect(autoMatch(scope()).matched).toBe(0)
    const list = listGlEntries(scope())
    expect(list.rows).toHaveLength(0)
    expect(list.unposted).toBe(1)
    expect(manualMatch(scope(), ['c1'], ['g1'])).toEqual({ error: '只能与已记账凭证的分录对账' })
  })

  it('手动对账：多对一、一对多成立；N:N、净额不等拒绝；撤销整批', () => {
    // 多对一：出纳 5000 + 3000 ↔ 总账 8000
    j('c1', '2026-09-10', 5000, 0); j('c2', '2026-09-10', 3000, 0)
    v('v1', '2026-09-10'); e('g1', 'v1', 'debit', 8000)
    expect('ok' in manualMatch(scope(), ['c1', 'c2'], ['g1'])).toBe(true)
    // 一对多：出纳 1000 ↔ 总账 600 + 400
    j('c3', '2026-09-11', 0, 1000)
    v('v2', '2026-09-11'); e('g2', 'v2', 'credit', 600); e('g3', 'v2', 'credit', 400)
    expect('ok' in manualMatch(scope(), ['c3'], ['g2', 'g3'])).toBe(true)
    // N:N 与净额不等
    j('c4', '2026-09-12', 10, 0); j('c5', '2026-09-12', 20, 0)
    v('v3', '2026-09-12'); e('g4', 'v3', 'debit', 10); e('g5', 'v3', 'debit', 20)
    expect(manualMatch(scope(), ['c4', 'c5'], ['g4', 'g5'])).toEqual({ error: '只支持一对多或多对一：出纳或总账一方只能选 1 条' })
    expect(manualMatch(scope(), ['c4'], ['g5'])).toMatchObject({ error: expect.stringContaining('金额不一致') })
    // 重复对账拒绝
    expect(manualMatch(scope(), ['c1'], ['g4'])).toMatchObject({ error: expect.stringContaining('已对账') })
    // 按分录撤销整批：c1、c2 都回到未对
    expect(cancelMatch(scope(), 'g1')).toEqual({ ok: true })
    const back = listCashierRows(scope(), { matched: false }).map(r => r.id)
    expect(back).toEqual(expect.arrayContaining(['c1', 'c2']))
  })

  it('批次失效：分录删除 / 反记账 / 改金额 / 出纳行改金额', () => {
    const make = (n: number) => {
      j(`c${n}`, '2026-09-15', 100 * n, 0)
      v(`v${n}`, '2026-09-15'); e(`g${n}`, `v${n}`, 'debit', 100 * n)
    }
    make(1); make(2); make(3); make(4)
    expect(autoMatch(scope()).matched).toBe(4)
    db.prepare("DELETE FROM voucher_entries WHERE id='g1'").run()
    db.prepare("UPDATE vouchers SET status='audited' WHERE id='v2'").run()
    db.prepare("UPDATE voucher_entries SET amount=333 WHERE id='g3'").run()
    db.prepare("UPDATE cashier_journal SET debit=444.5 WHERE id='c4'").run()
    expect(pruneStaleMatches(scope())).toBe(4)
    expect(listCashierRows(scope(), { matched: false })).toHaveLength(4)
    expect((db.prepare('SELECT COUNT(*) n FROM cashier_gl_match').get() as any).n).toBe(0)
  })

  it('外币科目按原币对账', () => {
    j('u1', '2026-09-03', 100, 0, { code: USD, cur: 'USD' })
    v('v1', '2026-09-03'); e('g1', 'v1', 'debit', 720, { code: USD, foreign: 100, cur: 'USD' })
    expect(autoMatch(scope(USD)).matched).toBe(1)
  })

  it('已结账月份不参与自动对账、不能手动对账', () => {
    j('c1', '2026-08-20', 100, 0)
    v('v1', '2026-08-20'); e('g1', 'v1', 'debit', 100)
    db.prepare("INSERT INTO cashier_period_closing (id, account_set_id, year, month, status) VALUES ('p', ?, 2026, 8, 'closed')").run(AS)
    expect(autoMatch(scope()).matched).toBe(0)
    expect(manualMatch(scope(), ['c1'], ['g1'])).toMatchObject({ error: expect.stringContaining('已结账') })
  })

  it('对账表：调节后相等；出纳期初与总账不一致时差额 = 期初差异', () => {
    db.prepare("INSERT INTO cashier_init_balance VALUES ('ib', ?, ?, 'RMB', 30000, '2026-08-01')").run(AS, BANK)
    db.prepare("INSERT INTO init_balances VALUES ('i', ?, ?, 2026, 30000, 0, NULL)").run(AS, `a${BANK}`)
    j('c1', '2026-09-02', 50000, 0)
    j('c2', '2026-09-15', 20000, 0) // 出纳有、总账无
    v('v1', '2026-09-02'); e('g1', 'v1', 'debit', 50000)
    v('v2', '2026-09-20'); e('g2', 'v2', 'credit', 50) // 总账有、出纳无
    autoMatch(scope())
    let rep = getCashierGlReport(scope(), '2026-09-30')
    expect(rep.cashier_balance).toBe(100000)
    expect(rep.gl_balance).toBe(79950)
    expect(rep.cashier_unmatched.map(r => r.id)).toEqual(['c2'])
    expect(rep.gl_unmatched.map(r => r.id)).toEqual(['g2'])
    expect(rep.adjusted_cashier).toBe(80000)
    expect(rep.adjusted_gl).toBe(80000)
    expect(rep.difference).toBe(0)
    // 出纳期初录错 1000 → 差额 1000
    db.prepare("UPDATE cashier_init_balance SET balance=31000").run()
    rep = getCashierGlReport(scope(), '2026-09-30')
    expect(rep.difference).toBe(1000)
  })
})
