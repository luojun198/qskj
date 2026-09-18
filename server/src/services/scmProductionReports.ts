/**
 * 生产执行侧报表（生产评审 C-4 ①②）
 *
 *  ① 工时统计：已审核报工按 工作中心 / 操作工 / 日期 / 工单 / 工序 / 成品 汇总——报工数、合格 / 不良、实际工时、
 *     人工 / 制费、标准工时（= 该成品工艺路线里该工序的标准工时 × (合格+不良)）、效率（标准 ÷ 实际）
 *  ② 生产日报：按日期把 领料（PL/PB 出 − PJ 入）、报工（合格 / 不良 / 工时 / 人工 / 制费）、完工（PF 入）、
 *     不良品入库（PS 入）摊在一行，供车间日结与月末对账
 *
 *  工单成本明细表（③）依赖 routes/scmDoc.ts 的 getPlanCostSummary，放在路由文件内实现。
 */
import type Database from 'better-sqlite3'

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100
const r4 = (n: number) => Math.round((Number(n) || 0) * 10000) / 10000

export type HoursGroupBy = 'work_center' | 'operator' | 'date' | 'plan' | 'process' | 'item'
export interface WorkHoursFilters {
  start_date?: string; end_date?: string
  group_by?: HoursGroupBy
  work_center_code?: string; plan_id?: string; item_code?: string; operator?: string
}
export interface WorkHoursRow {
  group_key: string; group_label: string
  report_count: number; qty: number; scrap_qty: number
  work_hours: number; std_hours: number; var_hours: number; efficiency: number | null
  labor_amount: number; overhead_amount: number
}

const GROUP_EXPR: Record<HoursGroupBy, { key: string; label: string }> = {
  work_center: { key: "COALESCE(wr.work_center_code,'')", label: "COALESCE(w.name, wr.work_center_code, '（未指定工作中心）')" },
  operator: { key: "COALESCE(wr.operator,'')", label: "COALESCE(NULLIF(wr.operator,''), '（未记录）')" },
  date: { key: "COALESCE(wr.report_date,'')", label: "COALESCE(wr.report_date,'')" },
  plan: { key: "COALESCE(wr.plan_id,'')", label: "COALESCE(pp.code, '（无工单）')" },
  process: { key: "COALESCE(TRIM(wr.process_name),'')", label: "COALESCE(NULLIF(TRIM(wr.process_name),''), '（未指定工序）')" },
  item: { key: "COALESCE(ppp.item_code, wr.item_code, '')", label: "COALESCE(ppp.item_code, wr.item_code, '') || ' ' || COALESCE(i.name,'')" },
}

export function queryWorkHoursStat(db: Database.Database, aid: string, f: WorkHoursFilters = {}): { rows: WorkHoursRow[]; summary: Omit<WorkHoursRow, 'group_key' | 'group_label'> } {
  const groupBy: HoursGroupBy = (f.group_by && GROUP_EXPR[f.group_by]) ? f.group_by : 'work_center'
  const conds = ["wr.account_set_id=?", "wr.status='audited'"]; const ps: any[] = [aid]
  if (f.start_date) { conds.push('wr.report_date>=?'); ps.push(f.start_date) }
  if (f.end_date) { conds.push('wr.report_date<=?'); ps.push(f.end_date) }
  if (f.work_center_code) { conds.push('wr.work_center_code=?'); ps.push(f.work_center_code) }
  if (f.plan_id) { conds.push('wr.plan_id=?'); ps.push(f.plan_id) }
  if (f.item_code) { conds.push('COALESCE(ppp.item_code, wr.item_code)=?'); ps.push(f.item_code) }
  if (f.operator) { conds.push('wr.operator LIKE ?'); ps.push(`%${f.operator}%`) }
  // 逐张报工取标准工时：成品启用路线里同名工序的 std_hours × (合格+不良)
  const reports = db.prepare(`SELECT wr.id, wr.qty, wr.scrap_qty, wr.work_hours, wr.labor_amount, wr.overhead_amount,
      ${GROUP_EXPR[groupBy].key} AS group_key, ${GROUP_EXPR[groupBy].label} AS group_label,
      COALESCE(ppp.item_code, wr.item_code) AS item_code, COALESCE(TRIM(wr.process_name),'') AS process_name
    FROM scm_work_report wr
    LEFT JOIN scm_production_plan pp ON pp.id=wr.plan_id
    LEFT JOIN scm_production_plan_product ppp ON ppp.id=wr.product_id
    LEFT JOIN scm_work_center w ON w.account_set_id=wr.account_set_id AND w.code=wr.work_center_code
    LEFT JOIN scm_item i ON i.account_set_id=wr.account_set_id AND i.code=COALESCE(ppp.item_code, wr.item_code)
    WHERE ${conds.join(' AND ')}`).all(...ps) as any[]
  const stdStmt = db.prepare(`SELECT l.std_hours FROM scm_routing r JOIN scm_routing_line l ON l.routing_id=r.id
    WHERE r.account_set_id=? AND r.item_code=? AND r.status='active' AND TRIM(l.process_name)=?
    ORDER BY r.code LIMIT 1`)
  const totalStdStmt = db.prepare(`SELECT COALESCE(SUM(l.std_hours),0) h FROM scm_routing r JOIN scm_routing_line l ON l.routing_id=r.id
    WHERE r.account_set_id=? AND r.item_code=? AND r.status='active'
      AND r.id=(SELECT id FROM scm_routing r2 WHERE r2.account_set_id=r.account_set_id AND r2.item_code=r.item_code AND r2.status='active' ORDER BY r2.code LIMIT 1)`)
  const stdCache = new Map<string, number>()
  const stdHoursPerUnit = (item: string, proc: string) => {
    const k = `${item}|${proc}`
    if (!stdCache.has(k)) {
      let h = 0
      if (item) {
        // 指定了工序取该工序；未指定工序视为整件一道，取路线标准工时合计
        h = proc ? Number((stdStmt.get(aid, item, proc) as any)?.std_hours) || 0 : Number((totalStdStmt.get(aid, item) as any)?.h) || 0
      }
      stdCache.set(k, h)
    }
    return stdCache.get(k)!
  }
  const groups = new Map<string, WorkHoursRow>()
  for (const r of reports) {
    const g = groups.get(r.group_key) || { group_key: r.group_key, group_label: r.group_label, report_count: 0, qty: 0, scrap_qty: 0, work_hours: 0, std_hours: 0, var_hours: 0, efficiency: null, labor_amount: 0, overhead_amount: 0 }
    const q = Number(r.qty) || 0, s = Number(r.scrap_qty) || 0
    g.report_count++
    g.qty = r4(g.qty + q); g.scrap_qty = r4(g.scrap_qty + s)
    g.work_hours = r4(g.work_hours + (Number(r.work_hours) || 0))
    g.std_hours = r4(g.std_hours + stdHoursPerUnit(String(r.item_code || ''), String(r.process_name || '')) * (q + s))
    g.labor_amount = r2(g.labor_amount + (Number(r.labor_amount) || 0))
    g.overhead_amount = r2(g.overhead_amount + (Number(r.overhead_amount) || 0))
    groups.set(r.group_key, g)
  }
  const rows = [...groups.values()].map(g => ({
    ...g,
    var_hours: r4(g.work_hours - g.std_hours),
    efficiency: g.work_hours > 0 && g.std_hours > 0 ? r2(g.std_hours / g.work_hours * 100) : null,
  })).sort((a, b) => b.work_hours - a.work_hours)
  const summary = rows.reduce((s, g) => ({
    report_count: s.report_count + g.report_count, qty: r4(s.qty + g.qty), scrap_qty: r4(s.scrap_qty + g.scrap_qty),
    work_hours: r4(s.work_hours + g.work_hours), std_hours: r4(s.std_hours + g.std_hours), var_hours: 0, efficiency: null as number | null,
    labor_amount: r2(s.labor_amount + g.labor_amount), overhead_amount: r2(s.overhead_amount + g.overhead_amount),
  }), { report_count: 0, qty: 0, scrap_qty: 0, work_hours: 0, std_hours: 0, var_hours: 0, efficiency: null as number | null, labor_amount: 0, overhead_amount: 0 })
  summary.var_hours = r4(summary.work_hours - summary.std_hours)
  summary.efficiency = summary.work_hours > 0 && summary.std_hours > 0 ? r2(summary.std_hours / summary.work_hours * 100) : null
  return { rows, summary }
}

export interface DailyFilters { start_date?: string; end_date?: string; dept_code?: string }
export interface DailyRow {
  date: string
  issue_qty: number; issue_amount: number          // 净领料（PL/PB 出 − PJ 入）
  report_count: number; report_qty: number; report_scrap: number; work_hours: number; labor_amount: number; overhead_amount: number
  finish_qty: number; finish_amount: number        // 完工入库 PF
  defect_qty: number; defect_amount: number        // 不良品入库 PS
  plans_active: number                              // 当日有活动的工单数
}

export function queryProductionDaily(db: Database.Database, aid: string, f: DailyFilters = {}): { rows: DailyRow[]; summary: Omit<DailyRow, 'date'> } {
  const rangeConds = (col: string) => {
    const c: string[] = []; const p: any[] = []
    if (f.start_date) { c.push(`${col}>=?`); p.push(f.start_date) }
    if (f.end_date) { c.push(`${col}<=?`); p.push(f.end_date) }
    return { sql: c.length ? ' AND ' + c.join(' AND ') : '', params: p }
  }
  const dept = f.dept_code ? ' AND p.dept_code=?' : ''
  const deptP = f.dept_code ? [f.dept_code] : []
  const blank = (date: string): DailyRow => ({ date, issue_qty: 0, issue_amount: 0, report_count: 0, report_qty: 0, report_scrap: 0, work_hours: 0, labor_amount: 0, overhead_amount: 0, finish_qty: 0, finish_amount: 0, defect_qty: 0, defect_amount: 0, plans_active: 0 })
  const days = new Map<string, DailyRow>()
  const dayPlans = new Map<string, Set<string>>()
  const touch = (date: string, planId?: string) => {
    const d = String(date || '').slice(0, 10)
    if (!days.has(d)) days.set(d, blank(d))
    if (planId) { if (!dayPlans.has(d)) dayPlans.set(d, new Set()); dayPlans.get(d)!.add(planId) }
    return days.get(d)!
  }
  // 库存移动：领料 / 退料 / 完工 / 不良品（自制工单）
  const mv = rangeConds('d.doc_date')
  const moves = db.prepare(`SELECT d.doc_date, d.doc_type, d.plan_id, m.direction, COALESCE(SUM(m.qty),0) qty, COALESCE(SUM(m.amount),0) amount
    FROM scm_stock_move m JOIN scm_doc d ON d.account_set_id=m.account_set_id AND d.doc_type=m.doc_type AND d.doc_no=m.doc_no
    JOIN scm_production_plan p ON p.id=d.plan_id
    WHERE d.account_set_id=? AND d.status='audited' AND COALESCE(p.plan_type,'self')='self' AND d.doc_type IN ('PL','PB','PJ','PF','PS')${mv.sql}${dept}
    GROUP BY d.doc_date, d.doc_type, d.plan_id, m.direction`).all(aid, ...mv.params, ...deptP) as any[]
  for (const m of moves) {
    const row = touch(m.doc_date, m.plan_id)
    const q = Number(m.qty) || 0, a = Number(m.amount) || 0
    if (m.doc_type === 'PL' || m.doc_type === 'PB') { if (m.direction === 'out') { row.issue_qty = r4(row.issue_qty + q); row.issue_amount = r2(row.issue_amount + a) } }
    else if (m.doc_type === 'PJ') { if (m.direction === 'in') { row.issue_qty = r4(row.issue_qty - q); row.issue_amount = r2(row.issue_amount - a) } }
    else if (m.doc_type === 'PF') { if (m.direction === 'in') { row.finish_qty = r4(row.finish_qty + q); row.finish_amount = r2(row.finish_amount + a) } }
    else if (m.doc_type === 'PS') { if (m.direction === 'in') { row.defect_qty = r4(row.defect_qty + q); row.defect_amount = r2(row.defect_amount + a) } }
  }
  // 报工
  const wr = rangeConds('wr.report_date')
  const reports = db.prepare(`SELECT wr.report_date, wr.plan_id, COUNT(*) c, COALESCE(SUM(wr.qty),0) qty, COALESCE(SUM(wr.scrap_qty),0) scrap,
      COALESCE(SUM(wr.work_hours),0) hours, COALESCE(SUM(wr.labor_amount),0) labor, COALESCE(SUM(wr.overhead_amount),0) overhead
    FROM scm_work_report wr LEFT JOIN scm_production_plan p ON p.id=wr.plan_id
    WHERE wr.account_set_id=? AND wr.status='audited'${wr.sql}${dept}
    GROUP BY wr.report_date, wr.plan_id`).all(aid, ...wr.params, ...deptP) as any[]
  for (const r of reports) {
    const row = touch(r.report_date, r.plan_id)
    row.report_count += Number(r.c) || 0
    row.report_qty = r4(row.report_qty + (Number(r.qty) || 0)); row.report_scrap = r4(row.report_scrap + (Number(r.scrap) || 0))
    row.work_hours = r4(row.work_hours + (Number(r.hours) || 0))
    row.labor_amount = r2(row.labor_amount + (Number(r.labor) || 0)); row.overhead_amount = r2(row.overhead_amount + (Number(r.overhead) || 0))
  }
  for (const [d, set] of dayPlans) days.get(d)!.plans_active = set.size
  const rows = [...days.values()].sort((a, b) => b.date.localeCompare(a.date))
  const summary = rows.reduce((s, r) => ({
    issue_qty: r4(s.issue_qty + r.issue_qty), issue_amount: r2(s.issue_amount + r.issue_amount),
    report_count: s.report_count + r.report_count, report_qty: r4(s.report_qty + r.report_qty), report_scrap: r4(s.report_scrap + r.report_scrap),
    work_hours: r4(s.work_hours + r.work_hours), labor_amount: r2(s.labor_amount + r.labor_amount), overhead_amount: r2(s.overhead_amount + r.overhead_amount),
    finish_qty: r4(s.finish_qty + r.finish_qty), finish_amount: r2(s.finish_amount + r.finish_amount),
    defect_qty: r4(s.defect_qty + r.defect_qty), defect_amount: r2(s.defect_amount + r.defect_amount),
    plans_active: 0,
  }), { ...blank(''), date: undefined } as any)
  delete summary.date
  const allPlans = new Set<string>(); for (const set of dayPlans.values()) for (const p of set) allPlans.add(p)
  summary.plans_active = allPlans.size
  return { rows, summary }
}
