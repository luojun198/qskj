/**
 * 进销存 ACD 导入（第二批）：往来流水 wldj 中的收付款、发票登记，以及对账单 wl_dzd。
 *
 * 口径：
 *  - 收付款（wldj.lx ∈ wldj_lx 结算方式）：按「结算方式 + 单号 + 往来单位」合并成收款单 RCV / 付款单 PAY，
 *    每行关联来源单据的应收应付台账并核销；与第一批单据一样已审核、标记原系统已制证。
 *    **不写出纳日记账**——出纳以财务账套（财务 ACD / 出纳模块）为准，避免同一笔款在出纳里出现两次。
 *  - 发票登记（wldj.lx = 增值税 等非结算方式）：按「发票号 + 往来单位」合并成销售发票 RS / 采购发票 RP，
 *    明细按来源出入库单行、以开票金额 / 单据价税合计的比例折算；**不调整往来**（往来已按润衡挂账金额核对一致）。
 *  - 对账单 wl_dzd：润衡只有表头金额和说明、没有明细，导为已审核的历史对账单（不锁定任何源单）。
 */
import type Database from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'
import { verifyArAp } from '../scmArAp.js'
import { getScmBaseCurrency } from '../scmCurrency.js'
import { syncCashierAccountsFromGl } from '../cashierAccount.js'
import { type AcdRecord, type AcdTableSet, acdNum, acdStr, parseAcdDate } from './acdTables.js'
import { type DocIndex, docNoAllocator } from './documents.js'
import { type ImportContext, pushIssue } from './types.js'

const r2 = (n: number) => Math.round(n * 100) / 100
const r6 = (n: number) => Math.round(n * 1e6) / 1e6

/** 应收侧的润衡单据类别（销售出库 / 销售退货 / 对账单调整），其余（采购入库、采购退回、成品入库…）按应付侧 */
const AR_ACD_TYPES = new Set(['A', 'G', 'D'])

export interface FinanceStats {
  payments: { docs: number; lines: number; amount: number; verified: number; unverified: number }
  receipts: { docs: number; lines: number; amount: number; verified: number; unverified: number }
  invoices: { RS: number; RP: number; lines: number; amount: number }
  statements: { ar: number; ap: number }
}

/** wldj_lx：结算方式代码 → 科目、说明 */
export function settleTypes(t: AcdTableSet) {
  return new Map(t.get('wldj_lx').filter(r => r.lx).map(r => [r.lx, { account: acdStr(r.kmbm), name: acdStr(r.sm) }]))
}

/** 往来流水分三类：单据挂账（lx 空）/ 收付款（lx 是结算方式）/ 发票登记（其它 lx，如「增值税」） */
export function classifyWldj(t: AcdTableSet) {
  const settle = settleTypes(t)
  const payments: AcdRecord[] = []; const invoices: AcdRecord[] = []
  for (const w of t.get('wldj')) {
    if (!w.lx) continue
    if (settle.has(w.lx)) payments.push(w)
    else invoices.push(w)
  }
  return { settle, payments, invoices }
}

export function importFinance(db: Database.Database, t: AcdTableSet, ctx: ImportContext, index: DocIndex): FinanceStats {
  const aid = ctx.accountSetId
  const stats: FinanceStats = {
    payments: { docs: 0, lines: 0, amount: 0, verified: 0, unverified: 0 },
    receipts: { docs: 0, lines: 0, amount: 0, verified: 0, unverified: 0 },
    invoices: { RS: 0, RP: 0, lines: 0, amount: 0 },
    statements: { ar: 0, ap: 0 },
  }
  const allocNo = docNoAllocator(db, aid)
  const { settle, payments, invoices } = classifyWldj(t)
  const baseCurrency = getScmBaseCurrency(db, aid)

  const insDoc = db.prepare(`INSERT INTO scm_doc
    (id, account_set_id, doc_type, doc_no, doc_date, partner_code, operator, maker, status, auditor, audited_at, source_doc_id,
     total_qty, total_amount, total_tax, remark, payment_type, settle_account, invoice_type, invoice_no, invoice_date,
     field_values, acd_raw, external_voucher, import_batch_id)
    VALUES (?,?,?,?,?,?,?,?, 'audited',?,?,?, ?,?,?,?,?,?,?,?,?, '{}',?,1,?)`)
  const insLine = db.prepare(`INSERT INTO scm_doc_line
    (id, account_set_id, doc_id, seq, item_code, warehouse_code, qty, price, price_with_tax, amount, tax_rate, tax_amount,
     unit_cost, source_line_id, arap_source_log_id, remark, spec, unit, field_values)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,0,?,?,?,?,?,'{}')`)

  // ════════ 1. 收付款 ════════
  try { syncCashierAccountsFromGl(db, aid) } catch { /* 未建出纳账户表的旧库：仅影响结算账户提示 */ }
  const cashierAccounts = new Set<string>()
  try {
    for (const r of db.prepare('SELECT code FROM v_cashier_account WHERE account_set_id=?').all(aid) as any[]) cashierAccounts.add(r.code)
  } catch { /* 视图不存在 */ }
  const missingSettle = new Set<string>()
  const openInLog = db.prepare(`SELECT id, amount, COALESCE(verified_amount,0) AS verified FROM scm_ar_ap_log
    WHERE account_set_id=? AND doc_type=? AND doc_no=? AND direction='in' ORDER BY created_at LIMIT 1`)
  const logOpen = db.prepare('SELECT amount, COALESCE(verified_amount,0) AS verified FROM scm_ar_ap_log WHERE id=?')
  const partnerOf = db.prepare('SELECT ar_account, ap_account FROM scm_partner WHERE account_set_id=? AND code=?')
  const insLog = db.prepare(`INSERT INTO scm_ar_ap_log
    (id, account_set_id, partner_code, doc_type, doc_no, doc_date, due_date, direction, amount, ar_account, ap_account, cashier_journal_id, remark, currency, exchange_rate, amount_fc, arap_side)
    VALUES (?,?,?,?,?,?,?,'out',?,?,?,NULL,?,?,1,?,?)`)

  const unlinked: string[] = []
  const docNoHint = (w: AcdRecord) => `${w.dh}`
  const payGroups = new Map<string, AcdRecord[]>()
  for (const w of payments) {
    const k = `${w.lx}|${w.dh}|${w.khbh}`
    const arr = payGroups.get(k) || []
    arr.push(w)
    payGroups.set(k, arr)
  }
  for (const rows of payGroups.values()) {
    const h = rows[0]
    const date = parseAcdDate(h.rq)
    if (!date || !h.khbh) { pushIssue(ctx, 'warn', '收付款', `收付款 ${h.dh} 缺日期或往来单位，已跳过`); continue }
    // 付款：借方（jf）记供应商；收款：贷方（df）记客户
    const jf = rows.reduce((s, r) => s + acdNum(r.jf), 0)
    const df = rows.reduce((s, r) => s + acdNum(r.df), 0)
    const isPay = Math.abs(jf) >= Math.abs(df)
    const type = isPay ? 'PAY' : 'RCV'
    const side: 'ar' | 'ap' = isPay ? 'ap' : 'ar'
    const st = settle.get(h.lx)
    const account = st?.account || null
    if (account && cashierAccounts.size && !cashierAccounts.has(account)) missingSettle.add(account)
    const docNo = allocNo(type, h.dh || `${date.replace(/-/g, '')}${h.xh}`, 'SK')
    const docId = uuidv4()
    const partner = partnerOf.get(aid, h.khbh) as any
    const lines: Array<{ amount: number; srcLog: string | null; srcDocId: string | null; remark: string }> = []
    for (const r of rows) {
      const amt = r2(isPay ? acdNum(r.jf) - acdNum(r.df) : acdNum(r.df) - acdNum(r.jf))
      if (amt <= 0) {
        pushIssue(ctx, 'warn', '收付款', `${isPay ? '付款' : '收款'} ${h.dh} 有一行金额为 ${-amt}（退款 / 冲回），本系统收付款单不支持负数，已跳过该行`)
        continue
      }
      const src = r.pjlb && r.pjdh ? index.get(`${r.pjlb}|${r.pjdh}`) : undefined
      const log = src ? openInLog.get(aid, src.type, src.doc_no) as any : null
      if (r.pjdh && !src) unlinked.push(`${docNoHint(h)} ${r2(amt)}（源单 ${r.pjdh} 在润衡已不存在）`)
      else if (src && !log) unlinked.push(`${docNoHint(h)} ${r2(amt)}（源单 ${src.doc_no} 没有挂${isPay ? '应付' : '应收'}）`)
      lines.push({ amount: amt, srcLog: log?.id ?? null, srcDocId: src?.id ?? null,
        remark: [acdStr(r.zy), src ? `${isPay ? '付' : '收'} ${src.doc_no}` : (r.pjdh ? `润衡单据 ${r.pjdh}` : null)].filter(Boolean).join('；') })
    }
    if (!lines.length) continue
    const total = r2(lines.reduce((s, l) => s + l.amount, 0))
    const srcDocs = [...new Set(lines.map(l => l.srcDocId).filter(Boolean))]
    insDoc.run(docId, aid, type, docNo, date, h.khbh, null, ctx.operator, ctx.operator, `${date} 00:00:00`, srcDocs.length === 1 ? srcDocs[0] : null,
      lines.length, total, 0, st?.name ? `${st.name}${acdStr(h.zy) ? '；' + h.zy : ''}` : acdStr(h.zy),
      account?.startsWith('1001') ? 'cash' : 'transfer', account, null, null, null,
      JSON.stringify(rows), ctx.batchId)
    const bucket = isPay ? stats.payments : stats.receipts
    bucket.docs++
    const matches: Array<{ in_log_id: string; out_log_id: string; amount: number }> = []
    lines.forEach((l, i) => {
      insLine.run(uuidv4(), aid, docId, i + 1, null, null, 1, l.amount, l.amount, l.amount, 0, 0, null, l.srcLog, l.remark, null, null)
      const outId = uuidv4()
      insLog.run(outId, aid, h.khbh, type, docNo, date, date, l.amount,
        side === 'ar' ? (partner?.ar_account || '1131') : null, side === 'ap' ? (partner?.ap_account || '2121') : null,
        l.remark, baseCurrency, l.amount, side)
      bucket.lines++
      bucket.amount = r2(bucket.amount + l.amount)
      if (l.srcLog) {
        const row = logOpen.get(l.srcLog) as any
        // 同一张付款单里多行指向同一源单时，扣掉本单前面行已占用的额度
        const used = matches.filter(m => m.in_log_id === l.srcLog).reduce((a, m) => a + m.amount, 0)
        const can = r2(Math.min(l.amount, (Number(row?.amount) || 0) - (Number(row?.verified) || 0) - used))
        if (can > 0) matches.push({ in_log_id: l.srcLog, out_log_id: outId, amount: can })
        if (can < l.amount - 0.005) bucket.unverified = r2(bucket.unverified + l.amount - Math.max(can, 0))
      } else {
        bucket.unverified = r2(bucket.unverified + l.amount)
      }
    })
    if (matches.length) {
      try {
        verifyArAp(db, aid, { partner_code: h.khbh, verify_date: date, operator: ctx.operator, matches })
        bucket.verified = r2(bucket.verified + matches.reduce((s, m) => s + m.amount, 0))
      } catch (e: any) {
        bucket.unverified = r2(bucket.unverified + matches.reduce((s, m) => s + m.amount, 0))
        pushIssue(ctx, 'warn', '收付款', `${isPay ? '付款' : '收款'}单 ${docNo} 自动核销失败（${e?.message || e}），款项已入账、未核销，可在「往来核销」中手工核销`)
      }
    }
  }
  if (unlinked.length) {
    pushIssue(ctx, 'info', '收付款', `${unlinked.length} 笔收付款没有可核销的源单，按未核销款项挂在往来单位上（与润衡往来余额一致）：${unlinked.slice(0, 20).join('、')}${unlinked.length > 20 ? ' 等' : ''}`)
  }
  if (missingSettle.size) {
    pushIssue(ctx, 'warn', '收付款', `结算科目 ${[...missingSettle].join('、')} 在本账套「出纳账户」中不存在，收付款单的结算账户只记了科目编码，请在出纳账户档案中补建`)
  }
  if (stats.payments.docs || stats.receipts.docs) {
    pushIssue(ctx, 'info', '收付款', '收付款单未写出纳日记账（出纳以财务账套为准），也不再生成凭证')
  }

  // ════════ 2. 发票 ════════
  const lineRows = db.prepare('SELECT id, seq, item_code, qty, price, price_with_tax, amount, tax_rate, tax_amount, spec, unit FROM scm_doc_line WHERE doc_id=? ORDER BY seq')
  const invGroups = new Map<string, AcdRecord[]>()
  for (const w of invoices) {
    const type = AR_ACD_TYPES.has(w.pjlb) ? 'RS' : 'RP'
    const k = `${type}|${w.lx}|${w.dh}|${w.khbh}`
    const arr = invGroups.get(k) || []
    arr.push(w)
    invGroups.set(k, arr)
  }
  for (const [key, rows] of invGroups) {
    const type = key.split('|')[0] as 'RS' | 'RP'
    const h = rows[0]
    const date = parseAcdDate(h.rq)
    if (!date || !h.khbh) { pushIssue(ctx, 'warn', '发票', `发票 ${h.dh} 缺日期或往来单位，已跳过`); continue }
    type L = { item_code: string | null; qty: number; price: number; price_with_tax: number; amount: number; tax_rate: number; tax_amount: number; source_line_id: string | null; remark: string | null; spec: string | null; unit: string | null }
    const lines: L[] = []
    let zero = 0
    for (const r of rows) {
      const fp = r2(acdNum(r.fpjf) + acdNum(r.fpdf))
      if (Math.abs(fp) < 0.005) { zero++; continue }
      const src = r.pjlb && r.pjdh ? index.get(`${r.pjlb}|${r.pjdh}`) : undefined
      const srcLines = src ? (lineRows.all(src.id) as any[]) : []
      const gross = r2(srcLines.reduce((s, l) => s + (Number(l.amount) || 0) + (Number(l.tax_amount) || 0), 0))
      if (!src || !srcLines.length || Math.abs(gross) < 0.005) {
        lines.push({ item_code: null, qty: 0, price: 0, price_with_tax: 0, amount: fp, tax_rate: 0, tax_amount: 0, source_line_id: null,
          remark: `润衡单据 ${r.pjlb || ''} ${r.pjdh || ''} 开票 ${fp}`.trim(), spec: null, unit: null })
        continue
      }
      // 按开票金额 / 单据价税合计折算到各行，尾差落在最后一行
      const ratio = fp / gross
      let acc = 0
      srcLines.forEach((l, i) => {
        const last = i === srcLines.length - 1
        const lineGross = last ? r2(fp - acc) : r2(((Number(l.amount) || 0) + (Number(l.tax_amount) || 0)) * ratio)
        acc = r2(acc + lineGross)
        const rate = Number(l.tax_rate) || 0
        const amount = rate > 0 ? r2(lineGross / (1 + rate / 100)) : lineGross
        const qty = r6((Number(l.qty) || 0) * ratio)
        lines.push({ item_code: l.item_code, qty, price: Number(l.price) || 0, price_with_tax: Number(l.price_with_tax) || 0,
          amount, tax_rate: rate, tax_amount: r2(lineGross - amount), source_line_id: l.id,
          remark: Math.abs(ratio - 1) > 1e-6 ? `${src.doc_no} 部分开票（${r2(ratio * 100)}%）` : src.doc_no, spec: l.spec, unit: l.unit })
      })
    }
    if (zero) pushIssue(ctx, 'info', '发票', `发票 ${h.dh}（${h.khbh}）有 ${zero} 行开票金额为 0，未导入这些行`)
    if (!lines.length) continue
    const fullNo = acdStr(h.zy) && /^\d{8,}$/.test(String(h.zy)) ? String(h.zy) : acdStr(h.dh)
    const remark = acdStr(h.zy) && !/^\d{8,}$/.test(String(h.zy)) ? acdStr(h.zy) : null
    const docId = uuidv4()
    const docNo = allocNo(type, h.dh || fullNo || date.replace(/-/g, ''), 'FP')
    const total = r2(lines.reduce((s, l) => s + l.amount, 0))
    const tax = r2(lines.reduce((s, l) => s + l.tax_amount, 0))
    insDoc.run(docId, aid, type, docNo, date, h.khbh, null, ctx.operator, ctx.operator, `${date} 00:00:00`,
      // 不写表头 source_doc_id：反审核发票时会按它把来源单往来「还原」成单据金额，破坏已按润衡核对的挂账；来源只记在明细行上
      null, r6(lines.reduce((s, l) => s + l.qty, 0)), total, tax, remark,
      null, null, `${h.lx}发票`, fullNo, date, JSON.stringify(rows), ctx.batchId)
    lines.forEach((l, i) => insLine.run(uuidv4(), aid, docId, i + 1, l.item_code, null, l.qty, l.price, l.price_with_tax, l.amount,
      l.tax_rate, l.tax_amount, l.source_line_id, null, l.remark, l.spec, l.unit))
    const rates = [...new Set(lines.map(l => l.tax_rate).filter(r => r > 0))]
    if (rates.length === 1) db.prepare('UPDATE scm_doc SET tax_rate=? WHERE id=?').run(rates[0], docId)
    stats.invoices[type]++
    stats.invoices.lines += lines.length
    stats.invoices.amount = r2(stats.invoices.amount + total + tax)
  }
  if (stats.invoices.RS || stats.invoices.RP) {
    pushIssue(ctx, 'info', '发票', '发票按润衡开票金额生成、关联来源单据行；往来挂账不随发票调整（已按润衡挂账金额核对一致）')
  }

  // ════════ 3. 对账单 ════════
  const usedStmt = new Set((db.prepare('SELECT stmt_no FROM scm_statement WHERE account_set_id=?').all(aid) as any[]).map(r => r.stmt_no))
  const insStmt = db.prepare(`INSERT INTO scm_statement
    (id, account_set_id, stmt_no, stmt_date, direction, partner_code, start_date, end_date, doc_amount, payment_amount, net_amount,
     ledger_balance, status, remark, maker, auditor, audited_at, created_at)
    VALUES (?,?,?,?,?,?,NULL,?,?,0,?,NULL,'audited',?,?,?,?, datetime('now','localtime'))`)
  for (const r of t.get('wl_dzd')) {
    const date = parseAcdDate(r.dzrq)
    if (!date || !r.khbh || !r.dzdbh) continue
    const direction = r.lx === 'cg' ? 'ap' : 'ar'
    let no = r.dzdbh
    if (usedStmt.has(no)) no = `${r.dzdbh}-${direction === 'ap' ? 'CG' : 'XS'}`
    let i = 1
    while (usedStmt.has(no)) no = `${r.dzdbh}-${direction === 'ap' ? 'CG' : 'XS'}${++i}`
    usedStmt.add(no)
    const amount = r2(acdNum(r.je0))
    const note = [r.sm1, r.sm2, r.sm3, r.sm4].map(acdStr).filter(Boolean).join('；')
    insStmt.run(uuidv4(), aid, no, date, direction, r.khbh, date, amount, amount,
      `润衡历史对账单（仅金额，无明细）${note ? '：' + note : ''}`, acdStr(r.lrr) || ctx.operator, acdStr(r.lrr) || ctx.operator, `${date} 00:00:00`)
    stats.statements[direction]++
  }
  return stats
}
