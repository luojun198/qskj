/**
 * 自动排程（有限产能顺排，生产评审 决策 5 续）
 *
 *  输入：已审核自制工单的工序行（剩余量 × 单件标准工时）、工作中心日产能、工作日、起始日、排序规则
 *  算法：按排序逐张工单、逐成品工序链顺排——每道工序从 max(前道结束, 工单可开始日) 起，在其工作中心的
 *        日产能日历上逐日占用剩余产能（同一天可被多张工单 / 多道工序分摊），直到工时排完；
 *        无工作中心或无产能的工序不占用日历（0 时长，视同紧接前道）。
 *  输出：每道工序 sched_start / sched_end / sched_hours，工单 sched_start_date / sched_end_date，
 *        延期 = sched_end_date > end_date；未排产工时 = 无工作中心 / 无产能的剩余工时。
 *  不做：工序重叠 / 转移批量、换型时间、多资源约束、倒排。
 */
import type Database from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'
import { hasProcessTable } from './scmPlanProcess.js'

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100
const r4 = (n: number) => Math.round((Number(n) || 0) * 10000) / 10000
const EPS = 1e-6

export type ScheduleOrder = 'priority' | 'due_date' | 'code'
export interface ScheduleOptions { from_date?: string; workdays?: number[]; order_by?: ScheduleOrder; plan_ids?: string[]; dry_run?: boolean; user?: string }
export interface ScheduledProcess { process_id: string; plan_id: string; product_id: string; seq: number; process_name: string; work_center_code: string | null; remain_qty: number; hours: number; sched_start: string | null; sched_end: string | null; unscheduled: boolean }
export interface ScheduledPlan { plan_id: string; plan_code: string; priority: number; start_date: string | null; end_date: string | null; sched_start_date: string | null; sched_end_date: string | null; late_days: number; total_hours: number; unscheduled_hours: number; processes: ScheduledProcess[] }
export interface DayLoad { work_center_code: string; work_center_name: string; date: string; capacity: number; used: number }
export interface ScheduleResult { run_id: string | null; from_date: string; workdays: number[]; order_by: ScheduleOrder; plans: ScheduledPlan[]; day_loads: DayLoad[]; plan_count: number; late_count: number; unscheduled_hours: number }

const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const parse = (s: string) => new Date(`${s.slice(0, 10)}T00:00:00`)
const addDays = (s: string, n: number) => { const d = parse(s); d.setDate(d.getDate() + n); return fmt(d) }
/** ISO 周几：1 = 周一 … 7 = 周日 */
const isoDow = (s: string) => { const d = parse(s).getDay(); return d === 0 ? 7 : d }
const maxDate = (a: string, b: string | null | undefined) => (b && b > a ? b : a)

export function runSchedule(db: Database.Database, aid: string, opts: ScheduleOptions = {}): ScheduleResult {
  const today = fmt(new Date())
  const fromDate = opts.from_date && /^\d{4}-\d{2}-\d{2}/.test(opts.from_date) ? opts.from_date.slice(0, 10) : today
  const workdays = (opts.workdays && opts.workdays.length ? opts.workdays : [1, 2, 3, 4, 5]).map(Number).filter(n => n >= 1 && n <= 7)
  const orderBy: ScheduleOrder = opts.order_by === 'due_date' || opts.order_by === 'code' ? opts.order_by : 'priority'
  const empty: ScheduleResult = { run_id: null, from_date: fromDate, workdays, order_by: orderBy, plans: [], day_loads: [], plan_count: 0, late_count: 0, unscheduled_hours: 0 }
  if (!hasProcessTable(db)) return empty

  const orderSql = orderBy === 'due_date' ? 'COALESCE(p.end_date, \'9999\'), p.priority DESC, p.code' : orderBy === 'code' ? 'p.code' : 'p.priority DESC, COALESCE(p.end_date, \'9999\'), p.code'
  const ps: any[] = [aid]
  let planFilter = ''
  if (opts.plan_ids?.length) { planFilter = ` AND p.id IN (${opts.plan_ids.map(() => '?').join(',')})`; ps.push(...opts.plan_ids) }
  const plans = db.prepare(`SELECT p.id, p.code, COALESCE(p.priority,0) priority, p.start_date, p.end_date FROM scm_production_plan p
    WHERE p.account_set_id=? AND p.status='released' AND COALESCE(p.plan_type,'self')='self'${planFilter}
      AND EXISTS (SELECT 1 FROM scm_production_plan_process x WHERE x.plan_id=p.id) ORDER BY ${orderSql}`).all(...ps) as any[]
  const procStmt = db.prepare('SELECT * FROM scm_production_plan_process WHERE account_set_id=? AND plan_id=? ORDER BY product_id, seq')
  const centers = new Map<string, { name: string; cap: number }>((db.prepare('SELECT code, name, COALESCE(daily_capacity_hours,0) h FROM scm_work_center WHERE account_set_id=?').all(aid) as any[]).map(w => [String(w.code), { name: w.name, cap: Number(w.h) || 0 }]))

  // 产能日历：wc → date → 已用工时
  const used = new Map<string, Map<string, number>>()
  const usedOf = (wc: string, date: string) => used.get(wc)?.get(date) || 0
  const consume = (wc: string, date: string, h: number) => { if (!used.has(wc)) used.set(wc, new Map()); used.get(wc)!.set(date, r4(usedOf(wc, date) + h)) }
  const isWorkday = (date: string) => workdays.includes(isoDow(date))

  /** 从 startDate 起在工作中心上排 hours 工时，返回 [开始日, 结束日]；同一天剩余产能可继续用 */
  const place = (wc: string, cap: number, startDate: string, hours: number): [string, string] => {
    let date = startDate; let remain = hours; let first: string | null = null
    let guard = 0
    while (remain > EPS && guard++ < 3660) {
      if (!isWorkday(date)) { date = addDays(date, 1); continue }
      const free = r4(cap - usedOf(wc, date))
      if (free > EPS) {
        const take = Math.min(free, remain)
        consume(wc, date, take)
        remain = r4(remain - take)
        if (!first) first = date
        if (remain <= EPS) return [first, date]
      }
      date = addDays(date, 1)
    }
    return [first || startDate, date]
  }

  const out: ScheduledPlan[] = []
  let totalUnscheduled = 0
  for (const p of plans) {
    const rows = procStmt.all(aid, p.id) as any[]
    const planStart = maxDate(fromDate, p.start_date)
    const chains = new Map<string, any[]>()
    for (const r of rows) { if (!chains.has(r.product_id)) chains.set(r.product_id, []); chains.get(r.product_id)!.push(r) }
    const procs: ScheduledProcess[] = []
    let planSchedStart = null as string | null; let planSchedEnd = null as string | null
    let totalHours = 0; let unsched = 0
    for (const chain of chains.values()) {
      let cursor = planStart   // 前道结束后的下一可开始日（同一天可继续）
      for (const r of chain) {
        const remain = r4(Math.max(0, (Number(r.plan_qty) || 0) - (Number(r.done_qty) || 0) - (Number(r.scrap_qty) || 0)))
        const hours = r4(remain * (Number(r.std_hours) || 0))
        totalHours = r4(totalHours + hours)
        const wc = r.work_center_code ? String(r.work_center_code) : ''
        const cap = wc ? (centers.get(wc)?.cap || 0) : 0
        if (hours <= EPS) { procs.push({ process_id: r.id, plan_id: p.id, product_id: r.product_id, seq: r.seq, process_name: r.process_name, work_center_code: r.work_center_code, remain_qty: remain, hours, sched_start: null, sched_end: null, unscheduled: false }); continue }
        if (!wc || cap <= 0) {
          unsched = r4(unsched + hours)
          procs.push({ process_id: r.id, plan_id: p.id, product_id: r.product_id, seq: r.seq, process_name: r.process_name, work_center_code: r.work_center_code, remain_qty: remain, hours, sched_start: cursor, sched_end: cursor, unscheduled: true })
          continue
        }
        const [s, e] = place(wc, cap, cursor, hours)
        procs.push({ process_id: r.id, plan_id: p.id, product_id: r.product_id, seq: r.seq, process_name: r.process_name, work_center_code: r.work_center_code, remain_qty: remain, hours, sched_start: s, sched_end: e, unscheduled: false })
        cursor = e
        planSchedStart = planSchedStart && planSchedStart < s ? planSchedStart : s
        planSchedEnd = planSchedEnd && planSchedEnd > e ? planSchedEnd : e
      }
    }
    const lateDays = p.end_date && planSchedEnd && planSchedEnd > p.end_date ? Math.round((parse(planSchedEnd).getTime() - parse(p.end_date).getTime()) / 86400000) : 0
    totalUnscheduled = r4(totalUnscheduled + unsched)
    out.push({ plan_id: p.id, plan_code: p.code, priority: Number(p.priority) || 0, start_date: p.start_date, end_date: p.end_date, sched_start_date: planSchedStart, sched_end_date: planSchedEnd, late_days: lateDays, total_hours: totalHours, unscheduled_hours: unsched, processes: procs })
  }
  const dayLoads: DayLoad[] = []
  for (const [wc, m] of used) for (const [date, h] of m) dayLoads.push({ work_center_code: wc, work_center_name: centers.get(wc)?.name || wc, date, capacity: centers.get(wc)?.cap || 0, used: r2(h) })
  dayLoads.sort((a, b) => a.date.localeCompare(b.date) || a.work_center_code.localeCompare(b.work_center_code))
  const result: ScheduleResult = { run_id: null, from_date: fromDate, workdays, order_by: orderBy, plans: out, day_loads: dayLoads, plan_count: out.length, late_count: out.filter(x => x.late_days > 0).length, unscheduled_hours: totalUnscheduled }

  if (!opts.dry_run) {
    const runId = uuidv4()
    db.transaction(() => {
      db.prepare('INSERT INTO scm_schedule_run (id,account_set_id,from_date,workdays,order_by,plan_count,late_count,unscheduled_hours,summary_json,run_by) VALUES (?,?,?,?,?,?,?,?,?,?)')
        .run(runId, aid, fromDate, workdays.join(','), orderBy, result.plan_count, result.late_count, result.unscheduled_hours,
          JSON.stringify(out.map(x => ({ plan_id: x.plan_id, plan_code: x.plan_code, sched_start_date: x.sched_start_date, sched_end_date: x.sched_end_date, late_days: x.late_days, unscheduled_hours: x.unscheduled_hours }))), opts.user || null)
      const upProc = db.prepare('UPDATE scm_production_plan_process SET sched_start=?, sched_end=?, sched_hours=? WHERE id=?')
      const upPlan = db.prepare('UPDATE scm_production_plan SET sched_start_date=?, sched_end_date=?, sched_run_id=? WHERE id=? AND account_set_id=?')
      for (const x of out) {
        for (const pr of x.processes) upProc.run(pr.sched_start, pr.sched_end, pr.hours, pr.process_id)
        upPlan.run(x.sched_start_date, x.sched_end_date, runId, x.plan_id, aid)
      }
    })()
    result.run_id = runId
  }
  return result
}

export function listScheduleRuns(db: Database.Database, aid: string, limit = 20) {
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='scm_schedule_run'").get()) return []
  return (db.prepare('SELECT * FROM scm_schedule_run WHERE account_set_id=? ORDER BY run_at DESC LIMIT ?').all(aid, limit) as any[])
    .map(r => ({ ...r, summary: (() => { try { return JSON.parse(r.summary_json || '[]') } catch { return [] } })(), summary_json: undefined }))
}
