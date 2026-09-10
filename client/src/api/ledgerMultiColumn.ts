import request from '@/api/request'

export type MultiColumnSide = 'debit' | 'credit'
export type MultiColumnSource = 'param' | 'auto'

export interface MultiColumnAccount {
  key: string
  accountId: string
  label: string
  side: MultiColumnSide
  accountCode: string
  accountName: string
  accountPath: string
  printName: string
  printNameEn: string
  enabled: boolean
  sortOrder: number
}

export interface MultiColumnMainAccount {
  id: string
  code: string
  name: string
  direction: MultiColumnSide
}

export interface MultiColumnLedgerRow {
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

export interface MultiColumnLedgerData {
  main: MultiColumnMainAccount | null
  columns: MultiColumnAccount[]
  range: {
    year: number
    startMonth: number
    endMonth: number
    startDate: string
    endDate: string
  }
  initBalance: number
  rows: MultiColumnLedgerRow[]
}

export interface MultiColumnSetting {
  accountId: string
  enabled: boolean
  printName: string
  printNameEn: string
  sortOrder: number
}

export async function getMultiColumnSettings(accountId: string) {
  const response = await request.get<{ main: MultiColumnMainAccount | null; columns: MultiColumnAccount[] }>(
    '/ledger/multi-column/settings',
    { params: { account_id: accountId } }
  )
  return response.data
}

export async function saveMultiColumnSettings(accountId: string, columns: MultiColumnSetting[]) {
  const response = await request.put<{ main: MultiColumnMainAccount | null; columns: MultiColumnAccount[] }>(
    '/ledger/multi-column/settings',
    { accountId, columns }
  )
  return response.data
}

export async function getMultiColumnLedger(params: {
  accountId: string
  year: number
  startMonth: number
  endMonth: number
  includeUnposted: boolean
}) {
  const response = await request.get<MultiColumnLedgerData>('/ledger/multi-column', {
    params: {
      account_id: params.accountId,
      year: params.year,
      start_month: params.startMonth,
      end_month: params.endMonth,
      ...(params.includeUnposted ? { include_unposted: 'true' } : {}),
    },
  })
  return response.data
}
