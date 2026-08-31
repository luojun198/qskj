import { describe, expect, it } from 'vitest'
import { applyAuxItemIdToEntryFields, entryHasAuxSelection } from '../utils/auxItemId.js'
import { loadVoucherEntries } from '../services/voucherPosting.js'
import { checkPostingIntegrity } from '../services/postingIntegrityCheck.js'
import Database from 'better-sqlite3'

describe('applyAuxItemIdToEntryFields', () => {
  it('将 proj/supp 别名还原为 project/customer 字段', () => {
    const fields = applyAuxItemIdToEntryFields(
      'proj:proj-1|supp:cust-1|project:proj-1|customer:cust-1'
    )
    expect(fields.project_id).toBe('proj-1')
    expect(fields.supplier_id).toBe('cust-1')
    expect(fields._project_id).toBe('proj-1')
    expect(fields._customer_id).toBe('cust-1')
    expect(entryHasAuxSelection(fields as any, 'project', 'cat-project')).toBe(true)
    expect(entryHasAuxSelection(fields as any, 'customer', 'cat-customer')).toBe(true)
  })
})

describe('posting integrity with DB entries', () => {
  it('数据库分录含辅助核算时完整性检查通过，字段不全的内存分录会失败', () => {
    const db = new Database(':memory:')
    db.exec(`
      CREATE TABLE accounts (
        id TEXT PRIMARY KEY, account_set_id TEXT, code TEXT, name TEXT,
        direction TEXT, parent_id TEXT, is_aux INTEGER, aux_types TEXT,
        no_negative INTEGER, is_cash INTEGER, is_bank INTEGER, is_enabled INTEGER
      );
      CREATE TABLE aux_categories (
        id TEXT PRIMARY KEY, account_set_id TEXT, code TEXT, name TEXT
      );
      CREATE TABLE voucher_entries (
        id TEXT PRIMARY KEY, account_set_id TEXT, voucher_id TEXT, seq INTEGER,
        account_id TEXT, account_code TEXT, account_name TEXT,
        direction TEXT, amount REAL, amount_cents INTEGER,
        project_id TEXT, supplier_id TEXT, aux_data TEXT
      );
      INSERT INTO accounts VALUES (
        'sales', 'set1', '6001001', '销货收入', 'credit', NULL, 1,
        '{"cat-project":null,"cat-customer":null}', 0, 0, 0, 1
      );
      INSERT INTO aux_categories VALUES ('cat-project', 'set1', 'project', '项目');
      INSERT INTO aux_categories VALUES ('cat-customer', 'set1', 'customer', '往来单位');
      INSERT INTO voucher_entries VALUES (
        'e1', 'set1', 'v1', 1, 'sales', '6001001', '销货收入', 'credit', 100, 10000,
        'proj-1', 'cust-1',
        '{"project":{"id":"proj-1","name":"项目1"},"customer":{"id":"cust-1","name":"客户1"}}'
      );
    `)

    const stripped = [{
      account_id: 'sales',
      account_code: '6001001',
      account_name: '销货收入',
      direction: 'credit' as const,
      amount: 100,
    }]

    const loaded = loadVoucherEntries(db, 'v1')
    expect(
      checkPostingIntegrity(db, 'set1', 2026, 5, loaded, { entriesAlreadyPersisted: true }).isValid
    ).toBe(true)
    expect(
      checkPostingIntegrity(db, 'set1', 2026, 5, stripped, { entriesAlreadyPersisted: true }).isValid
    ).toBe(false)
    db.close()
  })
})
