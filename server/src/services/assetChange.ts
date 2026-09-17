/**
 * 固定资产变动引擎（P1-2）
 *
 * 承载主流财务软件（用友 U8 / 金蝶 K3）里「资产变动单」的全部类型：
 *   original_value  原值变动（增值/减值调整，生成凭证）
 *   dept            部门调拨（含使用人、存放地点）
 *   status          使用状态变更（停用/启用，影响是否计提折旧）
 *   depr_factor     折旧要素调整（折旧方法/使用月数/残值率/总工作量）
 *   split           资产拆分（一拆多，原值与累计折旧按比例分摊）
 *   impairment      计提减值准备（P2）
 *   improvement     大修理/改良资本化（P2）
 *
 * 会计准则「未来适用法」：变动一律不重算历史折旧，只影响后续期间。
 * 剩余期间摊余逻辑见 fixedAssetDepreciation.getRemainingBaseForAsset。
 */
import type { Database } from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'
import {
  insertAssetVoucher,
  loadAssetAuxContext,
  resolveAssetAuxRefs,
  auxRefsForAccount,
  resolveAccounts,
  assertPeriodOpen,
  assertNotAfterCurrentPeriod,
  getAssetParam,
  normalizeSalvageRate,
} from './assetVoucherBuilder.js'
import { deleteVoucherRecords, type VoucherEntryInput } from './voucherEntry.js'

export type AssetChangeKind =
  | 'original_value'
  | 'dept'
  | 'status'
  | 'depr_factor'
  | 'split'
  | 'impairment'
  | 'improvement'

/** 会改变折旧计算基数、需要按剩余期间重新摊余的变动类型 */
export const REBASE_CHANGE_KINDS: AssetChangeKind[] = [
  'original_value',
  'depr_factor',
  'impairment',
  'improvement',
]

const KIND_LABELS: Record<AssetChangeKind, string> = {
  original_value: '原值变动',
  dept: '部门调拨',
  status: '使用状态变更',
  depr_factor: '折旧要素调整',
  split: '资产拆分',
  impairment: '计提减值准备',
  improvement: '大修改良',
}

/** 折旧要素调整可改的字段及其中文名 */
const DEPR_FACTOR_FIELDS: Record<string, string> = {
  depr_method: '折旧方法',
  use_months: '使用月数',
  salvage_rate: '残值率',
  total_workload: '总工作量',
}

export interface ApplyChangeParams {
  db: Database
  accountSetId: string
  assetId: string
  kind: AssetChangeKind
  changeDate: string
  changeTypeCode?: string | null
  payload: Record<string, any>
  generateVoucher?: boolean
  /** 原值变动/减值/改良的对方科目 */
  counterAccount?: string | null
  remark?: string | null
  operatorName?: string
  operatorId?: string | null
  voucherTypeId?: string | null
}

export interface ApplyChangeResult {
  changeId: string
  changeIds: string[]
  voucherId: string | null
  voucherNo: string | null
  voucherWarning: string | null
  /** 资产拆分时新建的子卡片 */
  createdAssets?: Array<{ id: string; asset_no: string; asset_name: string }>
  /** P1-18：已提满资产增值后自动顺延的使用月数 */
  extendedMonths?: number
}

const round2 = (n: number) => Math.round(n * 100) / 100

/** 净值 = 原值 - 累计折旧 - 累计减值准备 */
function calcNetValue(originalValue: number, accumDepr: number, impairment: number): number {
  return round2(originalValue - accumDepr - impairment)
}

// ── 前置校验 ───────────────────────────────────────────────

/**
 * 变动日期不得早于该资产最后一次已计提折旧的期间，
 * 否则历史折旧的计算基数与变动后的资产状态会对不上。
 */
function assertNotBeforeLastDepr(
  db: Database,
  accountSetId: string,
  assetNo: string,
  year: number,
  period: number
): void {
  const row = db
    .prepare(
      'SELECT MAX(year * 100 + month) AS ym FROM fixed_asset_depr WHERE account_set_id=? AND asset_no=?'
    )
    .get(accountSetId, assetNo) as { ym: number | null } | undefined
  const lastYm = row?.ym
  if (!lastYm) return
  if (year * 100 + period < lastYm) {
    const y = Math.floor(lastYm / 100)
    const m = lastYm % 100
    throw new Error(`该资产已计提至 ${y}年${m}月，变动日期不能早于该期间`)
  }
}

function loadAsset(db: Database, accountSetId: string, assetId: string): any {
  const asset = db
    .prepare('SELECT * FROM fixed_asset WHERE id=? AND account_set_id=?')
    .get(assetId, accountSetId) as any
  if (!asset) throw new Error('资产不存在')
  return asset
}

// ── 主入口 ─────────────────────────────────────────────────

export function applyAssetChange(params: ApplyChangeParams): ApplyChangeResult {
  const {
    db,
    accountSetId,
    assetId,
    kind,
    changeDate,
    changeTypeCode = null,
    payload = {},
    generateVoucher = false,
    counterAccount = null,
    remark = null,
    operatorName = '系统',
    operatorId = null,
    voucherTypeId = null,
  } = params

  if (!KIND_LABELS[kind]) throw new Error(`不支持的变动类型：${kind}`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(changeDate || '')) {
    throw new Error('变动日期格式应为 YYYY-MM-DD')
  }

  const year = parseInt(changeDate.split('-')[0])
  const period = parseInt(changeDate.split('-')[1])

  const asset = loadAsset(db, accountSetId, assetId)
  if (asset.scrap_date || asset.status_code === '04') {
    throw new Error('该资产已处置，不能再登记变动。如需修改请先撤销处置')
  }
  if (asset.start_depr_date && changeDate < asset.start_depr_date) {
    throw new Error(`变动日期不能早于资产的开始折旧日期（${asset.start_depr_date}）`)
  }
  assertPeriodOpen(db, accountSetId, year, period)
  assertNotAfterCurrentPeriod(year, period, '变动日期')
  assertNotBeforeLastDepr(db, accountSetId, asset.asset_no, year, period)

  const ctx: ChangeContext = {
    db,
    accountSetId,
    asset,
    changeDate,
    year,
    period,
    changeTypeCode,
    payload,
    remark,
    operatorName,
    operatorId,
    generateVoucher,
    counterAccount,
    voucherTypeId,
  }

  let result!: ApplyChangeResult
  db.transaction(() => {
    switch (kind) {
      case 'original_value':
      case 'improvement':
        result = applyValueChange(ctx, kind)
        break
      case 'impairment':
        result = applyImpairment(ctx)
        break
      case 'dept':
        result = applyDeptChange(ctx)
        break
      case 'status':
        result = applyStatusChange(ctx)
        break
      case 'depr_factor':
        result = applyDeprFactorChange(ctx)
        break
      case 'split':
        result = applySplit(ctx)
        break
    }
  })()

  return result
}

interface ChangeContext {
  db: Database
  accountSetId: string
  asset: any
  changeDate: string
  year: number
  period: number
  changeTypeCode: string | null
  payload: Record<string, any>
  remark: string | null
  operatorName: string
  operatorId: string | null
  generateVoucher: boolean
  counterAccount: string | null
  voucherTypeId: string | null
}

/** 写一条变动流水，返回其 id */
/** 原值类变动写入 old_text 的旧值快照（见 applyValueChange） */
interface ValueChangeSnapshot {
  salvage_rate: number
  salvage_value: number
  use_months: number
}

/** 解析原值类变动的快照；旧记录没有快照时返回 null，调用方退回兼容行为。 */
function parseValueSnapshot(text: unknown): ValueChangeSnapshot | null {
  if (typeof text !== 'string' || !text.startsWith('{')) return null
  try {
    const o = JSON.parse(text)
    if (o == null || typeof o !== 'object') return null
    return {
      salvage_rate: Number(o.salvage_rate || 0),
      salvage_value: Number(o.salvage_value || 0),
      use_months: Number(o.use_months || 0),
    }
  } catch {
    return null
  }
}

function writeChange(
  ctx: ChangeContext,
  row: {
    kind: AssetChangeKind
    changeItem: string
    oldValue?: number | null
    newValue?: number | null
    amount?: number | null
    oldText?: string | null
    newText?: string | null
    fieldKey?: string | null
    voucherId?: string | null
    assetNo?: string
  }
): string {
  const id = uuidv4()
  ctx.db
    .prepare(
      `INSERT INTO fixed_asset_change
         (id, account_set_id, asset_no, change_date, change_item,
          old_value, new_value, amount, remark, operator,
          change_kind, change_type_code, field_key, old_text, new_text,
          voucher_id, year, period, created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    )
    .run(
      id,
      ctx.accountSetId,
      row.assetNo ?? ctx.asset.asset_no,
      ctx.changeDate,
      row.changeItem,
      row.oldValue ?? null,
      row.newValue ?? null,
      row.amount ?? null,
      ctx.remark,
      ctx.operatorName,
      row.kind,
      ctx.changeTypeCode,
      row.fieldKey ?? null,
      row.oldText ?? null,
      row.newText ?? null,
      row.voucherId ?? null,
      ctx.year,
      ctx.period,
      ctx.operatorId
    )
  return id
}

// ── 原值变动 / 大修改良 ────────────────────────────────────

/**
 * 原值增减。amount > 0 为增加、< 0 为减少。
 * 改良（improvement）本质同为原值增加，另允许同时延长使用月数。
 *
 * 凭证：
 *   增加：借 类别固定资产科目 / 贷 对方科目（在建工程、银行存款…）
 *   减少：反向
 */
function applyValueChange(
  ctx: ChangeContext,
  kind: 'original_value' | 'improvement'
): ApplyChangeResult {
  const { db, accountSetId, asset } = ctx
  const amount = round2(Number(ctx.payload.amount ?? 0))
  if (!amount) throw new Error('变动金额不能为 0')

  const oldOriginal = Number(asset.original_value || 0)
  const newOriginal = round2(oldOriginal + amount)
  if (newOriginal < 0) throw new Error('变动后原值不能为负数')

  // 残值按残值率同步重算（残值率本身可在本次一并调整）
  // AS-P0-1：残值率统一为小数口径（>1 视为百分数 ÷100），防止卡片页历史百分数把残值放大
  const salvageRateRaw =
    ctx.payload.salvage_rate != null
      ? ctx.payload.salvage_rate
      : asset.salvage_rate || 0
  const salvageRate = normalizeSalvageRate(salvageRateRaw)
  if (salvageRate === null) throw new Error('残值率必须是大于等于 0 且小于 1 的小数（如 0.05 表示 5%）')
  const newSalvage = round2(newOriginal * salvageRate)

  // P1-17：原值减少不得低于「累计折旧 + 减值准备」，否则净值为负——折旧静默停提、处置凭证必然借贷不平
  const valueFloor = round2(Number(asset.accum_depr || 0) + Number(asset.impairment_amount || 0))
  if (newOriginal < valueFloor) {
    throw new Error(
      `变动后原值 ${newOriginal.toFixed(2)} 不能低于累计折旧与减值准备之和 ${valueFloor.toFixed(2)}，请先办理处置或减少变动金额`
    )
  }
  if (newSalvage > round2(newOriginal - valueFloor)) {
    throw new Error(
      `变动后残值 ${newSalvage.toFixed(2)} 不能高于剩余净值 ${round2(newOriginal - valueFloor).toFixed(2)}，请调低残值率`
    )
  }

  // 改良可延长使用月数
  let newUseMonths = Number(asset.use_months || 0)
  if (kind === 'improvement' && ctx.payload.use_months != null) {
    newUseMonths = Number(ctx.payload.use_months)
    if (newUseMonths <= Number(asset.depr_months_done || 0)) {
      throw new Error('调整后的使用月数必须大于已计提月数')
    }
  }

  const impairment = Number(asset.impairment_amount || 0)
  const newNetValue = calcNetValue(newOriginal, Number(asset.accum_depr || 0), impairment)

  // P1-18：已提满（depr_months_done >= use_months）的资产增加原值 / 改良后，若没有一并延长月数，
  // 折旧函数首行 `done >= use_months` 直接返回 0、预览也把它过滤掉，新增的应折金额永久不折。
  // 按原月折旧额推算需要补提的月数并自动顺延，调用方据 extendedMonths 提示用户。
  let extendedMonths = 0
  const doneMonths = Number(asset.depr_months_done || 0)
  const isWorkload = String(asset.depr_method || '') === '2'
  if (!isWorkload && doneMonths >= newUseMonths && newNetValue > newSalvage) {
    const oldUseMonths = Number(asset.use_months || 0)
    const oldMonthly =
      oldUseMonths > 0 ? (oldOriginal - Number(asset.salvage_value || 0)) / oldUseMonths : 0
    const remaining = round2(newNetValue - newSalvage)
    extendedMonths = oldMonthly > 0 ? Math.max(1, Math.ceil(remaining / oldMonthly)) : 1
    newUseMonths = doneMonths + extendedMonths
  }

  db.prepare(
    `UPDATE fixed_asset SET
       original_value = ?, salvage_rate = ?, salvage_value = ?, use_months = ?,
       net_value = ?, updated_at = datetime('now')
     WHERE id = ?`
  ).run(newOriginal, salvageRate, newSalvage, newUseMonths, newNetValue, asset.id)

  const voucher = ctx.generateVoucher ? generateValueChangeVoucher(ctx, kind, amount) : null

  // FIX：撤销时需要还原的不止 original_value——本次可能一并改了残值率与使用月数，
  // 把这些旧值以 JSON 快照存进 old_text（该字段在原值类变动中原本未使用，无需迁移）。
  const changeId = writeChange(ctx, {
    kind,
    changeItem: kind === 'improvement' ? '大修改良' : '原值增减',
    oldValue: oldOriginal,
    newValue: newOriginal,
    amount,
    oldText: JSON.stringify({
      salvage_rate: Number(asset.salvage_rate || 0),
      salvage_value: Number(asset.salvage_value || 0),
      use_months: Number(asset.use_months || 0),
    }),
    voucherId: voucher?.voucherId ?? null,
  })

  return {
    changeId,
    changeIds: [changeId],
    voucherId: voucher?.voucherId ?? null,
    voucherNo: voucher?.voucherNo ?? null,
    voucherWarning: voucher?.warning ?? null,
    extendedMonths: extendedMonths || undefined,
  }
}

function generateValueChangeVoucher(
  ctx: ChangeContext,
  kind: 'original_value' | 'improvement',
  amount: number
): { voucherId: string; voucherNo: string; warning: string | null } | null {
  const { db, accountSetId, asset } = ctx
  const counter = (ctx.counterAccount || '').trim()
  if (!counter) throw new Error('生成凭证时必须指定对方科目')

  const assetCat = (
    asset.category_code
      ? db
          .prepare(
            'SELECT account_code FROM fixed_asset_category WHERE account_set_id=? AND code=?'
          )
          .get(accountSetId, asset.category_code)
      : null
  ) as any
  const assetAccount = assetCat?.account_code || '1601'

  const accounts = resolveAccounts(db, accountSetId, [assetAccount, counter], KIND_LABELS[kind])
  const auxContext = loadAssetAuxContext(db, accountSetId)
  const refs = resolveAssetAuxRefs(db, accountSetId, asset, auxContext)

  const abs = Math.abs(amount)
  const summary = `${KIND_LABELS[kind]}：${asset.asset_name}（编号 ${asset.asset_no}）`
  const entryOf = (code: string, direction: 'debit' | 'credit'): VoucherEntryInput => {
    const acc = accounts.get(code)!
    return {
      account_id: acc.id,
      account_code: acc.code,
      account_name: acc.name,
      direction,
      amount: abs,
      summary,
      ...auxRefsForAccount(db, accountSetId, acc.code, refs, auxContext),
    }
  }

  // 原值增加：借固定资产 / 贷对方；减少反向
  const entries =
    amount > 0
      ? [entryOf(assetAccount, 'debit'), entryOf(counter, 'credit')]
      : [entryOf(counter, 'debit'), entryOf(assetAccount, 'credit')]

  const result = insertAssetVoucher({
    db,
    accountSetId,
    source: 'asset_change',
    voucherDate: ctx.changeDate,
    year: ctx.year,
    period: ctx.period,
    remark: summary,
    makerName: ctx.operatorName,
    voucherTypeId: ctx.voucherTypeId,
    entries,
    auxContext,
    skipPeriodCheck: true,
  })
  return { voucherId: result.voucherId, voucherNo: result.voucherNo, warning: null }
}

// ── 计提减值准备 ───────────────────────────────────────────

/**
 * 计提减值准备：借 资产减值损失 / 贷 类别配置的减值准备科目。
 * 按会计准则，固定资产减值一经计提不得转回，故只支持计提，撤销走 revokeAssetChange。
 */
function applyImpairment(ctx: ChangeContext): ApplyChangeResult {
  const { db, accountSetId, asset } = ctx
  const amount = round2(Number(ctx.payload.amount ?? 0))
  if (!(amount > 0)) throw new Error('减值金额必须大于 0')

  const oldImpairment = Number(asset.impairment_amount || 0)
  const netValue = Number(asset.net_value || 0)
  if (amount > netValue) {
    throw new Error(`减值金额不能超过资产当前净值（${netValue}）`)
  }

  const newImpairment = round2(oldImpairment + amount)
  const newNetValue = calcNetValue(
    Number(asset.original_value || 0),
    Number(asset.accum_depr || 0),
    newImpairment
  )
  db.prepare(
    `UPDATE fixed_asset SET impairment_amount = ?, net_value = ?, updated_at = datetime('now')
      WHERE id = ?`
  ).run(newImpairment, newNetValue, asset.id)

  let voucherId: string | null = null
  let voucherNo: string | null = null
  if (ctx.generateVoucher) {
    const assetCat = (
      asset.category_code
        ? db
            .prepare(
              'SELECT impairment_account_code FROM fixed_asset_category WHERE account_set_id=? AND code=?'
            )
            .get(accountSetId, asset.category_code)
        : null
    ) as any
    const impairAccount = assetCat?.impairment_account_code
    if (!impairAccount) {
      throw new Error('该资产类别未配置「减值准备科目」，请先到「资产档案 → 资产类别」中设置')
    }
    const lossAccount = getAssetParam(db, accountSetId, 'asset:impairment_loss_account') || '6701'

    const accounts = resolveAccounts(db, accountSetId, [lossAccount, impairAccount], '资产减值')
    const auxContext = loadAssetAuxContext(db, accountSetId)
    const refs = resolveAssetAuxRefs(db, accountSetId, asset, auxContext)
    const summary = `计提减值准备：${asset.asset_name}（编号 ${asset.asset_no}）`
    const entryOf = (code: string, direction: 'debit' | 'credit'): VoucherEntryInput => {
      const acc = accounts.get(code)!
      return {
        account_id: acc.id,
        account_code: acc.code,
        account_name: acc.name,
        direction,
        amount,
        summary,
        ...auxRefsForAccount(db, accountSetId, acc.code, refs, auxContext),
      }
    }

    const result = insertAssetVoucher({
      db,
      accountSetId,
      source: 'asset_impairment',
      voucherDate: ctx.changeDate,
      year: ctx.year,
      period: ctx.period,
      remark: summary,
      makerName: ctx.operatorName,
      voucherTypeId: ctx.voucherTypeId,
      entries: [entryOf(lossAccount, 'debit'), entryOf(impairAccount, 'credit')],
      auxContext,
      skipPeriodCheck: true,
    })
    voucherId = result.voucherId
    voucherNo = result.voucherNo
  }

  const changeId = writeChange(ctx, {
    kind: 'impairment',
    changeItem: '计提减值准备',
    oldValue: oldImpairment,
    newValue: newImpairment,
    amount,
    voucherId,
  })

  return { changeId, changeIds: [changeId], voucherId, voucherNo, voucherWarning: null }
}

// ── 部门调拨 ───────────────────────────────────────────────

function applyDeptChange(ctx: ChangeContext): ApplyChangeResult {
  const { db, accountSetId, asset } = ctx
  const newDept = (ctx.payload.dept_code ?? '').toString().trim()
  if (!newDept) throw new Error('请选择调入部门')
  if (newDept === (asset.dept_code || '')) throw new Error('调入部门与当前部门相同')

  const exists = db
    .prepare('SELECT code FROM fixed_asset_dept WHERE account_set_id=? AND code=?')
    .get(accountSetId, newDept)
  if (!exists) throw new Error(`部门编码 ${newDept} 不存在，请先在「资产档案 → 使用部门」中建立`)

  const nameOf = (code: string | null) =>
    code
      ? ((
          db
            .prepare('SELECT name FROM fixed_asset_dept WHERE account_set_id=? AND code=?')
            .get(accountSetId, code) as any
        )?.name ?? code)
      : ''

  // 使用人 / 存放地点可随调拨一并变更；未传则保持原值
  const newUser = ctx.payload.user_name != null ? String(ctx.payload.user_name) : asset.user_name
  const newKeeper = ctx.payload.keeper != null ? String(ctx.payload.keeper) : asset.keeper
  const newPlace =
    ctx.payload.install_place != null ? String(ctx.payload.install_place) : asset.install_place

  db.prepare(
    `UPDATE fixed_asset SET dept_code=?, user_name=?, keeper=?, install_place=?, updated_at=datetime('now')
      WHERE id=?`
  ).run(newDept, newUser ?? null, newKeeper ?? null, newPlace ?? null, asset.id)

  const changeId = writeChange(ctx, {
    kind: 'dept',
    // change_item 直接写成可读描述，报表无需再关联部门字典
    changeItem: `部门调拨：${nameOf(asset.dept_code) || '（无）'} → ${nameOf(newDept)}`,
    // AS-P1-13：调拨会一并改使用人/保管人/存放地点，撤销需要整组还原，
    // 快照存 JSON；旧记录仍是纯 dept_code 字符串，撤销时做兼容解析
    oldText: JSON.stringify({
      dept_code: asset.dept_code || null,
      user_name: asset.user_name ?? null,
      keeper: asset.keeper ?? null,
      install_place: asset.install_place ?? null,
    }),
    newText: newDept,
    fieldKey: 'dept_code',
  })

  return { changeId, changeIds: [changeId], voucherId: null, voucherNo: null, voucherWarning: null }
}

// ── 使用状态变更 ───────────────────────────────────────────

/**
 * 状态变更会直接影响是否计提折旧：新状态的 depreciable=0 时，
 * previewDepreciation 的 SQL 过滤条件会自动把该资产排除（停提）。
 */
function applyStatusChange(ctx: ChangeContext): ApplyChangeResult {
  const { db, accountSetId, asset } = ctx
  const newStatus = (ctx.payload.status_code ?? '').toString().trim()
  if (!newStatus) throw new Error('请选择新的使用状态')
  if (newStatus === '04') {
    throw new Error('「已报废」状态请通过「资产处置」办理，以便生成清理凭证')
  }
  if (newStatus === (asset.status_code || '')) throw new Error('新状态与当前状态相同')

  const statusRow = db
    .prepare(
      'SELECT code, name, depreciable FROM fixed_asset_status WHERE account_set_id=? AND code=?'
    )
    .get(accountSetId, newStatus) as any
  if (!statusRow) {
    throw new Error(`使用状态 ${newStatus} 不存在，请先在「资产档案 → 使用状态」中建立`)
  }
  const oldStatusName = asset.status_code
    ? ((
        db
          .prepare('SELECT name FROM fixed_asset_status WHERE account_set_id=? AND code=?')
          .get(accountSetId, asset.status_code) as any
      )?.name ?? asset.status_code)
    : '（无）'

  db.prepare(`UPDATE fixed_asset SET status_code=?, updated_at=datetime('now') WHERE id=?`).run(
    newStatus,
    asset.id
  )

  const changeId = writeChange(ctx, {
    kind: 'status',
    changeItem: `使用状态变更：${oldStatusName} → ${statusRow.name}${statusRow.depreciable ? '' : '（停止计提折旧）'}`,
    oldText: asset.status_code || null,
    newText: newStatus,
    fieldKey: 'status_code',
  })

  return { changeId, changeIds: [changeId], voucherId: null, voucherNo: null, voucherWarning: null }
}

// ── 折旧要素调整 ───────────────────────────────────────────

/**
 * 一次可调整多个折旧要素，每个字段写一条变动流水（便于报表逐项追溯）。
 * 调整后按剩余期间摊余，不重算历史折旧。
 */
function applyDeprFactorChange(ctx: ChangeContext): ApplyChangeResult {
  const { db, asset } = ctx
  const changes: Array<{ field: string; oldVal: any; newVal: any }> = []

  for (const field of Object.keys(DEPR_FACTOR_FIELDS)) {
    if (ctx.payload[field] == null || ctx.payload[field] === '') continue
    const oldVal = asset[field]
    const newVal = field === 'depr_method' ? String(ctx.payload[field]) : Number(ctx.payload[field])
    if (String(oldVal ?? '') === String(newVal)) continue
    changes.push({ field, oldVal, newVal })
  }
  if (changes.length === 0) throw new Error('没有需要调整的折旧要素')

  const deprMonthsDone = Number(asset.depr_months_done || 0)
  const useMonthsChange = changes.find(c => c.field === 'use_months')
  if (useMonthsChange && Number(useMonthsChange.newVal) <= deprMonthsDone) {
    throw new Error(`调整后的使用月数必须大于已计提月数（${deprMonthsDone}）`)
  }
  const methodChange = changes.find(c => c.field === 'depr_method')
  if (methodChange && !['1', '2', '3', '4'].includes(String(methodChange.newVal))) {
    throw new Error('折旧方法只能是 1平均年限 / 2工作量 / 3双倍余额递减 / 4年数总和')
  }

  // 逐字段更新（字段名来自白名单 DEPR_FACTOR_FIELDS，不存在注入风险）
  for (const c of changes) {
    db.prepare(`UPDATE fixed_asset SET ${c.field}=?, updated_at=datetime('now') WHERE id=?`).run(
      c.newVal,
      asset.id
    )
  }

  // 残值率变化时同步重算残值与净值（AS-P0-1：统一小数口径）
  const salvageChange = changes.find(c => c.field === 'salvage_rate')
  if (salvageChange) {
    const normalizedRate = normalizeSalvageRate(salvageChange.newVal)
    if (normalizedRate === null) throw new Error('残值率必须是大于等于 0 且小于 1 的小数（如 0.05 表示 5%）')
    const newSalvage = round2(Number(asset.original_value || 0) * normalizedRate)
    db.prepare('UPDATE fixed_asset SET salvage_value=?, salvage_rate=? WHERE id=?').run(newSalvage, normalizedRate, asset.id)
  }

  const changeIds = changes.map(c =>
    writeChange(ctx, {
      kind: 'depr_factor',
      changeItem: `折旧要素调整：${DEPR_FACTOR_FIELDS[c.field]}`,
      fieldKey: c.field,
      oldText: c.oldVal == null ? null : String(c.oldVal),
      newText: String(c.newVal),
      oldValue: typeof c.oldVal === 'number' ? c.oldVal : null,
      newValue: typeof c.newVal === 'number' ? c.newVal : null,
    })
  )

  return {
    changeId: changeIds[0],
    changeIds,
    voucherId: null,
    voucherNo: null,
    voucherWarning: null,
  }
}

// ── 资产拆分 ───────────────────────────────────────────────

export interface SplitChildInput {
  asset_no?: string
  asset_name?: string
  original_value: number
  qty?: number
  dept_code?: string | null
  user_name?: string | null
  install_place?: string | null
}

/**
 * 资产拆分：原卡片按比例减少原值与累计折旧，差额部分建成 N 张子卡片。
 * 原值总额、累计折旧总额均保持不变，因此不产生凭证。
 */
function applySplit(ctx: ChangeContext): ApplyChangeResult {
  const { db, accountSetId, asset } = ctx
  const children = (ctx.payload.children || []) as SplitChildInput[]
  if (!Array.isArray(children) || children.length === 0) {
    throw new Error('请至少填写一张拆分后的子卡片')
  }

  const oldOriginal = Number(asset.original_value || 0)
  const splitTotal = round2(children.reduce((s, c) => s + Number(c.original_value || 0), 0))
  if (splitTotal <= 0) throw new Error('拆分原值合计必须大于 0')
  if (splitTotal >= oldOriginal) {
    throw new Error(
      `拆分原值合计（${splitTotal}）必须小于资产原值（${oldOriginal}），原卡片需保留部分价值`
    )
  }

  const oldAccumDepr = Number(asset.accum_depr || 0)
  const oldImpairment = Number(asset.impairment_amount || 0)
  const ratio = splitTotal / oldOriginal

  // 累计折旧、减值准备按原值比例分摊到拆出部分
  const splitAccumDepr = round2(oldAccumDepr * ratio)
  const splitImpairment = round2(oldImpairment * ratio)

  // 原卡片保留剩余部分
  const remainOriginal = round2(oldOriginal - splitTotal)
  const remainAccumDepr = round2(oldAccumDepr - splitAccumDepr)
  const remainImpairment = round2(oldImpairment - splitImpairment)
  // P0-3：残值率经归一化再用（卡片上若残留百分数口径，父 / 子卡残值会被放大 100 倍并静默停提），归一后的率一并回写
  const salvageRate = normalizeSalvageRate(asset.salvage_rate) ?? 0

  db.prepare(
    `UPDATE fixed_asset SET
       original_value = ?, accum_depr = ?, impairment_amount = ?,
       salvage_rate = ?, salvage_value = ?, net_value = ?, updated_at = datetime('now')
     WHERE id = ?`
  ).run(
    remainOriginal,
    remainAccumDepr,
    remainImpairment,
    salvageRate,
    round2(remainOriginal * salvageRate),
    calcNetValue(remainOriginal, remainAccumDepr, remainImpairment),
    asset.id
  )

  // 子卡片编号：未指定时沿用「最大编号 + 1」规则（与 GET /asset/cards/next-no 一致）
  const takenNos = new Set<string>()
  const nextAutoNo = (): string => {
    const rows = db
      .prepare('SELECT asset_no FROM fixed_asset WHERE account_set_id=?')
      .all(accountSetId) as Array<{ asset_no: string }>
    const all = rows.map(r => r.asset_no).concat([...takenNos])
    let best: { prefix: string; num: number; width: number } | null = null
    for (const no of all) {
      const m = /^([A-Za-z\-_]*)(\d+)$/.exec(no)
      if (!m) continue
      const num = parseInt(m[2], 10)
      if (!best || num > best.num) best = { prefix: m[1], num, width: m[2].length }
    }
    if (!best) return '0001'
    return `${best.prefix}${String(best.num + 1).padStart(best.width, '0')}`
  }

  const createdAssets: Array<{ id: string; asset_no: string; asset_name: string }> = []
  const changeIds: string[] = []

  const insertChild = db.prepare(
    `INSERT INTO fixed_asset
       (id, account_set_id, asset_no, asset_name, category_code, status_code, dept_code, purpose_code,
        acquire_date, start_depr_date, original_value, salvage_rate, salvage_value, depr_method,
        use_months, use_years, total_workload, accum_depr, impairment_amount, depr_months_done,
        net_value, qty, unit, user_name, keeper, source, install_place, remark)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  )

  for (const child of children) {
    const childOriginal = round2(Number(child.original_value || 0))
    if (childOriginal <= 0) throw new Error('子卡片原值必须大于 0')

    let assetNo = (child.asset_no || '').trim()
    if (!assetNo) assetNo = nextAutoNo()
    if (
      takenNos.has(assetNo) ||
      db
        .prepare('SELECT id FROM fixed_asset WHERE account_set_id=? AND asset_no=?')
        .get(accountSetId, assetNo)
    ) {
      throw new Error(`资产编号 ${assetNo} 已存在`)
    }
    takenNos.add(assetNo)

    // 子卡片按自身原值占拆出总额的比例再分摊累折与减值
    const childRatio = childOriginal / splitTotal
    const childAccumDepr = round2(splitAccumDepr * childRatio)
    const childImpairment = round2(splitImpairment * childRatio)
    const childId = uuidv4()
    const childName = (child.asset_name || '').trim() || `${asset.asset_name}（拆分）`

    insertChild.run(
      childId,
      accountSetId,
      assetNo,
      childName,
      asset.category_code,
      asset.status_code,
      child.dept_code ?? asset.dept_code,
      asset.purpose_code,
      asset.acquire_date,
      asset.start_depr_date,
      childOriginal,
      salvageRate,
      round2(childOriginal * salvageRate),
      asset.depr_method,
      asset.use_months,
      asset.use_years,
      asset.total_workload,
      childAccumDepr,
      childImpairment,
      asset.depr_months_done,
      calcNetValue(childOriginal, childAccumDepr, childImpairment),
      child.qty ?? 1,
      asset.unit,
      child.user_name ?? asset.user_name,
      asset.keeper,
      `拆分自 ${asset.asset_no}`,
      child.install_place ?? asset.install_place,
      ctx.remark
    )

    createdAssets.push({ id: childId, asset_no: assetNo, asset_name: childName })

    // 子卡片侧记一条「拆分转入」
    changeIds.push(
      writeChange(ctx, {
        kind: 'split',
        changeItem: `资产拆分转入（来自 ${asset.asset_no}）`,
        assetNo,
        oldValue: 0,
        newValue: childOriginal,
        amount: childOriginal,
        oldText: asset.asset_no,
        newText: assetNo,
      })
    )
  }

  // 原卡片侧记一条「拆分转出」
  changeIds.unshift(
    writeChange(ctx, {
      kind: 'split',
      changeItem: `资产拆分转出（拆出 ${createdAssets.length} 张卡片）`,
      oldValue: oldOriginal,
      newValue: remainOriginal,
      amount: -splitTotal,
      newText: createdAssets.map(a => a.asset_no).join(','),
    })
  )

  return {
    changeId: changeIds[0],
    changeIds,
    voucherId: null,
    voucherNo: null,
    voucherWarning: null,
    createdAssets,
  }
}

// ── 撤销变动 ───────────────────────────────────────────────

/**
 * 撤销一条变动：回滚资产字段并删除关联凭证。
 *
 * 限制（与反折旧、撤销处置一致）：
 *  - 关联凭证已记账 → 拒绝
 *  - 该资产在本次变动之后又有更晚的变动 → 拒绝（须逆序撤销）
 *  - 变动之后已计提过折旧 → 拒绝（折旧基数已被使用）
 *  - 资产拆分不支持撤销（子卡片可能已独立发生业务），需手工处理
 */
export function revokeAssetChange(params: {
  db: Database
  accountSetId: string
  changeId: string
}): { assetNo: string; deletedVoucherNo: string | null } {
  const { db, accountSetId, changeId } = params

  const change = db
    .prepare('SELECT * FROM fixed_asset_change WHERE id=? AND account_set_id=?')
    .get(changeId, accountSetId) as any
  if (!change) throw new Error('变动记录不存在')

  const kind = String(change.change_kind || '')
  if (kind === 'dispose') {
    throw new Error('处置记录请在资产卡片上使用「撤销处置」')
  }
  if (kind === 'split') {
    throw new Error('资产拆分不支持撤销，请手工删除拆出的子卡片并调整原卡片')
  }
  if (kind === 'legacy' || !kind) {
    throw new Error('历史导入的变动记录不支持撤销')
  }
  if (kind === 'inventory_deficit') {
    throw new Error('盘亏核减记录由盘点生成，不支持在此撤销')
  }
  // P2-16：减值准备一经计提不得转回；撤销只允许作为"录入更正"——
  // 凭证已记账（下方统一拦）或该期间之后已计提折旧（下方统一拦）都不能撤，
  // 此外还要求该变动仍是资产最近一次变动（下方逆序校验）。这里不再额外放开。

  const asset = db
    .prepare('SELECT * FROM fixed_asset WHERE account_set_id=? AND asset_no=?')
    .get(accountSetId, change.asset_no) as any
  if (!asset) throw new Error('对应资产不存在')

  assertPeriodOpen(db, accountSetId, change.year, change.period)

  // 必须逆序撤销
  // AS-P1-13：同日多笔变动原先按 change_date（日粒度）比较检测不到先后，
  // 改用 rowid 比较（插入顺序即时间序）
  const later = db
    .prepare(
      `SELECT id FROM fixed_asset_change
        WHERE account_set_id=? AND asset_no=? AND id<>?
          AND change_kind NOT IN ('legacy')
          AND (change_date > ? OR (change_date = ? AND rowid > (SELECT rowid FROM fixed_asset_change WHERE id=?)))
        LIMIT 1`
    )
    .get(accountSetId, change.asset_no, changeId, change.change_date, change.change_date, changeId)
  if (later) throw new Error('该资产存在更晚的变动记录，请先撤销更晚的变动')

  // 变动之后已计提折旧则拒绝
  const laterDepr = db
    .prepare(
      'SELECT 1 FROM fixed_asset_depr WHERE account_set_id=? AND asset_no=? AND (year*100+month) >= ? LIMIT 1'
    )
    .get(accountSetId, change.asset_no, change.year * 100 + change.period)
  if (laterDepr) {
    throw new Error('该变动所属期间及之后已计提折旧，请先反折旧再撤销变动')
  }

  let deletedVoucherNo: string | null = null
  if (change.voucher_id) {
    const voucher = db
      .prepare('SELECT voucher_no, status FROM vouchers WHERE id=?')
      .get(change.voucher_id) as any
    if (voucher?.status === 'posted') {
      throw new Error('该变动生成的凭证已记账，请先取消记账后再撤销')
    }
    deletedVoucherNo = voucher?.voucher_no ?? null
  }

  db.transaction(() => {
    switch (kind) {
      case 'original_value':
      case 'improvement': {
        const restoredOriginal = Number(change.old_value ?? asset.original_value)
        // FIX：优先按变动时写入的快照还原残值率 / 残值 / 使用月数；
        // 旧记录（无快照）退回原行为，只还原原值并按现残值率重算残值。
        const snap = parseValueSnapshot(change.old_text)
        const salvageRate = snap?.salvage_rate ?? Number(asset.salvage_rate || 0)
        const restoredSalvage = snap?.salvage_value ?? round2(restoredOriginal * salvageRate)
        const restoredUseMonths = snap?.use_months ?? Number(asset.use_months || 0)
        if (
          restoredUseMonths !== Number(asset.use_months || 0) &&
          restoredUseMonths <= Number(asset.depr_months_done || 0)
        ) {
          throw new Error(
            `撤销后的使用月数（${restoredUseMonths}）不大于已计提月数（${asset.depr_months_done}），无法撤销`
          )
        }
        db.prepare(
          `UPDATE fixed_asset SET original_value=?, salvage_rate=?, salvage_value=?, use_months=?,
             net_value=?, updated_at=datetime('now')
            WHERE id=?`
        ).run(
          restoredOriginal,
          salvageRate,
          restoredSalvage,
          restoredUseMonths,
          calcNetValue(
            restoredOriginal,
            Number(asset.accum_depr || 0),
            Number(asset.impairment_amount || 0)
          ),
          asset.id
        )
        break
      }
      case 'impairment': {
        const restored = Number(change.old_value ?? 0)
        db.prepare(
          `UPDATE fixed_asset SET impairment_amount=?, net_value=?, updated_at=datetime('now') WHERE id=?`
        ).run(
          restored,
          calcNetValue(Number(asset.original_value || 0), Number(asset.accum_depr || 0), restored),
          asset.id
        )
        break
      }
      case 'dept': {
        // AS-P1-13：调拨可能一并改过使用人/保管人/存放地点，撤销整组还原。
        // 新记录 oldText 为 JSON 快照；旧记录是纯 dept_code 字符串，兼容处理
        let restoredDept: string | null = change.old_text ?? null
        let restoredUser = asset.user_name
        let restoredKeeper = asset.keeper
        let restoredPlace = asset.install_place
        try {
          const snap = JSON.parse(String(change.old_text ?? ''))
          if (snap && typeof snap === 'object') {
            restoredDept = snap.dept_code ?? null
            restoredUser = snap.user_name ?? null
            restoredKeeper = snap.keeper ?? null
            restoredPlace = snap.install_place ?? null
          }
        } catch {
          /* 旧记录：纯 dept_code，仅还原部门 */
        }
        db.prepare(
          `UPDATE fixed_asset SET dept_code=?, user_name=?, keeper=?, install_place=?, updated_at=datetime('now') WHERE id=?`
        ).run(restoredDept, restoredUser ?? null, restoredKeeper ?? null, restoredPlace ?? null, asset.id)
        break
      }
      case 'status':
        db.prepare(
          `UPDATE fixed_asset SET status_code=?, updated_at=datetime('now') WHERE id=?`
        ).run(change.old_text ?? null, asset.id)
        break
      case 'depr_factor': {
        const field = change.field_key as string
        if (!DEPR_FACTOR_FIELDS[field]) throw new Error(`未知的折旧要素字段：${field}`)
        const restored =
          field === 'depr_method' ? change.old_text : (change.old_value ?? Number(change.old_text))
        // FIX：撤销使用月数时兜底校验，避免还原后小于已计提月数导致折旧静默停止
        if (field === 'use_months' && Number(restored) <= Number(asset.depr_months_done || 0)) {
          throw new Error(
            `撤销后的使用月数（${restored}）不大于已计提月数（${asset.depr_months_done}），无法撤销`
          )
        }
        db.prepare(`UPDATE fixed_asset SET ${field}=?, updated_at=datetime('now') WHERE id=?`).run(
          restored ?? null,
          asset.id
        )
        // FIX：残值率是残值的计算依据，还原残值率后必须按还原值重算残值与净值，
        // 否则残值停留在调整后的数，后续「剩余期间摊余」折旧算错。
        if (field === 'salvage_rate') {
          const restoredSalvage = round2(Number(asset.original_value || 0) * Number(restored || 0))
          db.prepare(
            `UPDATE fixed_asset SET salvage_value=?, updated_at=datetime('now') WHERE id=?`
          ).run(restoredSalvage, asset.id)
        }
        break
      }
    }

    if (change.voucher_id) {
      deleteVoucherRecords(db, change.voucher_id)
    }
    db.prepare('DELETE FROM fixed_asset_change WHERE id=?').run(changeId)
  })()

  return { assetNo: change.asset_no, deletedVoucherNo }
}

// ── 批量变动（P4-2）────────────────────────────────────────

/** 可批量执行的变动类型：只支持不涉及逐条金额的类型 */
export const BATCH_CHANGE_KINDS: AssetChangeKind[] = ['dept', 'status', 'depr_factor']

export interface BatchChangeResult {
  successCount: number
  results: Array<{ assetId: string; assetNo: string; changeId: string }>
  errors: Array<{ assetId: string; assetNo: string | null; message: string }>
}

/**
 * 对多张卡片执行同一种变动。
 *
 * 原值变动 / 减值 / 改良 / 拆分不支持批量——它们的金额必须逐条给定，
 * 批量套用同一金额没有业务含义。
 *
 * 采用「全有或全无」：任一张卡片失败即整批回滚，避免出现一半改了一半没改、
 * 用户还得逐条核对的中间状态。
 */
export function batchApplyAssetChange(params: {
  db: Database
  accountSetId: string
  assetIds: string[]
  kind: AssetChangeKind
  changeDate: string
  changeTypeCode?: string | null
  payload: Record<string, any>
  remark?: string | null
  operatorName?: string
  operatorId?: string | null
}): BatchChangeResult {
  const { db, accountSetId, assetIds, kind } = params

  if (!BATCH_CHANGE_KINDS.includes(kind)) {
    throw new Error(
      `${KIND_LABELS[kind] ?? kind}不支持批量操作，请逐张卡片办理（金额需逐条填写）`
    )
  }
  if (!Array.isArray(assetIds) || assetIds.length === 0) {
    throw new Error('请至少选择一张资产卡片')
  }
  if (assetIds.length > 500) {
    throw new Error('单次批量变动不能超过 500 张卡片')
  }

  const results: BatchChangeResult['results'] = []
  const errors: BatchChangeResult['errors'] = []

  // 先在事务外逐张试算收集错误：applyAssetChange 自身带事务，
  // 这里用外层事务包住以实现整批回滚。
  const tx = db.transaction(() => {
    for (const assetId of assetIds) {
      const asset = db
        .prepare('SELECT asset_no FROM fixed_asset WHERE id=? AND account_set_id=?')
        .get(assetId, accountSetId) as any
      try {
        const r = applyAssetChange({
          db,
          accountSetId,
          assetId,
          kind,
          changeDate: params.changeDate,
          changeTypeCode: params.changeTypeCode ?? null,
          payload: params.payload,
          generateVoucher: false,
          remark: params.remark ?? null,
          operatorName: params.operatorName,
          operatorId: params.operatorId ?? null,
        })
        results.push({ assetId, assetNo: asset?.asset_no ?? assetId, changeId: r.changeId })
      } catch (e: any) {
        errors.push({
          assetId,
          assetNo: asset?.asset_no ?? null,
          message: e?.message || '变动失败',
        })
      }
    }
    if (errors.length > 0) {
      // 抛出以触发回滚；错误清单在外层返回给用户
      throw new Error('__BATCH_ROLLBACK__')
    }
  })

  try {
    tx()
  } catch (e: any) {
    if (e?.message !== '__BATCH_ROLLBACK__') throw e
    return { successCount: 0, results: [], errors }
  }

  return { successCount: results.length, results, errors: [] }
}

// ── 查询 ───────────────────────────────────────────────────

export interface ChangeListFilters {
  assetNo?: string
  kind?: string
  year?: number
  period?: number
  deptCode?: string
  keyword?: string
  page?: number
  pageSize?: number
}

export function listAssetChanges(params: {
  db: Database
  accountSetId: string
  filters: ChangeListFilters
}): { total: number; rows: any[] } {
  const { db, accountSetId, filters } = params
  const where: string[] = ['c.account_set_id = ?']
  const args: any[] = [accountSetId]

  if (filters.assetNo) {
    where.push('c.asset_no = ?')
    args.push(filters.assetNo)
  }
  if (filters.kind) {
    where.push('c.change_kind = ?')
    args.push(filters.kind)
  }
  if (filters.year) {
    where.push('c.year = ?')
    args.push(filters.year)
  }
  if (filters.period) {
    where.push('c.period = ?')
    args.push(filters.period)
  }
  if (filters.deptCode) {
    where.push('fa.dept_code = ?')
    args.push(filters.deptCode)
  }
  if (filters.keyword) {
    where.push('(c.asset_no LIKE ? OR fa.asset_name LIKE ? OR c.change_item LIKE ?)')
    const kw = `%${filters.keyword}%`
    args.push(kw, kw, kw)
  }

  const whereSql = `WHERE ${where.join(' AND ')}`
  const from = `
    FROM fixed_asset_change c
    LEFT JOIN fixed_asset fa ON fa.account_set_id = c.account_set_id AND fa.asset_no = c.asset_no
  `
  const total = (db.prepare(`SELECT COUNT(*) AS c ${from} ${whereSql}`).get(...args) as any).c

  const page = Math.max(1, Number(filters.page || 1))
  const pageSize = Math.min(200, Math.max(1, Number(filters.pageSize || 20)))
  const rows = db
    .prepare(
      `SELECT c.*, fa.asset_name, fa.dept_code, v.voucher_no
       ${from}
       LEFT JOIN vouchers v ON v.id = c.voucher_id
       ${whereSql}
       ORDER BY c.change_date DESC, c.rowid DESC
       LIMIT ? OFFSET ?`
    )
    .all(...args, pageSize, (page - 1) * pageSize)

  return { total, rows }
}

export function getAssetChange(params: {
  db: Database
  accountSetId: string
  changeId: string
}): any {
  return params.db
    .prepare(
      `SELECT c.*, fa.asset_name, v.voucher_no, v.status AS voucher_status
         FROM fixed_asset_change c
         LEFT JOIN fixed_asset fa ON fa.account_set_id=c.account_set_id AND fa.asset_no=c.asset_no
         LEFT JOIN vouchers v ON v.id = c.voucher_id
        WHERE c.id=? AND c.account_set_id=?`
    )
    .get(params.changeId, params.accountSetId)
}

export { KIND_LABELS as ASSET_CHANGE_KIND_LABELS, DEPR_FACTOR_FIELDS }
