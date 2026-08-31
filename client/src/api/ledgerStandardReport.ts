import request from '@/api/request'

export interface RhStandardReportCell {
  id: string
  report_id: string
  row_index: number
  col_index: number
  text_value: string | null
  formula_text: string | null
}

export interface RhStandardReport {
  id: string
  account_set_id: string
  name: string
  code?: string
  created_at: string
}

export interface RhStandardReportDetail extends RhStandardReport {
  source_file?: string | null
  cells: RhStandardReportCell[]
}

export interface RhStandardReportComputedCell {
  row_index: number
  col_index: number
  display_value: string
  numeric_value: number | null
  status: 'ok' | 'error'
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

export function computeStandardReport(id: string, params: { year: number; period: number }) {
  return request.get<RhStandardReportComputed>(`/ledger/standard-reports/${id}/compute`, { params })
}
