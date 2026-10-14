/**
 * 组装单 · 简单委外 / 受托加工 + 客供仓
 *   - 委托加工（entrust）：成品成本 = 材料 + 加工费；加工费挂加工厂应付；凭证 借存货 / 贷生产成本(料) / 贷应付(加工费)
 *   - 受托加工（contract）：成品成本只含自有材料（客供仓材料不计成本）；加工费挂客户应收；凭证另记 借应收 / 贷加工收入
 *   - 客供仓：只记数量不计成本；与普通仓之间不能调拨；出入库必须填往来单位
 *   - 往来：余额表按 arap_side 分应收/应付；收付款单可选组装单作源单；对账单取成品行加工费
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import Database from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'

let testDb: Database.Database

vi.mock('../db/index.js', () => ({
  getDb: () => testDb,
}))

import { auditDocHandler, unauditDocHandler, genVoucherHandler, normalizeAssemblyFeeTax } from '../routes/scmDoc.js'
import { getPartnerBalanceSummary, getPaymentSources, getOpenItems } from '../services/scmArAp.js'
import { applyMovingAvgIn, applyMovingAvgOut } from '../services/scmCosting.js'
import { getStatementCandidates } from '../services/scmStatement.js'
import { up as statementUp } from '../db/migrations/20261011_scm_statement.js'

const AID = 'AS-PROC'
const SUPPLIER = 'V001'
const CUSTOMER = 'C001'

function createDb() {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE system_params (id TEXT, account_set_id TEXT, param_key TEXT, param_value TEXT);
    CREATE TABLE scm_item (id TEXT, account_set_id TEXT, code TEXT, name TEXT, spec TEXT, unit TEXT,
      batch_flag INTEGER DEFAULT 0, batch_out_mode TEXT, shelf_life_days INTEGER DEFAULT 0,
      serial_flag INTEGER DEFAULT 0, default_warehouse_code TEXT, inv_account TEXT, purchase_price REAL, ref_cost REAL, item_type TEXT);
    CREATE TABLE scm_partner (id TEXT, account_set_id TEXT, code TEXT, name TEXT, partner_type TEXT,
      ap_account TEXT, ar_account TEXT, credit_days INTEGER DEFAULT 0, credit_limit REAL DEFAULT 0);
    CREATE TABLE scm_warehouse (id TEXT, account_set_id TEXT, code TEXT, name TEXT, is_customer_supplied INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE scm_doc (exchange_rate REAL DEFAULT 1, currency TEXT, id TEXT, account_set_id TEXT, doc_type TEXT, doc_no TEXT, status TEXT,
      doc_date TEXT, warehouse_code TEXT, dest_warehouse_code TEXT, partner_code TEXT, plan_id TEXT, bom_id TEXT, process_mode TEXT,
      voucher_id TEXT, total_amount REAL, auditor TEXT, audited_at TEXT, updated_at TEXT,
      source_doc_id TEXT, settle_account TEXT, remark TEXT, created_at TEXT, due_date TEXT, credit_days INTEGER);
    CREATE TABLE scm_doc_line (id TEXT, account_set_id TEXT, doc_id TEXT, seq INTEGER, item_code TEXT,
      warehouse_code TEXT, qty REAL, price REAL, amount REAL, unit_cost REAL, tax_amount REAL DEFAULT 0,
      tax_rate REAL DEFAULT 0, labor_cost REAL DEFAULT 0, overhead_cost REAL DEFAULT 0, process_fee REAL DEFAULT 0,
      batch_no TEXT, serial_nos TEXT, source_line_id TEXT, field_values TEXT, line_role TEXT,
      product_group INTEGER, remark TEXT);
    CREATE TABLE scm_doc_type (account_set_id TEXT, code TEXT, name TEXT, category TEXT, direction TEXT, affects_stock INTEGER);
    CREATE TABLE scm_stock (id TEXT, account_set_id TEXT, warehouse_code TEXT, item_code TEXT,
      qty REAL DEFAULT 0, amount REAL DEFAULT 0, avg_cost REAL DEFAULT 0, updated_at TEXT);
    CREATE TABLE scm_stock_move (id TEXT, account_set_id TEXT, move_date TEXT, doc_type TEXT, doc_no TEXT,
      line_seq INTEGER, warehouse_code TEXT, item_code TEXT, direction TEXT, qty REAL, unit_cost REAL,
      amount REAL, batch_no TEXT, balance_qty REAL, balance_amount REAL, balance_avg_cost REAL);
    CREATE TABLE scm_ar_ap_log (currency TEXT, exchange_rate REAL NOT NULL DEFAULT 1, amount_fc REAL, verified_fc REAL NOT NULL DEFAULT 0, id TEXT, account_set_id TEXT, partner_code TEXT, doc_type TEXT, doc_no TEXT,
      doc_date TEXT, due_date TEXT, direction TEXT, amount REAL, verified_amount REAL DEFAULT 0,
      ar_account TEXT, ap_account TEXT, cashier_journal_id TEXT, remark TEXT, arap_side TEXT, created_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE scm_ar_ap_verify (id TEXT, account_set_id TEXT, partner_code TEXT, verify_no TEXT, verify_date TEXT, in_log_id TEXT, out_log_id TEXT, amount REAL, created_by TEXT, created_at TEXT);
    CREATE TABLE cashier_journal (id TEXT, account_set_id TEXT);
    CREATE TABLE scm_production_plan (id TEXT, account_set_id TEXT, code TEXT, plan_type TEXT,
      status TEXT, plan_qty REAL DEFAULT 0, finished_qty REAL DEFAULT 0, scrap_qty REAL DEFAULT 0, bom_id TEXT,
      yl_warehouse TEXT, fp_warehouse TEXT, source_doc_id TEXT, supplier_code TEXT);
    CREATE TABLE scm_mrp_source (id TEXT, account_set_id TEXT, mrp_doc_id TEXT, source_kind TEXT, source_id TEXT);
    CREATE TABLE scm_bom (version TEXT, effective_date TEXT, expire_date TEXT, id TEXT, account_set_id TEXT, code TEXT, item_code TEXT, status TEXT, is_default INTEGER DEFAULT 0);
    CREATE TABLE scm_bom_line (unit TEXT, remark TEXT, sub_group TEXT, sub_priority INTEGER, id TEXT, account_set_id TEXT, bom_id TEXT, seq INTEGER, item_code TEXT,
      qty REAL, scrap_rate REAL DEFAULT 0, line_type TEXT);
    CREATE TABLE scm_batch_move (id TEXT, account_set_id TEXT, doc_id TEXT, doc_type TEXT, doc_no TEXT,
      line_seq INTEGER, warehouse_code TEXT, item_code TEXT, batch_no TEXT, direction TEXT, qty REAL,
      produce_date TEXT, expire_date TEXT);
    CREATE TABLE scm_stock_batch (id TEXT, account_set_id TEXT, warehouse_code TEXT, item_code TEXT,
      batch_no TEXT, qty REAL, amount REAL, produce_date TEXT, expire_date TEXT);
    CREATE TABLE scm_serial_move (id TEXT, account_set_id TEXT, doc_id TEXT, doc_type TEXT, doc_no TEXT,
      line_seq INTEGER, warehouse_code TEXT, item_code TEXT, serial_no TEXT, direction TEXT);
    CREATE TABLE scm_serial (id TEXT, account_set_id TEXT, item_code TEXT, serial_no TEXT, status TEXT,
      warehouse_code TEXT, in_doc_no TEXT, out_doc_no TEXT, updated_at TEXT);
    CREATE TABLE accounts (id TEXT, account_set_id TEXT, code TEXT, name TEXT);
    CREATE TABLE vouchers (id TEXT, account_set_id TEXT, voucher_no TEXT, voucher_type_id TEXT,
      voucher_date TEXT, year INTEGER, period INTEGER, total_amount REAL, maker_name TEXT,
      remark TEXT, source TEXT);
    CREATE TABLE voucher_entries (currency_code TEXT, exchange_rate REAL, foreign_amount REAL, dept_id TEXT, dept_name TEXT, project_id TEXT, project_name TEXT, supplier_id TEXT, supplier_name TEXT, person_id TEXT, person_name TEXT, func_class_id TEXT, func_class_name TEXT, aux_data TEXT, cash_flow_code TEXT, cash_flow_name TEXT, quantity REAL, unit_price REAL, unit TEXT, id TEXT, account_set_id TEXT, voucher_id TEXT, seq INTEGER,
      account_id TEXT, account_code TEXT, account_name TEXT, direction TEXT, amount REAL,
      amount_cents INTEGER, summary TEXT);
  `)
  statementUp(db)
  return db
}

function seedBase() {
  for (const [code, cat, dir] of [['AS', 'production', 'none'], ['OI', 'inventory', 'in'], ['OO', 'inventory', 'out'], ['TR', 'inventory', 'none']]) {
    testDb.prepare('INSERT INTO scm_doc_type (account_set_id,code,name,category,direction,affects_stock) VALUES (?,?,?,?,?,1)').run(AID, code, code, cat, dir)
  }
  for (const [code, name] of [['1403', '原材料'], ['1406', '库存商品'], ['5001', '生产成本'], ['2202', '应付账款'], ['1122', '应收账款'], ['6051', '其他业务收入'], ['1901', '待处理财产损溢'], ['22210101', '进项税额'], ['22210105', '销项税额']]) {
    testDb.prepare('INSERT INTO accounts (id,account_set_id,code,name) VALUES (?,?,?,?)').run(uuidv4(), AID, code, name)
  }
  testDb.prepare("INSERT INTO scm_item (id,account_set_id,code,name,inv_account) VALUES (?,?,'R1','自有料','1403'),(?,?,'K1','客供料','1403'),(?,?,'FP','成品','1406')")
    .run(uuidv4(), AID, uuidv4(), AID, uuidv4(), AID)
  testDb.prepare("INSERT INTO scm_partner (id,account_set_id,code,name,partner_type,ap_account,ar_account) VALUES (?,?,?,'甲加工厂','supplier','2202',NULL),(?,?,?,'乙客户','customer',NULL,'1122')")
    .run(uuidv4(), AID, SUPPLIER, uuidv4(), AID, CUSTOMER)
  testDb.prepare("INSERT INTO scm_warehouse (id,account_set_id,code,name,is_customer_supplied) VALUES (?,?,'WR','原料仓',0),(?,?,'WF','成品仓',0),(?,?,'WK','客供仓',1)")
    .run(uuidv4(), AID, uuidv4(), AID, uuidv4(), AID)
  // 自有料 R1：100 件 @10
  testDb.prepare('INSERT INTO scm_stock (id,account_set_id,warehouse_code,item_code,qty,amount,avg_cost) VALUES (?,?,?,?,?,?,?)')
    .run(uuidv4(), AID, 'WR', 'R1', 100, 1000, 10)
}

type Line = { item: string; wh: string; qty: number; role?: 'product'; group?: number; fee?: number; rate?: number }
function seedDoc(docType: string, docNo: string, lines: Line[], head: { partner?: string | null; mode?: string | null; wh?: string | null; dest?: string | null } = {}) {
  const docId = uuidv4()
  testDb.prepare(
    "INSERT INTO scm_doc (id,account_set_id,doc_type,doc_no,status,doc_date,warehouse_code,dest_warehouse_code,partner_code,process_mode,total_amount)"
    + " VALUES (?,?,?,?,'draft','2026-10-11',?,?,?,?,0)"
  ).run(docId, AID, docType, docNo, head.wh ?? null, head.dest ?? null, head.partner ?? null, head.mode ?? null)
  lines.forEach((l, i) => {
    testDb.prepare(
      "INSERT INTO scm_doc_line (id,account_set_id,doc_id,seq,item_code,warehouse_code,qty,price,amount,unit_cost,process_fee,line_role,product_group,tax_rate,tax_amount)"
      + " VALUES (?,?,?,?,?,?,?,0,0,0,?,?,?,?,?)"
    ).run(uuidv4(), AID, docId, i + 1, l.item, l.wh, l.qty, l.fee ?? 0, l.role ?? null, l.group ?? null,
      l.rate ?? 0, Math.round(l.qty * (l.fee ?? 0) * (l.rate ?? 0)) / 100)
  })
  return docId
}

function callHandler(handler: any, id: string, body: any = {}) {
  const req: any = { params: { id }, accountSetId: AID, userName: '测试员', body, query: {}, method: 'POST' }
  const res: any = { statusCode: 200, body: null as any }
  res.status = (c: number) => { res.statusCode = c; return res }
  res.json = (b: any) => { res.body = b; return res }
  handler(req, res)
  return res
}

const stock = (wh: string, item: string) =>
  testDb.prepare('SELECT qty, amount, avg_cost FROM scm_stock WHERE account_set_id=? AND warehouse_code=? AND item_code=?').get(AID, wh, item) as any
const logs = () => testDb.prepare('SELECT partner_code, doc_type, direction, amount, arap_side, ar_account, ap_account FROM scm_ar_ap_log WHERE account_set_id=?').all(AID) as any[]
const entriesOf = (voucherId: string) =>
  testDb.prepare('SELECT account_code, direction, amount FROM voucher_entries WHERE voucher_id=? ORDER BY seq').all(voucherId) as any[]
const sumSide = (es: any[], dir: string) => Math.round(es.filter(e => e.direction === dir).reduce((s, e) => s + e.amount, 0) * 100) / 100

/** 成品 FP 10 件：自有料 R1 20 件(@10=200)；加工单价 5 → 加工费 50 */
const asLines = (extra: Line[] = []): Line[] => [
  { item: 'FP', wh: 'WF', qty: 10, role: 'product', group: 1, fee: 5 },
  { item: 'R1', wh: 'WR', qty: 20, group: 1 },
  ...extra,
]

describe('组装单 · 委托加工（加工费计成本、挂应付）', () => {
  beforeEach(() => { testDb = createDb(); seedBase() })

  it('成品成本 = 材料 200 + 加工费 50；加工厂应付 50（arap_side=ap）', () => {
    const id = seedDoc('AS', 'AS-001', asLines(), { partner: SUPPLIER, mode: 'entrust' })
    expect(callHandler(auditDocHandler, id).body.code).toBe(0)
    expect(stock('WF', 'FP')).toMatchObject({ qty: 10, amount: 250, avg_cost: 25 })
    expect(logs()).toEqual([expect.objectContaining({ partner_code: SUPPLIER, doc_type: 'AS', direction: 'in', amount: 50, arap_side: 'ap', ap_account: '2202' })])
    const bal = getPartnerBalanceSummary(testDb, AID).summary.find(s => s.partner_code === SUPPLIER)!
    expect(bal).toMatchObject({ payable_amount: 50, receivable_amount: 0 })
    // 付款单可选，收款单不可选
    expect(getPaymentSources(testDb, AID, SUPPLIER, 'PAY').map(r => r.source_doc_no)).toEqual(['AS-001'])
    expect(getPaymentSources(testDb, AID, SUPPLIER, 'RCV')).toEqual([])
    expect(getOpenItems(testDb, AID, SUPPLIER, 'ap').in_items[0]).toMatchObject({ doc_no: 'AS-001', arap_side: 'ap' })
  })

  it('凭证：借存货 250 / 贷生产成本 200 + 贷应付 50（子件 借生产成本/贷原材料 200），借贷平衡', () => {
    const id = seedDoc('AS', 'AS-001', asLines(), { partner: SUPPLIER, mode: 'entrust' })
    callHandler(auditDocHandler, id)
    const r = callHandler(genVoucherHandler, id)
    expect(r.body.code).toBe(0)
    const es = entriesOf(r.body.data.voucher_id)
    expect(sumSide(es, 'debit')).toBe(sumSide(es, 'credit'))
    expect(es).toEqual(expect.arrayContaining([
      expect.objectContaining({ account_code: '1406', direction: 'debit', amount: 250 }),
      expect.objectContaining({ account_code: '2202', direction: 'credit', amount: 50 }),
    ]))
  })

  it('反审核回退应付与库存', () => {
    const id = seedDoc('AS', 'AS-001', asLines(), { partner: SUPPLIER, mode: 'entrust' })
    callHandler(auditDocHandler, id)
    expect(callHandler(unauditDocHandler, id).body.code).toBe(0)
    expect(logs()).toEqual([])
    expect(stock('WF', 'FP').qty).toBe(0)
    expect(stock('WR', 'R1')).toMatchObject({ qty: 100, amount: 1000 })
  })

  it('往来单位必须是供应商；未填往来单位拦截', () => {
    expect(callHandler(auditDocHandler, seedDoc('AS', 'AS-002', asLines(), { partner: CUSTOMER, mode: 'entrust' })).body.message).toContain('供应商')
    expect(callHandler(auditDocHandler, seedDoc('AS', 'AS-003', asLines(), { mode: 'entrust' })).body.message).toContain('必须指定')
  })
})

describe('组装单 · 受托加工（加工费挂应收，不计成本；客供料不计成本）', () => {
  beforeEach(() => {
    testDb = createDb(); seedBase()
    // 客户送来客供料 K1 30 件：入客供仓，单据上即使填了单价也不计成本
    applyMovingAvgIn(testDb, AID, 'WK', 'K1', 30, 8, { type: 'OI', no: 'OI-001', seq: 1, date: '2026-10-10' })
  })

  it('客供仓入库金额为 0；成品成本只含自有料 200；客户应收 50（arap_side=ar）', () => {
    expect(stock('WK', 'K1')).toMatchObject({ qty: 30, amount: 0, avg_cost: 0 })
    const id = seedDoc('AS', 'AS-101', asLines([{ item: 'K1', wh: 'WK', qty: 30, group: 1 }]), { partner: CUSTOMER, mode: 'contract' })
    expect(callHandler(auditDocHandler, id).body.code).toBe(0)
    expect(stock('WK', 'K1')).toMatchObject({ qty: 0, amount: 0 })
    expect(stock('WF', 'FP')).toMatchObject({ qty: 10, amount: 200, avg_cost: 20 })
    expect(logs()).toEqual([expect.objectContaining({ partner_code: CUSTOMER, doc_type: 'AS', amount: 50, arap_side: 'ar', ar_account: '1122' })])
    const bal = getPartnerBalanceSummary(testDb, AID, undefined, undefined, 'ar').summary
    expect(bal).toEqual([expect.objectContaining({ partner_code: CUSTOMER, receivable_amount: 50, ar_closing: 50 })])
    expect(getPaymentSources(testDb, AID, CUSTOMER, 'RCV').map(r => r.source_doc_no)).toEqual(['AS-101'])
  })

  it('凭证：另记 借应收 50 / 贷其他业务收入 50；客供料不出分录；借贷平衡', () => {
    const id = seedDoc('AS', 'AS-101', asLines([{ item: 'K1', wh: 'WK', qty: 30, group: 1 }]), { partner: CUSTOMER, mode: 'contract' })
    callHandler(auditDocHandler, id)
    const r = callHandler(genVoucherHandler, id)
    expect(r.body.code).toBe(0)
    const es = entriesOf(r.body.data.voucher_id)
    expect(sumSide(es, 'debit')).toBe(sumSide(es, 'credit'))
    expect(es).toEqual(expect.arrayContaining([
      expect.objectContaining({ account_code: '1122', direction: 'debit', amount: 50 }),
      expect.objectContaining({ account_code: '6051', direction: 'credit', amount: 50 }),
      expect.objectContaining({ account_code: '1406', direction: 'debit', amount: 200 }),
    ]))
    expect(es.filter(e => e.account_code === '1403').map(e => e.amount)).toEqual([200])   // 只有自有料出库
  })

  it('对账单：受托加工的组装单作为应收明细，金额 = 数量 × 加工单价', () => {
    const id = seedDoc('AS', 'AS-101', asLines([{ item: 'K1', wh: 'WK', qty: 30, group: 1 }]), { partner: CUSTOMER, mode: 'contract' })
    callHandler(auditDocHandler, id)
    const ar = getStatementCandidates(testDb, AID, { direction: 'ar', partner_code: CUSTOMER, end_date: '2026-10-31' })
    expect(ar.rows).toEqual([expect.objectContaining({ src_doc_no: 'AS-101', item_code: 'FP', qty: 10, price: 5, amount_with_tax: 50, sign: 1 })])
    expect(ar.ledger_balance).toBe(50)
    expect(getStatementCandidates(testDb, AID, { direction: 'ap', partner_code: CUSTOMER, end_date: '2026-10-31' }).rows).toEqual([])
  })

  it('成品不能入客供仓', () => {
    const id = seedDoc('AS', 'AS-102', [
      { item: 'FP', wh: 'WK', qty: 10, role: 'product', group: 1, fee: 5 },
      { item: 'R1', wh: 'WR', qty: 20, group: 1 },
    ], { partner: CUSTOMER, mode: 'contract' })
    expect(callHandler(auditDocHandler, id).body.message).toContain('客供仓')
  })
})

describe('自行组装 · 客供仓规则', () => {
  beforeEach(() => { testDb = createDb(); seedBase() })

  it('自行组装：加工单价被忽略，不挂往来，成本只含材料', () => {
    const id = seedDoc('AS', 'AS-201', asLines(), {})
    expect(callHandler(auditDocHandler, id).body.code).toBe(0)
    expect(stock('WF', 'FP')).toMatchObject({ amount: 200 })
    expect(logs()).toEqual([])
  })

  it('客供仓出库成本恒为 0，不按最近入库价兜底', () => {
    applyMovingAvgIn(testDb, AID, 'WR', 'K1', 5, 99, { type: 'OI', no: 'OI-X', seq: 1, date: '2026-10-01' })
    const { unitCost, move } = applyMovingAvgOut(testDb, AID, 'WK', 'K1', 2, { type: 'OO', no: 'OO-X', seq: 1, date: '2026-10-02' }, { allowNegative: true })
    expect(unitCost).toBe(0)
    expect(move.amount).toBe(0)
  })

  it('客供仓与普通仓之间不能调拨；客供仓其他入库必须填往来单位', () => {
    const tr = seedDoc('TR', 'TR-001', [{ item: 'R1', wh: 'WR', qty: 1 }], { wh: 'WR', dest: 'WK' })
    expect(callHandler(auditDocHandler, tr).body.message).toContain('不能调拨')
    const oi = seedDoc('OI', 'OI-002', [{ item: 'K1', wh: 'WK', qty: 1 }], { wh: 'WK' })
    expect(callHandler(auditDocHandler, oi).body.message).toContain('往来单位')
  })
})

describe('组装单 · 加工费含税（税率 13%：加工费 50、税额 6.5）', () => {
  beforeEach(() => { testDb = createDb(); seedBase() })
  const taxed = (): Line[] => [
    { item: 'FP', wh: 'WF', qty: 10, role: 'product', group: 1, fee: 5, rate: 13 },
    { item: 'R1', wh: 'WR', qty: 20, group: 1 },
  ]

  it('保存归一化：成品行按 数量 × 加工单价 × 税率 算税额与含税单价；子件行 / 自行组装清掉', () => {
    const lines: any[] = [
      { line_role: 'product', qty: 10, process_fee: 5, tax_rate: null, tax_amount: 999 },
      { line_role: null, qty: 20, tax_rate: 13, tax_amount: 3, price_with_tax: 1 },
    ]
    normalizeAssemblyFeeTax(lines, 'entrust', 13)
    expect(lines[0]).toMatchObject({ tax_rate: 13, tax_amount: 6.5, price_with_tax: 5.65 })
    expect(lines[1]).toMatchObject({ tax_rate: null, tax_amount: 0, price_with_tax: 0 })
    normalizeAssemblyFeeTax(lines, null, 13)
    expect(lines[0]).toMatchObject({ tax_rate: null, tax_amount: 0 })
  })

  it('委托加工：成本只计不含税加工费（250）；应付 = 价税合计 56.5；凭证 借进项税 6.5 / 贷应付 56.5', () => {
    const id = seedDoc('AS', 'AS-301', taxed(), { partner: SUPPLIER, mode: 'entrust' })
    expect(callHandler(auditDocHandler, id).body.code).toBe(0)
    expect(stock('WF', 'FP')).toMatchObject({ amount: 250 })
    expect(logs()).toEqual([expect.objectContaining({ amount: 56.5, arap_side: 'ap' })])
    const es = entriesOf(callHandler(genVoucherHandler, id).body.data.voucher_id)
    expect(sumSide(es, 'debit')).toBe(sumSide(es, 'credit'))
    expect(es).toEqual(expect.arrayContaining([
      expect.objectContaining({ account_code: '1406', direction: 'debit', amount: 250 }),
      expect.objectContaining({ account_code: '22210101', direction: 'debit', amount: 6.5 }),
      expect.objectContaining({ account_code: '2202', direction: 'credit', amount: 56.5 }),
    ]))
  })

  it('受托加工：应收 = 56.5；凭证 借应收 56.5 / 贷加工收入 50 / 贷销项税 6.5；对账单带税额', () => {
    const id = seedDoc('AS', 'AS-302', taxed(), { partner: CUSTOMER, mode: 'contract' })
    expect(callHandler(auditDocHandler, id).body.code).toBe(0)
    expect(logs()).toEqual([expect.objectContaining({ amount: 56.5, arap_side: 'ar' })])
    const es = entriesOf(callHandler(genVoucherHandler, id).body.data.voucher_id)
    expect(sumSide(es, 'debit')).toBe(sumSide(es, 'credit'))
    expect(es).toEqual(expect.arrayContaining([
      expect.objectContaining({ account_code: '1122', direction: 'debit', amount: 56.5 }),
      expect.objectContaining({ account_code: '6051', direction: 'credit', amount: 50 }),
      expect.objectContaining({ account_code: '22210105', direction: 'credit', amount: 6.5 }),
    ]))
    const ar = getStatementCandidates(testDb, AID, { direction: 'ar', partner_code: CUSTOMER, end_date: '2026-10-31' })
    expect(ar.rows).toEqual([expect.objectContaining({ amount: 50, tax_amount: 6.5, amount_with_tax: 56.5 })])
  })
})
