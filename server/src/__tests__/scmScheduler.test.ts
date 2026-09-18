/**
 * 自动排程（services/scmScheduler.ts）：有限产能顺排、工作日跳过、优先级抢占、延期、未排产、写库
 */
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { runSchedule, listScheduleRuns } from '../services/scmScheduler.js'
import { up as processUp } from '../db/migrations/20260918_scm_plan_process.js'
import { up as scheduleUp } from '../db/migrations/20260918_scm_schedule.js'

const AID = 'AS-SCH'
let db: Database.Database

function createDb() {
  const d = new Database(':memory:')
  d.exec(`
    CREATE TABLE scm_production_plan (id TEXT, account_set_id TEXT, code TEXT, status TEXT, plan_type TEXT, priority INTEGER, start_date TEXT, end_date TEXT);
    CREATE TABLE scm_production_plan_product (id TEXT, account_set_id TEXT, plan_id TEXT, seq INTEGER, item_code TEXT, plan_qty REAL);
    CREATE TABLE scm_work_center (id TEXT, account_set_id TEXT, code TEXT, name TEXT);
    CREATE TABLE scm_routing (id TEXT, account_set_id TEXT, code TEXT, item_code TEXT, status TEXT);
    CREATE TABLE scm_routing_line (id TEXT, account_set_id TEXT, routing_id TEXT, seq INTEGER, process_name TEXT, work_center_code TEXT, std_hours REAL, is_outsource INTEGER);
    CREATE TABLE scm_work_report (id TEXT, account_set_id TEXT, plan_id TEXT, product_id TEXT, process_name TEXT, qty REAL DEFAULT 0, scrap_qty REAL DEFAULT 0, status TEXT);
  `)
  processUp(d); scheduleUp(d)
  d.prepare("INSERT INTO scm_work_center (id,account_set_id,code,name,daily_capacity_hours) VALUES ('W1',?,'WC1','焊接',8)").run(AID)
  d.prepare("INSERT INTO scm_work_center (id,account_set_id,code,name,daily_capacity_hours) VALUES ('W2',?,'WC2','总装',4)").run(AID)
  return d
}
/** 工单：两道工序 焊接(WC1, h1/件) → 总装(WC2, h2/件) */
function plan(id: string, code: string, priority: number, qty: number, endDate: string | null, h1 = 1, h2 = 1, wc2: string | null = 'WC2') {
  db.prepare("INSERT INTO scm_production_plan (id,account_set_id,code,status,plan_type,priority,start_date,end_date) VALUES (?,?,?,'released','self',?,NULL,?)").run(id, AID, code, priority, endDate)
  db.prepare("INSERT INTO scm_production_plan_product VALUES (?,?,?,1,'FP',?)").run('P-' + id, AID, id, qty)
  const ins = db.prepare("INSERT INTO scm_production_plan_process (id,account_set_id,plan_id,product_id,seq,process_name,work_center_code,std_hours,plan_qty) VALUES (?,?,?,?,?,?,?,?,?)")
  ins.run('X1-' + id, AID, id, 'P-' + id, 1, '焊接', 'WC1', h1, qty)
  ins.run('X2-' + id, AID, id, 'P-' + id, 2, '总装', wc2, h2, qty)
}

describe('自动排程', () => {
  beforeEach(() => { db = createDb() })

  it('顺排：工序按日产能占用日历、跳过周末、后道紧接前道；写库后工单与工序带排程日期', () => {
    // 2026-06-05 是周五。焊接 12h ÷ 8 → 周五 8h + 周一 4h；总装 12h ÷ 4 → 周一起 3 天（周一 4h、周二 4h、周三 4h）
    plan('A', 'MO-A', 5, 12, '2026-06-12')
    const r = runSchedule(db, AID, { from_date: '2026-06-05', dry_run: true })
    const a = r.plans[0]
    expect(a.processes.map(p => [p.process_name, p.sched_start, p.sched_end])).toEqual([['焊接', '2026-06-05', '2026-06-08'], ['总装', '2026-06-08', '2026-06-10']])
    expect(a).toMatchObject({ sched_start_date: '2026-06-05', sched_end_date: '2026-06-10', late_days: 0, total_hours: 24 })
    expect(r.day_loads).toEqual(expect.arrayContaining([expect.objectContaining({ work_center_code: 'WC1', date: '2026-06-05', used: 8 }), expect.objectContaining({ work_center_code: 'WC2', date: '2026-06-08', used: 4 })]))
    // 试算不写库
    expect((db.prepare("SELECT sched_end_date FROM scm_production_plan WHERE id='A'").get() as any).sched_end_date).toBeNull()
    const w = runSchedule(db, AID, { from_date: '2026-06-05', user: 'u1' })
    expect(w.run_id).toBeTruthy()
    expect(db.prepare("SELECT sched_start_date, sched_end_date FROM scm_production_plan WHERE id='A'").get()).toEqual({ sched_start_date: '2026-06-05', sched_end_date: '2026-06-10' })
    expect(db.prepare("SELECT sched_start, sched_end, sched_hours FROM scm_production_plan_process WHERE id='X2-A'").get()).toEqual({ sched_start: '2026-06-08', sched_end: '2026-06-10', sched_hours: 12 })
    expect(listScheduleRuns(db, AID)[0]).toMatchObject({ plan_count: 1, late_count: 0, run_by: 'u1' })
  })

  it('优先级高的先占产能，低优先级顺延并标记延期；无产能工作中心归未排产', () => {
    plan('A', 'MO-A', 1, 16, '2026-06-09')        // 低优先级，交期周二
    plan('B', 'MO-B', 9, 16, '2026-06-30')        // 高优先级
    plan('C', 'MO-C', 5, 4, null, 1, 2, null)     // 总装无工作中心 → 8h 未排产
    const r = runSchedule(db, AID, { from_date: '2026-06-08', dry_run: true })   // 周一
    const byCode = Object.fromEntries(r.plans.map(p => [p.plan_code, p]))
    expect(r.plans.map(p => p.plan_code)).toEqual(['MO-B', 'MO-C', 'MO-A'])
    // B 焊接 16h：周一 8 + 周二 8 → 06-09；C 焊接 4h：周三 → 06-10；A 焊接 16h：周三 4h + 周四 8h + 周五 4h → 06-12
    expect(byCode['MO-B'].processes[0]).toMatchObject({ sched_start: '2026-06-08', sched_end: '2026-06-09' })
    expect(byCode['MO-C'].processes[0]).toMatchObject({ sched_start: '2026-06-10', sched_end: '2026-06-10' })
    expect(byCode['MO-A'].processes[0]).toMatchObject({ sched_start: '2026-06-10', sched_end: '2026-06-12' })
    expect(byCode['MO-A'].late_days).toBeGreaterThan(0)
    expect(byCode['MO-C']).toMatchObject({ unscheduled_hours: 8 })
    expect(byCode['MO-C'].processes[1]).toMatchObject({ unscheduled: true, hours: 8 })
    expect(r).toMatchObject({ late_count: 1, unscheduled_hours: 8 })
  })

  it('按交期排序、自定义工作日（含周末）、已完成工序不再占用', () => {
    plan('A', 'MO-A', 1, 8, '2026-06-06')
    plan('B', 'MO-B', 9, 8, '2026-06-20')
    db.prepare("UPDATE scm_production_plan_process SET done_qty=8 WHERE id='X1-A'").run()   // A 焊接已完成
    const r = runSchedule(db, AID, { from_date: '2026-06-06', workdays: [1, 2, 3, 4, 5, 6, 7], order_by: 'due_date', dry_run: true })
    expect(r.plans.map(p => p.plan_code)).toEqual(['MO-A', 'MO-B'])
    const a = r.plans[0]
    expect(a.processes[0]).toMatchObject({ hours: 0, sched_start: null })
    expect(a.processes[1]).toMatchObject({ sched_start: '2026-06-06', sched_end: '2026-06-07' })   // 周六日也排：4h + 4h
  })
})
