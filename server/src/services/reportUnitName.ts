import type { Database } from 'better-sqlite3'

/**
 * 解析报表里 %U 占位符要显示的「使用单位」名称。
 *
 * 早先报表取数直接用 `account_sets.name`，而账套名是从 ACD 文件名来的、
 * 形如「zw06广州东汇食品有限公司20260827」——带业务前缀和备份日期，
 * 打到报表抬头上就成了「纳税人名称：zw06广州东汇食品有限公司20260827」。
 *
 * 正确的来源依次是：
 *   1. 系统参数 `unit_name`（用户在「系统管理 → 参数设置」里维护的使用单位）
 *   2. ACD 导入时从 xt.txt 的 xt_dwmc 解析出的 `import_acd:unit_name`
 *   3. 账套名兜底（去掉 zwNN 前缀与结尾的 8 位日期）
 */

/** ACD 模板自带的占位单位名，不能当作真实单位 */
const PLACEHOLDER_UNIT_NAMES = new Set(['xx公司', 'xx行政事业单位', 'XX公司', 'XX行政事业单位'])

export const ACD_UNIT_NAME_PARAM = 'import_acd:unit_name'

export function isPlaceholderUnitName(value: string | null | undefined) {
  const trimmed = String(value || '').trim()
  if (!trimmed) return true
  return PLACEHOLDER_UNIT_NAMES.has(trimmed)
}

/**
 * 账套名兜底：剥掉 ACD 文件名带来的 `zw06` 前缀与结尾 8 位日期。
 * 「zw06广州东汇食品有限公司20260827」→「广州东汇食品有限公司」
 */
export function stripAccountSetNameDecorations(name: string | null | undefined) {
  let value = String(name || '').trim()
  if (!value) return ''
  value = value.replace(/^[a-zA-Z]{1,4}\d{1,4}/, '')
  // 只剥「20260827」这种像日期的 8 位数；账套名里的时间戳（如 1784492442487）不能碰
  value = value.replace(/(?:19|20)\d{6}(\([0-9]+\))?$/, '')
  value = value.trim()
  // 剥完只剩数字（如账套名就叫「zw0620260827」）说明这名字里本就没有单位名，退回原样
  if (!value || /^\d+$/.test(value)) return String(name || '').trim()
  return value
}

function readParam(db: Database, accountSetId: string, key: string) {
  const row = db
    .prepare(
      `SELECT param_value FROM system_params WHERE account_set_id = ? AND param_key = ? LIMIT 1`
    )
    .get(accountSetId, key) as { param_value: string | null } | undefined
  return row?.param_value?.trim() || ''
}

export function resolveReportUnitName(db: Database, accountSetId: string): string {
  const configured = readParam(db, accountSetId, 'unit_name')
  if (configured && !isPlaceholderUnitName(configured)) return configured

  const fromAcd = readParam(db, accountSetId, ACD_UNIT_NAME_PARAM)
  if (fromAcd && !isPlaceholderUnitName(fromAcd)) return fromAcd

  const account = db
    .prepare(`SELECT name FROM account_sets WHERE id = ? LIMIT 1`)
    .get(accountSetId) as { name: string } | undefined
  return stripAccountSetNameDecorations(account?.name)
}
