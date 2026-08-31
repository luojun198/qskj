import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import { executeTemplateSheets } from '../services/reportTemplateExecutor.js'

function createMockDb(adjustmentAmount: number) {
  return {
    prepare: (sql: string) => ({
      get: (...params: any[]) => {
        if (sql.includes("FROM sqlite_master")) {
          return { name: 'budget_surplus_adjustments' }
        }
        if (sql.includes('FROM budget_surplus_adjustments')) {
          expect(params).toEqual(['account-set-1', 2026, 1, 5, '111', '111%'])
          return { amount: adjustmentAmount }
        }
        if (sql.includes('FROM accounts')) {
          return { direction: 'debit' }
        }
        return null
      },
      all: () => [],
    }),
  }
}

describe('reportTemplateExecutor', () => {
  it('should support ACD @-function negative notation and integer row numbers', () => {
    const [sheet] = executeTemplateSheets(
      [
        {
          id: 'sheet-1',
          report_definition_id: 'report-1',
          sheet_key: 'sheet1',
          sheet_name: 'acd-negative',
          sheet_index: 0,
          cells: [
            {
              id: 'row-no-1',
              report_sheet_id: 'sheet-1',
              row_index: 0,
              col_index: 1,
              cell_type: 'number',
              text_value: '1',
              formula_text: null,
              format_text: null,
              style_key: null,
              side: null,
            },
            {
              id: 'row-no-2',
              report_sheet_id: 'sheet-1',
              row_index: 1,
              col_index: 1,
              cell_type: 'formula',
              text_value: null,
              formula_text: '=B1+1',
              format_text: null,
              style_key: null,
              side: null,
            },
            {
              id: 'amount-1',
              report_sheet_id: 'sheet-1',
              row_index: 1,
              col_index: 2,
              cell_type: 'formula',
              text_value: null,
              formula_text: '@-JQY(111,1,99)',
              format_text: '#,##0.00;-#,##0.00;#',
              style_key: null,
              side: null,
            },
          ],
        },
      ],
      {
        db: createMockDb(0) as any,
        accountSetId: 'account-set-1',
        year: 2026,
        period: 5,
      }
    )

    expect(sheet.cells[1].status).toBe('ok')
    expect(sheet.cells[1].display_value).toBe('2')
    expect(sheet.cells[2].status).toBe('ok')
    expect(sheet.cells[2].numeric_value).toBe(0)
    expect(sheet.cells[2].display_value).toBe('0.00')
  })

  it('should support Excel SUM ranges in imported report total rows', () => {
    const [sheet] = executeTemplateSheets(
      [
        {
          id: 'sheet-1',
          report_definition_id: 'report-1',
          sheet_key: 'sheet1',
          sheet_name: 'sum-ranges',
          sheet_index: 0,
          cells: [
            {
              id: 'cell-3',
              report_sheet_id: 'sheet-1',
              row_index: 2,
              col_index: 0,
              cell_type: 'formula',
              text_value: null,
              formula_text: '=SUM(A1:A2)+5',
              format_text: null,
              style_key: null,
              side: null,
            },
            {
              id: 'cell-1',
              report_sheet_id: 'sheet-1',
              row_index: 0,
              col_index: 0,
              cell_type: 'number',
              text_value: '10',
              formula_text: null,
              format_text: null,
              style_key: null,
              side: null,
            },
            {
              id: 'cell-2',
              report_sheet_id: 'sheet-1',
              row_index: 1,
              col_index: 0,
              cell_type: 'formula',
              text_value: null,
              formula_text: '=SUM(A1,20)',
              format_text: null,
              style_key: null,
              side: null,
            },
          ],
        },
      ],
      {
        db: createMockDb(0) as any,
        accountSetId: 'account-set-1',
        year: 2026,
        period: 5,
      }
    )

    expect(sheet.cells[1].status).toBe('ok')
    expect(sheet.cells[1].numeric_value).toBe(30)
    expect(sheet.cells[2].status).toBe('ok')
    expect(sheet.cells[2].numeric_value).toBe(45)
  })

  it('should support ACD short balance functions @jy @dy @nj @nd', () => {
    const db = new Database(':memory:')
    const accountSetId = 'set-1'
    db.exec(`
      CREATE TABLE accounts (
        id TEXT PRIMARY KEY, account_set_id TEXT, code TEXT, name TEXT,
        direction TEXT, parent_id TEXT, is_enabled INTEGER DEFAULT 1
      );
      CREATE TABLE init_balances (
        id TEXT PRIMARY KEY, account_set_id TEXT, account_id TEXT,
        year INTEGER, init_balance REAL, aux_item_id TEXT DEFAULT ''
      );
      CREATE TABLE account_balances (
        id TEXT PRIMARY KEY, account_set_id TEXT, account_id TEXT,
        year INTEGER, period INTEGER, current_debit REAL, current_credit REAL
      );
    `)
    db.prepare(
      'INSERT INTO accounts (id, account_set_id, code, name, direction, parent_id) VALUES (?, ?, ?, ?, ?, ?)'
    ).run('a1001', accountSetId, '1001', '现金', 'debit', null)
    db.prepare(
      'INSERT INTO accounts (id, account_set_id, code, name, direction, parent_id) VALUES (?, ?, ?, ?, ?, ?)'
    ).run('a2001', accountSetId, '2001', '借款', 'credit', null)
    db.prepare('INSERT INTO init_balances (id, account_set_id, account_id, year, init_balance) VALUES (?, ?, ?, ?, ?)').run('i1', accountSetId, 'a1001', 2026, 100)
    db.prepare('INSERT INTO init_balances (id, account_set_id, account_id, year, init_balance) VALUES (?, ?, ?, ?, ?)').run('i2', accountSetId, 'a2001', 2026, 50)
    db.prepare('INSERT INTO account_balances VALUES (?, ?, ?, ?, ?, ?, ?)').run(
      'b1', accountSetId, 'a1001', 2026, 4, 80, 20
    )
    db.prepare('INSERT INTO account_balances VALUES (?, ?, ?, ?, ?, ?, ?)').run(
      'b2', accountSetId, 'a2001', 2026, 4, 10, 80
    )

    const [sheet] = executeTemplateSheets(
      [
        {
          id: 'sheet-1',
          report_definition_id: 'report-1',
          sheet_key: 'sheet1',
          sheet_name: 'balance-functions',
          sheet_index: 0,
          cells: [
            {
              id: 'cell-1',
              report_sheet_id: 'sheet-1',
              row_index: 0,
              col_index: 0,
              cell_type: 'formula',
              text_value: null,
              formula_text: '@jy(1001,4)+@dy(2001,4)+@nj(1001)+@nd(2001)',
              format_text: null,
              style_key: null,
              side: null,
            },
            {
              id: 'cell-2',
              report_sheet_id: 'sheet-1',
              row_index: 0,
              col_index: 1,
              cell_type: 'formula',
              text_value: null,
              formula_text: '@dy(1001,4)+@jy(2001,4)+@nd(1001)+@nj(2001)',
              format_text: null,
              style_key: null,
              side: null,
            },
          ],
        },
      ],
      {
        db: db as any,
        accountSetId,
        year: 2026,
        period: 4,
      }
    )

    expect(sheet.cells[0].status).toBe('ok')
    expect(sheet.cells[0].numeric_value).toBe(430)
    expect(sheet.cells[1].status).toBe('ok')
    expect(sheet.cells[1].numeric_value).toBe(0)
  })

  it('应该支持 @ys_cy 按预算差异项目和期间汇总金额', () => {
    const [sheet] = executeTemplateSheets(
      [
        {
          id: 'sheet-1',
          report_definition_id: 'report-1',
          sheet_key: 'sheet1',
          sheet_name: '差异表',
          sheet_index: 0,
          cells: [
            {
              id: 'cell-1',
              report_sheet_id: 'sheet-1',
              row_index: 0,
              col_index: 0,
              cell_type: 'formula',
              text_value: null,
              formula_text: '@ys_cy(111,1,99)',
              format_text: null,
              style_key: null,
              side: null,
            },
          ],
        },
      ],
      {
        db: createMockDb(123.45) as any,
        accountSetId: 'account-set-1',
        year: 2026,
        period: 5,
      }
    )

    expect(sheet.cells[0].status).toBe('ok')
    expect(sheet.cells[0].numeric_value).toBe(123.45)
  })

  it('缺少预算差异明细表时 @ys_cy 应返回 0 而不是公式错误', () => {
    const db = {
      prepare: () => ({
        get: () => null,
        all: () => [],
      }),
    }

    const [sheet] = executeTemplateSheets(
      [
        {
          id: 'sheet-1',
          report_definition_id: 'report-1',
          sheet_key: 'sheet1',
          sheet_name: '差异表',
          sheet_index: 0,
          cells: [
            {
              id: 'cell-1',
              report_sheet_id: 'sheet-1',
              row_index: 0,
              col_index: 0,
              cell_type: 'formula',
              text_value: null,
              formula_text: '@ys_cy(111,1,99)',
              format_text: null,
              style_key: null,
              side: null,
            },
          ],
        },
      ],
      {
        db: db as any,
        accountSetId: 'account-set-1',
        year: 2026,
        period: 5,
      }
    )

    expect(sheet.cells[0].status).toBe('ok')
    expect(sheet.cells[0].numeric_value).toBe(0)
  })

  it('should resolve @ye(account,100) as previous-year opening balance', () => {
    const db = new Database(':memory:')
    const accountSetId = 'set-1'
    db.exec(`
      CREATE TABLE accounts (
        id TEXT PRIMARY KEY, account_set_id TEXT, code TEXT, name TEXT,
        direction TEXT, parent_id TEXT, is_enabled INTEGER DEFAULT 1
      );
      CREATE TABLE init_balances (
        id TEXT PRIMARY KEY, account_set_id TEXT, account_id TEXT,
        year INTEGER, init_balance REAL, aux_item_id TEXT DEFAULT ''
      );
      CREATE TABLE account_balances (
        id TEXT PRIMARY KEY, account_set_id TEXT, account_id TEXT,
        year INTEGER, period INTEGER, current_debit REAL, current_credit REAL
      );
    `)
    db.prepare(
      'INSERT INTO accounts (id, account_set_id, code, name, direction, parent_id) VALUES (?, ?, ?, ?, ?, ?)'
    ).run('a8101', accountSetId, '8101', '财政拨款结转', 'credit', null)
    db.prepare('INSERT INTO init_balances (id, account_set_id, account_id, year, init_balance) VALUES (?, ?, ?, ?, ?)').run('i1', accountSetId, 'a8101', 2025, 120)

    const [sheet] = executeTemplateSheets(
      [
        {
          id: 'sheet-1',
          report_definition_id: 'report-1',
          sheet_key: 'sheet1',
          sheet_name: 'budget',
          sheet_index: 0,
          cells: [
            {
              id: 'cell-1',
              report_sheet_id: 'sheet-1',
              row_index: 4,
              col_index: 2,
              cell_type: 'formula',
              text_value: null,
              formula_text: '@ye(8101,100)',
              format_text: null,
              style_key: null,
              side: null,
            },
          ],
        },
      ],
      {
        db: db as any,
        accountSetId,
        year: 2026,
        period: 5,
      }
    )

    expect(sheet.cells[0].status).toBe('ok')
    expect(sheet.cells[0].numeric_value).toBe(120)
  })

  it('should support ACD pre-transfer range debit and credit functions @jqj @jqd', () => {
    const db = new Database(':memory:')
    const accountSetId = 'set-1'
    db.exec(`
      CREATE TABLE accounts (
        id TEXT PRIMARY KEY, account_set_id TEXT, code TEXT, name TEXT,
        direction TEXT, parent_id TEXT, is_enabled INTEGER DEFAULT 1
      );
      CREATE TABLE init_balances (
        id TEXT PRIMARY KEY, account_set_id TEXT, account_id TEXT,
        year INTEGER, init_balance REAL, aux_item_id TEXT DEFAULT ''
      );
      CREATE TABLE account_balances (
        id TEXT PRIMARY KEY, account_set_id TEXT, account_id TEXT,
        year INTEGER, period INTEGER, current_debit REAL, current_credit REAL
      );
      CREATE TABLE voucher_types (
        id TEXT PRIMARY KEY, account_set_id TEXT, name TEXT
      );
      CREATE TABLE vouchers (
        id TEXT PRIMARY KEY, account_set_id TEXT, voucher_type_id TEXT,
        year INTEGER, period INTEGER, status TEXT
      );
      CREATE TABLE voucher_entries (
        id TEXT PRIMARY KEY, voucher_id TEXT, account_id TEXT,
        direction TEXT, amount REAL
      );
    `)
    db.prepare('INSERT INTO accounts (id, account_set_id, code, name, direction, parent_id) VALUES (?, ?, ?, ?, ?, ?)').run(
      'a5603003', accountSetId, '5603003', 'A', 'debit', null
    )
    db.prepare('INSERT INTO accounts (id, account_set_id, code, name, direction, parent_id) VALUES (?, ?, ?, ?, ?, ?)').run(
      'a5603002', accountSetId, '5603002', 'B', 'debit', null
    )
    db.prepare('INSERT INTO voucher_types (id, account_set_id, name) VALUES (?, ?, ?)').run('vt1', accountSetId, '记账')
    db.prepare('INSERT INTO vouchers (id, account_set_id, voucher_type_id, year, period, status) VALUES (?, ?, ?, ?, ?, ?)').run(
      'v1', accountSetId, 'vt1', 2026, 3, 'posted'
    )
    db.prepare('INSERT INTO voucher_entries (id, voucher_id, account_id, direction, amount) VALUES (?, ?, ?, ?, ?)').run(
      've1', 'v1', 'a5603003', 'debit', 100
    )
    db.prepare('INSERT INTO voucher_entries (id, voucher_id, account_id, direction, amount) VALUES (?, ?, ?, ?, ?)').run(
      've2', 'v1', 'a5603003', 'credit', 20
    )
    db.prepare('INSERT INTO voucher_entries (id, voucher_id, account_id, direction, amount) VALUES (?, ?, ?, ?, ?)').run(
      've3', 'v1', 'a5603002', 'debit', 5
    )
    db.prepare('INSERT INTO voucher_entries (id, voucher_id, account_id, direction, amount) VALUES (?, ?, ?, ?, ?)').run(
      've4', 'v1', 'a5603002', 'credit', 30
    )

    const [sheet] = executeTemplateSheets(
      [
        {
          id: 'sheet-1',
          report_definition_id: 'report-1',
          sheet_key: 'sheet1',
          sheet_name: 'quarter-income',
          sheet_index: 0,
          cells: [
            {
              id: 'cell-1',
              report_sheet_id: 'sheet-1',
              row_index: 0,
              col_index: 0,
              cell_type: 'formula',
              text_value: null,
              formula_text: '@JQY(5603003,1,99)-JQD(5603002,1,99)+JQJ(5603002,1,99)',
              format_text: null,
              style_key: null,
              side: null,
            },
          ],
        },
      ],
      {
        db: db as any,
        accountSetId,
        year: 2026,
        period: 3,
      }
    )

    expect(sheet.cells[0].status).toBe('ok')
    expect(sheet.cells[0].numeric_value).toBe(55)
  })
})
