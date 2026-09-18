/**
 * 在制品盘点（生产评审 C-5）
 *
 *  账面在制数（每料）= 工单净领用（PL/PB/WO 出 − PJ 入，已审核）− Σ各成品 (已完工 + 已报废) × 单件用量 × (1+损耗) − 已审核盘亏
 *  盘点行 diff = 实盘 − 账面：
 *    diff > 0（现场比账面多）→ 审核时生成退料单(PJ)草稿把多出的料退回原料仓，审核退料后账面自然对齐
 *    diff < 0（现场比账面少）→ 记为在制损耗：领料建议把损耗当作「未领」补领；损耗的料成本留在工单在制，随末批完工 / 结案吸收
 */
import type Database from 'better-sqlite3'

const r6 = (n: number) => Math.round((Number(n) || 0) * 1e6) / 1e6
const EPS = 1e-6

const tableCache = new WeakMap<Database.Database, boolean>()
export function hasWipCountTable(db: Database.Database): boolean {
  let v = tableCache.get(db)
  if (v === undefined) {
    v = !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='scm_plan_wip_count'").get()
    tableCache.set(db, v)
  }
  return v
}

/** 已审核盘点的在制损耗（每料，正数），供领料建议补领 */
export function planWipLossByItem(db: Database.Database, aid: string, planId: string): Map<string, number> {
  if (!hasWipCountTable(db)) return new Map()
  const rows = db.prepare(`SELECT l.item_code, COALESCE(SUM(-l.diff_qty),0) loss FROM scm_plan_wip_count_line l
    JOIN scm_plan_wip_count c ON c.id=l.count_id WHERE c.account_set_id=? AND c.plan_id=? AND c.status='audited' AND l.diff_qty<0 GROUP BY l.item_code`).all(aid, planId) as any[]
  return new Map(rows.map(r => [String(r.item_code), r6(Number(r.loss) || 0)]))
}

export interface WipBookRow { item_code: string; item_name: string; unit: string | null; issued_qty: number; consumed_qty: number; loss_qty: number; book_qty: number; warehouse_code: string | null }

/** 账面在制数（每料） */
export function planWipBook(db: Database.Database, aid: string, planId: string): WipBookRow[] {
  const plan = db.prepare('SELECT yl_warehouse FROM scm_production_plan WHERE id=? AND account_set_id=?').get(planId, aid) as any
  const issued = db.prepare(`SELECT m.item_code, COALESCE(SUM(CASE WHEN m.direction='out' THEN m.qty ELSE -m.qty END),0) q
    FROM scm_stock_move m JOIN scm_doc d ON d.account_set_id=m.account_set_id AND d.doc_type=m.doc_type AND d.doc_no=m.doc_no
    WHERE d.account_set_id=? AND d.plan_id=? AND d.status='audited' AND d.doc_type IN ('PL','PB','WO','PJ') GROUP BY m.item_code`).all(aid, planId) as any[]
  const consumed = db.prepare(`SELECT l.item_code, MIN(l.warehouse_code) wh,
      COALESCE(SUM(l.qty*(1+COALESCE(l.scrap_rate,0)/100.0)*(COALESCE(pp.finished_qty,0)+COALESCE(pp.scrap_qty,0))),0) q
    FROM scm_production_plan_line l JOIN scm_production_plan_product pp ON pp.id=l.product_id
    WHERE l.account_set_id=? AND l.plan_id=? GROUP BY l.item_code`).all(aid, planId) as any[]
  const loss = planWipLossByItem(db, aid, planId)
  const codes = new Set<string>([...issued.map(r => String(r.item_code)), ...consumed.map(r => String(r.item_code))])
  const items = new Map<string, any>((db.prepare('SELECT code, name, unit FROM scm_item WHERE account_set_id=?').all(aid) as any[]).map(i => [String(i.code), i]))
  const cMap = new Map(consumed.map(r => [String(r.item_code), r]))
  const out: WipBookRow[] = []
  for (const code of codes) {
    const iq = r6(Number(issued.find(r => r.item_code === code)?.q) || 0)
    const cq = r6(Number(cMap.get(code)?.q) || 0)
    const lq = loss.get(code) || 0
    const book = r6(iq - cq - lq)
    if (Math.abs(iq) < EPS && Math.abs(cq) < EPS) continue
    out.push({ item_code: code, item_name: items.get(code)?.name || '', unit: items.get(code)?.unit || null, issued_qty: iq, consumed_qty: cq, loss_qty: lq, book_qty: book, warehouse_code: cMap.get(code)?.wh || plan?.yl_warehouse || null })
  }
  return out.sort((a, b) => a.item_code.localeCompare(b.item_code))
}
