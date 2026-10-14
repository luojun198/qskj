import request from './request'
import type { AmountMode, ImportProfile, StatementMapping } from '@/utils/bankStatementImport'

export type { ImportProfile }

/** 命名映射方案 */
export interface ImportScheme extends ImportProfile {
  id: string
  name: string
  updated_at?: string
}

/** 对账单上传解析结果：全部工作表及各自前 20 行样例 */
export interface StatementUploadResult {
  preview_id: string
  filename: string
  sheets: Array<{ name: string; total_rows: number; sample_rows: any[][] }>
}

export interface StatementConfirmParams {
  preview_id: string
  account_code: string
  sheet_name: string
  /** 表头行索引，-1 = 无表头 */
  header_row: number
  /** 首个数据行索引 */
  data_start_row: number
  amount_mode: AmountMode
  mapping: StatementMapping
  /** single 模式下视为收入的方向标志值 */
  direction_in_values?: string[]
  /** 表头文字（按列索引），随映射一起保存 */
  header_labels?: string[]
  /** FIX-262：跳过疑似重复（默认 true）；dry_run 只试算不写库 */
  skip_duplicates?: boolean
  dry_run?: boolean
}

/** FIX-262：对账单导入（生成出纳日记账）结果 */
export interface StatementImportResult {
  inserted: number
  total: number
  dry_run: boolean
  skipped: Array<{ row: number; biz_date: string; debit: number; credit: number; summary: string | null }>
  errors: Array<{ row: number; message: string }>
}

export interface CashierAccount {
  code: string
  name: string
  is_cash: number
  is_bank: number
  /** FIX-260：外币科目标记与核算币种（日记账币种跟科目走） */
  is_foreign?: number
  currency_code?: string | null
}

export interface JournalRow {
  id: string
  account_code: string
  currency: string
  biz_date: string
  seq: number
  summary: string | null
  debit: number
  credit: number
  /** FIX-260：汇率（本位币恒 1）与本位币金额 */
  exchange_rate?: number
  base_debit?: number
  base_credit?: number
  settle_type: string | null
  bill_no: string | null
  counter_unit: string | null
  counter_account: string | null
  bank_name: string | null
  bank_account: string | null
  counter_aux_item_id: string | null
  reconciled: number
  voucher_year: number | null
  voucher_month: number | null
  voucher_type: number | null
  voucher_no: number | null
  balance?: number
  base_balance?: number
  /** 对方科目名称 / 按辅助类别拆开的值 { 类别id: 项目名 }（页面一个类别一列） */
  counter_account_name?: string | null
  aux_values?: Record<string, string>
  /** 来源收付款单（收付款单审核写入的流水；收付款制证方式决定由哪一侧制证） */
  scm_doc_type?: string | null
  scm_doc_no?: string | null
}

export interface AuxColumn { id: string; code: string; name: string }

export interface JournalResult {
  opening: number
  rows: JournalRow[]
  closing: number
  totalDebit: number
  totalCredit: number
  /** FIX-260：本位币合计与科目币种 */
  totalBaseDebit?: number
  totalBaseCredit?: number
  currency?: string
  /** FIX-253：区间内行数；FIX-326 起接口强制分页，始终带 page / pageSize */
  total?: number
  page?: number
  pageSize?: number
  /** 当前筛选结果里出现过的辅助类别，按类别动态生成列 */
  aux_columns?: AuxColumn[]
  /** 带表头明细筛选时：rows / total 只含命中行，balance 仍是完整流水里的真实余额；下面是命中行的合计 */
  filtered?: boolean
  filteredTotalDebit?: number
  filteredTotalCredit?: number
  /** 评审 P2：同科目同区间、币种与科目核算币种不一致而未显示的存量行数 */
  otherCurrencyCount?: number
}

export type GlMatchType = 'link' | 'auto' | 'manual'

/** FIX-262：出纳对账——出纳日记账一侧 */
export interface GlCashierRow {
  id: string
  biz_date: string
  seq: number
  summary: string | null
  debit: number
  credit: number
  bill_no: string | null
  voucher_id: string | null
  batch_id: string | null
  match_type: GlMatchType | null
}

/** FIX-262：出纳对账——总账已记账分录一侧 */
export interface GlEntryRow {
  id: string
  voucher_id: string
  voucher_date: string
  voucher_no: string
  voucher_type_name: string | null
  summary: string | null
  debit: number
  credit: number
  batch_id: string | null
  match_type: GlMatchType | null
}

export interface GlReconcileSummary {
  currency: string
  /** count：区间内总行数（FIX-326，明细可能被截断，以此为准） */
  cashier: { debit: number; credit: number; balance: number; unmatched: number; count: number }
  gl: { debit: number; credit: number; balance: number; unmatched: number; count: number }
  /** 区间内该科目未记账凭证张数（不参与对账） */
  unposted: number
}

/** FIX-262：差异清单（出纳 ↔ 总账） */
export interface CashierGlReport {
  account_code: string
  currency: string
  end_date: string
  init_date: string | null
  cashier_balance: number
  gl_balance: number
  cashier_unmatched: Array<{ id: string; biz_date: string; summary: string | null; debit: number; credit: number; bill_no: string | null }>
  gl_unmatched: Array<{ id: string; voucher_date: string; voucher_no: string; voucher_type_name: string | null; summary: string | null; debit: number; credit: number }>
  /** FIX-326：两侧未达总行数与净额（服务端 SQL 汇总）；明细最多 list_limit 行 */
  cashier_unmatched_total: number
  gl_unmatched_total: number
  cashier_unmatched_net: number
  gl_unmatched_net: number
  list_limit: number
  adjusted_cashier: number
  adjusted_gl: number
  difference: number
  unposted: number
  stale: number
}

export interface SettleType {
  id: string
  code: string
  name: string
}

export interface CashierPeriodMonth {
  year: number
  month: number
  status: 'open' | 'closed'
  closed_by: string | null
  closed_by_name: string | null
  closed_at: string | null
  journalCount: number
  unvoucheredCount: number
  glClosed: boolean
  canClose: boolean
  canReopen: boolean
  blockReason: string | null
}

// ── 出纳报表类型 ──────────────────────────────────────────────────────
export interface CashierBalanceRow {
  account_code: string
  account_name: string
  currency: string
  opening: number
  income: number
  expense: number
  closing: number
  income_base: number
  expense_base: number
  closing_base: number
  base_estimated: boolean
  count: number
  unreconciled_count: number
  unreconciled_net: number
}
export interface CashierBalanceReport {
  base_currency: string
  currency_mode: 'single' | 'all'
  rows: CashierBalanceRow[]
  totals: Array<{ currency: string; opening: number; income: number; expense: number; closing: number; count: number }>
  total_base: { income: number; expense: number; closing: number }
  empty_accounts: number
}
export interface CashierSummaryNode {
  level: number
  dimension: string
  key: string
  name: string
  income: number
  expense: number
  net: number
  count: number
  income_ratio: number
  expense_ratio: number
  path: Array<{ dimension: string; key: string }>
  children?: CashierSummaryNode[]
}
export interface CashierSummaryReport {
  base_currency: string
  currency_mode: 'single' | 'all'
  group_by: string[]
  root: CashierSummaryNode
  truncated: boolean
}
export interface CashierReportFilterMeta {
  aux_categories: Array<{ id: string; code: string; name: string; journal_count: number; item_count: number }>
  settle_types: Array<{ code: string; name: string; count: number }>
  counter_accounts: Array<{ code: string; name: string; count: number }>
}
export interface CashierSearchRow extends JournalRow {
  account_name?: string
  base_debit?: number
  base_credit?: number
  settle_type_name?: string | null
  counter_account_name?: string | null
  aux_text?: string | null
  voucher_status?: string | null
}
export interface CashierSearchResult {
  list: CashierSearchRow[]
  total: number
  totals: { income: number; expense: number; count: number }
  currency_mode: 'single' | 'all'
  base_currency: string
  aux_columns: AuxColumn[]
}

/** 出纳账户档案（出纳独立账户） */
export interface CashierAccountRecord {
  id: string
  code: string
  name: string
  kind: 'cash' | 'bank' | 'other'
  currency_code: string | null
  bank_name: string | null
  bank_account_no: string | null
  gl_account_code: string | null
  gl_account_name: string | null
  is_enabled: number
  remark: string | null
  journal_count?: number
}

export const cashierApi = {
  getAccounts: () =>
    request.get<CashierAccount[]>('/cashier/accounts'),

  // 出纳账户档案
  listAccountRecords: (kind?: string) =>
    request.get<CashierAccountRecord[]>('/cashier/account-manage', { params: kind ? { kind } : undefined }),
  createAccountRecord: (data: Partial<CashierAccountRecord>) =>
    request.post<{ id: string }>('/cashier/account-manage', data),
  updateAccountRecord: (id: string, data: Partial<CashierAccountRecord>) =>
    request.put<{ ok: boolean }>(`/cashier/account-manage/${id}`, data),
  deleteAccountRecord: (id: string) =>
    request.delete<{ ok: boolean }>(`/cashier/account-manage/${id}`),

  // 出纳结账 / 反结账
  getPeriods: (year: number) =>
    request.get<{ year: number; months: CashierPeriodMonth[] }>(`/cashier/periods/${year}`),
  closePeriod: (year: number, month: number) =>
    request.post<CashierPeriodMonth>(`/cashier/periods/${year}/${month}/close`),
  reopenPeriod: (year: number, month: number) =>
    request.post<CashierPeriodMonth>(`/cashier/periods/${year}/${month}/reopen`),

  getCurrencies: () =>
    request.get<string[]>('/cashier/currencies'),

  getInitBalances: () =>
    request.get<any[]>('/cashier/init-balance'),

  upsertInitBalance: (data: { account_code: string; currency?: string; balance: number; init_date?: string }) =>
    request.put('/cashier/init-balance', data),

  // FIX-261：读入总账余额（出纳启用月之前的总账余额，只读，回填后需保存）
  getInitBalanceFromGl: (initDate?: string | null) =>
    request.get<{ init_date: string; rows: Array<{ account_code: string; currency: string; balance: number }> }>(
      '/cashier/init-balance/gl', { params: initDate ? { init_date: initDate } : undefined }),

  getJournal: (params: {
    account_code: string
    currency?: string
    start_date?: string
    end_date?: string
    /** FIX-253：传了才分页，不传返回全部行 */
    page?: number
    page_size?: number
    /** 日期排序，默认 asc；desc 时余额仍是按时间累计的真实余额 */
    sort_order?: 'asc' | 'desc'
  }) => request.get<JournalResult>('/cashier/journal', { params }),

  getJournalById: (id: string) =>
    request.get<JournalRow>(`/cashier/journal/${id}`),

  /** FIX-260：科目币种与默认汇率（外币科目按业务日期所在期间解析） */
  getJournalRate: (params: { account_code: string; biz_date?: string }) =>
    request.get<{ currency: string; base_currency: string; is_foreign: boolean; rate: number }>('/cashier/journal/rate', { params }),

  createJournal: (data: Partial<JournalRow>) =>
    request.post<{ id: string }>('/cashier/journal', data),

  updateJournal: (id: string, data: Partial<JournalRow>) =>
    request.put(`/cashier/journal/${id}`, data),

  deleteJournal: (id: string) =>
    request.delete(`/cashier/journal/${id}`),

  deleteCashierVouchers: (data: { account_code: string; start_date?: string; end_date?: string; ids?: string[] }) =>
    request.post<{
      deleted: number
      skipped: number
      deletedNos: string[]
      affectedGroups: { year: number; period: number; voucher_type_id: string | null }[]
    }>('/cashier/delete-vouchers', data),

  // 出纳日记账批量导入（前端解析 Excel 后传入 rows）
  importJournal: (data: { account_code: string; currency?: string; rows: Partial<JournalRow>[] }) =>
    request.post<{ inserted: number; errors: { row: number; message: string }[] }>('/cashier/journal/import', data),

  // FIX-262：出纳对账（出纳日记账 ↔ 总账已记账分录，一对多 / 多对一）
  getGlReconcileEntries: (params: { account_code: string; start_date?: string; end_date?: string }) =>
    request.get<{
      cashier: GlCashierRow[]; gl: GlEntryRow[]; summary: GlReconcileSummary; stale: number
      /** FIX-326：每侧明细上限与是否截断 */
      limit: number; truncated: { cashier: boolean; gl: boolean }
    }>(
      '/cashier/gl-reconcile/entries', { params }),
  glAutoMatch: (data: { account_code: string; start_date?: string; end_date?: string; day_tolerance?: number }) =>
    request.post<{ linked: number; matched: number; stale: number }>('/cashier/gl-reconcile/auto', data),
  glManualMatch: (data: { account_code: string; journal_ids: string[]; entry_ids: string[] }) =>
    request.post<{ ok: true; batch_id: string }>('/cashier/gl-reconcile/manual', data),
  glCancelMatch: (data: { account_code: string; ref_id: string }) =>
    request.post<{ ok: true }>('/cashier/gl-reconcile/cancel', data),
  getGlReconcileReport: (params: { account_code: string; end_date: string }) =>
    request.get<CashierGlReport>('/cashier/gl-reconcile/report', { params }),

  getSettleTypes: () =>
    request.get<SettleType[]>('/cashier/settle-types'),

  createSettleType: (data: SettleType) =>
    request.post<{ id: string }>('/cashier/settle-type', data),

  updateSettleType: (id: string, data: Partial<SettleType>) =>
    request.put(`/cashier/settle-type/${id}`, data),

  deleteSettleType: (id: string) =>
    request.delete(`/cashier/settle-type/${id}`),

  initSettleType: () =>
    request.post('/cashier/settle-type/init'),

  // 银行对账单导入（任意 Excel + 自定义列映射，FIX-259；FIX-262 起生成出纳日记账）
  uploadStatement: (file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    return request.post<StatementUploadResult>(
      '/cashier/bank-statement/import', fd, { headers: { 'Content-Type': 'multipart/form-data' } as any }
    )
  },
  confirmImport: (data: StatementConfirmParams) =>
    request.post<StatementImportResult>('/cashier/bank-statement/import/confirm', data),
  getImportProfiles: () =>
    request.get<Record<string, ImportProfile>>('/cashier/bank-statement/import/profiles'),
  // 命名映射方案（账套内所有银行科目共用）
  getImportSchemes: () =>
    request.get<ImportScheme[]>('/cashier/bank-statement/import/schemes'),
  saveImportScheme: (data: ImportProfile & { id?: string; name: string }) =>
    request.post<ImportScheme>('/cashier/bank-statement/import/schemes', data),
  deleteImportScheme: (id: string) =>
    request.delete<null>(`/cashier/bank-statement/import/schemes/${encodeURIComponent(id)}`),

  // 出纳 → 凭证（缺对方科目时由调用方自行处理提示与挂账，故 skipErrorToast）
  generateVoucher: (data: { account_code: string; start_date?: string; end_date?: string; hangup_account_code?: string; ids?: string[]; voucher_type_id?: string }) =>
    request.post<{
      syncedCount: number
      voucherNos: string[]
      totalDebit: number
      totalCredit: number
      hangupCount: number
      hangupCode: string | null
      hangupName: string | null
      details: { voucherNo: string; bizDate: string; summary: string | null; amount: number; direction: '收入' | '支出'; counterCode: string; counterName: string; hungup: boolean }[]
    }>(
      '/cashier/generate-voucher', data, { skipErrorToast: true }
    ),

  // 生成凭证预览：返回将生成凭证的日记账行（预览页二次确认用）
  previewGenerateVoucher: (data: { account_code: string; start_date?: string; end_date?: string; ids?: string[] }) =>
    request.post<{ rows: { id: string; biz_date: string; seq: number | null; summary: string | null; debit: number; credit: number; counter_account: string | null; missing_aux?: string[]; scm_doc_type?: string; scm_doc_no?: string; auto_included?: boolean }[] }>(
      '/cashier/generate-voucher/preview', data, { skipErrorToast: true }
    ),

  // 出纳单据综合查询
  searchJournals: (params: any) =>
    request.get<CashierSearchResult>('/cashier/journal/search', { params }),

  // 出纳日报 / 账户余额表
  getDailyReport: (start_date: string, end_date: string, currency?: string) =>
    request.get<{ rows: DailyReportRow[]; total_income: number; total_expense: number }>('/cashier/daily-report', { params: { start_date, end_date, currency } }),

  // 资金收支汇总表
  getCashFlowSummary: (params: { start_date?: string; end_date?: string; currency?: string; group_by: 'counter_account' | 'settle_type' | 'month' }) =>
    request.get<any[]>('/cashier/summary-report', { params }),

  // ── 出纳报表（统一过滤；辅助项目 = 流水对方科目的辅助核算） ─────────────────────
  reportBalance: (data: Record<string, unknown>) =>
    request.post<CashierBalanceReport>('/cashier/report/balance', data),
  reportSummary: (data: Record<string, unknown>) =>
    request.post<CashierSummaryReport>('/cashier/report/summary', data, { skipErrorToast: true }),
  reportAuxSummary: (data: Record<string, unknown>) =>
    request.post<CashierSummaryReport>('/cashier/report/aux-summary', data, { skipErrorToast: true }),
  reportFilterMeta: () =>
    request.get<CashierReportFilterMeta>('/cashier/report/filter-meta'),

  // 出纳初始化（FIX-264：已记账出纳凭证自动反记账后删除、出纳结账月份一并清除）
  resetPreview: () =>
    request.get<{
      journalRows: number
      vouchers: number
      postedVouchers: string[]
      closedMonths: string[]
      /** 不能自动处理：已记账出纳凭证所在的总账已结账期间 */
      blockedGlPeriods: string[]
    }>('/cashier/reset/preview'),
  reset: () =>
    request.post<{ ok: boolean; backup: string; deletedVouchers: number; unpostedVouchers: number; clearedClosings: number }>(
      '/cashier/reset', {}),

  // 出纳附件
  getJournalAttachments: (id: string) =>
    request.get<any[]>(`/cashier/journal/${id}/attachments`),
  uploadJournalAttachments: (id: string, files: File[]) => {
    const fd = new FormData()
    files.forEach(f => fd.append('file', f))
    return request.post<any[]>(`/cashier/journal/${id}/attachments`, fd, {
      headers: { 'Content-Type': 'multipart/form-data' } as any
    })
  },
  deleteJournalAttachment: (journalId: string, attachmentId: string) =>
    request.delete(`/cashier/journal/${journalId}/attachments/${attachmentId}`),
}

export interface DailyReportRow {
  account_code: string
  account_name: string
  opening: number
  income: number
  expense: number
  closing: number
}
