/**
 * FIX-143：结转类凭证识别的单一出口。
 *
 * 判定 = `voucher_types.is_closing = 1`（迁移 121 按名称含「结转」自动回填，凭证类型页可手工勾选）
 *        或 名称含「结转」（兜底：新建类型未勾标志、老库刚迁移时也能命中「结转结余」等 ACD 名称）。
 * 无凭证类型（voucher_type_id IS NULL）的凭证一律视为非结转，因此消费方必须用 LEFT JOIN。
 */
export const CLOSING_VOUCHER_TYPE_JOIN_SQL = 'LEFT JOIN voucher_types vt ON vt.id = v.voucher_type_id'

/** 「是结转凭证」条件（需已 JOIN 别名 vt） */
export const IS_CLOSING_VOUCHER_SQL = "(COALESCE(vt.is_closing, 0) = 1 OR COALESCE(vt.name, '') LIKE '%结转%')"

/** 「不是结转凭证」条件（需已 LEFT JOIN 别名 vt） */
export const NOT_CLOSING_VOUCHER_SQL = `NOT ${IS_CLOSING_VOUCHER_SQL}`

/** 判断一个凭证类型对象是否为结转类型（与 SQL 口径一致） */
export function isClosingVoucherType(vt: { is_closing?: number | boolean | null; name?: string | null } | null | undefined) {
  if (!vt) return false
  if (vt.is_closing === 1 || vt.is_closing === true) return true
  return String(vt.name || '').includes('结转')
}
