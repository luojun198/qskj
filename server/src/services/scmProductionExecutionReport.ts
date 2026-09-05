/**
 * 生产执行及在制结存表
 *
 * 委外一直有「委外执行及结存表」，自制生产却只能一张一张点开工单看在制，
 * 车间主管想知道「哪些工单料领超了 / 哪些工单在制挂着下不去」只能靠人工翻。
 * 本表按 (工单, 成品) 出行，把领料、报废、完工、报工与在制余额摊在一张表上。
 *
 * 口径与 `routes/scmDoc.ts` 的 `getPlanCostSummary` 完全一致：
 *   已领料成本 = Σ(PL/PB 出) − Σ(PJ 入)
 *   每件料成本 = Σ(工单用料行 用量×(1+损耗率) × 该料领用单价)
 *   已消耗    = (已完工 + 已报废) × 每件料成本
 *   料在制    = 已领料成本 − Σ已消耗
 *   人工/制费在制 = 已审核报工累计 − 各成品已吸收
 */
import type Database from 'better-sqlite3'

export interface ProductionExecutionFilters {
  plan_code?: string
  item_code?: string
  dept_code?: string
  start_date?: string
  end_date?: string
  status?: string
  only_wip?: string | boolean
  page?: number
  page_size?: number
  sort_field?: string
  sort_order?: 'asc' | 'desc'
}

const r2 = (value: number) => Math.round((Number(value) || 0) * 100) / 100
const r6 = (value: number) => Math.round((Number(value) || 0) * 1000000) / 1000000

const SORTABLE = new Set([
  'plan_code', 'start_date', 'item_code', 'plan_qty', 'finished_qty',
  'scrap_qty', 'completion_rate', 'material_wip', 'total_wip',
])

export function queryProductionExecution(
  db: Database.Database,
  accountSetId: string,
  filters: ProductionExecutionFilters = {},
  exportAll = false,
) {
  const conds = ['p.account_set_id=?', "p.plan_type='self'", "p.status IN ('released','closed')"]
  const params: any[] = [accountSetId]
  if (filters.plan_code) { conds.push('p.code LIKE ?'); params.push(`%${filters.plan_code}%`) }
  if (filters.dept_code) { conds.push('p.dept_code=?'); params.push(filters.dept_code) }
  if (filters.item_code) { conds.push('(pp.item_code LIKE ? OR i.name LIKE ?)'); params.push(`%${filters.item_code}%`, `%${filters.item_code}%`) }
  if (filters.start_date) { conds.push('COALESCE(p.start_date,p.created_at)>=?'); params.push(filters.start_date) }
  if (filters.end_date) { conds.push('substr(COALESCE(p.start_date,p.created_at),1,10)<=?'); params.push(filters.end_date) }

  const base = db.prepare(`SELECT p.id AS plan_id,p.code AS plan_code,p.status AS plan_status,
      p.start_date,p.end_date,p.dept_code,p.yl_warehouse,
      pp.id AS product_id,pp.item_code,i.name AS item_name,i.spec,i.unit,
      COALESCE(pp.plan_qty,0) AS plan_qty,COALESCE(pp.finished_qty,0) AS finished_qty,
      COALESCE(pp.scrap_qty,0) AS scrap_qty,
      COALESCE(pp.labor_absorbed,0) AS labor_absorbed,COALESCE(pp.overhead_absorbed,0) AS overhead_absorbed
    FROM scm_production_plan p
    JOIN scm_production_plan_product pp ON pp.plan_id=p.id AND pp.account_set_id=p.account_set_id
    LEFT JOIN scm_item i ON i.account_set_id=pp.account_set_id AND i.code=pp.item_code
    WHERE ${conds.join(' AND ')}`).all(...params) as any[]

  const planIds = [...new Set(base.map(row => row.plan_id))]
  /** plan_id → 已领料数量/金额（PL/PB 出 − PJ 入） */
  const issuedByPlan = new Map<string, { qty: number; cost: number }>()
  /** `plan_id|item_code` → 领用单价（净额 ÷ 净量），与 getMaterialIssueUnitCost 同口径 */
  const issueUnitCost = new Map<string, number>()
  /** product_id → 每件料成本（BOM 上卷） */
  const matUnitByProduct = new Map<string, number>()
  /** plan_id → 已审核报工的人工/制费与合格数 */
  const reportByPlan = new Map<string, { labor: number; overhead: number; goodQty: number; scrapQty: number }>()

  if (planIds.length) {
    const ph = planIds.map(() => '?').join(',')
    const issued = db.prepare(`SELECT d.plan_id,m.item_code,
        COALESCE(SUM(CASE WHEN m.direction='out' THEN m.qty ELSE -m.qty END),0) qty,
        COALESCE(SUM(CASE WHEN m.direction='out' THEN m.amount ELSE -m.amount END),0) cost
      FROM scm_stock_move m JOIN scm_doc d
        ON d.account_set_id=m.account_set_id AND d.doc_type=m.doc_type AND d.doc_no=m.doc_no
      WHERE d.account_set_id=? AND d.plan_id IN (${ph}) AND d.status='audited'
        AND d.doc_type IN ('PL','PB','PJ') GROUP BY d.plan_id,m.item_code`).all(accountSetId, ...planIds) as any[]
    for (const row of issued) {
      const qty = Number(row.qty) || 0
      const cost = Number(row.cost) || 0
      const cur = issuedByPlan.get(row.plan_id) || { qty: 0, cost: 0 }
      cur.qty += qty; cur.cost += cost
      issuedByPlan.set(row.plan_id, cur)
      issueUnitCost.set(`${row.plan_id}|${row.item_code}`, qty > 0 ? cost / qty : 0)
    }

    // 每件料成本：工单用料行 用量×(1+损耗率) × 该料领用单价
    const planLines = db.prepare(`SELECT plan_id,product_id,item_code,COALESCE(qty,0) AS qty,COALESCE(scrap_rate,0) AS scrap_rate
      FROM scm_production_plan_line WHERE account_set_id=? AND plan_id IN (${ph})`).all(accountSetId, ...planIds) as any[]
    for (const line of planLines) {
      const per = (Number(line.qty) || 0) * (1 + (Number(line.scrap_rate) || 0) / 100)
      const unit = issueUnitCost.get(`${line.plan_id}|${line.item_code}`) || 0
      matUnitByProduct.set(line.product_id, (matUnitByProduct.get(line.product_id) || 0) + per * unit)
    }

    const reports = db.prepare(`SELECT plan_id,
        COALESCE(SUM(labor_amount),0) labor,COALESCE(SUM(overhead_amount),0) overhead,
        COALESCE(SUM(qty),0) good_qty,COALESCE(SUM(scrap_qty),0) scrap_qty
      FROM scm_work_report WHERE account_set_id=? AND plan_id IN (${ph}) AND status='audited'
      GROUP BY plan_id`).all(accountSetId, ...planIds) as any[]
    for (const row of reports) {
      reportByPlan.set(row.plan_id, {
        labor: Number(row.labor) || 0, overhead: Number(row.overhead) || 0,
        goodQty: Number(row.good_qty) || 0, scrapQty: Number(row.scrap_qty) || 0,
      })
    }
  }

  // 各工单的已消耗合计（Σ 各成品 (完工+报废)×每件料成本）与已吸收人工制费合计
  const consumedByPlan = new Map<string, number>()
  const absorbedByPlan = new Map<string, number>()
  for (const row of base) {
    const matUnit = r2(matUnitByProduct.get(row.product_id) || 0)
    const consumed = r2(((Number(row.finished_qty) || 0) + (Number(row.scrap_qty) || 0)) * matUnit)
    consumedByPlan.set(row.plan_id, r2((consumedByPlan.get(row.plan_id) || 0) + consumed))
    absorbedByPlan.set(row.plan_id, r2((absorbedByPlan.get(row.plan_id) || 0)
      + (Number(row.labor_absorbed) || 0) + (Number(row.overhead_absorbed) || 0)))
  }

  let rows = base.map(row => {
    const planQty = Number(row.plan_qty) || 0
    const finished = Number(row.finished_qty) || 0
    const scrapped = Number(row.scrap_qty) || 0
    const matUnit = r2(matUnitByProduct.get(row.product_id) || 0)
    const consumed = r2((finished + scrapped) * matUnit)
    const remaining = r6(Math.max(0, planQty - finished - scrapped))
    const issue = issuedByPlan.get(row.plan_id) || { qty: 0, cost: 0 }
    const report = reportByPlan.get(row.plan_id) || { labor: 0, overhead: 0, goodQty: 0, scrapQty: 0 }
    // 在制是工单级口径（料池化、人工制费按工单归集），同一工单的多个成品行重复展示同一个数
    const materialWip = r2(issue.cost - (consumedByPlan.get(row.plan_id) || 0))
    const laborWip = r2((report.labor + report.overhead) - (absorbedByPlan.get(row.plan_id) || 0))
    const status = finished + scrapped <= 0 ? '未完工' : remaining > 0 ? '部分完工' : '已完工'
    return {
      plan_id: row.plan_id, plan_code: row.plan_code, plan_status: row.plan_status,
      start_date: row.start_date, end_date: row.end_date, dept_code: row.dept_code,
      product_id: row.product_id, item_code: row.item_code, item_name: row.item_name,
      spec: row.spec, unit: row.unit,
      plan_qty: r6(planQty), finished_qty: r6(finished), scrap_qty: r6(scrapped),
      remaining_qty: remaining, execution_status: status,
      completion_rate: planQty > 0 ? r2((finished + scrapped) / planQty * 100) : 0,
      scrap_rate: finished + scrapped > 0 ? r2(scrapped / (finished + scrapped) * 100) : 0,
      issued_material_qty: r6(issue.qty), issued_material_cost: r2(issue.cost),
      mat_unit_cost: matUnit, consumed_cost: consumed,
      material_wip: materialWip,
      reported_good_qty: r6(report.goodQty), reported_scrap_qty: r6(report.scrapQty),
      labor_total: r2(report.labor), overhead_total: r2(report.overhead),
      labor_absorbed: r2(Number(row.labor_absorbed) || 0), overhead_absorbed: r2(Number(row.overhead_absorbed) || 0),
      labor_wip: laborWip,
      total_wip: r2(materialWip + laborWip),
    }
  })

  if (filters.status) rows = rows.filter(row => row.execution_status === filters.status)
  if (filters.only_wip === true || filters.only_wip === '1' || filters.only_wip === 'true') {
    rows = rows.filter(row => Math.abs(row.total_wip) > 0.005)
  }

  const sortField = SORTABLE.has(filters.sort_field || '') ? String(filters.sort_field) : 'plan_code'
  const direction = filters.sort_order === 'desc' ? -1 : 1
  rows.sort((a: any, b: any) =>
    String(a[sortField] ?? '').localeCompare(String(b[sortField] ?? ''), 'zh-CN', { numeric: true }) * direction)

  const total = rows.length
  // 在制是工单级数，汇总时按工单去重，避免多成品工单被重复累加
  const wipByPlan = new Map(rows.map(row => [row.plan_id, { m: row.material_wip, l: row.labor_wip }]))
  const issuedByPlanUnique = new Map(rows.map(row => [row.plan_id, row.issued_material_cost]))
  const summary = {
    plan_count: wipByPlan.size,
    plan_qty: r6(rows.reduce((sum, row) => sum + row.plan_qty, 0)),
    finished_qty: r6(rows.reduce((sum, row) => sum + row.finished_qty, 0)),
    scrap_qty: r6(rows.reduce((sum, row) => sum + row.scrap_qty, 0)),
    remaining_qty: r6(rows.reduce((sum, row) => sum + row.remaining_qty, 0)),
    issued_material_cost: r2([...issuedByPlanUnique.values()].reduce((sum, value) => sum + value, 0)),
    material_wip: r2([...wipByPlan.values()].reduce((sum, v) => sum + v.m, 0)),
    labor_wip: r2([...wipByPlan.values()].reduce((sum, v) => sum + v.l, 0)),
    total_wip: r2([...wipByPlan.values()].reduce((sum, v) => sum + v.m + v.l, 0)),
  }

  const page = Math.max(1, Number(filters.page) || 1)
  const pageSize = Math.min(500, Math.max(10, Number(filters.page_size) || 50))
  return {
    rows: exportAll ? rows : rows.slice((page - 1) * pageSize, page * pageSize),
    total, page, page_size: pageSize, summary,
  }
}
