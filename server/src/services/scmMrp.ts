/**
 * MRP 净需求运算（Material Requirements Planning）
 *
 * 口径（轻量 MRP，逐级净额）：
 *  - 独立需求：未发货销售订单(SOa 已审核未下推完) + 安全库存补货（低于安全库存的差额，在净额里体现）。
 *  - 供给：现有库存(scm_stock) + 在途（采购订单 PO 未入库 + 已下达工单未完工产出）。
 *  - 逐级净算：按 BOM 层级自「成品→半成品→原料」处理，父项净需求先扣其现有库存/在途，
 *    再把「净需求」按 BOM 用量(含损耗，仅主件)展开为子件毛需求；子件汇总所有父项后再各自净算。
 *  - 净需求 = max(0, 毛需求 + 安全库存 − 现有 − 在途)；>0 时按物料 source_type 给采购/自制/委外建议。
 *
 * 简化：不做时间栅栏/批量规则（min_order_qty 仅作建议下限提示）、单账套一次全量运算。
 */
import type Database from 'better-sqlite3'

const r4 = (n: number) => Math.round((Number(n) || 0) * 10000) / 10000

export interface MrpRow {
  item_code: string
  item_name: string
  source_type: string
  gross_req: number
  on_hand: number
  in_transit: number
  safety_stock: number
  net_req: number
  min_order_qty: number
  lead_time_days: number
  suggest_qty: number        // 建议下单量 = max(net_req, 净需求>0 时的 min_order_qty)
  suggest_action: string     // 采购 / 自制 / 委外
  level: number
}

export function runMrp(db: Database.Database, accountSetId: string): MrpRow[] {
  const aid = accountSetId
  // 物料档案：来源/安全库存/提前期/最小订货量
  const items = new Map<string, any>()
  for (const it of db.prepare('SELECT code, name, source_type, safety_stock, lead_time_days, min_order_qty FROM scm_item WHERE account_set_id=?').all(aid) as any[]) {
    items.set(it.code, it)
  }
  // 现有库存（跨仓合计）
  const onHand = new Map<string, number>()
  for (const s of db.prepare('SELECT item_code, COALESCE(SUM(qty),0) q FROM scm_stock WHERE account_set_id=? GROUP BY item_code').all(aid) as any[]) {
    onHand.set(s.item_code, Number(s.q) || 0)
  }
  // 在途（一）采购订单 PO 未入库 = Σ(行数量 − 已下推入库量)
  const inTransit = new Map<string, number>()
  const addIn = (code: string, q: number) => inTransit.set(code, r4((inTransit.get(code) || 0) + q))
  for (const r of db.prepare(`
    SELECT l.item_code AS item_code, l.qty AS qty,
      (SELECT COALESCE(SUM(c.qty),0) FROM scm_doc_line c WHERE c.source_line_id=l.id) AS pushed
    FROM scm_doc_line l JOIN scm_doc d ON d.id=l.doc_id
    WHERE d.account_set_id=? AND d.doc_type='PO' AND d.status='audited'
  `).all(aid) as any[]) {
    const remain = Math.max(0, (Number(r.qty) || 0) - (Number(r.pushed) || 0))
    if (remain > 0) addIn(r.item_code, remain)
  }
  // 在途（二）已下达工单未完工产出（自制/委外成品）
  for (const r of db.prepare(`
    SELECT pp.item_code AS item_code, COALESCE(SUM(MAX(0, pp.plan_qty - pp.finished_qty)),0) AS q
    FROM scm_production_plan_product pp JOIN scm_production_plan p ON p.id=pp.plan_id
    WHERE p.account_set_id=? AND p.status='released' GROUP BY pp.item_code
  `).all(aid) as any[]) {
    if ((Number(r.q) || 0) > 0) addIn(r.item_code, Number(r.q) || 0)
  }
  // BOM（每成品取「启用(active) 的默认/首个」BOM 的主件行，含每件用量×(1+损耗)）。
  // 选版规则与缺料单多级下推/领料建议一致：status='active'，优先 is_default 再按 code。
  const bom = new Map<string, Array<{ code: string; per: number }>>()
  const bomRows = db.prepare(`
    SELECT b.item_code AS parent, l.item_code AS comp, l.qty AS qty, COALESCE(l.scrap_rate,0) AS scrap
    FROM scm_bom b JOIN scm_bom_line l ON l.bom_id=b.id
    WHERE b.account_set_id=? AND b.status='active' AND l.line_type='component'
      AND b.id=(SELECT id FROM scm_bom b2 WHERE b2.account_set_id=b.account_set_id AND b2.item_code=b.item_code AND b2.status='active'
                ORDER BY b2.is_default DESC, b2.code LIMIT 1)
  `).all(aid) as any[]
  for (const r of bomRows) {
    const arr = bom.get(r.parent) || []
    arr.push({ code: r.comp, per: (Number(r.qty) || 0) * (1 + (Number(r.scrap) || 0) / 100) })
    bom.set(r.parent, arr)
  }
  // BOM 层级（叶子=0；父=1+max(子)），带环保护，供自顶向下处理
  const levelCache = new Map<string, number>()
  const levelOf = (code: string, stack: Set<string>): number => {
    if (levelCache.has(code)) return levelCache.get(code)!
    if (stack.has(code)) return 0 // 环：截断
    const comps = bom.get(code)
    if (!comps || !comps.length) { levelCache.set(code, 0); return 0 }
    stack.add(code)
    let mx = 0
    for (const c of comps) mx = Math.max(mx, levelOf(c.code, stack))
    stack.delete(code)
    const lv = mx + 1
    levelCache.set(code, lv)
    return lv
  }

  // 毛需求累加器（含独立 + 逐级展开的相关需求）
  const gross = new Map<string, number>()
  const addGross = (code: string, q: number) => gross.set(code, r4((gross.get(code) || 0) + q))
  // 独立需求：未发货销售订单（SOa 已审核，行数量 − 已下推量）。
  // 已下推 = 下游单据行(source_line_id) + 直接下推的工单成品行(plan_product.source_line_id)，与 computePushedQty 口径一致。
  for (const r of db.prepare(`
    SELECT l.item_code AS item_code, l.qty AS qty,
      ((SELECT COALESCE(SUM(c.qty),0) FROM scm_doc_line c WHERE c.source_line_id=l.id)
       + (SELECT COALESCE(SUM(pp.plan_qty),0) FROM scm_production_plan_product pp WHERE pp.source_line_id=l.id)) AS pushed
    FROM scm_doc_line l JOIN scm_doc d ON d.id=l.doc_id
    WHERE d.account_set_id=? AND d.doc_type='SOa' AND d.status='audited'
  `).all(aid) as any[]) {
    const remain = Math.max(0, (Number(r.qty) || 0) - (Number(r.pushed) || 0))
    if (remain > 0) addGross(r.item_code, remain)
  }

  // 参与运算的物料 = 有毛需求 ∪ 有 BOM(父) ∪ 所有 BOM 子件(会被展开累加需求) ∪ 有安全库存(需补货)
  const candidates = new Set<string>([...gross.keys(), ...bom.keys()])
  for (const comps of bom.values()) for (const c of comps) candidates.add(c.code)
  for (const [code, it] of items) if ((Number(it.safety_stock) || 0) > 0) candidates.add(code)
  // 按层级降序处理（父先于子），保证子件在被展开累加后才净算
  const ordered = [...candidates].sort((a, b) => levelOf(b, new Set()) - levelOf(a, new Set()))

  const rows: MrpRow[] = []
  for (const code of ordered) {
    const it = items.get(code) || {}
    const g = r4(gross.get(code) || 0)
    const oh = r4(onHand.get(code) || 0)
    const it_ = r4(inTransit.get(code) || 0)
    const safety = Number(it.safety_stock) || 0
    const net = r4(Math.max(0, g + safety - oh - it_))
    // 净需求>0 → 展开到子件（按净需求，父库存/在途已在净额中扣减）
    if (net > 0) {
      const comps = bom.get(code)
      if (comps) for (const c of comps) addGross(c.code, r4(net * c.per))
    }
    // 有净需求，或需补到安全库存的，才产出一条建议
    if (net > 0.0001) {
      const src = it.source_type || 'purchase'
      const moq = Number(it.min_order_qty) || 0
      const suggestQty = r4(Math.max(net, moq))
      rows.push({
        item_code: code, item_name: it.name || '', source_type: src,
        gross_req: g, on_hand: oh, in_transit: it_, safety_stock: safety, net_req: net,
        min_order_qty: moq, lead_time_days: Number(it.lead_time_days) || 0,
        suggest_qty: suggestQty,
        suggest_action: src === 'outsource' ? '委外' : (src === 'self' || src === 'assembly') ? '自制' : '采购',
        level: levelOf(code, new Set()),
      })
    }
  }
  // 输出按层级降序（成品→原料），同层按编码
  rows.sort((a, b) => (b.level - a.level) || a.item_code.localeCompare(b.item_code))
  return rows
}
