import type Database from 'better-sqlite3'

export type SalesOrderRelationNodeKind = 'doc' | 'production_plan' | 'work_report' | 'qc'

export interface SalesOrderRelationNode {
  node_id: string
  node_kind: SalesOrderRelationNodeKind
  entity_id: string
  parent_node_id: string | null
  relation_type: string
  doc_type: string
  type_name: string
  doc_no: string
  doc_date: string | null
  partner_code: string | null
  partner_name: string | null
  item_summary: string
  total_qty: number
  total_amount: number
  status: string
  progress_text: string
  shared_order_count: number
  shared: boolean
  descendant_count: number
  children: SalesOrderRelationNode[]
}

export interface SalesOrderRelationQuery {
  page?: number
  pageSize?: number
  keyword?: string
  status?: string
  startDate?: string
  endDate?: string
}

type RelationEdge = { child: string; relationType: string }
type RelationNodeBase = Omit<SalesOrderRelationNode, 'parent_node_id' | 'relation_type' | 'descendant_count' | 'children' | 'shared'>

const DOC_TYPE_NAMES: Record<string, string> = {
  IS: '期初入库', PI: '采购入库', PR: '采购退货', SO: '销售出库', SR: '销售退货',
  OI: '其他入库', OO: '其他出库', TR: '调拨单', CK: '盘点单', PL: '生产领用',
  PF: '完工入库', PS: '不良品入库', PB: '补料单', PJ: '退料单', MRP: 'MRP计算单',
  WO: '委外发货', WI: '委外入库', AS: '组装单', DS: '拆卸单', PQ: '采购询价',
  PO: '采购订单', SQ: '销售报价', SOa: '销售订单', RP: '采购发票', RS: '销售发票',
  PAY: '付款单', RCV: '收款单', MR: '缺料单',
}

const RELATION_PRIORITY: Record<string, number> = {
  mrp_source: 10,
  source_doc: 20,
  source_line: 30,
  production_plan: 40,
  plan_doc: 50,
  work_report: 60,
  qc: 70,
  arap_payment: 80,
}

const NODE_KIND_PRIORITY: Record<SalesOrderRelationNodeKind, number> = {
  doc: 10,
  production_plan: 20,
  work_report: 30,
  qc: 40,
}

const chunks = <T>(items: T[], size = 300): T[][] => {
  const result: T[][] = []
  for (let i = 0; i < items.length; i += size) result.push(items.slice(i, i + size))
  return result
}

// BFS 节点总量上限：单个请求最多展开 2000 个关联节点（doc + plan + work + qc 累计）。
// 超过后提前结束 BFS，避免极端数据下节点数量爆炸（响应超时 / 内存暴涨）。
// 返回结构会带 truncated=true，前端会提示用户缩小查询范围。
const MAX_NODES = 2000

const ph = (ids: unknown[]) => ids.map(() => '?').join(',')
const docKey = (id: string) => `doc:${id}`
const planKey = (id: string) => `plan:${id}`
const workKey = (id: string) => `work:${id}`
const qcKey = (id: string) => `qc:${id}`

function tableExists(db: Database.Database, name: string): boolean {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name)
}

function columnExists(db: Database.Database, table: string, column: string): boolean {
  if (!tableExists(db, table)) return false
  return (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>)
    .some(item => item.name === column)
}

function addEdge(edges: Map<string, RelationEdge[]>, parent: string, child: string, relationType: string) {
  if (!parent || !child || parent === child) return
  const list = edges.get(parent) || []
  const existing = list.find(edge => edge.child === child)
  if (!existing) list.push({ child, relationType })
  else if ((RELATION_PRIORITY[relationType] || 999) < (RELATION_PRIORITY[existing.relationType] || 999)) existing.relationType = relationType
  edges.set(parent, list)
}

function numberValue(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function queryDocNodes(db: Database.Database, aid: string, ids: string[]): Map<string, RelationNodeBase> {
  const result = new Map<string, RelationNodeBase>()
  if (!ids.length) return result
  for (const part of chunks(ids)) {
    // 性能：把原本挂在每行的 3 个相关子查询（line_count + 2 个 JOIN 聚合）改为批量聚合后 JS 合并。
    // 与原行为 1:1 对齐：line_count = 本单据明细行数；pushed_qty = 下游 scm_doc_line.qty 之和
    // + 下游 scm_production_plan_product.plan_qty 之和（按 source_line_id 反查）。
    const rows = db.prepare(`
      SELECT d.id,d.doc_type,d.doc_no,d.doc_date,d.partner_code,d.total_qty,d.total_amount,d.status,
             p.name AS partner_name
      FROM scm_doc d
      LEFT JOIN scm_partner p ON p.account_set_id=d.account_set_id AND p.code=d.partner_code
      WHERE d.account_set_id=? AND d.id IN (${ph(part)})
    `).all(aid, ...part) as any[]

    // line_count：按 doc_id 聚合
    const lineCountMap = new Map<string, number>()
    const lineCountRows = db.prepare(`
      SELECT doc_id, COUNT(*) AS c FROM scm_doc_line
      WHERE account_set_id=? AND doc_id IN (${ph(part)}) GROUP BY doc_id
    `).all(aid, ...part) as any[]
    for (const r of lineCountRows) lineCountMap.set(r.doc_id, numberValue(r.c))

    // 本批次所有明细行 id（用于反查下游 pushed）
    const lineRows = db.prepare(`
      SELECT id, doc_id FROM scm_doc_line
      WHERE account_set_id=? AND doc_id IN (${ph(part)})
    `).all(aid, ...part) as any[]
    const lineIdsByDoc = new Map<string, string[]>()
    const allLineIds: string[] = []
    for (const r of lineRows) {
      const arr = lineIdsByDoc.get(r.doc_id) || []
      arr.push(r.id)
      lineIdsByDoc.set(r.doc_id, arr)
      allLineIds.push(r.id)
    }

    // pushed_qty：下游 scm_doc_line.source_line_id 反查 + scm_production_plan_product.source_line_id 反查
    const pushedByLine = new Map<string, number>()
    if (allLineIds.length) {
      for (const linePart of chunks(allLineIds)) {
        // P2-12：口径与 computeSourceLineUsedQty 对齐——排除作废单据并限定账套
        const downRows = db.prepare(`
          SELECT l.source_line_id AS lid, COALESCE(SUM(l.qty), 0) AS q
          FROM scm_doc_line l JOIN scm_doc d ON d.id=l.doc_id
          WHERE d.account_set_id=? AND d.status<>'voided' AND l.source_line_id IN (${ph(linePart)}) GROUP BY l.source_line_id
        `).all(aid, ...linePart) as any[]
        for (const r of downRows) pushedByLine.set(r.lid, (pushedByLine.get(r.lid) || 0) + numberValue(r.q))
        const planRows = db.prepare(`
          SELECT source_line_id AS lid, COALESCE(SUM(plan_qty), 0) AS q FROM scm_production_plan_product
          WHERE account_set_id=? AND source_line_id IN (${ph(linePart)}) GROUP BY source_line_id
        `).all(aid, ...linePart) as any[]
        for (const r of planRows) pushedByLine.set(r.lid, (pushedByLine.get(r.lid) || 0) + numberValue(r.q))
      }
    }
    const pushedByDoc = new Map<string, number>()
    for (const [docId, lineIds] of lineIdsByDoc) {
      let sum = 0
      for (const lid of lineIds) sum += pushedByLine.get(lid) || 0
      pushedByDoc.set(docId, sum)
    }

    const itemMap = new Map<string, string[]>()
    const itemRows = db.prepare(`
      SELECT l.doc_id,COALESCE(i.name,l.item_code,'') AS item_name
      FROM scm_doc_line l
      LEFT JOIN scm_item i ON i.account_set_id=l.account_set_id AND i.code=l.item_code
      WHERE l.account_set_id=? AND l.doc_id IN (${ph(part)})
      ORDER BY l.doc_id,l.seq
    `).all(aid, ...part) as any[]
    for (const row of itemRows) {
      const list = itemMap.get(row.doc_id) || []
      const name = String(row.item_name || '').trim()
      if (name && !list.includes(name) && list.length < 3) list.push(name)
      itemMap.set(row.doc_id, list)
    }

    for (const row of rows) {
      const totalQty = numberValue(row.total_qty)
      const pushedQty = pushedByDoc.get(row.id) || 0
      const progress = pushedQty > 0 && totalQty > 0 ? `${pushedQty} / ${totalQty}` : ''
      const items = itemMap.get(row.id) || []
      const lineCount = lineCountMap.get(row.id) || 0
      result.set(docKey(row.id), {
        node_id: docKey(row.id), node_kind: 'doc', entity_id: row.id,
        doc_type: row.doc_type || '', type_name: DOC_TYPE_NAMES[row.doc_type] || row.doc_type || '单据',
        doc_no: row.doc_no || '', doc_date: row.doc_date || null,
        partner_code: row.partner_code || null, partner_name: row.partner_name || null,
        item_summary: `${items.join('、')}${lineCount > items.length ? ` 等${lineCount}项` : ''}`,
        total_qty: totalQty, total_amount: numberValue(row.total_amount), status: row.status || '',
        progress_text: progress, shared_order_count: 1,
      })
    }
  }
  return result
}

function queryPlanNodes(db: Database.Database, aid: string, ids: string[]): Map<string, RelationNodeBase> {
  const result = new Map<string, RelationNodeBase>()
  for (const part of chunks(ids)) {
    const rows = db.prepare(`
      SELECT p.id,p.code,p.plan_type,p.item_code,p.plan_qty,p.finished_qty,p.supplier_code,p.status,p.start_date,p.end_date,
             sp.name AS partner_name,i.name AS item_name,
             (SELECT COUNT(*) FROM scm_production_plan_product pp WHERE pp.plan_id=p.id) AS product_count
      FROM scm_production_plan p
      LEFT JOIN scm_partner sp ON sp.account_set_id=p.account_set_id AND sp.code=p.supplier_code
      LEFT JOIN scm_item i ON i.account_set_id=p.account_set_id AND i.code=p.item_code
      WHERE p.account_set_id=? AND p.id IN (${ph(part)})
    `).all(aid, ...part) as any[]
    for (const row of rows) {
      const qty = numberValue(row.plan_qty)
      const finished = numberValue(row.finished_qty)
      const isOutsource = row.plan_type === 'outsource'
      result.set(planKey(row.id), {
        node_id: planKey(row.id), node_kind: 'production_plan', entity_id: row.id,
        doc_type: isOutsource ? 'OUTSOURCE_PLAN' : 'PRODUCTION_PLAN', type_name: isOutsource ? '委外计划' : '生产计划',
        doc_no: row.code || '', doc_date: row.start_date || row.end_date || null,
        partner_code: row.supplier_code || null, partner_name: row.partner_name || null,
        item_summary: `${row.item_name || row.item_code || ''}${numberValue(row.product_count) > 1 ? ` 等${row.product_count}项` : ''}`,
        total_qty: qty, total_amount: 0, status: row.status || '',
        progress_text: qty > 0 ? `${finished} / ${qty}` : '', shared_order_count: 1,
      })
    }
  }
  return result
}

function queryWorkNodes(db: Database.Database, aid: string, ids: string[]): Map<string, RelationNodeBase> {
  const result = new Map<string, RelationNodeBase>()
  if (!ids.length) return result
  for (const part of chunks(ids)) {
    const rows = db.prepare(`SELECT id,report_no,report_date,item_code,qty,scrap_qty,status FROM scm_work_report WHERE account_set_id=? AND id IN (${ph(part)})`).all(aid, ...part) as any[]
    for (const row of rows) result.set(workKey(row.id), {
      node_id: workKey(row.id), node_kind: 'work_report', entity_id: row.id,
      doc_type: 'WORK_REPORT', type_name: '生产报工', doc_no: row.report_no || '', doc_date: row.report_date || null,
      partner_code: null, partner_name: null, item_summary: row.item_code || '', total_qty: numberValue(row.qty),
      total_amount: 0, status: row.status || '', progress_text: numberValue(row.scrap_qty) > 0 ? `报废 ${row.scrap_qty}` : '', shared_order_count: 1,
    })
  }
  return result
}

function queryQcNodes(db: Database.Database, aid: string, ids: string[]): Map<string, RelationNodeBase> {
  const result = new Map<string, RelationNodeBase>()
  if (!ids.length) return result
  for (const part of chunks(ids)) {
    const rows = db.prepare(`SELECT id,qc_no,qc_type,qc_date,partner_code,result,status FROM scm_qc_doc WHERE account_set_id=? AND id IN (${ph(part)})`).all(aid, ...part) as any[]
    for (const row of rows) result.set(qcKey(row.id), {
      node_id: qcKey(row.id), node_kind: 'qc', entity_id: row.id,
      doc_type: 'QC', type_name: row.qc_type ? `质检-${row.qc_type}` : '质检单', doc_no: row.qc_no || '', doc_date: row.qc_date || null,
      partner_code: row.partner_code || null, partner_name: null, item_summary: '', total_qty: 0, total_amount: 0,
      status: row.status || row.result || '', progress_text: row.result || '', shared_order_count: 1,
    })
  }
  return result
}

export function querySalesOrderRelations(db: Database.Database, aid: string, query: SalesOrderRelationQuery = {}) {
  const page = Math.max(1, Number(query.page) || 1)
  const pageSize = Math.min(50, Math.max(1, Number(query.pageSize) || 20))
  const conditions = ["d.account_set_id=?", "d.doc_type='SOa'"]
  const params: any[] = [aid]
  const keyword = String(query.keyword || '').trim()
  if (keyword) {
    conditions.push('(d.doc_no LIKE ? OR d.partner_code LIKE ? OR p.name LIKE ?)')
    params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`)
  }
  if (query.status) { conditions.push('d.status=?'); params.push(query.status) }
  if (query.startDate) { conditions.push('d.doc_date>=?'); params.push(query.startDate) }
  if (query.endDate) { conditions.push('d.doc_date<=?'); params.push(query.endDate) }
  const where = conditions.join(' AND ')
  const total = numberValue((db.prepare(`SELECT COUNT(*) c FROM scm_doc d LEFT JOIN scm_partner p ON p.account_set_id=d.account_set_id AND p.code=d.partner_code WHERE ${where}`).get(...params) as any)?.c)
  const rootRows = db.prepare(`
    SELECT d.id FROM scm_doc d
    LEFT JOIN scm_partner p ON p.account_set_id=d.account_set_id AND p.code=d.partner_code
    WHERE ${where}
    ORDER BY d.doc_date DESC,d.doc_no DESC
    LIMIT ? OFFSET ?
  `).all(...params, pageSize, (page - 1) * pageSize) as Array<{ id: string }>
  const rootIds = rootRows.map(row => row.id)
  if (!rootIds.length) return { page, page_size: pageSize, total, roots: [], available_types: [] }

  const hasMrpSource = tableExists(db, 'scm_mrp_source')
  const hasPlans = tableExists(db, 'scm_production_plan')
  const hasPlanProducts = tableExists(db, 'scm_production_plan_product')
  const hasWorkReports = tableExists(db, 'scm_work_report')
  const hasQc = tableExists(db, 'scm_qc_doc')
  const hasArap = tableExists(db, 'scm_ar_ap_log')
    && columnExists(db, 'scm_ar_ap_log', 'doc_type')
    && columnExists(db, 'scm_ar_ap_log', 'doc_no')
    && columnExists(db, 'scm_doc_line', 'arap_source_log_id')
  const edges = new Map<string, RelationEdge[]>()
  const allDocIds = new Set(rootIds)
  const allPlanIds = new Set<string>()
  const workIds = new Set<string>()
  const qcIds = new Set<string>()
  const expandedDocs = new Set<string>()
  const expandedPlans = new Set<string>()
  let docFrontier = [...rootIds]
  let planFrontier: string[] = []
  let truncated = false

  // 节点总量超过 MAX_NODES 时停止发现新节点；继续把当前层已发现的关系边建好，
  // 但不再把新节点入队，下一轮 BFS 自然终止。
  const totalNodes = () => allDocIds.size + allPlanIds.size + workIds.size + qcIds.size
  const discoverDoc = (id: string, next: Set<string>) => {
    if (allDocIds.has(id)) return
    if (totalNodes() >= MAX_NODES) { truncated = true; return }
    allDocIds.add(id); next.add(id)
  }
  const discoverPlan = (id: string, next: Set<string>) => {
    if (allPlanIds.has(id)) return
    if (totalNodes() >= MAX_NODES) { truncated = true; return }
    allPlanIds.add(id); next.add(id)
  }

  for (let depth = 0; depth < 20 && (docFrontier.length || planFrontier.length); depth += 1) {
    const nextDocs = new Set<string>()
    const nextPlans = new Set<string>()
    const docsToExpand = docFrontier.filter(id => !expandedDocs.has(id))
    const plansToExpand = planFrontier.filter(id => !expandedPlans.has(id))
    docsToExpand.forEach(id => expandedDocs.add(id))
    plansToExpand.forEach(id => expandedPlans.add(id))

    for (const part of chunks(docsToExpand)) {
      const direct = db.prepare(`SELECT source_doc_id parent_id,id child_id FROM scm_doc WHERE account_set_id=? AND source_doc_id IN (${ph(part)})`).all(aid, ...part) as any[]
      for (const row of direct) { addEdge(edges, docKey(row.parent_id), docKey(row.child_id), 'source_doc'); discoverDoc(row.child_id, nextDocs) }

      const lineDocs = db.prepare(`
        SELECT DISTINCT pl.doc_id parent_id,cl.doc_id child_id
        FROM scm_doc_line pl JOIN scm_doc_line cl ON cl.source_line_id=pl.id
        WHERE pl.account_set_id=? AND pl.doc_id IN (${ph(part)})
      `).all(aid, ...part) as any[]
      for (const row of lineDocs) { addEdge(edges, docKey(row.parent_id), docKey(row.child_id), 'source_line'); discoverDoc(row.child_id, nextDocs) }

      if (hasMrpSource) {
        const mrps = db.prepare(`SELECT DISTINCT source_id parent_id,mrp_doc_id child_id FROM scm_mrp_source WHERE account_set_id=? AND source_id IN (${ph(part)})`).all(aid, ...part) as any[]
        for (const row of mrps) { addEdge(edges, docKey(row.parent_id), docKey(row.child_id), 'mrp_source'); discoverDoc(row.child_id, nextDocs) }
      }

      if (hasPlans) {
        const plans = db.prepare(`SELECT source_doc_id parent_id,id child_id FROM scm_production_plan WHERE account_set_id=? AND source_doc_id IN (${ph(part)})`).all(aid, ...part) as any[]
        for (const row of plans) { addEdge(edges, docKey(row.parent_id), planKey(row.child_id), 'production_plan'); discoverPlan(row.child_id, nextPlans) }
      }
      if (hasPlanProducts) {
        const plansByLine = db.prepare(`
          SELECT DISTINCT sl.doc_id parent_id,pp.plan_id child_id
          FROM scm_doc_line sl JOIN scm_production_plan_product pp ON pp.source_line_id=sl.id
          WHERE sl.account_set_id=? AND sl.doc_id IN (${ph(part)})
        `).all(aid, ...part) as any[]
        for (const row of plansByLine) { addEdge(edges, docKey(row.parent_id), planKey(row.child_id), 'production_plan'); discoverPlan(row.child_id, nextPlans) }
      }

      if (hasQc) {
        const qcs = db.prepare(`SELECT source_doc_id parent_id,id child_id FROM scm_qc_doc WHERE account_set_id=? AND source_doc_id IN (${ph(part)})`).all(aid, ...part) as any[]
        for (const row of qcs) {
          addEdge(edges, docKey(row.parent_id), qcKey(row.child_id), 'qc')
          if (!qcIds.has(row.child_id)) { if (totalNodes() >= MAX_NODES) { truncated = true } else { qcIds.add(row.child_id) } }
        }
      }

      if (hasArap) {
        const payments = db.prepare(`
          SELECT DISTINCT sd.id parent_id,pd.id child_id
          FROM scm_ar_ap_log al
          JOIN scm_doc sd ON sd.account_set_id=al.account_set_id
            AND sd.doc_type=al.doc_type AND sd.doc_no=al.doc_no
          JOIN scm_doc_line dl ON dl.account_set_id=al.account_set_id AND dl.arap_source_log_id=al.id
          JOIN scm_doc pd ON pd.id=dl.doc_id AND pd.account_set_id=al.account_set_id
          WHERE al.account_set_id=? AND sd.id IN (${ph(part)}) AND pd.doc_type IN ('RCV','PAY')
        `).all(aid, ...part) as any[]
        for (const row of payments) { addEdge(edges, docKey(row.parent_id), docKey(row.child_id), 'arap_payment'); discoverDoc(row.child_id, nextDocs) }
      }
    }

    for (const part of chunks(plansToExpand)) {
      const planDocs = db.prepare(`SELECT plan_id parent_id,id child_id FROM scm_doc WHERE account_set_id=? AND plan_id IN (${ph(part)})`).all(aid, ...part) as any[]
      for (const row of planDocs) { addEdge(edges, planKey(row.parent_id), docKey(row.child_id), 'plan_doc'); discoverDoc(row.child_id, nextDocs) }

      if (hasMrpSource) {
        const mrps = db.prepare(`SELECT DISTINCT source_id parent_id,mrp_doc_id child_id FROM scm_mrp_source WHERE account_set_id=? AND source_id IN (${ph(part)}) AND source_kind IN ('production_plan','outsource_plan')`).all(aid, ...part) as any[]
        for (const row of mrps) { addEdge(edges, planKey(row.parent_id), docKey(row.child_id), 'mrp_source'); discoverDoc(row.child_id, nextDocs) }
      }
      if (hasWorkReports) {
        const works = db.prepare(`SELECT plan_id parent_id,id child_id FROM scm_work_report WHERE account_set_id=? AND plan_id IN (${ph(part)})`).all(aid, ...part) as any[]
        for (const row of works) {
          addEdge(edges, planKey(row.parent_id), workKey(row.child_id), 'work_report')
          if (!workIds.has(row.child_id)) { if (totalNodes() >= MAX_NODES) { truncated = true } else { workIds.add(row.child_id) } }
        }
      }
      if (hasQc) {
        const qcs = db.prepare(`SELECT source_doc_id parent_id,id child_id FROM scm_qc_doc WHERE account_set_id=? AND source_doc_id IN (${ph(part)})`).all(aid, ...part) as any[]
        for (const row of qcs) {
          addEdge(edges, planKey(row.parent_id), qcKey(row.child_id), 'qc')
          if (!qcIds.has(row.child_id)) { if (totalNodes() >= MAX_NODES) { truncated = true } else { qcIds.add(row.child_id) } }
        }
      }
    }

    docFrontier = [...nextDocs]
    planFrontier = [...nextPlans]
  }

  const nodeMap = new Map<string, RelationNodeBase>()
  for (const [key, node] of queryDocNodes(db, aid, [...allDocIds])) nodeMap.set(key, node)
  if (hasPlans) for (const [key, node] of queryPlanNodes(db, aid, [...allPlanIds])) nodeMap.set(key, node)
  if (hasWorkReports) for (const [key, node] of queryWorkNodes(db, aid, [...workIds])) nodeMap.set(key, node)
  if (hasQc) for (const [key, node] of queryQcNodes(db, aid, [...qcIds])) nodeMap.set(key, node)

  if (hasMrpSource) {
    const mrpIds = [...allDocIds].filter(id => nodeMap.get(docKey(id))?.doc_type === 'MRP')
    for (const part of chunks(mrpIds)) {
      if (!part.length) continue
      const sharedRows = db.prepare(`
        SELECT mrp_doc_id,COUNT(DISTINCT source_id) cnt
        FROM scm_mrp_source
        WHERE account_set_id=? AND source_kind='sales_order' AND mrp_doc_id IN (${ph(part)})
        GROUP BY mrp_doc_id
      `).all(aid, ...part) as any[]
      for (const row of sharedRows) {
        const node = nodeMap.get(docKey(row.mrp_doc_id))
        if (node) node.shared_order_count = Math.max(1, numberValue(row.cnt))
      }
    }
  }

  const sortEdges = (list: RelationEdge[]) => [...list].sort((a, b) => {
    const rel = (RELATION_PRIORITY[a.relationType] || 999) - (RELATION_PRIORITY[b.relationType] || 999)
    if (rel) return rel
    const an = nodeMap.get(a.child); const bn = nodeMap.get(b.child)
    const kind = (NODE_KIND_PRIORITY[an?.node_kind || 'doc'] || 99) - (NODE_KIND_PRIORITY[bn?.node_kind || 'doc'] || 99)
    if (kind) return kind
    return String(an?.doc_no || '').localeCompare(String(bn?.doc_no || ''), 'zh-CN')
  })

  const buildTree = (rootId: string): SalesOrderRelationNode | null => {
    const used = new Set<string>()
    const walk = (key: string, parentId: string | null, relationType: string, inheritedShared = 1, stack = new Set<string>()): SalesOrderRelationNode | null => {
      if (used.has(key) || stack.has(key)) return null
      const base = nodeMap.get(key)
      if (!base) return null
      used.add(key)
      const nextStack = new Set(stack); nextStack.add(key)
      const sharedCount = Math.max(inheritedShared, base.shared_order_count || 1)
      const children = sortEdges(edges.get(key) || [])
        .map(edge => walk(edge.child, key, edge.relationType, sharedCount, nextStack))
        .filter((node): node is SalesOrderRelationNode => !!node)
      const descendantCount = children.reduce((sum, child) => sum + 1 + child.descendant_count, 0)
      return {
        ...base,
        parent_node_id: parentId,
        relation_type: relationType,
        shared_order_count: sharedCount,
        shared: sharedCount > 1,
        descendant_count: descendantCount,
        children,
      }
    }
    return walk(docKey(rootId), null, 'root')
  }

  const roots = rootIds.map(buildTree).filter((node): node is SalesOrderRelationNode => !!node)
  const availableTypes = new Map<string, string>()
  const collectTypes = (node: SalesOrderRelationNode) => {
    availableTypes.set(node.doc_type, node.type_name)
    node.children.forEach(collectTypes)
  }
  roots.forEach(collectTypes)
  return {
    page,
    page_size: pageSize,
    total,
    roots,
    available_types: [...availableTypes.entries()].map(([value, label]) => ({ value, label })),
    truncated,
  }
}
