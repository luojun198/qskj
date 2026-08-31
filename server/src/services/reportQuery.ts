import { appendAccountScopeCondition, type AccountScopeContext } from './accountAuthorization.js'

type AuxBalanceField = 've.dept_id' | 've.project_id' | 've.supplier_id' | 've.person_id' | 've.func_class_id'

const AUX_FIELD_MAP: Record<string, AuxBalanceField> = {
  dept: 've.dept_id',
  project: 've.project_id',
  supplier: 've.supplier_id',
  person: 've.person_id',
  func_class: 've.func_class_id',
}

export function getAuxBalanceField(auxType?: string) {
  return auxType ? AUX_FIELD_MAP[auxType] : undefined
}

export function buildAuxBalanceQuery(filters: {
  accountSetId: string
  year: number
  period: number
  auxField: AuxBalanceField
  includeUnposted?: boolean
  accountScope?: AccountScopeContext
}) {
  // 构建凭证状态过滤条件
  const statusCondition = filters.includeUnposted
    ? "v.status IN ('draft', 'audited', 'posted')"
    : "v.status='posted'"

  const conditions = [
    've.account_set_id=?',
    'v.year=?',
    'v.period=?',
    statusCondition,
    `${filters.auxField} IS NOT NULL`,
  ]
  const params: Array<string | number> = [filters.accountSetId, filters.year, filters.period]
  appendAccountScopeCondition(filters.accountScope, 've.account_id', conditions, params)

  return {
    sql: `
      SELECT
        ${filters.auxField} as aux_id,
        ve.account_code,
        ve.account_name,
        a.direction,
        SUM(CASE WHEN ve.direction='debit' THEN ve.amount ELSE 0 END) as total_debit,
        SUM(CASE WHEN ve.direction='credit' THEN ve.amount ELSE 0 END) as total_credit
      FROM voucher_entries ve
      JOIN vouchers v ON v.id = ve.voucher_id
      JOIN accounts a ON a.id = ve.account_id
      WHERE ${conditions.join(' AND ')}
      GROUP BY ${filters.auxField}, ve.account_code
      ORDER BY ve.account_code
    `,
    params,
  }
}
