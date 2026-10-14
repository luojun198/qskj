// 进销存 ACD 独立导入（润衡 POS 备份 → 当前账套进销存）
import request from './request'

export interface AcdPreview {
  meta: { company: string; linkedAccountSet: string; version: string; fileName?: string }
  dateRange: { from: string | null; to: string | null }
  tables: Array<{ table: string; label: string; rows: number }>
  docTypes: Array<{ acd: string; label: string; target: string | null; count: number; lines: number }>
  orders: Array<{ acd: string; label: string; target: string; count: number }>
  countDocs: number
  finance: {
    payments: number; receipts: number; paymentAmount: number; receiptAmount: number
    invoices: number; invoiceAmount: number; statements: number
    settleAccounts: Array<{ lx: string; account: string | null; name: string | null; exists: boolean }>
  }
  conflicts: { items: string[]; partners: string[]; warehouses: string[] }
  existing: { docs: number; items: number; partners: number; warehouses: number }
  costingMethod: string
  blockers: string[]
  warnings: string[]
}

export interface AcdCounter { inserted: number; updated: number; skipped: number }

export interface AcdImportStats {
  master: {
    warehouses: AcdCounter; categories: AcdCounter; units: AcdCounter; items: AcdCounter; partners: AcdCounter
    placeholders: { items: string[]; partners: string[]; warehouses: string[] }
  }
  documents: {
    orders: Record<string, number>; docs: Record<string, number>; lines: number; moves: number
    skipped: Record<string, number>; linkedOrderLines: number
  }
  finance?: {
    payments: AcdPayStats; receipts: AcdPayStats
    invoices: { RS: number; RP: number; lines: number; amount: number }
    statements: { ar: number; ap: number }
  }
}

export interface AcdPayStats { docs: number; lines: number; amount: number; verified: number; unverified: number }

export type StockDiffReason = 'qty' | 'acd_residual' | 'no_cost_wh' | 'amount'

export interface AcdVerifyReport {
  stock: {
    compared: number; qtyMatched: number; amountMatched: number
    acdTotalQty: number; acdTotalAmount: number; totalQty: number; totalAmount: number
    diffs: Array<{
      warehouse_code: string; item_code: string; item_name: string | null
      acd_qty: number; acd_amount: number; qty: number; amount: number; qty_diff: number; amount_diff: number
      reason: StockDiffReason
    }>
    byReason: Record<string, { count: number; amount_diff: number }>
  }
  arap: {
    partners: number; matched: number
    acdTotal: { ar: number; ap: number }; total: { ar: number; ap: number }
    diffs: Array<{ partner_code: string; partner_name: string | null; side: 'ar' | 'ap'; acd: number; ours: number; diff: number }>
  }
  negatives: Array<{ warehouse_code: string; item_code: string; item_name: string | null; qty: number; amount: number }>
  invoices?: { acd: { RS: number; RP: number }; ours: { RS: number; RP: number } }
  issues?: AcdIssue[]
}

export interface AcdIssue { level: 'error' | 'warn' | 'info'; category: string; message: string }

export interface AcdImportBatch {
  id: string
  file_name: string | null
  company_name: string | null
  options: { conflict: 'skip' | 'overwrite' } | null
  stats: AcdImportStats | null
  report?: AcdVerifyReport | null
  status: 'running' | 'done' | 'reverted'
  operator: string | null
  backup_file: string | null
  created_at: string
  reverted_at: string | null
  revert_blocker?: string | null
}

const formOf = (file: File, extra: Record<string, string> = {}) => {
  const fd = new FormData()
  fd.append('file', file)
  for (const [k, v] of Object.entries(extra)) fd.append(k, v)
  return fd
}

/** 大账套解析 + 导入可能较久，单独放宽超时 */
const LONG = { timeout: 600_000, headers: { 'Content-Type': 'multipart/form-data' } as any }

export const scmAcdImportApi = {
  preview: (file: File) => request.post<AcdPreview>('/scm/acd-import/preview', formOf(file), LONG),
  execute: (file: File, options: { conflict: 'skip' | 'overwrite' }) =>
    request.post<{ batchId: string; stats: AcdImportStats; report: AcdVerifyReport; issues: AcdIssue[]; backupFile: string | null }>(
      '/scm/acd-import/execute', formOf(file, { options: JSON.stringify(options) }), LONG),
  listBatches: () => request.get<AcdImportBatch[]>('/scm/acd-import/batches'),
  getBatch: (id: string) => request.get<AcdImportBatch>(`/scm/acd-import/batches/${id}`),
  revert: (id: string) => request.post<{ removed: Record<string, number>; backup: string }>(`/scm/acd-import/batches/${id}/revert`, {}, { timeout: 600_000 }),
}
