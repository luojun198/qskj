/**
 * 制造费用 / 人工 吸收差异（生产评审 C-6，决策 2）
 *
 *  完工入库凭证按报工把人工 / 制费「吸收」进成品成本（贷 应付职工薪酬 / 制造费用），总账另按实际发生额借记这些科目；
 *  月末两者的差额就是 吸收不足（借方余额）/ 超额吸收（贷方余额），需要结转：
 *    - cogs：转主营业务成本——凭证 借 主营业务成本 / 贷 制造费用（差异为负则反向）
 *    - allocate：分摊到本期完工成品——生成结案结转单（CA，无工单）按本期各成品完工数分摊，库存按金额调整，凭证 借 存货 / 贷 制造费用
 *  口径：本期 = 凭证 year/period；SCM 吸收 = 本期已审核 PF / CA 行 overhead_cost（或 labor_cost）合计；
 *        总账发生 = 该科目（含下级）本期全部凭证借 / 贷发生额（含草稿，草稿数在结果里单列提示）。
 */
import type Database from 'better-sqlite3'

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100
export type VarianceKind = 'overhead' | 'labor'

export interface VariancePreview {
  period: string; kind: VarianceKind; account_code: string; account_name: string
  absorbed: number; gl_debit: number; gl_credit: number; gl_draft_count: number; variance: number
  finished: Array<{ item_code: string; item_name: string; warehouse_code: string; qty: number; weight: number; share: number }>
  runs: any[]
}

export function previewOverheadVariance(db: Database.Database, aid: string, period: string, kind: VarianceKind, accountCode: string): VariancePreview {
  if (!/^\d{4}-\d{2}$/.test(period)) throw new Error('期间格式应为 YYYY-MM')
  const [y, m] = period.split('-').map(Number)
  const start = `${period}-01`, end = `${period}-31`
  const col = kind === 'labor' ? 'labor_cost' : 'overhead_cost'
  const absorbed = r2(Number((db.prepare(`SELECT COALESCE(SUM(l.${col}),0) a FROM scm_doc_line l JOIN scm_doc d ON d.id=l.doc_id
    WHERE d.account_set_id=? AND d.status='audited' AND d.doc_type IN ('PF','CA') AND d.doc_date>=? AND d.doc_date<=?`).get(aid, start, end) as any)?.a) || 0)
  const acc = db.prepare('SELECT code, name FROM accounts WHERE account_set_id=? AND code=? LIMIT 1').get(aid, accountCode) as any
  const gl = db.prepare(`SELECT COALESCE(SUM(CASE WHEN e.direction='debit' THEN e.amount ELSE 0 END),0) d,
      COALESCE(SUM(CASE WHEN e.direction='credit' THEN e.amount ELSE 0 END),0) c,
      COUNT(DISTINCT CASE WHEN v.status='draft' THEN v.id END) drafts
    FROM voucher_entries e JOIN vouchers v ON v.id=e.voucher_id
    WHERE v.account_set_id=? AND v.year=? AND v.period=? AND (e.account_code=? OR e.account_code LIKE ?)`).get(aid, y, m, accountCode, `${accountCode}%`) as any
  const glDebit = r2(Number(gl?.d) || 0), glCredit = r2(Number(gl?.c) || 0)
  // 本期完工成品（PF 已审核成品行）作为分摊权重
  const fin = db.prepare(`SELECT l.item_code, i.name item_name, COALESCE(l.warehouse_code, d.warehouse_code) warehouse_code, COALESCE(SUM(l.qty),0) qty
    FROM scm_doc_line l JOIN scm_doc d ON d.id=l.doc_id LEFT JOIN scm_item i ON i.account_set_id=d.account_set_id AND i.code=l.item_code
    WHERE d.account_set_id=? AND d.status='audited' AND d.doc_type='PF' AND d.doc_date>=? AND d.doc_date<=? AND l.qty>0 AND (l.line_role IS NULL OR l.line_role='product')
    GROUP BY l.item_code, COALESCE(l.warehouse_code, d.warehouse_code)`).all(aid, start, end) as any[]
  const totalQty = fin.reduce((s, f) => s + (Number(f.qty) || 0), 0)
  const finished = fin.map(f => ({ item_code: f.item_code, item_name: f.item_name || '', warehouse_code: f.warehouse_code, qty: Number(f.qty) || 0, weight: Number(f.qty) || 0, share: totalQty > 0 ? r2((Number(f.qty) || 0) / totalQty * 100) : 0 }))
  const runs = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='scm_overhead_variance_run'").get()
    ? db.prepare('SELECT * FROM scm_overhead_variance_run WHERE account_set_id=? AND period=? AND kind=? ORDER BY run_at DESC').all(aid, period, kind) : []
  return { period, kind, account_code: accountCode, account_name: acc?.name || '', absorbed, gl_debit: glDebit, gl_credit: glCredit, gl_draft_count: Number(gl?.drafts) || 0, variance: r2(glDebit - glCredit), finished, runs }
}
