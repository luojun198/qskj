import request from './request'

export interface AssetCard {
  id: string
  asset_no: string
  asset_name: string
  category_code: string | null
  category_name?: string
  status_code: string | null
  status_name?: string
  dept_code: string | null
  dept_name?: string
  purpose_code: string | null
  purpose_name?: string
  acquire_date: string | null
  start_depr_date: string | null
  original_value: number
  salvage_rate: number
  salvage_value: number
  depr_method: string | null
  use_months: number | null
  use_years: number | null
  total_workload: number | null
  depr_months_done: number
  accum_depr: number
  net_value: number
  card_no: string | null
  qty: number
  unit: string | null
  user_name: string | null
  keeper: string | null
  source: string | null
  install_place: string | null
  remark: string | null
  scrap_reason: string | null
  scrap_date: string | null
}

export interface AssetDicts {
  category: { id: string; code: string; name: string; salvage_rate: number; account_code: string }[]
  status: { id: string; code: string; name: string; depreciable: number }[]
  purpose: { id: string; code: string; name: string; expense_account: string }[]
  dept: { id: string; code: string; name: string }[]
  change_type: { id: string; code: string; name: string; direction: string }[]
}

export const DEPR_METHODS: Record<string, string> = {
  '1': '平均年限法',
  '2': '工作量法',
  '3': '双倍余额递减法',
  '4': '年数总和法',
}

export const fixedAssetApi = {
  // 字典
  getDicts: () => request.get<AssetDicts>('/asset/dicts'),
  getDict: (type: string) => request.get<any[]>(`/asset/dict/${type}`),
  createDict: (type: string, data: any) => request.post(`/asset/dict/${type}`, data),
  updateDict: (type: string, id: string, data: any) => request.put(`/asset/dict/${type}/${id}`, data),
  deleteDict: (type: string, id: string) => request.delete(`/asset/dict/${type}/${id}`),
  initDict: (type: string) => request.post(`/asset/dict/init/${type}`),
  // 固定资产卡片

  // 卡片
  getCards: (params?: {
    keyword?: string
    category_code?: string
    status_code?: string
    dept_code?: string
    page?: number
    page_size?: number
  }) => request.get<{ list: AssetCard[]; total: number; page: number; page_size: number }>('/asset/cards', { params }),

  getNextAssetNo: () => request.get<{ next_no: string }>('/asset/cards/next-no'),
  getCard: (id: string) => request.get<AssetCard>(`/asset/cards/${id}`),
  createCard: (data: Partial<AssetCard> & { generate_voucher?: boolean; credit_account?: string }) =>
    request.post<{ id: string; voucher?: { voucherId: string; voucherNo: string; amount: number }; voucherWarning?: string }>('/asset/cards', data),
  updateCard: (id: string, data: Partial<AssetCard>) => request.put(`/asset/cards/${id}`, data),
  deleteCard: (id: string) => request.delete(`/asset/cards/${id}`),

  getDepr: (id: string) => request.get<any[]>(`/asset/cards/${id}/depr`),
  getChanges: (id: string) => request.get<any[]>(`/asset/cards/${id}/changes`),

  // 资产参数（折旧起始期间等）
  getAssetParams: () =>
    request.get<{ param_key: string; param_value: string }[]>('/asset/params'),
  saveAssetParams: (params: { param_key: string; param_value: string }[]) =>
    request.put('/asset/params', { params }),
  // 固定资产初始化（清空业务数据 business / 连同档案 all）
  reset: (mode: 'business' | 'all') => request.post<{ ok: boolean; cleared: string[] }>('/asset/reset', { mode }),

  // 折旧
  previewDepr: (year: number, month: number) =>
    request.get<{ lines: DeprLine[]; totalDepr: number }>('/asset/depr/preview', { params: { year, month } }),
  executeDepr: (data: { year: number; month: number; generate_voucher?: boolean; accum_account?: string }) =>
    request.post<{ lines: DeprLine[]; totalDepr: number; assetCount: number; voucher: any }>('/asset/depr/execute', data),
  getDeprHistory: (params: { year?: number; month?: number }) =>
    request.get<any[]>('/asset/depr/history', { params }),
  // 按期间补生成折旧凭证
  generateDeprVoucherForPeriod: (data: { year: number; month: number; accum_account?: string }) =>
    request.post<{ voucher: any }>('/asset/depr/generate-voucher', data),
  // 整期反折旧（删折旧记录 + 回退资产 + 删该期凭证）
  reverseDepr: (data: { year: number; month: number }) =>
    request.post<{
      assetCount: number
      totalDepr: number
      deletedVoucherNos: string[]
      affectedGroups: { year: number; period: number; voucher_type_id: string | null }[]
    }>('/asset/depr/reverse', data),

  // 工作量
  getWorkload: (year: number, month: number) =>
    request.get<Record<string, number>>('/asset/workload', { params: { year, month } }),
  saveWorkload: (data: { year: number; month: number; workloads: Record<string, number> }) =>
    request.post('/asset/workload', data),

  // 报表
  getDeprSummary: (params: { year: number; month: number; group_by?: string }) =>
    request.get<{ rows: DeprSummaryRow[]; totalMonthDepr: number }>('/asset/report/depr-summary', { params }),
  getDeprSummaryDetail: (params: { year: number; month: number; group_by?: string; group_code: string }) =>
    request.get<any[]>('/asset/report/depr-summary/detail', { params }),

  getDeprAllocation: (params: { year: number; month: number }) =>
    request.get<{ rows: DeprAllocationRow[]; totalDepr: number }>('/asset/report/depr-allocation', { params }),
  getDeprAllocationDetail: (params: { year: number; month: number; expense_account: string }) =>
    request.get<any[]>('/asset/report/depr-allocation/detail', { params }),

  getCategorySummary: (params?: { status_code?: string }) =>
    request.get<{ rows: CategorySummaryRow[]; totals: Record<string, number> }>('/asset/report/category-summary', { params }),
  getDeptSummary: (params?: { status_code?: string }) =>
    request.get<{ rows: DeptSummaryRow[]; totals: Record<string, number> }>('/asset/report/dept-summary', { params }),

  getExpiryWarning: (params?: { within_months?: number }) =>
    request.get<ExpiryWarningRow[]>('/asset/report/expiry-warning', { params }),

  getAssetLedger: (id: string) =>
    request.get<AssetLedgerResult>(`/asset/cards/${id}/ledger`),

  // 处置
  cancelDispose: (id: string) =>
    request.post<{ assetNo: string; restoredStatus: string; deletedVoucherNo: string | null }>(`/asset/cards/${id}/dispose/cancel`, {}),
  disposeAsset: (id: string, data: {
    change_type_code?: string
    scrap_date: string
    scrap_reason?: string
    disposal_income?: number
    disposal_expense?: number
    generate_voucher?: boolean
    accum_account?: string
    clearing_account?: string
  }) => request.post('/asset/cards/' + id + '/dispose', data),

  // 增减变动
  getChangeSummary: (params: { year: number; month: number }) =>
    request.get<{ rows: ChangeSummaryRow[]; totals: Record<string, number> }>('/asset/report/change-summary', { params }),
  getChangeDetail: (params: { year: number; month: number; type: string; category_code?: string }) =>
    request.get<ChangeDetailRow[]>('/asset/report/change-detail', { params }),

  // 变动记录（全局）
  getGlobalChanges: (params: { year?: number; month?: number; asset_no?: string; page?: number; page_size?: number }) =>
    request.get<{ rows: ChangeRecordRow[]; total: number }>('/asset/report/changes', { params }),

  // 折旧预测
  getDeprForecast: (months?: number) =>
    request.get<ForecastRow[]>('/asset/report/depr-forecast', { params: { months } }),

  // 盘点
  getInventories: () => request.get<InventorySummary[]>('/asset/inventory'),
  createInventory: (data: { name: string; inventory_date: string; remark?: string }) =>
    request.post<{ id: string }>('/asset/inventory', data),
  getInventoryDetail: (id: string) =>
    request.get<{ inventory: InventorySummary; items: InventoryItem[] }>(`/asset/inventory/${id}`),
  updateInventoryItem: (itemId: string, data: { actual_qty: number; actual_status: string; difference_note?: string }) =>
    request.put(`/asset/inventory/item/${itemId}`, data),
  batchMarkItems: (inventoryId: string, data: { item_ids: string[]; actual_status: string }) =>
    request.post(`/asset/inventory/${inventoryId}/batch`, data),
  completeInventory: (inventoryId: string, data: { generate_voucher?: boolean; accum_account?: string }) =>
    request.post<{ surplusCount: number; deficitCount: number; voucher?: any }>(`/asset/inventory/${inventoryId}/complete`, data),
  deleteInventory: (id: string) => request.delete(`/asset/inventory/${id}`),
}

export interface InventorySummary {
  id: string
  name: string
  inventory_date: string
  status: string
  total_count: number
  match_count: number
  surplus_count: number
  deficit_count: number
  remark: string | null
  created_at: string
}

export interface InventoryItem {
  id: string
  asset_no: string
  asset_name: string
  category_name: string | null
  dept_name: string | null
  book_qty: number
  book_original_value: number
  book_accum_depr: number
  book_net_value: number
  actual_qty: number
  actual_status: string
  difference_qty: number
  difference_note: string | null
}

export interface DeprLine {
  asset_no: string
  asset_name: string
  dept_code: string | null
  purpose_code: string | null
  depr_method: string
  original_value: number
  accum_depr_before: number
  month_depr: number
  accum_depr_after: number
  net_value_after: number
  expense_account: string | null
  asset_account: string | null
  depr_account_code: string | null
}

// ── 报表相关类型 ──────────────────────────────────────────

export interface DeprSummaryRow {
  group_code: string | null
  group_name: string | null
  asset_count: number
  total_original: number
  month_depr: number
  total_accum_depr: number
  total_net_value: number
}

export interface DeprAllocationRow {
  expense_account: string
  expense_account_name: string | null
  asset_count: number
  total_depr: number
}

export interface CategorySummaryRow {
  category_code: string | null
  category_name: string | null
  asset_count: number
  total_original: number
  total_accum_depr: number
  total_net_value: number
}

export interface DeptSummaryRow {
  dept_code: string | null
  dept_name: string | null
  asset_count: number
  total_original: number
  total_accum_depr: number
  total_net_value: number
}

export interface AssetLedgerEntry {
  date: string
  type: 'acquire' | 'depr' | 'change' | 'disposal'
  summary: string
  original_change: number
  original_after: number
  depr_amount: number
  accum_depr_after: number
  net_value_after: number
  voucher_no?: string
}

export interface AssetLedgerResult {
  asset_no: string
  asset_name: string
  category_name: string | null
  dept_name: string | null
  depr_method: string | null
  use_months: number | null
  start_depr_date: string | null
  acquire_date: string | null
  original_value: number
  salvage_value: number
  current_accum_depr: number
  current_net_value: number
  depr_months_done: number
  entries: AssetLedgerEntry[]
}

export interface ExpiryWarningRow {
  asset_no: string
  asset_name: string
  category_name: string | null
  dept_name: string | null
  original_value: number
  accum_depr: number
  net_value: number
  use_months: number
  depr_months_done: number
  remaining_months: number
  finished_month: string
}

export interface ChangeSummaryRow {
  category_code: string | null
  category_name: string | null
  opening_count: number
  opening_original: number
  increase_count: number
  increase_amount: number
  decrease_count: number
  decrease_amount: number
  closing_count: number
  closing_original: number
}

export interface ChangeDetailRow {
  asset_no: string
  asset_name: string
  category_name: string | null
  dept_name: string | null
  original_value: number
  change_date: string | null
}

export interface ChangeRecordRow {
  id: string
  asset_no: string
  asset_name: string
  category_name: string | null
  dept_name: string | null
  change_date: string | null
  change_item: string
  old_value: number | null
  new_value: number | null
  amount: number | null
  operator: string | null
  remark: string | null
}

export interface ForecastDetail {
  asset_no: string
  asset_name: string
  depr_method: string | null
  original_value: number
  month_depr: number
  accum_depr_after: number
  net_value_after: number
}

export interface ForecastRow {
  period: string
  year: number
  month: number
  asset_count: number
  total_depr: number
  details: ForecastDetail[]
}
