/**
 * 采购 / 销售订单变更单（客户反馈：订单没有变更功能，要求能增减数量、对未执行部分改单价，变更单可查询追溯）。
 *
 * 口径：
 *   1. 只对已审核的采购订单（PO）/ 销售订单（SOa）开变更单；同一订单同时只能有一张草稿变更单
 *   2. 新数量 ≥ 已执行（已入库 / 已出库，含草稿下游单占用、扣已审核退货），即 computeSourceLineUsedQty
 *   3. 改单价 / 税率 / 折扣只影响订单本身（未执行部分按新价下推），已生成的下游单据保持原价；全部执行完的行不能再改价
 *   4. 有草稿下游单（入库 / 出库草稿）的行，减少数量或改价前须先审核或删除草稿（主人确认的口径）
 *   5. 删除明细：仅未执行、无草稿下游的行；可新增明细
 *   6. 审核即写回订单明细并重算订单合计，留 before / after / diff 快照
 */
import type Database from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'
import { computeSourceLineUsedQty } from './scmDocumentControls.js'

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100
const r4 = (n: number) => Math.round((Number(n) || 0) * 10000) / 10000
const r6 = (n: number) => Math.round((Number(n) || 0) * 1e6) / 1e6
const EPS = 0.000001

export const ORDER_CHANGE_TYPES: Record<string, { child: string; childName: string; orderName: string; execName: string }> = {
  PO: { child: 'PI', childName: '采购入库单', orderName: '采购订单', execName: '已入库' },
  SOa: { child: 'SO', childName: '销售出库单', orderName: '销售订单', execName: '已出库' },
}

export interface OrderChangeLine {
  id?: string | null
  item_code: string
  item_name?: string
  spec?: string
  unit?: string
  qty: number
  price: number
  tax_rate: number | null
  discount_rate: number | null
  warehouse_code: string | null
  remark: string | null
  /** 快照附带（只读）：已执行数量、草稿下游单号 */
  executed_qty?: number
  draft_docs?: string[]
}
export interface OrderSnapshot { head: { remark: string | null }; lines: OrderChangeLine[] }
export interface OrderDiffItem { kind: 'head' | 'line'; field: string; label: string; item?: string; before: any; after: any }

function draftChildDocs(db: Database.Database, aid: string, childType: string, lineId: string): string[] {
  const nos = new Set<string>()
  for (const r of db.prepare(`SELECT DISTINCT d.doc_no FROM scm_doc_line l JOIN scm_doc d ON d.id=l.doc_id
    WHERE d.account_set_id=? AND d.doc_type=? AND d.status='draft' AND l.source_line_id=?`).all(aid, childType, lineId) as any[]) nos.add(r.doc_no)
  for (const r of db.prepare(`SELECT d.doc_no, l.field_values FROM scm_doc_line l JOIN scm_doc d ON d.id=l.doc_id
    WHERE d.account_set_id=? AND d.doc_type=? AND d.status='draft' AND l.source_line_id IS NULL AND l.field_values LIKE ?`).all(aid, childType, `%${lineId}%`) as any[]) {
    try {
      const fv = JSON.parse(r.field_values || '{}')
      if ((fv?.source_line_allocations || []).some((a: any) => String(a?.source_line_id) === lineId)) nos.add(r.doc_no)
    } catch { /* 忽略坏 JSON */ }
  }
  return [...nos].sort()
}

/** 订单当前快照（含每行已执行数量、草稿下游单） */
export function snapshotOrder(db: Database.Database, aid: string, docId: string): { doc: any; snapshot: OrderSnapshot } {
  const doc = db.prepare('SELECT * FROM scm_doc WHERE id=? AND account_set_id=?').get(docId, aid) as any
  if (!doc) throw new Error('订单不存在')
  const meta = ORDER_CHANGE_TYPES[doc.doc_type]
  if (!meta) throw new Error('仅采购订单、销售订单可做变更')
  const lines = db.prepare(`SELECT l.*, i.name AS item_name, i.spec AS spec, i.unit AS unit FROM scm_doc_line l
    LEFT JOIN scm_item i ON i.account_set_id=l.account_set_id AND i.code=l.item_code
    WHERE l.doc_id=? AND l.account_set_id=? ORDER BY l.seq`).all(docId, aid) as any[]
  return {
    doc,
    snapshot: {
      head: { remark: doc.remark ?? null },
      lines: lines.map(l => ({
        id: l.id, item_code: l.item_code, item_name: l.item_name || '', spec: l.spec || '', unit: l.unit || '',
        qty: r6(Number(l.qty) || 0), price: r6(Number(l.price) || 0),
        tax_rate: l.tax_rate === null || l.tax_rate === undefined || l.tax_rate === '' ? null : Number(l.tax_rate),
        discount_rate: l.discount_rate === null || l.discount_rate === undefined ? null : Number(l.discount_rate) || null,
        warehouse_code: l.warehouse_code ?? null, remark: l.remark ?? null,
        executed_qty: r6(computeSourceLineUsedQty(db, aid, meta.child, l.id)),
        draft_docs: draftChildDocs(db, aid, meta.child, l.id),
      })),
    },
  }
}

/** 请求体归一为目标快照（去掉只读字段，过滤空行） */
export function normalizeOrderTarget(body: any, before: OrderSnapshot): OrderSnapshot {
  const head = { remark: body?.head?.remark !== undefined ? (body.head.remark === '' ? null : body.head.remark) : before.head.remark }
  const lines: OrderChangeLine[] = []
  for (const l of Array.isArray(body?.lines) ? body.lines : []) {
    if (!l || !l.item_code) continue
    lines.push({
      id: l.id || null, item_code: String(l.item_code), item_name: l.item_name || '',
      qty: r6(Number(l.qty) || 0), price: r6(Number(l.price) || 0),
      tax_rate: l.tax_rate === null || l.tax_rate === undefined || l.tax_rate === '' ? null : Number(l.tax_rate),
      discount_rate: Number(l.discount_rate) > 0 ? Number(l.discount_rate) : null,
      warehouse_code: l.warehouse_code || null, remark: l.remark ?? null,
    })
  }
  return { head, lines }
}

const priceChanged = (a: OrderChangeLine, b: OrderChangeLine) =>
  Math.abs((a.price || 0) - (b.price || 0)) > EPS
  || (a.tax_rate ?? null) !== (b.tax_rate ?? null)
  || (a.discount_rate ?? null) !== (b.discount_rate ?? null)

export function validateOrderChange(db: Database.Database, aid: string, doc: any, before: OrderSnapshot, after: OrderSnapshot): string[] {
  const errs: string[] = []
  const meta = ORDER_CHANGE_TYPES[doc.doc_type]
  if (doc.status !== 'audited') errs.push(`${meta?.orderName || '订单'}未审核，请直接修改订单，无需变更单`)
  if (!after.lines.length) errs.push('变更后订单至少要保留一行明细')
  const byId = new Map(before.lines.filter(l => l.id).map(l => [l.id!, l]))
  const seen = new Set<string>()
  const itemExists = db.prepare('SELECT 1 FROM scm_item WHERE account_set_id=? AND code=?')
  for (const a of after.lines) {
    if (!(a.qty > 0)) { errs.push(`物料 ${a.item_code} 数量须大于 0（要去掉整行请删除该行）`); continue }
    if (a.price < 0) errs.push(`物料 ${a.item_code} 单价不能为负数`)
    if (!a.id) {
      if (!itemExists.get(aid, a.item_code)) errs.push(`物料 ${a.item_code} 不存在`)
      continue
    }
    const b = byId.get(a.id)
    if (!b) { errs.push(`明细行已不存在（物料 ${a.item_code}），请刷新后重新变更`); continue }
    seen.add(a.id)
    if (a.item_code !== b.item_code) errs.push(`已有明细不能更换物料（${b.item_code} → ${a.item_code}），请删除后新增`)
    const executed = b.executed_qty || 0
    const drafts = b.draft_docs || []
    if (a.qty + EPS < executed) errs.push(`物料 ${b.item_code} 新数量 ${a.qty} 小于${meta.execName} ${executed}`)
    const qtyDown = a.qty + EPS < b.qty
    const priceDiff = priceChanged(a, b)
    if ((qtyDown || priceDiff) && drafts.length) {
      errs.push(`物料 ${b.item_code} 有未审核的${meta.childName} ${drafts.join('、')}，减少数量或改价前请先审核或删除`)
    }
    if (priceDiff && executed + EPS >= b.qty && a.qty <= b.qty + EPS) {
      errs.push(`物料 ${b.item_code} 已全部${meta.execName.replace('已', '')}，不能再改单价 / 税率 / 折扣`)
    }
  }
  for (const b of before.lines) {
    if (!b.id || seen.has(b.id)) continue
    if ((b.executed_qty || 0) > EPS) errs.push(`物料 ${b.item_code} ${meta.execName} ${b.executed_qty}，不能删除该行`)
    else if ((b.draft_docs || []).length) errs.push(`物料 ${b.item_code} 有未审核的${meta.childName} ${b.draft_docs!.join('、')}，删除前请先处理`)
  }
  return errs
}

export function computeOrderDiff(before: OrderSnapshot, after: OrderSnapshot): OrderDiffItem[] {
  const out: OrderDiffItem[] = []
  if ((before.head.remark ?? '') !== (after.head.remark ?? '')) out.push({ kind: 'head', field: 'remark', label: '订单备注', before: before.head.remark, after: after.head.remark })
  const byId = new Map(before.lines.filter(l => l.id).map(l => [l.id!, l]))
  const seen = new Set<string>()
  for (const a of after.lines) {
    const b = a.id ? byId.get(a.id) : undefined
    if (!b) { out.push({ kind: 'line', field: 'add', label: '新增明细', item: a.item_code, before: null, after: `${a.qty} × ${a.price}` }); continue }
    seen.add(b.id!)
    if (Math.abs(a.qty - b.qty) > EPS) out.push({ kind: 'line', field: 'qty', label: '数量', item: a.item_code, before: b.qty, after: a.qty })
    if (Math.abs(a.price - b.price) > EPS) out.push({ kind: 'line', field: 'price', label: '单价', item: a.item_code, before: b.price, after: a.price })
    if ((a.tax_rate ?? null) !== (b.tax_rate ?? null)) out.push({ kind: 'line', field: 'tax_rate', label: '税率%', item: a.item_code, before: b.tax_rate ?? '取表头', after: a.tax_rate ?? '取表头' })
    if ((a.discount_rate ?? null) !== (b.discount_rate ?? null)) out.push({ kind: 'line', field: 'discount_rate', label: '折扣(折)', item: a.item_code, before: b.discount_rate ?? '-', after: a.discount_rate ?? '-' })
    if ((a.warehouse_code ?? null) !== (b.warehouse_code ?? null)) out.push({ kind: 'line', field: 'warehouse_code', label: '仓库', item: a.item_code, before: b.warehouse_code, after: a.warehouse_code })
    if ((a.remark ?? '') !== (b.remark ?? '')) out.push({ kind: 'line', field: 'remark', label: '备注', item: a.item_code, before: b.remark, after: a.remark })
  }
  for (const b of before.lines) if (b.id && !seen.has(b.id)) out.push({ kind: 'line', field: 'remove', label: '删除明细', item: b.item_code, before: `${b.qty} × ${b.price}`, after: null })
  return out
}

/** 行金额：金额 = 数量 × 单价 × 折率；税额 = 金额 × 税率（行税率为空取表头）；含税单价 = 单价 ×（1+税率） */
function lineAmounts(l: OrderChangeLine, headTax: number) {
  const rate = l.tax_rate === null || l.tax_rate === undefined ? headTax : Number(l.tax_rate) || 0
  const gross = l.qty * l.price
  const factor = (l.discount_rate || 0) > 0 ? (l.discount_rate as number) / 10 : 1
  const amount = r2(gross * factor)
  return { amount, discount_amount: r2(gross - amount), tax_amount: r2(amount * rate / 100), price_with_tax: r4(l.price * (1 + rate / 100)) }
}

/** 审核写回：更新 / 新增 / 删除订单明细，重算订单合计 */
export function applyOrderChange(db: Database.Database, aid: string, doc: any, after: OrderSnapshot): void {
  const headTax = Number(doc.tax_rate) || 0
  const keepIds = new Set(after.lines.filter(l => l.id).map(l => l.id!))
  const existing = db.prepare('SELECT id FROM scm_doc_line WHERE doc_id=? AND account_set_id=?').all(doc.id, aid) as any[]
  for (const e of existing) if (!keepIds.has(e.id)) db.prepare('DELETE FROM scm_doc_line WHERE id=? AND account_set_id=?').run(e.id, aid)
  const upd = db.prepare(`UPDATE scm_doc_line SET qty=?, price=?, amount=?, discount_rate=?, discount_amount=?, tax_rate=?, tax_amount=?, price_with_tax=?,
    warehouse_code=?, remark=?, seq=? WHERE id=? AND account_set_id=?`)
  const ins = db.prepare(`INSERT INTO scm_doc_line (id,account_set_id,doc_id,seq,item_code,warehouse_code,qty,price,amount,discount_rate,discount_amount,tax_rate,tax_amount,price_with_tax,remark,field_values)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'{}')`)
  let seq = 0
  let totalQty = 0, totalAmount = 0, totalTax = 0
  for (const l of after.lines) {
    seq++
    const a = lineAmounts(l, headTax)
    totalQty += l.qty; totalAmount += a.amount; totalTax += a.tax_amount
    if (l.id) upd.run(l.qty, l.price, a.amount, l.discount_rate, a.discount_amount, l.tax_rate, a.tax_amount, a.price_with_tax, l.warehouse_code, l.remark, seq, l.id, aid)
    else ins.run(uuidv4(), aid, doc.id, seq, l.item_code, l.warehouse_code, l.qty, l.price, a.amount, l.discount_rate, a.discount_amount, l.tax_rate, a.tax_amount, a.price_with_tax, l.remark)
  }
  db.prepare("UPDATE scm_doc SET total_qty=?, total_amount=?, total_tax=?, remark=?, updated_at=datetime('now') WHERE id=? AND account_set_id=?")
    .run(r6(totalQty), r2(totalAmount), r2(totalTax), after.head.remark, doc.id, aid)
}
