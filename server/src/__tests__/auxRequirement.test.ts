/**
 * 业务凭证必填辅助核算判定（与过账同口径）
 *
 * 覆盖：科目必填类别解析（id / code 两种键）、分录缺项检测、出纳流水对方辅助缺项（含 code 键不再被丢弃）、
 * 固定资产卡片缺使用部门 / 部门对不上的原因文字。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { createAccountAuxRequirementLookup, findEntriesMissingAux } from '../services/auxRequirement.js'
import { cashierRowMissingAux, parseCounterAuxSelections } from '../services/cashierQuery.js'
import { assetAuxIssues, loadAssetAuxContext } from '../services/assetVoucherBuilder.js'

const AID = 'AS-REQ'
let db: Database.Database

beforeEach(() => {
  db = new Database(':memory:')
  db.exec(`
    CREATE TABLE accounts (id TEXT, account_set_id TEXT, code TEXT, name TEXT, is_aux INTEGER DEFAULT 0, aux_types TEXT);
    CREATE TABLE aux_categories (id TEXT PRIMARY KEY, account_set_id TEXT, code TEXT, name TEXT, sort_order INTEGER DEFAULT 0);
    CREATE TABLE aux_category_fields (id TEXT, category_id TEXT, field_key TEXT, field_name TEXT, show_in_voucher INTEGER DEFAULT 0,
      required_in_archive INTEGER DEFAULT 0, sort_order INTEGER DEFAULT 0, is_enabled INTEGER DEFAULT 1);
    CREATE TABLE aux_items (id TEXT PRIMARY KEY, account_set_id TEXT, type TEXT, code TEXT, name TEXT, status TEXT DEFAULT 'active', remark TEXT, field_values TEXT DEFAULT '{}');
    CREATE TABLE system_params (id TEXT, account_set_id TEXT, param_key TEXT, param_value TEXT);
    CREATE TABLE fixed_asset_dept (account_set_id TEXT, code TEXT, name TEXT);
  `)
  const cat = db.prepare('INSERT INTO aux_categories (id,account_set_id,code,name) VALUES (?,?,?,?)')
  cat.run('c-dept', AID, 'dept', '部门')
  cat.run('c-proj', AID, 'project', '项目')
  const acc = db.prepare('INSERT INTO accounts (id,account_set_id,code,name,is_aux,aux_types) VALUES (?,?,?,?,?,?)')
  acc.run('a1', AID, '660201', '管理费用-折旧', 1, JSON.stringify({ 'c-dept': null }))
  acc.run('a2', AID, '1602', '累计折旧', 0, null)
  acc.run('a3', AID, '6601', '销售费用', 1, 'dept,project')   // 以类别 code 记录
  acc.run('a4', AID, '6603', '财务费用', 0, JSON.stringify({ 'c-dept': null })) // is_aux=0 不要求
  db.prepare('INSERT INTO aux_items (id,account_set_id,type,code,name) VALUES (?,?,?,?,?)').run('i-d01', AID, 'c-dept', 'D01', '行政部')
})

describe('科目必填辅助类别', () => {
  it('按 is_aux + aux_types 解析，id / code 两种键都认；is_aux=0 不要求', () => {
    const lookup = createAccountAuxRequirementLookup(db, AID)
    expect(lookup('660201')?.categories.map(c => c.name)).toEqual(['部门'])
    expect(lookup('6601')?.categories.map(c => c.name)).toEqual(['部门', '项目'])
    expect(lookup('6603')).toBeNull()
    expect(lookup('1602')).toBeNull()
    expect(lookup('9999')).toBeNull()
  })

  it('分录缺项检测：_code_id / 固定列 / aux_data 任一有值即视为已填', () => {
    const lookup = createAccountAuxRequirementLookup(db, AID)
    const missing = findEntriesMissingAux(lookup, [
      { account_code: '660201', _dept_id: 'i-d01' },
      { account_code: '6601', dept_id: 'i-d01' },
      { account_code: '1602' },
    ])
    expect(missing).toEqual([{ accountCode: '6601', accountName: '销售费用', categoryId: 'c-proj', categoryName: '项目' }])
    expect(findEntriesMissingAux(lookup, [{ account_code: '660201', aux_data: JSON.stringify({ dept: { id: 'i-d01' } }) }])).toEqual([])
  })
})

describe('出纳流水对方辅助', () => {
  it('counter_aux_item_id 以类别 id 或 code 为键都能识别', () => {
    const lookup = createAccountAuxRequirementLookup(db, AID)
    expect([...parseCounterAuxSelections(JSON.stringify({ 'c-dept': 'i-d01' }), lookup).keys()]).toEqual(['c-dept'])
    expect([...parseCounterAuxSelections(JSON.stringify({ dept: 'i-d01' }), lookup).keys()]).toEqual(['c-dept'])
    expect(parseCounterAuxSelections('not json', lookup).size).toBe(0)
  })

  it('对方科目要求部门而未填：返回缺少的类别名', () => {
    const lookup = createAccountAuxRequirementLookup(db, AID)
    expect(cashierRowMissingAux(lookup, '660201', null)).toEqual(['部门'])
    expect(cashierRowMissingAux(lookup, '660201', JSON.stringify({ dept: 'i-d01' }))).toEqual([])
    expect(cashierRowMissingAux(lookup, '6601', JSON.stringify({ 'c-dept': 'i-d01' }))).toEqual(['项目'])
    expect(cashierRowMissingAux(lookup, '1602', null)).toEqual([])
  })
})

describe('固定资产卡片', () => {
  it('未填使用部门 / 部门对不上 / 已对上 三种情况', () => {
    const ctx = loadAssetAuxContext(db, AID)
    const lookup = createAccountAuxRequirementLookup(db, AID)
    const codes = ['660201', '1602']
    expect(assetAuxIssues(db, AID, ctx, lookup, { asset_no: 'A1' }, codes)).toEqual(['未填使用部门（科目 660201 管理费用-折旧）'])
    expect(assetAuxIssues(db, AID, ctx, lookup, { asset_no: 'A2', dept_code: 'X9' }, codes)[0]).toContain('使用部门「X9」在总账「部门」辅助核算中找不到')
    expect(assetAuxIssues(db, AID, ctx, lookup, { asset_no: 'A3', dept_code: 'D01' }, codes)).toEqual([])
  })
})
