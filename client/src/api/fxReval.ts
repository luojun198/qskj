import request from './request'

/** 期末汇率取自哪一档回退链，用于在界面上说明「外币类型页填的汇率为什么没生效」 */
export type FxRateSource =
  | 'base'
  | 'period-closing'
  | 'period-rate'
  | 'currency-end'
  | 'nearest-period'
  | 'default'

export interface FxRevaluationRow {
  account_id: string
  account_code: string
  account_name: string
  direction: 'debit' | 'credit'
  currency_code: string
  foreign_end_balance: number
  book_base_balance: number
  closing_rate: number
  closing_rate_source: FxRateSource
  revalued_base_balance: number
  adjustment: number
  entry_direction: 'debit' | 'credit' | null
  skip_reason: string | null
  /** 带辅助核算的科目按辅助项目拆分后的项目说明 */
  aux_label?: string
}

export interface FxRevaluationRunInfo {
  id: string
  voucher_id: string
  voucher_no: string | null
  voucher_date: string | null
  status: string | null
  total_amount: number
  created_by: string | null
  created_at: string
}

export interface FxRevaluationEntry {
  account_code: string
  account_name: string
  direction: 'debit' | 'credit'
  amount: number
  summary?: string
}

export interface FxRevaluationPreview {
  year: number
  period: number
  closed: boolean
  alreadyGenerated: boolean
  existingRun: FxRevaluationRunInfo | null
  blockedReason: string | null
  /** 本期未过账凭证数（不含调汇凭证自身）；> 0 时不允许调汇 */
  unpostedVoucherCount: number
  gainAccount: { id: string; code: string; name: string; direction: 'debit' | 'credit' } | null
  rows: FxRevaluationRow[]
  entries: FxRevaluationEntry[]
  totalGain: number
  totalLoss: number
}

export function previewFxRevaluation(year: number, period: number) {
  return request.post<FxRevaluationPreview>('/voucher/fx-reval/preview', { year, period })
}

export function runFxRevaluation(year: number, period: number) {
  return request.post<{ voucherId: string; voucherNo: string; entryCount: number }>(
    '/voucher/fx-reval/run',
    { year, period }
  )
}

export function revokeFxRevaluation(year: number, period: number) {
  return request.post<{ voucherId: string; voucherNo: string }>('/voucher/fx-reval/revoke', {
    year,
    period,
  })
}
