/**
 * 进销存生成凭证的默认凭证类型（基础资料 → 进销存凭证设置）。
 * 优先级：本次生成时指定 > 本参数 > 自动规则（本期最近使用 / 编码最小的类型，见 getEffectiveVoucherTypeId）。
 */
import type Database from 'better-sqlite3'
import { normalizeRequestedVoucherTypeId } from './voucherEntry.js'

export const SCM_DEFAULT_VOUCHER_TYPE_KEY = 'scm:default_voucher_type_id'

/** 读取默认凭证类型；未设置、表缺失或类型已被删除时返回 null */
export function getScmDefaultVoucherTypeId(db: Database.Database, aid: string): string | null {
  let v: string | undefined
  try {
    v = (db.prepare('SELECT param_value FROM system_params WHERE account_set_id=? AND param_key=? LIMIT 1')
      .get(aid, SCM_DEFAULT_VOUCHER_TYPE_KEY) as { param_value?: string } | undefined)?.param_value
  } catch {
    return null
  }
  if (!v) return null
  try { return normalizeRequestedVoucherTypeId(db, aid, v) } catch { return null }
}
