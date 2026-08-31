import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import {
  applyVoucherUnpost,
  type VoucherEntryLike,
  type VoucherLike,
  type PostingContext,
} from '../services/voucherPosting.js'

/**
 * FIX-008 / P1-12：反过账时不能把辅助核算分录错扣到「非辅助桶」。
 *
 * 旧 BUG：当 revertBalanceExact（按 aux_item_id 精确匹配）未命中时，
 * 旧代码回退到 `aux_item_id IS NULL OR ''` 的非辅助行扣减——
 * 这会把辅助核算分录的金额扣到错误的桶上，污染余额。
 */

function createDb() {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE vouchers (
      id TEXT PRIMARY KEY, account_set_id TEXT, year INTEGER, period INTEGER, status TEXT,
      poster_id TEXT, poster_name TEXT, posted_at TEXT, updated_at TEXT
    );
    CREATE TABLE voucher_entries (
      id TEXT PRIMARY KEY, account_set_id TEXT, voucher_id TEXT, seq INTEGER,
      account_id TEXT, account_code TEXT, account_name TEXT,
      direction TEXT, amount REAL, amount_cents INTEGER,
      dept_id TEXT, project_id TEXT, supplier_id TEXT, person_id TEXT, func_class_id TEXT,
      aux_data TEXT
    );
    CREATE TABLE account_balances (
      id TEXT PRIMARY KEY, account_set_id TEXT, account_id TEXT,
      account_code TEXT, account_name TEXT, direction TEXT,
      year INTEGER, period INTEGER,
      init_balance REAL DEFAULT 0,
      current_debit REAL DEFAULT 0,
      current_credit REAL DEFAULT 0,
      end_balance REAL DEFAULT 0,
      end_debit REAL DEFAULT 0,
      end_credit REAL DEFAULT 0,
      aux_item_id TEXT DEFAULT '',
      UNIQUE(account_set_id, account_id, year, period, aux_item_id)
    );
  `)
  return db
}

const ctx: PostingContext = {
  accountSetId: 'set1',
  userId: 'u1',
  userName: 'U',
  requireAudit: true,
  allowDirectPost: false,
}

function insertVoucherAndEntry(
  db: Database.Database,
  opts: {
    voucherId: string
    accountId: string
    direction: 'debit' | 'credit'
    amount: number
    deptId?: string
  }
) {
  db.prepare(
    `INSERT INTO vouchers VALUES (?, 'set1', 2026, 5, 'posted', 'u1', 'U', datetime('now'), datetime('now'))`
  ).run(opts.voucherId)
  db.prepare(
    `INSERT INTO voucher_entries
     (id, account_set_id, voucher_id, seq, account_id, account_code, account_name,
      direction, amount, amount_cents, dept_id)
     VALUES (?, 'set1', ?, 1, ?, '1001', '库存现金', ?, ?, ?, ?)`
  ).run(
    `${opts.voucherId}-e`,
    opts.voucherId,
    opts.accountId,
    opts.direction,
    opts.amount,
    Math.round(opts.amount * 100),
    opts.deptId ?? null
  )
}

describe('FIX-008 / P1-12 反过账 aux 桶隔离', () => {
  it('辅助分录反过账时只扣对应辅助行，不扣非辅助行', () => {
    const db = createDb()

    // 同账户两条余额行：一条无辅助 = 100，一条辅助 dept:d1 = 100
    db.prepare(
      `INSERT INTO account_balances
       (id, account_set_id, account_id, account_code, account_name, direction, year, period,
        current_debit, current_credit, end_balance, aux_item_id)
       VALUES ('ab-no-aux', 'set1', 'acc1', '1001', '库存现金', 'debit', 2026, 5,
               100, 0, 100, '')`
    ).run()
    db.prepare(
      `INSERT INTO account_balances
       (id, account_set_id, account_id, account_code, account_name, direction, year, period,
        current_debit, current_credit, end_balance, aux_item_id)
       VALUES ('ab-aux', 'set1', 'acc1', '1001', '库存现金', 'debit', 2026, 5,
               100, 0, 100, 'dept:d1')`
    ).run()

    insertVoucherAndEntry(db, {
      voucherId: 'v1',
      accountId: 'acc1',
      direction: 'debit',
      amount: 100,
      deptId: 'd1',
    })

    const voucher: VoucherLike = { id: 'v1', year: 2026, period: 5, status: 'posted' }
    const entries = db.prepare('SELECT * FROM voucher_entries WHERE voucher_id=?').all('v1') as VoucherEntryLike[]

    applyVoucherUnpost(db, voucher, entries, ctx)

    const noAux = db
      .prepare("SELECT current_debit FROM account_balances WHERE id='ab-no-aux'")
      .get() as { current_debit: number } | undefined
    const aux = db
      .prepare("SELECT current_debit FROM account_balances WHERE id='ab-aux'")
      .get() as { current_debit: number } | undefined

    // 非辅助行应保持 100 不变
    expect(noAux?.current_debit).toBe(100)
    // 辅助行扣 100 后变 0，且因 cleanupZeroBalance 被删除
    expect(aux).toBeUndefined()
  })

  it('反过账时如对应余额行不存在则抛错（不再静默回退到非辅助桶）', () => {
    const db = createDb()
    // 只有非辅助行存在，但分录是辅助的 → 旧 BUG 会扣到非辅助行
    db.prepare(
      `INSERT INTO account_balances
       (id, account_set_id, account_id, account_code, account_name, direction, year, period,
        current_debit, current_credit, end_balance, aux_item_id)
       VALUES ('ab-no-aux', 'set1', 'acc1', '1001', '库存现金', 'debit', 2026, 5,
               999, 0, 999, '')`
    ).run()

    insertVoucherAndEntry(db, {
      voucherId: 'v2',
      accountId: 'acc1',
      direction: 'debit',
      amount: 100,
      deptId: 'd-orphan',
    })

    const voucher: VoucherLike = { id: 'v2', year: 2026, period: 5, status: 'posted' }
    const entries = db.prepare('SELECT * FROM voucher_entries WHERE voucher_id=?').all('v2') as VoucherEntryLike[]

    expect(() => applyVoucherUnpost(db, voucher, entries, ctx)).toThrow(/反记账失败.*未找到对应余额行/)

    // 关键断言：非辅助行没被错扣（仍为 999）
    const noAux = db
      .prepare("SELECT current_debit FROM account_balances WHERE id='ab-no-aux'")
      .get() as { current_debit: number }
    expect(noAux.current_debit).toBe(999)
  })

  it('aux_item_id 为 NULL 的旧数据行能与 "" 等价匹配（COALESCE 兼容）', () => {
    const db = createDb()
    // 旧数据：aux_item_id 是 NULL 而非空字符串
    db.exec(`
      INSERT INTO account_balances
        (id, account_set_id, account_id, account_code, account_name, direction, year, period,
         current_debit, current_credit, end_balance, aux_item_id)
        VALUES ('ab-null', 'set1', 'acc1', '1001', '库存现金', 'debit', 2026, 5,
                50, 0, 50, NULL)
    `)
    insertVoucherAndEntry(db, {
      voucherId: 'v3',
      accountId: 'acc1',
      direction: 'debit',
      amount: 50,
      // 无辅助
    })
    const voucher: VoucherLike = { id: 'v3', year: 2026, period: 5, status: 'posted' }
    const entries = db.prepare('SELECT * FROM voucher_entries WHERE voucher_id=?').all('v3') as VoucherEntryLike[]
    expect(() => applyVoucherUnpost(db, voucher, entries, ctx)).not.toThrow()
    const remaining = db
      .prepare("SELECT current_debit FROM account_balances WHERE id='ab-null'")
      .get() as { current_debit: number } | undefined
    // 行变为 0 后被 cleanupZeroBalance 删除
    expect(remaining).toBeUndefined()
  })
})
