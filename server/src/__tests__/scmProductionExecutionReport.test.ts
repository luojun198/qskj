/**
 * 生产执行及在制结存表单元测试
 *
 * 口径必须与 routes/scmDoc.ts 的 getPlanCostSummary 一致：
 *   已领料成本 = PL/PB 出 − PJ 入；已消耗 = (完工+报废)×每件料成本；料在制 = 两者之差。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { queryProductionExecution } from '../services/scmProductionExecutionReport.js'

const AID = 'AS-PE'
let db: Database.Database

function createDb() {
  const d = new Database(':memory:')
  d.exec(`
    CREATE TABLE scm_production_plan (id TEXT, account_set_id TEXT, code TEXT, plan_type TEXT, status TEXT,
      start_date TEXT, end_date TEXT, dept_code TEXT, yl_warehouse TEXT, created_at TEXT);
    CREATE TABLE scm_production_plan_product (id TEXT, account_set_id TEXT, plan_id TEXT, seq INTEGER,
      item_code TEXT, plan_qty REAL DEFAULT 0, finished_qty REAL DEFAULT 0, scrap_qty REAL DEFAULT 0,
      labor_absorbed REAL DEFAULT 0, overhead_absorbed REAL DEFAULT 0);
    CREATE TABLE scm_production_plan_line (id TEXT, account_set_id TEXT, plan_id TEXT, product_id TEXT,
      seq INTEGER, item_code TEXT, qty REAL, scrap_rate REAL DEFAULT 0);
    CREATE TABLE scm_item (id TEXT, account_set_id TEXT, code TEXT, name TEXT, spec TEXT, unit TEXT);
    CREATE TABLE scm_doc (exchange_rate REAL DEFAULT 1, currency TEXT, id TEXT, account_set_id TEXT, doc_type TEXT, doc_no TEXT, status TEXT, plan_id TEXT);
    CREATE TABLE scm_doc_line (id TEXT, doc_id TEXT, amount REAL, labor_cost REAL, overhead_cost REAL);
    CREATE TABLE scm_stock_move (id TEXT, account_set_id TEXT, doc_type TEXT, doc_no TEXT,
      item_code TEXT, direction TEXT, qty REAL, amount REAL);
    CREATE TABLE scm_work_report (id TEXT, account_set_id TEXT, plan_id TEXT, qty REAL DEFAULT 0,
      scrap_qty REAL DEFAULT 0, labor_amount REAL DEFAULT 0, overhead_amount REAL DEFAULT 0, status TEXT);
  `)
  return d
}

function plan(id: string, code: string, status = 'released', planType = 'self') {
  db.prepare('INSERT INTO scm_production_plan (id,account_set_id,code,plan_type,status,start_date,created_at) VALUES (?,?,?,?,?,?,?)')
    .run(id, AID, code, planType, status, '2026-09-01', '2026-09-01')
}
function product(id: string, planId: string, item: string, planQty: number, finished = 0, scrap = 0, labAbs = 0, ohAbs = 0) {
  db.prepare('INSERT INTO scm_production_plan_product (id,account_set_id,plan_id,seq,item_code,plan_qty,finished_qty,scrap_qty,labor_absorbed,overhead_absorbed) VALUES (?,?,?,1,?,?,?,?,?,?)')
    .run(id, AID, planId, item, planQty, finished, scrap, labAbs, ohAbs)
  db.prepare('INSERT INTO scm_item (id,account_set_id,code,name) VALUES (?,?,?,?)').run(id + '-i', AID, item, item + '名')
}
function planLine(planId: string, productId: string, item: string, qty: number, scrapRate = 0) {
  db.prepare('INSERT INTO scm_production_plan_line (id,account_set_id,plan_id,product_id,seq,item_code,qty,scrap_rate) VALUES (?,?,?,?,1,?,?,?)')
    .run(`${productId}-${item}`, AID, planId, productId, item, qty, scrapRate)
}
/** 一张已审核单据 + 一条库存流水 */
function move(planId: string, docType: string, docNo: string, item: string, dir: 'in' | 'out', qty: number, amount: number) {
  db.prepare("INSERT INTO scm_doc (id,account_set_id,doc_type,doc_no,status,plan_id) VALUES (?,?,?,?,'audited',?)")
    .run(docNo, AID, docType, docNo, planId)
  db.prepare('INSERT INTO scm_stock_move (id,account_set_id,doc_type,doc_no,item_code,direction,qty,amount) VALUES (?,?,?,?,?,?,?,?)')
    .run(docNo + item, AID, docType, docNo, item, dir, qty, amount)
}
function workReport(planId: string, qty: number, labor: number, overhead: number, status = 'audited') {
  db.prepare('INSERT INTO scm_work_report (id,account_set_id,plan_id,qty,labor_amount,overhead_amount,status) VALUES (?,?,?,?,?,?,?)')
    .run(`${planId}-wr-${qty}-${labor}`, AID, planId, qty, labor, overhead, status)
}

/** 基准：工单 W1，成品 FP 计划 10 件，每件 R1×2(@10) + R2×1(@5) → 每件料 25 */
function seedBasic() {
  plan('P1', 'WO-001')
  product('PP1', 'P1', 'FP', 10)
  planLine('P1', 'PP1', 'R1', 2)
  planLine('P1', 'PP1', 'R2', 1)
  move('P1', 'PL', 'PL-001', 'R1', 'out', 20, 200)
  move('P1', 'PL', 'PL-002', 'R2', 'out', 10, 50)
}

const run = (filters = {}) => queryProductionExecution(db, AID, filters)

describe('生产执行及在制结存表', () => {
  beforeEach(() => { db = createDb() })

  it('只领料未完工：已领料成本 250、料在制 250、状态未完工', () => {
    seedBasic()
    const { rows, summary } = run()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      plan_code: 'WO-001', item_code: 'FP',
      plan_qty: 10, finished_qty: 0, scrap_qty: 0, remaining_qty: 10,
      issued_material_qty: 30, issued_material_cost: 250,
      mat_unit_cost: 25, consumed_cost: 0, material_wip: 250,
      execution_status: '未完工', completion_rate: 0,
    })
    expect(summary).toMatchObject({ plan_count: 1, issued_material_cost: 250, material_wip: 250, total_wip: 250 })
  })

  it('退料冲减已领料成本与在制', () => {
    seedBasic()
    move('P1', 'PJ', 'PJ-001', 'R1', 'in', 5, 50)
    const { rows } = run()
    expect(rows[0]).toMatchObject({ issued_material_qty: 25, issued_material_cost: 200, material_wip: 200 })
  })

  it('部分完工：已消耗按完工数×每件料成本，在制为余额', () => {
    seedBasic()
    db.prepare("UPDATE scm_production_plan_product SET finished_qty=4 WHERE id='PP1'").run()
    const { rows } = run()
    expect(rows[0]).toMatchObject({
      finished_qty: 4, remaining_qty: 6, consumed_cost: 100, material_wip: 150,
      execution_status: '部分完工', completion_rate: 40,
    })
  })

  it('完工 + 报废合计达到计划：在制归零、状态已完工、报废率正确', () => {
    seedBasic()
    db.prepare("UPDATE scm_production_plan_product SET finished_qty=8, scrap_qty=2 WHERE id='PP1'").run()
    const { rows, summary } = run()
    expect(rows[0]).toMatchObject({
      finished_qty: 8, scrap_qty: 2, remaining_qty: 0, consumed_cost: 250,
      material_wip: 0, execution_status: '已完工', completion_rate: 100, scrap_rate: 20,
    })
    expect(summary.total_wip).toBe(0)
  })

  it('报工人工制费与已吸收之差就是人工制费在制', () => {
    seedBasic()
    workReport('P1', 10, 30, 20)
    db.prepare("UPDATE scm_production_plan_product SET finished_qty=4, labor_absorbed=12, overhead_absorbed=8 WHERE id='PP1'").run()
    const { rows } = run()
    expect(rows[0]).toMatchObject({
      reported_good_qty: 10, labor_total: 30, overhead_total: 20,
      labor_absorbed: 12, overhead_absorbed: 8, labor_wip: 30,
      material_wip: 150, total_wip: 180,
    })
  })

  it('草稿报工不计入', () => {
    seedBasic()
    workReport('P1', 10, 30, 20, 'draft')
    expect(run().rows[0]).toMatchObject({ labor_total: 0, overhead_total: 0, labor_wip: 0 })
  })

  it('未审核的领料单不计入已领料成本', () => {
    seedBasic()
    db.prepare("UPDATE scm_doc SET status='draft' WHERE doc_no='PL-001'").run()
    expect(run().rows[0]).toMatchObject({ issued_material_cost: 50, issued_material_qty: 10 })
  })

  it('多成品工单：在制是工单级口径，两行显示同一个数且汇总不重复累加', () => {
    plan('P1', 'WO-001')
    product('PP1', 'P1', 'FP1', 10)
    product('PP2', 'P1', 'FP2', 5)
    db.prepare("UPDATE scm_production_plan_product SET seq=2 WHERE id='PP2'").run()
    planLine('P1', 'PP1', 'R1', 2)
    planLine('P1', 'PP2', 'R1', 1)
    move('P1', 'PL', 'PL-001', 'R1', 'out', 30, 300)

    const { rows, summary } = run()
    expect(rows).toHaveLength(2)
    expect(rows[0].material_wip).toBe(300)
    expect(rows[1].material_wip).toBe(300)
    expect(summary.plan_count).toBe(1)
    expect(summary.material_wip).toBe(300)
    expect(summary.issued_material_cost).toBe(300)
  })

  it('委外工单与草稿工单不出现在本表', () => {
    plan('P1', 'WO-OUT', 'released', 'outsource')
    product('PP1', 'P1', 'FP', 10)
    plan('P2', 'WO-DRAFT', 'draft')
    product('PP2', 'P2', 'FP2', 10)
    expect(run().rows).toHaveLength(0)
  })

  it('已关闭工单仍展示（收尾核对在制用）', () => {
    plan('P1', 'WO-001', 'closed')
    product('PP1', 'P1', 'FP', 10, 10)
    expect(run().rows.map(r => r.plan_code)).toEqual(['WO-001'])
  })

  it('筛选：工单号 / 成品 / 执行状态 / 只看有在制', () => {
    seedBasic()
    plan('P2', 'WO-002')
    product('PP2', 'P2', 'FP2', 5, 5)

    expect(run({ plan_code: 'WO-002' }).rows.map(r => r.plan_code)).toEqual(['WO-002'])
    expect(run({ item_code: 'FP2' }).rows.map(r => r.item_code)).toEqual(['FP2'])
    expect(run({ status: '已完工' }).rows.map(r => r.plan_code)).toEqual(['WO-002'])
    expect(run({ only_wip: '1' }).rows.map(r => r.plan_code)).toEqual(['WO-001'])
  })

  it('分页与全量导出（页大小下限 10，与委外执行表一致）', () => {
    for (let i = 1; i <= 15; i++) {
      const no = String(i).padStart(3, '0')
      plan('P' + no, 'WO-' + no)
      product('PP' + no, 'P' + no, 'FP' + no, 10)
    }
    const first = queryProductionExecution(db, AID, { page: 1, page_size: 10 })
    expect(first.total).toBe(15)
    expect(first.rows).toHaveLength(10)
    expect(first.rows[0].plan_code).toBe('WO-001')

    const second = queryProductionExecution(db, AID, { page: 2, page_size: 10 })
    expect(second.rows.map(r => r.plan_code)).toEqual(['WO-011', 'WO-012', 'WO-013', 'WO-014', 'WO-015'])

    // 小于 10 的页大小被抬到 10
    expect(queryProductionExecution(db, AID, { page: 1, page_size: 2 }).page_size).toBe(10)
    // 导出忽略分页
    expect(queryProductionExecution(db, AID, { page: 2, page_size: 10 }, true).rows).toHaveLength(15)
  })

  it('倒序排序', () => {
    seedBasic()
    plan('P2', 'WO-002')
    product('PP2', 'P2', 'FP2', 5)
    expect(run({ sort_field: 'plan_code', sort_order: 'desc' }).rows.map(r => r.plan_code))
      .toEqual(['WO-002', 'WO-001'])
  })
})
