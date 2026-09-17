/**
 * 固定资产报表查询服务
 *
 * 提供折旧汇总表、折旧分配表、资产分类汇总表、资产明细账等报表数据查询
 */
import type { Database } from 'better-sqlite3'

// ── 类型定义 ──────────────────────────────────────────────

export interface DeprSummaryRow {
  group_code: string | null
  group_name: string | null
  asset_count: number
  total_original: number
  month_depr: number
  total_accum_depr: number
  total_net_value: number
}

export interface DeprAllocationRow {
  expense_account: string
  expense_account_name: string
  asset_count: number
  total_depr: number
}

export interface CategorySummaryRow {
  category_code: string | null
  category_name: string | null
  asset_count: number
  total_original: number
  total_accum_depr: number
  total_net_value: number
}

export interface AssetLedgerEntry {
  date: string
  type: 'acquire' | 'depr' | 'change' | 'disposal'
  summary: string
  original_change: number    // 原值变动
  original_after: number     // 变动后原值
  depr_amount: number        // 本期折旧
  accum_depr_after: number   // 变动后累计折旧
  net_value_after: number    // 变动后净值
  voucher_no?: string        // 关联凭证号
  /** 内部使用：变动行的 change_kind，用于余额重算时区分原值类/减值类变动 */
  change_kind?: string
}

export interface AssetLedgerResult {
  asset_no: string
  asset_name: string
  category_name: string | null
  dept_name: string | null
  depr_method: string | null
  use_months: number | null
  start_depr_date: string | null
  acquire_date: string | null
  original_value: number
  salvage_value: number
  current_accum_depr: number
  current_net_value: number
  depr_months_done: number
  entries: AssetLedgerEntry[]
}

// ── 折旧汇总表 ──────────────────────────────────────────────

export function queryDeprSummary(params: {
  db: Database
  accountSetId: string
  year: number
  month: number
  groupBy: 'category' | 'dept'
}): DeprSummaryRow[] {
  const { db, accountSetId, year, month, groupBy } = params

  if (groupBy === 'category') {
    return db.prepare(`
      SELECT
        fa.category_code AS group_code,
        fc.name AS group_name,
        COUNT(*) AS asset_count,
        SUM(fa.original_value) AS total_original,
        SUM(fd.month_depr) AS month_depr,
        SUM(fd.accum_depr) AS total_accum_depr,
        -- AS-P1-10：净值 = 该期期末原值口径 − 该期期末累计折旧（fd.accum_depr）− 减值，
        -- 原先 SUM(fa.net_value) 取的是「今天的净值」，查历史月份时与累折列口径互相矛盾
        SUM(fa.original_value - fd.accum_depr - COALESCE(fa.impairment_amount, 0)) AS total_net_value
      FROM fixed_asset_depr fd
      JOIN fixed_asset fa ON fa.account_set_id = fd.account_set_id AND fa.asset_no = fd.asset_no
      LEFT JOIN fixed_asset_category fc ON fc.account_set_id = fa.account_set_id AND fc.code = fa.category_code
      WHERE fd.account_set_id = ? AND fd.year = ? AND fd.month = ?
      GROUP BY fa.category_code
      ORDER BY fa.category_code
    `).all(accountSetId, year, month) as DeprSummaryRow[]
  }

  // groupBy === 'dept'
  return db.prepare(`
    SELECT
      fa.dept_code AS group_code,
      fd2.name AS group_name,
      COUNT(*) AS asset_count,
      SUM(fa.original_value) AS total_original,
      SUM(fd.month_depr) AS month_depr,
      SUM(fd.accum_depr) AS total_accum_depr,
      -- AS-P1-10：同上，净值按该期期末累折推算
      SUM(fa.original_value - fd.accum_depr - COALESCE(fa.impairment_amount, 0)) AS total_net_value
    FROM fixed_asset_depr fd
    JOIN fixed_asset fa ON fa.account_set_id = fd.account_set_id AND fa.asset_no = fd.asset_no
    LEFT JOIN fixed_asset_dept fd2 ON fd2.account_set_id = fa.account_set_id AND fd2.code = fa.dept_code
    WHERE fd.account_set_id = ? AND fd.year = ? AND fd.month = ?
    GROUP BY fa.dept_code
    ORDER BY fa.dept_code
  `).all(accountSetId, year, month) as DeprSummaryRow[]
}

// ── 折旧明细（汇总表下钻） ──────────────────────────────────

export interface DeprDetailRow {
  asset_no: string
  asset_name: string
  category_name: string | null
  dept_name: string | null
  depr_method: string | null
  original_value: number
  month_depr: number
  accum_depr: number
  net_value: number
  expense_account: string | null
}

export function queryDeprDetail(params: {
  db: Database
  accountSetId: string
  year: number
  month: number
  groupBy: 'category' | 'dept'
  groupCode: string
}): DeprDetailRow[] {
  const { db, accountSetId, year, month, groupBy, groupCode } = params

  const whereField = groupBy === 'category' ? 'fa.category_code' : 'fa.dept_code'

  return db.prepare(`
    SELECT
      fa.asset_no,
      fa.asset_name,
      fc.name AS category_name,
      fd2.name AS dept_name,
      fa.depr_method,
      fa.original_value,
      fd.month_depr,
      fd.accum_depr,
      -- AS-P1-10：净值按该期期末累折推算，与汇总表口径一致
      fa.original_value - fd.accum_depr - COALESCE(fa.impairment_amount, 0) AS net_value,
      fp.expense_account
    FROM fixed_asset_depr fd
    JOIN fixed_asset fa ON fa.account_set_id = fd.account_set_id AND fa.asset_no = fd.asset_no
    LEFT JOIN fixed_asset_category fc ON fc.account_set_id = fa.account_set_id AND fc.code = fa.category_code
    LEFT JOIN fixed_asset_dept fd2 ON fd2.account_set_id = fa.account_set_id AND fd2.code = fa.dept_code
    LEFT JOIN fixed_asset_purpose fp ON fp.account_set_id = fa.account_set_id AND fp.code = fa.purpose_code
    WHERE fd.account_set_id = ? AND fd.year = ? AND fd.month = ? AND ${whereField} = ?
    ORDER BY fa.asset_no
  `).all(accountSetId, year, month, groupCode) as DeprDetailRow[]
}

// ── 折旧分配表（按费用科目汇总） ──────────────────────────────

export function queryDeprAllocation(params: {
  db: Database
  accountSetId: string
  year: number
  month: number
}): DeprAllocationRow[] {
  const { db, accountSetId, year, month } = params

  // 折旧计提表中的 expense_account 实际来自目的表，需要查固定_asset_depr 表获取 purpose_code
  // 然后通过 purpose 获取 expense_account
  return db.prepare(`
    SELECT
      COALESCE(fp.expense_account, '未设置') AS expense_account,
      NULL AS expense_account_name,
      COUNT(*) AS asset_count,
      SUM(fd.month_depr) AS total_depr
    FROM fixed_asset_depr fd
    JOIN fixed_asset fa ON fa.account_set_id = fd.account_set_id AND fa.asset_no = fd.asset_no
    LEFT JOIN fixed_asset_purpose fp ON fp.account_set_id = fa.account_set_id AND fp.code = fa.purpose_code
    WHERE fd.account_set_id = ? AND fd.year = ? AND fd.month = ?
    GROUP BY fp.expense_account
    ORDER BY fp.expense_account
  `).all(accountSetId, year, month) as DeprAllocationRow[]
}

// ── 折旧分配明细（下钻某个费用科目） ──────────────────────────

export interface DeprAllocationDetailRow {
  asset_no: string
  asset_name: string
  category_name: string | null
  dept_name: string | null
  original_value: number
  month_depr: number
  accum_depr: number
  net_value: number
}

export function queryDeprAllocationDetail(params: {
  db: Database
  accountSetId: string
  year: number
  month: number
  expenseAccount: string
}): DeprAllocationDetailRow[] {
  const { db, accountSetId, year, month, expenseAccount } = params

  return db.prepare(`
    SELECT
      fa.asset_no,
      fa.asset_name,
      fc.name AS category_name,
      fd2.name AS dept_name,
      fa.original_value,
      fd.month_depr,
      fd.accum_depr,
      fa.net_value
    FROM fixed_asset_depr fd
    JOIN fixed_asset fa ON fa.account_set_id = fd.account_set_id AND fa.asset_no = fd.asset_no
    LEFT JOIN fixed_asset_purpose fp ON fp.account_set_id = fa.account_set_id AND fp.code = fa.purpose_code
    LEFT JOIN fixed_asset_category fc ON fc.account_set_id = fa.account_set_id AND fc.code = fa.category_code
    LEFT JOIN fixed_asset_dept fd2 ON fd2.account_set_id = fa.account_set_id AND fd2.code = fa.dept_code
    WHERE fd.account_set_id = ?
      AND fd.year = ? AND fd.month = ?
      AND COALESCE(fp.expense_account, '未设置') = ?
    ORDER BY fa.asset_no
  `).all(accountSetId, year, month, expenseAccount) as DeprAllocationDetailRow[]
}

// ── 资产分类汇总表 ──────────────────────────────────────────

export function queryCategorySummary(params: {
  db: Database
  accountSetId: string
  statusCode?: string
}): CategorySummaryRow[] {
  const { db, accountSetId, statusCode } = params

  const conds = ['fa.account_set_id = ?']
  const args: any[] = [accountSetId]
  if (statusCode) {
    conds.push('fa.status_code = ?')
    args.push(statusCode)
  }

  return db.prepare(`
    SELECT
      fa.category_code,
      fc.name AS category_name,
      COUNT(*) AS asset_count,
      SUM(fa.original_value) AS total_original,
      SUM(fa.accum_depr) AS total_accum_depr,
      SUM(fa.net_value) AS total_net_value
    FROM fixed_asset fa
    LEFT JOIN fixed_asset_category fc ON fc.account_set_id = fa.account_set_id AND fc.code = fa.category_code
    WHERE ${conds.join(' AND ')}
    GROUP BY fa.category_code
    ORDER BY fa.category_code
  `).all(...args) as CategorySummaryRow[]
}

// ── 部门资产汇总表 ──────────────────────────────────────────

export interface DeptSummaryRow {
  dept_code: string | null
  dept_name: string | null
  asset_count: number
  total_original: number
  total_accum_depr: number
  total_net_value: number
}

export function queryDeptSummary(params: {
  db: Database
  accountSetId: string
  statusCode?: string
}): DeptSummaryRow[] {
  const { db, accountSetId, statusCode } = params

  const conds = ['fa.account_set_id = ?']
  const args: any[] = [accountSetId]
  if (statusCode) {
    conds.push('fa.status_code = ?')
    args.push(statusCode)
  }

  return db.prepare(`
    SELECT
      fa.dept_code,
      fd2.name AS dept_name,
      COUNT(*) AS asset_count,
      SUM(fa.original_value) AS total_original,
      SUM(fa.accum_depr) AS total_accum_depr,
      SUM(fa.net_value) AS total_net_value
    FROM fixed_asset fa
    LEFT JOIN fixed_asset_dept fd2 ON fd2.account_set_id = fa.account_set_id AND fd2.code = fa.dept_code
    WHERE ${conds.join(' AND ')}
    GROUP BY fa.dept_code
    ORDER BY fa.dept_code
  `).all(...args) as DeptSummaryRow[]
}

// ── 资产明细账（单资产完整生命周期） ──────────────────────────

export function queryAssetLedger(params: {
  db: Database
  accountSetId: string
  assetId: string
}): AssetLedgerResult | null {
  const { db, accountSetId, assetId } = params

  const asset = db.prepare(`
    SELECT fa.*,
      fc.name AS category_name,
      fd2.name AS dept_name
    FROM fixed_asset fa
    LEFT JOIN fixed_asset_category fc ON fc.account_set_id = fa.account_set_id AND fc.code = fa.category_code
    LEFT JOIN fixed_asset_dept fd2 ON fd2.account_set_id = fa.account_set_id AND fd2.code = fa.dept_code
    WHERE fa.id = ? AND fa.account_set_id = ?
  `).get(assetId, accountSetId) as any

  if (!asset) return null

  const entries: AssetLedgerEntry[] = []

  // 1. 购入事件
  if (asset.acquire_date) {
    entries.push({
      date: asset.acquire_date,
      type: 'acquire',
      summary: '资产购入' + (asset.source ? `（${asset.source}）` : ''),
      original_change: asset.original_value,
      original_after: asset.original_value,
      depr_amount: 0,
      accum_depr_after: 0,
      net_value_after: asset.original_value - (asset.salvage_value ?? 0),
    })
  }

  // 2. 折旧记录
  const deprRecords = db.prepare(`
    SELECT * FROM fixed_asset_depr
    WHERE account_set_id = ? AND asset_no = ?
    ORDER BY year, month
  `).all(accountSetId, asset.asset_no) as any[]

  for (const d of deprRecords) {
    const date = `${d.year}-${String(d.month).padStart(2, '0')}-01`
    entries.push({
      date,
      type: 'depr',
      summary: `${d.year}年${d.month}月计提折旧`,
      original_change: 0,
      original_after: asset.original_value,
      depr_amount: d.month_depr,
      accum_depr_after: d.accum_depr,
      net_value_after: asset.original_value - d.accum_depr - (asset.salvage_value ?? 0),
    })
  }

  // 3. 变动记录
  // 处置记录在下方「4. 处置事件」单独渲染，此处排除，避免时间线出现两条处置
  const changes = db.prepare(`
    SELECT * FROM fixed_asset_change
    WHERE account_set_id = ? AND asset_no = ?
      AND (change_kind IS NULL OR change_kind <> 'dispose')
    ORDER BY change_date
  `).all(accountSetId, asset.asset_no) as any[]

  for (const c of changes) {
    entries.push({
      date: c.change_date || '',
      type: 'change',
      summary: c.change_item || '资产变动',
      original_change: c.amount ?? (c.old_value != null && c.new_value != null ? c.new_value - c.old_value : 0),
      original_after: c.new_value ?? asset.original_value,
      depr_amount: 0,
      accum_depr_after: asset.accum_depr,
      net_value_after: (c.new_value ?? asset.original_value) - asset.accum_depr - (asset.salvage_value ?? 0),
      change_kind: c.change_kind || undefined,
    })
  }

  // 4. 处置事件
  if (asset.scrap_date) {
    entries.push({
      date: asset.scrap_date,
      type: 'disposal',
      summary: '资产处置' + (asset.scrap_reason ? `（${asset.scrap_reason}）` : ''),
      original_change: -asset.original_value,
      original_after: 0,
      depr_amount: 0,
      accum_depr_after: 0,
      net_value_after: 0,
    })
  }

  // 按日期排序
  entries.sort((a, b) => a.date.localeCompare(b.date))

  // 重新计算每行的余额（保证时间顺序正确）
  // AS-P1-9：净值口径改为「原值 − 累计折旧 − 累计减值」（与卡片/折旧引擎一致，不扣残值）；
  // 只有原值类变动（original_value/improvement）推进原值余额，
  // 减值行推进减值余额——此前减值行的 new_value（减值累计额）被当成原值余额，明细账余额错乱
  let runningOriginal = 0
  let runningAccumDepr = 0
  let runningImpairment = 0
  for (const e of entries) {
    if (e.type === 'acquire') {
      runningOriginal = e.original_change
      runningAccumDepr = 0
      runningImpairment = 0
    } else if (e.type === 'depr') {
      runningAccumDepr = e.accum_depr_after
    } else if (e.type === 'change') {
      if (e.change_kind === 'original_value' || e.change_kind === 'improvement') {
        runningOriginal = e.original_after
      } else if (e.change_kind === 'impairment') {
        runningImpairment = e.original_after // impairment 行的 new_value 是减值准备累计额
      }
      // 部门调拨/状态变更等不影响原值余额
    } else if (e.type === 'disposal') {
      runningOriginal = 0
      runningAccumDepr = 0
      runningImpairment = 0
    }
    e.original_after = runningOriginal
    e.accum_depr_after = runningAccumDepr
    e.net_value_after = Math.max(0, Math.round((runningOriginal - runningAccumDepr - runningImpairment) * 100) / 100)
  }

  return {
    asset_no: asset.asset_no,
    asset_name: asset.asset_name,
    category_name: asset.category_name,
    dept_name: asset.dept_name,
    depr_method: asset.depr_method,
    use_months: asset.use_months,
    start_depr_date: asset.start_depr_date,
    acquire_date: asset.acquire_date,
    original_value: asset.original_value,
    salvage_value: asset.salvage_value ?? 0,
    current_accum_depr: asset.accum_depr,
    current_net_value: asset.net_value,
    depr_months_done: asset.depr_months_done,
    entries,
  }
}

// ── 到期提示表 ──────────────────────────────────────────────

export interface ExpiryWarningRow {
  asset_no: string
  asset_name: string
  category_name: string | null
  dept_name: string | null
  original_value: number
  accum_depr: number
  net_value: number
  use_months: number
  depr_months_done: number
  remaining_months: number
  finished_month: string  // 预计提完月份
}

export function queryExpiryWarning(params: {
  db: Database
  accountSetId: string
  withinMonths?: number  // 未来N个月内到期
}): ExpiryWarningRow[] {
  const { db, accountSetId, withinMonths = 3 } = params

  const rows = db.prepare(`
    SELECT
      fa.asset_no,
      fa.asset_name,
      fc.name AS category_name,
      fd2.name AS dept_name,
      fa.original_value,
      fa.accum_depr,
      fa.net_value,
      fa.use_months,
      fa.depr_months_done,
      (fa.use_months - fa.depr_months_done) AS remaining_months
    FROM fixed_asset fa
    LEFT JOIN fixed_asset_category fc ON fc.account_set_id = fa.account_set_id AND fc.code = fa.category_code
    LEFT JOIN fixed_asset_dept fd2 ON fd2.account_set_id = fa.account_set_id AND fd2.code = fa.dept_code
    LEFT JOIN fixed_asset_status fs ON fs.account_set_id = fa.account_set_id AND fs.code = fa.status_code
    WHERE fa.account_set_id = ?
      AND (fs.depreciable = 1 OR fa.status_code IS NULL)
      AND fa.depr_method IS NOT NULL
      AND fa.use_months > 0
      -- AS-P0-2：工作量法不按月数到期，不纳入月度到期预警
      AND fa.depr_method != '2'
      AND (fa.use_months - fa.depr_months_done) BETWEEN 1 AND ?
    ORDER BY remaining_months
  `).all(accountSetId, withinMonths) as any[]

  return rows.map((r: any) => {
    // 计算预计提完月份
    const now = new Date()
    const finishDate = new Date(now.getFullYear(), now.getMonth() + r.remaining_months, 1)
    const finishedMonth = `${finishDate.getFullYear()}-${String(finishDate.getMonth() + 1).padStart(2, '0')}`
    return { ...r, finished_month: finishedMonth }
  })
}

// ── 资产增减变动表 ──────────────────────────────────────────

export interface ChangeSummaryRow {
  category_code: string | null
  category_name: string | null
  opening_count: number
  opening_original: number
  increase_count: number
  increase_amount: number
  decrease_count: number
  decrease_amount: number
  closing_count: number
  closing_original: number
}

export function queryChangeSummary(params: {
  db: Database
  accountSetId: string
  year: number
  month: number
}): ChangeSummaryRow[] {
  const { db, accountSetId, year, month } = params

  // 期间范围：当月1日 到 当月最后一天
  const periodStart = `${year}-${String(month).padStart(2, '0')}-01`
  const lastDay = new Date(year, month, 0).getDate()
  const periodEnd = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`

  // 期初：本期开始前已取得的资产（AS-P1-8：原条件 `acquire_date <= periodEnd`
  // 会把本月新增资产同时计入期初和本期增加，closing 翻倍）
  const openingRows = db.prepare(`
    SELECT
      fa.category_code,
      fc.name AS category_name,
      COUNT(*) AS count,
      SUM(fa.original_value) AS total_original
    FROM fixed_asset fa
    LEFT JOIN fixed_asset_category fc ON fc.account_set_id = fa.account_set_id AND fc.code = fa.category_code
    WHERE fa.account_set_id = ?
      AND (fa.acquire_date IS NULL OR fa.acquire_date < ?)
      AND (fa.scrap_date IS NULL OR fa.scrap_date > ?)
    GROUP BY fa.category_code
  `).all(accountSetId, periodStart, periodStart) as any[]

  // 本期增加：acquire_date 在期内的资产
  const increaseRows = db.prepare(`
    SELECT
      fa.category_code,
      fc.name AS category_name,
      COUNT(*) AS count,
      SUM(fa.original_value) AS total_amount
    FROM fixed_asset fa
    LEFT JOIN fixed_asset_category fc ON fc.account_set_id = fa.account_set_id AND fc.code = fa.category_code
    WHERE fa.account_set_id = ?
      AND fa.acquire_date >= ? AND fa.acquire_date <= ?
    GROUP BY fa.category_code
  `).all(accountSetId, periodStart, periodEnd) as any[]

  // 本期减少：scrap_date 在期内的资产
  const decreaseRows = db.prepare(`
    SELECT
      fa.category_code,
      fc.name AS category_name,
      COUNT(*) AS count,
      SUM(fa.original_value) AS total_amount
    FROM fixed_asset fa
    LEFT JOIN fixed_asset_category fc ON fc.account_set_id = fa.account_set_id AND fc.code = fa.category_code
    WHERE fa.account_set_id = ?
      AND fa.scrap_date >= ? AND fa.scrap_date <= ?
    GROUP BY fa.category_code
  `).all(accountSetId, periodStart, periodEnd) as any[]

  // 合并所有类别
  const allCodes = new Set<string>()
  const catNames = new Map<string, string>()
  for (const r of [...openingRows, ...increaseRows, ...decreaseRows]) {
    const code = r.category_code || '__null__'
    allCodes.add(code)
    if (r.category_name) catNames.set(code, r.category_name)
  }

  const rows: ChangeSummaryRow[] = []
  for (const code of allCodes) {
    const realCode = code === '__null__' ? null : code
    const open = openingRows.find((r: any) => (r.category_code || '__null__') === code)
    const inc = increaseRows.find((r: any) => (r.category_code || '__null__') === code)
    const dec = decreaseRows.find((r: any) => (r.category_code || '__null__') === code)

    const openingCount = open?.count ?? 0
    const openingOriginal = open?.total_original ?? 0
    const increaseCount = inc?.count ?? 0
    const increaseAmount = inc?.total_amount ?? 0
    const decreaseCount = dec?.count ?? 0
    const decreaseAmount = dec?.total_amount ?? 0

    rows.push({
      category_code: realCode,
      category_name: catNames.get(code) || null,
      opening_count: openingCount,
      opening_original: openingOriginal,
      increase_count: increaseCount,
      increase_amount: increaseAmount,
      decrease_count: decreaseCount,
      decrease_amount: decreaseAmount,
      closing_count: openingCount + increaseCount - decreaseCount,
      closing_original: openingOriginal + increaseAmount - decreaseAmount,
    })
  }

  // 按类别编码排序
  rows.sort((a, b) => (a.category_code ?? '').localeCompare(b.category_code ?? ''))
  return rows
}

// ── 增减变动明细（下钻） ──────────────────────────────────────

export interface ChangeDetailRow {
  asset_no: string
  asset_name: string
  category_name: string | null
  dept_name: string | null
  original_value: number
  change_date: string | null
}

export function queryChangeDetail(params: {
  db: Database
  accountSetId: string
  year: number
  month: number
  changeType: 'increase' | 'decrease'
  categoryCode?: string
}): ChangeDetailRow[] {
  const { db, accountSetId, year, month, changeType, categoryCode } = params

  const periodStart = `${year}-${String(month).padStart(2, '0')}-01`
  const lastDay = new Date(year, month, 0).getDate()
  const periodEnd = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`

  const conds = ['fa.account_set_id = ?']
  const args: any[] = [accountSetId]

  if (changeType === 'increase') {
    conds.push('fa.acquire_date >= ? AND fa.acquire_date <= ?')
  } else {
    conds.push('fa.scrap_date >= ? AND fa.scrap_date <= ?')
  }
  args.push(periodStart, periodEnd)

  if (categoryCode) {
    conds.push('fa.category_code = ?')
    args.push(categoryCode)
  }

  return db.prepare(`
    SELECT
      fa.asset_no, fa.asset_name,
      fc.name AS category_name,
      fd2.name AS dept_name,
      fa.original_value,
      ${changeType === 'increase' ? 'fa.acquire_date' : 'fa.scrap_date'} AS change_date
    FROM fixed_asset fa
    LEFT JOIN fixed_asset_category fc ON fc.account_set_id = fa.account_set_id AND fc.code = fa.category_code
    LEFT JOIN fixed_asset_dept fd2 ON fd2.account_set_id = fa.account_set_id AND fd2.code = fa.dept_code
    WHERE ${conds.join(' AND ')}
    ORDER BY fa.asset_no
  `).all(...args) as ChangeDetailRow[]
}

// ── 资产变动记录查询（全局） ──────────────────────────────────

export interface ChangeRecordRow {
  id: string
  asset_no: string
  asset_name: string
  category_name: string | null
  dept_name: string | null
  change_date: string | null
  change_item: string
  old_value: number | null
  new_value: number | null
  amount: number | null
  operator: string | null
  remark: string | null
}

export function queryChanges(params: {
  db: Database
  accountSetId: string
  year?: number
  month?: number
  assetNo?: string
  page?: number
  pageSize?: number
}): { rows: ChangeRecordRow[]; total: number } {
  const { db, accountSetId, year, month, assetNo, page = 1, pageSize = 20 } = params

  const conds = ['c.account_set_id = ?']
  const queryParams: any[] = [accountSetId]

  if (year) {
    conds.push("strftime('%Y', c.change_date) = ?")
    queryParams.push(String(year))
  }
  if (month) {
    conds.push("strftime('%m', c.change_date) = ?")
    queryParams.push(String(month).padStart(2, '0'))
  }
  if (assetNo) {
    conds.push('c.asset_no LIKE ?')
    queryParams.push(`%${assetNo}%`)
  }

  const where = conds.join(' AND ')

  const total = (db.prepare(`
    SELECT COUNT(*) c FROM fixed_asset_change c WHERE ${where}
  `).get(...queryParams) as any).c

  const offset = (page - 1) * pageSize
  const rows = db.prepare(`
    SELECT
      c.*,
      fa.asset_name,
      fc.name AS category_name,
      fd2.name AS dept_name
    FROM fixed_asset_change c
    LEFT JOIN fixed_asset fa ON fa.account_set_id = c.account_set_id AND fa.asset_no = c.asset_no
    LEFT JOIN fixed_asset_category fc ON fc.account_set_id = c.account_set_id AND fc.code = fa.category_code
    LEFT JOIN fixed_asset_dept fd2 ON fd2.account_set_id = c.account_set_id AND fd2.code = fa.dept_code
    WHERE ${where}
    ORDER BY c.change_date DESC, c.asset_no
    LIMIT ? OFFSET ?
  `).all(...queryParams, pageSize, offset) as ChangeRecordRow[]

  return { rows, total }
}

// ── 折旧预测 ──────────────────────────────────────────────

export interface ForecastRow {
  period: string               // "2026-07"
  year: number
  month: number
  asset_count: number
  total_depr: number
  details: ForecastDetail[]    // 按资产明细
}

export interface ForecastDetail {
  asset_no: string
  asset_name: string
  depr_method: string | null
  original_value: number
  month_depr: number
  accum_depr_after: number
  net_value_after: number
}

export function queryDeprForecast(params: {
  db: Database
  accountSetId: string
  months?: number  // 预测月数，默认 12
}): ForecastRow[] {
  const { db, accountSetId, months = 12 } = params

  // 获取所有应计提资产
  const assets = db.prepare(`
    SELECT fa.*,
      fp.expense_account,
      fc.account_code AS asset_account
    FROM fixed_asset fa
    LEFT JOIN fixed_asset_purpose  fp ON fp.account_set_id = fa.account_set_id AND fp.code = fa.purpose_code
    LEFT JOIN fixed_asset_category fc ON fc.account_set_id = fa.account_set_id AND fc.code = fa.category_code
    LEFT JOIN fixed_asset_status   fs ON fs.account_set_id = fa.account_set_id AND fs.code = fa.status_code
    WHERE fa.account_set_id = ?
      AND (fs.depreciable = 1 OR fa.status_code IS NULL)
      AND fa.depr_method IS NOT NULL
      AND fa.scrap_date IS NULL
      AND (
        -- AS-P0-2：工作量法按工作量判断是否提满，其余方法按月数
        (fa.depr_method = '2' AND fa.total_workload > 0
           AND (fa.workload_done IS NULL OR fa.workload_done < fa.total_workload))
        OR
        (fa.depr_method != '2' AND fa.use_months > 0 AND fa.depr_months_done < fa.use_months)
      )
  `).all(accountSetId) as any[]

  const now = new Date()
  const rows: ForecastRow[] = []

  // 每项资产的运行时状态
  const states = assets.map(a => ({
    ...a,
    accum_depr: a.accum_depr as number,
    net_value: a.net_value as number,
    depr_months_done: a.depr_months_done as number,
  }))

  for (let i = 1; i <= months; i++) {
    const fy = now.getFullYear()
    const fm = now.getMonth() + 1 + i
    const year = fy + Math.floor((fm - 1) / 12)
    const month = ((fm - 1) % 12) + 1
    const period = `${year}-${String(month).padStart(2, '0')}`

    const details: ForecastDetail[] = []

    for (const s of states) {
      // AS-P0-2：月数型按月数判断结束；工作量法按累计工作量判断结束
      if ((s.depr_method || '1') === '2') {
        const tw = s.total_workload || 0
        if (!(tw > 0) || (s.workload_done || 0) >= tw) continue
      } else if (s.depr_months_done >= (s.use_months || 9999)) {
        continue
      }
      if (s.net_value <= (s.salvage_value || 0)) continue

      const method = s.depr_method || '1'
      let monthDepr = 0

      if (method === '1') {
        // 平均年限法: 每月depr = depreciable / use_months
        const depreciable = s.original_value - (s.salvage_value || 0)
        if (depreciable > 0 && s.use_months > 0) {
          monthDepr = Math.round((depreciable / s.use_months) * 100) / 100
        }
      } else if (method === '2') {
        // AS-P0-2：工作量法按工作量口径预测（此前错按直线法），假定各月均衡工作量为 总工作量/使用月数
        const totalWorkload = s.total_workload || 0
        const doneWorkload = s.workload_done || 0
        if (totalWorkload > 0 && doneWorkload < totalWorkload) {
          const avgWorkload = s.use_months > 0 ? totalWorkload / s.use_months : 0
          const depreciable = s.original_value - (s.salvage_value || 0)
          if (depreciable > 0 && avgWorkload > 0) {
            monthDepr = Math.round((depreciable / totalWorkload) * avgWorkload * 100) / 100
          }
        }
      } else if (method === '3') {
        // 双倍余额递减法
        const remaining = (s.use_months || 0) - s.depr_months_done
        if (remaining > 0) {
          if (remaining <= 2) {
            const rem = s.net_value - (s.salvage_value || 0)
            monthDepr = Math.max(0, Math.round((rem / remaining) * 100) / 100)
          } else {
            const rate = 2 / (s.use_months || 1)
            monthDepr = Math.round(s.net_value * rate * 100) / 100
          }
        }
      } else if (method === '4') {
        // 年数总和法
        const depreciable = s.original_value - (s.salvage_value || 0)
        const n = s.use_months || 1
        const sumOfNums = (n * (n + 1)) / 2
        const remaining = n - s.depr_months_done
        if (remaining > 0) {
          monthDepr = Math.round((depreciable * remaining / sumOfNums) * 100) / 100
        }
      }

      // 不超过剩余净值
      const maxDepr = Math.max(0, Math.round((s.net_value - (s.salvage_value || 0)) * 100) / 100)
      monthDepr = Math.min(monthDepr, maxDepr)
      monthDepr = Math.round(monthDepr * 100) / 100

      if (monthDepr <= 0) continue

      // 更新运行时状态
      s.accum_depr = Math.round((s.accum_depr + monthDepr) * 100) / 100
      s.net_value = Math.round((s.net_value - monthDepr) * 100) / 100
      s.depr_months_done += 1
      // AS-P0-2：工作量法同步推进累计工作量（与当月估算工作量一致）
      if (method === '2' && s.use_months > 0 && (s.total_workload || 0) > 0) {
        s.workload_done = Math.min(
          s.total_workload,
          Math.round(((s.workload_done || 0) + (s.total_workload || 0) / s.use_months) * 100) / 100
        )
      }

      details.push({
        asset_no: s.asset_no,
        asset_name: s.asset_name,
        depr_method: method,
        original_value: s.original_value,
        month_depr: monthDepr,
        accum_depr_after: s.accum_depr,
        net_value_after: s.net_value,
      })
    }

    if (details.length === 0) continue

    rows.push({
      period,
      year,
      month,
      asset_count: details.length,
      total_depr: Math.round(details.reduce((s, d) => s + d.month_depr, 0) * 100) / 100,
      details,
    })
  }

  return rows
}
