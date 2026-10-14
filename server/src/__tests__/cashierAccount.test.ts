/**
 * 客户反馈（润衡云第三份测试）：出纳独立账户——自定义账户名称，再关联总账科目生成凭证。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import {
  syncCashierAccountsFromGl, cashierGlCode, cashierCodeForGl, cashierLinkedGlCodes,
  listCashierAccountRows, createCashierAccount, updateCashierAccount, deleteCashierAccount,
} from '../services/cashierAccount.js'

const AID = 'CA-T'
let db: Database.Database

function setup() {
  db = new Database(':memory:')
  db.exec(`
    CREATE TABLE accounts (id TEXT, account_set_id TEXT, code TEXT, name TEXT, direction TEXT, parent_id TEXT,
      is_cash INTEGER DEFAULT 0, is_bank INTEGER DEFAULT 0, is_enabled INTEGER DEFAULT 1, is_foreign INTEGER DEFAULT 0, currency_code TEXT);
    CREATE TABLE cashier_journal (id TEXT, account_set_id TEXT, account_code TEXT);
    CREATE TABLE cashier_init_balance (id TEXT, account_set_id TEXT, account_code TEXT);
  `)
  const acc = db.prepare('INSERT INTO accounts (id,account_set_id,code,name,direction,parent_id,is_cash,is_bank,is_foreign,currency_code) VALUES (?,?,?,?,?,?,?,?,?,?)')
  acc.run('A1001', AID, '1001', '库存现金', 'debit', null, 1, 0, 0, null)
  acc.run('A1002', AID, '1002', '银行存款', 'debit', null, 0, 1, 0, null)
  acc.run('A100201', AID, '100201', '招商银行深圳龙华支行', 'debit', 'A1002', 0, 1, 0, null)
  acc.run('A100202', AID, '100202', '美元户', 'debit', 'A1002', 0, 1, 1, 'USD')
  acc.run('A1012', AID, '1012', '其他货币资金', 'debit', null, 0, 1, 0, null)
  acc.run('A101201', AID, '101201', '外埠存款', 'debit', 'A1012', 0, 1, 0, null)
  acc.run('A6001', AID, '6001', '主营业务收入', 'credit', null, 0, 0, 0, null)
}

describe('出纳独立账户', () => {
  beforeEach(setup)

  it('总账现金 / 银行末级科目自动生成同编码、已关联的出纳账户（类型、外币带出）；上级科目不生成', () => {
    expect(syncCashierAccountsFromGl(db, AID)).toBe(4)
    const rows = listCashierAccountRows(db, AID)
    expect(rows.map(r => [r.code, r.kind, r.currency_code, r.gl_account_code])).toEqual([
      ['1001', 'cash', null, '1001'], ['100201', 'bank', null, '100201'], ['100202', 'bank', 'USD', '100202'], ['101201', 'other', null, '101201'],
    ])
    expect(syncCashierAccountsFromGl(db, AID)).toBe(0)   // 幂等
  })

  it('新建未关联科目的独立账户：可用于出纳，但取不到总账科目（生成凭证会被拦截）', () => {
    syncCashierAccountsFromGl(db, AID)
    createCashierAccount(db, AID, { code: 'ZD001', name: '工商银行深圳龙华支行', kind: 'bank' })
    expect(cashierGlCode(db, AID, 'ZD001')).toBeNull()
    expect(listCashierAccountRows(db, AID).find(r => r.code === 'ZD001')).toMatchObject({ name: '工商银行深圳龙华支行', is_bank: 1, gl_account_code: null })
    // 关联科目后可映射；同一科目下同编码账户优先反查
    const id = listCashierAccountRows(db, AID).find(r => r.code === 'ZD001')!.id
    updateCashierAccount(db, AID, id, { code: 'ZD001', name: '工商银行深圳龙华支行', kind: 'bank', gl_account_code: '100201' })
    expect(cashierGlCode(db, AID, 'ZD001')).toBe('100201')
    expect(cashierCodeForGl(db, AID, '100201')).toBe('100201')
    expect(cashierLinkedGlCodes(db, AID).has('100201')).toBe(true)
  })

  it('关联科目只能是末级；编码重复拒绝；有流水不能改编码 / 删除', () => {
    syncCashierAccountsFromGl(db, AID)
    expect(() => createCashierAccount(db, AID, { code: 'X1', name: 'x', kind: 'bank', gl_account_code: '1002' })).toThrow('不是末级')
    expect(() => createCashierAccount(db, AID, { code: '1001', name: 'x', kind: 'cash' })).toThrow('已存在')
    const { id } = createCashierAccount(db, AID, { code: 'ZD002', name: '备用金', kind: 'cash' })
    db.prepare("INSERT INTO cashier_journal VALUES ('J1',?,'ZD002')").run(AID)
    expect(() => updateCashierAccount(db, AID, id, { code: 'ZD003', name: '备用金', kind: 'cash' })).toThrow('不能修改编码')
    expect(() => deleteCashierAccount(db, AID, id)).toThrow('不能删除')
    db.prepare("DELETE FROM cashier_journal").run()
    deleteCashierAccount(db, AID, id)
    expect(listCashierAccountRows(db, AID, { includeDisabled: true }).some(r => r.code === 'ZD002')).toBe(false)
  })

  it('由总账科目生成的账户不能删（会被重新生成），提示停用', () => {
    syncCashierAccountsFromGl(db, AID)
    const row = listCashierAccountRows(db, AID).find(r => r.code === '1001')!
    expect(() => deleteCashierAccount(db, AID, row.id)).toThrow('请停用')
  })
})
