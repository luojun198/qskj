/**
 * 凭证 Excel 转出 / 转入 API（凭证录入页「转出」「转入」）
 */
import request from './request'

export interface VoucherExcelColumn {
  key: string
  label: string
  required: boolean
  /** 辅助核算动态列：类别 code */
  auxCategoryCode?: string
}

export interface VoucherExcelImportOptions {
  dateMode: 'original' | 'monthEnd'
  targetYear?: number
  targetPeriod?: number
  numberMode: 'auto' | 'manual'
  startNo?: number
}

export interface VoucherExcelRowError {
  /** Excel 行号（表头为第 1 行）；0 表示选项错误 */
  row: number
  field?: string
  message: string
}

export interface VoucherExcelPreview {
  seq: string
  voucher_type_name: string
  voucher_date: string
  entry_count: number
  total_debit: number
  total_credit: number
  rows: number[]
}

export const voucherExcelApi = {
  getColumns: () => request.get<VoucherExcelColumn[]>('/voucher/excel-import/columns'),
  validate: (rows: Record<string, unknown>[], options: VoucherExcelImportOptions) =>
    request.post<{ rowCount: number; vouchers: VoucherExcelPreview[]; errors: VoucherExcelRowError[] }>(
      '/voucher/excel-import/validate',
      { rows, options }
    ),
  confirm: (rows: Record<string, unknown>[], options: VoucherExcelImportOptions) =>
    request.post<{ created: number; voucher_ids: string[]; voucher_nos: string[] }>(
      '/voucher/excel-import/confirm',
      { rows, options }
    ),
}
