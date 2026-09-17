/**
 * 出纳查询/对账/凭证联动单元测试
 *
 * cashierQuery 是出纳域唯一服务且此前无测试。这里用最小内存库覆盖：
 *  - 出纳生成凭证：收入/支出方向、缺对方科目拦截、挂账末级校验、对方科目不存在
 *  - 银行勾对：手动勾对与撤销（cashier_journal ↔ bank_statement 联动）
 *  - 凭证同步日记账：默认关闭、开启后幂等（voucher_type NULL 的查重修复）
 *  - 编辑出纳凭证回写对方科目
 */
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import {
  generateCashierVoucher,
  manualReconcile,
  cancelReconcile,
  syncCashierFromVoucher,
  syncCashierCounterFromVoucher,
} from '../services/cashierQuery.js'

const ASID = 'set-1'

function createDb(): Database.Database {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE accounts (
      id TEXT PRIMARY KEY, account_set_id TEXT, code TEXT, name TEXT,
      direction TEXT, parent_id TEXT, is_cash INTEGER DEFAULT 0, is_bank INTEGER DEFAULT 0
    );
    CREATE TABLE voucher_types (
      id TEXT PRIMARY KEY, account_set_id TEXT, name TEXT, code TEXT, sort_order INTEGER DEFAULT 0
    );
    CREATE TABLE vouchers (
      id TEXT PRIMARY KEY, account_set_id TEXT, voucher_no TEXT, voucher_type_id TEXT,
      voucher_date TEXT, year INTEGER, period INTEGER, total_amount REAL,
      maker_name TEXT, remark TEXT, source TEXT, status TEXT DEFAULT 'draft',
      created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE voucher_entries (
      id TEXT PRIMARY KEY, account_set_id TEXT, voucher_id TEXT, seq INTEGER,
      account_id TEXT, account_code TEXT, account_name TEXT, direction TEXT,
      amount REAL, amount_cents INTEGER, summary TEXT,
      dept_id TEXT, dept_name TEXT, project_id TEXT, project_name TEXT,
      supplier_id TEXT, supplier_name TEXT, person_id TEXT, person_name TEXT,
      func_class_id TEXT, func_class_name TEXT, aux_data TEXT
    );
    CREATE TABLE cashier_journal (
      id TEXT PRIMARY KEY, account_set_id TEXT, account_code TEXT, currency TEXT DEFAULT 'RMB',
      biz_date TEXT, seq INTEGER DEFAULT 0, summary TEXT, debit REAL DEFAULT 0, credit REAL DEFAULT 0,
      settle_type TEXT, bill_no TEXT, counter_unit TEXT, counter_account TEXT,
      bank_name TEXT, bank_account TEXT, unit_code TEXT, reconciled INTEGER DEFAULT 0,
      match_batch TEXT, voucher_year INTEGER, voucher_month INTEGER, voucher_type TEXT, voucher_no TEXT,
      counter_aux_item_id TEXT, created_by TEXT,
      created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE bank_statement (
      id TEXT PRIMARY KEY, account_set_id TEXT, account_code TEXT, biz_date TEXT,
      debit REAL DEFAULT 0, credit REAL DEFAULT 0, settle_type TEXT, bill_no TEXT,
      matched INTEGER DEFAULT 0, match_batch INTEGER, source TEXT DEFAULT 'import',
      created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE system_params (id TEXT PRIMARY KEY, account_set_id TEXT, param_key TEXT, param_value TEXT);
    CREATE TABLE aux_categories (id TEXT PRIMARY KEY, account_set_id TEXT, code TEXT, name TEXT);
    CREATE TABLE aux_items (id TEXT PRIMARY KEY, account_set_id TEXT, name TEXT);
  `)
  // 现金 1001、对方科目 1122/2202、上级科目 1122（父）
  const acc = db.prepare(
    'INSERT INTO accounts (id, account_set_id, code, name, direction, parent_id, is_cash) VALUES (?,?,?,?,?,?,?)'
  )
  acc.run('a1001', ASID, '1001', '库存现金', 'debit', null, 1)
  acc.run('a1122', ASID, '1122', '应收账款', 'debit', null, 0)
  acc.run('a2202', ASID, '2202', '应付账款', 'credit', null, 0)
  acc.run('a1122p', ASID, '11', '往来类', 'debit', null, 0) // 父科目（1122 挂其下）
  db.prepare('UPDATE accounts SET parent_id=? WHERE id=?').run('a1122p', 'a1122')
  db.prepare(
    "INSERT INTO voucher_types (id, account_set_id, name, code, sort_order) VALUES ('vt1', ?, '记账凭证', '1', 1)"
  ).run(ASID)
  return db
}

function addJournal(
  db: Database.Database,
  row: Partial<{ id: string; debit: number; credit: number; counter_account: string | null; biz_date: string }>
) {
  const r = {
    id: row.id ?? 'j1',
    debit: row.debit ?? 0,
    credit: row.credit ?? 0,
    counter_account: row.counter_account ?? null,
    biz_date: row.biz_date ?? '2026-09-10',
  }
  db.prepare(
    `INSERT INTO cashier_journal (id, account_set_id, account_code, currency, biz_date, seq, summary, debit, credit, counter_account, reconciled)
     VALUES (?, ?, '1001', 'RMB', ?, 1, '测试', ?, ?, ?, 0)`
  ).run(r.id, ASID, r.biz_date, r.debit, r.credit, r.counter_account)
  return r
}

function entriesOf(db: Database.Database, voucherId: string) {
  return db
    .prepare('SELECT account_code, direction, amount FROM voucher_entries WHERE voucher_id=? ORDER BY seq')
    .all(voucherId) as Array<{ account_code: string; direction: string; amount: number }>
}

describe('出纳生成凭证 generateCashierVoucher', () => {
  let db: Database.Database
  beforeEach(() => {
    db = createDb()
  })

  it('收入（借现金）：借 1001 / 贷 对方科目', () => {
    addJournal(db, { debit: 100, counter_account: '1122' })
    const res = generateCashierVoucher({
      db, accountSetId: ASID, accountCode: '1001', makerName: 'tester',
      startDate: '2026-09-01', endDate: '2026-09-30',
    })
    expect('error' in res).toBe(false)
    const { syncedCount, voucherNos } = res as { syncedCount: number; voucherNos: string[] }
    expect(syncedCount).toBe(1)
    expect(voucherNos.length).toBe(1)
    const v = db.prepare('SELECT id FROM vouchers WHERE account_set_id=?').get(ASID) as { id: string }
    expect(entriesOf(db, v.id)).toEqual([
      { account_code: '1001', direction: 'debit', amount: 100 },
      { account_code: '1122', direction: 'credit', amount: 100 },
    ])
    const j = db.prepare('SELECT voucher_no, voucher_year, voucher_month FROM cashier_journal WHERE id=?').get('j1') as any
    expect(j.voucher_no).toBe(voucherNos[0])
    expect(j.voucher_year).toBe(2026)
    expect(j.voucher_month).toBe(9)
  })

  it('P0-2：总账已结账期间不允许生成出纳凭证', () => {
    db.exec(`CREATE TABLE period_closing (id TEXT PRIMARY KEY, account_set_id TEXT, year INTEGER, period INTEGER, status TEXT)`)
    db.prepare("INSERT INTO period_closing VALUES ('pc', ?, 2026, 9, 'closed')").run(ASID)
    addJournal(db, { debit: 100, counter_account: '1122' })
    const res = generateCashierVoucher({
      db, accountSetId: ASID, accountCode: '1001', makerName: 'tester',
      startDate: '2026-09-01', endDate: '2026-09-30',
    })
    expect(res).toMatchObject({ error: expect.stringMatching(/2026年9期已结账/) })
    expect(db.prepare('SELECT COUNT(*) c FROM vouchers').get()).toEqual({ c: 0 })
    // 反结账后可生成
    db.exec("UPDATE period_closing SET status='open'")
    const ok = generateCashierVoucher({
      db, accountSetId: ASID, accountCode: '1001', makerName: 'tester',
      startDate: '2026-09-01', endDate: '2026-09-30',
    })
    expect('error' in ok).toBe(false)
  })

  it('支出（贷现金）：借 对方科目 / 贷 1001', () => {
    addJournal(db, { credit: 200, counter_account: '2202' })
    generateCashierVoucher({
      db, accountSetId: ASID, accountCode: '1001', makerName: 'tester',
      startDate: '2026-09-01', endDate: '2026-09-30',
    })
    const v = db.prepare('SELECT id FROM vouchers').get() as { id: string }
    expect(entriesOf(db, v.id)).toEqual([
      { account_code: '2202', direction: 'debit', amount: 200 },
      { account_code: '1001', direction: 'credit', amount: 200 },
    ])
  })

  it('缺对方科目且未指定挂账科目：拦截并返回 missingRows', () => {
    addJournal(db, { debit: 50, counter_account: null })
    const res = generateCashierVoucher({
      db, accountSetId: ASID, accountCode: '1001', makerName: 'tester',
      startDate: '2026-09-01', endDate: '2026-09-30',
    })
    expect('error' in res).toBe(true)
    expect((res as any).missingRows.length).toBe(1)
    expect(db.prepare('SELECT COUNT(*) c FROM vouchers').get()).toEqual({ c: 0 })
  })

  it('缺对方科目但指定末级挂账科目：按挂账科目生成', () => {
    addJournal(db, { debit: 50, counter_account: null })
    const res = generateCashierVoucher({
      db, accountSetId: ASID, accountCode: '1001', makerName: 'tester',
      hangupAccountCode: '1122',
      startDate: '2026-09-01', endDate: '2026-09-30',
    })
    expect('error' in res).toBe(false)
    const v = db.prepare('SELECT id FROM vouchers').get() as { id: string }
    expect(entriesOf(db, v.id)).toEqual([
      { account_code: '1001', direction: 'debit', amount: 50 },
      { account_code: '1122', direction: 'credit', amount: 50 },
    ])
  })

  it('挂账科目为父科目：拒绝（要求末级）', () => {
    addJournal(db, { debit: 50, counter_account: null })
    const res = generateCashierVoucher({
      db, accountSetId: ASID, accountCode: '1001', makerName: 'tester',
      hangupAccountCode: '11',
      startDate: '2026-09-01', endDate: '2026-09-30',
    })
    expect('error' in res).toBe(true)
    expect((res as any).error).toContain('末级')
  })

  it('对方科目在账套不存在：拒绝', () => {
    addJournal(db, { debit: 50, counter_account: '9999' })
    const res = generateCashierVoucher({
      db, accountSetId: ASID, accountCode: '1001', makerName: 'tester',
      startDate: '2026-09-01', endDate: '2026-09-30',
    })
    expect('error' in res).toBe(true)
    expect((res as any).error).toContain('9999')
  })
})

describe('银行勾对', () => {
  let db: Database.Database
  beforeEach(() => {
    db = createDb()
    db.prepare("INSERT INTO cashier_journal (id, account_set_id, account_code, biz_date, debit, reconciled) VALUES ('j1', ?, '1002', '2026-09-10', 100, 0)").run(ASID)
    db.prepare("INSERT INTO bank_statement (id, account_set_id, account_code, biz_date, debit, matched) VALUES ('s1', ?, '1002', '2026-09-10', 100, 0)").run(ASID)
  })

  it('手动勾对：日记账与对账单同时标记已对且共享 match_batch', () => {
    const r = manualReconcile({ db, accountSetId: ASID, journalId: 'j1', bankStatementId: 's1' })
    expect('ok' in r).toBe(true)
    const j = db.prepare('SELECT reconciled, match_batch FROM cashier_journal WHERE id=?').get('j1') as any
    const s = db.prepare('SELECT matched, match_batch FROM bank_statement WHERE id=?').get('s1') as any
    expect(j.reconciled).toBe(1)
    expect(s.matched).toBe(1)
    expect(j.match_batch).toBe(s.match_batch)
  })

  it('撤销勾对：通过 match_batch 联动恢复对账单', () => {
    manualReconcile({ db, accountSetId: ASID, journalId: 'j1', bankStatementId: 's1' })
    const r = cancelReconcile({ db, accountSetId: ASID, journalId: 'j1' })
    expect('ok' in r).toBe(true)
    expect((db.prepare('SELECT reconciled r FROM cashier_journal WHERE id=?').get('j1') as any).r).toBe(0)
    expect((db.prepare('SELECT matched m FROM bank_statement WHERE id=?').get('s1') as any).m).toBe(0)
  })

  it('对已对账的日记账重复勾对：拒绝', () => {
    manualReconcile({ db, accountSetId: ASID, journalId: 'j1', bankStatementId: 's1' })
    const r = manualReconcile({ db, accountSetId: ASID, journalId: 'j1', bankStatementId: 's1' })
    expect('error' in r).toBe(true)
  })
})

describe('凭证同步日记账 syncCashierFromVoucher', () => {
  let db: Database.Database
  beforeEach(() => {
    db = createDb()
    db.prepare("INSERT INTO system_params VALUES ('p1', ?, 'cashier:auto_sync', '1')").run(ASID)
  })

  it('默认未开启时不写入', () => {
    db.prepare("DELETE FROM system_params").run()
    const r = syncCashierFromVoucher({
      db, accountSetId: ASID, voucherDate: '2026-09-10', voucherYear: 2026, voucherMonth: 9,
      voucherType: null, voucherNo: '收-1',
      entries: [{ account_code: '1001', direction: 'debit', amount: 100, summary: '收款' }],
    })
    expect(r.synced).toBe(0)
    expect((db.prepare('SELECT COUNT(*) c FROM cashier_journal').get() as any).c).toBe(0)
  })

  it('开启后写入，且 voucher_type 为 NULL 时重复调用幂等（不重复插入）', () => {
    const args = {
      db, accountSetId: ASID, voucherDate: '2026-09-10', voucherYear: 2026, voucherMonth: 9,
      voucherType: null as string | null, voucherNo: '收-1',
      entries: [{ account_code: '1001', direction: 'debit' as const, amount: 100, summary: '收款' }],
    }
    const r1 = syncCashierFromVoucher(args)
    expect(r1.synced).toBe(1)
    const r2 = syncCashierFromVoucher({ ...args, entries: [{ account_code: '1001', direction: 'debit', amount: 123, summary: '收款改' }] })
    expect(r2.synced).toBe(1)
    const rows = db.prepare('SELECT debit FROM cashier_journal WHERE account_set_id=? AND account_code=?').all(ASID, '1001') as any[]
    expect(rows.length).toBe(1)
    expect(rows[0].debit).toBe(123)
  })

  it('非现金/银行科目不同步', () => {
    const r = syncCashierFromVoucher({
      db, accountSetId: ASID, voucherDate: '2026-09-10', voucherYear: 2026, voucherMonth: 9,
      voucherType: 'vt1', voucherNo: '记-1',
      entries: [{ account_code: '1122', direction: 'debit', amount: 100, summary: '赊销' }],
    })
    expect(r.synced).toBe(0)
  })
})

describe('编辑出纳凭证回写对方科目 syncCashierCounterFromVoucher', () => {
  it('按编辑前标识定位日记账并回写唯一对方科目', () => {
    const db = createDb()
    db.prepare(
      `INSERT INTO cashier_journal (id, account_set_id, account_code, biz_date, voucher_year, voucher_month, voucher_type, voucher_no, counter_account)
       VALUES ('j1', ?, '1001', '2026-09-10', 2026, 9, 'vt1', '记-1', NULL)`
    ).run(ASID)
    const r = syncCashierCounterFromVoucher({
      db, accountSetId: ASID,
      oldYear: 2026, oldMonth: 9, oldVoucherType: 'vt1', oldVoucherNo: '记-1',
      entries: [{ account_code: '1001' }, { account_code: '1122' }],
      newYear: 2026, newMonth: 9, newVoucherType: 'vt1', newVoucherNo: '记-1',
    })
    expect(r.updated).toBe(1)
    expect((db.prepare('SELECT counter_account c FROM cashier_journal WHERE id=?').get('j1') as any).c).toBe('1122')
  })

  it('对方分录不唯一时跳过（返回 updated:0）', () => {
    const db = createDb()
    db.prepare(
      `INSERT INTO cashier_journal (id, account_set_id, account_code, biz_date, voucher_year, voucher_month, voucher_type, voucher_no, counter_account)
       VALUES ('j1', ?, '1001', '2026-09-10', 2026, 9, 'vt1', '记-1', NULL)`
    ).run(ASID)
    const r = syncCashierCounterFromVoucher({
      db, accountSetId: ASID,
      oldYear: 2026, oldMonth: 9, oldVoucherType: 'vt1', oldVoucherNo: '记-1',
      entries: [{ account_code: '1122' }, { account_code: '2202' }],
      newYear: 2026, newMonth: 9, newVoucherType: 'vt1', newVoucherNo: '记-1',
    })
    expect(r.updated).toBe(0)
  })
})
