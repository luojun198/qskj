/** 编号规则引擎：按单据类型独立规则 / 回退旧全局规则 / 主数据四类编码 / 参数校验 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import Database from 'better-sqlite3'

let testDb: Database.Database
vi.mock('../db/index.js', () => ({ getDb: () => testDb }))

import { nextDocNo } from '../routes/scmDoc.js'
import { nextMasterCode, nextItemCode, nextAuxNo, validateNoRuleParam } from '../services/scmNoRule.js'

const AID = 'NR-TEST'
const setParam = (k: string, v: string) =>
  testDb.prepare('INSERT INTO system_params (id,account_set_id,param_key,param_value) VALUES (?,?,?,?)').run(k, AID, k, v)

describe('scmNoRule', () => {
  beforeEach(() => {
    testDb = new Database(':memory:')
    testDb.exec(`
      CREATE TABLE system_params (id TEXT, account_set_id TEXT, param_key TEXT, param_value TEXT);
      CREATE TABLE scm_doc (id TEXT, account_set_id TEXT, doc_type TEXT, doc_no TEXT);
      CREATE TABLE scm_partner (account_set_id TEXT, code TEXT);
      CREATE TABLE scm_item (account_set_id TEXT, code TEXT);
      CREATE TABLE scm_statement (account_set_id TEXT, stmt_no TEXT);
    `)
  })

  it('单据类型规则优先，其他类型回退旧全局规则', () => {
    setParam('scm:doc_no_rule', '{CODE}{YY}{MM}-{SEQ:4}')
    setParam('scm:doc_no_rules', JSON.stringify({ PO: 'PO-{YYYY}{MM}{DD}-{SEQ:2}' }))
    expect(nextDocNo(testDb, AID, 'PO', '2026-03-05')).toBe('PO-20260305-01')
    expect(nextDocNo(testDb, AID, 'SOa', '2026-03-05')).toBe('SOa2603-0001')
  })

  it('同前缀流水递增；日期不同各自起号', () => {
    setParam('scm:doc_no_rules', JSON.stringify({ PO: 'PO{YYMMDD}'.replace('{YYMMDD}', '{YY}{MM}{DD}') + '-{SEQ:3}' }))
    testDb.prepare('INSERT INTO scm_doc VALUES (?,?,?,?)').run('1', AID, 'PO', 'PO260305-001')
    expect(nextDocNo(testDb, AID, 'PO', '2026-03-05')).toBe('PO260305-002')
    expect(nextDocNo(testDb, AID, 'PO', '2026-03-06')).toBe('PO260306-001')
  })

  it('客户 / 供应商 / 材料 / 成品编码互相独立', () => {
    setParam('scm:code_rules', JSON.stringify({
      customer: { prefix: 'C', sep: '-', seqLen: 5, withDate: false },
      product: { prefix: 'FG', sep: '', seqLen: 3, withDate: false },
    }))
    testDb.prepare('INSERT INTO scm_partner VALUES (?,?)').run(AID, 'C-00007')
    expect(nextMasterCode(testDb, AID, 'customer', 'scm_partner')).toBe('C-00008')
    expect(nextMasterCode(testDb, AID, 'supplier', 'scm_partner')).toBe('GYS0001')   // 未配置走默认
    expect(nextMasterCode(testDb, AID, 'product', 'scm_item')).toBe('FG001')
    expect(nextMasterCode(testDb, AID, 'material', 'scm_item')).toBe('WL0001')
  })

  it('辅助单号：未配置返回 null（走历史逻辑），配置后按规则', () => {
    expect(nextAuxNo(testDb, AID, 'DZ', 'scm_statement', 'stmt_no', '2026-03-01')).toBeNull()
    setParam('scm:doc_no_rules', JSON.stringify({ DZ: 'DZ{YY}{MM}-{SEQ:4}' }))
    expect(nextAuxNo(testDb, AID, 'DZ', 'scm_statement', 'stmt_no', '2026-03-01')).toBe('DZ2603-0001')
  })

  it('参数校验', () => {
    expect(validateNoRuleParam('scm:doc_no_rules', '{"PO":"PO-{BAD}-{SEQ:3}"}')).toMatch(/未知占位符/)
    expect(validateNoRuleParam('scm:doc_no_rules', '{"PO":"PO-{SEQ:11}"}')).toMatch(/1~10/)
    expect(validateNoRuleParam('scm:doc_no_rules', '{"PO":"PO-{SEQ:3}"}')).toBe('')
    expect(validateNoRuleParam('scm:code_rules', '{"customer":{"prefix":"K H","sep":"","seqLen":4}}')).toMatch(/前缀/)
    expect(validateNoRuleParam('scm:code_rules', '{"customer":{"prefix":"KH","sep":"","seqLen":4}}')).toBe('')
  })

  it('业务字段 {F:key[:n]} 渲染，空值省略', () => {
    setParam('scm:doc_no_rules', JSON.stringify({ PO: '{CODE}-{F:partner_code:3}-{YY}{MM}-{SEQ:3}' }))
    expect(nextDocNo(testDb, AID, 'PO', '2026-03-05', { partner_code: 'GYS0001' })).toBe('PO-GYS-2603-001')
    testDb.prepare('INSERT INTO scm_doc VALUES (?,?,?,?)').run('1', AID, 'PO', 'PO-GYS-2603-001')
    expect(nextDocNo(testDb, AID, 'PO', '2026-03-05', { partner_code: 'GYS0001' })).toBe('PO-GYS-2603-002')
    expect(nextDocNo(testDb, AID, 'PO', '2026-03-05', { partner_code: 'KH0002' })).toBe('PO-KH0-2603-001')   // 不同往来单位各自起号
    expect(nextDocNo(testDb, AID, 'PO', '2026-03-05')).toBe('PO--2603-001')
  })

  it('主数据编码：模板（含物料大类）与旧结构互转', () => {
    setParam('scm:code_rules', JSON.stringify({
      material: 'CL-{F:category_code}-{SEQ:3}',
      supplier: { prefix: 'S', sep: '_', seqLen: 3, withDate: false },
    }))
    expect(nextMasterCode(testDb, AID, 'material', 'scm_item', { category_code: '01' })).toBe('CL-01-001')
    expect(nextMasterCode(testDb, AID, 'supplier', 'scm_partner')).toBe('S_001')
  })

  it('校验：重复流水号、未知字段', () => {
    expect(validateNoRuleParam('scm:doc_no_rules', '{"PO":"{SEQ:3}-{SEQ:2}"}')).toMatch(/只能有一个/)
    expect(validateNoRuleParam('scm:doc_no_rules', '{"PO":"{F:evil}-{SEQ:3}"}')).toMatch(/未知业务字段/)
    expect(validateNoRuleParam('scm:code_rules', '{"material":"CL-{F:category_code}-{SEQ:3}"}')).toBe('')
  })
  it('物料编码按物料属性：属性单独规则 → 成品规则 → 材料兜底', () => {
    setParam('scm:code_rules', JSON.stringify({ material: 'CL{SEQ:3}', product: 'CP{SEQ:3}', 'item:6': 'BCP{SEQ:4}', 'item:11': '' }))
    testDb.prepare('INSERT INTO scm_item VALUES (?,?)').run(AID, 'BCP0004')
    expect(nextItemCode(testDb, AID, '6')).toBe('BCP0005')
    expect(nextItemCode(testDb, AID, '9')).toBe('CP001')
    expect(nextItemCode(testDb, AID, '0')).toBe('CL001')
    expect(nextItemCode(testDb, AID, '11')).toBe('CL001')   // 空串 = 沿用材料规则
    expect(nextItemCode(testDb, AID, undefined)).toBe('CL001')
  })

  it('校验：物料属性规则键', () => {
    expect(validateNoRuleParam('scm:code_rules', '{"item:6":"BCP{SEQ:4}"}')).toBe('')
    expect(validateNoRuleParam('scm:code_rules', '{"item:6":"BCP{BAD}"}')).toMatch(/未知占位符/)
    expect(validateNoRuleParam('scm:code_rules', '{"item:6":{"prefix":"B"}}')).toMatch(/无效/)
    expect(validateNoRuleParam('scm:code_rules', '{"foo":"X{SEQ:3}"}')).toMatch(/未知的编码规则/)
  })
})
