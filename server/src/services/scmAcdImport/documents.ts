/**
 * 进销存 ACD 导入：订单（ht1/ht2）、出入库单（pjnr1/pjnr2）、盘点（pdk + PY/PK）
 *
 * 口径（主人 2026-10-14 确认）：
 *  - 全部按「已审核」导入，并标记 external_voucher=1（原系统已制证，本系统不再生成凭证）；
 *  - 出入库成本沿用润衡明细的 dwcb：入库按 dwcb（无则不含税单价）入账，出库按 dwcb 强制出库；
 *    调拨 dwcb 为空时按调出仓当前均价；
 *  - 润衡「3 成品入库」导为其他入库（收发类别：成品入库）；
 *  - 导入期间一律允许负库存（润衡本身允许），结束后在核对报告列出。
 * 不走 auditDocHandler：其中的开账日期 / 辅助核算 / 信用额度 / 质检等校验面向手工录单，导入历史数据会被误拦；
 * 这里直接用同一组底层函数（applyMovingAvgIn/Out、往来挂账）落库，反审核 / 追溯仍按标准流水工作。
 */
import type Database from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'
import { applyMovingAvgIn, applyMovingAvgOut, currentUnitCost } from '../scmCosting.js'
import { applyPayableFromReceipt, applyReceivableFromShipment, applyReturnAdjustment } from '../scmArAp.js'
import { getScmBaseCurrency } from '../scmCurrency.js'
import { type AcdRecord, type AcdTableSet, acdNum, acdStr, parseAcdDate } from './acdTables.js'
import { type ImportContext, pushIssue } from './types.js'

/** 润衡单据类别 pjlb → 本系统单据类型 + 收发类别 */
export const ACD_DOC_TYPE_MAP: Record<string, { type: string; ioCategory?: string; label: string }> = {
  '1': { type: 'IS', label: '期初入库' },
  '2': { type: 'PI', label: '采购入库' },
  '3': { type: 'OI', ioCategory: '成品入库', label: '成品入库' },
  '4': { type: 'PR', label: '采购退回' },
  '5': { type: 'OI', ioCategory: '其他入库', label: '其它入库' },
  'A': { type: 'SO', label: '销售出库' },
  'B': { type: 'OO', ioCategory: '材料领用', label: '材料领用' },
  'C': { type: 'OO', ioCategory: '其他出库', label: '其它出库' },
  'E': { type: 'TR', label: '调拨' },
  'G': { type: 'SR', label: '销售退货' },
}
/** 盘盈 / 盘亏没有单据头，按盘点单号合并成盘点单 CK */
const COUNT_TYPES = new Set(['PY', 'PK'])

/** 订单类别 htlb → 本系统类型 */
export const ACD_ORDER_TYPE_MAP: Record<string, { type: string; label: string }> = {
  '1': { type: 'PO', label: '采购订单' },
  '2': { type: 'SOa', label: '销售订单' },
}

/** 入库类在库存上的方向（jc_int 缺失时兜底） */
const TYPE_DIRECTION: Record<string, 1 | -1> = { IS: 1, PI: 1, OI: 1, SR: 1, PR: -1, SO: -1, OO: -1 }

/** 同日内的过账顺序：期初 → 入库 → 盘点 → 调拨 → 出库 */
const TYPE_ORDER: Record<string, number> = { IS: 0, PI: 1, OI: 2, SR: 3, CK: 4, TR: 5, PR: 6, OO: 7, SO: 8 }

const r2 = (n: number) => Math.round(n * 100) / 100
const r6 = (n: number) => Math.round(n * 1e6) / 1e6

export interface DocStats {
  orders: Record<string, number>
  docs: Record<string, number>
  lines: number
  moves: number
  skipped: Record<string, number>
  linkedOrderLines: number
}

/** 拆含税金额：行金额（不含税）= 数量 × 不含税单价；税额 = 含税金额 − 行金额 */
export function splitTax(qty: number, priceNet: number, gross: number, rate: number) {
  let amount: number
  if (priceNet && qty) amount = r2(qty * priceNet)
  else if (rate > 0) amount = r2(gross / (1 + rate / 100))
  else amount = r2(gross)
  if (!gross) gross = amount
  const tax = rate > 0 ? r2(gross - amount) : 0
  return { amount, tax }
}

interface PreparedLine {
  seq: number
  item_code: string
  warehouse_code: string | null
  qty: number
  price: number
  price_with_tax: number
  amount: number
  tax_rate: number
  tax_amount: number
  unit_cost: number
  batch_no: string | null
  expire_date: string | null
  remark: string | null
  ref_no: string | null
  source_line_id: string | null
  /** 库存过账：带符号数量（>0 入、<0 出）、仓库、成本 */
  moves: Array<{ wh: string; qty: number; cost: number | null }>
}

interface PreparedDoc {
  acdType: string
  type: string
  doc_no: string
  doc_date: string
  header: Record<string, any>
  lines: PreparedLine[]
  raw: AcdRecord | null
}

export function docNoAllocator(db: Database.Database, aid: string) {
  const used = new Set<string>(
    (db.prepare('SELECT doc_type, doc_no FROM scm_doc WHERE account_set_id=?').all(aid) as any[]).map(r => `${r.doc_type}|${r.doc_no}`)
  )
  return (type: string, no: string, suffix: string) => {
    let candidate = no
    let i = 0
    while (used.has(`${type}|${candidate}`)) { i++; candidate = i === 1 ? `${no}-${suffix}` : `${no}-${suffix}${i}` }
    used.add(`${type}|${candidate}`)
    return candidate
  }
}

/** 收集单据 / 订单引用到的档案编码（供补建占位档案） */
export function collectReferences(t: AcdTableSet) {
  const items = new Set<string>(); const partners = new Set<string>(); const warehouses = new Set<string>()
  const add = (s: Set<string>, v: string | undefined) => { const x = acdStr(v); if (x) s.add(x) }
  // drck 只有调拨单才是调入仓（其它单据里润衡拿它存关联单号）
  for (const r of t.get('pjnr1')) { add(partners, r.khbh); add(warehouses, r.ckbh); if (r.pjlb === 'E') add(warehouses, r.drck) }
  for (const r of t.get('pjnr2')) { add(items, r.cpbh); add(warehouses, r.ckbh) }
  for (const r of t.get('ht1')) add(partners, r.khbh)
  for (const r of t.get('ht2')) add(items, r.cpbh)
  for (const r of t.get('pdk')) { add(items, r.cpbh); add(warehouses, r.ckbh) }
  return { items, partners, warehouses }
}

/** 冲减往来（direction='out'），口径同 applyReturnAdjustment，但保留原单据类型 */
function insertArApReduction(db: Database.Database, aid: string, doc: any, amount: number, side: 'ar' | 'ap') {
  if (!doc.partner_code || !(amount > 0)) return
  const partner = db.prepare('SELECT ar_account, ap_account FROM scm_partner WHERE account_set_id=? AND code=?').get(aid, doc.partner_code) as any
  db.prepare(`INSERT INTO scm_ar_ap_log
    (id, account_set_id, partner_code, doc_type, doc_no, doc_date, due_date, direction, amount, ar_account, ap_account, cashier_journal_id, remark, currency, exchange_rate, amount_fc, arap_side)
    VALUES (?,?,?,?,?,?,?,'out',?,?,?,NULL,?,?,1,?,?)`).run(
    uuidv4(), aid, doc.partner_code, doc.doc_type, doc.doc_no, doc.doc_date, doc.doc_date, r2(amount),
    side === 'ar' ? (partner?.ar_account || '1131') : null, side === 'ap' ? (partner?.ap_account || '2121') : null,
    doc.remark, getScmBaseCurrency(db, aid), r2(amount), side,
  )
}

/** 润衡单据（`pjlb|pjdh`）→ 本系统单据，供收付款 / 发票回找来源 */
export type DocIndex = Map<string, { id: string; type: string; doc_no: string; partner_code: string | null }>

export function importDocuments(db: Database.Database, t: AcdTableSet, ctx: ImportContext, index: DocIndex = new Map()): DocStats {
  const aid = ctx.accountSetId
  const stats: DocStats = { orders: {}, docs: {}, lines: 0, moves: 0, skipped: {}, linkedOrderLines: 0 }
  const allocNo = docNoAllocator(db, aid)
  const bump = (m: Record<string, number>, k: string, n = 1) => { m[k] = (m[k] || 0) + n }

  const insDoc = db.prepare(`INSERT INTO scm_doc
    (id, account_set_id, doc_type, doc_no, doc_date, partner_code, warehouse_code, dest_warehouse_code, operator, biz_person, maker,
     status, auditor, audited_at, source_doc_id, total_qty, total_amount, total_tax, tax_rate, remark, io_category,
     payment_type, credit_days, invoice_type, invoice_no, invoice_date, contract_no, expect_date, cancel_flag,
     field_values, acd_raw, external_voucher, import_batch_id)
    VALUES (?,?,?,?,?,?,?,?,?,?,?, 'audited',?,?,?,?,?,?,?,?,?, ?,?,?,?,?,?,?,?, '{}',?,1,?)`)
  const insLine = db.prepare(`INSERT INTO scm_doc_line
    (id, account_set_id, doc_id, seq, item_code, warehouse_code, qty, price, price_with_tax, amount, tax_rate, tax_amount,
     unit_cost, batch_no, expire_date, source_line_id, remark, ref_no, spec, unit, field_values)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'{}')`)
  const itemInfo = db.prepare('SELECT spec, unit FROM scm_item WHERE account_set_id=? AND code=?')
  const itemCache = new Map<string, { spec: string | null; unit: string | null }>()
  const getItem = (code: string) => {
    let v = itemCache.get(code)
    if (!v) { v = (itemInfo.get(aid, code) as any) || { spec: null, unit: null }; itemCache.set(code, v!) }
    return v!
  }

  const writeDoc = (d: PreparedDoc, sourceDocId: string | null): string => {
    const id = uuidv4()
    const h = d.header
    const totalQty = r6(d.lines.reduce((s, l) => s + l.qty, 0))
    const totalAmount = r2(d.lines.reduce((s, l) => s + l.amount, 0))
    const totalTax = r2(d.lines.reduce((s, l) => s + l.tax_amount, 0))
    insDoc.run(
      id, aid, d.type, d.doc_no, d.doc_date, h.partner_code ?? null, h.warehouse_code ?? null, h.dest_warehouse_code ?? null,
      h.operator ?? null, h.biz_person ?? null, h.maker ?? null,
      h.auditor ?? ctx.operator, `${d.doc_date} 00:00:00`, sourceDocId, totalQty, totalAmount, totalTax, h.tax_rate ?? 0,
      h.remark ?? null, h.io_category ?? null,
      h.payment_type ?? null, h.credit_days ?? 0, h.invoice_type ?? null, h.invoice_no ?? null, h.invoice_date ?? null,
      h.contract_no ?? null, h.expect_date ?? null, h.cancel_flag ? 1 : 0,
      d.raw ? JSON.stringify(d.raw) : null, ctx.batchId,
    )
    for (const l of d.lines) {
      const it = getItem(l.item_code)
      insLine.run(uuidv4(), aid, id, l.seq, l.item_code, l.warehouse_code, l.qty, l.price, l.price_with_tax, l.amount, l.tax_rate, l.tax_amount,
        l.unit_cost, l.batch_no, l.expire_date, l.source_line_id, l.remark, l.ref_no, it.spec, it.unit)
    }
    stats.lines += d.lines.length
    return id
  }

  // ════════ 1. 订单 ht1 / ht2 ════════
  /** 订单行索引：`类型|订单号` → 行列表（供出入库单回填来源） */
  const orderLines = new Map<string, Array<{ id: string; item: string; qty: number; used: number; docId: string }>>()
  const ht2ByOrder = new Map<string, AcdRecord[]>()
  for (const r of t.get('ht2')) {
    const k = `${r.htlb}|${r.htbh}`
    const arr = ht2ByOrder.get(k) || []
    arr.push(r)
    ht2ByOrder.set(k, arr)
  }
  const orderLineIns = db.prepare(`INSERT INTO scm_doc_line
    (id, account_set_id, doc_id, seq, item_code, warehouse_code, qty, price, price_with_tax, amount, tax_rate, tax_amount,
     unit_cost, batch_no, remark, ref_no, spec, unit, field_values)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,0,?,?,?,?,?,'{}')`)
  for (const h of t.get('ht1')) {
    const map = ACD_ORDER_TYPE_MAP[h.htlb]
    if (!map) { bump(stats.skipped, `订单类别 ${h.htlb || '空'}`); continue }
    const date = parseAcdDate(h.rq)
    if (!date || !h.htbh) { bump(stats.skipped, `${map.label}（缺日期 / 单号）`); continue }
    const rate = acdNum(h.slv)
    const rows = (ht2ByOrder.get(`${h.htlb}|${h.htbh}`) || []).sort((a, b) => acdNum(a.xh) - acdNum(b.xh))
    const docId = uuidv4()
    const docNo = allocNo(map.type, h.htbh, 'D')
    const remark = [h.sm, h.sm2, h.sm3, h.sm4].map(acdStr).filter(Boolean).join('；') || null
    let tq = 0; let ta = 0; let tt = 0
    const lineRows: any[][] = []
    const lineIndex: Array<{ id: string; item: string; qty: number; used: number; docId: string }> = []
    rows.forEach((r, i) => {
      const qty = acdNum(r.sl0) || acdNum(r.sl_b) || acdNum(r.sl1)
      const gross = acdNum(r.je) || acdNum(r.je1)
      const priceNet = acdNum(r.dj_n)
      const { amount, tax } = splitTax(qty, priceNet, gross, rate)
      const lineId = uuidv4()
      const it = getItem(r.cpbh)
      lineRows.push([lineId, aid, docId, i + 1, r.cpbh, acdStr(r.ckbh) || acdStr(h.ckbh), qty,
        priceNet || (qty ? r6(amount / qty) : 0), acdNum(r.dj), amount, rate, tax, acdStr(r.ph),
        [acdStr(r.sm), acdStr(r.bz) && r.bz !== 'RMB' ? r.bz : null].filter(Boolean).join('；') || null, acdStr(r.dfbh), it.spec, it.unit])
      lineIndex.push({ id: lineId, item: r.cpbh, qty, used: 0, docId })
      tq += qty; ta += amount; tt += tax
    })
    insDoc.run(
      docId, aid, map.type, docNo, date, acdStr(h.khbh), acdStr(h.ckbh), null, acdStr(h.bgr), acdStr(h.jbr), acdStr(h.kpr),
      acdStr(h.kpr) || ctx.operator, `${date} 00:00:00`, null, r6(tq), r2(ta), r2(tt), rate, remark, null,
      acdStr(h.fklx), Math.trunc(acdNum(h.ts)), acdStr(h.fpzl), null, null, acdStr(h.dfddh), parseAcdDate(h.rq1), h.qxbz === '1' ? 1 : 0,
      JSON.stringify(h), ctx.batchId,
    )
    for (const lr of lineRows) orderLineIns.run(...lr)
    stats.lines += lineRows.length
    orderLines.set(`${map.type}|${h.htbh}`, lineIndex)
    bump(stats.orders, map.type)
  }

  /** 出入库明细按「订单号 + 物料」回找订单行，同料多行时优先未执行完的行 */
  const linkOrderLine = (htlb: string, htbh: string | null, item: string, qty: number): { lineId: string; docId: string } | null => {
    if (!htbh) return null
    const type = ACD_ORDER_TYPE_MAP[htlb]?.type
    if (!type) return null
    const list = orderLines.get(`${type}|${htbh}`)
    if (!list) return null
    const cands = list.filter(l => l.item === item)
    if (!cands.length) return null
    const pick = cands.find(l => l.used + Math.abs(qty) <= l.qty + 1e-6) || cands[cands.length - 1]
    pick.used += Math.abs(qty)
    stats.linkedOrderLines++
    return { lineId: pick.id, docId: pick.docId }
  }

  // ════════ 2. 出入库单 pjnr1 / pjnr2 ════════
  const linesByDoc = new Map<string, AcdRecord[]>()
  for (const r of t.get('pjnr2')) {
    const k = `${r.pjlb}|${r.pjdh}`
    const arr = linesByDoc.get(k) || []
    arr.push(r)
    linesByDoc.set(k, arr)
  }
  const prepared: Array<PreparedDoc & { orderLinks: Array<string | null> }> = []
  for (const h of t.get('pjnr1')) {
    const map = ACD_DOC_TYPE_MAP[h.pjlb]
    if (!map) {
      bump(stats.skipped, `单据类别 ${h.pjlb || '空'}`)
      continue
    }
    const date = parseAcdDate(h.rq)
    if (!date || !h.pjdh) { bump(stats.skipped, `${map.label}（缺日期 / 单号）`); continue }
    const rows = (linesByDoc.get(`${h.pjlb}|${h.pjdh}`) || []).sort((a, b) => acdNum(a.xh) - acdNum(b.xh))
    linesByDoc.delete(`${h.pjlb}|${h.pjdh}`)
    const rate = acdNum(h.slv)
    const isTransfer = map.type === 'TR'
    const isReturnSale = map.type === 'SR'
    const docOrderLinks: Array<string | null> = []
    const lines: PreparedLine[] = []
    // 调拨：润衡一行调出（jc_int=-1）+ 一行调入（jc_int=1）成对出现，按 物料+数量 配对
    const transferIns = isTransfer ? rows.filter(r => r.jc_int === '1') : []
    const sourceRows = isTransfer ? rows.filter(r => r.jc_int !== '1') : rows
    let seq = 0
    for (const r of sourceRows) {
      seq++
      const rawQty = acdNum(r.sl)
      const dir = r.jc_int === '1' ? 1 : r.jc_int === '-1' ? -1 : (TYPE_DIRECTION[map.type] ?? 1)
      const wh = acdStr(r.ckbh) || acdStr(h.ckbh)
      const dwcb = acdNum(r.dwcb)
      const priceNet = acdNum(r.dj)
      // 销售退货在润衡里是负数量出库，本系统 SR 为正数入库
      const sign = isReturnSale && rawQty < 0 ? -1 : 1
      const qty = rawQty * sign
      const gross = acdNum(r.je) * sign
      const { amount, tax } = splitTax(qty, priceNet, gross, rate)
      let moves: PreparedLine['moves'] = []
      let lineWh = wh
      if (isTransfer) {
        const pairIdx = transferIns.findIndex(x => x.cpbh === r.cpbh && Math.abs(acdNum(x.sl) - rawQty) < 1e-9)
        const pair = pairIdx >= 0 ? transferIns.splice(pairIdx, 1)[0] : null
        const destWh = acdStr(pair?.ckbh) || acdStr(h.drck)
        lineWh = destWh
        const cost = dwcb > 0 ? dwcb : null
        // 调出仓：-sl（负数量的调拨即反向）；调入仓：+sl，成本取调出实际单价
        if (wh) moves.push({ wh, qty: -rawQty, cost })
        if (destWh) moves.push({ wh: destWh, qty: rawQty, cost: null })
      } else if (wh) {
        const eff = dir * rawQty
        // 入库类正常入库：dwcb（无则不含税单价）；出库类的负数行（单内退回）入库不能拿售价当成本，无 dwcb 时取当前均价
        const typeDir = TYPE_DIRECTION[map.type] ?? 1
        const cost = eff > 0 ? (dwcb > 0 ? dwcb : typeDir > 0 ? priceNet : null) : dwcb
        moves = [{ wh, qty: eff, cost }]
      }
      const link = isTransfer ? null : linkOrderLine(r.htlb || (map.type === 'PI' || map.type === 'PR' ? '1' : '2'), acdStr(r.htbh), r.cpbh, qty)
      docOrderLinks.push(link?.docId ?? null)
      lines.push({
        seq, item_code: r.cpbh, warehouse_code: lineWh, qty, price: priceNet, price_with_tax: acdNum(r.dj_hs),
        amount, tax_rate: rate, tax_amount: tax,
        unit_cost: dwcb > 0 ? dwcb : (moves[0]?.qty ?? 0) > 0 ? priceNet : 0,
        batch_no: acdStr(r.ph), expire_date: parseAcdDate(r.sxq),
        remark: acdStr(r.sm), ref_no: acdStr(r.dfddh) || acdStr(r.dfbh),
        source_line_id: link?.lineId ?? null, moves,
      })
    }
    for (const orphan of transferIns) {
      pushIssue(ctx, 'warn', '单据', `调拨单 ${h.pjdh} 的调入行（物料 ${orphan.cpbh}，数量 ${orphan.sl}）找不到对应调出行，已忽略`)
    }
    const docNo = allocNo(map.type, h.pjdh, h.pjlb)
    if (docNo !== h.pjdh) pushIssue(ctx, 'info', '单据', `${map.label} ${h.pjdh} 与已有单号重复，导入为 ${docNo}`)
    prepared.push({
      acdType: h.pjlb, type: map.type, doc_no: docNo, doc_date: date, raw: h, lines, orderLinks: docOrderLinks,
      header: {
        partner_code: acdStr(h.khbh), warehouse_code: acdStr(h.ckbh), dest_warehouse_code: isTransfer ? acdStr(h.drck) : null,
        operator: acdStr(h.bgr), biz_person: acdStr(h.jbr), maker: acdStr(h.kpr), auditor: acdStr(h.jsr) || acdStr(h.kpr),
        tax_rate: rate, remark: acdStr(h.sm), io_category: map.ioCategory ?? null,
        payment_type: acdStr(h.fklx), credit_days: Math.trunc(acdNum(h.ts)),
        invoice_type: acdStr(h.fpzl), invoice_no: acdStr(h.fpdh), invoice_date: parseAcdDate(h.fprq),
        contract_no: acdStr(h.htbh), cancel_flag: h.bz_zf === '1',
      },
    })
  }

  // ════════ 3. 盘点：pdk（盘点明细）+ pjnr2 的 PY / PK（盘盈 / 盘亏过账行） ════════
  const countDocs = new Map<string, { date: string | null; pdk: AcdRecord[]; diffs: AcdRecord[] }>()
  for (const r of t.get('pdk')) {
    const c = countDocs.get(r.pddh) || { date: parseAcdDate(r.rq), pdk: [], diffs: [] }
    c.pdk.push(r)
    countDocs.set(r.pddh, c)
  }
  for (const [k, rows] of linesByDoc) {
    const [pjlb, pjdh] = k.split('|')
    if (!COUNT_TYPES.has(pjlb)) {
      bump(stats.skipped, `无单据头的明细（${pjlb} ${pjdh}）`, rows.length)
      continue
    }
    const c = countDocs.get(pjdh) || { date: null, pdk: [], diffs: [] }
    c.diffs.push(...rows)
    countDocs.set(pjdh, c)
  }
  for (const [pddh, c] of countDocs) {
    const date = c.date || parseAcdDate(c.diffs[0]?.ny)
    if (!date) { bump(stats.skipped, `盘点单 ${pddh}（缺日期）`); continue }
    const lines: PreparedLine[] = []
    let seq = 0
    // 明细行：以 pdk 为准（实盘数、账面数）；过账：以 PY / PK 为准（带润衡成本）
    const diffKey = (wh: string, item: string) => `${wh}|${item}`
    const diffMap = new Map<string, AcdRecord[]>()
    for (const d of c.diffs) {
      const k = diffKey(d.ckbh, d.cpbh)
      const arr = diffMap.get(k) || []
      arr.push(d)
      diffMap.set(k, arr)
    }
    const toMoves = (ds: AcdRecord[]) => ds.map(d => ({ wh: d.ckbh, qty: (d.pjlb === 'PK' ? -1 : 1) * acdNum(d.sl), cost: acdNum(d.dwcb) }))
    for (const p of c.pdk.sort((a, b) => acdNum(a.xh) - acdNum(b.xh))) {
      seq++
      const k = diffKey(p.ckbh, p.cpbh)
      const ds = diffMap.get(k) || []
      diffMap.delete(k)
      const cost = acdNum(ds[0]?.dwcb) || acdNum(p.dj)
      lines.push({
        seq, item_code: p.cpbh, warehouse_code: acdStr(p.ckbh), qty: acdNum(p.sjsl), price: cost, price_with_tax: cost,
        amount: 0, tax_rate: 0, tax_amount: 0, unit_cost: cost, batch_no: acdStr(p.ph), expire_date: null,
        remark: `账面 ${r6(acdNum(p.zmsl))}，实盘 ${r6(acdNum(p.sjsl))}`, ref_no: null, source_line_id: null,
        moves: toMoves(ds),
      })
    }
    for (const ds of diffMap.values()) {
      seq++
      const d = ds[0]
      const diff = ds.reduce((s, x) => s + (x.pjlb === 'PK' ? -1 : 1) * acdNum(x.sl), 0)
      lines.push({
        seq, item_code: d.cpbh, warehouse_code: acdStr(d.ckbh), qty: r6(diff), price: acdNum(d.dwcb), price_with_tax: acdNum(d.dwcb),
        amount: 0, tax_rate: 0, tax_amount: 0, unit_cost: acdNum(d.dwcb), batch_no: acdStr(d.ph), expire_date: null,
        remark: `盘点差异 ${r6(diff)}（润衡盘点明细中无此物料）`, ref_no: null, source_line_id: null, moves: toMoves(ds),
      })
    }
    const whs = [...new Set(lines.map(l => l.warehouse_code).filter(Boolean))]
    prepared.push({
      acdType: 'PD', type: 'CK', doc_no: allocNo('CK', pddh, 'PD'), doc_date: date, raw: null, lines, orderLinks: [],
      header: { warehouse_code: whs.length === 1 ? whs[0] : null, remark: '润衡盘点单（盘盈 / 盘亏按润衡成本过账）', maker: ctx.operator },
    })
  }

  // 往来挂账以润衡往来流水 wldj 为准（lx 为空的行 = 单据挂账）：现款单据润衡记 0、不挂账，金额也可能被改过；
  // 没有对应流水的单据才按单据含税合计挂账。
  const wldjByDoc = new Map<string, number>()
  for (const w of t.get('wldj')) {
    if (acdStr(w.lx) || !w.pjlb || !w.pjdh) continue
    const k = `${w.pjlb}|${w.pjdh}`
    wldjByDoc.set(k, r2((wldjByDoc.get(k) || 0) + acdNum(w.jf) + acdNum(w.df)))
  }
  let cashDocs = 0
  const noLedgerDocs: string[] = []

  // ════════ 4. 按日期顺序落库 + 过账 ════════
  prepared.sort((a, b) => a.doc_date.localeCompare(b.doc_date)
    || (TYPE_ORDER[a.type] ?? 9) - (TYPE_ORDER[b.type] ?? 9)
    || a.doc_no.localeCompare(b.doc_no))
  for (const d of prepared) {
    const orderDocs = [...new Set(d.orderLinks.filter(Boolean))]
    const docId = writeDoc(d, orderDocs.length === 1 && d.orderLinks.every(Boolean) ? orderDocs[0] : null)
    bump(stats.docs, d.type)
    if (d.raw?.pjdh) index.set(`${d.acdType}|${d.raw.pjdh}`, { id: docId, type: d.type, doc_no: d.doc_no, partner_code: d.header.partner_code ?? null })
    for (const l of d.lines) {
      let lastOutCost: number | null = null
      // 先出后入：调拨的调入成本取本行调出的实际单价
      for (const m of [...l.moves].sort((a, b) => a.qty - b.qty)) {
        if (!m.wh || !m.qty) continue
        const ref = { type: d.type, no: d.doc_no, seq: l.seq, date: d.doc_date, batchNo: l.batch_no }
        if (m.qty > 0) {
          const cost = m.cost ?? lastOutCost ?? currentUnitCost(db, aid, m.wh, l.item_code)
          applyMovingAvgIn(db, aid, m.wh, l.item_code, m.qty, cost, ref)
        } else {
          const opts: { allowNegative: boolean; forceUnitCost?: number } = { allowNegative: true }
          if (m.cost !== null) opts.forceUnitCost = m.cost
          const { unitCost } = applyMovingAvgOut(db, aid, m.wh, l.item_code, -m.qty, ref, opts)
          lastOutCost = unitCost
        }
        stats.moves++
      }
      if (d.type === 'TR' && lastOutCost !== null && !(l.unit_cost > 0)) {
        db.prepare('UPDATE scm_doc_line SET unit_cost=? WHERE doc_id=? AND seq=?').run(lastOutCost, docId, l.seq)
      }
    }
    // 往来挂账（口径同审核：含税合计）
    const docRow = { id: docId, doc_type: d.type, doc_no: d.doc_no, doc_date: d.doc_date, partner_code: d.header.partner_code ?? null,
      remark: d.header.remark ?? null, currency: null, exchange_rate: 1, credit_days: d.header.credit_days ?? 0 }
    if (!['SO', 'PI', 'PR', 'SR'].includes(d.type)) continue
    const ledger = wldjByDoc.get(`${d.acdType}|${d.raw?.pjdh}`)
    let arapLines: Array<{ amount: number; tax_amount: number }> = d.lines
    if (ledger === undefined && wldjByDoc.size > 0) {
      // 润衡有往来流水、唯独这张单没有挂账记录：以润衡为准不挂，列出来请人工核对
      noLedgerDocs.push(`${ACD_DOC_TYPE_MAP[d.acdType]?.label || d.type} ${d.doc_no}`)
      continue
    }
    if (ledger !== undefined) {
      if (Math.abs(ledger) < 0.005) { cashDocs++; continue }
      // 出库 / 入库单整单净额为负（单内退货多于发货）：按冲减往来记，单据类型不变，便于追溯
      if (ledger < 0 && (d.type === 'SO' || d.type === 'PI')) {
        insertArApReduction(db, aid, docRow, -ledger, d.type === 'SO' ? 'ar' : 'ap')
        continue
      }
      arapLines = [{ amount: Math.abs(ledger), tax_amount: 0 }]
    }
    if (d.type === 'SO') applyReceivableFromShipment(db, aid, docRow, arapLines)
    else if (d.type === 'PI') applyPayableFromReceipt(db, aid, docRow, arapLines)
    else applyReturnAdjustment(db, aid, docRow, arapLines)
  }
  if (noLedgerDocs.length) {
    pushIssue(ctx, 'warn', '往来', `${noLedgerDocs.length} 张出入库单在润衡往来流水中没有挂账记录，本系统未挂应收应付，请核对：${noLedgerDocs.slice(0, 30).join('、')}${noLedgerDocs.length > 30 ? ' 等' : ''}`)
  }
  if (cashDocs) pushIssue(ctx, 'info', '往来', `${cashDocs} 张出入库单在润衡往来流水中挂账金额为 0（现款或未挂账），本系统同样不挂应收应付`)
  return stats
}
