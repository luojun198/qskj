/**
 * 资产卡片与字典维护的判定逻辑
 *
 * 从 routes/fixedAsset.ts 下沉：路由层只做 HTTP 与参数搬运，
 * 这里承载「字典能不能删」「卡片更新要写哪些列」两处需要单测覆盖的规则。
 */
import type { Database } from 'better-sqlite3'

// ── 字典删除引用检查 ───────────────────────────────────────

/** 字典类型 → 资产卡片上引用它的列 */
const DICT_REFERENCES: Record<string, { column: string; label: string }> = {
  category: { column: 'category_code', label: '资产类别' },
  status: { column: 'status_code', label: '使用状态' },
  purpose: { column: 'purpose_code', label: '资产用途' },
  dept: { column: 'dept_code', label: '使用部门' },
}

/**
 * 检查某个字典项是否仍被引用；被引用时返回给用户看的拦截原因，否则返回 null。
 *
 * 资产卡片用**编码**而非 id 引用字典，删掉在用的字典项数据库不会报错，
 * 但卡片上的类别/状态/部门会变成查不到名称的孤儿编码，折旧还会因为取不到
 * depreciable / expense_account 而静默算错。
 */
export function getDictDeleteBlockReason(params: {
  db: Database
  accountSetId: string
  type: string
  row: { code: string; name: string }
}): string | null {
  const { db, accountSetId, type, row } = params

  const ref = DICT_REFERENCES[type]
  if (ref) {
    const used = db
      .prepare(`SELECT COUNT(*) AS c FROM fixed_asset WHERE account_set_id=? AND ${ref.column}=?`)
      .get(accountSetId, row.code) as { c: number }
    if (used.c > 0) {
      return `「${row.name}」已被 ${used.c} 张资产卡片用作${ref.label}，不能删除。请先修改这些卡片。`
    }
  }

  // 增减方式被变动流水引用（处置、原值变动都会记 change_type_code）
  if (type === 'change_type') {
    const used = db
      .prepare(
        'SELECT COUNT(*) AS c FROM fixed_asset_change WHERE account_set_id=? AND change_type_code=?'
      )
      .get(accountSetId, row.code) as { c: number }
    if (used.c > 0) {
      return `「${row.name}」已被 ${used.c} 条资产变动记录引用，不能删除。`
    }
  }

  return null
}

// ── 卡片更新 ───────────────────────────────────────────────

/**
 * 允许通过 PUT /asset/cards/:id 直接改写的列。
 *
 * FIX（A6）：scrap_date / scrap_reason 只能由处置流程（assetDisposal）写入——直改会绕过
 * 期间校验与 pre_scrap_status 快照，使处置无法撤销；depr_months_done 是折旧序列的游标，
 * 只能由计提/反计提维护，直改会让折旧额与已提月数脱节。三者一律不开放手工修改。
 */
export const UPDATABLE_CARD_FIELDS = [
  'asset_name',
  'category_code',
  'status_code',
  'dept_code',
  'purpose_code',
  'acquire_date',
  'start_depr_date',
  'salvage_rate',
  'depr_method',
  'use_months',
  'use_years',
  'total_workload',
  'card_no',
  'qty',
  'unit',
  'user_name',
  'keeper',
  'source',
  'install_place',
  'remark',
] as const

export interface CardSnapshot {
  original_value: number
  salvage_rate: number | null
  salvage_value: number | null
  accum_depr: number
  impairment_amount?: number | null
}

const round2 = (n: number) => Math.round(n * 100) / 100

/**
 * 依据请求体与卡片现状，算出本次实际要写入的列。
 *
 * 语义：**字段出现在请求体里就写（传 null 即置空），没出现就不动**。
 * 原实现对每列用 `COALESCE(?, col)`，「传 null」和「不传」被当成同一件事，
 * 于是清空使用人、取消部门这类操作永远不生效。
 *
 * 金额三列（原值、累计折旧、残值）与净值始终重算后写入：
 * 净值 = 原值 − 累计折旧 − 累计减值准备（减值口径自 P2 起）。
 */
export function buildAssetCardUpdate(
  body: Record<string, unknown>,
  current: CardSnapshot
): Record<string, unknown> {
  const fields: Record<string, unknown> = {}

  for (const field of UPDATABLE_CARD_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(body, field)) continue
    const raw = body[field]
    // 空串按「未填」处理，统一落 NULL，避免库里同时存在 '' 与 NULL 两种空值
    fields[field] = raw === '' ? null : raw
  }

  const originalValue =
    body.original_value !== undefined ? Number(body.original_value) : Number(current.original_value)
  const accumDepr =
    body.accum_depr !== undefined ? Number(body.accum_depr) : Number(current.accum_depr)
  const salvageRate =
    body.salvage_rate !== undefined && body.salvage_rate !== ''
      ? Number(body.salvage_rate)
      : Number(current.salvage_rate ?? 0)

  // 残值可显式给定，否则按（可能已变化的）原值与残值率重算
  const salvageValue =
    body.salvage_value !== undefined && body.salvage_value !== ''
      ? Number(body.salvage_value)
      : round2(originalValue * (salvageRate || 0))

  fields.original_value = round2(originalValue)
  fields.accum_depr = round2(accumDepr)
  fields.salvage_value = round2(salvageValue)
  fields.net_value = round2(originalValue - accumDepr - Number(current.impairment_amount || 0))

  return fields
}
