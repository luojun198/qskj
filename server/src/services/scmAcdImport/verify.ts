/**
 * 进销存 ACD 导入：导入后核对
 *  - 库存：本系统 scm_stock 与润衡当前库存 kcb（数量 dqkc、金额 je）按 仓库 + 物料 比对；
 *  - 负库存：导入后结存为负的 仓库 + 物料。
 */
import type Database from 'better-sqlite3'
import { type AcdTableSet, acdNum } from './acdTables.js'

export interface StockDiffRow {
  warehouse_code: string
  item_code: string
  item_name: string | null
  acd_qty: number
  acd_amount: number
  qty: number
  amount: number
  qty_diff: number
  amount_diff: number
  /** qty 数量不符 / acd_residual 润衡数量为 0 仍挂金额 / no_cost_wh 润衡该仓不核算金额 / amount 金额不符 */
  reason: 'qty' | 'acd_residual' | 'no_cost_wh' | 'amount'
}

export const STOCK_DIFF_REASONS: Record<StockDiffRow['reason'], string> = {
  qty: '数量不符',
  acd_residual: '润衡数量为 0 仍挂金额（润衡月末成本尾差）',
  no_cost_wh: '润衡车间仓不核算金额',
  amount: '金额不符',
}

export interface VerifyReport {
  stock: {
    compared: number
    qtyMatched: number
    amountMatched: number
    acdTotalQty: number
    acdTotalAmount: number
    totalQty: number
    totalAmount: number
    diffs: StockDiffRow[]
    byReason: Record<string, { count: number; amount_diff: number }>
  }
  arap: {
    partners: number
    matched: number
    acdTotal: { ar: number; ap: number }
    total: { ar: number; ap: number }
    diffs: Array<{ partner_code: string; partner_name: string | null; side: 'ar' | 'ap'; acd: number; ours: number; diff: number }>
  }
  negatives: Array<{ warehouse_code: string; item_code: string; item_name: string | null; qty: number; amount: number }>
  /** 发票：润衡开票金额 vs 本系统发票价税合计（销售 RS / 采购 RP） */
  invoices: { acd: { RS: number; RP: number }; ours: { RS: number; RP: number } }
}

const r2 = (n: number) => Math.round(n * 100) / 100
const r6 = (n: number) => Math.round(n * 1e6) / 1e6

export function verifyImport(db: Database.Database, aid: string, t: AcdTableSet, opts: { maxDiffRows?: number } = {}): VerifyReport {
  const maxRows = opts.maxDiffRows ?? 500
  const names = new Map<string, string>(
    (db.prepare('SELECT code, name FROM scm_item WHERE account_set_id=?').all(aid) as any[]).map(r => [r.code, r.name])
  )
  const ours = new Map<string, { qty: number; amount: number }>()
  for (const r of db.prepare('SELECT warehouse_code, item_code, qty, amount FROM scm_stock WHERE account_set_id=?').all(aid) as any[]) {
    ours.set(`${r.warehouse_code}|${r.item_code}`, { qty: Number(r.qty) || 0, amount: Number(r.amount) || 0 })
  }
  const acd = new Map<string, { qty: number; amount: number }>()
  for (const r of t.get('kcb')) {
    if (!r.ckbh || !r.cpbh) continue
    const k = `${r.ckbh}|${r.cpbh}`
    const v = acd.get(k) || { qty: 0, amount: 0 }
    v.qty += acdNum(r.dqkc); v.amount += acdNum(r.je)
    acd.set(k, v)
  }
  const noCostWh = new Set(t.get('ckda').filter(r => r.sx === '1').map(r => r.ckbh))
  const keys = new Set([...ours.keys(), ...acd.keys()])
  const byReason: Record<string, { count: number; amount_diff: number }> = {}
  const diffs: StockDiffRow[] = []
  let qtyMatched = 0; let amountMatched = 0
  let acdTotalQty = 0; let acdTotalAmount = 0; let totalQty = 0; let totalAmount = 0
  for (const k of keys) {
    const a = acd.get(k) || { qty: 0, amount: 0 }
    const o = ours.get(k) || { qty: 0, amount: 0 }
    acdTotalQty += a.qty; acdTotalAmount += a.amount; totalQty += o.qty; totalAmount += o.amount
    const qd = r6(o.qty - a.qty)
    const ad = r2(o.amount - a.amount)
    const qOk = Math.abs(qd) < 1e-4
    const aOk = Math.abs(ad) < 0.05
    if (qOk) qtyMatched++
    if (aOk) amountMatched++
    if (!qOk || !aOk) {
      const [wh, item] = k.split('|')
      const reason: StockDiffRow['reason'] = !qOk ? 'qty'
        : Math.abs(a.qty) < 1e-6 ? 'acd_residual'
        : noCostWh.has(wh) && Math.abs(a.amount) < 0.05 ? 'no_cost_wh' : 'amount'
      const b = byReason[reason] || { count: 0, amount_diff: 0 }
      b.count++; b.amount_diff = r2(b.amount_diff + ad)
      byReason[reason] = b
      diffs.push({ warehouse_code: wh, item_code: item, item_name: names.get(item) ?? null,
        acd_qty: r6(a.qty), acd_amount: r2(a.amount), qty: r6(o.qty), amount: r2(o.amount), qty_diff: qd, amount_diff: ad, reason })
    }
  }
  diffs.sort((x, y) => Math.abs(y.qty_diff) - Math.abs(x.qty_diff) || Math.abs(y.amount_diff) - Math.abs(x.amount_diff))

  const negatives = (db.prepare(`SELECT warehouse_code, item_code, qty, amount FROM scm_stock
      WHERE account_set_id=? AND qty < -0.000001 ORDER BY warehouse_code, item_code`).all(aid) as any[])
    .map(r => ({ ...r, item_name: names.get(r.item_code) ?? null }))

  return {
    stock: {
      compared: keys.size, qtyMatched, amountMatched,
      acdTotalQty: r6(acdTotalQty), acdTotalAmount: r2(acdTotalAmount), totalQty: r6(totalQty), totalAmount: r2(totalAmount),
      diffs: diffs.slice(0, maxRows), byReason,
    },
    arap: verifyArAp(db, aid, t, maxRows),
    negatives,
    invoices: verifyInvoices(db, aid, t),
  }
}

/**
 * 往来：润衡 wldj 中 lx 为空的行（出入库单挂账）按往来单位汇总，
 * 加上收付款（冲减），与本系统 scm_ar_ap_log 按单位 / 应收应付汇总的净额比对。发票登记不影响往来。
 */
function verifyArAp(db: Database.Database, aid: string, t: AcdTableSet, maxRows: number): VerifyReport['arap'] {
  const AR_TYPES = new Set(['A', 'G', 'D']); const AP_TYPES = new Set(['2', '4'])
  const acd = new Map<string, number>()
  const settle = new Set(t.get('wldj_lx').map(r => r.lx).filter(Boolean))
  for (const w of t.get('wldj')) {
    if (!w.khbh) continue
    if (w.lx && settle.has(w.lx)) {
      // 收付款：付款（借方）冲应付、收款（贷方）冲应收
      const pay = acdNum(w.jf) >= acdNum(w.df)
      const k = `${w.khbh}|${pay ? 'ap' : 'ar'}`
      acd.set(k, (acd.get(k) || 0) - Math.abs(acdNum(w.jf) - acdNum(w.df)))
      continue
    }
    if (w.lx) continue   // 发票登记不影响往来
    const side = AR_TYPES.has(w.pjlb) ? 'ar' : AP_TYPES.has(w.pjlb) ? 'ap' : null
    if (!side) continue
    const k = `${w.khbh}|${side}`
    acd.set(k, (acd.get(k) || 0) + acdNum(w.jf) + acdNum(w.df))
  }
  const ours = new Map<string, number>()
  const rows = db.prepare(`SELECT partner_code, doc_type, direction, amount, arap_side FROM scm_ar_ap_log WHERE account_set_id=?`).all(aid) as any[]
  for (const r of rows) {
    const side = r.arap_side || (['SO', 'SR', 'RS', 'RCV'].includes(r.doc_type) ? 'ar' : 'ap')
    const k = `${r.partner_code}|${side}`
    ours.set(k, (ours.get(k) || 0) + (r.direction === 'out' ? -1 : 1) * (Number(r.amount) || 0))
  }
  const names = new Map<string, string>(
    (db.prepare('SELECT code, name FROM scm_partner WHERE account_set_id=?').all(aid) as any[]).map(r => [r.code, r.name])
  )
  const keys = new Set([...acd.keys(), ...ours.keys()])
  const diffs: VerifyReport['arap']['diffs'] = []
  const acdTotal = { ar: 0, ap: 0 }; const total = { ar: 0, ap: 0 }
  let matched = 0
  for (const k of keys) {
    const [code, side] = k.split('|') as [string, 'ar' | 'ap']
    const a = r2(acd.get(k) || 0); const o = r2(ours.get(k) || 0)
    acdTotal[side] = r2(acdTotal[side] + a); total[side] = r2(total[side] + o)
    if (Math.abs(a - o) < 0.05) matched++
    else diffs.push({ partner_code: code, partner_name: names.get(code) ?? null, side, acd: a, ours: o, diff: r2(o - a) })
  }
  diffs.sort((x, y) => Math.abs(y.diff) - Math.abs(x.diff))
  return { partners: keys.size, matched, acdTotal, total, diffs: diffs.slice(0, maxRows) }
}

function verifyInvoices(db: Database.Database, aid: string, t: AcdTableSet): VerifyReport['invoices'] {
  const settle = new Set(t.get('wldj_lx').map(r => r.lx).filter(Boolean))
  const acd = { RS: 0, RP: 0 }
  for (const w of t.get('wldj')) {
    if (!w.lx || settle.has(w.lx)) continue
    const k = ['A', 'G', 'D'].includes(w.pjlb) ? 'RS' : 'RP'
    acd[k] = r2(acd[k] + acdNum(w.fpjf) + acdNum(w.fpdf))
  }
  const ours = { RS: 0, RP: 0 }
  for (const r of db.prepare(`SELECT doc_type, SUM(total_amount + total_tax) s FROM scm_doc WHERE account_set_id=? AND doc_type IN ('RS','RP') GROUP BY doc_type`).all(aid) as any[]) {
    ours[r.doc_type as 'RS' | 'RP'] = r2(Number(r.s) || 0)
  }
  return { acd, ours }
}
