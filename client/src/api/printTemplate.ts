import request from '@/api/request'
import type {
  PrintTemplate,
  PrintTemplateType,
  ApplicableTemplate,
  HiprintPanel,
} from '@/types/print'

export interface SavePrintTemplatePayload {
  name: string
  paper_size?: string
  paper_width: number
  paper_height: number
  margin_top?: number
  margin_bottom?: number
  margin_left?: number
  margin_right?: number
  elements?: unknown
  template_type?: PrintTemplateType
  template_key?: string | null
  panel?: HiprintPanel | null
}

/** 模板列表（可按 type / key 过滤） */
export function getPrintTemplates(params?: { template_type?: PrintTemplateType; template_key?: string }) {
  return request.get<PrintTemplate[]>('/base/print-templates', { params })
}

/** 运行时可选模板（轻量，用于打印对话框下拉） */
export function getApplicableTemplates(params: { template_type: PrintTemplateType; template_key?: string }) {
  return request.get<ApplicableTemplate[]>('/base/print-templates/applicable', { params })
}

/** 模板详情（含 panel JSON） */
export function getPrintTemplate(id: string) {
  return request.get<PrintTemplate>(`/base/print-templates/${id}`)
}

export function createPrintTemplate(payload: SavePrintTemplatePayload) {
  return request.post<{ id: string }>('/base/print-templates', payload)
}

export function updatePrintTemplate(id: string, payload: SavePrintTemplatePayload) {
  return request.put<null>(`/base/print-templates/${id}`, payload)
}

export function deletePrintTemplate(id: string) {
  return request.delete<null>(`/base/print-templates/${id}`)
}

export function setDefaultPrintTemplate(id: string) {
  return request.post<null>(`/base/print-templates/default/${id}`)
}

/** 上传套打底图，返回 background_image URL */
export function uploadTemplateBackground(id: string, file: File) {
  const formData = new FormData()
  formData.append('file', file)
  return request.post<{ background_image: string }>(`/base/print-templates/${id}/background`, formData)
}
