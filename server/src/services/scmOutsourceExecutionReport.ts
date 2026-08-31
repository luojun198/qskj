import type Database from 'better-sqlite3'

export interface OutsourceExecutionFilters {
  supplier_code?: string
  plan_code?: string
  item_code?: string
  start_date?: string
  end_date?: string
  status?: string
  page?: number
  page_size?: number
  sort_field?: string
  sort_order?: 'asc' | 'desc'
}

const r2 = (value: number) => Math.round((Number(value) || 0) * 100) / 100
const r6 = (value: number) => Math.round((Number(value) || 0) * 1000000) / 1000000

export function queryOutsourceExecution(db: Database.Database, accountSetId: string, filters: OutsourceExecutionFilters = {}, exportAll = false) {
  const conds = ["p.account_set_id=?", "p.plan_type='outsource'", "p.status IN ('released','closed')"]
  const params: any[] = [accountSetId]
  if (filters.supplier_code) { conds.push('p.supplier_code=?'); params.push(filters.supplier_code) }
  if (filters.plan_code) { conds.push('p.code LIKE ?'); params.push(`%${filters.plan_code}%`) }
  if (filters.item_code) { conds.push('(pp.item_code LIKE ? OR i.name LIKE ?)'); params.push(`%${filters.item_code}%`, `%${filters.item_code}%`) }
  if (filters.start_date) { conds.push("COALESCE(p.start_date,p.created_at)>=?"); params.push(filters.start_date) }
  if (filters.end_date) { conds.push("substr(COALESCE(p.start_date,p.created_at),1,10)<=?"); params.push(filters.end_date) }
  const base = db.prepare(`SELECT p.id AS plan_id,p.code AS plan_code,p.status AS plan_status,p.start_date,p.end_date,
      p.supplier_code,sp.name AS supplier_name,pp.id AS product_id,pp.item_code,i.name AS item_name,i.spec,i.unit,
      pp.plan_qty,pp.finished_qty,pp.process_fee,pp.process_tax_rate
    FROM scm_production_plan p
    JOIN scm_production_plan_product pp ON pp.plan_id=p.id AND pp.account_set_id=p.account_set_id
    LEFT JOIN scm_partner sp ON sp.account_set_id=p.account_set_id AND sp.code=p.supplier_code
    LEFT JOIN scm_item i ON i.account_set_id=pp.account_set_id AND i.code=pp.item_code
    WHERE ${conds.join(' AND ')}`).all(...params) as any[]

  const planIds = [...new Set(base.map(row => row.plan_id))]
  const issuedByPlan = new Map<string, { issueQty: number; returnQty: number; qty: number; cost: number }>()
  const balanceTextByPlan = new Map<string, string>()
  const feeByProduct = new Map<string, { fee: number; tax: number }>()
  const payableByPlan = new Map<string, { payable: number; paid: number }>()
  if (planIds.length) {
    const ph = planIds.map(() => '?').join(',')
    const issued = db.prepare(`SELECT d.plan_id,m.item_code,
        COALESCE(SUM(CASE WHEN d.doc_type='WO' AND m.direction='out' THEN m.qty ELSE 0 END),0) issue_qty,
        COALESCE(SUM(CASE WHEN d.doc_type='PJ' AND m.direction='in' THEN m.qty ELSE 0 END),0) return_qty,
        COALESCE(SUM(CASE WHEN m.direction='out' THEN m.qty ELSE -m.qty END),0) qty,
        COALESCE(SUM(CASE WHEN m.direction='out' THEN m.amount ELSE -m.amount END),0) cost
      FROM scm_stock_move m JOIN scm_doc d
        ON d.account_set_id=m.account_set_id AND d.doc_type=m.doc_type AND d.doc_no=m.doc_no
      WHERE d.account_set_id=? AND d.plan_id IN (${ph}) AND d.status='audited'
        AND d.doc_type IN ('WO','PJ') GROUP BY d.plan_id,m.item_code`).all(accountSetId, ...planIds) as any[]
    const consumed = db.prepare(`SELECT l.plan_id,l.item_code,
        COALESCE(SUM(l.qty*(1+COALESCE(l.scrap_rate,0)/100.0)*pp.finished_qty),0) qty
      FROM scm_production_plan_line l JOIN scm_production_plan_product pp ON pp.id=l.product_id
      WHERE l.account_set_id=? AND l.plan_id IN (${ph}) GROUP BY l.plan_id,l.item_code`).all(accountSetId, ...planIds) as any[]
    const consumedMap = new Map(consumed.map(row => [`${row.plan_id}|${row.item_code}`, Number(row.qty) || 0]))
    const balanceRows = new Map<string, string[]>()
    for (const row of issued) {
      const current = issuedByPlan.get(row.plan_id) || { issueQty: 0, returnQty: 0, qty: 0, cost: 0 }
      current.issueQty += Number(row.issue_qty) || 0
      current.returnQty += Number(row.return_qty) || 0
      current.qty += Number(row.qty) || 0; current.cost += Number(row.cost) || 0
      issuedByPlan.set(row.plan_id, current)
      const balance = r6((Number(row.qty) || 0) - (consumedMap.get(`${row.plan_id}|${row.item_code}`) || 0))
      const texts = balanceRows.get(row.plan_id) || []
      texts.push(`${row.item_code} ${balance}`); balanceRows.set(row.plan_id, texts)
    }
    for (const [planId, texts] of balanceRows) balanceTextByPlan.set(planId, texts.join('；'))

    const fees = db.prepare(`SELECT d.plan_id,pp.id AS product_id,
        COALESCE(SUM(l.process_fee*l.qty),0) fee,COALESCE(SUM(l.tax_amount),0) tax
      FROM scm_doc d JOIN scm_doc_line l ON l.doc_id=d.id
      JOIN scm_production_plan_product pp ON pp.plan_id=d.plan_id AND pp.item_code=l.item_code
      WHERE d.account_set_id=? AND d.plan_id IN (${ph}) AND d.doc_type='WI' AND d.status='audited'
      GROUP BY d.plan_id,pp.id`).all(accountSetId, ...planIds) as any[]
    for (const row of fees) feeByProduct.set(row.product_id, { fee: Number(row.fee) || 0, tax: Number(row.tax) || 0 })

    const payables = db.prepare(`SELECT d.plan_id,COALESCE(SUM(a.amount),0) payable,COALESCE(SUM(a.verified_amount),0) paid
      FROM scm_doc d JOIN scm_ar_ap_log a ON a.account_set_id=d.account_set_id AND a.doc_type='WI' AND a.doc_no=d.doc_no
      WHERE d.account_set_id=? AND d.plan_id IN (${ph}) AND d.doc_type='WI' AND d.status='audited'
      GROUP BY d.plan_id`).all(accountSetId, ...planIds) as any[]
    for (const row of payables) payableByPlan.set(row.plan_id, { payable: Number(row.payable) || 0, paid: Number(row.paid) || 0 })
  }

  let rows = base.map(row => {
    const planQty = Number(row.plan_qty) || 0
    const finished = Number(row.finished_qty) || 0
    const fee = feeByProduct.get(row.product_id) || { fee: 0, tax: 0 }
    const planIssue = issuedByPlan.get(row.plan_id) || { issueQty: 0, returnQty: 0, qty: 0, cost: 0 }
    const payable = payableByPlan.get(row.plan_id) || { payable: 0, paid: 0 }
    const remaining = r6(Math.max(0, planQty - finished))
    const status = finished <= 0 ? '未入库' : remaining > 0 ? '部分入库' : '已完成'
    return { ...row, plan_qty: r6(planQty), finished_qty: r6(finished), remaining_qty: remaining, execution_status: status,
      completion_rate: planQty > 0 ? r2(finished / planQty * 100) : 0,
      outsource_issue_qty: r6(planIssue.issueQty), outsource_return_qty: r6(planIssue.returnQty),
      issued_material_qty: r6(planIssue.qty), issued_material_cost: r2(planIssue.cost),
      theoretical_balance: balanceTextByPlan.get(row.plan_id) || '', fee_ex_tax: r2(fee.fee), fee_tax: r2(fee.tax),
      fee_gross: r2(fee.fee + fee.tax), payable_amount: r2(payable.payable), paid_amount: r2(payable.paid),
      outstanding_amount: r2(Math.max(0, payable.payable - payable.paid)) }
  })
  if (filters.status) rows = rows.filter(row => row.execution_status === filters.status)
  const sortField = new Set(['plan_code', 'start_date', 'supplier_code', 'item_code', 'plan_qty', 'finished_qty', 'completion_rate', 'outstanding_amount']).has(filters.sort_field || '')
    ? String(filters.sort_field) : 'plan_code'
  const direction = filters.sort_order === 'desc' ? -1 : 1
  rows.sort((a, b) => String(a[sortField] ?? '').localeCompare(String(b[sortField] ?? ''), 'zh-CN', { numeric: true }) * direction)
  const total = rows.length
  const planCount = new Set(rows.map(row => row.plan_id)).size
  const summary = { plan_count: planCount, plan_qty: r6(rows.reduce((sum, row) => sum + row.plan_qty, 0)),
    finished_qty: r6(rows.reduce((sum, row) => sum + row.finished_qty, 0)),
    remaining_qty: r6(rows.reduce((sum, row) => sum + row.remaining_qty, 0)),
    fee_gross: r2(rows.reduce((sum, row) => sum + row.fee_gross, 0)),
    outstanding_amount: r2([...new Map(rows.map(row => [row.plan_id, row.outstanding_amount])).values()].reduce((sum, value) => sum + value, 0)) }
  const page = Math.max(1, Number(filters.page) || 1)
  const pageSize = Math.min(500, Math.max(10, Number(filters.page_size) || 50))
  return { rows: exportAll ? rows : rows.slice((page - 1) * pageSize, page * pageSize), total, page, page_size: pageSize, summary }
}
