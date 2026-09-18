/**
 * 全月平均（月末一次加权平均）成本计算。
 *
 * 期内出库审核时按当前均价暂估（与移动加权平均相同口径），月末执行本计算：
 *   全月平均单价 = (期初金额 + 本期入库金额 ± 本期成本调整) / (期初数量 + 本期入库数量)
 * 然后把本期全部出库流水（qty>0, direction='out'）的单价 / 金额统一改为该均价，
 * 差额调整 scm_stock 结存金额，并顺序重算该仓该物料自期初起的流水结存列；出库单据行的 unit_cost 一并回写。
 *
 * 期初 = 当前结存 − 期初日之后全部流水的净变动（Σ流水 ≡ 结存，P2-2），因此计算可重复执行（幂等）。
 * 已生成凭证的出库单据成本变化后凭证不会自动改，结果里列出需重新生成凭证的单据。
 */
import type Database from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'

const r2 = (n: number) => Math.round(n * 100) / 100
const r4 = (n: number) => Math.round(n * 10000) / 10000

export interface MonthAvgRow {
  warehouse_code: string; item_code: string; item_name?: string; warehouse_name?: string
  opening_qty: number; opening_amount: number
  in_qty: number; in_amount: number; adjust_amount: number
  avg_cost: number
  out_qty: number; old_out_amount: number; new_out_amount: number; delta: number
  closing_qty: number; closing_amount: number
}
export interface MonthAvgVoucherDoc { doc_id: string; doc_type: string; doc_no: string; voucher_id: string; delta: number }
export interface MonthAvgResult {
  period: string; rows: MonthAvgRow[]; out_delta: number; item_count: number
  voucher_docs: MonthAvgVoucherDoc[]
}

function periodRange(period: string): { start: string; end: string } {
  if (!/^\d{4}-\d{2}$/.test(period)) throw new Error('期间格式应为 YYYY-MM')
  const [y, m] = period.split('-').map(Number)
  const last = new Date(y, m, 0).getDate()
  return { start: `${period}-01`, end: `${period}-${String(last).padStart(2, '0')}` }
}

/**
 * 计算（dryRun=true 只试算不写库）。
 */
export function calcMonthAvg(db: Database.Database, accountSetId: string, period: string, options: { dryRun?: boolean; user?: string } = {}): MonthAvgResult {
  const { start, end } = periodRange(period)
  // 本期有流水的 仓库+物料
  const keys = db.prepare(`SELECT DISTINCT warehouse_code, item_code FROM scm_stock_move
    WHERE account_set_id=? AND move_date>=? AND move_date<=? ORDER BY warehouse_code, item_code`).all(accountSetId, start, end) as { warehouse_code: string; item_code: string }[]
  const rows: MonthAvgRow[] = []
  const voucherMap = new Map<string, MonthAvgVoucherDoc>()
  const stockStmt = db.prepare('SELECT qty, amount FROM scm_stock WHERE account_set_id=? AND warehouse_code=? AND item_code=?')
  const afterStmt = db.prepare(`SELECT COALESCE(SUM(CASE WHEN direction='in' THEN qty ELSE -qty END),0) q,
      COALESCE(SUM(CASE WHEN direction='in' THEN amount ELSE -amount END),0) a
    FROM scm_stock_move WHERE account_set_id=? AND warehouse_code=? AND item_code=? AND move_date>=?`)
  const monthStmt = db.prepare(`SELECT id, doc_type, doc_no, line_seq, direction, qty, unit_cost, amount FROM scm_stock_move
    WHERE account_set_id=? AND warehouse_code=? AND item_code=? AND move_date>=? AND move_date<=? ORDER BY move_date, rowid`)
  const updMove = db.prepare('UPDATE scm_stock_move SET unit_cost=?, amount=? WHERE id=?')
  const updStock = db.prepare("UPDATE scm_stock SET amount=?, avg_cost=?, updated_at=datetime('now') WHERE account_set_id=? AND warehouse_code=? AND item_code=?")
  const docStmt = db.prepare('SELECT id, voucher_id FROM scm_doc WHERE account_set_id=? AND doc_type=? AND doc_no=?')
  const updLine = db.prepare('UPDATE scm_doc_line SET unit_cost=? WHERE doc_id=? AND seq=? AND item_code=?')
  const nameStmt = db.prepare(`SELECT (SELECT name FROM scm_item WHERE account_set_id=? AND code=?) item_name,
    (SELECT name FROM scm_warehouse WHERE account_set_id=? AND code=?) warehouse_name`)

  const run = () => {
    for (const k of keys) {
      const stock = stockStmt.get(accountSetId, k.warehouse_code, k.item_code) as { qty: number; amount: number } | undefined
      const after = afterStmt.get(accountSetId, k.warehouse_code, k.item_code, start) as { q: number; a: number }
      const openingQty = r4(Number(stock?.qty || 0) - Number(after.q))
      const openingAmt = r2(Number(stock?.amount || 0) - Number(after.a))
      const moves = monthStmt.all(accountSetId, k.warehouse_code, k.item_code, start, end) as any[]
      let inQty = 0, inAmt = 0, adjAmt = 0, outQty = 0, oldOut = 0
      for (const m of moves) {
        const q = Number(m.qty) || 0, a = Number(m.amount) || 0
        if (q <= 0) { adjAmt += m.direction === 'in' ? a : -a; continue }   // qty=0：成本调整（结案结转）
        if (m.direction === 'in') { inQty += q; inAmt += a } else { outQty += q; oldOut += a }
      }
      const denom = r4(openingQty + inQty)
      const numer = r2(openingAmt + inAmt + adjAmt)
      // 分母 ≤ 0（期初负库存且无入库）时无法求均价，保留暂估成本
      const avg = denom > 0 ? r4(numer / denom) : null
      let newOut = oldOut
      if (avg !== null && outQty > 0) {
        newOut = 0
        const outs = moves.filter(m => m.direction === 'out' && Number(m.qty) > 0)
        for (let i = 0; i < outs.length; i++) {
          const m = outs[i]
          // 尾差：最后一笔出库吃掉舍入差，保证 Σ出库金额 = 均价 × 出库量（2 位）
          const amt = i === outs.length - 1 ? r2(r2(avg * outQty) - newOut) : r2(avg * Number(m.qty))
          newOut = r2(newOut + amt)
          if (!options.dryRun) {
            if (r2(Number(m.amount)) !== amt || r4(Number(m.unit_cost)) !== avg) {
              updMove.run(avg, amt, m.id)
              const doc = docStmt.get(accountSetId, m.doc_type, m.doc_no) as { id: string; voucher_id: string | null } | undefined
              if (doc) {
                updLine.run(avg, doc.id, m.line_seq, k.item_code)
                if (doc.voucher_id) {
                  const v = voucherMap.get(doc.id) || { doc_id: doc.id, doc_type: m.doc_type, doc_no: m.doc_no, voucher_id: doc.voucher_id, delta: 0 }
                  v.delta = r2(v.delta + amt - Number(m.amount))
                  voucherMap.set(doc.id, v)
                }
              }
            }
          } else {
            const doc = docStmt.get(accountSetId, m.doc_type, m.doc_no) as { id: string; voucher_id: string | null } | undefined
            if (doc?.voucher_id && r2(Number(m.amount)) !== amt) {
              const v = voucherMap.get(doc.id) || { doc_id: doc.id, doc_type: m.doc_type, doc_no: m.doc_no, voucher_id: doc.voucher_id, delta: 0 }
              v.delta = r2(v.delta + amt - Number(m.amount))
              voucherMap.set(doc.id, v)
            }
          }
        }
      }
      const delta = r2(newOut - oldOut)
      const closingQty = r4(openingQty + inQty - outQty)
      const closingAmt = r2(numer - newOut)
      if (!options.dryRun && delta !== 0 && stock) {
        // 出库多记了 delta → 结存少 delta
        const newStockAmt = r2(Number(stock.amount) - delta)
        const q = Number(stock.qty) || 0
        updStock.run(newStockAmt, q > 0 ? r4(newStockAmt / q) : 0, accountSetId, k.warehouse_code, k.item_code)
        rebuildBalances(db, accountSetId, k.warehouse_code, k.item_code, start, openingQty, openingAmt)
      }
      const names = nameStmt.get(accountSetId, k.item_code, accountSetId, k.warehouse_code) as any
      rows.push({
        warehouse_code: k.warehouse_code, item_code: k.item_code, item_name: names?.item_name, warehouse_name: names?.warehouse_name,
        opening_qty: openingQty, opening_amount: openingAmt, in_qty: r4(inQty), in_amount: r2(inAmt), adjust_amount: r2(adjAmt),
        avg_cost: avg ?? 0, out_qty: r4(outQty), old_out_amount: r2(oldOut), new_out_amount: r2(newOut), delta,
        closing_qty: closingQty, closing_amount: closingAmt,
      })
    }
  }
  if (options.dryRun) run()
  else db.transaction(run)()

  const result: MonthAvgResult = {
    period, rows, item_count: rows.length,
    out_delta: r2(rows.reduce((s, r) => s + r.delta, 0)),
    voucher_docs: [...voucherMap.values()].filter(v => v.delta !== 0),
  }
  if (!options.dryRun) {
    db.prepare(`INSERT INTO scm_costing_period (id,account_set_id,period,method,status,item_count,out_delta,summary_json,calculated_at,calculated_by)
      VALUES (?,?,?,'month_avg','calculated',?,?,?,datetime('now'),?)
      ON CONFLICT(account_set_id, period) DO UPDATE SET status='calculated', item_count=excluded.item_count, out_delta=excluded.out_delta,
        summary_json=excluded.summary_json, calculated_at=excluded.calculated_at, calculated_by=excluded.calculated_by`)
      .run(uuidv4(), accountSetId, period, result.item_count, result.out_delta,
        JSON.stringify({ voucher_docs: result.voucher_docs, rows: rows.length > 500 ? [] : rows }), options.user || null)
  }
  return result
}

/** 自期初起按日期+rowid 顺序重算某仓某物料流水的结存列 */
function rebuildBalances(db: Database.Database, accountSetId: string, warehouse: string, itemCode: string, start: string, openingQty: number, openingAmt: number): void {
  const moves = db.prepare(`SELECT id, direction, qty, amount FROM scm_stock_move
    WHERE account_set_id=? AND warehouse_code=? AND item_code=? AND move_date>=? ORDER BY move_date, rowid`).all(accountSetId, warehouse, itemCode, start) as any[]
  const upd = db.prepare('UPDATE scm_stock_move SET balance_qty=?, balance_amount=?, balance_avg_cost=? WHERE id=?')
  let q = openingQty, a = openingAmt
  for (const m of moves) {
    const sign = m.direction === 'in' ? 1 : -1
    q = r4(q + sign * (Number(m.qty) || 0))
    a = r2(a + sign * (Number(m.amount) || 0))
    upd.run(q, a, q !== 0 ? r4(a / q) : 0, m.id)
  }
}

/** 已计算期间列表（含 stale 标记） */
export function listCostingPeriods(db: Database.Database, accountSetId: string) {
  return db.prepare(`SELECT period, method, status, item_count, out_delta, calculated_at, calculated_by, summary_json
    FROM scm_costing_period WHERE account_set_id=? ORDER BY period DESC`).all(accountSetId).map((r: any) => {
    let summary: any = null
    try { summary = r.summary_json ? JSON.parse(r.summary_json) : null } catch { summary = null }
    return { ...r, summary_json: undefined, voucher_docs: summary?.voucher_docs || [], rows: summary?.rows || [] }
  })
}
