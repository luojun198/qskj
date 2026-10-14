import request, { type RequestConfig } from './request'
import type { RenumberGroup } from '@/composables/useRenumberPrompt'

export interface AssetCard {
  id: string
  /** 评审 P1-2：卡片详情返回——有财务痕迹时原值 / 累计折旧不可直改的原因 */
  value_lock_reason?: string | null
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

// ── 凭证管理 ────────────────────────────────────────────────

export type AssetVoucherKind = 'purchase' | 'depr' | 'change' | 'disposal' | 'inventory'

export const ASSET_VOUCHER_KIND_LABELS: Record<AssetVoucherKind, string> = {
  purchase: '购置',
  depr: '折旧',
  change: '变动 / 减值',
  disposal: '处置',
  inventory: '盘点',
}

export interface AssetVoucherRow {
  kind: AssetVoucherKind
  refId: string
  title: string
  assetNo: string | null
  assetName: string | null
  year: number | null
  period: number | null
  amount: number | null
  summary: string | null
  changeKind?: string | null
  voucherId: string | null
  voucherNo: string | null
  voucherStatus: 'draft' | 'audited' | 'posted' | null
  hasVoucher: boolean
  deleteBlockReason: string | null
  regenerateBlockReason: string | null
}

export interface AssetVoucherQuery {
  kind?: AssetVoucherKind
  year?: number
  month?: number
  status?: 'generated' | 'missing'
  keyword?: string
  ref_id?: string
  page?: number
  page_size?: number
}

export interface AssetVoucherRegenerateInput {
  credit_account?: string
  counter_account?: string
  accum_account?: string
  clearing_account?: string
  disposal_income?: number
  disposal_expense?: number
  surplus_account?: string
  deficit_account?: string
  /** 本次指定的凭证类型，空则按资产参数中各业务的凭证类型 */
  voucher_type_id?: string
}

// ── 资产变动（P1）────────────────────────────────────────────

export type AssetChangeKind =
  | 'original_value'
  | 'dept'
  | 'status'
  | 'depr_factor'
  | 'split'
  | 'impairment'
  | 'improvement'
  | 'dispose'
  | 'legacy'

export interface AssetChangeRow {
  id: string
  asset_no: string
  asset_name: string | null
  change_date: string
  change_item: string
  change_kind: AssetChangeKind
  change_type_code: string | null
  field_key: string | null
  old_value: number | null
  new_value: number | null
  old_text: string | null
  new_text: string | null
  amount: number | null
  voucher_id: string | null
  voucher_no: string | null
  voucher_status?: string | null
  year: number | null
  period: number | null
  operator: string | null
  remark: string | null
  dept_code?: string | null
}

export interface ApplyChangeResult {
  changeId: string
  changeIds: string[]
  voucherId: string | null
  voucherNo: string | null
  voucherWarning: string | null
  createdAssets?: Array<{ id: string; asset_no: string; asset_name: string }>
  /** 已提满资产增值后自动顺延的使用月数 */
  extendedMonths?: number
}

export interface SplitChildInput {
  asset_no?: string
  asset_name?: string
  original_value: number
  qty?: number
  dept_code?: string | null
  user_name?: string | null
  install_place?: string | null
}

/** 各变动类型的中文名（与后端 ASSET_CHANGE_KIND_LABELS 对应） */
export const ASSET_CHANGE_KIND_LABELS: Record<string, string> = {
  original_value: '原值变动',
  dept: '部门调拨',
  status: '使用状态变更',
  depr_factor: '折旧要素调整',
  split: '资产拆分',
  impairment: '计提减值准备',
  improvement: '大修改良',
  dispose: '资产处置',
  legacy: '历史导入',
}

/** 折旧要素可调整字段 */
export const DEPR_FACTOR_FIELD_LABELS: Record<string, string> = {
  depr_method: '折旧方法',
  use_months: '使用月数',
  salvage_rate: '残值率',
  total_workload: '总工作量',
}

// ── 领用归还与附件（P3）──────────────────────────────────────

export type RequisitionAction = 'out' | 'in'

export interface RequisitionRow {
  id: string
  asset_no: string
  asset_name: string | null
  action: RequisitionAction
  action_date: string
  user_name: string | null
  user_aux_id: string | null
  dept_code: string | null
  dept_name: string | null
  keeper: string | null
  install_place: string | null
  expect_return_date: string | null
  condition_note: string | null
  remark: string | null
  operator: string | null
  created_at: string
  /** 该条领用是否仍未归还 */
  outstanding: boolean
}

export interface AssetAttachment {
  id: string
  filename: string
  original_name: string
  file_path: string
  file_size: number
  mime_type: string
  created_at: string
  created_by: string | null
}

export const REQUISITION_ACTION_LABELS: Record<RequisitionAction, string> = {
  out: '领用',
  in: '归还',
}

// ── 批量操作与数据交换（P4）─────────────────────────────────

export interface ImportColumn {
  key: string
  label: string
  required: boolean
}

export interface ImportRowError {
  /** Excel 行号（含表头） */
  row: number
  field?: string
  message: string
}

export interface BatchImportResult {
  successCount: number
  errors: ImportRowError[]
}

export interface BatchChangeResult {
  successCount: number
  results: Array<{ assetId: string; assetNo: string; changeId: string }>
  errors: Array<{ assetId: string; assetNo: string | null; message: string }>
}

export const fixedAssetApi = {
  // 字典
  getDicts: () => request.get<AssetDicts>('/asset/dicts'),
  getDict: (type: string) => request.get<any[]>(`/asset/dict/${type}`),
  createDict: (type: string, data: any) => request.post(`/asset/dict/${type}`, data),
  updateDict: (type: string, id: string, data: any) =>
    request.put(`/asset/dict/${type}/${id}`, data),
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
  }) =>
    request.get<{ list: AssetCard[]; total: number; page: number; page_size: number }>(
      '/asset/cards',
      { params }
    ),

  getNextAssetNo: () => request.get<{ next_no: string }>('/asset/cards/next-no'),
  getCard: (id: string) => request.get<AssetCard>(`/asset/cards/${id}`),
  createCard: (
    data: Partial<AssetCard> & { generate_voucher?: boolean; credit_account?: string }
  ) =>
    request.post<{
      id: string
      voucher?: { voucherId: string; voucherNo: string; amount: number }
      voucherWarning?: string
      /** 卡片辅助核算不全的提醒（不拦截保存） */
      auxWarnings?: string[]
    }>('/asset/cards', data),
  updateCard: (id: string, data: Partial<AssetCard>) => request.put<{ ok: boolean; auxWarnings?: string[] }>(`/asset/cards/${id}`, data),
  deleteCard: (id: string) => request.delete(`/asset/cards/${id}`),

  getDepr: (id: string) => request.get<any[]>(`/asset/cards/${id}/depr`),
  getChanges: (id: string) => request.get<any[]>(`/asset/cards/${id}/changes`),

  // 资产参数（折旧起始期间等）
  getAssetParams: () => request.get<{ param_key: string; param_value: string }[]>('/asset/params'),
  saveAssetParams: (params: { param_key: string; param_value: string }[]) =>
    request.put('/asset/params', { params }),
  // 固定资产初始化（清空业务数据 business / 连同档案 all）
  reset: (mode: 'business' | 'all') =>
    request.post<{ ok: boolean; cleared: string[] }>('/asset/reset', { mode }),

  // 折旧
  previewDepr: (year: number, month: number) =>
    request.get<{ lines: DeprLine[]; totalDepr: number }>('/asset/depr/preview', {
      params: { year, month },
    }),
  executeDepr: (data: {
    year: number
    month: number
    generate_voucher?: boolean
    accum_account?: string
  }) =>
    request.post<{ lines: DeprLine[]; totalDepr: number; assetCount: number; voucher: any; voucherWarning?: string | null }>(
      '/asset/depr/execute',
      data
    ),
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
  // 凭证管理：统一列出各业务凭证；只删凭证（保留业务）/ 重新生成
  listAssetVouchers: (params: AssetVoucherQuery) =>
    request.get<{ total: number; list: AssetVoucherRow[] }>('/asset/vouchers', { params }),
  deleteAssetVoucher: (data: { kind: AssetVoucherKind; ref_id: string }) =>
    request.post<{ voucherNo: string | null; affectedGroups: RenumberGroup[] }>('/asset/vouchers/delete', data),
  regenerateAssetVoucher: (data: { kind: AssetVoucherKind; ref_id: string } & AssetVoucherRegenerateInput, config?: RequestConfig) =>
    request.post<{ voucherId: string; voucherNo: string }>('/asset/vouchers/regenerate', data, config),

  // 工作量
  getWorkload: (year: number, month: number) =>
    request.get<Record<string, number>>('/asset/workload', { params: { year, month } }),
  saveWorkload: (data: { year: number; month: number; workloads: Record<string, number> }) =>
    request.post('/asset/workload', data),

  // 报表
  getDeprSummary: (params: { year: number; month: number; group_by?: string }) =>
    request.get<{ rows: DeprSummaryRow[]; totalMonthDepr: number }>('/asset/report/depr-summary', {
      params,
    }),
  getDeprSummaryDetail: (params: {
    year: number
    month: number
    group_by?: string
    /** group_by=asset 时不传：全部资产逐项 */
    group_code?: string
  }) => request.get<any[]>('/asset/report/depr-summary/detail', { params }),

  getDeprAllocation: (params: { year: number; month: number }) =>
    request.get<{ rows: DeprAllocationRow[]; totalDepr: number }>('/asset/report/depr-allocation', {
      params,
    }),
  getDeprAllocationDetail: (params: { year: number; month: number; expense_account: string }) =>
    request.get<any[]>('/asset/report/depr-allocation/detail', { params }),

  getCategorySummary: (params?: { status_code?: string }) =>
    request.get<{ rows: CategorySummaryRow[]; totals: Record<string, number> }>(
      '/asset/report/category-summary',
      { params }
    ),
  getDeptSummary: (params?: { status_code?: string }) =>
    request.get<{ rows: DeptSummaryRow[]; totals: Record<string, number> }>(
      '/asset/report/dept-summary',
      { params }
    ),

  getExpiryWarning: (params?: { within_months?: number }) =>
    request.get<ExpiryWarningRow[]>('/asset/report/expiry-warning', { params }),

  getAssetLedger: (id: string) => request.get<AssetLedgerResult>(`/asset/cards/${id}/ledger`),

  // 处置
  cancelDispose: (id: string) =>
    request.post<{ assetNo: string; restoredStatus: string; deletedVoucherNo: string | null; affectedGroups?: RenumberGroup[] }>(
      `/asset/cards/${id}/dispose/cancel`,
      {}
    ),
  disposeAsset: (
    id: string,
    data: {
      change_type_code?: string
      scrap_date: string
      scrap_reason?: string
      disposal_income?: number
      disposal_expense?: number
      generate_voucher?: boolean
      accum_account?: string
      clearing_account?: string
    }
  ) => request.post('/asset/cards/' + id + '/dispose', data),

  // 资产变动（P1）
  listChanges: (params: {
    asset_no?: string
    kind?: string
    year?: number
    period?: number
    dept_code?: string
    keyword?: string
    page?: number
    page_size?: number
  }) => request.get<{ total: number; list: AssetChangeRow[] }>('/asset/changes', { params }),
  getChange: (id: string) => request.get<AssetChangeRow>(`/asset/changes/${id}`),
  applyChange: (
    assetId: string,
    data: {
      kind: AssetChangeKind
      change_date: string
      change_type_code?: string | null
      payload: Record<string, unknown>
      generate_voucher?: boolean
      counter_account?: string | null
      remark?: string | null
    }
  ) => request.post<ApplyChangeResult>(`/asset/cards/${assetId}/change`, data),
  splitAsset: (
    assetId: string,
    data: { change_date: string; children: SplitChildInput[]; remark?: string | null }
  ) => request.post<ApplyChangeResult>(`/asset/cards/${assetId}/split`, data),
  revokeChange: (changeId: string) =>
    request.post<{ assetNo: string; deletedVoucherNo: string | null; affectedGroups?: RenumberGroup[] }>(
      `/asset/changes/${changeId}/revoke`,
      {}
    ),
  getChangeKinds: () =>
    request.get<{
      kinds: Array<{ code: string; name: string }>
      deprFactorFields: Array<{ code: string; name: string }>
    }>('/asset/change-kinds'),

  // 领用归还（P3）
  listRequisitions: (params: {
    asset_no?: string
    action?: RequisitionAction
    dept_code?: string
    user_name?: string
    keyword?: string
    outstanding_only?: boolean
    overdue_only?: boolean
    date_from?: string
    date_to?: string
    page?: number
    page_size?: number
  }) => request.get<{ total: number; list: RequisitionRow[] }>('/asset/requisitions', { params }),
  getAssetRequisitions: (assetId: string) =>
    request.get<RequisitionRow[]>(`/asset/cards/${assetId}/requisitions`),
  createRequisition: (data: {
    asset_id: string
    action: RequisitionAction
    action_date: string
    user_name?: string | null
    dept_code?: string | null
    keeper?: string | null
    install_place?: string | null
    expect_return_date?: string | null
    condition_note?: string | null
    remark?: string | null
  }) =>
    request.post<{ id: string; assetNo: string; action: RequisitionAction; deptChangeId: string | null }>(
      '/asset/requisitions',
      data
    ),
  deleteRequisition: (id: string) => request.delete(`/asset/requisitions/${id}`),

  // 卡片附件（P3）
  getAttachments: (assetId: string) =>
    request.get<AssetAttachment[]>(`/asset/cards/${assetId}/attachments`),
  uploadAttachments: (assetId: string, files: File[]) => {
    const fd = new FormData()
    for (const f of files) fd.append('file', f)
    return request.post<AssetAttachment[]>(`/asset/cards/${assetId}/attachments`, fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
  },
  deleteAttachment: (assetId: string, attachmentId: string) =>
    request.delete(`/asset/cards/${assetId}/attachments/${attachmentId}`),

  // 批量操作与数据交换（P4）
  getImportColumns: () => request.get<ImportColumn[]>('/asset/import/columns'),
  validateImport: (rows: Record<string, unknown>[], startRow = 2) =>
    request.post<{ rowCount: number; errors: ImportRowError[] }>('/asset/cards/batch/validate', {
      rows,
      start_row: startRow,
    }),
  batchImport: (rows: Record<string, unknown>[], startRow = 2) =>
    request.post<BatchImportResult>('/asset/cards/batch', { rows, start_row: startRow }),
  getBatchChangeKinds: () => request.get<AssetChangeKind[]>('/asset/changes/batch-kinds'),
  batchChange: (data: {
    asset_ids: string[]
    kind: AssetChangeKind
    change_date: string
    change_type_code?: string | null
    payload: Record<string, unknown>
    remark?: string | null
  }) => request.post<BatchChangeResult>('/asset/changes/batch', data),

  // 增减变动
  getChangeSummary: (params: { year: number; month: number }) =>
    request.get<{ rows: ChangeSummaryRow[]; totals: Record<string, number> }>(
      '/asset/report/change-summary',
      { params }
    ),
  getChangeDetail: (params: {
    year: number
    month: number
    type: string
    category_code?: string
  }) => request.get<ChangeDetailRow[]>('/asset/report/change-detail', { params }),

  // 变动记录（全局）
  getGlobalChanges: (params: {
    year?: number
    month?: number
    asset_no?: string
    page?: number
    page_size?: number
  }) =>
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
  updateInventoryItem: (
    itemId: string,
    data: { actual_qty: number; actual_status: string; difference_note?: string }
  ) => request.put(`/asset/inventory/item/${itemId}`, data),
  batchMarkItems: (inventoryId: string, data: { item_ids: string[]; actual_status: string }) =>
    request.post(`/asset/inventory/${inventoryId}/batch`, data),
  completeInventory: (
    inventoryId: string,
    data: { generate_voucher?: boolean; accum_account?: string }
  ) =>
    request.post<{ surplusCount: number; deficitCount: number; voucher?: any }>(
      `/asset/inventory/${inventoryId}/complete`,
      data
    ),
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
  /** 变动性质：取得 / 处置 / 原值增减 / 大修改良 / 资产拆分 / 盘亏核减 */
  change_item?: string | null
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
