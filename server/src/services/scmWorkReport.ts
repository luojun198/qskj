/**
 * 生产报工的数量口径
 *
 * 报工原先只校验「必须选工单」，数量完全不设上限——一张 10 件的工单可以报 500 件，
 * 人工/制费按工时×费率照单全收，最后全部摊进成品成本。这里把报工数量纳入与领料、
 * 完工同一套超额策略（`scmOverrunPolicy`），并提供「已报合格数」供完工入库带默认值。
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

/**
 * 各成品已报工数量（含报废）。
 *
 * @param onlyAudited true 只统计已审核报工；false 连草稿一起算作「占用」，
 *   与领料建议里把草稿领料单计入已领的口径一致，避免反复新建草稿绕过上限。
 */
export function getReportedQtyByProduct(
  db: Database.Database,
  accountSetId: string,
  planId: string,
  options: { onlyAudited?: boolean; excludeReportId?: string } = {},
): Map<string, { qty: number; scrap: number }> {
  const params: any[] = [accountSetId, planId]
  let where = ''
  if (options.onlyAudited) where += " AND status='audited'"
  if (options.excludeReportId) { where += ' AND id<>?'; params.push(options.excludeReportId) }
  const rows = db.prepare(
    `SELECT COALESCE(product_id,'') AS product_id,
            COALESCE(SUM(qty),0) AS qty, COALESCE(SUM(scrap_qty),0) AS scrap
     FROM scm_work_report WHERE account_set_id=? AND plan_id=?${where}
     GROUP BY COALESCE(product_id,'')`,
  ).all(...params) as any[]
  const map = new Map<string, { qty: number; scrap: number }>()
  for (const r of rows) {
    map.set(r.product_id, { qty: Number(r.qty) || 0, scrap: Number(r.scrap) || 0 })
  }
  return map
}

/** 已审核报工的合格数（qty，不含报废），按成品 id 汇总 */
export function getReportedGoodQtyByProduct(
  db: Database.Database,
  accountSetId: string,
  planId: string,
): Map<string, number> {
  const map = new Map<string, number>()
  for (const [pid, v] of getReportedQtyByProduct(db, accountSetId, planId, { onlyAudited: true })) {
    if (pid) map.set(pid, roundScmQty(v.qty))
  }
  return map
}

/**
 * 报工数量校验：该成品「已报工（含草稿占用）+ 本次」的合格数与报废数合计
 * 不得超过计划数（按超额策略放宽）。
 *
 * 未指定 product_id 的计划级报工按工单所有成品的计划数合计校验。
 * @returns 错误信息；通过时返回 null
 */
export function validateWorkReportQty(
  db: Database.Database,
  accountSetId: string,
  input: {
    planId: string
    productId?: string | null
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

  // 指定成品：只比对该成品；未指定：按工单合计（计划级报工）
  const targetId = input.productId || ''
  if (targetId) {
    const product = products.find(p => p.id === targetId)
    if (!product) return '报工的成品不属于该工单'
    const used = reported.get(targetId)
    const usedQty = roundScmQty((used?.qty || 0) + (used?.scrap || 0))
    const maxQty = getScmMaxAllowedQty(Number(product.plan_qty) || 0, policy)
    if (usedQty + incoming > maxQty + EPS) {
      return `成品 ${product.item_code} 计划 ${roundScmQty(Number(product.plan_qty) || 0)}，`
        + `允许上限 ${maxQty}，已报工 ${usedQty}，本次 ${incoming}，禁止超报`
    }
    return null
  }

  const planTotal = products.reduce((sum, p) => sum + (Number(p.plan_qty) || 0), 0)
  let usedTotal = 0
  for (const v of reported.values()) usedTotal += (v.qty || 0) + (v.scrap || 0)
  usedTotal = roundScmQty(usedTotal)
  const maxTotal = getScmMaxAllowedQty(planTotal, policy)
  if (usedTotal + incoming > maxTotal + EPS) {
    return `工单计划合计 ${roundScmQty(planTotal)}，允许上限 ${maxTotal}，已报工 ${usedTotal}，本次 ${incoming}，禁止超报`
  }
  return null
}
