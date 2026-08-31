import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { checkPostingIntegrity } from '../services/postingIntegrityCheck.js'

function createPostingCheckDb() {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE accounts (
      id TEXT PRIMARY KEY, account_set_id TEXT, code TEXT, name TEXT,
      direction TEXT, parent_id TEXT, is_aux INTEGER, aux_types TEXT,
      no_negative INTEGER, is_cash INTEGER, is_bank INTEGER, is_enabled INTEGER
    );
    CREATE TABLE aux_categories (
      id TEXT PRIMARY KEY, account_set_id TEXT, code TEXT, name TEXT, sort_order INTEGER
    );
    CREATE TABLE aux_items (
      id TEXT PRIMARY KEY, account_set_id TEXT, type TEXT, code TEXT, name TEXT, status TEXT
    );
    CREATE TABLE init_balances (
      id TEXT PRIMARY KEY, account_set_id TEXT, account_id TEXT, direction TEXT,
      year INTEGER, period INTEGER,
      init_balance REAL, init_debit REAL, init_credit REAL,
      aux_item_id TEXT NOT NULL DEFAULT '',
      opening_debit REAL, opening_credit REAL, pre_book_debit REAL, pre_book_credit REAL
    );
    CREATE TABLE vouchers (
      id TEXT PRIMARY KEY, account_set_id TEXT, year INTEGER, period INTEGER, status TEXT
    );
    CREATE TABLE voucher_entries (
      id TEXT PRIMARY KEY, voucher_id TEXT, account_set_id TEXT, account_id TEXT,
      direction TEXT, amount REAL, dept_id TEXT, person_id TEXT, aux_data TEXT
    );
    INSERT INTO accounts VALUES (
      'cash', 'set1', '1001', '库存现金', 'debit', NULL, 1,
      '{"cat-dept":null,"cat-person":null}', 1, 1, 0, 1
    );
    INSERT INTO aux_categories VALUES ('cat-dept', 'set1', 'dept', '部门', 0);
    INSERT INTO aux_categories VALUES ('cat-person', 'set1', 'person', '人员', 1);
    INSERT INTO aux_items VALUES ('dept-fin', 'set1', 'cat-dept', 'D01', '财务部', 'active');
    INSERT INTO aux_items VALUES ('person-zs', 'set1', 'cat-person', 'P01', '张三', 'active');
    INSERT INTO init_balances VALUES (
      'ib-summary', 'set1', 'cash', 'debit', 2026, 1,
      100, 100, 0, '', 100, 0, 0, 0
    );
    INSERT INTO init_balances VALUES (
      'ib-dept', 'set1', 'cash', 'debit', 2026, 1,
      100, 100, 0, 'dept:dept-fin', 100, 0, 0, 0
    );
    INSERT INTO init_balances VALUES (
      'ib-person', 'set1', 'cash', 'debit', 2026, 1,
      100, 100, 0, 'person:person-zs', 100, 0, 0, 0
    );
    INSERT INTO vouchers VALUES ('v1', 'set1', 2026, 5, 'audited');
    INSERT INTO voucher_entries VALUES (
      've1', 'v1', 'set1', 'cash', 'credit', 5,
      'dept-fin', 'person-zs',
      '{"dept":{"id":"dept-fin","name":"财务部"},"person":{"id":"person-zs","name":"张三"}}'
    );
  `)
  return db
}

describe('postingIntegrityCheck', () => {
  it('记账前拦截不允许负数的贷方余额科目借方发生', () => {
    const db = {
      prepare(sql: string) {
        if (sql.includes('FROM accounts')) {
          return {
            get: () => ({
              id: 'payable',
              name: '应付账款',
              direction: 'credit',
              no_negative: 1,
              is_aux: 0,
              is_cash: 0,
              is_bank: 0,
            }),
          }
        }

        if (sql.includes('FROM init_balances')) {
          return { get: () => ({ init_balance: 100 }) }
        }

        if (sql.includes('FROM voucher_entries')) {
          return { get: () => ({ total_debit: 0, total_credit: 0 }) }
        }

        throw new Error(`unexpected sql: ${sql}`)
      },
    }

    const result = checkPostingIntegrity(
      db as any,
      'set-1',
      2026,
      5,
      [
        {
          account_id: 'payable',
          direction: 'debit',
          amount: 150,
        },
      ],
      { entriesAlreadyPersisted: false }
    )

    expect(result.isValid).toBe(false)
    expect(result.errors.join('')).toContain('应付账款')
    expect(result.errors.join('')).toContain('-50.00')
  })

  it('同一科目多行分录按净影响判断记账后余额', () => {
    const db = {
      prepare(sql: string) {
        if (sql.includes('FROM accounts')) {
          return {
            get: () => ({
              id: 'cash',
              name: '库存现金',
              direction: 'debit',
              no_negative: 1,
              is_aux: 0,
              is_cash: 1,
              is_bank: 0,
            }),
          }
        }

        if (sql.includes('FROM init_balances')) {
          return { get: () => ({ init_balance: 100 }) }
        }

        if (sql.includes('FROM voucher_entries')) {
          return { get: () => ({ total_debit: 0, total_credit: 0 }) }
        }

        throw new Error(`unexpected sql: ${sql}`)
      },
    }

    const result = checkPostingIntegrity(
      db as any,
      'set-1',
      2026,
      5,
      [
        {
          account_id: 'cash',
          direction: 'credit',
          amount: 150,
        },
        {
          account_id: 'cash',
          direction: 'debit',
          amount: 100,
        },
      ],
      { entriesAlreadyPersisted: false }
    )

    expect(result.isValid).toBe(true)
    expect(result.errors).toHaveLength(0)
    expect(result.warnings).toHaveLength(0)
  })

  it('aux_data 以辅助类别 ID 为键时仍识别已选项目', () => {
    const projectCatId = 'cat-project-uuid'
    const customerCatId = 'cat-customer-uuid'
    const projectItemId = 'proj-item-1'
    const customerItemId = 'cust-item-1'

    const db = {
      prepare(sql: string) {
        if (sql.includes('FROM accounts')) {
          return {
            get: () => ({
              id: 'sales-income',
              name: '销货收入',
              direction: 'credit',
              no_negative: 0,
              is_aux: 1,
              aux_types: JSON.stringify({
                [projectCatId]: null,
                [customerCatId]: null,
              }),
              is_cash: 0,
              is_bank: 0,
            }),
          }
        }

        if (sql.includes('FROM aux_categories')) {
          return {
            get: (_setId: string, idOrCode: string) => {
              if (idOrCode === projectCatId || idOrCode === 'project') {
                return { id: projectCatId, code: 'project', name: '项目' }
              }
              if (idOrCode === customerCatId || idOrCode === 'customer') {
                return { id: customerCatId, code: 'customer', name: '往来单位' }
              }
              return undefined
            },
          }
        }

        throw new Error(`unexpected sql: ${sql}`)
      },
    }

    const result = checkPostingIntegrity(
      db as any,
      'set-1',
      2026,
      5,
      [
        {
          account_id: 'sales-income',
          direction: 'credit',
          amount: 1000,
          aux_data: JSON.stringify({
            [projectCatId]: { id: projectItemId, name: '项目A' },
            [customerCatId]: { id: customerItemId, name: '单位B' },
          }),
        },
      ],
      { entriesAlreadyPersisted: false }
    )

    expect(result.isValid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('往来单位仅写入 aux_data.customer 时通过完整性检查', () => {
    const customerCatId = 'cat-customer-uuid'
    const customerItemId = 'cust-item-1'

    const db = {
      prepare(sql: string) {
        if (sql.includes('FROM accounts')) {
          return {
            get: () => ({
              id: 'sales-income',
              name: '销货收入',
              direction: 'credit',
              no_negative: 0,
              is_aux: 1,
              aux_types: JSON.stringify({ [customerCatId]: null }),
              is_cash: 0,
              is_bank: 0,
            }),
          }
        }

        if (sql.includes('FROM aux_categories')) {
          return {
            get: () => ({
              id: customerCatId,
              code: 'customer',
              name: '往来单位',
            }),
          }
        }

        throw new Error(`unexpected sql: ${sql}`)
      },
    }

    const result = checkPostingIntegrity(
      db as any,
      'set-1',
      2026,
      5,
      [
        {
          account_id: 'sales-income',
          direction: 'credit',
          amount: 500,
          aux_data: JSON.stringify({
            customer: { id: customerItemId, name: '单位B' },
          }),
        },
      ],
      { entriesAlreadyPersisted: false }
    )

    expect(result.isValid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('按辅助类别ID解析类别编码并检查aux_data中的辅助项目', () => {
    const auxCategoryId = '734853e9-9e55-4d4d-b15b-76d56d8ea09c'
    const db = {
      prepare(sql: string) {
        if (sql.includes('FROM accounts')) {
          return {
            get: () => ({
              id: 'case-money',
              name: '执行案款',
              direction: 'debit',
              no_negative: 0,
              is_aux: 1,
              aux_types: JSON.stringify({ [auxCategoryId]: null }),
              is_cash: 0,
              is_bank: 0,
            }),
          }
        }

        if (sql.includes('FROM aux_categories')) {
          return {
            get: () => ({
              id: auxCategoryId,
              code: 'project',
              name: '项目',
            }),
          }
        }

        throw new Error(`unexpected sql: ${sql}`)
      },
    }

    const result = checkPostingIntegrity(
      db as any,
      'set-1',
      2026,
      5,
      [
        {
          account_id: 'case-money',
          direction: 'debit',
          amount: 100,
          aux_data: JSON.stringify({
            project: { id: 'project-1', name: '案件一' },
          }),
        },
      ],
      { entriesAlreadyPersisted: false }
    )

    expect(result.isValid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('辅助核算缺失时提示辅助类别名称而不是类别ID', () => {
    const auxCategoryId = '734853e9-9e55-4d4d-b15b-76d56d8ea09c'
    const db = {
      prepare(sql: string) {
        if (sql.includes('FROM accounts')) {
          return {
            get: () => ({
              id: 'case-money',
              name: '执行案款',
              direction: 'debit',
              no_negative: 0,
              is_aux: 1,
              aux_types: JSON.stringify({ [auxCategoryId]: null }),
              is_cash: 0,
              is_bank: 0,
            }),
          }
        }

        if (sql.includes('FROM aux_categories')) {
          return {
            get: () => ({
              id: auxCategoryId,
              code: 'project',
              name: '项目',
            }),
          }
        }

        throw new Error(`unexpected sql: ${sql}`)
      },
    }

    const result = checkPostingIntegrity(
      db as any,
      'set-1',
      2026,
      5,
      [
        {
          account_id: 'case-money',
          direction: 'debit',
          amount: 100,
        },
      ],
      { entriesAlreadyPersisted: false }
    )

    expect(result.isValid).toBe(false)
    expect(result.errors.join('')).toContain('缺少项目辅助核算项目')
    expect(result.errors.join('')).not.toContain(auxCategoryId)
  })

  it('辅助项目负数校验：错误消息显示中文类目/项目名而非原始 UUID 编码', () => {
    const deptId = 'a1317d61-4255-42c1-be9e-609fd7f6f0d5'
    const personId = '932ecf37-d181-4010-b806-48fe66571b27'

    const db = {
      prepare(sql: string) {
        if (sql.includes('FROM accounts')) {
          return {
            get: () => ({
              id: 'cash',
              name: '库存现金',
              direction: 'debit',
              no_negative: 1,
              is_aux: 1,
              aux_types: JSON.stringify({ 'cat-dept': null, 'cat-person': null }),
              is_cash: 1,
              is_bank: 0,
            }),
          }
        }
        if (sql.includes('FROM init_balances')) {
          return { get: () => ({ init_balance: 0 }) }
        }
        if (sql.includes('FROM voucher_entries')) {
          return { get: () => ({ total_debit: 0, total_credit: 0 }) }
        }
        if (sql.includes('FROM aux_categories')) {
          return {
            get: (_setId: string, idOrCode: string) => {
              if (idOrCode === 'dept' || idOrCode === 'cat-dept') {
                return { id: 'cat-dept', code: 'dept', name: '部门' }
              }
              if (idOrCode === 'person' || idOrCode === 'cat-person') {
                return { id: 'cat-person', code: 'person', name: '人员' }
              }
              return undefined
            },
          }
        }
        if (sql.includes('FROM aux_items')) {
          return {
            get: (itemId: string) => {
              if (itemId === deptId) return { name: '销售部' }
              if (itemId === personId) return { name: '张三' }
              return undefined
            },
          }
        }
        throw new Error(`unexpected sql: ${sql}`)
      },
    }

    // 模拟真实分录：buildVoucherEntryPayloads 会同时填 legacy 列和 aux_data JSON
    const result = checkPostingIntegrity(
      db as any,
      'set-1',
      2026,
      5,
      [
        {
          account_id: 'cash',
          direction: 'credit',
          amount: 5,
          dept_id: deptId,
          dept_name: '销售部',
          person_id: personId,
          person_name: '张三',
          aux_data: JSON.stringify({
            dept: { id: deptId, name: '销售部' },
            person: { id: personId, name: '张三' },
          }),
        },
      ],
      { entriesAlreadyPersisted: false }
    )

    expect(result.isValid).toBe(false)
    const joined = result.errors.join('\n')
    // 不再泄露原始编码
    expect(joined).not.toContain('dept:')
    expect(joined).not.toContain('pers:')
    expect(joined).not.toContain(deptId)
    expect(joined).not.toContain(personId)
    // 应显示中文类目名 + 项目名
    expect(joined).toContain('部门：销售部')
    expect(joined).toContain('人员：张三')
  })

  it('含期初余额且分录已入库时不误报负数', () => {
    const db = createPostingCheckDb()
    const result = checkPostingIntegrity(
      db,
      'set1',
      2026,
      5,
      [
        {
          account_id: 'cash',
          direction: 'credit',
          amount: 5,
          dept_id: 'dept-fin',
          person_id: 'person-zs',
          aux_data: JSON.stringify({
            dept: { id: 'dept-fin', name: '财务部' },
            person: { id: 'person-zs', name: '张三' },
          }),
        },
      ],
      { entriesAlreadyPersisted: true }
    )

    expect(result.isValid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('无足够期初余额时分录已入库仍拦截负数', () => {
    const db = createPostingCheckDb()
    db.prepare(`UPDATE init_balances SET init_balance=3, init_debit=3 WHERE account_id='cash'`).run()

    const result = checkPostingIntegrity(
      db,
      'set1',
      2026,
      5,
      [
        {
          account_id: 'cash',
          direction: 'credit',
          amount: 5,
          dept_id: 'dept-fin',
          person_id: 'person-zs',
          aux_data: JSON.stringify({
            dept: { id: 'dept-fin', name: '财务部' },
            person: { id: 'person-zs', name: '张三' },
          }),
        },
      ],
      { entriesAlreadyPersisted: true }
    )

    expect(result.isValid).toBe(false)
    expect(result.errors.join('')).toContain('库存现金')
    expect(result.errors.join('')).toContain('-2.00')
  })
})
