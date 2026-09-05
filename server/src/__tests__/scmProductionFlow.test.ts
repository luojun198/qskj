/**
 * 生产制造主链全链路单元测试
 *   工单 → 领料(PL) → 补料(PB) → 退料(PJ) → 报工 → 完工入库(PF) → 生成凭证 → 反审核
 *
 * 直接调用 routes/scmDoc.ts 导出的 handler，getDb 通过 vi.mock 指向内存库。
 * 写法与 scmTransferStockCheckAudit.test.ts / scmPaymentGenVoucher.test.ts 一致。
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

const AID = 'AS-PROD'
const PLAN = 'PLAN-1'
const PRODUCT = 'PROD-FP'

function createDb() {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE system_params (id TEXT, account_set_id TEXT, param_key TEXT, param_value TEXT);
    CREATE TABLE scm_item (id TEXT, account_set_id TEXT, code TEXT, name TEXT,
      batch_flag INTEGER DEFAULT 0, batch_out_mode TEXT, shelf_life_days INTEGER DEFAULT 0,
      serial_flag INTEGER DEFAULT 0, default_warehouse_code TEXT, inv_account TEXT);
    CREATE TABLE scm_doc (id TEXT, account_set_id TEXT, doc_type TEXT, doc_no TEXT, status TEXT,
      doc_date TEXT, warehouse_code TEXT, partner_code TEXT, plan_id TEXT, bom_id TEXT,
      voucher_id TEXT, total_amount REAL, auditor TEXT, audited_at TEXT, updated_at TEXT,
      source_doc_id TEXT, settle_account TEXT, remark TEXT, created_at TEXT);
    CREATE TABLE scm_doc_line (id TEXT, account_set_id TEXT, doc_id TEXT, seq INTEGER, item_code TEXT,
      warehouse_code TEXT, qty REAL, price REAL, amount REAL, unit_cost REAL, tax_amount REAL DEFAULT 0,
      labor_cost REAL DEFAULT 0, overhead_cost REAL DEFAULT 0, process_fee REAL DEFAULT 0,
      batch_no TEXT, serial_nos TEXT, source_line_id TEXT, field_values TEXT, line_role TEXT,
      product_group INTEGER, remark TEXT);
    CREATE TABLE scm_doc_type (account_set_id TEXT, code TEXT, category TEXT, direction TEXT, affects_stock INTEGER);
    CREATE TABLE scm_stock (id TEXT, account_set_id TEXT, warehouse_code TEXT, item_code TEXT,
      qty REAL DEFAULT 0, amount REAL DEFAULT 0, avg_cost REAL DEFAULT 0, updated_at TEXT);
    CREATE TABLE scm_stock_move (id TEXT, account_set_id TEXT, move_date TEXT, doc_type TEXT, doc_no TEXT,
      line_seq INTEGER, warehouse_code TEXT, item_code TEXT, direction TEXT, qty REAL, unit_cost REAL,
      amount REAL, batch_no TEXT, balance_qty REAL, balance_amount REAL, balance_avg_cost REAL);
    CREATE TABLE scm_ar_ap_log (id TEXT, account_set_id TEXT, doc_no TEXT, verified_amount REAL DEFAULT 0);
    CREATE TABLE scm_ar_ap_verify (id TEXT, account_set_id TEXT, verify_no TEXT, in_log_id TEXT, out_log_id TEXT);
    CREATE TABLE scm_production_plan (id TEXT, account_set_id TEXT, code TEXT, plan_type TEXT,
      status TEXT, plan_qty REAL DEFAULT 0, finished_qty REAL DEFAULT 0, scrap_qty REAL DEFAULT 0, bom_id TEXT,
      yl_warehouse TEXT, fp_warehouse TEXT, source_doc_id TEXT);
    CREATE TABLE scm_production_plan_product (id TEXT, account_set_id TEXT, plan_id TEXT, seq INTEGER,
      item_code TEXT, plan_qty REAL DEFAULT 0, finished_qty REAL DEFAULT 0, scrap_qty REAL DEFAULT 0,
      bom_id TEXT, fp_warehouse TEXT, labor_absorbed REAL DEFAULT 0, overhead_absorbed REAL DEFAULT 0,
      process_fee REAL DEFAULT 0, source_line_id TEXT);
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
    CREATE TABLE voucher_entries (id TEXT, account_set_id TEXT, voucher_id TEXT, seq INTEGER,
      account_id TEXT, account_code TEXT, account_name TEXT, direction TEXT, amount REAL,
      amount_cents INTEGER, summary TEXT);
  `)
  return db
}

const DOC_TYPES: Array<[string, string, string]> = [
  ['PL', 'production', 'out'],
  ['PB', 'production', 'out'],
  ['PJ', 'production', 'in'],
  ['PF', 'production', 'in'],
  ['PS', 'production', 'in'],
  ['AS', 'production', 'none'],
]

const ACCOUNTS: Array<[string, string]> = [
  ['1405', '库存商品'],
  ['5001', '生产成本'],
  ['2211', '应付职工薪酬'],
  ['5101', '制造费用'],
  ['1403', '原材料'],
]

/**
 * 基准场景：成品 FP 计划 10 件，每件耗 R1×2 + R2×1（每件料成本 2×10 + 1×5 = 25）。
 * 原料仓 WR：R1 100 件 @10、R2 100 件 @5。
 */
function seedBase() {
  for (const [code, cat, dir] of DOC_TYPES) {
    testDb.prepare('INSERT INTO scm_doc_type (account_set_id,code,category,direction,affects_stock) VALUES (?,?,?,?,1)')
      .run(AID, code, cat, dir)
  }
  for (const [code, name] of ACCOUNTS) {
    testDb.prepare('INSERT INTO accounts (id,account_set_id,code,name) VALUES (?,?,?,?)').run(uuidv4(), AID, code, name)
  }
  const item = (code: string, name: string) =>
    testDb.prepare('INSERT INTO scm_item (id,account_set_id,code,name,inv_account) VALUES (?,?,?,?,?)')
      .run(uuidv4(), AID, code, name, '1405')
  item('R1', '原料甲')
  item('R2', '原料乙')
  item('FP', '成品')

  const stockIn = (wh: string, code: string, qty: number, cost: number) =>
    testDb.prepare('INSERT INTO scm_stock (id,account_set_id,warehouse_code,item_code,qty,amount,avg_cost) VALUES (?,?,?,?,?,?,?)')
      .run(uuidv4(), AID, wh, code, qty, qty * cost, cost)
  stockIn('WR', 'R1', 100, 10)
  stockIn('WR', 'R2', 100, 5)

  testDb.prepare(
    "INSERT INTO scm_production_plan (id,account_set_id,code,plan_type,status,plan_qty,yl_warehouse,fp_warehouse)"
    + " VALUES (?,?,?,'self','released',10,'WR','WF')"
  ).run(PLAN, AID, 'WO-001')
  testDb.prepare(
    "INSERT INTO scm_production_plan_product (id,account_set_id,plan_id,seq,item_code,plan_qty,fp_warehouse)"
    + " VALUES (?,?,?,1,'FP',10,'WF')"
  ).run(PRODUCT, AID, PLAN)
  const planLine = (seq: number, code: string, qty: number) =>
    testDb.prepare(
      "INSERT INTO scm_production_plan_line (id,account_set_id,plan_id,product_id,seq,item_code,qty,warehouse_code)"
      + " VALUES (?,?,?,?,?,?,?,'WR')"
    ).run(uuidv4(), AID, PLAN, PRODUCT, seq, code, qty)
  planLine(1, 'R1', 2)
  planLine(2, 'R2', 1)
}

function seedDoc(
  docType: string,
  docNo: string,
  headerWh: string | null,
  lines: Array<{ item: string; wh?: string | null; qty: number; price?: number; unit_cost?: number }>,
  opts: { planId?: string | null } = {},
) {
  const docId = uuidv4()
  testDb.prepare(
    "INSERT INTO scm_doc (id,account_set_id,doc_type,doc_no,status,doc_date,warehouse_code,plan_id,total_amount)"
    + " VALUES (?,?,?,?,'draft','2026-09-04',?,?,0)"
  ).run(docId, AID, docType, docNo, headerWh, opts.planId === undefined ? PLAN : opts.planId)
  lines.forEach((l, i) => {
    const price = l.price ?? 0
    testDb.prepare(
      "INSERT INTO scm_doc_line (id,account_set_id,doc_id,seq,item_code,warehouse_code,qty,price,amount,unit_cost)"
      + " VALUES (?,?,?,?,?,?,?,?,?,?)"
    ).run(uuidv4(), AID, docId, i + 1, l.item, l.wh ?? headerWh, l.qty, price, l.qty * price, l.unit_cost ?? 0)
  })
  return docId
}

/** 已审核报工：工时 × 工作中心费率算好的人工/制费金额 */
function seedWorkReport(labor: number, overhead: number) {
  testDb.prepare(
    "INSERT INTO scm_work_report (id,account_set_id,plan_id,product_id,report_no,report_date,item_code,qty,work_hours,labor_amount,overhead_amount,status)"
    + " VALUES (?,?,?,?,'WR-001','2026-09-04','FP',10,10,?,?,'audited')"
  ).run(uuidv4(), AID, PLAN, PRODUCT, labor, overhead)
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
const entriesOf = (voucherId: string) =>
  testDb.prepare('SELECT account_code, direction, amount FROM voucher_entries WHERE voucher_id=? ORDER BY seq')
    .all(voucherId) as any[]
const costSummary = () => getPlanCostSummary(testDb as any, AID, PLAN, 0)

/** 标准领料：R1 20 + R2 10 = 250 元 */
const issueMaterials = () =>
  callHandler(auditDocHandler, seedDoc('PL', 'PL-001', 'WR', [{ item: 'R1', qty: 20 }, { item: 'R2', qty: 10 }]))

describe('生产领料(PL) 审核', () => {
  beforeEach(() => { testDb = createDb(); seedBase() })

  it('按移动均价扣减原料仓，并回写行成本', () => {
    const pl = seedDoc('PL', 'PL-001', 'WR', [{ item: 'R1', qty: 20 }, { item: 'R2', qty: 10 }])
    const res = callHandler(auditDocHandler, pl)

    expect(res.body.code).toBe(0)
    expect(stock('WR', 'R1')).toMatchObject({ qty: 80, amount: 800, avg_cost: 10 })
    expect(stock('WR', 'R2')).toMatchObject({ qty: 90, amount: 450, avg_cost: 5 })
    expect(testDb.prepare('SELECT item_code, unit_cost FROM scm_doc_line WHERE doc_id=? ORDER BY seq').all(pl)).toEqual([
      { item_code: 'R1', unit_cost: 10 },
      { item_code: 'R2', unit_cost: 5 },
    ])
  })

  it('归集到工单成本：已领料 250、在制 250、各料领用单价可用于上卷', () => {
    issueMaterials()
    const sum = costSummary()
    expect(sum.issuedCost).toBe(250)
    expect(sum.wip).toBe(250)
    expect(sum.issueUnitCost.get('R1')).toBe(10)
    expect(sum.issueUnitCost.get('R2')).toBe(5)
  })

  it('超出工单用量时先被超领校验拦下，库存不变', () => {
    const pl = seedDoc('PL', 'PL-002', 'WR', [{ item: 'R1', qty: 999 }])
    const res = callHandler(auditDocHandler, pl)
    expect(res.statusCode).toBe(400)
    expect(res.body.message).toContain('禁止超领')
    expect(stock('WR', 'R1').qty).toBe(100)
  })

  it('用量之内但原料库存不足时整单拒绝，库存不变', () => {
    testDb.prepare('UPDATE scm_stock SET qty=5, amount=50 WHERE account_set_id=? AND warehouse_code=? AND item_code=?')
      .run(AID, 'WR', 'R1')
    const pl = seedDoc('PL', 'PL-003', 'WR', [{ item: 'R1', qty: 20 }])
    const res = callHandler(auditDocHandler, pl)

    expect(res.statusCode).toBe(400)
    expect(res.body.message).toContain('库存不足')
    expect(stock('WR', 'R1')).toMatchObject({ qty: 5, amount: 50 })
  })

  it('同物料同仓拆多行时按合计校验库存，报出的可用量与库存页一致', () => {
    testDb.prepare('UPDATE scm_stock SET qty=15, amount=150 WHERE account_set_id=? AND warehouse_code=? AND item_code=?')
      .run(AID, 'WR', 'R1')
    // 两行各 10 件：逐行看都够（15≥10），合计 20 才超
    const pl = seedDoc('PL', 'PL-005', 'WR', [{ item: 'R1', qty: 10 }, { item: 'R1', qty: 10 }])
    const res = callHandler(auditDocHandler, pl)

    expect(res.statusCode).toBe(400)
    expect(res.body.message).toContain('库存不足')
    expect(res.body.message).toContain('当前 15')
    expect(res.body.message).toContain('需 20')
    expect(stock('WR', 'R1')).toMatchObject({ qty: 15, amount: 150 })
  })

  it('必须关联已审核工单', () => {
    const pl = seedDoc('PL', 'PL-004', 'WR', [{ item: 'R1', qty: 1 }], { planId: null })
    const res = callHandler(auditDocHandler, pl)
    expect(res.statusCode).toBe(400)
    expect(res.body.message).toContain('必须关联已审核工单')
  })

  it('生成凭证：借 生产成本 / 贷 存货', () => {
    const pl = seedDoc('PL', 'PL-001', 'WR', [{ item: 'R1', qty: 20 }, { item: 'R2', qty: 10 }])
    callHandler(auditDocHandler, pl)
    const res = callHandler(genVoucherHandler, pl)

    expect(res.body.code).toBe(0)
    expect(entriesOf(res.body.data.voucher_id)).toEqual([
      { account_code: '5001', direction: 'debit', amount: 250 },
      { account_code: '1405', direction: 'credit', amount: 250 },
    ])
  })

  it('反审核回退原料库存与工单成本', () => {
    const pl = seedDoc('PL', 'PL-001', 'WR', [{ item: 'R1', qty: 20 }, { item: 'R2', qty: 10 }])
    callHandler(auditDocHandler, pl)
    const res = callHandler(unauditDocHandler, pl)

    expect(res.body.code).toBe(0)
    expect(stock('WR', 'R1')).toMatchObject({ qty: 100, amount: 1000 })
    expect(stock('WR', 'R2')).toMatchObject({ qty: 100, amount: 500 })
    expect(costSummary().issuedCost).toBe(0)
  })
})

describe('完工入库(PF) 审核', () => {
  beforeEach(() => { testDb = createDb(); seedBase() })

  it('未领料时被齐套校验拦下，不产生成品库存', () => {
    const pf = seedDoc('PF', 'PF-001', 'WF', [{ item: 'FP', qty: 10 }])
    const res = callHandler(auditDocHandler, pf)
    expect(res.statusCode).toBe(400)
    expect(res.body.message).toContain('未齐套')
    expect(stock('WF', 'FP')).toBeUndefined()
  })

  it('必须关联已审核工单', () => {
    const pf = seedDoc('PF', 'PF-900', 'WF', [{ item: 'FP', qty: 2 }], { planId: null })
    const res = callHandler(auditDocHandler, pf)
    expect(res.statusCode).toBe(400)
    expect(res.body.message).toContain('必须关联已审核工单')
  })

  it('末批完工：料成本按 BOM 上卷 + 报工人工制费，在制归零', () => {
    issueMaterials()
    seedWorkReport(30, 20)
    const pf = seedDoc('PF', 'PF-001', 'WF', [{ item: 'FP', qty: 10 }])
    const res = callHandler(auditDocHandler, pf)

    expect(res.body.code).toBe(0)
    // 料 250（25/件）+ 人工 30 + 制费 20 = 300 → 单价 30
    expect(stock('WF', 'FP')).toMatchObject({ qty: 10, amount: 300, avg_cost: 30 })
    expect(testDb.prepare('SELECT unit_cost, labor_cost, overhead_cost FROM scm_doc_line WHERE doc_id=?').get(pf))
      .toMatchObject({ unit_cost: 30, labor_cost: 30, overhead_cost: 20 })
    expect(productRow()).toMatchObject({ finished_qty: 10, labor_absorbed: 30, overhead_absorbed: 20 })

    const sum = costSummary()
    expect(sum.wip).toBe(0)
    expect(sum.laborWip).toBe(0)
  })

  it('分批完工：首批按进度暂提人工制费，在制留存余额', () => {
    issueMaterials()
    seedWorkReport(30, 20)
    const pf = seedDoc('PF', 'PF-001', 'WF', [{ item: 'FP', qty: 4 }])
    expect(callHandler(auditDocHandler, pf).body.code).toBe(0)

    // 料 4×25=100；人工 4×30/10=12；制费 4×20/10=8 → 单价 (100+12+8)/4=30
    expect(stock('WF', 'FP')).toMatchObject({ qty: 4, amount: 120, avg_cost: 30 })
    expect(productRow()).toMatchObject({ finished_qty: 4, labor_absorbed: 12, overhead_absorbed: 8 })
    const sum = costSummary()
    expect(sum.wip).toBe(150)
    expect(sum.laborWip).toBe(30)
  })

  it('生成凭证：借 存货 / 贷 生产成本(料) + 应付职工薪酬(人工) + 制造费用(制费)', () => {
    issueMaterials()
    seedWorkReport(30, 20)
    const pf = seedDoc('PF', 'PF-001', 'WF', [{ item: 'FP', qty: 10 }])
    callHandler(auditDocHandler, pf)
    const res = callHandler(genVoucherHandler, pf)

    expect(res.body.code).toBe(0)
    expect(entriesOf(res.body.data.voucher_id)).toEqual([
      { account_code: '1405', direction: 'debit', amount: 300 },
      { account_code: '5001', direction: 'credit', amount: 250 },
      { account_code: '2211', direction: 'credit', amount: 30 },
      { account_code: '5101', direction: 'credit', amount: 20 },
    ])
  })

  it('反审核完整回退：成品库存、完工数、已吸收人工制费', () => {
    issueMaterials()
    seedWorkReport(30, 20)
    const pf = seedDoc('PF', 'PF-001', 'WF', [{ item: 'FP', qty: 10 }])
    callHandler(auditDocHandler, pf)
    const res = callHandler(unauditDocHandler, pf)

    expect(res.body.code).toBe(0)
    expect(stock('WF', 'FP')).toMatchObject({ qty: 0, amount: 0 })
    expect(productRow()).toMatchObject({ finished_qty: 0, labor_absorbed: 0, overhead_absorbed: 0 })
    expect(costSummary().wip).toBe(250)
  })

  it('已生成凭证的单据禁止反审核', () => {
    issueMaterials()
    const pf = seedDoc('PF', 'PF-001', 'WF', [{ item: 'FP', qty: 10 }])
    callHandler(auditDocHandler, pf)
    callHandler(genVoucherHandler, pf)
    const res = callHandler(unauditDocHandler, pf)

    expect(res.statusCode).toBe(400)
    expect(res.body.message).toContain('已生成记账凭证')
  })
})

describe('补料(PB) / 退料(PJ)', () => {
  beforeEach(() => { testDb = createDb(); seedBase() })

  it('补料累加进已领料成本', () => {
    // 先少领 5 件 R1（15/20），再用补料单补齐，合计不触发超领拦截
    callHandler(auditDocHandler, seedDoc('PL', 'PL-001', 'WR', [{ item: 'R1', qty: 15 }, { item: 'R2', qty: 10 }]))
    expect(costSummary().issuedCost).toBe(200)

    const pb = seedDoc('PB', 'PB-001', 'WR', [{ item: 'R1', qty: 5 }])
    expect(callHandler(auditDocHandler, pb).body.code).toBe(0)
    expect(stock('WR', 'R1').qty).toBe(80)
    expect(costSummary().issuedCost).toBe(250)
  })

  it('退料按领用单价回冲，不稀释原料仓均价、不抬高工单料单价', () => {
    issueMaterials()
    const pj = seedDoc('PJ', 'PJ-001', 'WR', [{ item: 'R1', qty: 5 }])
    expect(callHandler(auditDocHandler, pj).body.code).toBe(0)

    // 退回 5 件 R1 应按领用单价 10 计 50 元
    expect(stock('WR', 'R1')).toMatchObject({ qty: 85, amount: 850, avg_cost: 10 })
    const sum = costSummary()
    expect(sum.issuedCost).toBe(200)
    expect(sum.issueUnitCost.get('R1')).toBe(10)
  })

  it('退料反审核后工单成本回到领料原值', () => {
    issueMaterials()
    const pj = seedDoc('PJ', 'PJ-001', 'WR', [{ item: 'R1', qty: 5 }])
    callHandler(auditDocHandler, pj)
    expect(callHandler(unauditDocHandler, pj).body.code).toBe(0)

    expect(stock('WR', 'R1')).toMatchObject({ qty: 80, amount: 800, avg_cost: 10 })
    expect(costSummary().issuedCost).toBe(250)
  })
})

describe('组装单(AS) 成品行模式', () => {
  beforeEach(() => {
    testDb = createDb()
    seedBase()
    // 子件走「原材料」、成品走「库存商品」，两个存货科目才能看出分录方向
    testDb.prepare("UPDATE scm_item SET inv_account='1403' WHERE account_set_id=? AND code IN ('R1','R2')").run(AID)
  })

  /** 子件 R1 10@10 + R2 5@5 = 125 元 → 成品 FP 5 件，单价 25 */
  function seedAssembly() {
    const docId = uuidv4()
    testDb.prepare(
      "INSERT INTO scm_doc (id,account_set_id,doc_type,doc_no,status,doc_date,warehouse_code,plan_id,total_amount)"
      + " VALUES (?,?,'AS','AS-001','draft','2026-09-04','WR',NULL,0)"
    ).run(docId, AID)
    const line = (seq: number, item: string, wh: string, qty: number, role: string | null) =>
      testDb.prepare(
        "INSERT INTO scm_doc_line (id,account_set_id,doc_id,seq,item_code,warehouse_code,qty,price,amount,unit_cost,line_role)"
        + " VALUES (?,?,?,?,?,?,?,0,0,0,?)"
      ).run(uuidv4(), AID, docId, seq, item, wh, qty, role)
    line(1, 'R1', 'WR', 10, null)
    line(2, 'R2', 'WR', 5, null)
    line(3, 'FP', 'WF', 5, 'product')
    return docId
  }

  it('审核：子件按均价出库，成品按归集成本入库', () => {
    const as = seedAssembly()
    expect(callHandler(auditDocHandler, as).body.code).toBe(0)

    expect(stock('WR', 'R1')).toMatchObject({ qty: 90, amount: 900 })
    expect(stock('WR', 'R2')).toMatchObject({ qty: 95, amount: 475 })
    expect(stock('WF', 'FP')).toMatchObject({ qty: 5, amount: 125, avg_cost: 25 })
  })

  it('生成凭证：成品行按入库方向记账，无 BOM 也能出凭证', () => {
    const as = seedAssembly()
    callHandler(auditDocHandler, as)
    const res = callHandler(genVoucherHandler, as)

    expect(res.body.code).toBe(0)
    // 子件消耗：贷 原材料 125 / 借 生产成本 125；成品入库：借 库存商品 125 / 贷 生产成本 125
    expect(entriesOf(res.body.data.voucher_id)).toEqual([
      { account_code: '1403', direction: 'credit', amount: 125 },
      { account_code: '5001', direction: 'debit', amount: 125 },
      { account_code: '5001', direction: 'credit', amount: 125 },
      { account_code: '1405', direction: 'debit', amount: 125 },
    ])
  })

  it('反审核回退子件与成品库存', () => {
    const as = seedAssembly()
    callHandler(auditDocHandler, as)
    expect(callHandler(unauditDocHandler, as).body.code).toBe(0)

    expect(stock('WR', 'R1')).toMatchObject({ qty: 100, amount: 1000 })
    expect(stock('WR', 'R2')).toMatchObject({ qty: 100, amount: 500 })
    expect(stock('WF', 'FP')).toMatchObject({ qty: 0, amount: 0 })
  })
})

describe('不良品入库(PS)', () => {
  beforeEach(() => { testDb = createDb(); seedBase() })

  it('按工单料成本上卷入不良品仓，回写报废数并冲减在制', () => {
    issueMaterials()
    const ps = seedDoc('PS', 'PS-001', 'WD', [{ item: 'FP', qty: 2 }])
    const res = callHandler(auditDocHandler, ps)

    expect(res.body.code).toBe(0)
    // 每件料成本 25 → 2 件不良品 50 元，不再是手工价 0
    expect(stock('WD', 'FP')).toMatchObject({ qty: 2, amount: 50, avg_cost: 25 })
    expect(productRow()).toMatchObject({ finished_qty: 0, scrap_qty: 2 })
    expect(costSummary().wip).toBe(200)
  })

  it('完工 + 不良合计达到计划数时，末批吸收全部料在制', () => {
    issueMaterials()
    callHandler(auditDocHandler, seedDoc('PS', 'PS-001', 'WD', [{ item: 'FP', qty: 2 }]))
    const pf = seedDoc('PF', 'PF-001', 'WF', [{ item: 'FP', qty: 8 }])
    expect(callHandler(auditDocHandler, pf).body.code).toBe(0)

    expect(productRow()).toMatchObject({ finished_qty: 8, scrap_qty: 2 })
    // 料在制 200 全部由末批合格品吸收 → 成品单价 200/8 = 25
    expect(stock('WF', 'FP')).toMatchObject({ qty: 8, amount: 200, avg_cost: 25 })
    expect(costSummary().wip).toBe(0)
  })

  it('完工 + 不良合计超过计划数时被拦截', () => {
    issueMaterials()
    callHandler(auditDocHandler, seedDoc('PS', 'PS-001', 'WD', [{ item: 'FP', qty: 2 }]))
    const pf = seedDoc('PF', 'PF-002', 'WF', [{ item: 'FP', qty: 10 }])
    const res = callHandler(auditDocHandler, pf)

    expect(res.statusCode).toBe(400)
    expect(res.body.message).toContain('禁止超完工')
  })

  it('生成凭证：借 存货 / 贷 生产成本', () => {
    issueMaterials()
    const ps = seedDoc('PS', 'PS-001', 'WD', [{ item: 'FP', qty: 2 }])
    callHandler(auditDocHandler, ps)
    const res = callHandler(genVoucherHandler, ps)

    expect(res.body.code).toBe(0)
    expect(entriesOf(res.body.data.voucher_id)).toEqual([
      { account_code: '1405', direction: 'debit', amount: 50 },
      { account_code: '5001', direction: 'credit', amount: 50 },
    ])
  })

  it('反审核回退不良品库存与报废数', () => {
    issueMaterials()
    const ps = seedDoc('PS', 'PS-001', 'WD', [{ item: 'FP', qty: 2 }])
    callHandler(auditDocHandler, ps)
    expect(callHandler(unauditDocHandler, ps).body.code).toBe(0)

    expect(stock('WD', 'FP')).toMatchObject({ qty: 0, amount: 0 })
    expect(productRow()).toMatchObject({ scrap_qty: 0 })
    expect(costSummary().wip).toBe(250)
  })
})
