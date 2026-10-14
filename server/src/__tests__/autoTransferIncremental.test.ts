import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { up as autoTransferRunsMultiUp } from '../db/migrations/20261013_auto_transfer_runs_multi.js'
import {
  buildAllTransferPreviews,
  createAllTransferVouchers,
  redoTransferVouchers,
  revokeAllTransferVouchers,
} from '../services/autoTransfer.js'

// 第五份反馈：损益结转后又有收入凭证记账，可以直接「补结差额」，也可以「重新结转」，不必手工删凭证。

const SET = 'set-at'
const Y = 2026
const P = 10

function createDb() {
  const schemaPath = resolve(dirname(fileURLToPath(import.meta.url)), '../db/schema.sql')
  const db = new Database(':memory:')
  db.exec(readFileSync(schemaPath, 'utf-8'))
  db.exec(`ALTER TABLE vouchers ADD COLUMN source TEXT DEFAULT NULL`)
  db.prepare(
    `INSERT INTO account_sets (id, name, code, fiscal_year, start_date, status) VALUES (?, 'AT', 'AT', 2026, '2026-01-01', 'active')`
  ).run(SET)
  db.prepare(`INSERT INTO users (id, account_set_id, username, password) VALUES ('u1', ?, 'zs', 'x')`).run(SET)
  db.prepare(
    `INSERT INTO voucher_types (id, account_set_id, name, code, sort_order) VALUES ('vt-jz', ?, '记', '1', 1)`
  ).run(SET)
  const insAcc = db.prepare(
    `INSERT INTO accounts (id, account_set_id, code, name, direction, level) VALUES (?, ?, ?, ?, ?, 1)`
  )
  insAcc.run('a6001', SET, '6001', '主营业务收入', 'credit')
  insAcc.run('a6602', SET, '6602', '管理费用', 'debit')
  insAcc.run('a4103', SET, '4103', '本年利润', 'credit')
  db.prepare(
    `INSERT INTO transfer_types (id, account_set_id, code, name, voucher_type) VALUES ('tt1', ?, '01', '结转损益', '记')`
  ).run(SET)
  const insItem = db.prepare(
    `INSERT INTO transfer_items (id, account_set_id, type_code, summary, from_code, to_code, transfer_type, ratio, sort_order)
     VALUES (?, ?, '01', '结转损益', ?, ?, ?, ?, ?)`
  )
  insItem.run('i1', SET, '6001', null, 'all', 100, 1)
  insItem.run('i2', SET, '6602', null, 'all', 100, 2)
  insItem.run('i3', SET, null, '4103', 'all', 100, 3)
  return db
}

/** 模拟已记账的业务凭证：直接累加 account_balances 的本期发生额 */
function postBalance(db: Database.Database, accountId: string, debit: number, credit: number) {
  const acc = db.prepare('SELECT code, name, direction FROM accounts WHERE id=?').get(accountId) as any
  db.prepare(
    `INSERT INTO account_balances (id, account_set_id, account_id, account_code, account_name, direction, year, period, init_balance, current_debit, current_credit, end_balance, aux_item_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 0, '')
     ON CONFLICT(account_set_id, account_id, year, period, aux_item_id)
     DO UPDATE SET current_debit = current_debit + excluded.current_debit,
                   current_credit = current_credit + excluded.current_credit`
  ).run(`b-${Math.random()}`, SET, accountId, acc.code, acc.name, acc.direction, Y, P, debit, credit)
}

function endBalance(db: Database.Database, code: string) {
  const row = db
    .prepare(
      `SELECT SUM(CASE WHEN a.direction='debit' THEN ab.current_debit-ab.current_credit ELSE ab.current_credit-ab.current_debit END) AS b
       FROM account_balances ab JOIN accounts a ON a.id=ab.account_id
       WHERE ab.account_set_id=? AND ab.year=? AND ab.period<=? AND ab.account_code=?`
    )
    .get(SET, Y, P, code) as any
  return Number(Number(row?.b || 0).toFixed(2))
}

function voucherEntries(db: Database.Database, voucherId: string) {
  return db
    .prepare(
      `SELECT a.code, ve.direction, ve.amount, ve.summary FROM voucher_entries ve JOIN accounts a ON a.id=ve.account_id
       WHERE ve.voucher_id=? ORDER BY a.code`
    )
    .all(voucherId) as Array<{ code: string; direction: string; amount: number; summary: string }>
}

function run(db: Database.Database) {
  return createAllTransferVouchers({ db, accountSetId: SET, userId: 'u1', userName: '张三', year: Y, period: P })
}

describe('损益结转：补结差额 / 重新结转', () => {
  let db: Database.Database
  beforeEach(() => {
    db = createDb()
    autoTransferRunsMultiUp(db)
  })

  it('结转后再记一笔收入：预览显示差额可勾选，执行只结新增部分，损益归零', () => {
    postBalance(db, 'a6001', 0, 1000)
    postBalance(db, 'a6602', 300, 0)
    const first = run(db)
    expect(first.results[0].skipped).toBe(false)
    expect(endBalance(db, '6001')).toBe(0)
    expect(endBalance(db, '4103')).toBe(700)

    // 结平后预览：已结平，不可勾
    let preview = buildAllTransferPreviews({ db, accountSetId: SET, year: Y, period: P })
    expect(preview.previews[0].selectable).toBe(false)
    expect(preview.previews[0].disabledReason).toBe('已结平，无差额')

    // 再过账一笔收入 200
    postBalance(db, 'a6001', 0, 200)
    preview = buildAllTransferPreviews({ db, accountSetId: SET, year: Y, period: P })
    const p0 = preview.previews[0] as any
    expect(p0.selectable).toBe(true)
    expect(p0.incremental).toBe(true)
    expect(p0.runCount).toBe(1)
    expect(p0.totals.debitTotal).toBe(200)

    const second = run(db)
    const r = second.results[0] as any
    expect(r.skipped).toBe(false)
    expect(r.seq).toBe(2)
    const entries = voucherEntries(db, r.voucherId)
    expect(entries).toEqual([
      expect.objectContaining({ code: '4103', direction: 'credit', amount: 200 }),
      expect.objectContaining({ code: '6001', direction: 'debit', amount: 200 }),
    ])
    expect(entries[0].summary).toContain('补结差额')
    expect(endBalance(db, '6001')).toBe(0)
    expect(endBalance(db, '4103')).toBe(900)
    const runs = db.prepare('SELECT seq FROM auto_transfer_runs ORDER BY seq').all() as any[]
    expect(runs.map(x => x.seq)).toEqual([1, 2])
  })

  it('结转后收入被冲减：差额为负时按反方向结转，不会翻倍', () => {
    postBalance(db, 'a6001', 0, 1000)
    run(db)
    postBalance(db, 'a6001', 150, 0) // 冲减收入 150，6001 余额变为借方 150
    const second = run(db)
    const r = second.results[0] as any
    const entries = voucherEntries(db, r.voucherId)
    expect(entries).toEqual([
      expect.objectContaining({ code: '4103', direction: 'debit', amount: 150 }),
      expect.objectContaining({ code: '6001', direction: 'credit', amount: 150 }),
    ])
    expect(endBalance(db, '6001')).toBe(0)
    expect(endBalance(db, '4103')).toBe(850)
  })

  it('已结平时执行不生成凭证', () => {
    postBalance(db, 'a6001', 0, 1000)
    run(db)
    const again = run(db)
    expect(again.results[0].skipped).toBe(true)
    expect(again.results[0].reason).toBe('已结平，无差额')
    expect((db.prepare('SELECT COUNT(*) c FROM auto_transfer_runs').get() as any).c).toBe(1)
  })

  it('按比例结转的规则不允许补结差额', () => {
    db.prepare(`UPDATE transfer_items SET transfer_type='partial', ratio=50 WHERE id='i1'`).run()
    postBalance(db, 'a6001', 0, 1000)
    run(db)
    postBalance(db, 'a6001', 0, 200)
    const preview = buildAllTransferPreviews({ db, accountSetId: SET, year: Y, period: P })
    expect(preview.previews[0].selectable).toBe(false)
    expect(preview.previews[0].disabledReason).toContain('重新结转')
    const again = run(db)
    expect(again.results[0].skipped).toBe(true)
  })

  it('重新结转：删除原有全部结转凭证（含补结），按当前余额只生成一张', () => {
    postBalance(db, 'a6001', 0, 1000)
    run(db)
    postBalance(db, 'a6001', 0, 200)
    run(db)
    postBalance(db, 'a6602', 50, 0)
    const result = redoTransferVouchers({
      db, accountSetId: SET, userId: 'u1', userName: '张三', year: Y, period: P, transferTypeCodes: ['01'],
    })
    expect(result.error).toBeNull()
    expect(result.revoked.filter(x => x.success)).toHaveLength(2)
    const runs = db.prepare('SELECT voucher_id, seq FROM auto_transfer_runs').all() as any[]
    expect(runs).toHaveLength(1)
    expect(runs[0].seq).toBe(1)
    expect(endBalance(db, '6001')).toBe(0)
    expect(endBalance(db, '6602')).toBe(0)
    expect(endBalance(db, '4103')).toBe(1150)
    expect((db.prepare('SELECT COUNT(*) c FROM vouchers').get() as any).c).toBe(1)
  })

  it('反结转按类型过滤只撤销所选类型', () => {
    db.prepare(
      `INSERT INTO transfer_types (id, account_set_id, code, name, voucher_type) VALUES ('tt2', ?, '02', '其他', '记')`
    ).run(SET)
    postBalance(db, 'a6001', 0, 1000)
    run(db)
    const res = revokeAllTransferVouchers({ db, accountSetId: SET, year: Y, period: P, transferTypeCodes: ['02'] })
    expect(res.error).toBe('本期未生成自动结转凭证，无需反结转')
    expect((db.prepare('SELECT COUNT(*) c FROM auto_transfer_runs').get() as any).c).toBe(1)
  })
})
