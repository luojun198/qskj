/**
 * 标准成本差异分析（Standard Cost Variance）
 *
 * - 标准成本（按成品递归卷算）：
 *   标准料 = Σ BOM 主件用量(含损耗) × 子件标准成本(采购件=采购价；自制/半成品=递归标准成本)
 *   标准人工/制费 = Σ 该成品工艺路线工序 标准工时 × 工作中心 人工/制费费率
 *   （子件为半成品时，其标准成本已含下层人工/制费，卷入上层「料」——与实际口径一致）
 * - 实际成本（区间内完工入库 PF 已审核）：
 *   实际料 = Σ(行 unit_cost×qty − labor_cost − overhead_cost)；实际人工 = Σ labor_cost；实际制费 = Σ overhead_cost
 * - 差异 = 实际 − 标准×完工数（正=超支，负=节约），并给差异率。
 */
import type Database from 'better-sqlite3'
import { bomComponents, pickActiveBom } from './scmBom.js'

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100

export interface StdCost { material: number; labor: number; overhead: number; total: number; hours: number }
export interface VarianceRow {
  item_code: string; item_name: string
  finished_qty: number
  std_mat_unit: number; std_labor_unit: number; std_oh_unit: number; std_unit: number
  std_mat: number; std_labor: number; std_oh: number; std_total: number
  act_mat: number; act_labor: number; act_oh: number; act_total: number
  var_mat: number; var_labor: number; var_oh: number; var_total: number
  var_rate: number   // 合计差异率 = 差异/标准合计
  // 生产评审 P2-8：工时差异——标准工时 = 工艺路线 Σ标准工时 × 完工数；实际工时 = 区间内该成品已审核报工工时
  std_hours_unit: number; std_hours: number; act_hours: number; var_hours: number; hours_efficiency: number
}

/** 采购/参考成本兜底（叶子件标准料单价） */
function leafCost(db: Database.Database, aid: string, code: string): number {
  const it = db.prepare('SELECT purchase_price, ref_cost FROM scm_item WHERE account_set_id=? AND code=?').get(aid, code) as any
  return r2(Number(it?.purchase_price) || Number(it?.ref_cost) || 0)
}

/**
 * 单成品标准单位成本（递归卷算，带缓存与环保护）。
 * 返回 clean=false 表示本次计算命中 BOM 环（结果为叶子截断的近似值）——
 * 此类结果**不写入共享缓存**、且其祖先也不缓存，避免「环截断值」污染其它成品的取数（评审 P1-1）。
 * 无环数据下 clean 恒为 true，缓存行为与原实现一致。
 */
function calcStdCost(db: Database.Database, aid: string, code: string, cache: Map<string, StdCost>, stack: Set<string>): { cost: StdCost; clean: boolean } {
  const cached = cache.get(code)
  if (cached) return { cost: cached, clean: true }
  // 环：本件已在祖先链中 → 以采购/参考成本当叶子截断（人工/制费按 0 计），结果标记 unclean 不入缓存
  if (stack.has(code)) {
    const m = leafCost(db, aid, code)
    return { cost: { material: m, labor: 0, overhead: 0, total: m, hours: 0 }, clean: false }
  }
  // 本级工艺路线人工/制费（启用路线第一条）
  const lo = db.prepare(`
    SELECT COALESCE(SUM(l.std_hours * COALESCE(w.labor_rate,0)),0) AS labor,
           COALESCE(SUM(l.std_hours * COALESCE(w.overhead_rate,0)),0) AS overhead,
           COALESCE(SUM(l.std_hours),0) AS hours
    FROM scm_routing r JOIN scm_routing_line l ON l.routing_id=r.id
    LEFT JOIN scm_work_center w ON w.account_set_id=r.account_set_id AND w.code=l.work_center_code
    WHERE r.account_set_id=? AND r.item_code=? AND r.status='active'
      AND r.id=(SELECT id FROM scm_routing r2 WHERE r2.account_set_id=r.account_set_id AND r2.item_code=r.item_code AND r2.status='active' ORDER BY r2.code LIMIT 1)
  `).get(aid, code) as any
  const labor = r2(Number(lo?.labor) || 0)
  const overhead = r2(Number(lo?.overhead) || 0)
  const hours = Math.round((Number(lo?.hours) || 0) * 10000) / 10000
  // BOM 主件（C-1：按当日生效版本；替代料组按主料计标准成本）
  const bomHead = pickActiveBom(db, aid, code)
  const comps = bomHead ? bomComponents(db, bomHead.id).map(l => ({ comp: l.item_code, qty: l.qty, scrap: l.scrap_rate })) : []
  let material = 0
  let clean = true
  if (comps.length) {
    stack.add(code)
    for (const c of comps) {
      const per = (Number(c.qty) || 0) * (1 + (Number(c.scrap) || 0) / 100)
      const sub = calcStdCost(db, aid, c.comp, cache, stack)
      if (!sub.clean) clean = false   // 子链命中环 → 本级结果亦不可信、不缓存
      material = r2(material + per * sub.cost.total)
    }
    stack.delete(code)
  } else {
    // 叶子/采购件：标准料单价 = 采购价 → 参考成本 兜底
    material = leafCost(db, aid, code)
  }
  const cost: StdCost = { material, labor, overhead, total: r2(material + labor + overhead), hours }
  if (clean) cache.set(code, cost)
  return { cost, clean }
}

/** 单成品标准单位成本（对外封装，仅取成本；环安全见 calcStdCost 说明） */
function standardUnitCost(db: Database.Database, aid: string, code: string, cache: Map<string, StdCost>, stack: Set<string>): StdCost {
  return calcStdCost(db, aid, code, cache, stack).cost
}

/** 区间内各完工成品的标准 vs 实际成本差异 */
export function getCostVariance(db: Database.Database, aid: string, startDate?: string, endDate?: string): VarianceRow[] {
  const conds = ["d.account_set_id=?", "d.doc_type='PF'", "d.status='audited'"]; const ps: any[] = [aid]
  if (startDate) { conds.push('d.doc_date>=?'); ps.push(startDate) }
  if (endDate) { conds.push('d.doc_date<=?'); ps.push(endDate) }
  // 实际：按成品汇总完工数与料/人工/制费
  const rows = db.prepare(`
    SELECT l.item_code AS item_code, i.name AS item_name,
      COALESCE(SUM(l.qty),0) AS qty,
      COALESCE(SUM(l.unit_cost * l.qty),0) AS act_total,
      COALESCE(SUM(l.labor_cost),0) AS act_labor,
      COALESCE(SUM(l.overhead_cost),0) AS act_overhead
    FROM scm_doc_line l JOIN scm_doc d ON d.id=l.doc_id
    LEFT JOIN scm_item i ON i.account_set_id=d.account_set_id AND i.code=l.item_code
    WHERE ${conds.join(' AND ')}
      AND (l.line_role IS NULL OR l.line_role='product')
    GROUP BY l.item_code
  `).all(...ps) as any[]
  // 实际工时：区间内已审核报工（按成品物料）；报工挂成品行时取行物料，否则取报工头 item_code
  const hConds = ["wr.account_set_id=?", "wr.status='audited'"]; const hps: any[] = [aid]
  if (startDate) { hConds.push('wr.report_date>=?'); hps.push(startDate) }
  if (endDate) { hConds.push('wr.report_date<=?'); hps.push(endDate) }
  const hoursRows = db.prepare(`SELECT COALESCE(pp.item_code, wr.item_code) AS item_code, COALESCE(SUM(wr.work_hours),0) AS hours
    FROM scm_work_report wr LEFT JOIN scm_production_plan_product pp ON pp.id=wr.product_id
    WHERE ${hConds.join(' AND ')} GROUP BY COALESCE(pp.item_code, wr.item_code)`).all(...hps) as any[]
  const actHours = new Map<string, number>(hoursRows.map(h => [String(h.item_code || ''), Number(h.hours) || 0]))
  const cache = new Map<string, StdCost>()
  const out: VarianceRow[] = []
  for (const r of rows) {
    const qty = r2(Number(r.qty) || 0)
    if (qty <= 0) continue
    const std = standardUnitCost(db, aid, r.item_code, cache, new Set())
    const actLabor = r2(Number(r.act_labor) || 0)
    const actOh = r2(Number(r.act_overhead) || 0)
    const actTotal = r2(Number(r.act_total) || 0)
    const actMat = r2(actTotal - actLabor - actOh)
    const stdMat = r2(std.material * qty), stdLabor = r2(std.labor * qty), stdOh = r2(std.overhead * qty), stdTotal = r2(std.total * qty)
    out.push({
      item_code: r.item_code, item_name: r.item_name || '', finished_qty: qty,
      std_mat_unit: std.material, std_labor_unit: std.labor, std_oh_unit: std.overhead, std_unit: std.total,
      std_mat: stdMat, std_labor: stdLabor, std_oh: stdOh, std_total: stdTotal,
      act_mat: actMat, act_labor: actLabor, act_oh: actOh, act_total: actTotal,
      var_mat: r2(actMat - stdMat), var_labor: r2(actLabor - stdLabor), var_oh: r2(actOh - stdOh), var_total: r2(actTotal - stdTotal),
      var_rate: stdTotal !== 0 ? r2((actTotal - stdTotal) / stdTotal * 100) : 0,
      std_hours_unit: std.hours, std_hours: r2(std.hours * qty), act_hours: r2(actHours.get(r.item_code) || 0),
      var_hours: r2((actHours.get(r.item_code) || 0) - std.hours * qty),
      hours_efficiency: (actHours.get(r.item_code) || 0) > 0 ? r2(std.hours * qty / (actHours.get(r.item_code) || 0) * 100) : 0,
    })
  }
  out.sort((a, b) => Math.abs(b.var_total) - Math.abs(a.var_total))
  return out
}
