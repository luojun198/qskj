/**
 * 固定资产「凭证管理」：统一列出各业务生成的凭证，支持「只删凭证（保留业务记录）」与「重新生成」。
 *
 * 背景：asset_* 来源凭证在总账被来源守卫锁死（voucherMutationGuard），出错时只能回固定资产处理。
 * 原有入口（反折旧 / 撤销变动 / 撤销处置）会连业务一起回退；本服务提供更轻的一条路——
 * 业务记录原样保留，仅删凭证、清掉回链字段，改好科目 / 日期后再重新生成。
 *
 * 凭证类型（kind）与回链字段：
 *   purchase   卡片            fixed_asset.purchase_voucher_id
 *   depr       折旧期间(年-月)  fixed_asset_depr.voucher_id（整期同一张）
 *   change     变动流水         fixed_asset_change.voucher_id（原值变动 / 改良 / 减值）
 *   disposal   已处置卡片       fixed_asset.scrap_voucher_id
 *   inventory  已完成盘点       fixed_asset_inventory_item.voucher_id
 */
import type { Database } from 'better-sqlite3'
import { generatePurchaseVoucher } from './assetAcquisition.js'
import { regenerateChangeVoucher } from './assetChange.js'
import { regenerateDisposalVoucher } from './assetDisposal.js'
import { regenerateInventoryVoucher } from './assetInventory.js'
import { buildDeprLinesFromHistory, generateDeprVoucher } from './fixedAssetDepreciation.js'
import { assertPeriodOpen, getAssetParam } from './assetVoucherBuilder.js'
import { assertVoucherEntriesInScopeById } from './accountAuthorization.js'
import { deleteVoucherWithRefs } from './voucherDelete.js'
import { getVoucherImmutableReason } from './voucherMutationGuard.js'

export type AssetVoucherKind = 'purchase' | 'depr' | 'change' | 'disposal' | 'inventory'

export const ASSET_VOUCHER_KINDS: AssetVoucherKind[] = ['purchase', 'depr', 'change', 'disposal', 'inventory']

export const ASSET_VOUCHER_KIND_LABELS: Record<AssetVoucherKind, string> = {
  purchase: '购置',
  depr: '折旧',
  change: '变动 / 减值',
  disposal: '处置',
  inventory: '盘点',
}

export function isAssetVoucherKind(v: unknown): v is AssetVoucherKind {
  return typeof v === 'string' && (ASSET_VOUCHER_KINDS as string[]).includes(v)
}

const CHANGE_VOUCHER_KINDS = ['original_value', 'improvement', 'impairment']

export interface AssetVoucherRow {
  kind: AssetVoucherKind
  /** purchase / disposal = 卡片 id；depr = `年-月`；change = 变动流水 id；inventory = 盘点 id */
  refId: string
  /** 业务描述（列表第一列） */
  title: string
  assetNo: string | null
  assetName: string | null
  year: number | null
  period: number | null
  amount: number | null
  /** 补充说明，如「盘盈 2 · 盘亏 1」「共 12 项资产」 */
  summary: string | null
  /** 仅 change 类：原值变动 / 改良 / 减值（重新生成页据此决定是否要填对方科目） */
  changeKind?: string | null
  voucherId: string | null
  voucherNo: string | null
  voucherStatus: 'draft' | 'audited' | 'posted' | null
  hasVoucher: boolean
  /** 有凭证但不可删时的原因 */
  deleteBlockReason: string | null
  /** 无凭证但不可生成时的原因 */
  regenerateBlockReason: string | null
}

export interface ListAssetVouchersFilters {
  kind?: AssetVoucherKind
  year?: number
  month?: number
  /** generated = 已生成；missing = 未生成 */
  status?: 'generated' | 'missing'
  keyword?: string
  /** 精确定位某条业务记录（重新生成页取摘要用） */
  refId?: string
  page?: number
  pageSize?: number
}

interface VoucherInfo {
  id: string
  voucher_no: string
  status: string
  year: number
  period: number
  voucher_type_id: string | null
  voucher_date: string | null
  source: string | null
}

function getVoucher(db: Database, accountSetId: string, id: string | null | undefined): VoucherInfo | null {
  if (!id) return null
  return (
    (db
      .prepare(
        'SELECT id, voucher_no, status, year, period, voucher_type_id, voucher_date, source FROM vouchers WHERE id=? AND account_set_id=?'
      )
      .get(id, accountSetId) as VoucherInfo | undefined) ?? null
  )
}

/** 账套启用月（YYYY-MM）；取不到返回 null（此时「未生成」行不列期初前的卡片判断，只列有凭证的） */
function accountSetStartMonth(db: Database, accountSetId: string): string | null {
  try {
    const row = db.prepare('SELECT start_date FROM account_sets WHERE id=?').get(accountSetId) as
      | { start_date?: string | null }
      | undefined
    const v = row?.start_date ? String(row.start_date).slice(0, 7) : ''
    return /^\d{4}-\d{2}$/.test(v) ? v : null
  } catch {
    return null
  }
}

function ymOf(date: string | null | undefined): { year: number; period: number } | null {
  const m = /^(\d{4})-(\d{2})/.exec(String(date || ''))
  return m ? { year: Number(m[1]), period: Number(m[2]) } : null
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

// ── 删除 / 生成的可行性判断 ───────────────────────────────

function deleteBlockReasonOf(db: Database, accountSetId: string, v: VoucherInfo): string | null {
  if (v.status === 'posted') return '凭证已记账，请先到总账「取消记账」后再删除'
  // 绕过来源守卫（本模块就是 asset_* 凭证的回收入口），只过总账 / 出纳期间闸
  return getVoucherImmutableReason({
    db,
    accountSetId,
    voucher: { ...v, source: null },
    operation: 'delete',
  })
}

function regenerateBlockReasonOf(db: Database, accountSetId: string, year: number | null, period: number | null): string | null {
  if (year == null || period == null) return null
  try {
    assertPeriodOpen(db, accountSetId, year, period)
    return null
  } catch (e: any) {
    return e.message as string
  }
}

function buildRow(
  db: Database,
  accountSetId: string,
  base: Omit<
    AssetVoucherRow,
    'voucherId' | 'voucherNo' | 'voucherStatus' | 'hasVoucher' | 'deleteBlockReason' | 'regenerateBlockReason'
  >,
  voucherId: string | null,
  extraRegenBlock?: string | null
): AssetVoucherRow {
  const v = getVoucher(db, accountSetId, voucherId)
  if (v) {
    return {
      ...base,
      voucherId: v.id,
      voucherNo: v.voucher_no,
      voucherStatus: (v.status as AssetVoucherRow['voucherStatus']) ?? 'draft',
      hasVoucher: true,
      deleteBlockReason: deleteBlockReasonOf(db, accountSetId, v),
      regenerateBlockReason: null,
    }
  }
  return {
    ...base,
    voucherId: null,
    voucherNo: null,
    voucherStatus: null,
    hasVoucher: false,
    deleteBlockReason: null,
    regenerateBlockReason: extraRegenBlock ?? regenerateBlockReasonOf(db, accountSetId, base.year, base.period),
  }
}

// ── 列表 ─────────────────────────────────────────────────

function listPurchase(db: Database, accountSetId: string): AssetVoucherRow[] {
  const start = accountSetStartMonth(db, accountSetId)
  const cards = db
    .prepare(
      `SELECT id, asset_no, asset_name, acquire_date, original_value, purchase_voucher_id
         FROM fixed_asset WHERE account_set_id=?`
    )
    .all(accountSetId) as any[]
  const rows: AssetVoucherRow[] = []
  for (const c of cards) {
    const v = getVoucher(db, accountSetId, c.purchase_voucher_id)
    const ym = v ? { year: v.year, period: v.period } : ymOf(c.acquire_date)
    // 无凭证的卡片：只列账套启用后取得的（期初导入的卡片不应补购置凭证）
    if (!v) {
      if (!start || !c.acquire_date || String(c.acquire_date).slice(0, 7) < start) continue
      if (!(Number(c.original_value) > 0)) continue
      // 拆分转入的子卡片价值来自原卡片，不是新购入，不应补购置凭证
      const splitIn = db
        .prepare(
          "SELECT 1 FROM fixed_asset_change WHERE account_set_id=? AND asset_no=? AND change_kind='split' AND amount > 0 LIMIT 1"
        )
        .get(accountSetId, c.asset_no)
      if (splitIn) continue
    }
    rows.push(
      buildRow(
        db,
        accountSetId,
        {
          kind: 'purchase',
          refId: c.id,
          title: `购入固定资产：${c.asset_name}`,
          assetNo: c.asset_no,
          assetName: c.asset_name,
          year: ym?.year ?? null,
          period: ym?.period ?? null,
          amount: round2(Number(c.original_value || 0)),
          summary: null,
        },
        c.purchase_voucher_id
      )
    )
  }
  return rows
}

function listDepr(db: Database, accountSetId: string): AssetVoucherRow[] {
  const periods = db
    .prepare(
      `SELECT year, month, COUNT(*) AS cnt, ROUND(SUM(month_depr), 2) AS total,
              MAX(voucher_id) AS voucher_id
         FROM fixed_asset_depr WHERE account_set_id=? GROUP BY year, month`
    )
    .all(accountSetId) as any[]
  return periods.map(p =>
    buildRow(
      db,
      accountSetId,
      {
        kind: 'depr',
        refId: `${p.year}-${p.month}`,
        title: `${p.year}年${p.month}月 计提折旧`,
        assetNo: null,
        assetName: null,
        year: p.year,
        period: p.month,
        amount: Number(p.total || 0),
        summary: `共 ${p.cnt} 项资产`,
      },
      p.voucher_id
    )
  )
}

function listChange(db: Database, accountSetId: string): AssetVoucherRow[] {
  const changes = db
    .prepare(
      `SELECT c.id, c.asset_no, c.change_date, c.change_item, c.amount, c.voucher_id, c.year, c.period,
              c.change_kind, fa.asset_name
         FROM fixed_asset_change c
         LEFT JOIN fixed_asset fa ON fa.account_set_id = c.account_set_id AND fa.asset_no = c.asset_no
        WHERE c.account_set_id=? AND c.change_kind IN (${CHANGE_VOUCHER_KINDS.map(() => '?').join(',')})`
    )
    .all(accountSetId, ...CHANGE_VOUCHER_KINDS) as any[]
  return changes.map(c => {
    const ym = ymOf(c.change_date) ?? { year: c.year, period: c.period }
    return buildRow(
      db,
      accountSetId,
      {
        kind: 'change',
        refId: c.id,
        title: `${c.change_item || '资产变动'}：${c.asset_name || c.asset_no}`,
        assetNo: c.asset_no,
        assetName: c.asset_name ?? null,
        year: Number(c.year) || ym.year,
        period: Number(c.period) || ym.period,
        amount: c.amount == null ? null : round2(Number(c.amount)),
        summary: null,
        changeKind: c.change_kind,
      },
      c.voucher_id
    )
  })
}

function listDisposal(db: Database, accountSetId: string): AssetVoucherRow[] {
  const start = accountSetStartMonth(db, accountSetId)
  const cards = db
    .prepare(
      `SELECT id, asset_no, asset_name, scrap_date, original_value, scrap_voucher_id
         FROM fixed_asset WHERE account_set_id=? AND scrap_date IS NOT NULL`
    )
    .all(accountSetId) as any[]
  const rows: AssetVoucherRow[] = []
  for (const c of cards) {
    const v = getVoucher(db, accountSetId, c.scrap_voucher_id)
    const ym = v ? { year: v.year, period: v.period } : ymOf(c.scrap_date)
    if (!v) {
      if (!start || String(c.scrap_date).slice(0, 7) < start) continue
      // 盘点盘亏核销的卡片，凭证挂在盘点上，由「盘点」类型管理
      const byInventory = db
        .prepare(
          `SELECT 1 FROM fixed_asset_inventory_item i
             JOIN fixed_asset_inventory inv ON inv.id = i.inventory_id
            WHERE i.account_set_id=? AND i.asset_no=? AND i.actual_status IN ('deficit','damaged')
              AND inv.status='completed' AND substr(inv.inventory_date,1,10)=? LIMIT 1`
        )
        .get(accountSetId, c.asset_no, String(c.scrap_date).slice(0, 10))
      if (byInventory) continue
    }
    rows.push(
      buildRow(
        db,
        accountSetId,
        {
          kind: 'disposal',
          refId: c.id,
          title: `处置资产：${c.asset_name}`,
          assetNo: c.asset_no,
          assetName: c.asset_name,
          year: ym?.year ?? null,
          period: ym?.period ?? null,
          amount: round2(Number(c.original_value || 0)),
          summary: null,
        },
        c.scrap_voucher_id
      )
    )
  }
  return rows
}

function listInventory(db: Database, accountSetId: string): AssetVoucherRow[] {
  const invs = db
    .prepare(
      `SELECT id, name, inventory_date FROM fixed_asset_inventory
        WHERE account_set_id=? AND status='completed'`
    )
    .all(accountSetId) as any[]
  const rows: AssetVoucherRow[] = []
  for (const inv of invs) {
    const stat = db
      .prepare(
        `SELECT SUM(CASE WHEN actual_status='surplus' THEN 1 ELSE 0 END) AS s,
                SUM(CASE WHEN actual_status IN ('deficit','damaged') THEN 1 ELSE 0 END) AS d,
                MAX(voucher_id) AS voucher_id
           FROM fixed_asset_inventory_item WHERE inventory_id=?`
      )
      .get(inv.id) as { s: number | null; d: number | null; voucher_id: string | null }
    if (!(Number(stat.s) > 0) && !(Number(stat.d) > 0)) continue // 无盘盈盘亏，本就不产生凭证
    const ym = ymOf(inv.inventory_date)
    rows.push(
      buildRow(
        db,
        accountSetId,
        {
          kind: 'inventory',
          refId: inv.id,
          title: `盘点调整：${inv.name || inv.id}`,
          assetNo: null,
          assetName: null,
          year: ym?.year ?? null,
          period: ym?.period ?? null,
          amount: null,
          summary: `盘盈 ${Number(stat.s) || 0} · 盘亏 ${Number(stat.d) || 0}`,
        },
        stat.voucher_id
      )
    )
  }
  return rows
}

export function listAssetVouchers(
  db: Database,
  accountSetId: string,
  filters: ListAssetVouchersFilters = {}
): { total: number; list: AssetVoucherRow[] } {
  const kinds = filters.kind ? [filters.kind] : ASSET_VOUCHER_KINDS
  let rows: AssetVoucherRow[] = []
  for (const k of kinds) {
    if (k === 'purchase') rows = rows.concat(listPurchase(db, accountSetId))
    else if (k === 'depr') rows = rows.concat(listDepr(db, accountSetId))
    else if (k === 'change') rows = rows.concat(listChange(db, accountSetId))
    else if (k === 'disposal') rows = rows.concat(listDisposal(db, accountSetId))
    else if (k === 'inventory') rows = rows.concat(listInventory(db, accountSetId))
  }
  if (filters.refId) rows = rows.filter(r => r.refId === filters.refId)
  if (filters.year) rows = rows.filter(r => r.year === filters.year)
  if (filters.month) rows = rows.filter(r => r.period === filters.month)
  if (filters.status === 'generated') rows = rows.filter(r => r.hasVoucher)
  if (filters.status === 'missing') rows = rows.filter(r => !r.hasVoucher)
  const kw = (filters.keyword || '').trim().toLowerCase()
  if (kw) {
    rows = rows.filter(r =>
      [r.title, r.assetNo, r.assetName, r.voucherNo].some(t => String(t || '').toLowerCase().includes(kw))
    )
  }
  // 期间新→旧，同期间未生成的排前（待处理优先），再按标题稳定排序
  rows.sort((a, b) => {
    const ka = (a.year ?? 0) * 100 + (a.period ?? 0)
    const kb = (b.year ?? 0) * 100 + (b.period ?? 0)
    if (ka !== kb) return kb - ka
    if (a.hasVoucher !== b.hasVoucher) return a.hasVoucher ? 1 : -1
    return a.title.localeCompare(b.title, 'zh-CN')
  })
  const total = rows.length
  const pageSize = Math.min(Math.max(filters.pageSize || 50, 1), 500)
  const page = Math.max(filters.page || 1, 1)
  return { total, list: rows.slice((page - 1) * pageSize, page * pageSize) }
}

// ── 业务记录定位 ──────────────────────────────────────────

interface Target {
  voucherId: string | null
  clearLink: () => void
}

function resolveTarget(db: Database, accountSetId: string, kind: AssetVoucherKind, refId: string): Target {
  if (kind === 'purchase' || kind === 'disposal') {
    const col = kind === 'purchase' ? 'purchase_voucher_id' : 'scrap_voucher_id'
    const row = db
      .prepare(`SELECT id, ${col} AS vid FROM fixed_asset WHERE id=? AND account_set_id=?`)
      .get(refId, accountSetId) as { id: string; vid: string | null } | undefined
    if (!row) throw new Error('资产不存在')
    return {
      voucherId: row.vid,
      clearLink: () => {
        db.prepare(`UPDATE fixed_asset SET ${col}=NULL, updated_at=datetime('now') WHERE id=?`).run(row.id)
      },
    }
  }
  if (kind === 'depr') {
    const m = /^(\d{4})-(\d{1,2})$/.exec(refId)
    if (!m) throw new Error('折旧期间格式应为 年-月')
    const year = Number(m[1])
    const month = Number(m[2])
    const rows = db
      .prepare('SELECT DISTINCT voucher_id FROM fixed_asset_depr WHERE account_set_id=? AND year=? AND month=?')
      .all(accountSetId, year, month) as Array<{ voucher_id: string | null }>
    if (rows.length === 0) throw new Error('该期间没有折旧记录')
    const vid = rows.map(r => r.voucher_id).find(Boolean) ?? null
    return {
      voucherId: vid,
      clearLink: () => {
        db.prepare('UPDATE fixed_asset_depr SET voucher_id=NULL WHERE account_set_id=? AND year=? AND month=?').run(
          accountSetId,
          year,
          month
        )
      },
    }
  }
  if (kind === 'change') {
    const row = db
      .prepare('SELECT id, voucher_id FROM fixed_asset_change WHERE id=? AND account_set_id=?')
      .get(refId, accountSetId) as { id: string; voucher_id: string | null } | undefined
    if (!row) throw new Error('变动记录不存在')
    return {
      voucherId: row.voucher_id,
      clearLink: () => {
        db.prepare('UPDATE fixed_asset_change SET voucher_id=NULL WHERE id=?').run(row.id)
      },
    }
  }
  // inventory
  const inv = db
    .prepare('SELECT id FROM fixed_asset_inventory WHERE id=? AND account_set_id=?')
    .get(refId, accountSetId)
  if (!inv) throw new Error('盘点记录不存在')
  const vid =
    (db
      .prepare('SELECT voucher_id FROM fixed_asset_inventory_item WHERE inventory_id=? AND voucher_id IS NOT NULL LIMIT 1')
      .get(refId) as { voucher_id: string } | undefined)?.voucher_id ?? null
  return {
    voucherId: vid,
    clearLink: () => {
      db.prepare('UPDATE fixed_asset_inventory_item SET voucher_id=NULL WHERE inventory_id=?').run(refId)
    },
  }
}

// ── 只删凭证 ─────────────────────────────────────────────

export interface DeleteAssetVoucherResult {
  voucherNo: string | null
  /** 被删凭证所在的 (年, 期, 类型) 分组，供前端提示重新排号 */
  affectedGroups: Array<{ year: number; period: number; voucher_type_id: string | null }>
}

export function deleteAssetVoucherOnly(params: {
  db: Database
  accountSetId: string
  kind: AssetVoucherKind
  refId: string
}): DeleteAssetVoucherResult {
  const { db, accountSetId, kind, refId } = params
  const target = resolveTarget(db, accountSetId, kind, refId)
  const voucher = getVoucher(db, accountSetId, target.voucherId)
  if (!voucher) {
    // 回链悬空（凭证已被别的途径删除）：只清回链，让业务回到「未生成」
    db.transaction(() => target.clearLink())()
    return { voucherNo: null, affectedGroups: [] }
  }
  const reason = deleteBlockReasonOf(db, accountSetId, voucher)
  if (reason) throw new Error(`${reason}：${voucher.voucher_no}`)

  db.transaction(() => {
    deleteVoucherWithRefs(db, accountSetId, { ...voucher, source: null })
    target.clearLink()
  })()
  return {
    voucherNo: voucher.voucher_no,
    affectedGroups: [{ year: voucher.year, period: voucher.period, voucher_type_id: voucher.voucher_type_id ?? null }],
  }
}

// ── 重新生成 ─────────────────────────────────────────────

export interface RegenerateAssetVoucherInput {
  /** 购置：贷方（资金来源）科目，默认 1001 */
  creditAccount?: string
  /** 原值变动 / 改良：对方科目（必填） */
  counterAccount?: string
  /** 折旧 / 处置 / 盘点：累计折旧科目，默认 1602 */
  accumAccount?: string
  /** 处置：清理科目，默认取类别配置，回退 1606 */
  clearingAccount?: string
  disposalIncome?: number
  disposalExpense?: number
  /** 盘点：盘盈 / 盘亏对应科目，缺省取资产参数 */
  surplusAccount?: string
  deficitAccount?: string
  /** 本次指定的凭证类型（已校验）；优先于各业务的 asset:*_voucher_type_id 参数 */
  voucherTypeId?: string | null
}

export interface RegenerateAssetVoucherResult {
  voucherId: string
  voucherNo: string
}

/**
 * 折旧补生成凭证（整期合并一张）。路由 /asset/depr/generate-voucher 与凭证管理共用。
 * 错误文案与原路由保持一致。
 */
export function generateDeprVoucherForPeriod(params: {
  db: Database
  accountSetId: string
  year: number
  month: number
  accumAccount?: string
  makerName: string
  voucherTypeId: string | null
}): RegenerateAssetVoucherResult {
  const { db, accountSetId, year, month } = params
  const deprRows = db
    .prepare('SELECT voucher_id FROM fixed_asset_depr WHERE account_set_id=? AND year=? AND month=?')
    .all(accountSetId, year, month) as Array<{ voucher_id: string | null }>
  if (deprRows.length === 0) throw new Error('该期间没有折旧记录，请先计提折旧')
  // 校验未生成（voucher_id 非空且对应凭证仍存在 → 已生成）
  const existingVid = deprRows.find(r => r.voucher_id)?.voucher_id
  if (existingVid && db.prepare('SELECT id FROM vouchers WHERE id=?').get(existingVid)) {
    throw new Error('该期间已生成凭证，请勿重复生成')
  }
  const lines = buildDeprLinesFromHistory({ db, accountSetId, year, month })
  if (lines.length === 0) throw new Error('该期间无可生成凭证的折旧明细')

  return db.transaction(() => {
    const r = generateDeprVoucher({
      db,
      accountSetId,
      year,
      month,
      lines,
      deprAccumAccount: params.accumAccount || '1602',
      makerName: params.makerName,
      voucherTypeId: params.voucherTypeId,
    })
    db.prepare('UPDATE fixed_asset_depr SET voucher_id=? WHERE account_set_id=? AND year=? AND month=?').run(
      r.voucherId,
      accountSetId,
      year,
      month
    )
    return { voucherId: r.voucherId, voucherNo: r.voucherNo }
  })()
}

function paramOrNull(db: Database, accountSetId: string, key: string): string | null {
  return getAssetParam(db, accountSetId, key)
}

export function regenerateAssetVoucher(params: {
  db: Database
  accountSetId: string
  kind: AssetVoucherKind
  refId: string
  input?: RegenerateAssetVoucherInput
  operatorName: string
  /** 科目授权范围：生成后校验，超权整体回滚 */
  accountScope?: unknown
}): RegenerateAssetVoucherResult {
  const { db, accountSetId, kind, refId, operatorName } = params
  const input = params.input ?? {}

  return db.transaction((): RegenerateAssetVoucherResult => {
    let result: RegenerateAssetVoucherResult

    if (kind === 'purchase') {
      const asset = db
        .prepare('SELECT * FROM fixed_asset WHERE id=? AND account_set_id=?')
        .get(refId, accountSetId) as any
      if (!asset) throw new Error('资产不存在')
      if (getVoucher(db, accountSetId, asset.purchase_voucher_id)) {
        throw new Error('该资产已有购置凭证，请先删除后再重新生成')
      }
      const r = generatePurchaseVoucher({
        db,
        accountSetId,
        asset,
        creditAccount: (input.creditAccount || '1001').trim(),
        voucherTypeId: input.voucherTypeId || paramOrNull(db, accountSetId, 'asset:purchase_voucher_type_id'),
        makerName: operatorName,
      })
      db.prepare('UPDATE fixed_asset SET purchase_voucher_id=? WHERE id=?').run(r.voucherId, asset.id)
      result = { voucherId: r.voucherId, voucherNo: r.voucherNo }
    } else if (kind === 'depr') {
      const m = /^(\d{4})-(\d{1,2})$/.exec(refId)
      if (!m) throw new Error('折旧期间格式应为 年-月')
      result = generateDeprVoucherForPeriod({
        db,
        accountSetId,
        year: Number(m[1]),
        month: Number(m[2]),
        accumAccount: input.accumAccount,
        makerName: operatorName,
        voucherTypeId: input.voucherTypeId || paramOrNull(db, accountSetId, 'asset:depr_voucher_type_id'),
      })
    } else if (kind === 'change') {
      const change = db
        .prepare('SELECT * FROM fixed_asset_change WHERE id=? AND account_set_id=?')
        .get(refId, accountSetId) as any
      if (!change) throw new Error('变动记录不存在')
      if (getVoucher(db, accountSetId, change.voucher_id)) {
        throw new Error('该变动已有凭证，请先删除后再重新生成')
      }
      if (!CHANGE_VOUCHER_KINDS.includes(change.change_kind)) throw new Error('该类型的变动不产生凭证')
      const counter = (input.counterAccount || '').trim()
      if (change.change_kind !== 'impairment' && !counter) throw new Error('请选择对方科目')
      const r = regenerateChangeVoucher({
        db,
        accountSetId,
        change,
        counterAccount: counter || null,
        voucherTypeId: input.voucherTypeId || paramOrNull(db, accountSetId, 'asset:change_voucher_type_id'),
        operatorName,
      })
      db.prepare('UPDATE fixed_asset_change SET voucher_id=? WHERE id=?').run(r.voucherId, change.id)
      result = r
    } else if (kind === 'disposal') {
      result = regenerateDisposalVoucher({
        db,
        accountSetId,
        assetId: refId,
        disposalIncome: Number(input.disposalIncome || 0),
        disposalExpense: Number(input.disposalExpense || 0),
        accumAccount: input.accumAccount,
        clearingAccount: input.clearingAccount,
        operatorName,
        voucherTypeId: input.voucherTypeId || paramOrNull(db, accountSetId, 'asset:disposal_voucher_type_id'),
      })
    } else {
      result = regenerateInventoryVoucher({
        db,
        accountSetId,
        inventoryId: refId,
        accumAccount: input.accumAccount,
        surplusAccount: input.surplusAccount || paramOrNull(db, accountSetId, 'asset:inventory_surplus_account') || undefined,
        deficitAccount: input.deficitAccount || paramOrNull(db, accountSetId, 'asset:inventory_deficit_account') || undefined,
        operatorName,
        ...(input.voucherTypeId ? { voucherTypeId: input.voucherTypeId } : {}),
      })
    }

    // 科目授权：分录科目须在授权范围内，超权整体回滚（凭证与回链一并撤销）
    const scopeErr = assertVoucherEntriesInScopeById(db, params.accountScope as any, result.voucherId, accountSetId)
    if (scopeErr) throw new Error(scopeErr)
    return result
  })()
}
