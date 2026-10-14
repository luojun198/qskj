/**
 * 生产 / 委外计划列表（GET /scm/production-plans）的多级排序白名单。
 * key 与前端 ProductionPlan.vue 的列设置列 key 一致；表达式依赖主查询里的别名 p(scm_production_plan)，
 * 其余关联取值（首个成品、MRP 状态、下游单据数）用相关子查询。
 */
import { buildMultiOrderBy, type BuiltOrderBy } from '../utils/multiSort.js'

const MRP_SOURCE_WHERE = `s.account_set_id=p.account_set_id AND s.source_id=p.id AND s.source_kind IN ('production_plan','outsource_plan') AND md.status IN ('draft','audited')`

export const PLAN_LIST_SORT_WHITELIST: Record<string, string> = {
  code: 'p.code',
  plan_type: "COALESCE(p.plan_type,'self')",
  item_code: 'COALESCE((SELECT pp2.item_code FROM scm_production_plan_product pp2 WHERE pp2.plan_id=p.id ORDER BY pp2.seq LIMIT 1), p.item_code)',
  item_name: `COALESCE((SELECT i2.name FROM scm_production_plan_product pp3 LEFT JOIN scm_item i2 ON i2.account_set_id=pp3.account_set_id AND i2.code=pp3.item_code WHERE pp3.plan_id=p.id ORDER BY pp3.seq LIMIT 1),
    (SELECT i3.name FROM scm_item i3 WHERE i3.account_set_id=p.account_set_id AND i3.code=p.item_code LIMIT 1))`,
  plan_qty: 'p.plan_qty',
  progress: 'CASE WHEN COALESCE(p.plan_qty,0) > 0 THEN COALESCE(p.finished_qty,0) * 1.0 / p.plan_qty ELSE 0 END',
  dates: 'COALESCE(p.start_date, substr(p.created_at,1,10))',
  supplier_code: 'COALESCE((SELECT sp2.name FROM scm_partner sp2 WHERE sp2.account_set_id=p.account_set_id AND sp2.code=p.supplier_code LIMIT 1), p.supplier_code)',
  // 按业务流程顺序：草稿 → 已审核 → 已关闭
  status: "CASE COALESCE(p.status,'draft') WHEN 'draft' THEN 0 WHEN 'released' THEN 1 WHEN 'closed' THEN 2 ELSE 3 END",
  mrp_status: `(SELECT md.status FROM scm_mrp_source s JOIN scm_doc md ON md.id=s.mrp_doc_id WHERE ${MRP_SOURCE_WHERE} LIMIT 1)`,
  doc_count: '(SELECT COUNT(*) FROM scm_doc dd WHERE dd.account_set_id=p.account_set_id AND dd.plan_id=p.id)',
  remark: 'p.remark',
}

export const PLAN_LIST_NUMERIC_SORT_KEYS: ReadonlySet<string> = new Set(['plan_qty', 'progress', 'status', 'doc_count'])

/** 返回完整 `ORDER BY ...`；未传/无有效排序 → 计划号降序（旧行为）。 */
export function buildPlanListOrderBy(sort: unknown): BuiltOrderBy {
  return buildMultiOrderBy(sort, {
    whitelist: PLAN_LIST_SORT_WHITELIST,
    numericKeys: PLAN_LIST_NUMERIC_SORT_KEYS,
    defaultOrderBy: 'p.code DESC',
    tieBreakers: ['p.code DESC', 'p.id ASC'],
  })
}
