import request from './request'

/** 报表导入/执行可能涉及大模板解析，超时需长于默认 30s */
export const REPORT_LONG_REQUEST_TIMEOUT = 120_000
export const REPORT_EXECUTE_REQUEST_TIMEOUT = 60_000

export type MergeInfo = {
  colSpan: number
  rowSpan: number
}

export type TemplateDefinition = {
  id: string
  code: string
  name: string
  source: string
  source_file: string | null
  sort_order: number
  is_enabled: boolean
}

export type TemplateSource = {
  source_file: string
  source_type: string
  content_encoding: string | null
  parse_version: string | null
  created_at: string
} | null

export type FormulaFunction = {
  function_name: string
  handler_key: string
  description: string | null
}

export type TemplateCell = {
  id: string
  report_sheet_id: string
  row_index: number
  col_index: number
  cell_type: string
  text_value: string | null
  formula_text: string | null
  format_text: string | null
  style_key: string | null
  side: string | null
  col_width: number | null
  row_height: number | null
  merge_info: string | null
}

export type TemplateSheet = {
  id: string
  report_definition_id: string
  sheet_key: string
  sheet_name: string
  sheet_index: number
  default_col_width: number | null
  default_row_height: number | null
  col_widths: string | null
  row_heights: string | null
  metrics: {
    cellCount: number
    rowCount: number
    colCount: number
    errorCount?: number
  }
  cells: TemplateCell[]
}

export type TemplateDetailData = {
  definition: TemplateDefinition
  source: TemplateSource
  formulaFunctions: FormulaFunction[]
  sheets: TemplateSheet[]
}

export type UpdateReportCellPayload = {
  id?: string
  row_index?: number
  col_index?: number
  text_value?: string | null
  formula_text?: string | null
  format_text?: string | null
  cell_type?: string
  col_width?: number | null
  row_height?: number | null
  merge_info?: string | MergeInfo | null
}

export type SaveTemplateCellsRequest = {
  sheetId: string
  cells: UpdateReportCellPayload[]
}

export function normalizeMergeInfoInput(
  input: string | MergeInfo | null | undefined
): string | null {
  if (input == null || input === '') return null

  const obj = typeof input === 'string' ? (JSON.parse(input) as Partial<MergeInfo>) : input
  const colSpan = Number(obj.colSpan ?? 1)
  const rowSpan = Number(obj.rowSpan ?? 1)

  if (!Number.isInteger(colSpan) || colSpan < 1) {
    throw new Error('merge_info.colSpan 必须是大于等于 1 的整数')
  }
  if (!Number.isInteger(rowSpan) || rowSpan < 1) {
    throw new Error('merge_info.rowSpan 必须是大于等于 1 的整数')
  }
  if (colSpan === 1 && rowSpan === 1) return null

  return JSON.stringify({ colSpan, rowSpan })
}

export async function getTemplateDetail(code: string): Promise<TemplateDetailData> {
  const res = await request.get<TemplateDetailData>(`/report/templates/${code}`)
  return res.data
}

export async function downloadReportExport(
  code: string,
  params: { year: number; period: number }
): Promise<Blob> {
  return request.download(`/report/templates/${encodeURIComponent(code)}/export`, { params })
}

export type SaveSheetLayoutRequest = {
  col_widths: number[]
  row_heights: number[]
}

export async function saveSheetLayout(
  code: string,
  sheetId: string,
  payload: SaveSheetLayoutRequest
): Promise<void> {
  await request.patch(`/report/templates/${encodeURIComponent(code)}/sheets/${encodeURIComponent(sheetId)}/layout`, payload)
}

export async function saveTemplateCells(
  code: string,
  payload: SaveTemplateCellsRequest
): Promise<void> {
  const normalized: SaveTemplateCellsRequest = {
    sheetId: payload.sheetId,
    cells: payload.cells.map(cell => ({
      ...cell,
      merge_info:
        cell.merge_info === undefined ? undefined : normalizeMergeInfoInput(cell.merge_info),
    })),
  }

  await request.put(`/report/templates/${code}/cells`, normalized)
}

export interface UpdateTemplateMetaResponse {
  code: string
  name: string
  is_enabled: boolean
  swapped: boolean
  swapWith: {
    code: string
    name: string
    originalCode: string
  } | null
}

/**
 * 修改报表模板的 code / name / is_enabled。
 * - 导航顺序请使用 updateReportTemplateSortOrder 调整。
 * - 若新 code 与同账套另一个报表重复，后端会自动互换两者的 code，并在响应中返回 swapped=true。
 * - is_enabled = false 的报表不会出现在导航栏。
 */
export async function updateReportTemplateMeta(
  currentCode: string,
  payload: { code?: string; name?: string; is_enabled?: boolean }
): Promise<{ message: string; data: UpdateTemplateMetaResponse }> {
  const res = await request.patch<UpdateTemplateMetaResponse>(
    `/report/templates/${encodeURIComponent(currentCode)}/meta`,
    payload
  )
  return { message: res.message || '更新成功', data: res.data }
}

export type ReportTemplateSortItem = {
  code: string
  name: string
  sort_order: number
  is_enabled: boolean
}

/**
 * 批量更新报表导航顺序（须覆盖当前账套全部报表）。
 */
export async function updateReportTemplateSortOrder(
  orders: { code: string; sort_order: number }[]
): Promise<{ message: string; data: ReportTemplateSortItem[] }> {
  const res = await request.put<ReportTemplateSortItem[]>('/report/templates/sort-order', { orders })
  return { message: res.message || '导航顺序已更新', data: res.data || [] }
}
