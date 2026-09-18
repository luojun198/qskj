/**
 * 销售订单执行表（生产·委外·进销存联动收口）
 *
 * 逐张已审核销售订单行：订单量 / 已发货 / 未发；现有库存；在产（自制工单：计划 − 完工，委外工单同口径）；
 * 采购在途（已审核采购订单未入库量）；预计可交期（在产工单排程完工 / 计划完工 的最晚日）；交期状态。
 * 供应链路：工单通过 成品行 source_line_id（直推）或 MRP 来源（scm_mrp_source kind=sales_order）挂到订单。
 */
import type Database from 'better-sqlite3'

const r6 = (n: number) => Math.round((Number(n) || 0) * 1e6) / 1e6

export interface SalesExecFilters { keyword?: string; partner_code?: string; status?: 'open' | 'done' | 'all'; start_date?: string; end_date?: string; overdue?: string | boolean; page?: number; page_size?: number }
export interface SalesExecRow {
  doc_id: string; doc_no: string; doc_date: string; expect_date: string | null; partner_code: string | null; partner_name: string | null
  line_id: string; item_code: string; item_name: string; unit: string | null; warehouse_code: string | null
  order_qty: number; shipped_qty: number; open_qty: number
  on_hand: number; wip_qty: number; wip_plans: string[]; outsource_wip_qty: number; po_open_qty: number
  est_ready_date: string | null; overdue: boolean; ready: boolean
}

export function querySalesOrderExecution(db: Database.Database, aid: string, f: SalesExecFilters = {}) {
  const conds = ["d.account_set_id=?", "d.doc_type='SOa'", "d.status='audited'"]; const ps: any[] = [aid]
  if (f.keyword) { const kw = `%${String(f.keyword).trim()}%`; conds.push('(d.doc_no LIKE ? OR p.name LIKE ? OR l.item_code LIKE ? OR i.name LIKE ?)'); ps.push(kw, kw, kw, kw) }
  if (f.partner_code) { conds.push('d.partner_code=?'); ps.push(f.partner_code) }
  if (f.start_date) { conds.push('d.doc_date>=?'); ps.push(f.start_date) }
  if (f.end_date) { conds.push('d.doc_date<=?'); ps.push(f.end_date) }
  const rows = db.prepare(`SELECT d.id doc_id, d.doc_no, d.doc_date, d.expect_date, d.partner_code, p.name partner_name,
      l.id line_id, l.item_code, i.name item_name, i.unit, COALESCE(l.warehouse_code, d.warehouse_code) warehouse_code, l.qty order_qty,
      COALESCE((SELECT SUM(sl.qty) FROM scm_doc_line sl JOIN scm_doc sd ON sd.id=sl.doc_id WHERE sl.source_line_id=l.id AND sd.doc_type='SO' AND sd.status='audited'),0)
        - COALESCE((SELECT SUM(rl.qty) FROM scm_doc_line rl JOIN scm_doc rd ON rd.id=rl.doc_id JOIN scm_doc_line sl2 ON sl2.id=rl.source_line_id
            WHERE sl2.source_line_id=l.id AND rd.doc_type='SR' AND rd.status='audited'),0) shipped_qty
    FROM scm_doc d JOIN scm_doc_line l ON l.doc_id=d.id
    LEFT JOIN scm_partner p ON p.account_set_id=d.account_set_id AND p.code=d.partner_code
    LEFT JOIN scm_item i ON i.account_set_id=d.account_set_id AND i.code=l.item_code
    WHERE ${conds.join(' AND ')} ORDER BY d.doc_date DESC, d.doc_no DESC, l.seq`).all(...ps) as any[]
  const today = new Date(); const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  const stockOf = db.prepare('SELECT COALESCE(SUM(qty),0) q FROM scm_stock WHERE account_set_id=? AND item_code=?')
  // 与订单行相关的工单：直推（成品行 source_line_id=订单行）或经 MRP（scm_mrp_source 指向订单）
  const plansDirect = db.prepare(`SELECT p.id, p.code, p.plan_type, p.status, p.end_date, p.sched_end_date, pp.plan_qty, pp.finished_qty, pp.scrap_qty
    FROM scm_production_plan_product pp JOIN scm_production_plan p ON p.id=pp.plan_id WHERE pp.source_line_id=? AND p.status IN ('released','draft')`)
  const plansViaMrp = db.prepare(`SELECT p.id, p.code, p.plan_type, p.status, p.end_date, p.sched_end_date, pp.plan_qty, pp.finished_qty, pp.scrap_qty
    FROM scm_mrp_source s JOIN scm_doc md ON md.id=s.mrp_doc_id AND md.status IN ('draft','audited')
    JOIN scm_production_plan p ON p.account_set_id=s.account_set_id AND (p.source_doc_id=md.id OR p.source_doc_id IN (SELECT id FROM scm_doc WHERE doc_type='MR' AND source_doc_id=md.id))
    JOIN scm_production_plan_product pp ON pp.plan_id=p.id AND pp.item_code=?
    WHERE s.account_set_id=? AND s.source_kind='sales_order' AND s.source_id=? AND p.status IN ('released','draft')`)
  const poOpen = db.prepare(`SELECT COALESCE(SUM(l.qty - COALESCE((SELECT SUM(pl.qty) FROM scm_doc_line pl JOIN scm_doc pd ON pd.id=pl.doc_id WHERE pl.source_line_id=l.id AND pd.doc_type='PI' AND pd.status='audited'),0)),0) q
    FROM scm_doc_line l JOIN scm_doc d ON d.id=l.doc_id WHERE d.account_set_id=? AND d.doc_type='PO' AND d.status='audited' AND l.item_code=?`)
  const out: SalesExecRow[] = rows.map(r => {
    const orderQty = r6(Number(r.order_qty) || 0), shipped = r6(Number(r.shipped_qty) || 0)
    const openQty = r6(Math.max(0, orderQty - shipped))
    const plans = new Map<string, any>()
    for (const x of plansDirect.all(r.line_id) as any[]) plans.set(x.id, x)
    for (const x of plansViaMrp.all(r.item_code, aid, r.doc_id) as any[]) if (!plans.has(x.id)) plans.set(x.id, x)
    let wip = 0, owip = 0, est: string | null = null
    const codes: string[] = []
    for (const x of plans.values()) {
      const remain = r6(Math.max(0, (Number(x.plan_qty) || 0) - (Number(x.finished_qty) || 0) - (Number(x.scrap_qty) || 0)))
      if (remain <= 0) continue
      if (x.plan_type === 'outsource') owip = r6(owip + remain); else wip = r6(wip + remain)
      codes.push(x.code)
      const d = x.sched_end_date || x.end_date
      if (d && (!est || d > est)) est = d
    }
    const onHand = r6(Number((stockOf.get(aid, r.item_code) as any)?.q) || 0)
    const po = r6(Number((poOpen.get(aid, r.item_code) as any)?.q) || 0)
    return {
      doc_id: r.doc_id, doc_no: r.doc_no, doc_date: r.doc_date, expect_date: r.expect_date, partner_code: r.partner_code, partner_name: r.partner_name,
      line_id: r.line_id, item_code: r.item_code, item_name: r.item_name || '', unit: r.unit, warehouse_code: r.warehouse_code,
      order_qty: orderQty, shipped_qty: shipped, open_qty: openQty, on_hand: onHand, wip_qty: wip, wip_plans: codes, outsource_wip_qty: owip, po_open_qty: po,
      est_ready_date: openQty > 0 ? est : null, overdue: openQty > 0 && !!r.expect_date && r.expect_date < todayStr, ready: openQty > 0 && onHand >= openQty,
    }
  })
  let filtered = out
  const status = f.status || 'open'
  if (status === 'open') filtered = filtered.filter(x => x.open_qty > 0)
  else if (status === 'done') filtered = filtered.filter(x => x.open_qty <= 0)
  if (f.overdue === '1' || f.overdue === true) filtered = filtered.filter(x => x.overdue)
  const page = Math.max(1, Number(f.page) || 1), pageSize = Math.min(500, Math.max(1, Number(f.page_size) || 50))
  const summary = {
    lines: filtered.length, order_qty: r6(filtered.reduce((s, x) => s + x.order_qty, 0)), shipped_qty: r6(filtered.reduce((s, x) => s + x.shipped_qty, 0)),
    open_qty: r6(filtered.reduce((s, x) => s + x.open_qty, 0)), overdue_lines: filtered.filter(x => x.overdue).length, ready_lines: filtered.filter(x => x.ready).length,
  }
  return { rows: filtered.slice((page - 1) * pageSize, page * pageSize), total: filtered.length, page, page_size: pageSize, summary }
}
