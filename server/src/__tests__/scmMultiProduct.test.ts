import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { computeIssueSuggestion } from '../services/scmProduction.js'
import { getMaterialIssueUnitCost, productMaterialUnitCost, getPlanCostSummary } from '../routes/scmDoc.js'

const AID = 'AS-TEST'

/**
 * 工单「一单多成品」场景：
 *  成品 A（计划 10）用料 M1×2；成品 B（计划 5）用料 M1×1 + M2×3。
 *  → 领料 need：M1 = 2×10 + 1×5 = 25；M2 = 3×5 = 15（M1 跨成品合并）
 */
function createDb() {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE scm_item (account_set_id TEXT, code TEXT, name TEXT, unit TEXT, spec TEXT);
    CREATE TABLE scm_production_plan (id TEXT, account_set_id TEXT, item_code TEXT, plan_qty REAL,
      bom_id TEXT, yl_warehouse TEXT, fp_warehouse TEXT, finished_qty REAL, status TEXT, plan_type TEXT);
    CREATE TABLE scm_production_plan_product (id TEXT, account_set_id TEXT, plan_id TEXT, seq INTEGER,
      item_code TEXT, plan_qty REAL, bom_id TEXT, fp_warehouse TEXT, finished_qty REAL, scrap_qty REAL,
      labor_absorbed REAL DEFAULT 0, overhead_absorbed REAL DEFAULT 0);
    CREATE TABLE scm_production_plan_line (id TEXT, account_set_id TEXT, plan_id TEXT, product_id TEXT,
      seq INTEGER, item_code TEXT, qty REAL, unit TEXT, scrap_rate REAL, remark TEXT, warehouse_code TEXT);
    CREATE TABLE scm_bom_line (account_set_id TEXT, bom_id TEXT, item_code TEXT, qty REAL, scrap_rate REAL, seq INTEGER);
    CREATE TABLE scm_stock_move (id TEXT, account_set_id TEXT, doc_type TEXT, doc_no TEXT,
      item_code TEXT, direction TEXT, qty REAL, amount REAL);
    CREATE TABLE scm_doc (id TEXT, account_set_id TEXT, doc_type TEXT, doc_no TEXT, plan_id TEXT, status TEXT);
    CREATE TABLE scm_doc_line (id TEXT, doc_id TEXT, account_set_id TEXT, item_code TEXT, qty REAL);
    CREATE TABLE scm_work_report (account_set_id TEXT, plan_id TEXT, product_id TEXT, status TEXT,
      labor_amount REAL DEFAULT 0, overhead_amount REAL DEFAULT 0);
    CREATE TABLE scm_doc_type (account_set_id TEXT, code TEXT, direction TEXT);
  `)
  const item = db.prepare('INSERT INTO scm_item (account_set_id,code,name,unit) VALUES (?,?,?,?)')
  item.run(AID, 'A', '成品A', '台'); item.run(AID, 'B', '成品B', '台')
  item.run(AID, 'M1', '原料一', '个'); item.run(AID, 'M2', '原料二', '个')
  db.prepare('INSERT INTO scm_production_plan (id,account_set_id,item_code,plan_qty,yl_warehouse,finished_qty,status,plan_type) VALUES (?,?,?,?,?,?,?,?)')
    .run('P1', AID, 'A', 15, 'W1', 0, 'released', 'self')
  const insP = db.prepare('INSERT INTO scm_production_plan_product (id,account_set_id,plan_id,seq,item_code,plan_qty,finished_qty,scrap_qty) VALUES (?,?,?,?,?,?,?,?)')
  insP.run('PA', AID, 'P1', 1, 'A', 10, 0, 0)
  insP.run('PB', AID, 'P1', 2, 'B', 5, 0, 0)
  const insL = db.prepare('INSERT INTO scm_production_plan_line (id,account_set_id,plan_id,product_id,seq,item_code,qty,scrap_rate) VALUES (?,?,?,?,?,?,?,?)')
  insL.run('LA1', AID, 'P1', 'PA', 1, 'M1', 2, 0)              // A: M1×2
  insL.run('LB1', AID, 'P1', 'PB', 1, 'M1', 1, 0)              // B: M1×1
  insL.run('LB2', AID, 'P1', 'PB', 2, 'M2', 3, 0)              // B: M2×3
  const dt = db.prepare('INSERT INTO scm_doc_type (account_set_id,code,direction) VALUES (?,?,?)')
  dt.run(AID, 'PL', 'out'); dt.run(AID, 'PJ', 'in'); dt.run(AID, 'PF', 'in'); dt.run(AID, 'WO', 'out'); dt.run(AID, 'PB', 'out')
  return db
}

const PLAN = { id: 'P1', yl_warehouse: 'W1', bom_id: null, plan_qty: 15 }

// 审核领料（写库存移动 + 单据）；金额用于求净领单价
function auditIssue(db: Database.Database, no: string, item: string, qty: number, amount: number) {
  db.prepare('INSERT INTO scm_doc (id,account_set_id,doc_type,doc_no,plan_id,status) VALUES (?,?,?,?,?,?)').run(no, AID, 'PL', no, 'P1', 'audited')
  db.prepare('INSERT INTO scm_stock_move (id,account_set_id,doc_type,doc_no,item_code,direction,qty,amount) VALUES (?,?,?,?,?,?,?,?)')
    .run(no + '-m', AID, 'PL', no, item, 'out', qty, amount)
}

describe('一单多成品 · 领料汇总', () => {
  let db: Database.Database
  beforeEach(() => { db = createDb() })

  it('跨成品原料合并、need 按各成品计划数', () => {
    const rows = computeIssueSuggestion(db, AID, PLAN)
    const m1 = rows.find(r => r.item_code === 'M1')!
    const m2 = rows.find(r => r.item_code === 'M2')!
    expect(m1.need).toBe(25)   // 2×10 + 1×5
    expect(m2.need).toBe(15)   // 3×5
    expect(m1.suggest).toBe(25)
    expect(m1.warehouse_code).toBe('W1')   // 行无仓 → 原料仓兜底
  })

  it('已审核领料从合并 need 扣减', () => {
    auditIssue(db, 'PL-1', 'M1', 20, 200)
    const rows = computeIssueSuggestion(db, AID, PLAN)
    const m1 = rows.find(r => r.item_code === 'M1')!
    expect(m1.issued).toBe(20)
    expect(m1.suggest).toBe(5)
  })
})

describe('一单多成品 · 成本上卷', () => {
  let db: Database.Database
  beforeEach(() => { db = createDb() })

  it('每料净领单价 = 净领金额/数量', () => {
    auditIssue(db, 'PL-1', 'M1', 25, 250)   // 单价 10
    auditIssue(db, 'PL-2', 'M2', 15, 300)   // 单价 20
    const map = getMaterialIssueUnitCost(db, AID, 'P1')
    expect(map.get('M1')).toBe(10)
    expect(map.get('M2')).toBe(20)
  })

  it('成品每件料成本按 BOM 上卷', () => {
    auditIssue(db, 'PL-1', 'M1', 25, 250)
    auditIssue(db, 'PL-2', 'M2', 15, 300)
    const map = getMaterialIssueUnitCost(db, AID, 'P1')
    expect(productMaterialUnitCost(db, 'PA', map)).toBe(20)   // M1×2×10 = 20
    expect(productMaterialUnitCost(db, 'PB', map)).toBe(70)   // M1×1×10 + M2×3×20 = 70
  })

  it('工单成本汇总：已领/已消耗/WIP', () => {
    auditIssue(db, 'PL-1', 'M1', 25, 250)
    auditIssue(db, 'PL-2', 'M2', 15, 300)
    // 成品 A 已完工 10 台、B 未完工
    db.prepare("UPDATE scm_production_plan_product SET finished_qty=10 WHERE id='PA'").run()
    const cost = getPlanCostSummary(db, AID, 'P1', 0)
    expect(cost.issuedCost).toBe(550)        // 250+300
    expect(cost.totalPlanQty).toBe(15)       // 10+5
    // 已消耗 = A 10台×20 = 200；WIP = 550−200 = 350
    expect(cost.wip).toBe(350)
    const pa = cost.products.find(p => p.product_id === 'PA')!
    expect(pa.mat_unit_cost).toBe(20)
    expect(pa.consumed_cost).toBe(200)
  })
})
