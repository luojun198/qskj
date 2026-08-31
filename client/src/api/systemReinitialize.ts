import request from '@/api/request'

export type ReinitMode = 'voucher_only' | 'full_reinit'

export type ReinitPreserveOptions = {
  preserve_aux: boolean
  preserve_voucher_types: boolean
  preserve_transfer: boolean
  preserve_dashboard_rules: boolean
  preserve_business_params: boolean
}

export type ReinitPreviewCounts = {
  vouchers: number
  voucher_entries: number
  init_balances: number
  accounts: number
  aux_items: number
  aux_categories: number
  period_closing: number
  account_balances: number
}

export type ReinitPreviewResult = {
  mode: ReinitMode
  counts: ReinitPreviewCounts
  willDelete: ReinitPreviewCounts
  template?: {
    id: string
    name: string
    description: string
    inferredStandard: string
  }
  templateAccountCount?: number
  warnings: string[]
}

export type StandardTemplateItem = {
  id: string
  name: string
  description: string
  acdFile: string
  excelFiles: Array<{ name: string; path: string }>
}

export type ReinitRequestPayload = {
  mode: ReinitMode
  start_date: string
  accounting_standard?: string
  standard_template_id?: string
  account_levels?: number
  account_code_lengths?: number[]
  preserve?: Partial<ReinitPreserveOptions>
  password: string
  confirm_text: string
}

function buildPreviewParams(payload: Omit<ReinitRequestPayload, 'password' | 'confirm_text'>) {
  const preserve = payload.preserve || {}
  return {
    mode: payload.mode,
    start_date: payload.start_date,
    accounting_standard: payload.accounting_standard,
    standard_template_id: payload.standard_template_id,
    account_levels: payload.account_levels,
    account_code_lengths: payload.account_code_lengths
      ? JSON.stringify(payload.account_code_lengths)
      : undefined,
    preserve_aux: preserve.preserve_aux ? 'true' : 'false',
    preserve_voucher_types: preserve.preserve_voucher_types ? 'true' : 'false',
    preserve_transfer: preserve.preserve_transfer ? 'true' : 'false',
    preserve_dashboard_rules: preserve.preserve_dashboard_rules ? 'true' : 'false',
    preserve_business_params: preserve.preserve_business_params ? 'true' : 'false',
  }
}

export function fetchStandardTemplates() {
  return request.get<StandardTemplateItem[]>('/system/standard-account-set-templates')
}

export function previewSystemReinitialize(
  payload: Omit<ReinitRequestPayload, 'password' | 'confirm_text'>
) {
  return request.get<ReinitPreviewResult>('/system/reinitialize/preview', {
    params: buildPreviewParams(payload),
  })
}

export function runSystemReinitializeAsync(payload: ReinitRequestPayload) {
  return request.post<{ taskId: string }>('/system/reinitialize-async', payload)
}
