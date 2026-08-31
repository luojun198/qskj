import type Database from 'better-sqlite3'

export type ScmOverrunScope = 'sales' | 'purchase' | 'production' | 'outsource'

export interface ScmOverrunPolicy {
  enabled: boolean
  rate: number
}

const PARAMS: Record<ScmOverrunScope, { enabled: string; rate: string }> = {
  sales: {
    enabled: 'scm:sales_over_delivery_enabled',
    rate: 'scm:sales_over_delivery_rate',
  },
  purchase: {
    enabled: 'scm:purchase_over_receipt_enabled',
    rate: 'scm:purchase_over_receipt_rate',
  },
  production: {
    enabled: 'scm:production_overrun_enabled',
    rate: 'scm:production_overrun_rate',
  },
  outsource: {
    enabled: 'scm:outsource_overrun_enabled',
    rate: 'scm:outsource_overrun_rate',
  },
}

export const SCM_OVERRUN_PARAM_KEYS = Object.values(PARAMS).flatMap(item => [item.enabled, item.rate])

export function roundScmQty(value: number): number {
  return Math.round((Number(value) || 0) * 1_000_000) / 1_000_000
}

export function getScmOverrunPolicy(
  db: Database.Database,
  accountSetId: string,
  scope: ScmOverrunScope,
): ScmOverrunPolicy {
  const keys = PARAMS[scope]
  const rows = db.prepare(
    'SELECT param_key,param_value FROM system_params WHERE account_set_id=? AND param_key IN (?,?)',
  ).all(accountSetId, keys.enabled, keys.rate) as Array<{ param_key: string; param_value: string }>
  const values = new Map(rows.map(row => [row.param_key, row.param_value]))
  const rawRate = Number(values.get(keys.rate))
  return {
    enabled: values.get(keys.enabled) === '1',
    rate: Number.isFinite(rawRate) ? Math.min(1000, Math.max(0, rawRate)) : 0,
  }
}

export function getScmMaxAllowedQty(baseQty: number, policy: ScmOverrunPolicy): number {
  const base = roundScmQty(baseQty)
  if (!policy.enabled || policy.rate <= 0) return base
  return roundScmQty(base * (1 + policy.rate / 100))
}

export function resolveSourceOverrunScope(
  childDocType: string,
  parentDocType: string,
): ScmOverrunScope | null {
  if (childDocType === 'SO' && parentDocType === 'SOa') return 'sales'
  if (childDocType === 'PI' && parentDocType === 'PO') return 'purchase'
  return null
}

export function resolvePlanOverrunScope(docType: string): ScmOverrunScope | null {
  if (['PL', 'PB', 'PF'].includes(docType)) return 'production'
  if (['WO', 'WI'].includes(docType)) return 'outsource'
  return null
}

export function validateScmOverrunParam(key: string, value: string): string | null {
  if (!SCM_OVERRUN_PARAM_KEYS.includes(key)) return null
  if (key.endsWith('_enabled')) {
    return ['0', '1'].includes(value) ? null : '超量控制开关参数无效'
  }
  const rate = Number(value)
  if (!Number.isFinite(rate) || rate < 0 || rate > 1000 || !/^\d+(?:\.\d{1,2})?$/.test(value)) {
    return '最大超量比例须在 0% 到 1000% 之间，最多保留两位小数'
  }
  return null
}
