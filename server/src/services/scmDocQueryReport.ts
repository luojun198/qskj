/**
 * 单据查询表（第四份反馈 Q6 / Q7 / Q8）：采购退货、销售退货、采购发票、销售发票逐单逐行查询。
 * 带上游单号（退货→入库 / 出库单，发票→入库 / 出库单）、凭证号；退货另带「已冲减应付 / 应收」金额。
 */
import type Database from 'better-sqlite3'

export const DOC_QUERY_TYPES = ['PR', 'SR', 'RP', 'RS'] as const
export type DocQueryType = typeof DOC_QUERY_TYPES[number]

export interface DocQueryParams {
  doc_type: string
  start_date?: string
  end_date?: string
  partner_code?: string
  status?: string
  keyword?: string
  page?: number
  page_size?: number
}

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100

export function runDocQueryReport(db: Database.Database, aid: string, q: DocQueryParams) {
  if (!(DOC_QUERY_TYPES as readonly string[]).includes(q.doc_type)) throw new Error('不支持的单据类型')
  const conds = ['d.account_set_id=?', 'd.doc_type=?', "d.status<>'voided'"]
  const ps: any[] = [aid, q.doc_type]
  if (q.start_date) { conds.push('d.doc_date>=?'); ps.push(q.start_date) }
  if (q.end_date) { conds.push('d.doc_date<=?'); ps.push(q.end_date) }
  if (q.partner_code) { conds.push('d.partner_code=?'); ps.push(q.partner_code) }
  if (q.status === 'draft' || q.status === 'audited') { conds.push('d.status=?'); ps.push(q.status) }
  if (q.keyword) {
    const k = `%${String(q.keyword).trim()}%`
    conds.push('(d.doc_no LIKE ? OR l.item_code LIKE ? OR i.name LIKE ? OR pd.doc_no LIKE ? OR d.remark LIKE ?)')
    ps.push(k, k, k, k, k)
  }
  const from = `FROM scm_doc d
    JOIN scm_doc_line l ON l.doc_id=d.id
    LEFT JOIN scm_item i ON i.account_set_id=d.account_set_id AND i.code=l.item_code
    LEFT JOIN scm_partner p ON p.account_set_id=d.account_set_id AND p.code=d.partner_code
    LEFT JOIN scm_warehouse w ON w.account_set_id=d.account_set_id AND w.code=COALESCE(l.warehouse_code, d.warehouse_code)
    LEFT JOIN scm_doc_line pl ON pl.id=l.source_line_id
    LEFT JOIN scm_doc pd ON pd.id=pl.doc_id
    WHERE ${conds.join(' AND ')}`
  const agg = db.prepare(`SELECT COUNT(*) AS c, COUNT(DISTINCT d.id) AS docs, COALESCE(SUM(l.qty),0) AS qty,
      COALESCE(SUM(l.amount),0) AS amount, COALESCE(SUM(l.tax_amount),0) AS tax ${from}`).get(...ps) as any
  const size = Math.min(1000, Math.max(1, Number(q.page_size) || 100))
  const page = Math.max(1, Number(q.page) || 1)
  const rows = db.prepare(`SELECT d.id AS doc_id, d.doc_no, d.doc_date, d.status, d.partner_code, p.name AS partner_name,
      d.voucher_id, d.remark AS doc_remark, l.id AS line_id, l.seq, l.item_code, i.name AS item_name, i.spec, i.unit,
      COALESCE(l.warehouse_code, d.warehouse_code) AS warehouse_code, w.name AS warehouse_name,
      l.qty, l.price, l.amount, l.tax_amount, l.remark,
      pd.id AS src_doc_id, pd.doc_no AS src_doc_no, pd.doc_type AS src_doc_type
    ${from}
    ORDER BY d.doc_date DESC, d.doc_no DESC, l.seq
    LIMIT ? OFFSET ?`).all(...ps, size, (page - 1) * size) as any[]

  // 凭证号、退货冲减额：按本页单据批量取
  const docIds = [...new Set(rows.map(r => r.doc_id))]
  const voucherNo = new Map<string, string>()
  const offsetByDoc = new Map<string, { offset: number; open: number }>()
  if (docIds.length) {
    const ph = docIds.map(() => '?').join(',')
    try {
      for (const v of db.prepare(`SELECT d.id, v.voucher_no FROM scm_doc d JOIN vouchers v ON v.id=d.voucher_id WHERE d.id IN (${ph})`).all(...docIds) as any[]) {
        voucherNo.set(v.id, v.voucher_no)
      }
    } catch { /* 老库 / 单测无凭证表 */ }
    if (q.doc_type === 'PR' || q.doc_type === 'SR') {
      for (const o of db.prepare(`SELECT d.id, SUM(COALESCE(lg.verified_fc, lg.verified_amount)) AS offset,
          SUM(COALESCE(lg.amount_fc, lg.amount) - COALESCE(lg.verified_fc, lg.verified_amount)) AS open
        FROM scm_doc d JOIN scm_ar_ap_log lg ON lg.account_set_id=d.account_set_id AND lg.doc_type=d.doc_type AND lg.doc_no=d.doc_no
        WHERE d.id IN (${ph}) GROUP BY d.id`).all(...docIds) as any[]) {
        offsetByDoc.set(o.id, { offset: r2(o.offset), open: r2(o.open) })
      }
    }
  }
  const list = rows.map(r => ({
    ...r,
    amount: r2(r.amount), tax_amount: r2(r.tax_amount),
    amount_with_tax: r2((Number(r.amount) || 0) + (Number(r.tax_amount) || 0)),
    voucher_no: voucherNo.get(r.doc_id) || '',
    arap_offset: offsetByDoc.get(r.doc_id)?.offset ?? null,
    arap_open: offsetByDoc.get(r.doc_id)?.open ?? null,
  }))
  return {
    list,
    total: Number(agg?.c) || 0,
    summary: {
      doc_count: Number(agg?.docs) || 0,
      qty: Math.round((Number(agg?.qty) || 0) * 1000000) / 1000000,
      amount: r2(agg?.amount), tax_amount: r2(agg?.tax),
      amount_with_tax: r2((Number(agg?.amount) || 0) + (Number(agg?.tax) || 0)),
    },
  }
}
