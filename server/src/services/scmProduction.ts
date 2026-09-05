import type Database from 'better-sqlite3'
import { getScmMaxAllowedQty, getScmOverrunPolicy } from './scmOverrunPolicy.js'

/** 6 位小数四舍五入（与 scmDoc 中同名 helper 一致） */
export function r6(n: number): number { return Math.round(n * 1000000) / 1000000 }

/**
 * 缺料行「已下推」量（用于下推防重，避免重复下推）：
 *   = Σ(下游单据行 source_line_id=该行 的 qty)  ← 采购/发货等单据下推
 *   + Σ(成品行 source_line_id=该行 的 plan_qty) ← 生产/委外工单下推（一工单多成品后，来源落成品行）
 * 注意：口径只读 scm_production_plan_product（不读工单头 source_line_id），避免与回填的头字段双计。
 */
export function computePushedQty(db: Database.Database, lineId: string): number {
  const doc = db.prepare('SELECT COALESCE(SUM(qty),0) s FROM scm_doc_line WHERE source_line_id=?').get(lineId) as any
  const plan = db.prepare('SELECT COALESCE(SUM(plan_qty),0) s FROM scm_production_plan_product WHERE source_line_id=?').get(lineId) as any
  return r6((Number(doc?.s) || 0) + (Number(plan?.s) || 0))
}

/**
 * 工单领料建议 / 计划「应领 − 已领」。
 *
 * @param issueDocTypes 计入「已领」的单据类型（按 plan_id 关联，出库为领、入库为退）。
 *   默认 ['PL','PB','PJ'] = 领料建议口径（生产领用/补料 出 − 退料 入）。
 *   库存页「计划未领用」传 ['PL','PB','WO','PJ']，把委外发货(WO)也算作已领，覆盖委外计划。
 * @returns 每材料 { item_code, item_name, unit, bom_qty, scrap_rate, need, issued, suggest }，suggest=max(0, need−issued)
 */
export function computeIssueSuggestion(
  db: Database.Database,
  aid: string,
  plan: any,
  // 默认含委外发货 WO：自制工单无 WO 记录不受影响，委外工单据此正确扣减已发料（否则齐套/领料建议恒缺料）
  issueDocTypes: string[] = ['PL', 'PB', 'WO', 'PJ']
) {
  // 用料 = 各成品原料行 × 该成品 plan_qty，按物料汇总（多成品共享原料合并成一行）。
  //   need 已含损耗率；warehouse_code 取该物料任一行仓库、计划原料仓兜底。
  const planYl = plan.yl_warehouse || null
  let needRows = db.prepare(`
    SELECT l.item_code AS item_code, i.name AS item_name, i.unit AS item_unit,
           MIN(l.warehouse_code) AS line_wh,
           COALESCE(SUM( l.qty * (1 + COALESCE(l.scrap_rate,0)/100.0) * COALESCE(pp.plan_qty,0) ),0) AS need,
           MAX(l.qty) AS bom_qty, MAX(l.scrap_rate) AS scrap_rate
    FROM scm_production_plan_line l
    JOIN scm_production_plan_product pp ON pp.id = l.product_id
    LEFT JOIN scm_item i ON i.account_set_id=l.account_set_id AND i.code=l.item_code
    WHERE l.plan_id=?
    GROUP BY l.item_code
    ORDER BY MIN(l.seq)
  `).all(plan.id) as any[]
  // 兜底：无成品明细的旧数据 → 按头 bom_id × 头 plan_qty（单成品旧口径）
  if (!needRows.length && plan.bom_id) {
    needRows = db.prepare(`
      SELECT l.item_code AS item_code, i.name AS item_name, i.unit AS item_unit,
             NULL AS line_wh,
             COALESCE(SUM( l.qty * (1 + COALESCE(l.scrap_rate,0)/100.0) * ? ),0) AS need,
             MAX(l.qty) AS bom_qty, MAX(l.scrap_rate) AS scrap_rate
      FROM scm_bom_line l LEFT JOIN scm_item i ON i.account_set_id=l.account_set_id AND i.code=l.item_code
      WHERE l.bom_id=? AND l.line_type='component' GROUP BY l.item_code ORDER BY MIN(l.seq)
    `).all(Number(plan.plan_qty) || 0, plan.bom_id) as any[]
  }
  const ph = issueDocTypes.map(() => '?').join(',')
  // 已领（一）：已审核单据按库存移动汇总（出为领、入为退）
  const issuedRows = db.prepare(`
    SELECT m.item_code AS item_code, COALESCE(SUM(CASE WHEN m.direction='out' THEN m.qty ELSE -m.qty END),0) AS issued
    FROM scm_stock_move m JOIN scm_doc d ON d.account_set_id=m.account_set_id AND d.doc_type=m.doc_type AND d.doc_no=m.doc_no
    WHERE d.account_set_id=? AND d.plan_id=? AND d.doc_type IN (${ph})
    GROUP BY m.item_code
  `).all(aid, plan.id, ...issueDocTypes) as any[]
  const issuedMap = new Map<string, number>(issuedRows.map(r => [r.item_code, Number(r.issued) || 0]))
  // 已领（二）：未审核草稿尚无库存移动，按明细行数量计入「占用」，方向取单据类型配置——
  //   否则同一工单可反复「生成领料单」生成多张全量草稿（重复领料）。
  const draftRows = db.prepare(`
    SELECT dl.item_code AS item_code,
           COALESCE(SUM(CASE WHEN dt.direction='out' THEN dl.qty ELSE -dl.qty END),0) AS issued
    FROM scm_doc_line dl
    JOIN scm_doc d ON d.id=dl.doc_id
    JOIN scm_doc_type dt ON dt.account_set_id=d.account_set_id AND dt.code=d.doc_type
    WHERE d.account_set_id=? AND d.plan_id=? AND d.status='draft' AND d.doc_type IN (${ph})
    GROUP BY dl.item_code
  `).all(aid, plan.id, ...issueDocTypes) as any[]
  for (const r of draftRows) {
    issuedMap.set(r.item_code, (issuedMap.get(r.item_code) || 0) + (Number(r.issued) || 0))
  }
  return needRows.map(r => {
    const need = r6(Number(r.need) || 0)
    const issued = issuedMap.get(r.item_code) || 0
    const suggest = r6(Math.max(0, need - issued))
    // 行仓库优先、计划原料仓兜底
    const warehouse_code = r.line_wh || planYl
    return { item_code: r.item_code, item_name: r.item_name, unit: r.item_unit, bom_qty: r.bom_qty, scrap_rate: r.scrap_rate, need, issued, suggest, warehouse_code }
  })
}

export type ProductionActionStatus = 'available' | 'blocked_draft' | 'completed' | 'not_required' | 'unavailable'

export interface ProductionActionStateItem {
  status: ProductionActionStatus
  remaining_qty: number
  remaining_lines: number
  base_remaining: number
  max_allowed_qty: number
  overrun_remaining: number
  draft_doc?: { id: string; doc_no: string; doc_type: string }
  reason?: string
}

export interface ProductionPlanActionState {
  issue: ProductionActionStateItem
  finish: ProductionActionStateItem
}

export type IssueSuggestionRow = ReturnType<typeof computeIssueSuggestion>[number]

/**
 * 工单可执行动作的唯一判定口径。
 * 页面展示与生成接口必须共用本函数，避免前端按钮状态和后端防重判断漂移。
 */
export function computeProductionPlanActionState(
  db: Database.Database,
  aid: string,
  plan: any,
  issueRowsOverride?: IssueSuggestionRow[],
): ProductionPlanActionState {
  const unavailable = (): ProductionActionStateItem => ({ status: 'unavailable', remaining_qty: 0, remaining_lines: 0, base_remaining: 0, max_allowed_qty: 0, overrun_remaining: 0 })
  if (!plan || plan.status !== 'released') return { issue: unavailable(), finish: unavailable() }

  const issueRows = issueRowsOverride ?? computeIssueSuggestion(db, aid, plan)
  const issueDemandRows = issueRows.filter(row => (Number(row.need) || 0) > 0.000001)
  const issueRemainingRows = issueRows.filter(row => (Number(row.suggest) || 0) > 0.000001)
  const issueRemainingQty = r6(issueRemainingRows.reduce((sum, row) => sum + (Number(row.suggest) || 0), 0))
  const overrunScope = plan.plan_type === 'outsource' ? 'outsource' : 'production'
  const overrunPolicy = getScmOverrunPolicy(db, aid, overrunScope)
  const issueMaxAllowedQty = r6(issueRows.reduce((sum, row) => sum + getScmMaxAllowedQty(Number(row.need) || 0, overrunPolicy), 0))
  const issueOverrunRemainingRows = issueRows.filter(row => {
    const max = getScmMaxAllowedQty(Number(row.need) || 0, overrunPolicy)
    return max - (Number(row.issued) || 0) > 0.000001
  })
  const issueOverrunRemainingQty = r6(issueRows.reduce((sum, row) => {
    const max = getScmMaxAllowedQty(Number(row.need) || 0, overrunPolicy)
    return sum + Math.max(0, max - (Number(row.issued) || 0))
  }, 0))
  const issueMeta = { base_remaining: issueRemainingQty, max_allowed_qty: issueMaxAllowedQty, overrun_remaining: issueOverrunRemainingQty }
  const auditedFinish = db.prepare(`
    SELECT doc_no,doc_type FROM scm_doc
    WHERE account_set_id=? AND plan_id=? AND status='audited' AND doc_type IN ('PF','WI')
    ORDER BY doc_no DESC LIMIT 1
  `).get(aid, plan.id) as any
  const draftIssue = db.prepare(`
    SELECT id,doc_no,doc_type FROM scm_doc
    WHERE account_set_id=? AND plan_id=? AND status='draft' AND doc_type IN ('PL','PB','WO')
    ORDER BY doc_no DESC LIMIT 1
  `).get(aid, plan.id) as any
  let issue: ProductionActionStateItem
  if (auditedFinish) {
    issue = {
      status: 'unavailable', remaining_qty: issueRemainingQty, remaining_lines: issueRemainingRows.length, ...issueMeta,
      reason: `已有已审核${auditedFinish.doc_type === 'WI' ? '委外入库单' : '完工入库单'} ${auditedFinish.doc_no}，领料已锁定`,
    }
  } else if (draftIssue) {
    issue = {
      status: 'blocked_draft', remaining_qty: issueRemainingQty, remaining_lines: issueRemainingRows.length, ...issueMeta,
      draft_doc: { id: draftIssue.id, doc_no: draftIssue.doc_no, doc_type: draftIssue.doc_type },
    }
  } else if (!issueDemandRows.length) {
    issue = { status: 'not_required', remaining_qty: 0, remaining_lines: 0, ...issueMeta }
  } else if (!issueOverrunRemainingRows.length) {
    issue = { status: 'completed', remaining_qty: 0, remaining_lines: 0, ...issueMeta }
  } else {
    issue = { status: 'available', remaining_qty: issueRemainingQty, remaining_lines: issueOverrunRemainingRows.length, ...issueMeta }
  }

  const products = db.prepare(`
    SELECT id,item_code,plan_qty,finished_qty,COALESCE(scrap_qty,0) AS scrap_qty FROM scm_production_plan_product
    WHERE plan_id=? AND account_set_id=? ORDER BY seq
  `).all(plan.id, aid) as any[]
  // 报废也吃掉了计划份额：计划 10 件做出 8 好 2 废就是做完了，剩余可完工数须扣掉报废
  const finishRemaining = products.map(product => ({
    ...product,
    remain: r6(Math.max(0, (Number(product.plan_qty) || 0) - (Number(product.finished_qty) || 0) - (Number(product.scrap_qty) || 0))),
  })).filter(product => product.remain > 0.000001)
  const finishRemainingQty = r6(finishRemaining.reduce((sum, product) => sum + product.remain, 0))
  const finishDemandQty = r6(products.reduce((sum, product) => sum + (Number(product.plan_qty) || 0), 0))
  const finishMaxAllowedQty = r6(products.reduce((sum, product) => sum + getScmMaxAllowedQty(Number(product.plan_qty) || 0, overrunPolicy), 0))
  const finishOverrunRemaining = products.map(product => ({
    ...product,
    remain: r6(Math.max(0, getScmMaxAllowedQty(Number(product.plan_qty) || 0, overrunPolicy) - (Number(product.finished_qty) || 0) - (Number(product.scrap_qty) || 0))),
  })).filter(product => product.remain > 0.000001)
  const finishOverrunRemainingQty = r6(finishOverrunRemaining.reduce((sum, product) => sum + product.remain, 0))
  const finishMeta = { base_remaining: finishRemainingQty, max_allowed_qty: finishMaxAllowedQty, overrun_remaining: finishOverrunRemainingQty }
  const draftFinish = db.prepare(`
    SELECT id,doc_no,doc_type FROM scm_doc
    WHERE account_set_id=? AND plan_id=? AND status='draft' AND doc_type IN ('PF','WI')
    ORDER BY doc_no DESC LIMIT 1
  `).get(aid, plan.id) as any
  let finish: ProductionActionStateItem
  if (draftFinish) {
    finish = {
      status: 'blocked_draft', remaining_qty: finishRemainingQty, remaining_lines: finishRemaining.length, ...finishMeta,
      draft_doc: { id: draftFinish.id, doc_no: draftFinish.doc_no, doc_type: draftFinish.doc_type },
    }
  } else if (!products.length || finishDemandQty <= 0.000001) {
    finish = { status: 'not_required', remaining_qty: 0, remaining_lines: 0, ...finishMeta }
  } else if (!finishOverrunRemaining.length) {
    finish = { status: 'completed', remaining_qty: 0, remaining_lines: 0, ...finishMeta }
  } else {
    finish = { status: 'available', remaining_qty: finishRemainingQty, remaining_lines: finishOverrunRemaining.length, ...finishMeta }
  }

  return { issue, finish }
}
