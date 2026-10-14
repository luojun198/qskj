/**
 * 进销存凭证 ↔ 总账辅助核算 严格对应
 *
 * 覆盖：四种匹配模式、对照表优先、近似候选只建议不采用、科目没挂类别不填、
 * 生成凭证写 aux_data / supplier_id、对不上拦截、自动新建后重试、编号冲突不新建、映射指向已删项目。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import Database from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'

let testDb: Database.Database

vi.mock('../db/index.js', () => ({
  getDb: () => testDb,
}))

import { checkScmDocRequiredAux, genVoucherHandler } from '../routes/scmDoc.js'
import { up as createMapTable } from '../db/migrations/20261007_add_scm_gl_aux_map.js'
import {
  auxSimilarity,
  buildAuxPreview,
  createAuxItemsForSources,
  describeRequiredFields,
  guessAuxSource,
  loadScmAuxContext,
  matchAuxItem,
  resolveDocAuxRefs,
  saveAuxMap,
} from '../services/scmVoucherAux.js'

const AID = 'AS-AUX'
const CAT_CUSTOMER = 'cat-customer'
const CAT_DEPT = 'cat-dept'

function createDb() {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE scm_doc (id TEXT, account_set_id TEXT, doc_type TEXT, doc_no TEXT, status TEXT,
      doc_date TEXT, partner_code TEXT, dept_code TEXT, biz_person TEXT, settle_account TEXT, remark TEXT, voucher_id TEXT, total_amount REAL);
    CREATE TABLE scm_doc_line (id TEXT, account_set_id TEXT, doc_id TEXT, item_code TEXT,
      qty REAL, price REAL, amount REAL, tax_amount REAL, unit_cost REAL, remark TEXT, arap_source_log_id TEXT);
    CREATE TABLE scm_doc_type (account_set_id TEXT, code TEXT, category TEXT, direction TEXT);
    CREATE TABLE scm_partner (id TEXT, account_set_id TEXT, code TEXT, name TEXT, enabled INTEGER DEFAULT 1,
      partner_type TEXT, ar_account TEXT, ap_account TEXT);
    CREATE TABLE scm_item (id TEXT, account_set_id TEXT, code TEXT, name TEXT, inv_account TEXT);
    CREATE TABLE accounts (id TEXT, account_set_id TEXT, code TEXT, name TEXT, parent_id TEXT,
      is_enabled INTEGER DEFAULT 1, is_cash INTEGER DEFAULT 0, is_bank INTEGER DEFAULT 0, is_aux INTEGER DEFAULT 0, aux_types TEXT);
    CREATE TABLE system_params (id TEXT, account_set_id TEXT, param_key TEXT, param_value TEXT, UNIQUE(account_set_id, param_key));
    CREATE TABLE aux_categories (id TEXT PRIMARY KEY, account_set_id TEXT, code TEXT, name TEXT, sort_order INTEGER DEFAULT 0);
    CREATE TABLE aux_category_fields (id TEXT, category_id TEXT, field_key TEXT, field_name TEXT, show_in_voucher INTEGER DEFAULT 0,
      required_in_archive INTEGER DEFAULT 0, sort_order INTEGER DEFAULT 0, is_enabled INTEGER DEFAULT 1);
    CREATE TABLE aux_items (id TEXT PRIMARY KEY, account_set_id TEXT, type TEXT, code TEXT, name TEXT,
      status TEXT DEFAULT 'active', remark TEXT, field_values TEXT DEFAULT '{}');
    CREATE TABLE scm_ar_ap_log (currency TEXT, exchange_rate REAL NOT NULL DEFAULT 1, amount_fc REAL, verified_fc REAL NOT NULL DEFAULT 0, id TEXT, account_set_id TEXT, partner_code TEXT, doc_type TEXT, doc_no TEXT,
      direction TEXT, amount REAL, verified_amount REAL DEFAULT 0, arap_side TEXT);
    CREATE TABLE vouchers (id TEXT, account_set_id TEXT, voucher_no TEXT, voucher_type_id TEXT,
      voucher_date TEXT, year INTEGER, period INTEGER, total_amount REAL, maker_name TEXT, remark TEXT, source TEXT);
    CREATE TABLE voucher_entries (currency_code TEXT, exchange_rate REAL, foreign_amount REAL, dept_id TEXT, dept_name TEXT, project_id TEXT, project_name TEXT, supplier_id TEXT, supplier_name TEXT, person_id TEXT, person_name TEXT, func_class_id TEXT, func_class_name TEXT, aux_data TEXT, cash_flow_code TEXT, cash_flow_name TEXT, quantity REAL, unit_price REAL, unit TEXT, id TEXT, account_set_id TEXT, voucher_id TEXT, seq INTEGER,
      account_id TEXT, account_code TEXT, account_name TEXT, direction TEXT, amount REAL, amount_cents INTEGER, summary TEXT);
  `)
  createMapTable(db)
  return db
}

function addItem(categoryId: string, code: string, name: string, status = 'active') {
  const id = `item-${categoryId}-${code}`
  testDb.prepare('INSERT INTO aux_items (id,account_set_id,type,code,name,status) VALUES (?,?,?,?,?,?)').run(id, AID, categoryId, code, name, status)
  return id
}

function addPartner(code: string, name: string) {
  testDb.prepare('INSERT INTO scm_partner (id,account_set_id,code,name,partner_type) VALUES (?,?,?,?,?)').run(uuidv4(), AID, code, name, 'customer')
}

function setParam(key: string, value: string) {
  testDb.prepare('INSERT OR REPLACE INTO system_params (id,account_set_id,param_key,param_value) VALUES (?,?,?,?)').run(uuidv4(), AID, key, value)
}

function seedRcv(partner: string, amount = 100, dept: string | null = null) {
  const docId = uuidv4()
  testDb.prepare(`INSERT INTO scm_doc (id,account_set_id,doc_type,doc_no,status,doc_date,partner_code,dept_code,settle_account)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(docId, AID, 'RCV', `RCV-${docId.slice(0, 4)}`, 'audited', '2026-09-01', partner, dept, '100201')
  testDb.prepare('INSERT INTO scm_doc_line (id,account_set_id,doc_id,qty,price,amount) VALUES (?,?,?,?,?,?)')
    .run(uuidv4(), AID, docId, 1, amount, amount)
  return docId
}

function callGen(id: string) {
  const req: any = { params: { id }, accountSetId: AID, userName: '测试员' }
  const res: any = { statusCode: 200, body: null as any }
  res.status = (c: number) => { res.statusCode = c; return res }
  res.json = (b: any) => { res.body = b; return res }
  genVoucherHandler(req, res)
  return res
}

beforeEach(() => {
  testDb = createDb()
  testDb.prepare('INSERT INTO aux_categories (id,account_set_id,code,name) VALUES (?,?,?,?)').run(CAT_CUSTOMER, AID, 'customer', '往来单位')
  testDb.prepare('INSERT INTO aux_categories (id,account_set_id,code,name) VALUES (?,?,?,?)').run(CAT_DEPT, AID, 'dept', '部门')
  const acc = testDb.prepare('INSERT INTO accounts (id,account_set_id,code,name,is_bank,is_aux,aux_types) VALUES (?,?,?,?,?,?,?)')
  acc.run('acc-100201', AID, '100201', '银行存款-工行', 1, 0, null)
  acc.run('acc-1122', AID, '1122', '应收账款', 0, 1, JSON.stringify({ [CAT_CUSTOMER]: null }))
  acc.run('acc-2202', AID, '2202', '应付账款', 0, 0, null)
  testDb.prepare('INSERT INTO scm_doc_type (account_set_id,code,category,direction) VALUES (?,?,?,?)').run(AID, 'RCV', 'finance', 'none')
})

describe('匹配规则', () => {
  it('默认按名称完全一致；编号不同也能对上', () => {
    addItem(CAT_CUSTOMER, 'K01', '深圳甲公司')
    const ctx = loadScmAuxContext(testDb, AID)
    const r = matchAuxItem(ctx, CAT_CUSTOMER, 'partner', { code: 'P001', name: '深圳甲公司' })
    expect(r.itemId).toBe(`item-${CAT_CUSTOMER}-K01`)
    expect(r.itemId !== null && r.how).toBe('name')
  })

  it('按编号模式：名称一样但编号不同则对不上', () => {
    addItem(CAT_CUSTOMER, 'K01', '深圳甲公司')
    setParam('scm:aux_match_mode', 'code')
    const ctx = loadScmAuxContext(testDb, AID)
    expect(matchAuxItem(ctx, CAT_CUSTOMER, 'partner', { code: 'P001', name: '深圳甲公司' }).itemId).toBeNull()
    expect(matchAuxItem(ctx, CAT_CUSTOMER, 'partner', { code: 'K01', name: '别的名字' }).itemId).toBe(`item-${CAT_CUSTOMER}-K01`)
  })

  it('编号优先、名称兜底 / 名称优先、编号兜底', () => {
    const byName = addItem(CAT_CUSTOMER, 'K01', '甲公司')
    const byCode = addItem(CAT_CUSTOMER, 'P001', '乙公司')
    setParam('scm:aux_match_mode', 'code_name')
    let ctx = loadScmAuxContext(testDb, AID)
    expect(matchAuxItem(ctx, CAT_CUSTOMER, 'partner', { code: 'P001', name: '甲公司' }).itemId).toBe(byCode)
    expect(matchAuxItem(ctx, CAT_CUSTOMER, 'partner', { code: 'X', name: '甲公司' }).itemId).toBe(byName)
    setParam('scm:aux_match_mode', 'name_code')
    ctx = loadScmAuxContext(testDb, AID)
    expect(matchAuxItem(ctx, CAT_CUSTOMER, 'partner', { code: 'P001', name: '甲公司' }).itemId).toBe(byName)
  })

  it('名称有差异时只给近似候选，不自动采用', () => {
    addItem(CAT_CUSTOMER, 'K01', '深圳市甲科技有限公司')
    const ctx = loadScmAuxContext(testDb, AID)
    const r = matchAuxItem(ctx, CAT_CUSTOMER, 'partner', { code: 'P001', name: '深圳市甲科技' })
    expect(r.itemId).toBeNull()
    if (r.itemId === null) {
      expect(r.suggestions[0]?.code).toBe('K01')
      expect(r.suggestions[0]?.score).toBeGreaterThan(0.8)
    }
  })

  it('同名多条视为不唯一，不自动选', () => {
    addItem(CAT_CUSTOMER, 'K01', '甲公司')
    addItem(CAT_CUSTOMER, 'K02', '甲公司')
    const ctx = loadScmAuxContext(testDb, AID)
    const r = matchAuxItem(ctx, CAT_CUSTOMER, 'partner', { code: 'P001', name: '甲公司' })
    expect(r.itemId).toBeNull()
    expect(r.itemId === null && r.ambiguous).toBe(true)
  })

  it('停用项目不参与匹配', () => {
    addItem(CAT_CUSTOMER, 'K01', '甲公司', 'closed')
    const ctx = loadScmAuxContext(testDb, AID)
    expect(matchAuxItem(ctx, CAT_CUSTOMER, 'partner', { code: 'P001', name: '甲公司' }).itemId).toBeNull()
  })

  it('对照表优先于自动匹配；指向已删项目时视为未匹配', () => {
    addItem(CAT_CUSTOMER, 'K01', '甲公司')
    const manual = addItem(CAT_CUSTOMER, 'K09', '甲公司（总部）')
    saveAuxMap(testDb, AID, { sourceType: 'partner', sourceCode: 'P001', categoryId: CAT_CUSTOMER, auxItemId: manual })
    let ctx = loadScmAuxContext(testDb, AID)
    const r = matchAuxItem(ctx, CAT_CUSTOMER, 'partner', { code: 'P001', name: '甲公司' })
    expect(r.itemId).toBe(manual)
    expect(r.itemId !== null && r.how).toBe('manual')
    testDb.prepare('DELETE FROM aux_items WHERE id=?').run(manual)
    ctx = loadScmAuxContext(testDb, AID)
    expect(matchAuxItem(ctx, CAT_CUSTOMER, 'partner', { code: 'P001', name: '甲公司' }).itemId).toBe(`item-${CAT_CUSTOMER}-K01`)
  })

  it('近似度：归一化去掉公司后缀与括号', () => {
    expect(auxSimilarity('甲科技有限公司', '甲科技')).toBeGreaterThanOrEqual(0.95)
    expect(auxSimilarity('（深圳）甲', '深圳甲')).toBeGreaterThanOrEqual(0.95)
    expect(auxSimilarity('完全不同', '毫无关系')).toBeLessThan(0.45)
  })

  it('类别默认取值来源', () => {
    expect(guessAuxSource({ code: 'dept', name: '部门' })).toBe('dept')
    expect(guessAuxSource({ code: 'person', name: '个人' })).toBe('person')
    expect(guessAuxSource({ code: 'CAT001', name: '客户' })).toBe('partner')
    expect(guessAuxSource({ code: 'project', name: '项目' })).toBe('none')
  })
})

describe('按科目决定填哪些辅助', () => {
  it('科目没挂辅助的不填；挂了的按单据往来单位填', () => {
    addPartner('P001', '甲公司')
    addItem(CAT_CUSTOMER, 'K01', '甲公司')
    const ctx = loadScmAuxContext(testDb, AID)
    const doc = { partner_code: 'P001' }
    expect(resolveDocAuxRefs(ctx, doc, '100201')).toEqual({ refs: {}, problems: [] })
    expect(resolveDocAuxRefs(ctx, doc, '1122').refs).toEqual({ _customer_id: `item-${CAT_CUSTOMER}-K01` })
  })

  it('来源设为「不填」而科目又要求该类别时报 no_source', () => {
    setParam('scm:aux_source_map', JSON.stringify({ [CAT_CUSTOMER]: 'none' }))
    const ctx = loadScmAuxContext(testDb, AID)
    expect(resolveDocAuxRefs(ctx, { partner_code: 'P001' }, '1122').problems[0].kind).toBe('no_source')
  })
})

describe('生成凭证', () => {
  it('应收科目挂往来辅助：凭证分录写 supplier_id 与 aux_data', () => {
    addPartner('P001', '甲公司')
    const itemId = addItem(CAT_CUSTOMER, 'K01', '甲公司')
    const res = callGen(seedRcv('P001'))
    expect(res.body.code).toBe(0)
    const ar = testDb.prepare("SELECT supplier_id, supplier_name, aux_data FROM voucher_entries WHERE account_code='1122'").get() as any
    expect(ar.supplier_id).toBe(itemId)
    expect(ar.supplier_name).toBe('甲公司')
    expect(JSON.parse(ar.aux_data).customer.id).toBe(itemId)
    const bank = testDb.prepare("SELECT aux_data FROM voucher_entries WHERE account_code='100201'").get() as any
    expect(bank.aux_data).toBeNull()
  })

  it('对不上时拦截并返回 SCM_AUX_UNMATCHED 与近似候选，不写凭证', () => {
    addPartner('P001', '深圳甲科技')
    addItem(CAT_CUSTOMER, 'K01', '深圳甲科技有限公司')
    const docId = seedRcv('P001')
    const res = callGen(docId)
    expect(res.statusCode).toBe(400)
    expect(res.body.reason).toBe('SCM_AUX_UNMATCHED')
    expect(res.body.message).toContain('深圳甲科技')
    expect(res.body.data.items[0].suggestions[0].code).toBe('K01')
    expect((testDb.prepare('SELECT COUNT(*) c FROM vouchers').get() as any).c).toBe(0)
    expect((testDb.prepare('SELECT voucher_id FROM scm_doc WHERE id=?').get(docId) as any).voucher_id).toBeNull()
  })

  it('采纳近似建议后重试成功', () => {
    addPartner('P001', '深圳甲科技')
    const itemId = addItem(CAT_CUSTOMER, 'K01', '深圳甲科技有限公司')
    const docId = seedRcv('P001')
    expect(callGen(docId).statusCode).toBe(400)
    saveAuxMap(testDb, AID, { sourceType: 'partner', sourceCode: 'P001', categoryId: CAT_CUSTOMER, auxItemId: itemId, matchSource: 'confirmed' })
    expect(callGen(docId).body.code).toBe(0)
  })

  it('自动新建辅助项后重试成功；编号被占用时不新建', () => {
    addPartner('P001', '新客户')
    addPartner('P002', '另一客户')
    addItem(CAT_CUSTOMER, 'P002', '名字不一样')
    const results = createAuxItemsForSources(testDb, AID, [
      { sourceType: 'partner', sourceCode: 'P001', categoryId: CAT_CUSTOMER },
      { sourceType: 'partner', sourceCode: 'P002', categoryId: CAT_CUSTOMER },
    ])
    expect(results[0].ok).toBe(true)
    expect(results[1].ok).toBe(false)
    expect(results[1].message).toContain('已被')
    const created = testDb.prepare("SELECT code, name FROM aux_items WHERE type=? AND code='P001'").get(CAT_CUSTOMER) as any
    expect(created).toEqual({ code: 'P001', name: '新客户' })
    expect(callGen(seedRcv('P001')).body.code).toBe(0)
  })
})

describe('预览', () => {
  it('列出往来单位对应状态', () => {
    addPartner('P001', '甲公司')
    addPartner('P002', '乙科技')
    addItem(CAT_CUSTOMER, 'K01', '甲公司')
    addItem(CAT_CUSTOMER, 'K02', '乙科技有限公司')
    const ctx = loadScmAuxContext(testDb, AID)
    const { rows } = buildAuxPreview(ctx, 'partner', { ar: '1122', ap: '2202', others: [] })
    const byCode = Object.fromEntries(rows.map(r => [r.source_code, r]))
    expect(byCode.P001.status).toBe('matched')
    expect(byCode.P002.status).toBe('suggested')
    expect(byCode.P002.accounts).toEqual(['1122'])
  })
})

describe('单据关键字段必填（审核拦截 / 保存提醒）', () => {
  const rcv = (extra: Record<string, unknown> = {}) => ({ doc_type: 'RCV', partner_code: 'P001', settle_account: '100201', ...extra })
  const lines = [{ qty: 1, price: 100, amount: 100 }]

  it('应收科目挂了部门辅助、单据未填部门：列为必填且缺失', () => {
    testDb.prepare("UPDATE accounts SET aux_types=? WHERE code='1122'").run(JSON.stringify({ [CAT_CUSTOMER]: null, [CAT_DEPT]: null }))
    const r = checkScmDocRequiredAux(testDb, AID, rcv(), lines)
    expect(r.required.map(f => f.source).sort()).toEqual(['dept', 'partner'])
    expect(r.missing.map(f => f.source)).toEqual(['dept'])
    expect(r.missing[0].accounts).toEqual(['1122 应收账款'])
    expect(describeRequiredFields(r.missing)).toContain('单据须填写部门')
  })

  it('填了部门即不缺；只看空不空，对不对得上留到生成凭证', () => {
    testDb.prepare("UPDATE accounts SET aux_types=? WHERE code='1122'").run(JSON.stringify({ [CAT_CUSTOMER]: null, [CAT_DEPT]: null }))
    expect(checkScmDocRequiredAux(testDb, AID, rcv({ dept_code: 'D-NOT-EXIST' }), lines).missing).toEqual([])
  })

  it('科目未挂辅助 / 来源设为不填 / 无明细：不要求', () => {
    testDb.prepare("UPDATE accounts SET is_aux=0 WHERE code='1122'").run()
    expect(checkScmDocRequiredAux(testDb, AID, rcv({ partner_code: '' }), lines)).toEqual({ required: [], missing: [] })
    testDb.prepare("UPDATE accounts SET is_aux=1 WHERE code='1122'").run()
    setParam('scm:aux_source_map', JSON.stringify({ [CAT_CUSTOMER]: 'none' }))
    expect(checkScmDocRequiredAux(testDb, AID, rcv({ partner_code: '' }), lines).required).toEqual([])
    expect(checkScmDocRequiredAux(testDb, AID, rcv(), []).required).toEqual([])
  })
})
