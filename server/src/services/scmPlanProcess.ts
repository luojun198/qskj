/**
 * 工单工序（生产评审 C-2）与产能 / 交期推算（C-3）
 *
 *  - 下达 / 变更单新增成品时按成品启用工艺路线快照工序行（plan_qty = 成品计划数）；变更计划数时同步
 *  - 报工挂工序行：报工的 process_name 命中该成品工序行 → process_id；流转校验（参数 scm:process_flow_strict，默认开）：
 *      本工序累计（合格 + 不良，含草稿占用）+ 本次 ≤ 前道工序已审核完成数（首道 ≤ 计划数，由 validateWorkReportQty 兜底）
 *  - 审核 / 反审核报工后 syncPlanProcessQty 重算工序行 done / scrap
 *  - 工序在制 = 转入 − 完成 − 不良；转入 = 前道完成数（首道 = 计划数）
 *  - 产能负荷：工作中心 daily_capacity_hours；负荷 = Σ 已审核工单未完成量 × 单件标准工时，按工单交期所在周分桶
 *  - 交期推算：按工序顺序累加 剩余量 × 标准工时 ÷ 工作中心日产能 → 预计完工日（无产能的工序按 0 天计）
 */
import type Database from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'

const r4 = (n: number) => Math.round((Number(n) || 0) * 10000) / 10000
const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100
const EPS = 1e-6
const procKey = (v: unknown) => String(v ?? '').trim()

const tableCache = new WeakMap<Database.Database, boolean>()
export function hasProcessTable(db: Database.Database): boolean {
  let v = tableCache.get(db)
  if (v === undefined) {
    v = !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='scm_production_plan_process'").get()
    tableCache.set(db, v)
  }
  return v
}

export interface PlanProcessRow {
  id: string; plan_id: string; product_id: string; seq: number; process_name: string; work_center_code: string | null
  std_hours: number; is_outsource: number; plan_qty: number; done_qty: number; scrap_qty: number
}

export function listPlanProcesses(db: Database.Database, aid: string, planId: string, productId?: string): PlanProcessRow[] {
  if (!hasProcessTable(db)) return []
  const ps: any[] = [aid, planId]
  let where = 'account_set_id=? AND plan_id=?'
  if (productId) { where += ' AND product_id=?'; ps.push(productId) }
  return db.prepare(`SELECT * FROM scm_production_plan_process WHERE ${where} ORDER BY product_id, seq`).all(...ps) as PlanProcessRow[]
}

/** 成品启用路线的工序行 */
function activeRoutingLines(db: Database.Database, aid: string, itemCode: string): any[] {
  return db.prepare(`SELECT l.seq, l.process_name, l.work_center_code, l.std_hours, l.is_outsource FROM scm_routing r JOIN scm_routing_line l ON l.routing_id=r.id
    WHERE r.account_set_id=? AND r.item_code=? AND r.status='active'
      AND r.id=(SELECT id FROM scm_routing r2 WHERE r2.account_set_id=r.account_set_id AND r2.item_code=r.item_code AND r2.status='active' ORDER BY r2.code LIMIT 1)
    ORDER BY l.seq`).all(aid, itemCode) as any[]
}

/**
 * 为工单各成品生成 / 同步工序行：
 *  - 成品无工序行 → 按启用路线快照（无路线则不生成，沿用整件一道口径）
 *  - 已有工序行 → 只同步 plan_qty（变更单改计划数）
 *  - 成品已不存在的工序行删除
 */
export function ensurePlanProcesses(db: Database.Database, aid: string, planId: string): number {
  if (!hasProcessTable(db)) return 0
  const products = db.prepare('SELECT id, item_code, plan_qty FROM scm_production_plan_product WHERE account_set_id=? AND plan_id=? ORDER BY seq').all(aid, planId) as any[]
  const ins = db.prepare(`INSERT INTO scm_production_plan_process (id,account_set_id,plan_id,product_id,seq,process_name,work_center_code,std_hours,is_outsource,plan_qty) VALUES (?,?,?,?,?,?,?,?,?,?)`)
  let created = 0
  const keep = new Set<string>()
  for (const p of products) {
    keep.add(p.id)
    const existing = db.prepare('SELECT COUNT(*) c FROM scm_production_plan_process WHERE product_id=?').get(p.id) as any
    if (Number(existing?.c) > 0) {
      db.prepare('UPDATE scm_production_plan_process SET plan_qty=? WHERE product_id=?').run(Number(p.plan_qty) || 0, p.id)
      continue
    }
    let seq = 0
    for (const l of activeRoutingLines(db, aid, p.item_code)) {
      const name = procKey(l.process_name)
      if (!name) continue
      seq++
      ins.run(uuidv4(), aid, planId, p.id, seq, name, l.work_center_code ?? null, Number(l.std_hours) || 0, l.is_outsource ? 1 : 0, Number(p.plan_qty) || 0)
      created++
    }
  }
  const ids = [...keep]
  db.prepare(`DELETE FROM scm_production_plan_process WHERE account_set_id=? AND plan_id=? ${ids.length ? `AND product_id NOT IN (${ids.map(() => '?').join(',')})` : ''}`).run(aid, planId, ...ids)
  return created
}

/** 报工所属工序行：按 (成品, 工序名) 命中；无工序行返回 null */
export function resolveProcessId(db: Database.Database, aid: string, productId: string | null | undefined, processName: string | null | undefined): string | null {
  if (!hasProcessTable(db) || !productId) return null
  const name = procKey(processName)
  if (!name) return null
  const row = db.prepare('SELECT id FROM scm_production_plan_process WHERE account_set_id=? AND product_id=? AND process_name=? LIMIT 1').get(aid, productId, name) as any
  return row?.id || null
}

function flowStrict(db: Database.Database, aid: string): boolean {
  const row = db.prepare("SELECT param_value FROM system_params WHERE account_set_id=? AND param_key='scm:process_flow_strict'").get(aid) as any
  const v = String(row?.param_value ?? '1').trim()
  return v !== '0' && v.toLowerCase() !== 'false'
}

/**
 * 工序流转校验：本工序「已报（含草稿占用）+ 本次」的合格 + 不良 不得超过前道工序已审核完成数。
 * 首道工序不校验（数量上限由 validateWorkReportQty 按计划数把关）。
 * @returns 错误信息；通过 / 不适用返回 null
 */
export function validateProcessFlow(
  db: Database.Database, aid: string,
  input: { productId?: string | null; processName?: string | null; qty?: number | null; scrapQty?: number | null; excludeReportId?: string },
): string | null {
  if (!hasProcessTable(db) || !input.productId) return null
  const name = procKey(input.processName)
  if (!name) return null
  const cur = db.prepare('SELECT * FROM scm_production_plan_process WHERE account_set_id=? AND product_id=? AND process_name=?').get(aid, input.productId, name) as PlanProcessRow | undefined
  if (!cur || cur.seq <= 1) return null
  if (!flowStrict(db, aid)) return null
  const prev = db.prepare('SELECT * FROM scm_production_plan_process WHERE account_set_id=? AND product_id=? AND seq<? ORDER BY seq DESC LIMIT 1').get(aid, input.productId, cur.seq) as PlanProcessRow | undefined
  if (!prev) return null
  const ps: any[] = [aid, input.productId, name]
  let ex = ''
  if (input.excludeReportId) { ex = ' AND id<>?'; ps.push(input.excludeReportId) }
  const used = db.prepare(`SELECT COALESCE(SUM(qty+scrap_qty),0) q FROM scm_work_report WHERE account_set_id=? AND product_id=? AND TRIM(COALESCE(process_name,''))=?${ex}`).get(...ps) as any
  const incoming = r4((Number(input.qty) || 0) + (Number(input.scrapQty) || 0))
  const total = r4((Number(used?.q) || 0) + incoming)
  const prevDone = r4(Number(prev.done_qty) || 0)
  if (total > prevDone + EPS) {
    return `工序「${name}」累计报工 ${total} 超过前道「${prev.process_name}」已审核完成数 ${prevDone}（可在 系统参数→供应链 关闭工序流转校验）`
  }
  return null
}

/** 按已审核报工重算工单各工序行的 done / scrap（报工 process_id 优先，回落到工序名） */
export function syncPlanProcessQty(db: Database.Database, aid: string, planId: string): void {
  if (!hasProcessTable(db)) return
  db.prepare(`UPDATE scm_production_plan_process SET
      done_qty=COALESCE((SELECT SUM(w.qty) FROM scm_work_report w WHERE w.account_set_id=scm_production_plan_process.account_set_id AND w.status='audited'
        AND (w.process_id=scm_production_plan_process.id OR (w.process_id IS NULL AND w.product_id=scm_production_plan_process.product_id AND TRIM(COALESCE(w.process_name,''))=scm_production_plan_process.process_name))),0),
      scrap_qty=COALESCE((SELECT SUM(w.scrap_qty) FROM scm_work_report w WHERE w.account_set_id=scm_production_plan_process.account_set_id AND w.status='audited'
        AND (w.process_id=scm_production_plan_process.id OR (w.process_id IS NULL AND w.product_id=scm_production_plan_process.product_id AND TRIM(COALESCE(w.process_name,''))=scm_production_plan_process.process_name))),0)
    WHERE account_set_id=? AND plan_id=?`).run(aid, planId)
}

export interface ProcessWipRow extends PlanProcessRow {
  plan_code: string; plan_status: string; item_code: string; item_name: string; work_center_name: string | null
  in_qty: number; wip_qty: number; remain_qty: number; remain_hours: number
}

/** 工序在制表：转入 = 前道完成（首道 = 计划数）；在制 = 转入 − 完成 − 不良；剩余 = 计划 − 完成 − 不良 */
export function queryProcessWip(db: Database.Database, aid: string, f: { plan_code?: string; item_code?: string; work_center_code?: string; status?: string; only_wip?: string | boolean } = {}): ProcessWipRow[] {
  if (!hasProcessTable(db)) return []
  const conds = ["x.account_set_id=?", "COALESCE(p.plan_type,'self')='self'"]; const ps: any[] = [aid]
  conds.push(f.status ? 'p.status=?' : "p.status='released'"); if (f.status) ps.push(f.status)
  if (f.plan_code) { conds.push('p.code LIKE ?'); ps.push(`%${f.plan_code}%`) }
  if (f.item_code) { conds.push('(pp.item_code LIKE ? OR i.name LIKE ?)'); ps.push(`%${f.item_code}%`, `%${f.item_code}%`) }
  if (f.work_center_code) { conds.push('x.work_center_code=?'); ps.push(f.work_center_code) }
  const rows = db.prepare(`SELECT x.*, p.code AS plan_code, p.status AS plan_status, pp.item_code, i.name AS item_name, w.name AS work_center_name
    FROM scm_production_plan_process x
    JOIN scm_production_plan p ON p.id=x.plan_id
    JOIN scm_production_plan_product pp ON pp.id=x.product_id
    LEFT JOIN scm_item i ON i.account_set_id=x.account_set_id AND i.code=pp.item_code
    LEFT JOIN scm_work_center w ON w.account_set_id=x.account_set_id AND w.code=x.work_center_code
    WHERE ${conds.join(' AND ')} ORDER BY p.code, pp.seq, x.seq`).all(...ps) as any[]
  const out: ProcessWipRow[] = []
  let prevDone = 0; let prevProduct = ''
  for (const r of rows) {
    if (r.product_id !== prevProduct) { prevProduct = r.product_id; prevDone = Number(r.plan_qty) || 0 }
    const inQty = r4(prevDone)
    const done = Number(r.done_qty) || 0, scrap = Number(r.scrap_qty) || 0
    const wip = r4(inQty - done - scrap)
    const remain = r4(Math.max(0, (Number(r.plan_qty) || 0) - done - scrap))
    out.push({ ...r, in_qty: inQty, wip_qty: wip, remain_qty: remain, remain_hours: r4(remain * (Number(r.std_hours) || 0)) })
    prevDone = done
  }
  return (f.only_wip === '1' || f.only_wip === true) ? out.filter(r => r.wip_qty > EPS) : out
}

/** 工单交期推算：按工序顺序累加 剩余量 × 标准工时 ÷ 工作中心日产能（无产能的工序按 0 天） */
export function estimatePlanFinish(db: Database.Database, aid: string, planId: string, from = new Date()): { est_days: number; est_finish_date: string | null; remain_hours: number; steps: Array<{ process_name: string; work_center_code: string | null; remain_qty: number; remain_hours: number; days: number }> } {
  const rows = listPlanProcesses(db, aid, planId)
  const cap = new Map<string, number>((db.prepare('SELECT code, COALESCE(daily_capacity_hours,0) h FROM scm_work_center WHERE account_set_id=?').all(aid) as any[]).map(w => [String(w.code), Number(w.h) || 0]))
  // 多成品并行：取各成品工序链的最长者
  const byProduct = new Map<string, PlanProcessRow[]>()
  for (const r of rows) { if (!byProduct.has(r.product_id)) byProduct.set(r.product_id, []); byProduct.get(r.product_id)!.push(r) }
  let maxDays = 0; let totalHours = 0
  const steps: Array<{ process_name: string; work_center_code: string | null; remain_qty: number; remain_hours: number; days: number }> = []
  for (const chain of byProduct.values()) {
    let days = 0
    for (const r of chain) {
      const remain = r4(Math.max(0, (Number(r.plan_qty) || 0) - (Number(r.done_qty) || 0) - (Number(r.scrap_qty) || 0)))
      const hours = r4(remain * (Number(r.std_hours) || 0))
      const c = r.work_center_code ? (cap.get(r.work_center_code) || 0) : 0
      const d = c > 0 ? r2(hours / c) : 0
      days += d; totalHours = r4(totalHours + hours)
      steps.push({ process_name: r.process_name, work_center_code: r.work_center_code, remain_qty: remain, remain_hours: hours, days: d })
    }
    maxDays = Math.max(maxDays, days)
  }
  const estDays = Math.ceil(maxDays)
  let estDate: string | null = null
  if (rows.length) {
    const d = new Date(from); d.setDate(d.getDate() + estDays)
    estDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }
  return { est_days: estDays, est_finish_date: estDate, remain_hours: totalHours, steps }
}

export interface CapacityRow { work_center_code: string; work_center_name: string; daily_capacity_hours: number; week: string; capacity_hours: number; load_hours: number; utilization: number | null; plans: string[] }

/** 产能负荷表：已审核工单未完成工序的剩余工时，按工作中心 × 交期所在周（周一为起点）分桶；周产能 = 日产能 × 5 */
export function queryCapacityLoad(db: Database.Database, aid: string, f: { start_date?: string; end_date?: string; work_center_code?: string } = {}): { rows: CapacityRow[]; unscheduled_hours: number } {
  if (!hasProcessTable(db)) return { rows: [], unscheduled_hours: 0 }
  const conds = ["x.account_set_id=?", "p.status='released'", "COALESCE(p.plan_type,'self')='self'"]; const ps: any[] = [aid]
  if (f.work_center_code) { conds.push('x.work_center_code=?'); ps.push(f.work_center_code) }
  const rows = db.prepare(`SELECT x.work_center_code, x.std_hours, x.plan_qty, x.done_qty, x.scrap_qty, p.code AS plan_code, p.end_date, p.start_date
    FROM scm_production_plan_process x JOIN scm_production_plan p ON p.id=x.plan_id WHERE ${conds.join(' AND ')}`).all(...ps) as any[]
  const centers = new Map<string, { name: string; cap: number }>((db.prepare('SELECT code, name, COALESCE(daily_capacity_hours,0) h FROM scm_work_center WHERE account_set_id=?').all(aid) as any[]).map(w => [String(w.code), { name: w.name, cap: Number(w.h) || 0 }]))
  const weekOf = (dateStr: string | null) => {
    const d = dateStr ? new Date(`${String(dateStr).slice(0, 10)}T00:00:00`) : new Date()
    if (Number.isNaN(d.getTime())) return null
    const day = (d.getDay() + 6) % 7   // 周一 = 0
    d.setDate(d.getDate() - day)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }
  const buckets = new Map<string, CapacityRow>()
  let unscheduled = 0
  for (const r of rows) {
    const remain = Math.max(0, (Number(r.plan_qty) || 0) - (Number(r.done_qty) || 0) - (Number(r.scrap_qty) || 0))
    const hours = r4(remain * (Number(r.std_hours) || 0))
    if (hours <= EPS) continue
    if (!r.work_center_code) { unscheduled = r4(unscheduled + hours); continue }
    const week = weekOf(r.end_date || r.start_date)
    if (!week) { unscheduled = r4(unscheduled + hours); continue }
    if (f.start_date && week < String(f.start_date).slice(0, 10)) continue
    if (f.end_date && week > String(f.end_date).slice(0, 10)) continue
    const key = `${r.work_center_code}|${week}`
    const c = centers.get(r.work_center_code)
    const b = buckets.get(key) || { work_center_code: r.work_center_code, work_center_name: c?.name || r.work_center_code, daily_capacity_hours: c?.cap || 0, week, capacity_hours: r2((c?.cap || 0) * 5), load_hours: 0, utilization: null as number | null, plans: [] as string[] }
    b.load_hours = r4(b.load_hours + hours)
    if (!b.plans.includes(r.plan_code)) b.plans.push(r.plan_code)
    buckets.set(key, b)
  }
  const out = [...buckets.values()].map(b => ({ ...b, utilization: b.capacity_hours > 0 ? r2(b.load_hours / b.capacity_hours * 100) : null }))
    .sort((a, b) => a.week.localeCompare(b.week) || a.work_center_code.localeCompare(b.work_center_code))
  return { rows: out, unscheduled_hours: unscheduled }
}
