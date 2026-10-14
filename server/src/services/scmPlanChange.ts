/**
 * 工单变更单（生产评审 C-1）
 *
 * 已审核工单不能直接编辑；追加 / 减少计划数、改交期 / 优先级 / 仓库、增删换用料一律走变更单：
 *   1. 建单时对「变更后目标」做与审核同样的校验（只是预检），存 before / after / diff 快照
 *   2. 审核时重新校验并写回工单：成品行按 id 原地更新（报工 / 完工引用 product_id），新成品插入，
 *      删除的成品要求无完工 / 报废 / 报工；用料行整体重写；头字段更新；legacy 头列同步
 * 约束（决策 4：不允许减到低于已领，先退料）：
 *   - 成品新计划数 ≥ 已完工 + 已报废；有报工的成品不可删除
 *   - 每料新需求 Σ(用量×(1+损耗)×计划数) ≥ 已净领用量（替代料并入主料）
 */
import type Database from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'
import { bomComponents } from './scmBom.js'

const r6 = (n: number) => Math.round((Number(n) || 0) * 1e6) / 1e6
const EPS = 1e-6

export interface ChangeLine { item_code: string; qty: number; unit?: string | null; scrap_rate?: number; remark?: string | null; warehouse_code?: string | null }
export interface ChangeProduct {
  id?: string | null; item_code: string; plan_qty: number; bom_id?: string | null; fp_warehouse?: string | null; remark?: string | null
  process_fee?: number; process_tax_rate?: number; lines: ChangeLine[]
  /** 快照附带：已完工 / 已报废（只读） */
  finished_qty?: number; scrap_qty?: number; item_name?: string
}
export interface ChangeHead { start_date?: string | null; end_date?: string | null; priority?: number; yl_warehouse?: string | null; fp_warehouse?: string | null; dept_code?: string | null; remark?: string | null }
export interface PlanSnapshot { head: ChangeHead; products: ChangeProduct[] }
export interface DiffItem { kind: 'head' | 'product' | 'line'; field: string; label: string; product?: string; item?: string; before: any; after: any }

const HEAD_FIELDS: Array<[keyof ChangeHead, string]> = [
  ['start_date', '开工日期'], ['end_date', '完工日期'], ['priority', '优先级'], ['yl_warehouse', '原料仓'], ['fp_warehouse', '成品仓'], ['dept_code', '部门'], ['remark', '备注'],
]

export function snapshotPlan(db: Database.Database, aid: string, planId: string): PlanSnapshot {
  const p = db.prepare('SELECT * FROM scm_production_plan WHERE id=? AND account_set_id=?').get(planId, aid) as any
  if (!p) throw new Error('工单不存在')
  const products = db.prepare(`SELECT pp.*, i.name AS item_name FROM scm_production_plan_product pp
    LEFT JOIN scm_item i ON i.account_set_id=pp.account_set_id AND i.code=pp.item_code
    WHERE pp.plan_id=? AND pp.account_set_id=? ORDER BY pp.seq`).all(planId, aid) as any[]
  const lines = db.prepare('SELECT * FROM scm_production_plan_line WHERE product_id=? ORDER BY seq')
  return {
    head: { start_date: p.start_date ?? null, end_date: p.end_date ?? null, priority: Number(p.priority) || 0, yl_warehouse: p.yl_warehouse ?? null, fp_warehouse: p.fp_warehouse ?? null, dept_code: p.dept_code ?? null, remark: p.remark ?? null },
    products: products.map(pp => ({
      id: pp.id, item_code: pp.item_code, item_name: pp.item_name || '', plan_qty: Number(pp.plan_qty) || 0, bom_id: pp.bom_id ?? null, fp_warehouse: pp.fp_warehouse ?? null, remark: pp.remark ?? null,
      process_fee: Number(pp.process_fee) || 0, process_tax_rate: Number(pp.process_tax_rate) || 0,
      finished_qty: Number(pp.finished_qty) || 0, scrap_qty: Number(pp.scrap_qty) || 0,
      lines: (lines.all(pp.id) as any[]).map(l => ({ item_code: l.item_code, qty: Number(l.qty) || 0, unit: l.unit ?? null, scrap_rate: Number(l.scrap_rate) || 0, remark: l.remark ?? null, warehouse_code: l.warehouse_code ?? null })),
    })),
  }
}

/** 请求体归一：products 必填；成品无行但有 bom_id 时按 BOM 展开（与下达快照同口径） */
export function normalizeTarget(db: Database.Database, body: any, before: PlanSnapshot): PlanSnapshot {
  const head: ChangeHead = { ...before.head }
  const h = body?.head || {}
  for (const [k] of HEAD_FIELDS) if (h[k] !== undefined) (head as any)[k] = k === 'priority' ? (Number(h[k]) || 0) : (h[k] === '' ? null : h[k])
  const products: ChangeProduct[] = []
  for (const p of (Array.isArray(body?.products) ? body.products : [])) {
    if (!p || !p.item_code || !(Number(p.plan_qty) > 0)) continue
    let lines: ChangeLine[] = (Array.isArray(p.lines) ? p.lines : []).filter((l: any) => l && l.item_code && Number(l.qty) > 0)
      .map((l: any) => ({ item_code: String(l.item_code), qty: r6(Number(l.qty)), unit: l.unit ?? null, scrap_rate: Number(l.scrap_rate) || 0, remark: l.remark ?? null, warehouse_code: l.warehouse_code || null }))
    if (!lines.length && p.bom_id) {
      lines = bomComponents(db, String(p.bom_id)).map(c => ({ item_code: c.item_code, qty: r6(Number(c.qty) || 0), unit: c.unit ?? null, scrap_rate: Number(c.scrap_rate) || 0, remark: c.remark ?? null, warehouse_code: null }))
    }
    // 加工单价 / 税率：请求未带时沿用变更前成品行（FIX-398：原来一律置 0，审核任何变更都会清空委外加工单价）
    const prev = p.id ? before.products.find(x => x.id === p.id) : undefined
    const fee = p.process_fee === undefined || p.process_fee === null || p.process_fee === '' ? (prev?.process_fee ?? 0) : Number(p.process_fee) || 0
    const taxRate = p.process_tax_rate === undefined || p.process_tax_rate === null || p.process_tax_rate === '' ? (prev?.process_tax_rate ?? 0) : Number(p.process_tax_rate) || 0
    products.push({ id: p.id || null, item_code: String(p.item_code), plan_qty: r6(Number(p.plan_qty)), bom_id: p.bom_id || null, fp_warehouse: p.fp_warehouse || null, remark: p.remark ?? null,
      process_fee: fee, process_tax_rate: taxRate, lines })
  }
  return { head, products }
}

export function computeDiff(before: PlanSnapshot, after: PlanSnapshot): DiffItem[] {
  const out: DiffItem[] = []
  for (const [k, label] of HEAD_FIELDS) {
    const b = before.head[k] ?? null, a = after.head[k] ?? null
    if (String(b ?? '') !== String(a ?? '')) out.push({ kind: 'head', field: k, label, before: b, after: a })
  }
  const byId = new Map(before.products.filter(p => p.id).map(p => [p.id!, p]))
  const seenIds = new Set<string>()
  for (const a of after.products) {
    const b = a.id ? byId.get(a.id) : undefined
    if (!b) { out.push({ kind: 'product', field: 'add', label: '新增成品', product: a.item_code, before: null, after: a.plan_qty }); for (const l of a.lines) out.push({ kind: 'line', field: 'add', label: '新增用料', product: a.item_code, item: l.item_code, before: null, after: l.qty }); continue }
    seenIds.add(a.id!)
    if (r6(b.plan_qty) !== r6(a.plan_qty)) out.push({ kind: 'product', field: 'plan_qty', label: '计划数', product: a.item_code, before: b.plan_qty, after: a.plan_qty })
    if ((b.fp_warehouse ?? null) !== (a.fp_warehouse ?? null)) out.push({ kind: 'product', field: 'fp_warehouse', label: '成品仓', product: a.item_code, before: b.fp_warehouse, after: a.fp_warehouse })
    if ((Number(b.process_fee) || 0) !== (Number(a.process_fee) || 0)) out.push({ kind: 'product', field: 'process_fee', label: '加工单价', product: a.item_code, before: Number(b.process_fee) || 0, after: Number(a.process_fee) || 0 })
    if ((Number(b.process_tax_rate) || 0) !== (Number(a.process_tax_rate) || 0)) out.push({ kind: 'product', field: 'process_tax_rate', label: '加工税率%', product: a.item_code, before: Number(b.process_tax_rate) || 0, after: Number(a.process_tax_rate) || 0 })
    if ((b.bom_id ?? null) !== (a.bom_id ?? null)) out.push({ kind: 'product', field: 'bom_id', label: 'BOM', product: a.item_code, before: b.bom_id, after: a.bom_id })
    const bl = new Map(b.lines.map(l => [l.item_code, l])), al = new Map(a.lines.map(l => [l.item_code, l]))
    for (const [code, l] of al) {
      const o = bl.get(code)
      if (!o) out.push({ kind: 'line', field: 'add', label: '新增用料', product: a.item_code, item: code, before: null, after: l.qty })
      else if (r6(o.qty) !== r6(l.qty) || (Number(o.scrap_rate) || 0) !== (Number(l.scrap_rate) || 0)) out.push({ kind: 'line', field: 'qty', label: '单位用量', product: a.item_code, item: code, before: `${o.qty}${o.scrap_rate ? ` (+${o.scrap_rate}%)` : ''}`, after: `${l.qty}${l.scrap_rate ? ` (+${l.scrap_rate}%)` : ''}` })
    }
    for (const code of bl.keys()) if (!al.has(code)) out.push({ kind: 'line', field: 'remove', label: '删除用料', product: a.item_code, item: code, before: bl.get(code)!.qty, after: null })
  }
  for (const b of before.products) if (b.id && !seenIds.has(b.id)) out.push({ kind: 'product', field: 'remove', label: '删除成品', product: b.item_code, before: b.plan_qty, after: null })
  return out
}

/** 工单每料已净领用量（PL/PB/WO 出 − PJ 入，已审核库存移动），替代料并入主料由调用方处理 */
function issuedByItem(db: Database.Database, aid: string, planId: string): Map<string, number> {
  const rows = db.prepare(`SELECT m.item_code, COALESCE(SUM(CASE WHEN m.direction='out' THEN m.qty ELSE -m.qty END),0) q
    FROM scm_stock_move m JOIN scm_doc d ON d.account_set_id=m.account_set_id AND d.doc_type=m.doc_type AND d.doc_no=m.doc_no
    WHERE d.account_set_id=? AND d.plan_id=? AND d.status='audited' AND d.doc_type IN ('PL','PB','WO','PJ') GROUP BY m.item_code`).all(aid, planId) as any[]
  return new Map(rows.map(r => [String(r.item_code), r6(Number(r.q) || 0)]))
}

/** 校验变更目标；返回错误列表（空 = 通过） */
export function validateChange(db: Database.Database, aid: string, plan: any, before: PlanSnapshot, after: PlanSnapshot): string[] {
  const errs: string[] = []
  if (plan.status !== 'released') errs.push('仅已审核工单可做变更（草稿请直接编辑，已关闭请先重开）')
  if (!after.products.length) errs.push('变更后至少保留一个成品')
  if (after.head.start_date && after.head.end_date && String(after.head.start_date) > String(after.head.end_date)) errs.push('开工日期不能晚于完工日期')
  const seen = new Set<string>()
  for (const p of after.products) {
    if (seen.has(p.item_code)) errs.push(`成品「${p.item_code}」重复`)
    seen.add(p.item_code)
    if (!p.bom_id && !p.lines.length) errs.push(`成品 ${p.item_code} 缺用料明细（或指定 BOM）`)
  }
  const byId = new Map(before.products.filter(p => p.id).map(p => [p.id!, p]))
  const afterIds = new Set(after.products.map(p => p.id).filter(Boolean) as string[])
  for (const a of after.products) {
    const b = a.id ? byId.get(a.id) : undefined
    if (!b) continue
    if (b.item_code !== a.item_code) errs.push(`成品行「${b.item_code}」不能改成其他物料（请删除后新增）`)
    const done = r6((b.finished_qty || 0) + (b.scrap_qty || 0))
    if (a.plan_qty + EPS < done) errs.push(`成品 ${a.item_code} 新计划数 ${a.plan_qty} 低于已完工+已报废 ${done}`)
  }
  const reported = new Map<string, number>((db.prepare('SELECT product_id, COUNT(*) c FROM scm_work_report WHERE account_set_id=? AND plan_id=? GROUP BY product_id').all(aid, plan.id) as any[]).map(r => [String(r.product_id || ''), Number(r.c) || 0]))
  for (const b of before.products) {
    if (!b.id || afterIds.has(b.id)) continue
    if ((b.finished_qty || 0) > EPS || (b.scrap_qty || 0) > EPS) errs.push(`成品 ${b.item_code} 已有完工/报废，不能删除`)
    else if ((reported.get(b.id) || 0) > 0) errs.push(`成品 ${b.item_code} 已有报工，不能删除`)
  }
  // 用料需求不得低于已领（决策 4：先退料）
  const need = new Map<string, number>()
  for (const p of after.products) for (const l of p.lines) need.set(l.item_code, r6((need.get(l.item_code) || 0) + l.qty * (1 + (Number(l.scrap_rate) || 0) / 100) * p.plan_qty))
  const issued = issuedByItem(db, aid, plan.id)
  // 替代料：领了替代料算主料的需求（按变更前 BOM 的替代组映射）
  const subToPrimary = new Map<string, string>()
  for (const p of [...before.products, ...after.products]) if (p.bom_id) for (const c of bomComponents(db, String(p.bom_id))) for (const s of c.substitutes) if (!subToPrimary.has(s.item_code)) subToPrimary.set(s.item_code, c.item_code)
  const issuedPrimary = new Map<string, number>()
  for (const [code, q] of issued) { const k = subToPrimary.get(code) || code; issuedPrimary.set(k, r6((issuedPrimary.get(k) || 0) + q)) }
  for (const [code, q] of issuedPrimary) {
    if (q <= EPS) continue
    const n = need.get(code) || 0
    if (n + EPS < q) errs.push(`物料 ${code} 变更后需求 ${n} 低于已领用 ${q}，请先退料`)
  }
  return errs
}

/** 审核生效：写回工单（成品按 id 原地更新，用料整体重写，头字段更新） */
export function applyChange(db: Database.Database, aid: string, plan: any, after: PlanSnapshot): void {
  const upHead = db.prepare(`UPDATE scm_production_plan SET start_date=?, end_date=?, priority=?, yl_warehouse=?, fp_warehouse=?, dept_code=?, remark=?, item_code=?, plan_qty=?, bom_id=? WHERE id=? AND account_set_id=?`)
  const upProd = db.prepare('UPDATE scm_production_plan_product SET seq=?, plan_qty=?, bom_id=?, fp_warehouse=?, remark=?, process_fee=?, process_tax_rate=? WHERE id=? AND plan_id=?')
  const insProd = db.prepare(`INSERT INTO scm_production_plan_product (id,account_set_id,plan_id,seq,item_code,plan_qty,bom_id,fp_warehouse,finished_qty,scrap_qty,remark,process_fee,process_tax_rate) VALUES (?,?,?,?,?,?,?,?,0,0,?,?,?)`)
  const delLines = db.prepare('DELETE FROM scm_production_plan_line WHERE product_id=?')
  const insLine = db.prepare('INSERT INTO scm_production_plan_line (id,account_set_id,plan_id,product_id,seq,item_code,qty,unit,scrap_rate,remark,warehouse_code) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
  const existing = new Set((db.prepare('SELECT id FROM scm_production_plan_product WHERE plan_id=?').all(plan.id) as any[]).map(r => String(r.id)))
  const keep = new Set<string>()
  let seq = 0
  for (const p of after.products) {
    seq++
    let pid = p.id && existing.has(p.id) ? p.id : null
    if (pid) upProd.run(seq, p.plan_qty, p.bom_id ?? null, p.fp_warehouse ?? null, p.remark ?? null, p.process_fee || 0, p.process_tax_rate || 0, pid, plan.id)
    else { pid = uuidv4(); insProd.run(pid, aid, plan.id, seq, p.item_code, p.plan_qty, p.bom_id ?? null, p.fp_warehouse ?? null, p.remark ?? null, p.process_fee || 0, p.process_tax_rate || 0) }
    keep.add(pid)
    p.id = pid   // 新成品回填 id，审核后 after 快照与工单一一对应
    delLines.run(pid)
    let ls = 0
    for (const l of p.lines) { ls++; insLine.run(uuidv4(), aid, plan.id, pid, ls, l.item_code, l.qty, l.unit ?? null, Number(l.scrap_rate) || 0, l.remark ?? null, l.warehouse_code ?? null) }
  }
  for (const id of existing) if (!keep.has(id)) { delLines.run(id); db.prepare('DELETE FROM scm_production_plan_product WHERE id=?').run(id) }
  const head = after.products[0]
  const total = after.products.reduce((s, p) => s + p.plan_qty, 0)
  upHead.run(after.head.start_date ?? null, after.head.end_date ?? null, Number(after.head.priority) || 0, after.head.yl_warehouse ?? null, after.head.fp_warehouse ?? head.fp_warehouse ?? null,
    after.head.dept_code ?? null, after.head.remark ?? null, head.item_code, r6(total), head.bom_id ?? null, plan.id, aid)
}

export interface MaterialIncrease { item_code: string; before_need: number; after_need: number; increase: number }

/**
 * 变更前后每料计划总需求差（总需 = Σ 成品计划数 × 单位用量 ×（1+损耗率））。
 * 客户反馈：工单变更加大用量后，要据此追加采购，不用手工抄明细——只取增加部分（increase > 0）。
 */
export function computeMaterialIncrease(before: PlanSnapshot, after: PlanSnapshot): MaterialIncrease[] {
  const needOf = (snap: PlanSnapshot) => {
    const m = new Map<string, number>()
    for (const p of snap.products || []) {
      for (const l of p.lines || []) {
        const q = (Number(p.plan_qty) || 0) * (Number(l.qty) || 0) * (1 + (Number(l.scrap_rate) || 0) / 100)
        m.set(l.item_code, r6((m.get(l.item_code) || 0) + q))
      }
    }
    return m
  }
  const b = needOf(before), a = needOf(after)
  const out: MaterialIncrease[] = []
  for (const [code, afterNeed] of a) {
    const beforeNeed = b.get(code) || 0
    const inc = r6(afterNeed - beforeNeed)
    if (inc > 0.000001) out.push({ item_code: code, before_need: r6(beforeNeed), after_need: afterNeed, increase: inc })
  }
  return out
}

/**
 * 追加物料建议量（客户测试 20261011）：库存先扣其他单据占用、再扣本计划变更前尚未发完的用量（已被占着），
 * 剩余可用库存才抵减本次增量。
 *   open_need = max(0, 变更前总需 − 已净发料)
 *   free      = max(0, 库存 − 其他占用 − open_need)
 *   suggest   = max(0, 增量 − free)
 */
export function suggestIncreaseQty(p: { increase: number; before_need: number; issued: number; stock: number; other_reserved: number }) {
  const openNeed = r6(Math.max(0, (Number(p.before_need) || 0) - (Number(p.issued) || 0)))
  const free = r6(Math.max(0, (Number(p.stock) || 0) - (Number(p.other_reserved) || 0) - openNeed))
  const suggest = r6(Math.max(0, (Number(p.increase) || 0) - free))
  return { open_need: openNeed, free_stock: free, suggest_qty: suggest }
}
