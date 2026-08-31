import request from './request'

export interface CashierAccount {
  code: string
  name: string
  is_cash: number
  is_bank: number
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
}

export interface JournalResult {
  opening: number
  rows: JournalRow[]
  closing: number
  totalDebit: number
  totalCredit: number
}

export interface BankStatement {
  id: string
  account_code: string
  biz_date: string
  debit: number
  credit: number
  settle_type: string | null
  bill_no: string | null
  matched: number
  match_batch: number | null
  source: string
}

export interface SettleType {
  id: string
  code: string
  name: string
}

export const cashierApi = {
  getAccounts: () =>
    request.get<CashierAccount[]>('/cashier/accounts'),

  getInitBalances: () =>
    request.get<any[]>('/cashier/init-balance'),

  upsertInitBalance: (data: { account_code: string; currency?: string; balance: number; init_date?: string }) =>
    request.put('/cashier/init-balance', data),

  getJournal: (params: {
    account_code: string
    currency?: string
    start_date?: string
    end_date?: string
    reconciled?: 0 | 1
  }) => request.get<JournalResult>('/cashier/journal', { params }),

  createJournal: (data: Partial<JournalRow>) =>
    request.post<{ id: string }>('/cashier/journal', data),

  updateJournal: (id: string, data: Partial<JournalRow>) =>
    request.put(`/cashier/journal/${id}`, data),

  deleteJournal: (id: string) =>
    request.delete(`/cashier/journal/${id}`),

  deleteCashierVouchers: (data: { account_code: string; start_date?: string; end_date?: string }) =>
    request.post<{
      deleted: number
      skipped: number
      deletedNos: string[]
      affectedGroups: { year: number; period: number; voucher_type_id: string | null }[]
    }>('/cashier/delete-vouchers', data),

  // 出纳日记账批量导入（前端解析 Excel 后传入 rows）
  importJournal: (data: { account_code: string; currency?: string; rows: Partial<JournalRow>[] }) =>
    request.post<{ inserted: number; errors: { row: number; message: string }[] }>('/cashier/journal/import', data),

  getBankStatements: (params: {
    account_code?: string
    start_date?: string
    end_date?: string
    matched?: number
  }) => request.get<BankStatement[]>('/cashier/bank-statement', { params }),

  createBankStatement: (data: Partial<BankStatement>) =>
    request.post<{ id: string }>('/cashier/bank-statement', data),

  autoReconcile: (data: { account_code: string; start_date?: string; end_date?: string; use_bill_no?: boolean }) =>
    request.post<{ matched: number; batch: number }>('/cashier/reconcile/auto', data),

  manualReconcile: (data: { journal_id: string; bank_statement_id: string }) =>
    request.post<{ ok: true }>('/cashier/reconcile/manual', data),

  cancelReconcile: (data: { journal_id: string }) =>
    request.post<{ ok: true }>('/cashier/reconcile/cancel', data),

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

  // 银行余额调节表
  getReconciliation: (params: { account_code: string; end_date: string }) =>
    request.get<ReconciliationData>('/cashier/reconciliation', { params }),

  // 银行对账单导入
  uploadStatement: (file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    return request.post<{ preview_id: string; filename: string; total_rows: number; sample_rows: any[][] }>(
      '/cashier/bank-statement/import', fd, { headers: { 'Content-Type': 'multipart/form-data' } as any }
    )
  },
  confirmImport: (data: { preview_id: string; account_code: string; mapping: Record<string, number>; skip_rows?: number; header_row?: number }) =>
    request.post<{ inserted: number }>('/cashier/bank-statement/import/confirm', data),
  getImportProfiles: () =>
    request.get<Record<string, any>>('/cashier/bank-statement/import/profiles'),

  // 出纳 → 凭证（缺对方科目时由调用方自行处理提示与挂账，故 skipErrorToast）
  generateVoucher: (data: { account_code: string; start_date?: string; end_date?: string; hangup_account_code?: string; ids?: string[] }) =>
    request.post<{ syncedCount: number; voucherNos: string[] }>(
      '/cashier/generate-voucher', data, { skipErrorToast: true }
    ),

  // 出纳单据综合查询
  searchJournals: (params: any) =>
    request.get<{ list: JournalRow[]; total: number }>('/cashier/journal/search', { params }),

  // 出纳日报 / 账户余额表
  getDailyReport: (start_date: string, end_date: string) =>
    request.get<{ rows: DailyReportRow[]; total_income: number; total_expense: number }>('/cashier/daily-report', { params: { start_date, end_date } }),

  // 资金收支汇总表
  getCashFlowSummary: (params: { start_date?: string; end_date?: string; group_by: 'counter_account' | 'settle_type' | 'month' }) =>
    request.get<any[]>('/cashier/summary-report', { params }),

  // 出纳初始化
  reset: () => request.post('/cashier/reset', {}),

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

export interface ReconciliationData {
  account_code: string
  end_date: string
  enterprise_balance: number
  bank_balance: number
  enterprise_recorded: { biz_date: string; summary: string | null; debit: number; credit: number; settle_type: string | null; bill_no: string | null }[]
  bank_recorded: { biz_date: string; debit: number; credit: number; settle_type: string | null; bill_no: string | null }[]
  adjusted_enterprise: number
  adjusted_bank: number
  difference: number
}
