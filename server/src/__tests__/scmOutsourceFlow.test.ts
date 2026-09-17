/**
 * 委外主链全链路单元测试
 *   委外工单 → 委外发货(WO) → 委外入库(WI，含加工费与委外厂应付) → 生成凭证 → 反审核
 *
 * 委外与自制生产共用 getPlanCostSummary、PF/WI 审核分支、computeProductionPlanActionState，
 * 这里独立锁住委外侧的口径，避免改生产时把委外带坏。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import Database from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'

let testDb: Database.Database

vi.mock('../db/index.js', () => ({
  getDb: () => testDb,
}))

import {
  auditDocHandler,
  unauditDocHandler,
  genVoucherHandler,
  getPlanCostSummary,
} from '../routes/scmDoc.js'

const AID = 'AS-OUT'
const PLAN = 'PLAN-OUT'
const PRODUCT = 'PROD-FP'
const SUPPLIER = 'V001'

function createDb() {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE system_params (id TEXT, account_set_id TEXT, param_key TEXT, param_value TEXT);
    CREATE TABLE scm_item (id TEXT, account_set_id TEXT, code TEXT, name TEXT,
      batch_flag INTEGER DEFAULT 0, batch_out_mode TEXT, shelf_life_days INTEGER DEFAULT 0,
      serial_flag INTEGER DEFAULT 0, default_warehouse_code TEXT, inv_account TEXT);
    CREATE TABLE scm_partner (id TEXT, account_set_id TEXT, code TEXT, name TEXT,
      ap_account TEXT, ar_account TEXT, credit_days INTEGER DEFAULT 0, credit_limit REAL DEFAULT 0);
    CREATE TABLE scm_doc (id TEXT, account_set_id TEXT, doc_type TEXT, doc_no TEXT, status TEXT,
      doc_date TEXT, warehouse_code TEXT, partner_code TEXT, plan_id TEXT, bom_id TEXT,
      voucher_id TEXT, total_amount REAL, auditor TEXT, audited_at TEXT, updated_at TEXT,
      source_doc_id TEXT, settle_account TEXT, remark TEXT, created_at TEXT, due_date TEXT, credit_days INTEGER);
    CREATE TABLE scm_doc_line (id TEXT, account_set_id TEXT, doc_id TEXT, seq INTEGER, item_code TEXT,
      warehouse_code TEXT, qty REAL, price REAL, amount REAL, unit_cost REAL, tax_amount REAL DEFAULT 0,
      tax_rate REAL DEFAULT 0, labor_cost REAL DEFAULT 0, overhead_cost REAL DEFAULT 0, process_fee REAL DEFAULT 0,
      batch_no TEXT, serial_nos TEXT, source_line_id TEXT, field_values TEXT, line_role TEXT,
      product_group INTEGER, remark TEXT);
    CREATE TABLE scm_doc_type (account_set_id TEXT, code TEXT, category TEXT, direction TEXT, affects_stock INTEGER);
    CREATE TABLE scm_stock (id TEXT, account_set_id TEXT, warehouse_code TEXT, item_code TEXT,
      qty REAL DEFAULT 0, amount REAL DEFAULT 0, avg_cost REAL DEFAULT 0, updated_at TEXT);
    CREATE TABLE scm_stock_move (id TEXT, account_set_id TEXT, move_date TEXT, doc_type TEXT, doc_no TEXT,
      line_seq INTEGER, warehouse_code TEXT, item_code TEXT, direction TEXT, qty REAL, unit_cost REAL,
      amount REAL, batch_no TEXT, balance_qty REAL, balance_amount REAL, balance_avg_cost REAL);
    CREATE TABLE scm_ar_ap_log (currency TEXT, exchange_rate REAL NOT NULL DEFAULT 1, amount_fc REAL, verified_fc REAL NOT NULL DEFAULT 0, id TEXT, account_set_id TEXT, partner_code TEXT, doc_type TEXT, doc_no TEXT,
      doc_date TEXT, due_date TEXT, direction TEXT, amount REAL, verified_amount REAL DEFAULT 0,
      ar_account TEXT, ap_account TEXT, cashier_journal_id TEXT, remark TEXT);
    CREATE TABLE scm_ar_ap_verify (id TEXT, account_set_id TEXT, verify_no TEXT, in_log_id TEXT, out_log_id TEXT, amount REAL);
    CREATE TABLE cashier_journal (id TEXT, account_set_id TEXT);
    CREATE TABLE scm_production_plan (id TEXT, account_set_id TEXT, code TEXT, plan_type TEXT,
      status TEXT, plan_qty REAL DEFAULT 0, finished_qty REAL DEFAULT 0, scrap_qty REAL DEFAULT 0, bom_id TEXT,
      yl_warehouse TEXT, fp_warehouse TEXT, source_doc_id TEXT, supplier_code TEXT);
    CREATE TABLE scm_production_plan_product (id TEXT, account_set_id TEXT, plan_id TEXT, seq INTEGER,
      item_code TEXT, plan_qty REAL DEFAULT 0, finished_qty REAL DEFAULT 0, scrap_qty REAL DEFAULT 0,
      bom_id TEXT, fp_warehouse TEXT, labor_absorbed REAL DEFAULT 0, overhead_absorbed REAL DEFAULT 0,
      process_fee REAL DEFAULT 0, process_tax_rate REAL DEFAULT 0, source_line_id TEXT);
    CREATE TABLE scm_production_plan_line (id TEXT, account_set_id TEXT, plan_id TEXT, product_id TEXT,
      seq INTEGER, item_code TEXT, qty REAL, unit TEXT, scrap_rate REAL DEFAULT 0, warehouse_code TEXT);
    CREATE TABLE scm_work_report (id TEXT, account_set_id TEXT, plan_id TEXT, product_id TEXT,
      report_no TEXT, report_date TEXT, item_code TEXT, work_center_code TEXT, qty REAL DEFAULT 0,
      scrap_qty REAL DEFAULT 0, work_hours REAL DEFAULT 0, labor_amount REAL DEFAULT 0,
      overhead_amount REAL DEFAULT 0, status TEXT);
    CREATE TABLE scm_bom (id TEXT, account_set_id TEXT, code TEXT, item_code TEXT, status TEXT, is_default INTEGER DEFAULT 0);
    CREATE TABLE scm_bom_line (id TEXT, account_set_id TEXT, bom_id TEXT, seq INTEGER, item_code TEXT,
      qty REAL, scrap_rate REAL DEFAULT 0, line_type TEXT);
    CREATE TABLE scm_mrp_source (id TEXT, account_set_id TEXT, mrp_doc_id TEXT, source_kind TEXT, source_id TEXT);
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
    CREATE TABLE voucher_entries (currency_code TEXT, exchange_rate REAL, foreign_amount REAL, id TEXT, account_set_id TEXT, voucher_id TEXT, seq INTEGER,
      account_id TEXT, account_code TEXT, account_name TEXT, direction TEXT, amount REAL,
      amount_cents INTEGER, summary TEXT);
  `)
  return db
}

const DOC_TYPES: Array<[string, string, string]> = [
  ['WO', 'outsource', 'out'],
  ['WI', 'outsource', 'in'],
  ['PJ', 'production', 'in'],
]

const ACCOUNTS: Array<[string, string]> = [
  ['1403', '原材料'],
  ['1406', '库存商品'],
  ['5001', '生产成本'],
  ['2202', '应付账款'],
  ['22210101', '应交税费-进项税'],
]

/**
 * 基准场景：委外成品 FP 计划 10 件，每件耗 R1×2（原料仓 R1 100 件 @10）。
 * 每件料成本 20；加工费另议。
 */
function seedBase() {
  for (const [code, cat, dir] of DOC_TYPES) {
    testDb.prepare('INSERT INTO scm_doc_type (account_set_id,code,category,direction,affects_stock) VALUES (?,?,?,?,1)')
      .run(AID, code, cat, dir)
  }
  for (const [code, name] of ACCOUNTS) {
    testDb.prepare('INSERT INTO accounts (id,account_set_id,code,name) VALUES (?,?,?,?)').run(uuidv4(), AID, code, name)
  }
  testDb.prepare('INSERT INTO scm_item (id,account_set_id,code,name,inv_account) VALUES (?,?,?,?,?)')
    .run(uuidv4(), AID, 'R1', '原料甲', '1403')
  testDb.prepare('INSERT INTO scm_item (id,account_set_id,code,name,inv_account) VALUES (?,?,?,?,?)')
    .run(uuidv4(), AID, 'FP', '委外成品', '1406')
  testDb.prepare('INSERT INTO scm_partner (id,account_set_id,code,name,ap_account) VALUES (?,?,?,?,?)')
    .run(uuidv4(), AID, SUPPLIER, '甲委外厂', '2202')

  testDb.prepare('INSERT INTO scm_stock (id,account_set_id,warehouse_code,item_code,qty,amount,avg_cost) VALUES (?,?,?,?,?,?,?)')
    .run(uuidv4(), AID, 'WR', 'R1', 100, 1000, 10)

  testDb.prepare(
    "INSERT INTO scm_production_plan (id,account_set_id,code,plan_type,status,plan_qty,yl_warehouse,fp_warehouse,supplier_code)"
    + " VALUES (?,?,?,'outsource','released',10,'WR','WF',?)"
  ).run(PLAN, AID, 'OW-001', SUPPLIER)
  testDb.prepare(
    "INSERT INTO scm_production_plan_product (id,account_set_id,plan_id,seq,item_code,plan_qty,fp_warehouse,process_fee,process_tax_rate)"
    + " VALUES (?,?,?,1,'FP',10,'WF',5,13)"
  ).run(PRODUCT, AID, PLAN)
  testDb.prepare(
    "INSERT INTO scm_production_plan_line (id,account_set_id,plan_id,product_id,seq,item_code,qty,warehouse_code)"
    + " VALUES (?,?,?,?,1,'R1',2,'WR')"
  ).run(uuidv4(), AID, PLAN, PRODUCT)
}

function seedDoc(
  docType: string,
  docNo: string,
  headerWh: string | null,
  lines: Array<{ item: string; wh?: string | null; qty: number; process_fee?: number; tax_amount?: number }>,
  opts: { planId?: string | null; partner?: string | null } = {},
) {
  const docId = uuidv4()
  testDb.prepare(
    "INSERT INTO scm_doc (id,account_set_id,doc_type,doc_no,status,doc_date,warehouse_code,plan_id,partner_code,total_amount)"
    + " VALUES (?,?,?,?,'draft','2026-09-05',?,?,?,0)"
  ).run(docId, AID, docType, docNo, headerWh,
    opts.planId === undefined ? PLAN : opts.planId,
    opts.partner === undefined ? SUPPLIER : opts.partner)
  lines.forEach((l, i) => {
    testDb.prepare(
      "INSERT INTO scm_doc_line (id,account_set_id,doc_id,seq,item_code,warehouse_code,qty,price,amount,unit_cost,process_fee,tax_amount)"
      + " VALUES (?,?,?,?,?,?,?,0,0,0,?,?)"
    ).run(uuidv4(), AID, docId, i + 1, l.item, l.wh ?? headerWh, l.qty, l.process_fee ?? 0, l.tax_amount ?? 0)
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
  testDb.prepare('SELECT qty, amount, avg_cost FROM scm_stock WHERE account_set_id=? AND warehouse_code=? AND item_code=?')
    .get(AID, wh, item) as any
const productRow = () =>
  testDb.prepare('SELECT finished_qty, scrap_qty, labor_absorbed, overhead_absorbed FROM scm_production_plan_product WHERE id=?')
    .get(PRODUCT) as any
const apLogs = () =>
  testDb.prepare('SELECT partner_code, doc_type, doc_no, direction, amount, ap_account, remark FROM scm_ar_ap_log WHERE account_set_id=?')
    .all(AID) as any[]
const entriesOf = (voucherId: string) =>
  testDb.prepare('SELECT account_code, direction, amount FROM voucher_entries WHERE voucher_id=? ORDER BY seq')
    .all(voucherId) as any[]
const costSummary = () => getPlanCostSummary(testDb as any, AID, PLAN, 0)

/** 标准委外发货：R1 20 件 @10 = 200 */
const shipMaterials = () =>
  callHandler(auditDocHandler, seedDoc('WO', 'WO-001', 'WR', [{ item: 'R1', qty: 20 }]))

describe('委外发货(WO) 审核', () => {
  beforeEach(() => { testDb = createDb(); seedBase() })

  it('按移动均价扣减原料仓，归集到工单成本', () => {
    const wo = seedDoc('WO', 'WO-001', 'WR', [{ item: 'R1', qty: 20 }])
    expect(callHandler(auditDocHandler, wo).body.code).toBe(0)

    expect(stock('WR', 'R1')).toMatchObject({ qty: 80, amount: 800, avg_cost: 10 })
    const sum = costSummary()
    expect(sum.issuedCost).toBe(200)
    expect(sum.wip).toBe(200)
    expect(sum.issueUnitCost.get('R1')).toBe(10)
  })

  it('委外单据只能关联委外工单', () => {
    testDb.prepare("UPDATE scm_production_plan SET plan_type='self' WHERE id=?").run(PLAN)
    const wo = seedDoc('WO', 'WO-002', 'WR', [{ item: 'R1', qty: 1 }])
    const res = callHandler(auditDocHandler, wo)
    expect(res.statusCode).toBe(400)
    expect(res.body.message).toContain('委外单据只能关联委外工单')
  })

  it('超出工单用量被超领校验拦下', () => {
    const wo = seedDoc('WO', 'WO-003', 'WR', [{ item: 'R1', qty: 99 }])
    const res = callHandler(auditDocHandler, wo)
    expect(res.statusCode).toBe(400)
    expect(res.body.message).toContain('禁止超领')
    expect(stock('WR', 'R1').qty).toBe(100)
  })

  it('生成凭证：料投入在制，借 生产成本 / 贷 原材料', () => {
    const wo = seedDoc('WO', 'WO-001', 'WR', [{ item: 'R1', qty: 20 }])
    callHandler(auditDocHandler, wo)
    const res = callHandler(genVoucherHandler, wo)

    expect(res.body.code).toBe(0)
    expect(entriesOf(res.body.data.voucher_id)).toEqual([
      { account_code: '5001', direction: 'debit', amount: 200 },
      { account_code: '1403', direction: 'credit', amount: 200 },
    ])
  })

  it('反审核回退原料库存与工单成本', () => {
    const wo = seedDoc('WO', 'WO-001', 'WR', [{ item: 'R1', qty: 20 }])
    callHandler(auditDocHandler, wo)
    expect(callHandler(unauditDocHandler, wo).body.code).toBe(0)

    expect(stock('WR', 'R1')).toMatchObject({ qty: 100, amount: 1000 })
    expect(costSummary().issuedCost).toBe(0)
  })
})

describe('委外入库(WI) 审核', () => {
  beforeEach(() => { testDb = createDb(); seedBase() })

  it('未发料时拒绝委外入库', () => {
    const wi = seedDoc('WI', 'WI-001', 'WF', [{ item: 'FP', qty: 10, process_fee: 5, tax_amount: 6.5 }])
    const res = callHandler(auditDocHandler, wi)
    expect(res.statusCode).toBe(400)
    // 齐套校验先于成本校验触发
    expect(res.body.message).toMatch(/未齐套|尚未委外发货归集成本/)
  })

  it('成品成本 = 料上卷 + 加工费，末批吸收全部料在制', () => {
    shipMaterials()
    const wi = seedDoc('WI', 'WI-001', 'WF', [{ item: 'FP', qty: 10, process_fee: 5, tax_amount: 6.5 }])
    expect(callHandler(auditDocHandler, wi).body.code).toBe(0)

    // 料 200（每件 R1×2×10 = 20）+ 加工费 5/件 → 单价 25
    expect(stock('WF', 'FP')).toMatchObject({ qty: 10, amount: 250, avg_cost: 25 })
    expect(productRow()).toMatchObject({ finished_qty: 10 })
    // 委外没有人工/制费，不应吸收任何金额
    expect(productRow()).toMatchObject({ labor_absorbed: 0, overhead_absorbed: 0 })
    expect(costSummary().wip).toBe(0)
  })

  it('加工费（含税）生成委外厂应付台账', () => {
    shipMaterials()
    const wi = seedDoc('WI', 'WI-001', 'WF', [{ item: 'FP', qty: 10, process_fee: 5, tax_amount: 6.5 }])
    callHandler(auditDocHandler, wi)

    const logs = apLogs()
    expect(logs).toHaveLength(1)
    expect(logs[0]).toMatchObject({
      partner_code: SUPPLIER, doc_type: 'WI', doc_no: 'WI-001',
      amount: 56.5, ap_account: '2202',
    })
    expect(logs[0].remark).toContain('委外加工费')
    expect(logs[0].remark).toContain('6.5')
  })

  it('加工费为 0 时不挂应付', () => {
    shipMaterials()
    const wi = seedDoc('WI', 'WI-001', 'WF', [{ item: 'FP', qty: 10 }])
    expect(callHandler(auditDocHandler, wi).body.code).toBe(0)
    expect(apLogs()).toHaveLength(0)
    expect(stock('WF', 'FP')).toMatchObject({ qty: 10, amount: 200, avg_cost: 20 })
  })

  it('生成凭证：借 存货 + 进项税 / 贷 生产成本(料) + 应付(加工费含税)', () => {
    shipMaterials()
    const wi = seedDoc('WI', 'WI-001', 'WF', [{ item: 'FP', qty: 10, process_fee: 5, tax_amount: 6.5 }])
    callHandler(auditDocHandler, wi)
    const res = callHandler(genVoucherHandler, wi)

    expect(res.body.code).toBe(0)
    const entries = entriesOf(res.body.data.voucher_id)
    expect(entries).toEqual([
      { account_code: '1406', direction: 'debit', amount: 250 },
      { account_code: '5001', direction: 'credit', amount: 200 },
      { account_code: '22210101', direction: 'debit', amount: 6.5 },
      { account_code: '2202', direction: 'credit', amount: 56.5 },
    ])
    // 借贷平衡：250 + 6.5 = 200 + 56.5
    const debit = entries.filter(e => e.direction === 'debit').reduce((s, e) => s + e.amount, 0)
    const credit = entries.filter(e => e.direction === 'credit').reduce((s, e) => s + e.amount, 0)
    expect(debit).toBeCloseTo(credit, 2)
  })

  it('分批入库：首批只吸收本批料成本，在制留余额', () => {
    shipMaterials()
    const wi = seedDoc('WI', 'WI-001', 'WF', [{ item: 'FP', qty: 4, process_fee: 5, tax_amount: 2.6 }])
    expect(callHandler(auditDocHandler, wi).body.code).toBe(0)

    // 料 4×20=80 + 加工费 4×5=20 → 100，单价 25
    expect(stock('WF', 'FP')).toMatchObject({ qty: 4, amount: 100, avg_cost: 25 })
    expect(costSummary().wip).toBe(120)
  })

  it('反审核完整回退：成品库存、完工数、委外厂应付', () => {
    shipMaterials()
    const wi = seedDoc('WI', 'WI-001', 'WF', [{ item: 'FP', qty: 10, process_fee: 5, tax_amount: 6.5 }])
    callHandler(auditDocHandler, wi)
    expect(apLogs()).toHaveLength(1)

    expect(callHandler(unauditDocHandler, wi).body.code).toBe(0)
    expect(stock('WF', 'FP')).toMatchObject({ qty: 0, amount: 0 })
    expect(productRow()).toMatchObject({ finished_qty: 0 })
    expect(apLogs()).toHaveLength(0)
    expect(costSummary().wip).toBe(200)
  })

  it('超出计划数的委外入库被拦', () => {
    shipMaterials()
    const wi = seedDoc('WI', 'WI-001', 'WF', [{ item: 'FP', qty: 11 }])
    const res = callHandler(auditDocHandler, wi)
    expect(res.statusCode).toBe(400)
    expect(res.body.message).toContain('禁止超完工')
  })
})

describe('委外与自制的口径隔离', () => {
  beforeEach(() => { testDb = createDb(); seedBase() })

  it('委外工单的完工数只与 WI 计数，不与自制 PF/PS 混算', () => {
    shipMaterials()
    // 委外计划下先入 6 件
    callHandler(auditDocHandler, seedDoc('WI', 'WI-001', 'WF', [{ item: 'FP', qty: 6 }]))
    expect(productRow().finished_qty).toBe(6)
    // 再入 4 件正好满额
    const second = seedDoc('WI', 'WI-002', 'WF', [{ item: 'FP', qty: 4 }])
    expect(callHandler(auditDocHandler, second).body.code).toBe(0)
    expect(productRow().finished_qty).toBe(10)
    expect(costSummary().wip).toBe(0)
  })

  it('委外入库不吸收人工制费（即使工单下挂了报工）', () => {
    shipMaterials()
    testDb.prepare(
      "INSERT INTO scm_work_report (id,account_set_id,plan_id,product_id,report_no,report_date,item_code,qty,work_hours,labor_amount,overhead_amount,status)"
      + " VALUES (?,?,?,?,'WR-1','2026-09-05','FP',10,10,30,20,'audited')"
    ).run(uuidv4(), AID, PLAN, PRODUCT)

    const wi = seedDoc('WI', 'WI-001', 'WF', [{ item: 'FP', qty: 10 }])
    expect(callHandler(auditDocHandler, wi).body.code).toBe(0)
    // 成品成本只含料，不含报工的人工/制费
    expect(stock('WF', 'FP')).toMatchObject({ qty: 10, amount: 200, avg_cost: 20 })
    expect(productRow()).toMatchObject({ labor_absorbed: 0, overhead_absorbed: 0 })
  })
})
