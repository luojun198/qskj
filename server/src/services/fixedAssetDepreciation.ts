/**
 * 固定资产折旧计算引擎（四种折旧方法）
 *
 * ACD 折旧方法代码：1=平均年限  2=工作量  3=双倍余额递减  4=年数总和
 * 起折规则（与润衡相同）：syrq 所在月份 次月 开始计提。
 */
import type { Database } from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'
import { deleteVoucherRecords, type VoucherEntryInput } from './voucherEntry.js'
import {
  insertAssetVoucher,
  loadAssetAuxContext,
  resolveAssetAuxRefs,
  auxRefsForAccount,
  resolveAccounts,
  lastDayOfMonth,
} from './assetVoucherBuilder.js'

export interface DeprAsset {
  id: string
  asset_no: string
  asset_name: string
  dept_code: string | null
  purpose_code: string | null
  depr_method: string | null
  original_value: number
  salvage_value: number
  use_months: number | null
  total_workload: number | null
  depr_months_done: number
  workload_done: number
  accum_depr: number
  net_value: number
  status_code: string | null
  start_depr_date: string | null
  expense_account: string | null  // 折旧费用科目（来自 purpose）
  asset_account: string | null    // 资产原值科目（来自 category）
  depr_account_code: string | null // 累计折旧科目（来自 category）
  /** 是否发生过改变折旧基数的变动（原值变动/折旧要素调整/减值/改良），决定是否按剩余期间摊余 */
  rebased?: boolean
}

export interface DeprLine {
  asset_no: string
  asset_name: string
  dept_code: string | null
  purpose_code: string | null
  depr_method: string
  original_value: number
  accum_depr_before: number
  month_depr: number
  accum_depr_after: number
  net_value_after: number
  expense_account: string | null
  asset_account: string | null
  depr_account_code: string | null
}

// ── 四种折旧算法 ──────────────────────────────────────────

/**
 * P1-2：资产发生过原值变动 / 折旧要素调整 / 减值 / 改良后，会计准则要求采用
 * 「未来适用法」——历史折旧不重算，剩余可折金额在剩余期间内重新摊销。
 *
 * `rebased` 由 previewDepreciation 依据 fixed_asset_change 判定；未发生过此类变动的
 * 资产走原口径（(原值-残值)/使用月数 全期平均），保证历史账套结果不变。
 */
function calcMethodAvgYears(a: DeprAsset): number {
  if (!a.use_months || a.use_months <= 0) return 0
  if (a.depr_months_done >= a.use_months) return 0

  if (a.rebased) {
    // 剩余期间摊余：(当前净值 - 残值) / 剩余月数
    const remainingMonths = a.use_months - a.depr_months_done
    const remainingDepreciable = a.net_value - a.salvage_value
    if (remainingDepreciable <= 0 || remainingMonths <= 0) return 0
    return Math.round((remainingDepreciable / remainingMonths) * 100) / 100
  }

  const depreciable = a.original_value - a.salvage_value
  if (depreciable <= 0) return 0
  return Math.round((depreciable / a.use_months) * 100) / 100
}

function calcMethodWorkload(a: DeprAsset, currentWorkload: number): number {
  if (!a.total_workload || a.total_workload <= 0) return 0

  if (a.rebased) {
    // 剩余工作量摊余：(当前净值 - 残值) / 剩余工作量 × 当月工作量
    const remainingWorkload = a.total_workload - (a.workload_done || 0)
    const remainingDepreciable = a.net_value - a.salvage_value
    if (remainingWorkload <= 0 || remainingDepreciable <= 0) return 0
    return Math.round((remainingDepreciable / remainingWorkload) * currentWorkload * 100) / 100
  }

  const depreciable = a.original_value - a.salvage_value
  if (depreciable <= 0) return 0
  return Math.round((depreciable / a.total_workload) * currentWorkload * 100) / 100
}

function calcMethodDoubleDeclining(a: DeprAsset): number {
  if (!a.use_months || a.use_months <= 0) return 0
  const remaining = a.use_months - a.depr_months_done
  if (remaining <= 0) return 0
  // 最后 2 个月改用直线法
  if (remaining <= 2) {
    const rem = a.net_value - a.salvage_value
    return Math.max(0, Math.round((rem / remaining) * 100) / 100)
  }
  const rate = 2 / a.use_months
  return Math.round(a.net_value * rate * 100) / 100
}

function calcMethodSumOfYears(a: DeprAsset): number {
  if (!a.use_months || a.use_months <= 0) return 0
  const remaining = a.use_months - a.depr_months_done
  if (remaining <= 0) return 0

  if (a.rebased) {
    // 剩余期间重新起算年数总和：分母改为剩余月数的和 remaining(remaining+1)/2
    const remainingDepreciable = a.net_value - a.salvage_value
    if (remainingDepreciable <= 0) return 0
    const sumOfRemaining = (remaining * (remaining + 1)) / 2
    return Math.round(((remainingDepreciable * remaining) / sumOfRemaining) * 100) / 100
  }

  const depreciable = a.original_value - a.salvage_value
  if (depreciable <= 0) return 0
  const n = a.use_months
  const sumOfNums = (n * (n + 1)) / 2
  return Math.round(((depreciable * remaining) / sumOfNums) * 100) / 100
}

// ── 计划明细：预览（不写库） ───────────────────────────────

export function previewDepreciation(params: {
  db: Database
  accountSetId: string
  year: number
  month: number
  workloadMap?: Record<string, number>
}): DeprLine[] {
  const { db, accountSetId, year, month } = params
  const workloadMap = params.workloadMap || {}

  const assets = db.prepare(`
    SELECT fa.*,
      fp.expense_account,
      fc.account_code AS asset_account,
      fc.depr_account_code,
      -- P1-2：发生过改变折旧基数的变动后，改按「剩余期间摊余」计算（未来适用法）
      EXISTS (
        SELECT 1 FROM fixed_asset_change ch
         WHERE ch.account_set_id = fa.account_set_id
           AND ch.asset_no = fa.asset_no
           AND ch.change_kind IN ('original_value', 'depr_factor', 'impairment', 'improvement')
      ) AS rebased
    FROM fixed_asset fa
    LEFT JOIN fixed_asset_purpose  fp ON fp.account_set_id = fa.account_set_id AND fp.code = fa.purpose_code
    LEFT JOIN fixed_asset_category fc ON fc.account_set_id = fa.account_set_id AND fc.code = fa.category_code
    LEFT JOIN fixed_asset_status   fs ON fs.account_set_id = fa.account_set_id AND fs.code = fa.status_code
    WHERE fa.account_set_id = ?
      AND (fs.depreciable = 1 OR fa.status_code IS NULL)
      AND fa.depr_method IS NOT NULL
      AND fa.use_months > 0
      AND fa.depr_months_done < fa.use_months
  `).all(accountSetId) as DeprAsset[]

  const lines: DeprLine[] = []

  for (const a of assets) {
    // 起折日期校验：计提月必须 > 起折月
    if (a.start_depr_date) {
      const [sy, sm] = a.start_depr_date.split('-').map(Number)
      if (year * 12 + month <= sy * 12 + sm) continue
    }

    // 已计提本月则跳过
    const already = db.prepare(
      'SELECT id FROM fixed_asset_depr WHERE account_set_id=? AND asset_no=? AND year=? AND month=?'
    ).get(accountSetId, a.asset_no, year, month)
    if (already) continue

    const method = a.depr_method || '1'
    let monthDepr = 0
    if (method === '1') monthDepr = calcMethodAvgYears(a)
    else if (method === '2') monthDepr = calcMethodWorkload(a, workloadMap[a.asset_no] ?? 0)
    else if (method === '3') monthDepr = calcMethodDoubleDeclining(a)
    else if (method === '4') monthDepr = calcMethodSumOfYears(a)

    if (monthDepr <= 0) continue

    // 不超过剩余可折余额（防止最后一月多折）
    const maxDepr = Math.max(0, Math.round((a.net_value - a.salvage_value) * 100) / 100)
    monthDepr = Math.min(monthDepr, maxDepr)
    monthDepr = Math.round(monthDepr * 100) / 100
    if (monthDepr <= 0) continue

    lines.push({
      asset_no: a.asset_no,
      asset_name: a.asset_name,
      dept_code: a.dept_code,
      purpose_code: a.purpose_code,
      depr_method: method,
      original_value: a.original_value,
      accum_depr_before: a.accum_depr,
      month_depr: monthDepr,
      accum_depr_after: Math.round((a.accum_depr + monthDepr) * 100) / 100,
      net_value_after: Math.round((a.net_value - monthDepr) * 100) / 100,
      expense_account: a.expense_account,
      asset_account: a.asset_account,
      depr_account_code: a.depr_account_code,
    })
  }

  return lines
}

// ── 执行计提：写库 ─────────────────────────────────────────

export function executeDepreciation(params: {
  db: Database
  accountSetId: string
  year: number
  month: number
  lines: DeprLine[]
}): void {
  const { db, accountSetId, year, month, lines } = params

  const insDepr = db.prepare(`
    INSERT INTO fixed_asset_depr
      (id, account_set_id, asset_no, year, month, dept_code, purpose_code, depr_method, month_depr, accum_depr)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(account_set_id, asset_no, year, month) DO UPDATE SET
      month_depr=excluded.month_depr, accum_depr=excluded.accum_depr
  `)

  const updAsset = db.prepare(`
    UPDATE fixed_asset SET
      accum_depr       = ROUND(accum_depr + ?, 2),
      net_value        = ROUND(net_value  - ?, 2),
      depr_months_done = depr_months_done + 1,
      updated_at       = datetime('now')
    WHERE account_set_id = ? AND asset_no = ?
  `)

  for (const ln of lines) {
    insDepr.run(
      uuidv4(), accountSetId, ln.asset_no, year, month,
      ln.dept_code, ln.purpose_code, ln.depr_method, ln.month_depr, ln.accum_depr_after
    )
    updAsset.run(ln.month_depr, ln.month_depr, accountSetId, ln.asset_no)
  }
}

// ── 生成折旧凭证 ───────────────────────────────────────────

export interface DeprVoucherResult {
  voucherId: string
  voucherNo: string
  entryCount: number
  totalDepr: number
}

export function generateDeprVoucher(params: {
  db: Database
  accountSetId: string
  year: number
  month: number
  lines: DeprLine[]
  deprAccumAccount: string    // 累计折旧科目，默认 1602（或从 xt.txt 读）
  makerName: string
  voucherTypeId?: string | null
}): DeprVoucherResult {
  const { db, accountSetId, year, month, lines, deprAccumAccount, makerName, voucherTypeId } = params
  if (lines.length === 0) throw new Error('无折旧明细，无法生成凭证')

  const auxContext = loadAssetAuxContext(db, accountSetId)

  // 资产 → 辅助核算引用（部门/使用人）缓存，避免逐行重复查库
  const refsCache = new Map<string, Record<string, string>>()
  const assetInfo = db.prepare(
    'SELECT dept_code, user_name FROM fixed_asset WHERE account_set_id=? AND asset_no=? LIMIT 1'
  )
  const refsOf = (ln: DeprLine): Record<string, string> => {
    const cached = refsCache.get(ln.asset_no)
    if (cached) return cached
    const row = (assetInfo.get(accountSetId, ln.asset_no) as any) || { dept_code: ln.dept_code }
    const refs = resolveAssetAuxRefs(
      db,
      accountSetId,
      { dept_code: row.dept_code ?? ln.dept_code, user_name: row.user_name },
      auxContext
    )
    refsCache.set(ln.asset_no, refs)
    return refs
  }

  /**
   * P0-1：借方按「折旧费用科目 + 辅助核算项组合」二元组汇总（原先只按科目汇总）。
   * 否则启用了部门辅助核算的费用科目，其部门辅助明细账会缺数或串账。
   */
  interface DeprGroup {
    accountCode: string
    refs: Record<string, string>
    amount: number
  }
  const groupKey = (code: string, refs: Record<string, string>) =>
    `${code}||${Object.keys(refs).sort().map(k => `${k}=${refs[k]}`).join(',')}`

  const expenseGroups = new Map<string, DeprGroup>()
  for (const ln of lines) {
    const accountCode = ln.expense_account || '660201'
    const refs = auxRefsForAccount(db, accountSetId, accountCode, refsOf(ln), auxContext)
    const key = groupKey(accountCode, refs)
    const hit = expenseGroups.get(key)
    if (hit) hit.amount += ln.month_depr
    else expenseGroups.set(key, { accountCode, refs, amount: ln.month_depr })
  }

  // 贷方：按「累计折旧科目 + 辅助核算项」汇总（优先类别配置，无则用传入默认值）
  const accumGroups = new Map<string, DeprGroup>()
  for (const ln of lines) {
    const accountCode = ln.depr_account_code || deprAccumAccount || '1602'
    const refs = auxRefsForAccount(db, accountSetId, accountCode, refsOf(ln), auxContext)
    const key = groupKey(accountCode, refs)
    const hit = accumGroups.get(key)
    if (hit) hit.amount += ln.month_depr
    else accumGroups.set(key, { accountCode, refs, amount: ln.month_depr })
  }

  const totalDepr = lines.reduce((s, l) => s + l.month_depr, 0)
  const totalDeprRounded = Math.round(totalDepr * 100) / 100

  // 预检：所有科目必须在账套内存在（缺失时抛出明确提示，不生成半截凭证）
  const accounts = resolveAccounts(
    db,
    accountSetId,
    [...[...expenseGroups.values()].map(g => g.accountCode), ...[...accumGroups.values()].map(g => g.accountCode)],
    '折旧'
  )

  const summary = `${year}年${month}月计提折旧`
  const toEntry = (g: DeprGroup, direction: 'debit' | 'credit'): VoucherEntryInput => {
    const acc = accounts.get(g.accountCode)!
    return {
      account_id: acc.id,
      account_code: acc.code,
      account_name: acc.name,
      direction,
      amount: Math.round(g.amount * 100) / 100,
      summary,
      ...g.refs,
    }
  }

  const entries: VoucherEntryInput[] = [
    ...[...expenseGroups.values()].filter(g => g.amount > 0).map(g => toEntry(g, 'debit')),
    ...[...accumGroups.values()].filter(g => g.amount > 0).map(g => toEntry(g, 'credit')),
  ]

  const result = insertAssetVoucher({
    db,
    accountSetId,
    source: 'asset_depr',
    voucherDate: lastDayOfMonth(year, month),
    year,
    period: month,
    remark: `${year}年${month}月固定资产折旧`,
    makerName,
    voucherTypeId,
    entries,
    auxContext,
  })

  return {
    voucherId: result.voucherId,
    voucherNo: result.voucherNo,
    entryCount: result.entryCount,
    totalDepr: totalDeprRounded,
  }
}

// ── 从已计提历史重建生成凭证所需的最小 lines（按期间补生成凭证用）──────────
// 用 fixed_asset_depr 里「已计提的实际金额」，而非重新预览，避免与历史不一致。
export function buildDeprLinesFromHistory(params: {
  db: Database
  accountSetId: string
  year: number
  month: number
}): DeprLine[] {
  const { db, accountSetId, year, month } = params
  const rows = db.prepare(`
    SELECT fd.asset_no, fd.dept_code, fd.purpose_code, fd.depr_method, fd.month_depr,
           fa.asset_name, fa.original_value, fa.category_code,
           fp.expense_account AS purpose_expense_account,
           fc.depr_account_code AS category_depr_account
    FROM fixed_asset_depr fd
    LEFT JOIN fixed_asset fa ON fa.account_set_id=fd.account_set_id AND fa.asset_no=fd.asset_no
    LEFT JOIN fixed_asset_purpose fp ON fp.account_set_id=fd.account_set_id AND fp.code=fd.purpose_code
    LEFT JOIN fixed_asset_category fc ON fc.account_set_id=fd.account_set_id AND fc.code=fa.category_code
    WHERE fd.account_set_id=? AND fd.year=? AND fd.month=?
  `).all(accountSetId, year, month) as any[]

  return rows.map(r => ({
    asset_no: r.asset_no,
    asset_name: r.asset_name || r.asset_no,
    dept_code: r.dept_code ?? null,
    purpose_code: r.purpose_code ?? null,
    depr_method: r.depr_method ?? '1',
    original_value: r.original_value ?? 0,
    accum_depr_before: 0,
    month_depr: r.month_depr ?? 0,
    accum_depr_after: 0,
    net_value_after: 0,
    expense_account: r.purpose_expense_account ?? null,
    asset_account: null,
    depr_account_code: r.category_depr_account ?? null,
  }))
}

// ── 反折旧：整期撤销折旧 + 回退资产 + 删除该期折旧凭证 ────────────────────
export interface ReverseDeprResult {
  assetCount: number
  totalDepr: number
  deletedVoucherNos: string[]
  /** 被删凭证的去重 (年, 期, 类型) 分组，供前端提示重新排号 */
  affectedGroups: Array<{ year: number; period: number; voucher_type_id: string | null }>
}

export function reverseDepreciation(params: {
  db: Database
  accountSetId: string
  year: number
  month: number
}): ReverseDeprResult {
  const { db, accountSetId, year, month } = params

  // 1. 取该期折旧明细
  const deprRows = db.prepare(
    'SELECT asset_no, month_depr, voucher_id FROM fixed_asset_depr WHERE account_set_id=? AND year=? AND month=?'
  ).all(accountSetId, year, month) as Array<{ asset_no: string; month_depr: number; voucher_id: string | null }>
  if (deprRows.length === 0) {
    throw new Error('该期间没有折旧记录，无需反折旧')
  }

  // 2. 整期最新校验：存在更晚期间的折旧则拒绝（保证累计折旧序列正确）
  const laterExists = db.prepare(
    "SELECT 1 FROM fixed_asset_depr WHERE account_set_id=? AND (year > ? OR (year = ? AND month > ?)) LIMIT 1"
  ).get(accountSetId, year, year, month) as any
  if (laterExists) {
    throw new Error('存在更晚期间的折旧记录，请先反折旧更晚的期间')
  }

  // 3. 校验关联凭证状态（已记账不可删）
  const voucherIds = [...new Set(deprRows.map(r => r.voucher_id).filter(Boolean))] as string[]
  const deletedVoucherNos: string[] = []
  for (const vid of voucherIds) {
    const v = db.prepare('SELECT voucher_no, status FROM vouchers WHERE id=?').get(vid) as any
    if (v && v.status === 'posted') {
      throw new Error('该期折旧凭证已记账，请先取消记账后再反折旧')
    }
  }

  const updAsset = db.prepare(`
    UPDATE fixed_asset SET
      accum_depr       = ROUND(accum_depr - ?, 2),
      net_value        = ROUND(net_value  + ?, 2),
      depr_months_done = MAX(0, depr_months_done - 1),
      updated_at       = datetime('now')
    WHERE account_set_id = ? AND asset_no = ?
  `)

  const totalDepr = Math.round(deprRows.reduce((s, r) => s + (r.month_depr || 0), 0) * 100) / 100

  const groupMap = new Map<string, { year: number; period: number; voucher_type_id: string | null }>()

  const tx = db.transaction(() => {
    // 4. 回退各资产
    for (const r of deprRows) {
      updAsset.run(r.month_depr, r.month_depr, accountSetId, r.asset_no)
    }
    // 5. 删除该期折旧凭证（模块内部操作，绕过 API 删除拦截）
    for (const vid of voucherIds) {
      const v = db.prepare('SELECT voucher_no, year, period, voucher_type_id FROM vouchers WHERE id=?').get(vid) as any
      if (v) {
        // 记录受影响 (年,期,类型) 分组（删除前）
        const gkey = `${v.year}|${v.period}|${v.voucher_type_id ?? ''}`
        if (!groupMap.has(gkey)) {
          groupMap.set(gkey, { year: v.year, period: v.period, voucher_type_id: v.voucher_type_id ?? null })
        }
        deleteVoucherRecords(db, vid)
        deletedVoucherNos.push(v.voucher_no)
      }
    }
    // 6. 删除该期折旧明细
    db.prepare('DELETE FROM fixed_asset_depr WHERE account_set_id=? AND year=? AND month=?')
      .run(accountSetId, year, month)
  })
  tx()

  return { assetCount: deprRows.length, totalDepr, deletedVoucherNos, affectedGroups: [...groupMap.values()] }
}
