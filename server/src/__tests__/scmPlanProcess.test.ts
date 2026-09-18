/**
 * 工单工序 / 流转校验 / 工序在制 / 交期推算 / 产能负荷（services/scmPlanProcess.ts，生产评审 C-2 / C-3）
 */
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { ensurePlanProcesses, validateProcessFlow, syncPlanProcessQty, queryProcessWip, estimatePlanFinish, queryCapacityLoad, resolveProcessId } from '../services/scmPlanProcess.js'
import { up as processUp } from '../db/migrations/20260918_scm_plan_process.js'

const AID = 'AS-PROC'
const PLAN = 'PLAN-1'
let db: Database.Database

function createDb() {
  const d = new Database(':memory:')
  d.exec(`
    CREATE TABLE system_params (id TEXT, account_set_id TEXT, param_key TEXT, param_value TEXT);
    CREATE TABLE scm_production_plan (id TEXT, account_set_id TEXT, code TEXT, status TEXT, plan_type TEXT, start_date TEXT, end_date TEXT);
    CREATE TABLE scm_production_plan_product (id TEXT, account_set_id TEXT, plan_id TEXT, seq INTEGER, item_code TEXT, plan_qty REAL);
    CREATE TABLE scm_item (id TEXT, account_set_id TEXT, code TEXT, name TEXT);
    CREATE TABLE scm_work_center (id TEXT, account_set_id TEXT, code TEXT, name TEXT);
    CREATE TABLE scm_routing (id TEXT, account_set_id TEXT, code TEXT, item_code TEXT, status TEXT);
    CREATE TABLE scm_routing_line (id TEXT, account_set_id TEXT, routing_id TEXT, seq INTEGER, process_name TEXT, work_center_code TEXT, std_hours REAL, is_outsource INTEGER);
    CREATE TABLE scm_work_report (id TEXT, account_set_id TEXT, plan_id TEXT, product_id TEXT, process_name TEXT, qty REAL DEFAULT 0, scrap_qty REAL DEFAULT 0, status TEXT);
  `)
  processUp(d)
  d.prepare("INSERT INTO scm_production_plan VALUES (?,?,'MO-1','released','self','2026-06-01','2026-06-12')").run(PLAN, AID)
  d.prepare("INSERT INTO scm_production_plan_product VALUES ('P1',?,?,1,'FP',10)").run(AID, PLAN)
  d.prepare("INSERT INTO scm_work_center (id,account_set_id,code,name) VALUES ('W1',?,'WC1','装配线')").run(AID)
  d.prepare("UPDATE scm_work_center SET daily_capacity_hours=8").run()
  d.prepare("INSERT INTO scm_routing VALUES ('RT',?,'RT-FP','FP','active')").run(AID)
  d.prepare("INSERT INTO scm_routing_line VALUES ('L1',?,'RT',1,'下料','WC1',1,0)").run(AID)
  d.prepare("INSERT INTO scm_routing_line VALUES ('L2',?,'RT',2,'焊接','WC1',2,0)").run(AID)
  d.prepare("INSERT INTO scm_routing_line VALUES ('L3',?,'RT',3,'总装',NULL,1,0)").run(AID)
  return d
}
function report(id: string, proc: string, qty: number, scrap = 0, status = 'audited') {
  db.prepare('INSERT INTO scm_work_report (id,account_set_id,plan_id,product_id,process_name,qty,scrap_qty,status) VALUES (?,?,?,?,?,?,?,?)').run(id, AID, PLAN, 'P1', proc, qty, scrap, status)
  syncPlanProcessQty(db, AID, PLAN)
}
const flow = (proc: string, qty: number, scrap = 0) => validateProcessFlow(db, AID, { productId: 'P1', processName: proc, qty, scrapQty: scrap })

describe('工单工序', () => {
  beforeEach(() => { db = createDb(); ensurePlanProcesses(db, AID, PLAN) })

  it('下达按启用路线快照工序行，计划数同步；无路线成品不生成', () => {
    const rows = db.prepare('SELECT seq, process_name, work_center_code, std_hours, plan_qty FROM scm_production_plan_process WHERE plan_id=? ORDER BY seq').all(PLAN)
    expect(rows).toEqual([
      { seq: 1, process_name: '下料', work_center_code: 'WC1', std_hours: 1, plan_qty: 10 },
      { seq: 2, process_name: '焊接', work_center_code: 'WC1', std_hours: 2, plan_qty: 10 },
      { seq: 3, process_name: '总装', work_center_code: null, std_hours: 1, plan_qty: 10 },
    ])
    db.prepare("UPDATE scm_production_plan_product SET plan_qty=15 WHERE id='P1'").run()
    db.prepare("INSERT INTO scm_production_plan_product VALUES ('P2',?,?,2,'NOROUTE',3)").run(AID, PLAN)
    expect(ensurePlanProcesses(db, AID, PLAN)).toBe(0)
    expect((db.prepare("SELECT plan_qty FROM scm_production_plan_process WHERE product_id='P1' AND seq=1").get() as any).plan_qty).toBe(15)
    expect(db.prepare("SELECT COUNT(*) c FROM scm_production_plan_process WHERE product_id='P2'").get()).toMatchObject({ c: 0 })
    expect(resolveProcessId(db, AID, 'P1', ' 焊接 ')).toBeTruthy()
    expect(resolveProcessId(db, AID, 'P1', '喷涂')).toBeNull()
  })

  it('流转校验：后道累计不得超过前道已审核完成数；首道不校验；参数可关', () => {
    expect(flow('下料', 10)).toBeNull()
    expect(flow('焊接', 1)).toMatch(/工序「焊接」累计报工 1 超过前道「下料」已审核完成数 0/)
    report('R1', '下料', 6, 1)
    expect(flow('焊接', 6)).toBeNull()
    expect(flow('焊接', 5, 2)).toMatch(/累计报工 7 超过前道「下料」已审核完成数 6/)
    report('R2', '焊接', 4, 0, 'draft')      // 草稿占用也计
    expect(flow('焊接', 3)).toMatch(/累计报工 7/)
    db.prepare("INSERT INTO system_params VALUES ('x',?,'scm:process_flow_strict','0')").run(AID)
    expect(flow('焊接', 30)).toBeNull()
  })

  it('工序在制表：转入 = 前道完成，在制 = 转入 − 完成 − 不良；交期推算按剩余工时 ÷ 日产能', () => {
    report('R1', '下料', 8, 2)
    report('R2', '焊接', 5, 0)
    const wip = queryProcessWip(db, AID, {})
    expect(wip.map(r => [r.process_name, r.in_qty, r.done_qty, r.scrap_qty, r.wip_qty, r.remain_qty])).toEqual([
      ['下料', 10, 8, 2, 0, 0], ['焊接', 8, 5, 0, 3, 5], ['总装', 5, 0, 0, 5, 10],
    ])
    expect(queryProcessWip(db, AID, { only_wip: '1' }).map(r => r.process_name)).toEqual(['焊接', '总装'])
    // 剩余：焊接 5×2h=10h ÷ 8 = 1.25 天；总装无工作中心 0 天；下料 0 → 共 2 天（向上取整）
    const est = estimatePlanFinish(db, AID, PLAN, new Date('2026-06-10T00:00:00'))
    expect(est).toMatchObject({ est_days: 2, est_finish_date: '2026-06-12', remain_hours: 20 })
    // 产能负荷：交期 2026-06-12 所在周（周一 06-08）；WC1 负荷 = 焊接 10h（总装无中心 → 未排 10h）
    const cap = queryCapacityLoad(db, AID, {})
    expect(cap.rows).toEqual([expect.objectContaining({ work_center_code: 'WC1', week: '2026-06-08', capacity_hours: 40, load_hours: 10, utilization: 25, plans: ['MO-1'] })])
    expect(cap.unscheduled_hours).toBe(10)
  })
})
