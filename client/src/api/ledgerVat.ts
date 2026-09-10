import request from '@/api/request'

export type VatColumnSide = 'debit' | 'credit'
export type VatColumnSource = 'param' | 'code' | 'name' | 'none'

export interface VatColumn {
  key: string
  label: string
  side: VatColumnSide
  accountId: string
  accountCode: string
  accountName: string
  accountPath: string
  printName: string
  printNameEn: string
  source: VatColumnSource
}

export interface VatColumnSetting {
  key: string
  accountCode: string
  printName: string
  printNameEn: string
}

export interface VatLedgerRow {
  row_type: 'init' | 'entry' | 'month_total' | 'year_total'
  voucher_date: string
  year: number | ''
  month: number | ''
  day: number | ''
  voucher_id: string
  voucher_no: string
  voucher_type_name: string
  voucher_status: string
  summary: string
  account_id: string
  account_code: string
  account_name: string
  amounts: Record<string, number>
  debit_total: number
  credit_total: number
  balance: number
  direction_label: '借' | '贷' | '平' | ''
}

export interface VatLedgerData {
  columns: VatColumn[]
  parent: { code: string; name: string } | null
  range: {
    year: number
    startMonth: number
    endMonth: number
    startDate: string
    endDate: string
  }
  initBalance: number
  rows: VatLedgerRow[]
}

export interface VatLedgerSettingsData {
  columns: VatColumn[]
  parent: { code: string; name: string } | null
}

export async function getVatLedgerSettings() {
  const response = await request.get<VatLedgerSettingsData>('/ledger/vat-detail/settings')
  return response.data
}

export async function saveVatLedgerSettings(columns: VatColumnSetting[]) {
  const response = await request.put<VatLedgerSettingsData>('/ledger/vat-detail/settings', { columns })
  return response.data
}

export async function getVatLedger(params: {
  year: number
  startMonth: number
  endMonth: number
  includeUnposted: boolean
}) {
  const response = await request.get<VatLedgerData>('/ledger/vat-detail', {
    params: {
      year: params.year,
      start_month: params.startMonth,
      end_month: params.endMonth,
      ...(params.includeUnposted ? { include_unposted: 'true' } : {}),
    },
  })
  return response.data
}
