/**
 * 生产报工的数量口径
 *
 * 报工原先只校验「必须选工单」，数量完全不设上限——一张 10 件的工单可以报 500 件，
 * 人工/制费按工时×费率照单全收，最后全部摊进成品成本。这里把报工数量纳入与领料、
 * 完工同一套超额策略（`scmOverrunPolicy`），并提供「已报合格数」供完工入库带默认值。
 *
 * 生产评审 P1-1：数量按 **(成品, 工序)** 维度计——同一件成品走 3 道工序各报一次数是常态，
 * 不能把各工序合计与计划数比。`process_name` 为空视为「整件一道工序」（键 ''）。
 * 「已报合格数」取**末道工序**：有工艺路线则取路线最后一道有报工的工序；无路线则取各工序合格数的最小值
 * （只有走完全部工序的件才算合格），单一工序（或全部未指定工序）时退化为原口径。
 */
import type Database from 'better-sqlite3'
import { getScmMaxAllowedQty, getScmOverrunPolicy, roundScmQty } from './scmOverrunPolicy.js'

const EPS = 1e-6

interface PlanProductRow {
  id: string
  item_code: string
  plan_qty: number
  finished_qty: number
}

export interface ReportedQtyByProcess { qty: number; scrap: number; byProcess: Map<string, { qty: number; scrap: number }> }

const procKey = (v: unknown) => String(v ?? '').trim()

/** 表里是否有 process_name 列（老单测内存库可能没有） */
const processColCache = new WeakMap<Database.Database, boolean>()
function hasProcessColumn(db: Database.Database): boolean {
  let v = processColCache.get(db)
  if (v === undefined) {
    v = (db.prepare("PRAGMA table_info('scm_work_report')").all() as { name: string }[]).some(c => c.name === 'process_name')
    processColCache.set(db, v)
  }
  return v
}

/**
 * 各成品已报工数量（含报废），并按工序拆分。
 *
 * @param onlyAudited true 只统计已审核报工；false 连草稿一起算作「占用」，
 *   与领料建议里把草稿领料单计入已领的口径一致，避免反复新建草稿绕过上限。
 */
export function getReportedQtyByProduct(
  db: Database.Database,
  accountSetId: string,
  planId: string,
  options: { onlyAudited?: boolean; excludeReportId?: string } = {},
): Map<string, ReportedQtyByProcess> {
  const params: any[] = [accountSetId, planId]
  let where = ''
  if (options.onlyAudited) where += " AND status='audited'"
  if (options.excludeReportId) { where += ' AND id<>?'; params.push(options.excludeReportId) }
  const procExpr = hasProcessColumn(db) ? "COALESCE(TRIM(process_name),'')" : "''"
  const rows = db.prepare(
    `SELECT COALESCE(product_id,'') AS product_id, ${procExpr} AS process_name,
            COALESCE(SUM(qty),0) AS qty, COALESCE(SUM(scrap_qty),0) AS scrap
     FROM scm_work_report WHERE account_set_id=? AND plan_id=?${where}
     GROUP BY COALESCE(product_id,''), ${procExpr}`,
  ).all(...params) as any[]
  const map = new Map<string, ReportedQtyByProcess>()
  for (const r of rows) {
    const cur = map.get(r.product_id) || { qty: 0, scrap: 0, byProcess: new Map() }
    const q = Number(r.qty) || 0, s = Number(r.scrap) || 0
    cur.qty = roundScmQty(cur.qty + q); cur.scrap = roundScmQty(cur.scrap + s)
    cur.byProcess.set(procKey(r.process_name), { qty: q, scrap: s })
    map.set(r.product_id, cur)
  }
  return map
}

/** 成品启用工艺路线的工序名顺序（无路线返回 []） */
export function routingProcessNames(db: Database.Database, accountSetId: string, itemCode: string): string[] {
  if (!itemCode) return []
  const has = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='scm_routing_line'").get()
  if (!has) return []
  const rows = db.prepare(`SELECT l.process_name FROM scm_routing r JOIN scm_routing_line l ON l.routing_id=r.id
    WHERE r.account_set_id=? AND r.item_code=? AND r.status='active'
      AND r.id=(SELECT id FROM scm_routing r2 WHERE r2.account_set_id=r.account_set_id AND r2.item_code=r.item_code AND r2.status='active' ORDER BY r2.code LIMIT 1)
    ORDER BY l.seq`).all(accountSetId, itemCode) as { process_name: string }[]
  return rows.map(r => procKey(r.process_name)).filter(Boolean)
}

/**
 * 某成品的「已报合格数」：末道工序口径。
 *  - 只有一个工序键（含全部未指定）→ 该键合格数
 *  - 有工艺路线 → 路线中**最后一道有报工记录**的工序的合格数；路线外的工序（含未指定）不计
 *  - 无路线且多工序 → 各工序合格数最小值
 */
export function finalProcessGoodQty(byProcess: Map<string, { qty: number; scrap: number }>, routing: string[]): number {
  if (!byProcess.size) return 0
  if (byProcess.size === 1) return roundScmQty([...byProcess.values()][0].qty)
  if (routing.length) {
    for (let i = routing.length - 1; i >= 0; i--) {
      const v = byProcess.get(routing[i])
      if (v) return roundScmQty(v.qty)
    }
    // 报工工序全不在路线里：退回最小值口径
  }
  return roundScmQty(Math.min(...[...byProcess.values()].map(v => v.qty)))
}

/** 已审核报工的合格数（qty，不含报废），按成品 id 汇总——末道工序口径 */
export function getReportedGoodQtyByProduct(
  db: Database.Database,
  accountSetId: string,
  planId: string,
): Map<string, number> {
  const map = new Map<string, number>()
  const reported = getReportedQtyByProduct(db, accountSetId, planId, { onlyAudited: true })
  if (!reported.size) return map
  const products = db.prepare('SELECT id, item_code FROM scm_production_plan_product WHERE account_set_id=? AND plan_id=?')
    .all(accountSetId, planId) as { id: string; item_code: string }[]
  for (const [pid, v] of reported) {
    if (!pid) continue
    const item = products.find(p => p.id === pid)?.item_code || ''
    map.set(pid, finalProcessGoodQty(v.byProcess, routingProcessNames(db, accountSetId, item)))
  }
  return map
}

/**
 * 报工数量校验：该成品**同一工序**「已报工（含草稿占用）+ 本次」的合格数与报废数合计
 * 不得超过计划数（按超额策略放宽）。不同工序各自独立计数。
 *
 * 未指定 product_id 的计划级报工按工单所有成品的计划数合计校验（同样按工序）。
 * @returns 错误信息；通过时返回 null
 */
export function validateWorkReportQty(
  db: Database.Database,
  accountSetId: string,
  input: {
    planId: string
    productId?: string | null
    processName?: string | null
    qty?: number | null
    scrapQty?: number | null
    excludeReportId?: string
  },
): string | null {
  const qty = roundScmQty(Number(input.qty) || 0)
  const scrap = roundScmQty(Number(input.scrapQty) || 0)
  if (qty < 0 || scrap < 0) return '报工数量与报废数量不能为负数'
  const incoming = roundScmQty(qty + scrap)
  if (incoming <= EPS) return null

  const plan = db.prepare('SELECT plan_type FROM scm_production_plan WHERE id=? AND account_set_id=?')
    .get(input.planId, accountSetId) as { plan_type?: string } | undefined
  if (!plan) return '关联工单不存在'
  const policy = getScmOverrunPolicy(db, accountSetId, plan.plan_type === 'outsource' ? 'outsource' : 'production')

  const products = db.prepare(
    'SELECT id, item_code, COALESCE(plan_qty,0) AS plan_qty, COALESCE(finished_qty,0) AS finished_qty'
    + ' FROM scm_production_plan_product WHERE account_set_id=? AND plan_id=? ORDER BY seq',
  ).all(accountSetId, input.planId) as PlanProductRow[]
  if (!products.length) return null

  const reported = getReportedQtyByProduct(db, accountSetId, input.planId, {
    excludeReportId: input.excludeReportId,
  })
  const proc = procKey(input.processName)
  const procLabel = proc ? ` 工序「${proc}」` : ''
  const usedOf = (pid: string) => {
    const v = reported.get(pid)?.byProcess.get(proc)
    return roundScmQty((v?.qty || 0) + (v?.scrap || 0))
  }

  // 指定成品：只比对该成品该工序；未指定：按工单合计（计划级报工）
  const targetId = input.productId || ''
  if (targetId) {
    const product = products.find(p => p.id === targetId)
    if (!product) return '报工的成品不属于该工单'
    const usedQty = usedOf(targetId)
    const maxQty = getScmMaxAllowedQty(Number(product.plan_qty) || 0, policy)
    if (usedQty + incoming > maxQty + EPS) {
      return `成品 ${product.item_code}${procLabel} 计划 ${roundScmQty(Number(product.plan_qty) || 0)}，`
        + `允许上限 ${maxQty}，已报工 ${usedQty}，本次 ${incoming}，禁止超报`
    }
    return null
  }

  const planTotal = products.reduce((sum, p) => sum + (Number(p.plan_qty) || 0), 0)
  let usedTotal = 0
  for (const pid of reported.keys()) usedTotal += usedOf(pid)
  usedTotal = roundScmQty(usedTotal)
  const maxTotal = getScmMaxAllowedQty(planTotal, policy)
  if (usedTotal + incoming > maxTotal + EPS) {
    return `工单计划合计 ${roundScmQty(planTotal)}${procLabel}，允许上限 ${maxTotal}，已报工 ${usedTotal}，本次 ${incoming}，禁止超报`
  }
  return null
}
