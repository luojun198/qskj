import request from '@/api/request'

export type AuxMultiColumnSide = 'debit' | 'credit'
export type AuxMultiColumnRowType = 'init' | 'entry' | 'month_total' | 'year_total'
/** counter=按对方科目分栏；aux_item=按辅助项目分栏 */
export type AuxMultiColumnMode = 'counter' | 'aux_item'

export interface AuxMultiColumnAccount {
  key: string
  accountId: string
  label: string
  side: AuxMultiColumnSide
  accountCode: string
  accountName: string
  accountPath: string
  printName: string
  enabled: boolean
  sortOrder: number
}

export interface AuxMultiColumnCategory {
  id: string
  code: string
  name: string
}

export interface AuxMultiColumnMainAccount {
  id: string
  code: string
  name: string
  direction: AuxMultiColumnSide
}

export interface AuxMultiColumnRow {
  row_type: AuxMultiColumnRowType
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
  counter_label: string
  aux_item_id: string
  aux_item_name: string
  amounts: Record<string, number>
  debit_total: number
  credit_total: number
  balance: number
  direction_label: '借' | '贷' | '平' | ''
}

export interface AuxMultiColumnData {
  mode: AuxMultiColumnMode
  category: AuxMultiColumnCategory | null
  account: AuxMultiColumnMainAccount | null
  columns: AuxMultiColumnAccount[]
  range: {
    year: number
    startMonth: number
    endMonth: number
    startDate: string
    endDate: string
  }
  initBalance: number
  rows: AuxMultiColumnRow[]
}

export interface AuxMultiColumnSetting {
  accountId: string
  enabled: boolean
  printName: string
  sortOrder: number
}

export interface AuxMultiColumnQuery {
  mode: AuxMultiColumnMode
  categoryId: string
  auxItemIds: string[]
  accountId?: string
  year: number
  startMonth: number
  endMonth: number
  includeUnposted: boolean
  accountCode?: string
}

function toQueryParams(params: AuxMultiColumnQuery) {
  return {
    mode: params.mode,
    aux_category_id: params.categoryId,
    aux_item_ids: params.auxItemIds.join(','),
    account_id: params.accountId || undefined,
    year: params.year,
    start_month: params.startMonth,
    end_month: params.endMonth,
    account_code: params.accountCode || undefined,
    ...(params.includeUnposted ? { include_unposted: 'true' } : {}),
  }
}

export async function getAuxMultiColumnSettings(params: AuxMultiColumnQuery) {
  const response = await request.get<{
    mode: AuxMultiColumnMode
    category: AuxMultiColumnCategory | null
    account: AuxMultiColumnMainAccount | null
    columns: AuxMultiColumnAccount[]
  }>('/ledger/aux-multi-column/settings', { params: toQueryParams(params) })
  return response.data
}

export async function saveAuxMultiColumnSettings(
  params: AuxMultiColumnQuery & { columns: AuxMultiColumnSetting[] }
) {
  const response = await request.put<{ mode: AuxMultiColumnMode; columns: AuxMultiColumnAccount[] }>(
    '/ledger/aux-multi-column/settings',
    {
      mode: params.mode,
      categoryId: params.categoryId,
      auxItemIds: params.auxItemIds,
      accountId: params.accountId,
      year: params.year,
      startMonth: params.startMonth,
      endMonth: params.endMonth,
      includeUnposted: params.includeUnposted,
      accountCode: params.accountCode,
      columns: params.columns,
    }
  )
  return response.data
}

export async function getAuxMultiColumnLedger(params: AuxMultiColumnQuery) {
  const response = await request.get<AuxMultiColumnData>('/ledger/aux-multi-column', {
    params: toQueryParams(params),
  })
  return response.data
}
