import type Database from 'better-sqlite3'
import {
  getScmMaxAllowedQty,
  getScmOverrunPolicy,
  resolvePlanOverrunScope,
  resolveSourceOverrunScope,
} from './scmOverrunPolicy.js'
import { isPlanFullyFinished, planSubstituteMap } from './scmProduction.js'
import { hasWipCountTable } from './scmWipCount.js'

const EPS = 0.000001

/** 源单类型 → 其「实物下游单据」类型。下推进度只按这里的类型统计；
 *  MRP 计算单(MRP)、缺料单(MR)、生产计划虽然也引用源单明细行，但属于计划占用，不计入下推进度。 */
export const PHYSICAL_CHILD_DOC_TYPES: Record<string, string> = {
  PQ: 'PO',   // 采购询价 → 采购订单
  PO: 'PI',   // 采购订单 → 采购入库
  PI: 'PR',   // 采购入库 → 采购退货
  SQ: 'SOa',  // 销售报价 → 销售订单
  SOa: 'SO',  // 销售订单 → 销售出库
  SO: 'SR',   // 销售出库 → 销售退货
}

/** 查看页会显示价税合计的下推单据：已下推金额按含税口径 */
const TAX_INCLUSIVE_PUSH_TYPES = new Set(['PQ', 'PO', 'SQ', 'SOa'])

function r2(value: number) {
  return Math.round((Number(value) || 0) * 100) / 100
}

/**
 * 已下推金额 = 行金额 × 已下推数量 / 行数量。
 * 采购询价 / 采购订单 / 销售报价 / 销售订单取价税合计，其余取不含税金额。
 * 按行四舍五入到分。数量为 0 或尚未下推时为 0。
 */
export function pushedLineAmount(
  docType: string,
  qty: number,
  pushedQty: number,
  amount: number,
  taxAmount: number,
): number {
  const q = Number(qty) || 0
  const pushed = Number(pushedQty) || 0
  if (q <= 0 || pushed <= 0) return 0
  const net = Number(amount) || 0
  const basis = TAX_INCLUSIVE_PUSH_TYPES.has(docType) ? net + (Number(taxAmount) || 0) : net
  return r2(basis * pushed / q)
}

function r6(value: number) {
  return Math.round((Number(value) || 0) * 1000000) / 1000000
}

type SourceLineAllocation = { source_line_id: string; qty: number }

function sourceLineAllocations(fieldValues: unknown): SourceLineAllocation[] {
  let values: any = fieldValues
  if (typeof values === 'string') {
    try { values = JSON.parse(values) } catch { return [] }
  }
  const allocations = values?.source_line_allocations
  if (!Array.isArray(allocations)) return []
  return allocations
    .map(row => ({ source_line_id: String(row?.source_line_id || '').trim(), qty: r6(Number(row?.qty) || 0) }))
    .filter(row => row.source_line_id && row.qty > 0)
}

/** 查找直接引用或通过合并来源分配引用指定来源行的草稿单据。 */
export function findDraftDocumentUsingSourceLines(
  db: Database.Database,
  accountSetId: string,
  docType: string,
  sourceLineIds: string[],
): { id: string; doc_no: string; status: string } | undefined {
  const ids = Array.from(new Set(sourceLineIds.map(id => String(id || '').trim()).filter(Boolean)))
  if (!ids.length) return undefined
  const placeholders = ids.map(() => '?').join(',')
  return db.prepare(`SELECT DISTINCT d.id,d.doc_no,d.status
    FROM scm_doc d JOIN scm_doc_line l ON l.doc_id=d.id
    WHERE d.account_set_id=? AND d.doc_type=? AND d.status='draft'
      AND (l.source_line_id IN (${placeholders}) OR EXISTS (
        SELECT 1
        FROM json_each(CASE WHEN json_valid(l.field_values) THEN l.field_values ELSE '{}' END, '$.source_line_allocations') allocation
        WHERE json_extract(allocation.value, '$.source_line_id') IN (${placeholders})
      ))
    LIMIT 1`).get(accountSetId, docType, ...ids, ...ids) as any
}

function sourceLimit(db: Database.Database, accountSetId: string, childDocType: string, parent: any): number {
  const qty = Number(parent.qty) || 0
  const scope = resolveSourceOverrunScope(childDocType, parent.src_type)
  if (!scope) return qty
  return getScmMaxAllowedQty(qty, getScmOverrunPolicy(db, accountSetId, scope))
}

/** 来源行已执行净额：草稿和已审核占用，作废不占用；采购/销售仅审核退货恢复额度。
 *  只统计 childDocType 这一种实物下游单据——MRP 计算单、缺料单等虽然也写 source_line_id，
 *  但它们只是「计划占用」，不能算进实物下推进度，否则订单会被误判为已推完。 */
export function computeSourceLineUsedQty(
  db: Database.Database,
  accountSetId: string,
  childDocType: string,
  sourceLineId: string,
  excludeDocId?: string,
): number {
  const exclude = excludeDocId ? ' AND d.id<>?' : ''
  const tail: any[] = excludeDocId ? [excludeDocId] : []
  const occupied = db.prepare(`SELECT COALESCE(SUM(l.qty),0) AS qty
    FROM scm_doc_line l JOIN scm_doc d ON d.id=l.doc_id
    WHERE d.account_set_id=? AND d.doc_type=? AND l.source_line_id=? AND d.status<>'voided'${exclude}`)
    .get(accountSetId, childDocType, sourceLineId, ...tail) as any
  let used = r6(Number(occupied?.qty) || 0)
  const allocationRows = db.prepare(`SELECT l.field_values
    FROM scm_doc_line l JOIN scm_doc d ON d.id=l.doc_id
    WHERE d.account_set_id=? AND d.doc_type=? AND l.source_line_id IS NULL AND d.status<>'voided'${exclude}`)
    .all(accountSetId, childDocType, ...tail) as any[]
  used = r6(used + allocationRows.reduce((sum, row) => sum + sourceLineAllocations(row.field_values)
    .filter(allocation => allocation.source_line_id === sourceLineId)
    .reduce((subtotal, allocation) => subtotal + allocation.qty, 0), 0))
  const returnType = childDocType === 'PI' ? 'PR' : childDocType === 'SO' ? 'SR' : null
  if (returnType) {
    const returned = db.prepare(`SELECT COALESCE(SUM(rl.qty),0) AS qty
      FROM scm_doc_line child_line
      JOIN scm_doc child_doc ON child_doc.id=child_line.doc_id
      JOIN scm_doc_line rl ON rl.source_line_id=child_line.id
      JOIN scm_doc rd ON rd.id=rl.doc_id
      WHERE child_doc.account_set_id=? AND child_line.source_line_id=? AND child_doc.doc_type=?
        AND child_doc.status<>'voided' AND rd.account_set_id=? AND rd.doc_type=? AND rd.status='audited'`)
      .get(accountSetId, sourceLineId, childDocType, accountSetId, returnType) as any
    used = r6(Math.max(0, used - (Number(returned?.qty) || 0)))
  }
  return used
}

const DOC_NAME: Record<string, string> = {
  WO: '委外发料单', PL: '领料单', PB: '补料单',
  PQ: '采购询价单', PO: '采购订单', PI: '采购入库单', PR: '采购退货单', SQ: '销售报价单', SOa: '销售订单', SO: '销售出库单', SR: '销售退货单',
}

/**
 * 来源数量超限提示（客户反馈：「本次 100 加已占用 100，超过来源数量上限 120」看不懂）。
 * 说清：来源单据与数量、超收后的上限、被哪些单据占用（草稿单点名，提示先审核或删除）、本次超出多少。
 */
function sourceOverLimitMessage(
  db: Database.Database, accountSetId: string, childDocType: string, sourceLineId: string,
  parent: any, qty: number, used: number, maxQty: number, excludeDocId?: string,
): string {
  const exclude = excludeDocId ? ' AND d.id<>?' : ''
  const tail: any[] = excludeDocId ? [excludeDocId] : []
  const occupiers = new Map<string, { doc_no: string; status: string; qty: number }>()
  const add = (row: any, q: number) => {
    const hit = occupiers.get(row.id) || { doc_no: row.doc_no, status: row.status, qty: 0 }
    hit.qty = r6(hit.qty + q)
    occupiers.set(row.id, hit)
  }
  for (const row of db.prepare(`SELECT d.id, d.doc_no, d.status, COALESCE(SUM(l.qty),0) AS qty
    FROM scm_doc_line l JOIN scm_doc d ON d.id=l.doc_id
    WHERE d.account_set_id=? AND d.doc_type=? AND l.source_line_id=? AND d.status<>'voided'${exclude}
    GROUP BY d.id ORDER BY d.doc_no`).all(accountSetId, childDocType, sourceLineId, ...tail) as any[]) add(row, Number(row.qty) || 0)
  for (const row of db.prepare(`SELECT d.id, d.doc_no, d.status, l.field_values
    FROM scm_doc_line l JOIN scm_doc d ON d.id=l.doc_id
    WHERE d.account_set_id=? AND d.doc_type=? AND l.source_line_id IS NULL AND d.status<>'voided'${exclude}`).all(accountSetId, childDocType, ...tail) as any[]) {
    const q = sourceLineAllocations(row.field_values).filter(a => a.source_line_id === sourceLineId).reduce((s, a) => s + a.qty, 0)
    if (q > 0) add(row, q)
  }
  const childName = DOC_NAME[childDocType] || '下游单据'
  const srcName = DOC_NAME[parent.src_type] || '来源单据'
  const parentQty = r6(Number(parent.qty) || 0)
  const limitText = maxQty > parentQty + EPS ? `，允许超收后上限 ${maxQty}` : ''
  const list = [...occupiers.values()].map(o => `${o.doc_no}${o.status === 'draft' ? '（草稿）' : ''} ${o.qty}`)
  const usedText = used > EPS ? `已被其他${childName}占用 ${used}${list.length ? `（${list.join('、')}）` : ''}` : '尚无其他单据占用'
  const over = r6(used + qty - maxQty)
  const hasDraft = [...occupiers.values()].some(o => o.status === 'draft')
  return `物料 ${parent.item_code}：${srcName} ${parent.src_no} 数量 ${parentQty}${limitText}；${usedText}；本次 ${qty}，合计 ${r6(used + qty)}，超过来源数量上限 ${maxQty}（超出 ${over}）。`
    + (hasDraft ? `请先审核或删除上述草稿${childName}，或减少本次数量。` : `请减少本次数量。`)
}

/** 新增、修改、审核共用的行级来源校验。修改/审核时 excludeDocId 排除本单旧明细。 */
export function validateSourceLineQuantities(
  db: Database.Database,
  accountSetId: string,
  childDocType: string,
  lines: any[],
  excludeDocId?: string,
  // FIX-219：'save'（新增/修改）只要求上游未作废——批量下推明确允许草稿 PO/SOa 预下推出下游草稿，
  // 保存时若强制上游已审核，这些下游草稿改一下明细就被拦死；'audit' 才要求上游已审核，
  // 保证库存/账务只在上游承诺成立后发生。
  stage: 'save' | 'audit' = 'audit',
): string | null {
  if (!Array.isArray(lines)) return null
  const requested = new Map<string, { qty: number; itemCode: string }>()
  for (const line of lines) {
    const lineQty = r6(Number(line?.qty) || 0)
    if (!(lineQty > 0)) continue
    const allocations = sourceLineAllocations(line.field_values)
    if (allocations.length) {
      const allocationQty = r6(allocations.reduce((sum, allocation) => sum + allocation.qty, 0))
      if (Math.abs(allocationQty - lineQty) > EPS) return '合并出库明细的来源分配数量必须等于明细数量'
      for (const allocation of allocations) {
        const current = requested.get(allocation.source_line_id) || { qty: 0, itemCode: String(line.item_code || '') }
        current.qty = r6(current.qty + allocation.qty)
        requested.set(allocation.source_line_id, current)
      }
      continue
    }
    if (!line?.source_line_id) continue
    const key = String(line.source_line_id)
    const current = requested.get(key) || { qty: 0, itemCode: String(line.item_code || '') }
    current.qty = r6(current.qty + lineQty)
    requested.set(key, current)
  }
  for (const [sourceLineId, current] of requested) {
    const parent = db.prepare(`SELECT pl.qty,pl.item_code,d.doc_no AS src_no,d.doc_type AS src_type,d.status AS src_status
      FROM scm_doc_line pl JOIN scm_doc d ON d.id=pl.doc_id
      WHERE pl.id=? AND d.account_set_id=?`).get(sourceLineId, accountSetId) as any
    if (!parent) return '上游来源明细不存在或不属于当前账套，请刷新后重新下推'
    if (parent.src_status === 'voided') return `上游单据 ${parent.src_no} 已作废，不可下推`
    if (stage === 'audit' && parent.src_status !== 'audited') return `上游单据 ${parent.src_no} 未审核，请先审核上游单据再审核本单`
    if (current.itemCode !== parent.item_code) {
      return `下游物料 ${current.itemCode || '空'} 与上游物料 ${parent.item_code} 不一致，不可保存下推关系`
    }
    const used = computeSourceLineUsedQty(db, accountSetId, childDocType, sourceLineId, excludeDocId)
    const maxQty = sourceLimit(db, accountSetId, childDocType, parent)
    if (used + current.qty > maxQty + EPS) {
      return sourceOverLimitMessage(db, accountSetId, childDocType, sourceLineId, parent, current.qty, used, maxQty, excludeDocId)
    }
  }
  return null
}

// FIX-212：退料(PJ)/不良品入库(PS) 也必须关联已审核工单——无工单的 PJ 落到通用入库按 0 成本回冲原料仓、
// 且不扣减工单已领量；无工单的 PS 不写报废数、不冲在制。前端 DocForm.isPlanControlledDoc 同口径。
const PLAN_DOC_TYPES = new Set(['PL', 'PB', 'PF', 'WO', 'WI', 'PJ', 'PS', 'OP'])
const PLAN_DOC_LABELS: Record<string, string> = { PL: '生产领料', PB: '补料', PF: '完工入库', WO: '委外发货', WI: '委外入库', PJ: '退料', PS: '不良品入库', OP: '工序委外' }

export function validatePlanLink(
  db: Database.Database,
  accountSetId: string,
  docType: string,
  planId: string | null | undefined,
): { plan?: any; message?: string } {
  if (!PLAN_DOC_TYPES.has(docType)) return {}
  if (!planId) return { message: `${PLAN_DOC_LABELS[docType] || docType}必须关联已审核工单` }
  const plan = db.prepare('SELECT * FROM scm_production_plan WHERE id=? AND account_set_id=?').get(planId, accountSetId) as any
  if (!plan) return { message: '关联工单不存在或不属于当前账套' }
  if (plan.status !== 'released') return { message: `工单 ${plan.code || ''} 未审核，不能生成生产/委外单据` }
  // 工序委外(OP)：自制工单把某道工序发给委外厂加工，只能关联自制工单
  const expectedOutsource = docType === 'WO' || docType === 'WI'
  if (expectedOutsource !== (plan.plan_type === 'outsource')) {
    return { message: expectedOutsource ? '委外单据只能关联委外工单' : (docType === 'OP' ? '工序委外只能关联自制工单（整单委外请用委外工单）' : '生产单据只能关联自制工单') }
  }
  return { plan }
}

function planMaterialNeed(db: Database.Database, accountSetId: string, planId: string) {
  return db.prepare(`SELECT l.item_code,
      COALESCE(SUM(l.qty*(1+COALESCE(l.scrap_rate,0)/100.0)*pp.plan_qty),0) AS need
    FROM scm_production_plan_line l
    JOIN scm_production_plan_product pp ON pp.id=l.product_id AND pp.account_set_id=l.account_set_id
    WHERE l.account_set_id=? AND l.plan_id=? GROUP BY l.item_code`).all(accountSetId, planId) as any[]
}

/** 领料/委外发料保存与审核上限：净领用不得超过工单总需求。 */
export function validatePlanIssueQuantities(
  db: Database.Database,
  accountSetId: string,
  planId: string,
  docType: string,
  lines: any[],
  excludeDocId?: string,
): string | null {
  if (docType === 'PJ') return validatePlanReturnQuantities(db, accountSetId, planId, lines, excludeDocId)
  if (!['PL', 'PB', 'WO'].includes(docType)) return null
  // P2-18：只在工单全部完工（含报废）后锁定领料，分批完工后仍可为剩余批次领料/补料（与 computeProductionPlanActionState 同口径）
  const auditedFinish = isPlanFullyFinished(db, accountSetId, planId) ? db.prepare(`SELECT doc_no,doc_type FROM scm_doc
    WHERE account_set_id=? AND plan_id=? AND status='audited' AND doc_type IN ('PF','WI')
    ORDER BY doc_no DESC LIMIT 1`).get(accountSetId, planId) as any : null
  if (auditedFinish) {
    const finishName = auditedFinish.doc_type === 'WI' ? '委外入库单' : '完工入库单'
    return `该工单已全部完工（末批${finishName} ${auditedFinish.doc_no}），领料已锁定；如需继续领料，请先反审核完工单`
  }
  const needMap = new Map(planMaterialNeed(db, accountSetId, planId).map(row => [row.item_code, Number(row.need) || 0]))
  // C-1 替代料：替代料按其主料的需求上限计（同组合并占用）
  const subMap = planSubstituteMap(db, accountSetId, planId)
  const primaryOf = (code: string) => subMap.get(code) || code
  const scope = resolvePlanOverrunScope(docType)
  const policy = scope ? getScmOverrunPolicy(db, accountSetId, scope) : { enabled: false, rate: 0 }
  const params: any[] = [accountSetId, planId]
  let exclude = ''
  if (excludeDocId) { exclude = ' AND d.id<>?'; params.push(excludeDocId) }
  const occupied = db.prepare(`SELECT l.item_code,
      COALESCE(SUM(CASE WHEN d.doc_type IN ('PL','PB','WO') THEN l.qty WHEN d.doc_type='PJ' AND d.status='audited' THEN -l.qty ELSE 0 END),0) AS qty
    FROM scm_doc_line l JOIN scm_doc d ON d.id=l.doc_id
    WHERE d.account_set_id=? AND d.plan_id=? AND d.status<>'voided'
      AND d.doc_type IN ('PL','PB','WO','PJ')${exclude}
    GROUP BY l.item_code`).all(...params) as any[]
  const usedMap = new Map<string, number>()
  for (const row of occupied) { const k = primaryOf(row.item_code); usedMap.set(k, r6((usedMap.get(k) || 0) + (Number(row.qty) || 0))) }
  const incoming = new Map<string, number>()
  for (const line of lines || []) {
    if (!line?.item_code || !(Number(line.qty) > 0)) continue
    const k = primaryOf(line.item_code)
    incoming.set(k, r6((incoming.get(k) || 0) + Number(line.qty)))
  }
  for (const [itemCode, qty] of incoming) {
    const need = needMap.get(itemCode)
    if (need === undefined) {
      // 仅用于丰富提示文案，查不到不影响拦截
      let planCode = ''; let itemName = ''
      try {
        planCode = (db.prepare('SELECT code FROM scm_production_plan WHERE id=? AND account_set_id=?').get(planId, accountSetId) as { code?: string } | undefined)?.code || ''
        itemName = (db.prepare('SELECT name FROM scm_item WHERE account_set_id=? AND code=?').get(accountSetId, itemCode) as { name?: string } | undefined)?.name || ''
      } catch { /* ignore */ }
      const docName = DOC_NAME[docType] || (docType === 'WO' ? '委外发料单' : '领料单')
      return `物料 ${itemCode}${itemName ? `（${itemName}）` : ''} 不在工单${planCode ? ` ${planCode} ` : ''}的用料清单中（也不是用料的替代料），${docName}不能领用。`
        + '请删除该行，或先在「工单变更单」中为该工单追加此用料后再保存'
    }
    const used = r6(usedMap.get(itemCode) || 0)
    const maxQty = getScmMaxAllowedQty(need, policy)
    if (used + qty > maxQty + EPS) return `物料 ${itemCode} 工单需求 ${r6(need)}，允许上限 ${maxQty}，已领/占用 ${used}，本次 ${qty}，禁止超领`
  }
  return null
}

/**
 * 退料上限：本单 + 其它退料（草稿/已审核）不得超过工单「车间在制」——
 * 净已领（已审核领料/补料/委外发料，扣其它退料）− 已随完工 / 报废按 BOM 消耗 − 已审核盘亏 + 已审核盘盈。
 * 客户反馈：物料已随完工做成成品入库，却还能整笔退回原料仓，账面在制变负、成本被重复冲回。
 */
function validatePlanReturnQuantities(
  db: Database.Database,
  accountSetId: string,
  planId: string,
  lines: any[],
  excludeDocId?: string,
): string | null {
  const params: any[] = [accountSetId, planId]
  let exclude = ''
  if (excludeDocId) { exclude = ' AND d.id<>?'; params.push(excludeDocId) }
  const rows = db.prepare(`SELECT l.item_code,
      COALESCE(SUM(CASE WHEN d.doc_type IN ('PL','PB','WO') AND d.status='audited' THEN l.qty
                        WHEN d.doc_type='PJ' THEN -l.qty ELSE 0 END),0) AS qty
    FROM scm_doc_line l JOIN scm_doc d ON d.id=l.doc_id
    WHERE d.account_set_id=? AND d.plan_id=? AND d.status<>'voided'
      AND d.doc_type IN ('PL','PB','WO','PJ')${exclude}
    GROUP BY l.item_code`).all(...params) as any[]
  const netIssued = new Map(rows.map(row => [row.item_code, Number(row.qty) || 0]))
  const incoming = new Map<string, number>()
  for (const line of lines || []) {
    if (!line?.item_code || !(Number(line.qty) > 0)) continue
    incoming.set(line.item_code, r6((incoming.get(line.item_code) || 0) + Number(line.qty)))
  }
  // 已随完工 / 报废消耗（标准用量 ×（1+损耗率）×（已完工+已报废）），与在制品盘点「已消耗」同口径
  const consumedRows = db.prepare(`SELECT l.item_code,
      COALESCE(SUM(l.qty*(1+COALESCE(l.scrap_rate,0)/100.0)*(COALESCE(pp.finished_qty,0)+COALESCE(pp.scrap_qty,0))),0) AS qty
    FROM scm_production_plan_line l JOIN scm_production_plan_product pp ON pp.id=l.product_id
    WHERE l.account_set_id=? AND l.plan_id=? GROUP BY l.item_code`).all(accountSetId, planId) as any[]
  const consumed = new Map(consumedRows.map(row => [row.item_code, r6(Number(row.qty) || 0)]))
  const countAdj = new Map<string, number>()   // 已审核在制盘点：盘盈为正、盘亏为负
  if (hasWipCountTable(db)) {
    const adj = db.prepare(`SELECT l.item_code, COALESCE(SUM(l.diff_qty),0) AS qty FROM scm_plan_wip_count_line l
      JOIN scm_plan_wip_count c ON c.id=l.count_id
      WHERE c.account_set_id=? AND c.plan_id=? AND c.status='audited' GROUP BY l.item_code`).all(accountSetId, planId) as any[]
    for (const row of adj) countAdj.set(row.item_code, r6(Number(row.qty) || 0))
  }
  for (const [itemCode, qty] of incoming) {
    const net = r6(netIssued.get(itemCode) || 0)
    const used = consumed.get(itemCode) || 0
    const avail = r6(Math.max(0, net - used + (countAdj.get(itemCode) || 0)))
    if (qty > avail + EPS) {
      return used > EPS
        ? `物料 ${itemCode} 工单净已领 ${net}，已随完工/报废消耗 ${used}，车间在制可退 ${avail}，本次退料 ${qty} 超出（已做成成品的物料不能退回原料仓）`
        : `物料 ${itemCode} 工单净已领 ${avail}（已扣其它退料），本次退料 ${qty} 超出`
    }
  }
  return null
}

/** 完工/委外入库保存与审核上限：累计草稿和已审核数量均不得超过计划。 */
export function validatePlanFinishQuantities(
  db: Database.Database,
  accountSetId: string,
  planId: string,
  docType: string,
  lines: any[],
  excludeDocId?: string,
): string | null {
  // 自制：完工(PF) 与不良品(PS) 共用同一份计划数——计划 10 件做出 8 好 2 废就是做完了，
  // 分开各自计数会让「完工 10 + 不良 5」通过校验，凭空多耗一份料。委外(WI) 单独计数。
  if (!['PF', 'WI', 'PS'].includes(docType)) return null
  const countedTypes = docType === 'WI' ? ['WI'] : ['PF', 'PS']
  const products = db.prepare(`SELECT item_code,COALESCE(SUM(plan_qty),0) AS plan_qty
    FROM scm_production_plan_product WHERE account_set_id=? AND plan_id=? GROUP BY item_code`).all(accountSetId, planId) as any[]
  const planMap = new Map(products.map(row => [row.item_code, Number(row.plan_qty) || 0]))
  const scope = resolvePlanOverrunScope(docType)
  const policy = scope ? getScmOverrunPolicy(db, accountSetId, scope) : { enabled: false, rate: 0 }
  const params: any[] = [accountSetId, planId, ...countedTypes]
  let exclude = ''
  if (excludeDocId) { exclude = ' AND d.id<>?'; params.push(excludeDocId) }
  const typePh = countedTypes.map(() => '?').join(',')
  const occupied = db.prepare(`SELECT l.item_code,COALESCE(SUM(l.qty),0) AS qty
    FROM scm_doc_line l JOIN scm_doc d ON d.id=l.doc_id
    WHERE d.account_set_id=? AND d.plan_id=? AND d.doc_type IN (${typePh}) AND d.status<>'voided'${exclude}
    GROUP BY l.item_code`).all(...params) as any[]
  const usedMap = new Map(occupied.map(row => [row.item_code, Number(row.qty) || 0]))
  const incoming = new Map<string, number>()
  for (const line of lines || []) {
    if (!line?.item_code || !(Number(line.qty) > 0)) continue
    incoming.set(line.item_code, r6((incoming.get(line.item_code) || 0) + Number(line.qty)))
  }
  for (const [itemCode, qty] of incoming) {
    const planQty = planMap.get(itemCode)
    if (planQty === undefined) return `成品 ${itemCode} 不在关联工单中，不能完工入库`
    const used = r6(usedMap.get(itemCode) || 0)
    const maxQty = getScmMaxAllowedQty(planQty, policy)
    if (used + qty > maxQty + EPS) {
      // 点名占用计划数的草稿单（客户反馈：没有完工却提示「占用 50」，不知道被谁占了）
      const drafts = db.prepare(`SELECT d.doc_no, COALESCE(SUM(l.qty),0) AS qty
        FROM scm_doc_line l JOIN scm_doc d ON d.id=l.doc_id
        WHERE d.account_set_id=? AND d.plan_id=? AND d.doc_type IN (${typePh}) AND d.status='draft' AND l.item_code=?${exclude}
        GROUP BY d.id ORDER BY d.doc_no`).all(accountSetId, planId, ...countedTypes, itemCode, ...(excludeDocId ? [excludeDocId] : [])) as any[]
      const draftText = drafts.length
        ? `（其中未审核草稿 ${drafts.map(r => `${r.doc_no} ${r6(Number(r.qty) || 0)}`).join('、')}，请先审核或删除）`
        : ''
      return `成品 ${itemCode} 计划 ${r6(planQty)}，允许上限 ${maxQty}，已完工/报废/占用 ${used}${draftText}，本次 ${qty}，禁止超完工`
    }
  }
  return null
}

/** 审核完工时按累计完工比例校验齐套，仅统计已审核领退料库存移动。 */
export function validateFinishKitting(
  db: Database.Database,
  accountSetId: string,
  planId: string,
  lines: any[],
): string | null {
  const products = db.prepare(`SELECT id,item_code,finished_qty FROM scm_production_plan_product
    WHERE account_set_id=? AND plan_id=?`).all(accountSetId, planId) as any[]
  const batchByItem = new Map<string, number>()
  for (const line of lines || []) {
    if (line?.item_code && Number(line.qty) > 0) batchByItem.set(line.item_code, r6((batchByItem.get(line.item_code) || 0) + Number(line.qty)))
  }
  const targetByProduct = new Map<string, number>()
  for (const product of products) {
    targetByProduct.set(product.id, r6((Number(product.finished_qty) || 0) + (batchByItem.get(product.item_code) || 0)))
  }
  const needs = db.prepare(`SELECT l.item_code,l.product_id,l.qty,l.scrap_rate
    FROM scm_production_plan_line l WHERE l.account_set_id=? AND l.plan_id=?`).all(accountSetId, planId) as any[]
  const needMap = new Map<string, number>()
  for (const row of needs) {
    const finished = targetByProduct.get(row.product_id) || 0
    const need = (Number(row.qty) || 0) * (1 + (Number(row.scrap_rate) || 0) / 100) * finished
    needMap.set(row.item_code, r6((needMap.get(row.item_code) || 0) + need))
  }
  const issued = db.prepare(`SELECT m.item_code,
      COALESCE(SUM(CASE WHEN m.direction='out' THEN m.qty ELSE -m.qty END),0) AS qty
    FROM scm_stock_move m JOIN scm_doc d
      ON d.account_set_id=m.account_set_id AND d.doc_type=m.doc_type AND d.doc_no=m.doc_no
    WHERE d.account_set_id=? AND d.plan_id=? AND d.status='audited'
      AND d.doc_type IN ('PL','PB','WO','PJ') GROUP BY m.item_code`).all(accountSetId, planId) as any[]
  const issuedMap = new Map(issued.map(row => [row.item_code, Number(row.qty) || 0]))
  const shortages: string[] = []
  for (const [itemCode, need] of needMap) {
    const actual = r6(issuedMap.get(itemCode) || 0)
    if (actual + EPS < need) shortages.push(`${itemCode} 应领 ${need}，已领 ${actual}，缺 ${r6(need - actual)}`)
  }
  return shortages.length ? `完工数量未齐套：${shortages.slice(0, 8).join('；')}${shortages.length > 8 ? '……' : ''}` : null
}

/**
 * 不生成凭证的单据类型：订单 / 询价 / 报价只是业务承诺，不动库存也不挂往来，账务由下游入库、出库单承担；
 * MRP 计算单同理。与前端 utils/scmDoc.ts 的 NO_VOUCHER_DOC_TYPES 保持一致。
 */
export const NO_VOUCHER_DOC_TYPES: ReadonlySet<string> = new Set(['MRP', 'PQ', 'PO', 'SQ', 'SOa'])
export function docTypeGeneratesVoucher(docType: string): boolean {
  return !NO_VOUCHER_DOC_TYPES.has(docType)
}

/**
 * 必须指定往来单位的单据：采购/销售链路上的询价、订单、入库、出库、退货。
 * 往来单位为空时，审核后不会挂应付/应收，账实不一致，故在保存与审核阶段统一拦截。
 * 与前端 DocForm.vue 的 PARTNER_REQUIRED_TYPES 保持一致。
 */
export const PARTNER_REQUIRED_DOC_TYPES: ReadonlySet<string> = new Set(['PQ', 'PO', 'PI', 'PR', 'SQ', 'SOa', 'SO', 'SR'])
const PARTNER_ROLE_LABEL: Record<string, string> = {
  PQ: '供应商', PO: '供应商', PI: '供应商', PR: '供应商',
  SQ: '客户', SOa: '客户', SO: '客户', SR: '客户',
}
export function validateDocPartner(
  db: Database.Database,
  accountSetId: string,
  docType: string,
  partnerCode: string | null | undefined,
): string | null {
  if (!PARTNER_REQUIRED_DOC_TYPES.has(docType)) return null
  const label = PARTNER_ROLE_LABEL[docType] || '往来单位'
  const code = String(partnerCode ?? '').trim()
  if (!code) return `必须指定${label}（往来单位）`
  const hit = db.prepare('SELECT 1 FROM scm_partner WHERE account_set_id=? AND code=?').get(accountSetId, code)
  return hit ? null : `${label}（往来单位）「${code}」不存在，请重新选择`
}
