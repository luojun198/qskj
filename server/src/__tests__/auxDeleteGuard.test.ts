import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import {
  getAuxCategoryDeleteBlockReason,
  getAuxItemDeleteBlockReason,
  getAuxItemRelatedVouchers,
  isAuxItemUsedInInitBalance,
  isAuxItemUsedInVoucherEntries,
} from '../services/auxDeleteGuard.js'

function createTestDb() {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE aux_categories (
      id TEXT PRIMARY KEY, account_set_id TEXT, code TEXT, name TEXT, sort_order INTEGER DEFAULT 0
    );
    CREATE TABLE aux_items (
      id TEXT PRIMARY KEY, account_set_id TEXT, type TEXT, code TEXT, name TEXT,
      status TEXT DEFAULT 'active', remark TEXT, field_values TEXT DEFAULT '{}'
    );
    CREATE TABLE init_balances (
      id TEXT PRIMARY KEY, account_set_id TEXT, account_id TEXT, direction TEXT,
      year INTEGER, period INTEGER,
      init_balance REAL, init_debit REAL, init_credit REAL,
      aux_item_id TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE voucher_entries (
      id TEXT PRIMARY KEY, account_set_id TEXT, account_id TEXT, voucher_id TEXT,
      seq INTEGER DEFAULT 1, summary TEXT,
      dept_id TEXT, project_id TEXT, supplier_id TEXT, person_id TEXT, func_class_id TEXT,
      aux_data TEXT
    );
    CREATE TABLE vouchers (
      id TEXT PRIMARY KEY, account_set_id TEXT, voucher_no TEXT, voucher_date TEXT,
      status TEXT DEFAULT 'draft', voucher_type_id TEXT
    );
    CREATE TABLE voucher_types (
      id TEXT PRIMARY KEY, name TEXT
    );

    INSERT INTO voucher_types VALUES ('vt1', '记账凭证');

    INSERT INTO aux_categories VALUES ('cat-dept', 'set1', 'dept', '部门', 0);
    INSERT INTO aux_categories VALUES ('cat-custom', 'set1', 'my_type', '自定义', 1);
    INSERT INTO aux_items VALUES ('item-dept', 'set1', 'cat-dept', 'D01', '行政部', 'active', '', '{}');
    INSERT INTO aux_items VALUES ('item-custom', 'set1', 'cat-custom', 'C01', '自定义项', 'active', '', '{}');
    INSERT INTO aux_items VALUES ('item-free', 'set1', 'cat-dept', 'D02', '空闲部门', 'active', '', '{}');
  `)
  return db
}

describe('auxDeleteGuard', () => {
  let db: Database.Database

  beforeEach(() => {
    db = createTestDb()
  })

  it('无引用时辅助项目可删', () => {
    const result = getAuxItemDeleteBlockReason(db, 'set1', 'item-free')
    expect(result.blocked).toBe(false)
  })

  it('有辅助期初时不可删', () => {
    db.prepare(
      `INSERT INTO init_balances VALUES ('ib1', 'set1', 'acc1', 'debit', 2026, 1, 100, 100, 0, 'dept:item-dept')`
    ).run()

    expect(isAuxItemUsedInInitBalance(db, 'set1', 'item-dept', 'dept')).toBe(true)

    const result = getAuxItemDeleteBlockReason(db, 'set1', 'item-dept')
    expect(result.blocked).toBe(true)
    expect(result.reason).toBe('init_balance')
    expect(result.message).toContain('辅助期初')
  })

  it('固定列凭证引用时不可删', () => {
    db.prepare(
      `INSERT INTO vouchers VALUES ('v1', 'set1', '记-001', '2026-01-15', 'draft', 'vt1')`
    ).run()
    db.prepare(
      `INSERT INTO voucher_entries VALUES ('ve1', 'set1', 'acc1', 'v1', 1, '测试摘要', 'item-dept', NULL, NULL, NULL, NULL, NULL)`
    ).run()

    expect(isAuxItemUsedInVoucherEntries(db, 'set1', 'item-dept', 'dept')).toBe(true)

    const result = getAuxItemDeleteBlockReason(db, 'set1', 'item-dept')
    expect(result.blocked).toBe(true)
    expect(result.reason).toBe('voucher')
    expect(result.message).toContain('凭证')
    expect(result.voucherTotal).toBe(1)
    expect(result.vouchers).toHaveLength(1)
    expect(result.vouchers![0].voucher_no).toBe('记-001')
    expect(result.vouchers![0].summary).toBe('测试摘要')
  })

  it('getAuxItemRelatedVouchers 去重并按日期倒序', () => {
    db.prepare(`INSERT INTO vouchers VALUES ('v1', 'set1', '记-001', '2026-01-10', 'audited', 'vt1')`).run()
    db.prepare(`INSERT INTO vouchers VALUES ('v2', 'set1', '记-002', '2026-01-20', 'posted', 'vt1')`).run()
    db.prepare(
      `INSERT INTO voucher_entries VALUES ('ve1', 'set1', 'acc1', 'v1', 1, '行1', 'item-dept', NULL, NULL, NULL, NULL, NULL)`
    ).run()
    db.prepare(
      `INSERT INTO voucher_entries VALUES ('ve2', 'set1', 'acc1', 'v1', 2, '行2', 'item-dept', NULL, NULL, NULL, NULL, NULL)`
    ).run()
    db.prepare(
      `INSERT INTO voucher_entries VALUES ('ve3', 'set1', 'acc1', 'v2', 1, '行3', 'item-dept', NULL, NULL, NULL, NULL, NULL)`
    ).run()

    const list = getAuxItemRelatedVouchers(db, 'set1', 'item-dept', 'dept', 'cat-dept', 'D01')
    expect(list).toHaveLength(2)
    expect(list[0].voucher_no).toBe('记-002')
    expect(list[1].voucher_no).toBe('记-001')
  })

  it('aux_data 自定义类目凭证引用时不可删', () => {
    db.prepare(`INSERT INTO vouchers VALUES ('v2', 'set1', '记-002', '2026-02-01', 'draft', 'vt1')`).run()
    db.prepare(
      `INSERT INTO voucher_entries VALUES ('ve2', 'set1', 'acc1', 'v2', 1, NULL, NULL, NULL, NULL, NULL, NULL, '{"my_type":{"id":"item-custom","name":"自定义项"}}')`
    ).run()

    expect(isAuxItemUsedInVoucherEntries(db, 'set1', 'item-custom', 'my_type')).toBe(true)

    const result = getAuxItemDeleteBlockReason(db, 'set1', 'item-custom')
    expect(result.blocked).toBe(true)
    expect(result.reason).toBe('voucher')
  })

  it('辅助类目：子项有期初或凭证时不可删', () => {
    db.prepare(
      `INSERT INTO init_balances VALUES ('ib1', 'set1', 'acc1', 'debit', 2026, 1, 100, 100, 0, 'dept:item-dept')`
    ).run()

    const result = getAuxCategoryDeleteBlockReason(db, 'set1', 'cat-dept')
    expect(result.blocked).toBe(true)
    expect(result.message).toContain('辅助期初')
  })

  it('辅助类目：仅有未引用子项时需先删子项', () => {
    const result = getAuxCategoryDeleteBlockReason(db, 'set1', 'cat-dept')
    expect(result.blocked).toBe(true)
    expect(result.message).toContain('请先删除这些项目')
  })

  it('辅助类目：无子项时可删', () => {
    db.prepare(`DELETE FROM aux_items WHERE type='cat-custom'`).run()
    const result = getAuxCategoryDeleteBlockReason(db, 'set1', 'cat-custom')
    expect(result.blocked).toBe(false)
  })
})
