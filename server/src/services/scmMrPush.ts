import type Database from 'better-sqlite3'
import { computePushedQty } from './scmProduction.js'

const r6 = (n: number) => Math.round((Number(n) || 0) * 1000000) / 1000000

export type MrPushTarget = 'purchase' | 'outsource' | 'self' | 'assembly'

export interface MrPushRootSource {
  line_id: string
  qty: number
  pushed_qty: number
  remaining_qty: number
  warehouse_code: string
}

export interface MrPushPreviewNode {
  key: string
  level: number
  parent_item_codes: string[]
  item_code: string
  item_name: string
  spec: string
  unit: string
  source_type: MrPushTarget
  supplier_code: string
  purchase_price: number
  bom_id: string | null
  bom_code: string
  root_qty: number
  dependent_gross_qty: number
  gross_qty: number
  stock_qty: number
  external_supply_qty: number
  required_qty: number
  generated_qty: number
  suggest_qty: number
  missing_bom: boolean
  root_sources: MrPushRootSource[]
}

export interface MrPushPreviewResult {
  nodes: MrPushPreviewNode[]
  cycles: string[][]
  has_cycle: boolean
}

export interface MrProductionPlanLine {
  item_code: string
  eff_source: 'self' | 'outsource'
  eff_supplier?: string | null
  mr_level?: number
}

export interface MrProductionPlanGroup<T extends MrProductionPlanLine = MrProductionPlanLine> {
  plan_type: 'self' | 'outsource'
  supplier_code: string
  level: number
  lines: T[]
}

export function resolveMrPushNodeSupplier(
  sourceType: MrPushTarget,
  currentSupplier: string | null | undefined,
  selectedSupplier: string | null | undefined,
): string {
  const selected = String(selectedSupplier || '').trim()
  if ((sourceType === 'purchase' || sourceType === 'outsource') && selected) return selected
  return String(currentSupplier || '').trim()
}

type BomInfo = {
  id: string
  code: string
  components: Array<{ item_code: string; per: number }>
}

/**
 * 缺料下推生产工单分组：自制按 BOM 层级，委外按供应商 + BOM 层级。
 * 层级异常时再按完整父子图校验，存在直接或间接依赖的物料强制拆组。
 */
export function groupMrProductionPlanLines<T extends MrProductionPlanLine>(
  lines: T[],
  dependencyNodes: Array<Pick<MrPushPreviewNode, 'item_code' | 'parent_item_codes'>>,
): MrProductionPlanGroup<T>[] {
  const parents = new Map<string, Set<string>>()
  for (const node of dependencyNodes) {
    if (!parents.has(node.item_code)) parents.set(node.item_code, new Set())
    for (const parent of node.parent_item_codes || []) parents.get(node.item_code)!.add(parent)
  }

  const ancestorCache = new Map<string, Set<string>>()
  const ancestorsOf = (code: string, visiting = new Set<string>()): Set<string> => {
    if (ancestorCache.has(code)) return ancestorCache.get(code)!
    if (visiting.has(code)) return new Set()
    visiting.add(code)
    const result = new Set<string>()
    for (const parent of parents.get(code) || []) {
      result.add(parent)
      for (const ancestor of ancestorsOf(parent, visiting)) result.add(ancestor)
    }
    visiting.delete(code)
    ancestorCache.set(code, result)
    return result
  }
  const hasDependency = (left: string, right: string) =>
    left !== right && (ancestorsOf(left).has(right) || ancestorsOf(right).has(left))

  const grouped = new Map<string, MrProductionPlanGroup<T>[]>()
  for (const line of lines) {
    const planType = line.eff_source
    const supplierCode = planType === 'outsource' ? String(line.eff_supplier || '').trim() : ''
    const level = Math.max(0, Number(line.mr_level) || 0)
    const key = `${planType}\u0000${supplierCode}\u0000${level}`
    const candidates = grouped.get(key) || []
    let target = candidates.find(group =>
      group.lines.every(existing => !hasDependency(existing.item_code, line.item_code)),
    )
    if (!target) {
      target = { plan_type: planType, supplier_code: supplierCode, level, lines: [] }
      candidates.push(target)
      grouped.set(key, candidates)
    }
    target.lines.push(line)
  }

  return [...grouped.values()].flat()
}

/**
 * 缺料单多层 BOM 下推预览。
 * 根缺料行已经是外部净需求，不重复扣库存；依赖需求按物料汇总后统一扣全部仓库存量和外部在途。
 * 本缺料单已经生成的采购/组装/生产/委外数量单独扣减，避免重复下推又避免与外部在途双计。
 */
export function buildMrPushPreview(
  db: Database.Database,
  accountSetId: string,
  mrDocId: string,
): MrPushPreviewResult {
  const aid = accountSetId
  const mrHead = db.prepare('SELECT doc_type,source_doc_id,field_values FROM scm_doc WHERE id=? AND account_set_id=?').get(mrDocId, aid) as any
  if (mrHead?.doc_type === 'MRP') {
    return buildPrecalculatedMrPushPreview(db, aid, mrDocId, true)
  }
  const mrFlags = parseJson(mrHead?.field_values)
  const upstream = mrHead?.source_doc_id
    ? db.prepare('SELECT doc_type FROM scm_doc WHERE id=? AND account_set_id=?').get(mrHead.source_doc_id, aid) as any
    : null
  if (mrFlags.mrp_precalculated === true || upstream?.doc_type === 'MRP') {
    return buildPrecalculatedMrPushPreview(db, aid, mrDocId, false)
  }
  const roots = db.prepare(`
    SELECT l.id, l.item_code, l.qty, COALESCE(l.warehouse_code,'') AS warehouse_code,
           COALESCE(NULLIF(l.source_type,''),i.source_type,'purchase') AS source_type,
           COALESCE(NULLIF(l.supplier_code,''),i.supplier_code,'') AS supplier_code
    FROM scm_doc_line l
    LEFT JOIN scm_item i ON i.account_set_id=l.account_set_id AND i.code=l.item_code
    WHERE l.account_set_id=? AND l.doc_id=?
    ORDER BY l.seq
  `).all(aid, mrDocId) as any[]

  const itemCache = new Map<string, any>()
  const getItem = (code: string) => {
    if (!itemCache.has(code)) {
      itemCache.set(code, db.prepare(`SELECT code,name,spec,unit,COALESCE(source_type,'purchase') AS source_type,
        COALESCE(supplier_code,'') AS supplier_code,COALESCE(purchase_price,0) AS purchase_price
        FROM scm_item WHERE account_set_id=? AND code=?`).get(aid, code) || null)
    }
    return itemCache.get(code)
  }

  const bomCache = new Map<string, BomInfo | null>()
  const getBom = (code: string): BomInfo | null => {
    if (bomCache.has(code)) return bomCache.get(code)!
    const bom = db.prepare(`SELECT id,code FROM scm_bom
      WHERE account_set_id=? AND item_code=? AND status='active'
      ORDER BY is_default DESC,code LIMIT 1`).get(aid, code) as any
    if (!bom) {
      bomCache.set(code, null)
      return null
    }
    const components = (db.prepare(`SELECT item_code,qty,COALESCE(scrap_rate,0) AS scrap_rate
      FROM scm_bom_line WHERE bom_id=? AND line_type='component' ORDER BY seq`).all(bom.id) as any[])
      .map(line => ({
        item_code: String(line.item_code),
        per: r6((Number(line.qty) || 0) * (1 + (Number(line.scrap_rate) || 0) / 100)),
      }))
      .filter(line => line.item_code && line.per > 0)
    const result = { id: String(bom.id), code: String(bom.code || ''), components }
    bomCache.set(code, result)
    return result
  }

  const stock = new Map<string, number>()
  for (const row of db.prepare(`SELECT item_code,COALESCE(SUM(qty),0) AS qty
    FROM scm_stock WHERE account_set_id=? GROUP BY item_code`).all(aid) as any[]) {
    stock.set(row.item_code, r6(row.qty))
  }

  // 外部采购在途：排除本缺料单直接生成的采购单，以及由本缺料单询价单继续下推的采购单。
  const externalSupply = new Map<string, number>()
  const addExternal = (code: string, qty: number) => externalSupply.set(code, r6((externalSupply.get(code) || 0) + qty))
  for (const row of db.prepare(`
    SELECT l.item_code,COALESCE(SUM(MAX(0,l.qty-(SELECT COALESCE(SUM(c.qty),0) FROM scm_doc_line c WHERE c.source_line_id=l.id))),0) AS qty
    FROM scm_doc_line l
    JOIN scm_doc d ON d.id=l.doc_id
    LEFT JOIN scm_doc parent ON parent.id=d.source_doc_id
    WHERE d.account_set_id=? AND d.doc_type='PO' AND d.status='audited'
      AND COALESCE(d.source_doc_id,'')<>?
      AND COALESCE(parent.source_doc_id,'')<>?
    GROUP BY l.item_code
  `).all(aid, mrDocId, mrDocId) as any[]) addExternal(row.item_code, Number(row.qty) || 0)

  // 外部生产/委外在途：只计已审核（released）且尚未完工的数量，排除本缺料单生成的工单。
  for (const row of db.prepare(`
    SELECT pp.item_code,COALESCE(SUM(MAX(0,pp.plan_qty-pp.finished_qty)),0) AS qty
    FROM scm_production_plan_product pp
    JOIN scm_production_plan p ON p.id=pp.plan_id
    WHERE p.account_set_id=? AND p.status='released' AND COALESCE(p.source_doc_id,'')<>?
    GROUP BY pp.item_code
  `).all(aid, mrDocId) as any[]) addExternal(row.item_code, Number(row.qty) || 0)

  // 本缺料单已生成量按“缺料单 + 物料”汇总。采购/询价只算采购行；组装只算成品行。
  const generated = new Map<string, number>()
  const addGenerated = (code: string, qty: number) => generated.set(code, r6((generated.get(code) || 0) + qty))
  for (const row of db.prepare(`
    SELECT l.item_code,COALESCE(SUM(l.qty),0) AS qty
    FROM scm_doc_line l JOIN scm_doc d ON d.id=l.doc_id
    WHERE d.account_set_id=? AND d.source_doc_id=?
      AND (d.doc_type IN ('PO','PQ') OR (d.doc_type='AS' AND l.line_role='product'))
    GROUP BY l.item_code
  `).all(aid, mrDocId) as any[]) addGenerated(row.item_code, Number(row.qty) || 0)
  for (const row of db.prepare(`
    SELECT pp.item_code,COALESCE(SUM(pp.plan_qty),0) AS qty
    FROM scm_production_plan_product pp JOIN scm_production_plan p ON p.id=pp.plan_id
    WHERE p.account_set_id=? AND p.source_doc_id=? GROUP BY pp.item_code
  `).all(aid, mrDocId) as any[]) addGenerated(row.item_code, Number(row.qty) || 0)

  const rootQty = new Map<string, number>()
  const rootPushed = new Map<string, number>()
  const rootSources = new Map<string, MrPushRootSource[]>()
  const sourceOverride = new Map<string, { source_type: MrPushTarget; supplier_code: string }>()
  for (const root of roots) {
    const qty = r6(root.qty)
    const pushed = r6(computePushedQty(db, root.id))
    rootQty.set(root.item_code, r6((rootQty.get(root.item_code) || 0) + qty))
    rootPushed.set(root.item_code, r6((rootPushed.get(root.item_code) || 0) + pushed))
    const list = rootSources.get(root.item_code) || []
    list.push({
      line_id: root.id,
      qty,
      pushed_qty: pushed,
      remaining_qty: r6(Math.max(0, qty - pushed)),
      warehouse_code: root.warehouse_code || '',
    })
    rootSources.set(root.item_code, list)
    sourceOverride.set(root.item_code, {
      source_type: normalizeSourceType(root.source_type),
      supplier_code: root.supplier_code || '',
    })
  }

  // 建立可达 BOM 图、低层码和父项集合；采购来源即使有 BOM 也作为终点。
  const depth = new Map<string, number>()
  const parents = new Map<string, Set<string>>()
  const cycles: string[][] = []
  const walk = (code: string, level: number, path: string[]) => {
    depth.set(code, Math.max(depth.get(code) || 0, level))
    const override = sourceOverride.get(code)
    const sourceType = override?.source_type || normalizeSourceType(getItem(code)?.source_type)
    if (sourceType === 'purchase') return
    const bom = getBom(code)
    if (!bom) return
    for (const component of bom.components) {
      if (!parents.has(component.item_code)) parents.set(component.item_code, new Set())
      parents.get(component.item_code)!.add(code)
      const pos = path.indexOf(component.item_code)
      if (pos >= 0) {
        cycles.push([...path.slice(pos), component.item_code])
        continue
      }
      walk(component.item_code, level + 1, [...path, component.item_code])
    }
  }
  for (const code of rootQty.keys()) walk(code, 0, [code])

  const dependentGross = new Map<string, number>()
  const nodes: MrPushPreviewNode[] = []
  const ordered = [...depth.keys()].sort((a, b) => (depth.get(a)! - depth.get(b)!) || a.localeCompare(b))
  for (const code of ordered) {
    const item = getItem(code) || {}
    const override = sourceOverride.get(code)
    const sourceType = override?.source_type || normalizeSourceType(item.source_type)
    const rootsForItem = r6(rootQty.get(code) || 0)
    const dependent = r6(dependentGross.get(code) || 0)
    const stockQty = r6(stock.get(code) || 0)
    const externalQty = r6(externalSupply.get(code) || 0)
    const dependentRequired = r6(Math.max(0, dependent - stockQty - externalQty))
    const requiredQty = r6(rootsForItem + dependentRequired)
    const generatedQty = r6(Math.max(generated.get(code) || 0, rootPushed.get(code) || 0))
    const suggestQty = r6(Math.max(0, requiredQty - generatedQty))
    const bom = sourceType === 'purchase' ? null : getBom(code)

    nodes.push({
      key: code,
      level: depth.get(code) || 0,
      parent_item_codes: [...(parents.get(code) || [])].sort(),
      item_code: code,
      item_name: item.name || '',
      spec: item.spec || '',
      unit: item.unit || '',
      source_type: sourceType,
      supplier_code: override?.supplier_code || item.supplier_code || '',
      purchase_price: Number(item.purchase_price) || 0,
      bom_id: bom?.id || null,
      bom_code: bom?.code || '',
      root_qty: rootsForItem,
      dependent_gross_qty: dependent,
      gross_qty: r6(rootsForItem + dependent),
      stock_qty: dependent > 0 ? stockQty : 0,
      external_supply_qty: dependent > 0 ? externalQty : 0,
      required_qty: requiredQty,
      generated_qty: generatedQty,
      suggest_qty: suggestQty,
      missing_bom: sourceType !== 'purchase' && !bom,
      root_sources: rootSources.get(code) || [],
    })

    // 子件需求取父项完整 required_qty，而不是仅取本次建议量；这样父工单先生成后，子层需求仍会保留。
    if (requiredQty > 0 && bom) {
      for (const component of bom.components) {
        dependentGross.set(component.item_code, r6((dependentGross.get(component.item_code) || 0) + requiredQty * component.per))
      }
    }
  }

  return { nodes, cycles, has_cycle: cycles.length > 0 }
}

function normalizeSourceType(value: unknown): MrPushTarget {
  return value === 'self' || value === 'outsource' || value === 'assembly' ? value : 'purchase'
}

function parseJson(value: unknown): any {
  if (value && typeof value === 'object') return value
  try { return JSON.parse(String(value || '{}')) } catch { return {} }
}

/** MRP 已完成完整净算；此模式只读取计算快照并扣减当前来源单已经生成的数量。 */
function buildPrecalculatedMrPushPreview(
  db: Database.Database,
  aid: string,
  sourceDocId: string,
  directMrp: boolean,
): MrPushPreviewResult {
  const resultValuesSql = directMrp ? 'l.field_values' : 'pl.field_values'
  const rows = db.prepare(`SELECT l.*,${resultValuesSql} AS result_values,
      i.name AS item_name,i.spec,i.unit,COALESCE(i.purchase_price,0) purchase_price,
      COALESCE(NULLIF(l.source_type,''),i.source_type,'purchase') eff_source,
      COALESCE(NULLIF(l.supplier_code,''),i.supplier_code,'') eff_supplier
    FROM scm_doc_line l
    LEFT JOIN scm_doc_line pl ON pl.id=l.source_line_id
    LEFT JOIN scm_item i ON i.account_set_id=l.account_set_id AND i.code=l.item_code
    WHERE l.account_set_id=? AND l.doc_id=? ORDER BY l.seq`).all(aid, sourceDocId) as any[]
  const nodes = rows.map(row => {
    const values = parseJson(row.result_values || row.field_values)
    const qty = r6(row.qty)
    const pushed = r6(computePushedQty(db, row.id))
    return {
      key: String(row.item_code),
      level: Math.max(0, Number(values.level) || 0),
      parent_item_codes: Array.isArray(values.parent_item_codes) ? values.parent_item_codes.map(String) : [],
      item_code: String(row.item_code || ''), item_name: row.item_name || '', spec: row.spec || '', unit: row.unit || '',
      source_type: normalizeSourceType(row.eff_source), supplier_code: row.eff_supplier || '', purchase_price: Number(row.purchase_price) || 0,
      bom_id: values.bom_id || null, bom_code: values.bom_code || '',
      root_qty: qty, dependent_gross_qty: r6(values.dependent_gross_qty || 0), gross_qty: r6(values.gross_req || qty),
      stock_qty: r6(values.on_hand || 0),
      external_supply_qty: r6((Number(values.in_transit) || 0) + (Number(values.other_mrp_supply) || 0)),
      required_qty: qty, generated_qty: pushed, suggest_qty: r6(Math.max(0, qty - pushed)),
      missing_bom: values.missing_bom === true,
      root_sources: [{ line_id: row.id, qty, pushed_qty: pushed, remaining_qty: r6(Math.max(0, qty-pushed)), warehouse_code: row.warehouse_code || '' }],
    } satisfies MrPushPreviewNode
  })
  const head = directMrp
    ? db.prepare('SELECT field_values FROM scm_doc WHERE id=? AND account_set_id=?').get(sourceDocId, aid) as any
    : null
  const headValues = parseJson(head?.field_values)
  const cycles = Array.isArray(headValues.cycles)
    ? headValues.cycles.filter(Array.isArray).map((path: unknown[]) => path.map(String))
    : []
  return { nodes, cycles, has_cycle: headValues.has_cycle === true || cycles.length > 0 }
}
