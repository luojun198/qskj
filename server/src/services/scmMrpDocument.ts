import type Database from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'
import { computeIssueSuggestion, computePushedQty } from './scmProduction.js'

export type MrpSourceKind = 'sales_order' | 'production_plan' | 'outsource_plan' | 'assembly'
export interface MrpSourceRef { kind: MrpSourceKind; id: string }

const r6 = (n: number) => Math.round((Number(n) || 0) * 1e6) / 1e6
const json = (value: unknown, fallback: any = {}) => {
  if (value && typeof value === 'object') return value as any
  try { return JSON.parse(String(value || '')) } catch { return fallback }
}

function demandMultiplier(options: any) {
  const value = Number(options?.demand_multiplier)
  if (!Number.isFinite(value)) return 100
  return r6(Math.min(1000, Math.max(0, value)))
}

function itemTargetQtyMap(options: any) {
  const result = new Map<string, number>()
  const raw = options?.item_target_qty
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return result
  for (const [itemCode, qty] of Object.entries(raw)) {
    const value = nonNegativeInteger(qty, '物料目标需求量')
    if (itemCode && value > 0) result.set(itemCode, value)
  }
  return result
}

function nonNegativeInteger(value: unknown, label: string) {
  const quantity = Number(value)
  if (!Number.isFinite(quantity) || quantity <= 0) return 0
  if (!Number.isInteger(quantity)) throw new Error(`${label}必须为非负整数`)
  return quantity
}

type SourceDemandProjection = {
  source: any; sourceDemand: number; multipliedDemand: number; extraQty: number
  targetAllocatedQty: number; finalDemand: number
}

function distributeIntegerTarget(rows: SourceDemandProjection[], targetQty: number) {
  if (!rows.length) return
  const totalWeight = rows.reduce((sum, row) => sum + row.multipliedDemand + row.extraQty, 0)
  const shares = rows.map((row, index) => {
    const exact = totalWeight > 0
      ? targetQty * (row.multipliedDemand + row.extraQty) / totalWeight
      : targetQty / rows.length
    return { row, index, allocated: Math.floor(exact), remainder: exact - Math.floor(exact) }
  })
  let remaining = targetQty - shares.reduce((sum, share) => sum + share.allocated, 0)
  shares.sort((a, b) => (b.remainder - a.remainder) || (a.index - b.index))
  for (let index = 0; index < remaining; index++) shares[index % shares.length].allocated += 1
  for (const share of shares) {
    share.row.targetAllocatedQty = share.allocated
    share.row.finalDemand = share.allocated
  }
}

function add(map: Map<string, number>, code: string, qty: number) {
  if (code && qty > 0) map.set(code, r6((map.get(code) || 0) + qty))
}

function nextDocNo(db: Database.Database, aid: string, code: string) {
  const now = new Date()
  const row = db.prepare("SELECT param_value FROM system_params WHERE account_set_id=? AND param_key='scm:doc_no_rule'").get(aid) as any
  let rule = String(row?.param_value || '').trim() || '{YYYY}{MM}-{CODE}-{SEQ:3}'
  if (!/\{SEQ(:\d+)?\}/.test(rule)) rule += '-{SEQ:3}'
  const yyyy = String(now.getFullYear())
  const rendered = rule
    .replace(/\{YYYY\}/g, yyyy).replace(/\{YY\}/g, yyyy.slice(2))
    .replace(/\{MM\}/g, String(now.getMonth() + 1).padStart(2, '0'))
    .replace(/\{DD\}/g, String(now.getDate()).padStart(2, '0')).replace(/\{CODE\}/g, code)
  const token = rendered.match(/\{SEQ(?::(\d+))?\}/)!
  const width = token[1] ? Number(token[1]) : 3
  const prefix = rendered.slice(0, rendered.indexOf(token[0]))
  const rows = db.prepare('SELECT doc_no FROM scm_doc WHERE account_set_id=? AND doc_type=? AND doc_no LIKE ?').all(aid, code, `${prefix}%`) as any[]
  let max = 0
  for (const current of rows) {
    const match = String(current.doc_no || '').slice(prefix.length).match(/^(\d+)/)
    if (match) max = Math.max(max, Number(match[1]))
  }
  return rendered.replace(token[0], String(max + 1).padStart(width, '0'))
}

function ensureSourceKind(value: unknown): MrpSourceKind {
  if (value === 'sales_order' || value === 'production_plan' || value === 'outsource_plan' || value === 'assembly') return value
  throw new Error('MRP来源类型无效')
}

/** 返回正在占用来源的有效 MRP 计算单；删除草稿 MRP 后占用自动释放。 */
export function findActiveMrpSource(db: Database.Database, aid: string, rawKind: string, sourceId: string) {
  const kind = ensureSourceKind(rawKind)
  return db.prepare(`SELECT d.id,d.doc_no,d.status
    FROM scm_mrp_source s JOIN scm_doc d ON d.id=s.mrp_doc_id
    WHERE s.account_set_id=? AND s.source_kind=? AND s.source_id=?
      AND d.doc_type='MRP' AND d.status IN ('draft','audited')
    ORDER BY d.created_at LIMIT 1`).get(aid, kind, sourceId) as { id: string; doc_no: string; status: 'draft' | 'audited' } | undefined
}

function ensureNotOccupied(db: Database.Database, aid: string, ref: MrpSourceRef, currentMrpId: string) {
  const occupied = db.prepare(`SELECT s.mrp_doc_id,d.doc_no
    FROM scm_mrp_source s JOIN scm_doc d ON d.id=s.mrp_doc_id
    WHERE s.account_set_id=? AND s.source_kind=? AND s.source_id=? AND s.mrp_doc_id<>?
      AND d.doc_type='MRP' AND d.status IN ('draft','audited') LIMIT 1`
  ).get(aid, ref.kind, ref.id, currentMrpId) as any
  if (occupied) throw new Error(`来源已被 MRP 计算单 ${occupied.doc_no} 占用`)
}

/** 沿表头和行级来源向上追溯，避免 MRP→MR→工单/组装→MRP 的间接回环。 */
function sourceChainContainsMrOrMrp(db: Database.Database, aid: string, startDocId: string) {
  const queue = [startDocId]
  const visited = new Set<string>()
  while (queue.length) {
    const id = queue.shift()!
    if (!id || visited.has(id)) continue
    visited.add(id)
    const doc = db.prepare('SELECT doc_type,source_doc_id FROM scm_doc WHERE id=? AND account_set_id=?').get(id, aid) as any
    if (!doc) continue
    if (doc.doc_type === 'MR' || doc.doc_type === 'MRP') return true
    if (doc.source_doc_id) queue.push(String(doc.source_doc_id))
    const parents = db.prepare(`SELECT DISTINCT pl.doc_id id FROM scm_doc_line l
      JOIN scm_doc_line pl ON pl.id=l.source_line_id
      WHERE l.account_set_id=? AND l.doc_id=? AND l.source_line_id IS NOT NULL`).all(aid, id) as any[]
    for (const parent of parents) queue.push(String(parent.id))
  }
  return false
}

function normalizeSalesOrder(db: Database.Database, aid: string, sourceId: string) {
  const doc = db.prepare("SELECT * FROM scm_doc WHERE id=? AND account_set_id=? AND doc_type='SOa'").get(sourceId, aid) as any
  if (!doc || doc.status !== 'audited') throw new Error('销售订单不存在或未审核')
  const rows = db.prepare(`SELECT l.*,
      ((SELECT COALESCE(SUM(c.qty),0)
          FROM scm_doc_line c JOIN scm_doc cd ON cd.id=c.doc_id
         WHERE c.source_line_id=l.id AND cd.account_set_id=? AND cd.doc_type='SO' AND cd.status='audited')
       +(SELECT COALESCE(SUM(pp.plan_qty),0) FROM scm_production_plan_product pp WHERE pp.source_line_id=l.id)) AS pushed
    FROM scm_doc_line l WHERE l.doc_id=? ORDER BY l.seq`).all(aid, sourceId) as any[]
  return rows.map(line => ({
    source_key: `SO:${line.id}`, source_line_id: line.id, item_code: String(line.item_code || ''),
    demand_qty: r6(Math.max(0, Number(line.qty || 0) - Number(line.pushed || 0))),
    need_date: doc.expect_date || doc.doc_date || null, priority: 0,
    snapshot: { source_type: line.source_type || null, supplier_code: line.supplier_code || null, warehouse_code: line.warehouse_code || doc.warehouse_code || null },
  })).filter(row => row.item_code && row.demand_qty > 0)
}

function normalizePlan(db: Database.Database, aid: string, sourceId: string, kind: MrpSourceKind) {
  const plan = db.prepare('SELECT * FROM scm_production_plan WHERE id=? AND account_set_id=?').get(sourceId, aid) as any
  const expected = kind === 'outsource_plan' ? 'outsource' : 'self'
  if (!plan || plan.status !== 'released' || plan.plan_type !== expected) throw new Error(`${expected === 'self' ? '生产' : '委外'}计划不存在或未下达`)
  if (plan.source_doc_id) {
    if (sourceChainContainsMrOrMrp(db, aid, String(plan.source_doc_id))) throw new Error('该计划上游已包含缺料/MRP流程，不可再次作为MRP来源')
  }
  return computeIssueSuggestion(db, aid, plan).map((line: any) => ({
    source_key: `PLAN:${plan.id}:${line.item_code}`, source_line_id: null,
    item_code: String(line.item_code || ''), demand_qty: r6(Number(line.suggest) || 0),
    need_date: plan.start_date || plan.end_date || null, priority: Number(plan.priority) || 0,
    snapshot: { warehouse_code: line.warehouse_code || plan.yl_warehouse || null, plan_type: plan.plan_type },
  })).filter((row: any) => row.item_code && row.demand_qty > 0)
}

function normalizeAssembly(db: Database.Database, aid: string, sourceId: string) {
  const doc = db.prepare("SELECT * FROM scm_doc WHERE id=? AND account_set_id=? AND doc_type='AS'").get(sourceId, aid) as any
  if (!doc || doc.status !== 'draft') throw new Error('组装单不存在或不是草稿状态')
  if (doc.source_doc_id) {
    if (sourceChainContainsMrOrMrp(db, aid, String(doc.source_doc_id))) throw new Error('该组装单上游已包含缺料/MRP流程，不可再次作为MRP来源')
  }
  const lines = db.prepare("SELECT * FROM scm_doc_line WHERE doc_id=? AND COALESCE(line_role,'component')<>'product' ORDER BY seq").all(sourceId) as any[]
  return lines.map(line => ({
    source_key: `AS:${line.id}`, source_line_id: line.id, item_code: String(line.item_code || ''),
    demand_qty: r6(Number(line.qty) || 0), need_date: doc.doc_date || null, priority: 0,
    snapshot: { source_type: line.source_type || null, supplier_code: line.supplier_code || null, warehouse_code: line.warehouse_code || null },
  })).filter(row => row.item_code && row.demand_qty > 0)
}

function normalizeRef(db: Database.Database, aid: string, ref: MrpSourceRef) {
  if (ref.kind === 'sales_order') {
    const doc = db.prepare('SELECT doc_no FROM scm_doc WHERE id=? AND account_set_id=?').get(ref.id, aid) as any
    return { source_no: doc?.doc_no || '', rows: normalizeSalesOrder(db, aid, ref.id) }
  }
  if (ref.kind === 'assembly') {
    const doc = db.prepare('SELECT doc_no FROM scm_doc WHERE id=? AND account_set_id=?').get(ref.id, aid) as any
    return { source_no: doc?.doc_no || '', rows: normalizeAssembly(db, aid, ref.id) }
  }
  const plan = db.prepare('SELECT code FROM scm_production_plan WHERE id=? AND account_set_id=?').get(ref.id, aid) as any
  return { source_no: plan?.code || '', rows: normalizePlan(db, aid, ref.id, ref.kind) }
}

/**
 * 单张来源进入 MRP 的状态。统一下推菜单和 MRP 新增接口共用同一套来源读取规则，
 * 避免页面认为可生成、真正创建时又因状态或剩余需求不一致而失败。
 */
export function getMrpSourceState(db: Database.Database, aid: string, rawKind: string, sourceId: string) {
  const kind = ensureSourceKind(rawKind)
  const occupied = findActiveMrpSource(db, aid, kind, sourceId)
  if (occupied) {
    const demand = db.prepare(`SELECT COALESCE(SUM(demand_qty),0) qty,COUNT(*) lines
      FROM scm_mrp_source WHERE account_set_id=? AND mrp_doc_id=? AND source_kind=? AND source_id=?`
    ).get(aid, occupied.id, kind, sourceId) as any
    return {
      kind,
      status: occupied.status === 'draft' ? 'blocked_draft' : 'available',
      remaining_qty: r6(Number(demand?.qty) || 0),
      remaining_lines: Number(demand?.lines) || 0,
      existing_doc: { id: occupied.id, doc_no: occupied.doc_no, doc_type: 'MRP', status: occupied.status },
      reason: occupied.status === 'draft' ? `已进入草稿 MRP ${occupied.doc_no}` : `已进入 MRP ${occupied.doc_no}`,
    }
  }
  try {
    const normalized = normalizeRef(db, aid, { kind, id: sourceId })
    const remainingQty = r6(normalized.rows.reduce((sum: number, row: any) => sum + (Number(row.demand_qty) || 0), 0))
    return {
      kind,
      status: normalized.rows.length ? 'available' : 'completed',
      remaining_qty: remainingQty,
      remaining_lines: normalized.rows.length,
      existing_doc: null,
      reason: normalized.rows.length ? '' : '已无可计算需求',
    }
  } catch (error: any) {
    return {
      kind,
      status: 'unavailable',
      remaining_qty: 0,
      remaining_lines: 0,
      existing_doc: null,
      reason: error?.message || '来源不可用',
    }
  }
}

export function replaceMrpSources(db: Database.Database, aid: string, mrpId: string, rawRefs: Array<{ kind: string; id: string }>) {
  const refs = [...new Map((rawRefs || []).map(raw => {
    const ref = { kind: ensureSourceKind(raw.kind), id: String(raw.id || '') }
    return [`${ref.kind}:${ref.id}`, ref]
  })).values()].filter(ref => ref.id)
  if (!refs.length) throw new Error('请至少选择一张来源单据')
  const existingExtraQty = new Map((db.prepare(`SELECT source_key,snapshot_json FROM scm_mrp_source
    WHERE account_set_id=? AND mrp_doc_id=?`).all(aid, mrpId) as any[])
    .map(row => [String(row.source_key), r6(Math.max(0, Number(json(row.snapshot_json).extra_qty) || 0))]))
  const normalized: any[] = []
  for (const ref of refs) {
    ensureNotOccupied(db, aid, ref, mrpId)
    const source = normalizeRef(db, aid, ref)
    if (!source.rows.length) throw new Error(`来源 ${source.source_no || ref.id} 已无可计算需求`)
    for (const row of source.rows) normalized.push({ ...row, ...ref, source_no: source.source_no })
  }
  db.prepare('DELETE FROM scm_mrp_source WHERE mrp_doc_id=? AND account_set_id=?').run(mrpId, aid)
  const insert = db.prepare(`INSERT INTO scm_mrp_source
    (id,account_set_id,mrp_doc_id,source_kind,source_id,source_no,source_key,source_line_id,item_code,demand_qty,allocated_net_qty,need_date,priority,snapshot_json)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
  for (const row of normalized) {
    const extraQty = existingExtraQty.get(String(row.source_key)) || 0
    const snapshot = { ...(row.snapshot || {}), ...(extraQty > 0 ? { extra_qty: extraQty } : {}) }
    insert.run(uuidv4(), aid, mrpId, row.kind, row.id, row.source_no, row.source_key,
      row.source_line_id, row.item_code, row.demand_qty, 0, row.need_date, row.priority, JSON.stringify(snapshot))
  }
  return normalized.length
}

export function currentMrpSourceRefs(db: Database.Database, aid: string, mrpId: string): MrpSourceRef[] {
  return (db.prepare(`SELECT DISTINCT source_kind AS kind,source_id AS id FROM scm_mrp_source
    WHERE account_set_id=? AND mrp_doc_id=? ORDER BY source_kind,source_no`).all(aid, mrpId) as any[])
    .map(row => ({ kind: ensureSourceKind(row.kind), id: row.id }))
}

export function applyMrpAdjustments(
  db: Database.Database,
  aid: string,
  mrpId: string,
  oldFields: Record<string, any>,
  body: any,
) {
  const fields = { ...oldFields }
  if (Object.prototype.hasOwnProperty.call(body, 'demand_multiplier')) {
    fields.demand_multiplier = demandMultiplier(body)
  }
  if (Object.prototype.hasOwnProperty.call(body, 'item_target_qty')) {
    fields.item_target_qty = Object.fromEntries(itemTargetQtyMap(body))
  }
  if (Array.isArray(body.source_adjustments)) {
    const findSource = db.prepare('SELECT id,snapshot_json FROM scm_mrp_source WHERE id=? AND account_set_id=? AND mrp_doc_id=?')
    const updateSource = db.prepare('UPDATE scm_mrp_source SET snapshot_json=? WHERE id=?')
    for (const raw of body.source_adjustments) {
      const id = String(raw?.id || '')
      if (!id) continue
      const source = findSource.get(id, aid, mrpId) as any
      if (!source) throw new Error('需求来源明细不存在或不属于当前 MRP')
      const snapshot = json(source.snapshot_json)
      snapshot.extra_qty = nonNegativeInteger(raw.extra_qty, '固定追加量')
      updateSource.run(JSON.stringify(snapshot), id)
    }
  }
  return fields
}

/** MRP 详情页使用的来源单汇总和行级需求信息。 */
export function getMrpDocumentSourceDetails(db: Database.Database, aid: string, mrpId: string) {
  const sources = db.prepare(`SELECT s.*,i.name item_name,i.spec,i.unit,sl.seq source_line_seq
    FROM scm_mrp_source s
    LEFT JOIN scm_item i ON i.account_set_id=s.account_set_id AND i.code=s.item_code
    LEFT JOIN scm_doc_line sl ON sl.account_set_id=s.account_set_id AND sl.id=s.source_line_id
    WHERE s.account_set_id=? AND s.mrp_doc_id=?
    ORDER BY s.source_kind,s.source_no,s.source_key`).all(aid, mrpId) as any[]

  const groups = new Map<string, any[]>()
  for (const source of sources) {
    const key = `${source.source_kind}:${source.source_id}`
    const group = groups.get(key) || []
    group.push(source)
    groups.set(key, group)
  }

  const sourceSummaries = [...groups.values()].map(rows => {
    const first = rows[0]
    let header: any
    if (first.source_kind === 'sales_order' || first.source_kind === 'assembly') {
      header = db.prepare(`SELECT d.doc_date,d.status,d.partner_code,p.name partner_name
        FROM scm_doc d LEFT JOIN scm_partner p ON p.account_set_id=d.account_set_id AND p.code=d.partner_code
        WHERE d.account_set_id=? AND d.id=?`).get(aid, first.source_id) as any
    } else {
      header = db.prepare(`SELECT pp.start_date doc_date,pp.status,pp.supplier_code partner_code,p.name partner_name
        FROM scm_production_plan pp LEFT JOIN scm_partner p ON p.account_set_id=pp.account_set_id AND p.code=pp.supplier_code
        WHERE pp.account_set_id=? AND pp.id=?`).get(aid, first.source_id) as any
    }
    const needDates = rows.map(row => String(row.need_date || '')).filter(Boolean).sort()
    return {
      kind: ensureSourceKind(first.source_kind),
      id: String(first.source_id),
      source_no: String(first.source_no || ''),
      doc_date: header?.doc_date || null,
      status: header?.status || '',
      partner_code: header?.partner_code || '',
      partner_name: header?.partner_name || '',
      demand_line_count: rows.length,
      demand_qty: r6(rows.reduce((sum, row) => sum + Number(row.demand_qty || 0), 0)),
      earliest_need_date: needDates[0] || null,
    }
  })

  return {
    source_summaries: sourceSummaries,
    sources: sources.map(row => {
      const snapshot = json(row.snapshot_json)
      return {
        ...row,
        snapshot,
        multiplied_qty: Number(snapshot.multiplied_qty) || 0,
        extra_qty: Number(snapshot.extra_qty) || 0,
        target_allocated_qty: Number(snapshot.target_allocated_qty) || 0,
        final_demand_qty: Number(snapshot.final_demand_qty) || 0,
      }
    }),
  }
}

type BomInfo = { id: string; code: string; components: Array<{ item_code: string; per: number }> }

export function calculateMrpDocument(db: Database.Database, aid: string, mrpId: string) {
  const doc = db.prepare("SELECT * FROM scm_doc WHERE id=? AND account_set_id=? AND doc_type='MRP'").get(mrpId, aid) as any
  if (!doc) throw new Error('MRP计算单不存在')
  if (doc.status !== 'draft') throw new Error('仅草稿MRP计算单可重新计算')
  const refs = currentMrpSourceRefs(db, aid, mrpId)
  if (!refs.length) throw new Error('请先选择来源单据')

  return db.transaction(() => {
    replaceMrpSources(db, aid, mrpId, refs)
    const sources = db.prepare('SELECT * FROM scm_mrp_source WHERE account_set_id=? AND mrp_doc_id=? ORDER BY priority DESC,need_date,source_no,source_key').all(aid, mrpId) as any[]
    const sourceByKey = new Map(sources.map(row => [String(row.source_key), row]))
    const selectedSourceIds = new Set(sources.map(row => row.source_id))
    const options = json(doc.field_values)
    const multiplier = demandMultiplier(options)
    const itemTargets = itemTargetQtyMap(options)
    const gross = new Map<string, number>()
    const direct = new Map<string, number>()
    const baseDirect = new Map<string, number>()
    const multipliedDirect = new Map<string, number>()
    const fixedExtra = new Map<string, number>()
    const targetOverridden = new Set<string>()
    const contributors = new Map<string, Set<string>>()
    const contributionQty = new Map<string, Map<string, number>>()
    const rootOverride = new Map<string, any>()
    const projections: SourceDemandProjection[] = sources.map(source => {
      const sourceDemand = r6(Number(source.demand_qty) || 0)
      const snap = json(source.snapshot_json)
      const multipliedDemand = Math.ceil(sourceDemand * multiplier / 100)
      const extraQty = nonNegativeInteger(snap.extra_qty, '固定追加量')
      return { source, sourceDemand, multipliedDemand, extraQty, targetAllocatedQty: 0, finalDemand: multipliedDemand + extraQty }
    })
    for (const [itemCode, targetQty] of itemTargets) {
      distributeIntegerTarget(projections.filter(row => row.source.item_code === itemCode), targetQty)
      targetOverridden.add(itemCode)
    }
    const updateSourceSnapshot = db.prepare('UPDATE scm_mrp_source SET snapshot_json=? WHERE id=?')
    for (const projection of projections) {
      const { source, sourceDemand, multipliedDemand, extraQty, targetAllocatedQty, finalDemand } = projection
      const snap = json(source.snapshot_json)
      Object.assign(snap, {
        extra_qty: extraQty,
        multiplied_qty: multipliedDemand,
        target_allocated_qty: targetAllocatedQty,
        final_demand_qty: finalDemand,
      })
      updateSourceSnapshot.run(JSON.stringify(snap), source.id)
      add(gross, source.item_code, finalDemand); add(direct, source.item_code, finalDemand)
      add(baseDirect, source.item_code, sourceDemand)
      add(multipliedDirect, source.item_code, multipliedDemand)
      add(fixedExtra, source.item_code, extraQty)
      if (!contributors.has(source.item_code)) contributors.set(source.item_code, new Set())
      contributors.get(source.item_code)!.add(source.source_key)
      if (!contributionQty.has(source.item_code)) contributionQty.set(source.item_code, new Map())
      const itemContributions = contributionQty.get(source.item_code)!
      itemContributions.set(source.source_key, r6((itemContributions.get(source.source_key) || 0) + finalDemand))
      if (snap.source_type || snap.supplier_code) rootOverride.set(source.item_code, snap)
    }

    const items = new Map<string, any>()
    for (const row of db.prepare(`SELECT code,name,spec,unit,COALESCE(source_type,'purchase') source_type,
      COALESCE(supplier_code,'') supplier_code,COALESCE(purchase_price,0) purchase_price,
      COALESCE(safety_stock,0) safety_stock,COALESCE(min_order_qty,0) min_order_qty,COALESCE(lead_time_days,0) lead_time_days
      FROM scm_item WHERE account_set_id=?`).all(aid) as any[]) items.set(row.code, row)

    const onHand = new Map<string, number>()
    for (const row of db.prepare('SELECT item_code,COALESCE(SUM(qty),0) qty FROM scm_stock WHERE account_set_id=? GROUP BY item_code').all(aid) as any[]) add(onHand, row.item_code, row.qty)

    const inTransit = new Map<string, number>()
    for (const row of db.prepare(`SELECT l.item_code,l.qty,
      (SELECT COALESCE(SUM(c.qty),0) FROM scm_doc_line c WHERE c.source_line_id=l.id) pushed
      FROM scm_doc_line l JOIN scm_doc d ON d.id=l.doc_id
      WHERE d.account_set_id=? AND d.doc_type='PO' AND d.status='audited'`).all(aid) as any[]) add(inTransit, row.item_code, Math.max(0, Number(row.qty)-Number(row.pushed)))
    for (const row of db.prepare(`SELECT pp.item_code,COALESCE(SUM(MAX(0,pp.plan_qty-pp.finished_qty)),0) qty
      FROM scm_production_plan_product pp JOIN scm_production_plan p ON p.id=pp.plan_id
      WHERE p.account_set_id=? AND p.status='released' GROUP BY pp.item_code`).all(aid) as any[]) add(inTransit, row.item_code, row.qty)

    const otherReserved = new Map<string, number>()
    const otherSales = db.prepare(`SELECT d.id,l.item_code,l.qty,
      ((SELECT COALESCE(SUM(c.qty),0) FROM scm_doc_line c WHERE c.source_line_id=l.id)
       +(SELECT COALESCE(SUM(pp.plan_qty),0) FROM scm_production_plan_product pp WHERE pp.source_line_id=l.id)) pushed
      FROM scm_doc d JOIN scm_doc_line l ON l.doc_id=d.id
      WHERE d.account_set_id=? AND d.doc_type='SOa' AND d.status='audited'`).all(aid) as any[]
    for (const row of otherSales) if (!selectedSourceIds.has(row.id)) add(otherReserved, row.item_code, Math.max(0, Number(row.qty)-Number(row.pushed)))
    const otherPlans = db.prepare("SELECT * FROM scm_production_plan WHERE account_set_id=? AND status='released'").all(aid) as any[]
    for (const plan of otherPlans) if (!selectedSourceIds.has(plan.id)) {
      for (const line of computeIssueSuggestion(db, aid, plan)) add(otherReserved, line.item_code, Number(line.suggest) || 0)
    }

    const otherMrp = new Map<string, number>()
    const otherResults = db.prepare(`SELECT l.id,l.item_code,l.qty FROM scm_doc_line l JOIN scm_doc d ON d.id=l.doc_id
      WHERE d.account_set_id=? AND d.doc_type='MRP' AND d.id<>? AND d.status IN ('draft','audited')`).all(aid, mrpId) as any[]
    for (const result of otherResults) {
      const mrLines = db.prepare(`SELECT ml.id FROM scm_doc_line ml JOIN scm_doc md ON md.id=ml.doc_id
        WHERE md.account_set_id=? AND md.doc_type='MR' AND ml.source_line_id=?`).all(aid, result.id) as any[]
      let generated = 0
      for (const mrLine of mrLines) generated += computePushedQty(db, mrLine.id)
      add(otherMrp, result.item_code, Math.max(0, Number(result.qty) - generated))
    }

    const bomCache = new Map<string, BomInfo | null>()
    const getBom = (code: string): BomInfo | null => {
      if (bomCache.has(code)) return bomCache.get(code)!
      const head = db.prepare(`SELECT id,code FROM scm_bom WHERE account_set_id=? AND item_code=? AND status='active'
        ORDER BY is_default DESC,code LIMIT 1`).get(aid, code) as any
      if (!head) { bomCache.set(code, null); return null }
      const components = (db.prepare("SELECT item_code,qty,COALESCE(scrap_rate,0) scrap_rate FROM scm_bom_line WHERE bom_id=? AND line_type='component' ORDER BY seq").all(head.id) as any[])
        .map(line => ({ item_code: String(line.item_code || ''), per: r6(Number(line.qty) * (1 + Number(line.scrap_rate)/100)) }))
        .filter(line => line.item_code && line.per > 0)
      const value = { id: String(head.id), code: String(head.code || ''), components }
      bomCache.set(code, value); return value
    }
    const sourceTypeOf = (code: string) => {
      const override = rootOverride.get(code)?.source_type
      return override === 'self' || override === 'outsource' || override === 'assembly' ? override : (items.get(code)?.source_type === 'self' || items.get(code)?.source_type === 'outsource' || items.get(code)?.source_type === 'assembly' ? items.get(code).source_type : 'purchase')
    }

    const depth = new Map<string, number>()
    const parents = new Map<string, Set<string>>()
    const cycles: string[][] = []
    const walk = (code: string, level: number, path: string[]) => {
      depth.set(code, Math.max(depth.get(code) || 0, level))
      if (sourceTypeOf(code) === 'purchase') return
      const bom = getBom(code); if (!bom) return
      for (const component of bom.components) {
        if (!parents.has(component.item_code)) parents.set(component.item_code, new Set())
        parents.get(component.item_code)!.add(code)
        const pos = path.indexOf(component.item_code)
        if (pos >= 0) { cycles.push([...path.slice(pos), component.item_code]); continue }
        walk(component.item_code, level + 1, [...path, component.item_code])
      }
    }
    for (const code of gross.keys()) walk(code, 0, [code])

    const includeSafetyStock = options.include_safety_stock !== false
    const resultRows: any[] = []
    const warnings: string[] = []
    for (const code of [...depth.keys()].sort((a,b) => (depth.get(a)!-depth.get(b)!) || a.localeCompare(b))) {
      const item = items.get(code) || {}
      const grossQty = r6(gross.get(code) || 0)
      const stockQty = r6(onHand.get(code) || 0)
      const reserveQty = r6(otherReserved.get(code) || 0)
      const effectiveStock = r6(Math.max(0, stockQty - reserveQty))
      const transitQty = r6(inTransit.get(code) || 0)
      const mrpQty = r6(otherMrp.get(code) || 0)
      const safetyQty = includeSafetyStock ? r6(item.safety_stock || 0) : 0
      const netQty = r6(Math.max(0, grossQty + safetyQty - effectiveStock - transitQty - mrpQty))
      const suggestQty = r6(netQty > 0 ? Math.max(netQty, Number(item.min_order_qty) || 0) : 0)
      const sourceType = sourceTypeOf(code)
      const bom = sourceType === 'purchase' ? null : getBom(code)
      const missingBom = sourceType !== 'purchase' && !bom
      if (missingBom && netQty > 0) warnings.push(`${code} 需补充 BOM，未继续展开`)
      const refsForItem = [...(contributors.get(code) || [])]
      const needDates = refsForItem.map(ref => String(sourceByKey.get(ref)?.need_date || '')).filter(Boolean).sort()
      const needDate = needDates[0] || null
      const leadDays = Number(item.lead_time_days) || 0
      const suggestedOrderDate = needDate
        ? new Date(new Date(`${needDate}T00:00:00`).getTime() - leadDays * 86400000).toISOString().slice(0, 10)
        : null
      resultRows.push({
        item_code: code, qty: suggestQty, supplier_code: rootOverride.get(code)?.supplier_code || item.supplier_code || '', source_type: sourceType,
        remark: missingBom ? '需补充 BOM，未继续展开' : '',
        field_values: {
          level: depth.get(code) || 0, parent_item_codes: [...(parents.get(code) || [])].sort(),
          gross_req: grossQty, direct_gross_qty: r6(direct.get(code) || 0), dependent_gross_qty: r6(grossQty-(direct.get(code)||0)),
          base_direct_gross_qty: r6(baseDirect.get(code) || 0),
          demand_multiplier: multiplier,
          multiplied_direct_gross_qty: r6(multipliedDirect.get(code) || 0),
          fixed_extra_qty: r6(fixedExtra.get(code) || 0),
          item_target_qty: itemTargets.get(code) || null,
          target_overridden: targetOverridden.has(code),
          final_direct_gross_qty: r6(direct.get(code) || 0),
          on_hand: stockQty, other_reserved: reserveQty, effective_stock: effectiveStock, in_transit: transitQty,
          other_mrp_supply: mrpQty, safety_stock: safetyQty, net_req: netQty, suggest_qty: suggestQty,
          min_order_qty: Number(item.min_order_qty)||0, lead_time_days: leadDays, need_date: needDate, suggested_order_date: suggestedOrderDate,
          bom_id: bom?.id || null, bom_code: bom?.code || '', missing_bom: missingBom, source_refs: refsForItem,
          source_contributions: [...(contributionQty.get(code) || new Map()).entries()]
            .map(([source_key, gross_qty]) => ({ source_key, gross_qty: r6(gross_qty) })),
        },
      })
      if (netQty > 0 && bom) for (const component of bom.components) {
        add(gross, component.item_code, netQty * component.per)
        if (!contributors.has(component.item_code)) contributors.set(component.item_code, new Set())
        for (const ref of refsForItem) contributors.get(component.item_code)!.add(ref)
        if (!contributionQty.has(component.item_code)) contributionQty.set(component.item_code, new Map())
        const childContributions = contributionQty.get(component.item_code)!
        const parentContributions = contributionQty.get(code) || new Map<string, number>()
        const parentTotal = [...parentContributions.values()].reduce((sum, qty) => sum + qty, 0)
        for (const [sourceKey, sourceGross] of parentContributions) {
          const childGross = parentTotal > 0 ? netQty * component.per * sourceGross / parentTotal : 0
          childContributions.set(sourceKey, r6((childContributions.get(sourceKey) || 0) + childGross))
        }
      }
    }

    db.prepare('DELETE FROM scm_doc_line WHERE doc_id=? AND account_set_id=?').run(mrpId, aid)
    const insertLine = db.prepare(`INSERT INTO scm_doc_line
      (id,account_set_id,doc_id,seq,item_code,qty,price,amount,remark,field_values,supplier_code,source_type)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
    let seq = 0, total = 0
    const netByItem = new Map<string, number>()
    for (const row of resultRows.filter(row => row.qty > 0)) {
      const lineId = uuidv4(); seq++; total += row.qty
      insertLine.run(lineId, aid, mrpId, seq, row.item_code, row.qty, 0, 0, row.remark, JSON.stringify(row.field_values), row.supplier_code, row.source_type)
      netByItem.set(row.item_code, Number(row.field_values.net_req) || 0)
    }
    db.prepare('UPDATE scm_mrp_source SET allocated_net_qty=0 WHERE mrp_doc_id=?').run(mrpId)
    const updateAllocated = db.prepare('UPDATE scm_mrp_source SET allocated_net_qty=? WHERE id=?')
    const finalDemandBySourceId = new Map(projections.map(row => [String(row.source.id), row.finalDemand]))
    for (const [code, net] of netByItem) {
      let remain = net
      for (const source of sources.filter(row => row.item_code === code)) {
        const finalDemand = finalDemandBySourceId.get(String(source.id)) || 0
        const allocated = r6(Math.min(remain, finalDemand)); updateAllocated.run(allocated, source.id); remain = r6(Math.max(0, remain-allocated))
      }
    }
    const headerValues = {
      ...options,
      include_safety_stock: includeSafetyStock,
      demand_multiplier: multiplier,
      item_target_qty: Object.fromEntries(itemTargets),
      calculated_at: new Date().toISOString(), has_cycle: cycles.length>0, cycles, warnings, calc_version: 2,
    }
    db.prepare("UPDATE scm_doc SET total_qty=?,total_amount=0,field_values=?,updated_at=datetime('now') WHERE id=?").run(r6(total), JSON.stringify(headerValues), mrpId)
    return { rows: seq, total_qty: r6(total), has_cycle: cycles.length > 0, cycles, warnings }
  })()
}

export function createMrpDocument(db: Database.Database, aid: string, user: string, body: any) {
  const refs = [...new Map((body.sources || []).map((raw: any) => {
    const ref = { kind: ensureSourceKind(raw.kind), id: String(raw.id || '') }
    return [`${ref.kind}:${ref.id}`, ref]
  })).values()].filter((ref: any) => ref.id) as MrpSourceRef[]
  if (!refs.length) throw new Error('请至少选择一张来源单据')

  // 从来源单据直接进入时复用已有有效计算单，避免用户得到一条“已占用”死路。
  const occupiedIds = new Set<string>()
  let occupiedDoc: any = null
  for (const ref of refs) {
    const row = db.prepare(`SELECT s.mrp_doc_id,d.doc_no,d.status
      FROM scm_mrp_source s JOIN scm_doc d ON d.id=s.mrp_doc_id
      WHERE s.account_set_id=? AND s.source_kind=? AND s.source_id=?
        AND d.doc_type='MRP' AND d.status IN ('draft','audited') LIMIT 1`
    ).get(aid, ref.kind, ref.id) as any
    if (row) { occupiedIds.add(row.mrp_doc_id); occupiedDoc = row }
  }
  if (occupiedIds.size === 1 && refs.every(ref => db.prepare(`SELECT 1 FROM scm_mrp_source
      WHERE account_set_id=? AND mrp_doc_id=? AND source_kind=? AND source_id=? LIMIT 1`
    ).get(aid, occupiedDoc.mrp_doc_id, ref.kind, ref.id))) {
    return { id: occupiedDoc.mrp_doc_id, doc_no: occupiedDoc.doc_no, status: occupiedDoc.status, reused: true }
  }
  if (occupiedIds.size) throw new Error('所选来源中存在已被其他 MRP 计算单占用的单据')

  const id = uuidv4(), no = nextDocNo(db, aid, 'MRP')
  db.transaction(() => {
    db.prepare(`INSERT INTO scm_doc
      (id,account_set_id,doc_type,doc_no,doc_date,operator,maker,status,total_qty,total_amount,remark,field_values)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, aid, 'MRP', no, body.doc_date || new Date().toISOString().slice(0,10), user, user, 'draft', 0, 0, body.remark || null,
        JSON.stringify({
          include_safety_stock: body.include_safety_stock !== false,
          demand_multiplier: demandMultiplier(body),
          item_target_qty: Object.fromEntries(itemTargetQtyMap(body)),
        }))
    replaceMrpSources(db, aid, id, refs)
    calculateMrpDocument(db, aid, id)
  })()
  return { id, doc_no: no, status: 'draft', reused: false }
}

export function generateShortageFromMrp(db: Database.Database, aid: string, mrpId: string, user: string) {
  const mrp = db.prepare("SELECT * FROM scm_doc WHERE id=? AND account_set_id=? AND doc_type='MRP'").get(mrpId, aid) as any
  if (!mrp) throw new Error('MRP计算单不存在')
  if (mrp.status !== 'audited') throw new Error('MRP计算单未审核，不可下推缺料单')
  const existing = db.prepare("SELECT id,doc_no,status FROM scm_doc WHERE account_set_id=? AND doc_type='MR' AND source_doc_id=? ORDER BY created_at LIMIT 1").get(aid, mrpId) as any
  if (existing) return { ...existing, reused: true }
  const results = db.prepare('SELECT * FROM scm_doc_line WHERE account_set_id=? AND doc_id=? AND qty>0 ORDER BY seq').all(aid, mrpId) as any[]
  if (!results.length) throw new Error('本计算单无净缺口，无需生成缺料单')
  const id = uuidv4(), no = nextDocNo(db, aid, 'MR')
  db.transaction(() => {
    db.prepare(`INSERT INTO scm_doc
      (id,account_set_id,doc_type,doc_no,doc_date,operator,maker,status,source_doc_id,total_qty,total_amount,remark,field_values)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, aid, 'MR', no, new Date().toISOString().slice(0,10), user, user, 'draft', mrpId,
        r6(results.reduce((sum,row)=>sum+Number(row.qty),0)), 0, `由MRP计算单 ${mrp.doc_no} 生成`, JSON.stringify({ mrp_precalculated: true }))
    const insert = db.prepare(`INSERT INTO scm_doc_line
      (id,account_set_id,doc_id,seq,item_code,warehouse_code,qty,price,amount,source_line_id,remark,field_values,supplier_code,source_type)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    let seq = 0
    for (const result of results) insert.run(uuidv4(), aid, id, ++seq, result.item_code, result.warehouse_code, result.qty, 0, 0,
      result.id, result.remark, result.field_values || '{}', result.supplier_code, result.source_type)
  })()
  return { id, doc_no: no, status: 'draft', reused: false }
}

export function listMrpSourceOptions(
  db: Database.Database,
  aid: string,
  kind: MrpSourceKind,
  keyword = '',
  options: { excludeOccupied?: boolean; currentMrpId?: string } = {},
) {
  kind = ensureSourceKind(kind)
  const like = `%${keyword.trim()}%`
  let rows: any[] = []
  if (kind === 'sales_order' || kind === 'assembly') {
    const type = kind === 'sales_order' ? 'SOa' : 'AS'
    const status = kind === 'sales_order' ? 'audited' : 'draft'
    rows = db.prepare(`SELECT id,doc_no AS source_no,doc_date,status,total_qty,partner_code
      FROM scm_doc WHERE account_set_id=? AND doc_type=? AND status=? AND (?='' OR doc_no LIKE ?)
      ORDER BY doc_date DESC,doc_no DESC LIMIT 200`).all(aid, type, status, keyword.trim(), like) as any[]
  } else {
    const type = kind === 'outsource_plan' ? 'outsource' : 'self'
    rows = db.prepare(`SELECT p.id,p.code AS source_no,p.start_date AS doc_date,p.status,p.plan_qty AS total_qty,p.supplier_code
      FROM scm_production_plan p LEFT JOIN scm_doc sd ON sd.id=p.source_doc_id
      WHERE p.account_set_id=? AND p.plan_type=? AND p.status='released' AND COALESCE(sd.doc_type,'') NOT IN ('MR','MRP')
        AND (?='' OR p.code LIKE ?) ORDER BY p.code DESC LIMIT 200`).all(aid, type, keyword.trim(), like) as any[]
  }
  const result = rows.map(row => {
    const currentMrpId = options.currentMrpId || ''
    const occupied = db.prepare(`SELECT s.mrp_doc_id,d.doc_no FROM scm_mrp_source s JOIN scm_doc d ON d.id=s.mrp_doc_id
      WHERE s.account_set_id=? AND s.source_kind=? AND s.source_id=? AND d.status IN ('draft','audited')
        AND (?='' OR s.mrp_doc_id<>?) LIMIT 1`).get(aid, kind, row.id, currentMrpId, currentMrpId) as any
    let eligible = !occupied, reason = occupied ? `已进入 ${occupied.doc_no}` : ''
    if (eligible) {
      try { if (!normalizeRef(db, aid, { kind, id: row.id }).rows.length) { eligible = false; reason = '已无可计算需求' } }
      catch (error: any) { eligible = false; reason = error?.message || '来源不可用' }
    }
    return { ...row, kind, eligible, reason, occupied_mrp_id: occupied?.mrp_doc_id || null }
  })
  return options.excludeOccupied ? result.filter(row => !row.occupied_mrp_id) : result
}
