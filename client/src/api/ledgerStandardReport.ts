import request from '@/api/request'

export type RhStandardReportCellType = 'text' | 'formula' | 'number' | 'empty' | 'merged'

export interface RhStandardReportCell {
  id: string
  report_id: string
  row_index: number
  col_index: number
  text_value: string | null
  formula_text: string | null
  /** 以下字段与动态报表的 report_cells 对齐，便于复用同一套网格组件 */
  cell_type?: RhStandardReportCellType | null
  format_text?: string | null
  style_key?: string | null
  side?: 'left' | 'right' | null
  merge_info?: string | null
  col_width?: string | null
  row_height?: string | null
}

/** 保存单元格时的入参：仅传需要改动的字段，未传的字段服务端保留旧值 */
export interface RhStandardReportCellInput {
  row_index: number
  col_index: number
  cell_type?: RhStandardReportCellType
  text_value?: string | null
  formula_text?: string | null
  format_text?: string | null
  style_key?: string | null
  side?: 'left' | 'right' | null
  merge_info?: string | null
  col_width?: string | null
  row_height?: string | null
}

export type RhStandardReportRowColAction =
  | 'insert_row'
  | 'delete_row'
  | 'insert_col'
  | 'delete_col'

export interface RhStandardReport {
  id: string
  account_set_id: string
  name: string
  code?: string
  created_at: string
}

export interface RhStandardReportDetail extends RhStandardReport {
  source_file?: string | null
  default_col_width?: number | null
  default_row_height?: number | null
  /** JSON 字符串，形如 "[120,80,...]" */
  col_widths?: string | null
  row_heights?: string | null
  paper_size?: string | null
  paper_orientation?: 'portrait' | 'landscape' | null
  print_scale?: number | null
  margin_top?: number | null
  margin_bottom?: number | null
  margin_left?: number | null
  margin_right?: number | null
  cells: RhStandardReportCell[]
}

export interface RhStandardReportComputedCell {
  row_index: number
  col_index: number
  display_value: string
  numeric_value: number | null
  status: 'ok' | 'error'
  address?: string
  error?: string | null
}

export interface RhStandardReportComputed {
  year: number
  period: number
  maxRow: number
  maxCol: number
  cells: RhStandardReportComputedCell[]
}

export interface RhStandardReportImportOption {
  code: string
  name: string
  source_file: string
}

export interface RhStandardReportImportPreview {
  reports: RhStandardReportImportOption[]
  warnings: string[]
}

export interface RhStandardReportImportResult {
  id: string
  code: string
  name: string
}

export function previewAcdForStandardReports(file: File) {
  const formData = new FormData()
  formData.append('file', file)
  return request.post<RhStandardReportImportPreview>(
    '/ledger/standard-reports/import-preview',
    formData,
    { timeout: 60000 }
  )
}

export function uploadAcdForStandardReports(file: File, reportCodes: string[]) {
  const formData = new FormData()
  formData.append('file', file)
  formData.append('report_codes', JSON.stringify(reportCodes))
  return request.post<RhStandardReportImportResult[]>('/ledger/standard-reports/upload', formData, {
    timeout: 60000
  })
}

export function getStandardReports() {
  return request.get<RhStandardReport[]>('/ledger/standard-reports')
}

export function getStandardReportDetail(id: string) {
  return request.get<RhStandardReportDetail>(`/ledger/standard-reports/${id}`)
}

export function deleteStandardReport(id: string) {
  return request.delete<null>(`/ledger/standard-reports/${id}`)
}

export interface FormulaReferenceItem {
  group: string
  name: string
  signature: string
  description: string
}

/** 公式速查表：引擎支持的全部函数，供公式栏 fx 弹层展示 */
export function getFormulaReference() {
  return request.get<FormulaReferenceItem[]>('/ledger/standard-reports/formula-reference')
}

export function computeStandardReport(id: string, params: { year: number; period: number }) {
  return request.get<RhStandardReportComputed>(`/ledger/standard-reports/${id}/compute`, { params })
}

/** 批量保存单元格（新增/更新）。未传的字段服务端保留旧值。 */
export function saveStandardReportCells(id: string, cells: RhStandardReportCellInput[]) {
  return request.put<{ saved: number }>(`/ledger/standard-reports/${id}/cells`, { cells })
}

/** 保存列宽 / 行高 */
export function saveStandardReportLayout(
  id: string,
  payload: {
    col_widths?: number[]
    row_heights?: number[]
    default_col_width?: number
    default_row_height?: number
  }
) {
  return request.patch<null>(`/ledger/standard-reports/${id}/layout`, payload)
}

/** 插入 / 删除行列。服务端会同步平移既有公式里的单元格引用。 */
export function updateStandardReportRowCol(
  id: string,
  payload: { action: RhStandardReportRowColAction; index: number; count?: number }
) {
  return request.post<null>(`/ledger/standard-reports/${id}/rowcol`, payload)
}

/** 新建空白报表 */
export function createStandardReport(payload: { name: string }) {
  return request.post<{ id: string; code: string; name: string }>(
    '/ledger/standard-reports',
    payload
  )
}

/** 保存打印页面设置（纸张 / 方向 / 缩放 / 页边距） */
export function saveStandardReportPageSetup(
  id: string,
  payload: {
    paper_size?: string
    paper_orientation?: 'portrait' | 'landscape'
    print_scale?: number
    margin_top?: number
    margin_bottom?: number
    margin_left?: number
    margin_right?: number
  }
) {
  return request.patch<null>(`/ledger/standard-reports/${id}/page-setup`, payload)
}
