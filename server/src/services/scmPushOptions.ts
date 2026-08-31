import type Database from 'better-sqlite3'
import { buildSalesOrderAvailabilityLines } from './scmSalesOrderAvailability.js'
import { computeIssueSuggestion, computeProductionPlanActionState, r6 } from './scmProduction.js'
import { getMrpSourceState, type MrpSourceKind } from './scmMrpDocument.js'
import { getScmOverrunPolicy } from './scmOverrunPolicy.js'

export type ScmPushSourceKind = MrpSourceKind
export type ScmPushOptionStatus = 'available' | 'partial' | 'blocked_draft' | 'completed' | 'unavailable'

export interface ScmPushTargetDoc {
  id: string
  doc_no: string
  doc_type: string
  status: string
}

export interface ScmPushOption {
  action: 'sales_dispatch' | 'mrp' | 'issue' | 'finish'
  target_doc_type: string
  label: string
  status: ScmPushOptionStatus
  remaining_qty: number
  remaining_lines: number
  base_remaining?: number
  max_allowed_qty?: number
  overrun_remaining?: number
  existing_doc?: ScmPushTargetDoc | null
  reason?: string
}

const EPS = 0.000001

function salesAvailability(db: Database.Database, aid: string, sourceId: string) {
  const doc = db.prepare("SELECT * FROM scm_doc WHERE id=? AND account_set_id=? AND doc_type='SOa'").get(sourceId, aid) as any
  if (!doc) throw new Error('销售订单不存在')
  if (doc.status !== 'audited') throw new Error('仅已审核的销售订单可下推')
  const rows = db.prepare(`
    SELECT l.*, COALESCE(s.qty,0) on_hand,
      ((SELECT COALESCE(SUM(l2.qty-(SELECT COALESCE(SUM(srl.qty),0)
          FROM scm_doc_line srl JOIN scm_doc srd ON srd.id=srl.doc_id
          WHERE srl.source_line_id=l2.id AND srd.account_set_id=l.account_set_id
            AND srd.doc_type='SR' AND srd.status='audited')),0)
        FROM scm_doc_line l2 JOIN scm_doc d2 ON d2.id=l2.doc_id
        WHERE l2.source_line_id=l.id AND d2.doc_type='SO' AND d2.status<>'voided')
       +(SELECT COALESCE(SUM(pp.plan_qty),0) FROM scm_production_plan_product pp WHERE pp.source_line_id=l.id)) pushed_qty,
      ((SELECT COALESCE(SUM(l2.qty-(SELECT COALESCE(SUM(srl.qty),0)
          FROM scm_doc_line srl JOIN scm_doc srd ON srd.id=srl.doc_id
          WHERE srl.source_line_id=l2.id AND srd.account_set_id=l.account_set_id
            AND srd.doc_type='SR' AND srd.status='audited')),0)
        FROM scm_doc_line l2 JOIN scm_doc d2 ON d2.id=l2.doc_id
        WHERE l2.source_line_id=l.id AND d2.doc_type='SO' AND d2.status='audited')
       +(SELECT COALESCE(SUM(pp.plan_qty),0) FROM scm_production_plan_product pp WHERE pp.source_line_id=l.id)) mrp_pushed_qty,
      (SELECT COALESCE(SUM(ol.qty-(SELECT COALESCE(SUM(ol2.qty-(SELECT COALESCE(SUM(srl.qty),0)
          FROM scm_doc_line srl JOIN scm_doc srd ON srd.id=srl.doc_id
          WHERE srl.source_line_id=ol2.id AND srd.account_set_id=ol.account_set_id
            AND srd.doc_type='SR' AND srd.status='audited')),0)
        FROM scm_doc_line ol2 JOIN scm_doc od2 ON od2.id=ol2.doc_id
        WHERE ol2.source_line_id=ol.id AND od2.doc_type='SO' AND od2.status<>'voided')),0)
       FROM scm_doc_line ol JOIN scm_doc od ON od.id=ol.doc_id
       WHERE od.account_set_id=l.account_set_id AND od.doc_type='SOa' AND od.status='audited' AND od.id<>?
         AND ol.item_code=l.item_code AND IFNULL(ol.warehouse_code,'')=IFNULL(l.warehouse_code,'')) other_reserved
    FROM scm_doc_line l
    LEFT JOIN scm_stock s ON s.account_set_id=l.account_set_id AND s.item_code=l.item_code
      AND IFNULL(s.warehouse_code,'')=IFNULL(l.warehouse_code,'')
    WHERE l.doc_id=? ORDER BY l.seq`).all(sourceId, sourceId) as any[]
  const historicalMr = db.prepare(`SELECT ml.item_code,IFNULL(ml.warehouse_code,'') wh,COALESCE(SUM(ml.qty),0) qty
    FROM scm_doc_line ml JOIN scm_doc md ON md.id=ml.doc_id
    WHERE md.account_set_id=? AND md.doc_type='MR' AND md.source_doc_id=?
    GROUP BY ml.item_code,IFNULL(ml.warehouse_code,'')`).all(aid, sourceId) as any[]
  const activeMrp = db.prepare(`SELECT s.item_code,IFNULL(json_extract(s.snapshot_json,'$.warehouse_code'),'') wh,
      COALESCE(SUM(s.allocated_net_qty),0) qty
    FROM scm_mrp_source s JOIN scm_doc d ON d.id=s.mrp_doc_id
    WHERE s.account_set_id=? AND s.source_kind='sales_order' AND s.source_id=?
      AND d.doc_type='MRP' AND d.status IN ('draft','audited')
    GROUP BY s.item_code,IFNULL(json_extract(s.snapshot_json,'$.warehouse_code'),'')`).all(aid, sourceId) as any[]
  const policy = getScmOverrunPolicy(db, aid, 'sales')
  const coverage = [...historicalMr, ...activeMrp]
  return {
    doc,
    lines: buildSalesOrderAvailabilityLines(rows, coverage, { overrunRate: policy.enabled ? policy.rate : 0 }),
    mrpLines: buildSalesOrderAvailabilityLines(
      rows.map(row => ({ ...row, pushed_qty: row.mrp_pushed_qty })),
      coverage,
      { overrunRate: policy.enabled ? policy.rate : 0 },
    ),
  }
}

function mrpOption(db: Database.Database, aid: string, kind: ScmPushSourceKind, sourceId: string): ScmPushOption {
  const state = getMrpSourceState(db, aid, kind, sourceId)
  return {
    action: 'mrp', target_doc_type: 'MRP',
    label: state.existing_doc ? '打开 MRP 计算单' : '生成 MRP 计算单',
    status: state.status as ScmPushOptionStatus,
    remaining_qty: state.remaining_qty,
    remaining_lines: state.remaining_lines,
    existing_doc: state.existing_doc,
    reason: state.reason,
  }
}

function buildSalesOptions(db: Database.Database, aid: string, sourceId: string): ScmPushOption[] {
  try {
    const { lines, mrpLines } = salesAvailability(db, aid, sourceId)
    const totalRemain = r6(lines.reduce((sum, row) => sum + Math.max(0, Number(row.remain) || 0), 0))
    const totalMrpRemain = r6(mrpLines.reduce((sum, row) => sum + Math.max(0, Number(row.remain) || 0), 0))
    const totalShip = r6(lines.reduce((sum, row) => sum + (Number(row.ship_qty) || 0), 0))
    const totalMaxAllowed = r6(lines.reduce((sum, row) => sum + (Number(row.max_allowed_qty) || 0), 0))
    const totalOverrunRemain = r6(lines.reduce((sum, row) => sum + (Number(row.overrun_remaining) || 0), 0))
    const totalShort = r6(mrpLines.reduce((sum, row) => sum + (Number(row.short_qty) || 0), 0))
    const pushed = lines.some(row => (Number(row.pushed_qty) || 0) > EPS)
    const remainingLines = lines.filter(row => Number(row.base_remaining ?? row.remain) > EPS).length
    const draft = db.prepare("SELECT id,doc_no,doc_type,status FROM scm_doc WHERE account_set_id=? AND source_doc_id=? AND doc_type='SO' AND status='draft' ORDER BY doc_no DESC LIMIT 1").get(aid, sourceId) as any
    let dispatch: ScmPushOption
    if (draft) {
      dispatch = { action: 'sales_dispatch', target_doc_type: 'SO', label: `打开销售出库草稿 ${draft.doc_no}`, status: 'blocked_draft', remaining_qty: totalRemain, remaining_lines: remainingLines, base_remaining: totalRemain, max_allowed_qty: totalMaxAllowed, overrun_remaining: totalOverrunRemain, existing_doc: draft, reason: '请先审核或删除已有销售出库草稿' }
    } else if (totalRemain <= EPS) {
      dispatch = { action: 'sales_dispatch', target_doc_type: 'SO', label: '销售出库已完成', status: 'completed', remaining_qty: 0, remaining_lines: 0 }
    } else {
      dispatch = {
        action: 'sales_dispatch', target_doc_type: 'SO',
        label: pushed ? '继续库存处理/销售出库' : '库存处理/销售出库',
        status: pushed ? 'partial' : 'available',
        remaining_qty: totalRemain, remaining_lines: remainingLines,
        base_remaining: totalRemain, max_allowed_qty: totalMaxAllowed, overrun_remaining: totalOverrunRemain,
        reason: totalShip + EPS < totalRemain ? '当前库存不足，可先保存草稿，审核时校验库存' : undefined,
      }
    }
    const mrp = mrpOption(db, aid, 'sales_order', sourceId)
    if (!mrp.existing_doc && totalShort <= EPS) {
      mrp.status = totalMrpRemain <= EPS ? 'completed' : 'unavailable'
      mrp.remaining_qty = 0
      mrp.remaining_lines = 0
      mrp.reason = totalMrpRemain <= EPS ? '销售需求已处理完成' : '当前库存可覆盖，无需进入 MRP'
    }
    return [dispatch, mrp]
  } catch (error: any) {
    const reason = error?.message || '销售订单不可下推'
    return [
      { action: 'sales_dispatch', target_doc_type: 'SO', label: '库存处理/销售出库', status: 'unavailable', remaining_qty: 0, remaining_lines: 0, reason },
      { action: 'mrp', target_doc_type: 'MRP', label: '生成 MRP 计算单', status: 'unavailable', remaining_qty: 0, remaining_lines: 0, reason },
    ]
  }
}

function buildPlanOptions(db: Database.Database, aid: string, sourceId: string, kind: 'production_plan' | 'outsource_plan'): ScmPushOption[] {
  const plan = db.prepare('SELECT * FROM scm_production_plan WHERE id=? AND account_set_id=?').get(sourceId, aid) as any
  const isOut = kind === 'outsource_plan'
  if (!plan || plan.plan_type !== (isOut ? 'outsource' : 'self')) {
    const reason = `${isOut ? '委外' : '生产'}计划不存在`
    return [
      { action: 'mrp', target_doc_type: 'MRP', label: '生成 MRP 计算单', status: 'unavailable', remaining_qty: 0, remaining_lines: 0, reason },
      { action: 'issue', target_doc_type: isOut ? 'WO' : 'PL', label: isOut ? '委外发货' : '生产领料', status: 'unavailable', remaining_qty: 0, remaining_lines: 0, reason },
      { action: 'finish', target_doc_type: isOut ? 'WI' : 'PF', label: isOut ? '委外入库' : '完工入库', status: 'unavailable', remaining_qty: 0, remaining_lines: 0, reason },
    ]
  }
  const issueRows = computeIssueSuggestion(db, aid, plan)
  const state = computeProductionPlanActionState(db, aid, plan, issueRows)
  const hasIssued = issueRows.some(row => (Number(row.issued) || 0) > EPS)
  const products = db.prepare('SELECT plan_qty,finished_qty FROM scm_production_plan_product WHERE account_set_id=? AND plan_id=?').all(aid, sourceId) as any[]
  const hasFinished = products.some(row => (Number(row.finished_qty) || 0) > EPS)
  const normalize = (raw: any, action: 'issue' | 'finish', target: string, baseLabel: string, continued: boolean): ScmPushOption => {
    let status: ScmPushOptionStatus = raw.status === 'not_required' ? 'unavailable' : raw.status
    if (status === 'available' && continued) status = 'partial'
    return {
      action, target_doc_type: target,
      label: Number(raw.base_remaining) <= EPS && Number(raw.overrun_remaining) > EPS ? `追加${baseLabel}` : (status === 'partial' ? `继续${baseLabel}` : baseLabel),
      status, remaining_qty: Number(raw.remaining_qty) || 0, remaining_lines: Number(raw.remaining_lines) || 0,
      base_remaining: Number(raw.base_remaining) || 0,
      max_allowed_qty: Number(raw.max_allowed_qty) || 0,
      overrun_remaining: Number(raw.overrun_remaining) || 0,
      existing_doc: raw.draft_doc || null,
      reason: raw.reason || (raw.status === 'not_required' ? `无需${baseLabel}` : (raw.status === 'unavailable' ? '计划未审核、已关闭或不适用' : (raw.draft_doc ? `已有草稿 ${raw.draft_doc.doc_no}，请先审核或删除` : ''))),
    }
  }
  return [
    mrpOption(db, aid, kind, sourceId),
    normalize(state.issue, 'issue', isOut ? 'WO' : 'PL', isOut ? '委外发货' : '生产领料', hasIssued),
    normalize(state.finish, 'finish', isOut ? 'WI' : 'PF', isOut ? '委外入库' : '完工入库', hasFinished),
  ]
}

export function buildScmPushOptions(db: Database.Database, aid: string, kind: ScmPushSourceKind, sourceId: string): ScmPushOption[] {
  if (kind === 'sales_order') return buildSalesOptions(db, aid, sourceId)
  if (kind === 'production_plan' || kind === 'outsource_plan') return buildPlanOptions(db, aid, sourceId, kind)
  if (kind === 'assembly') return [mrpOption(db, aid, kind, sourceId)]
  return []
}
