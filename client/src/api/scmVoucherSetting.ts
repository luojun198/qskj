import request from './request'

/** 辅助核算取值来源 */
export type ScmAuxSource = 'partner' | 'dept' | 'person' | 'none'
export type ScmAuxSourceType = 'partner' | 'dept' | 'person'
/** 匹配规则：名称完全一致 / 编号完全一致 / 编号优先名称兜底 / 名称优先编号兜底 */
export type ScmAuxMatchMode = 'name' | 'code' | 'code_name' | 'name_code'
export type ScmAuxMatchHow = 'manual' | 'confirmed' | 'created' | 'code' | 'name'

export interface ScmAuxCategoryBrief { id: string; name: string; source: ScmAuxSource }

export interface ScmVoucherAccountRow {
  param_key: string
  label: string
  default_code: string
  value: string
  resolved_code: string
  resolved_name: string
  /** 自动匹配命中上级、已下探到末级时的原上级编码 */
  parent_code?: string
  source: '' | 'param' | 'code' | 'name' | 'code_mismatch'
  candidates: Array<{ code: string; name: string }>
  aux_categories: ScmAuxCategoryBrief[]
}

/** 凭证摘要模板：单据类型 → 角色 → 模板；科目规则优先级最高 */
export type SummaryRoleMap = Record<string, Record<string, string>>
export interface SummaryAccountRule { doc_type: string; account: string; template: string }
export interface ScmSummarySetting {
  doc_types: Array<{ code: string; name: string }>
  roles: Array<{ key: string; label: string }>
  placeholders: Array<{ key: string; desc: string }>
  defaults: SummaryRoleMap
  custom: { roles: SummaryRoleMap; accounts: SummaryAccountRule[] }
}

export interface ScmVoucherSetting {
  /** 进销存生成凭证的默认凭证类型（'' = 自动） */
  default_voucher_type_id?: string
  summary: ScmSummarySetting
  accounts: ScmVoucherAccountRow[]
  match_mode: ScmAuxMatchMode
  categories: Array<{ id: string; code: string; name: string; source: ScmAuxSource; used_by: string[] }>
  settle_accounts: Array<{ code: string; name: string; doc_count: number; aux_categories: ScmAuxCategoryBrief[]; issues: string[] }>
  pending: Record<ScmAuxSourceType, number>
  /** 其他入库 / 其他出库：收发类别 → 对方科目（未指定时按内置规则带默认科目） */
  io_category_accounts?: Array<{
    category: string
    dir: 'in' | 'out' | ''
    account: string
    account_name: string
    default_code: string
    default_name: string
    default_label: string
  }>
}

export interface AuxSuggestion { id: string; code: string; name: string; score: number }

export interface AuxPreviewRow {
  key: string
  source_type: ScmAuxSourceType
  source_code: string
  source_name: string
  partner_type?: string | null
  accounts: string[]
  category_id: string
  category_name: string
  status: 'matched' | 'suggested' | 'unmatched'
  ambiguous: boolean
  item_id: string | null
  item_code: string | null
  item_name: string | null
  how: ScmAuxMatchHow | null
  map_id: string | null
  suggestions: AuxSuggestion[]
}

export interface AuxPreviewResult {
  rows: AuxPreviewRow[]
  total: number
  page: number
  page_size: number
  counts: { all: number; matched: number; suggested: number; unmatched: number }
  not_required: number
  match_mode: ScmAuxMatchMode
}

export interface AuxMapInput {
  source_type: ScmAuxSourceType
  source_code: string
  category_id: string
  aux_item_id: string
  match_source?: 'manual' | 'confirmed'
}

export interface AuxCreateResult {
  sourceType: string
  sourceCode: string
  categoryId: string
  ok: boolean
  auxItemId?: string
  message: string
}

export type PresetReason = '未配置' | '非末级' | '科目不存在' | '本账套找不到同类科目'
interface PresetBase { current: string; current_name: string; proposed: string; proposed_name: string; reason: PresetReason }
export interface PresetAccount extends PresetBase { param_key: string; label: string }
export interface PresetItem extends PresetBase { code: string; name: string; item_type: string | null }
export interface PresetPartner extends PresetBase { code: string; name: string; partner_type: string; field: 'ar_account' | 'ap_account' }
/** 一键自动预设的建议（全部为最底层末级科目） */
export interface ScmPreset {
  accounts: PresetAccount[]
  match_mode: ScmAuxMatchMode
  source_map: Record<string, ScmAuxSource>
  items: PresetItem[]
  partners: PresetPartner[]
}

/** 生成凭证被拦截时后端返回的未对应项 */
export interface ScmAuxProblem {
  kind: 'unmatched' | 'ambiguous' | 'no_source' | 'empty_source'
  accountCode: string
  accountName: string
  categoryId: string
  categoryName: string
  sourceType: ScmAuxSourceType | null
  sourceCode: string
  sourceName: string
  suggestions: AuxSuggestion[]
  /** 涉及的单据（前端按失败单据补充，用于打开单据手工修正） */
  docs?: Array<{ id: string; doc_no: string }>
}

export const scmVoucherSettingApi = {
  get: () => request.get<ScmVoucherSetting>('/scm/voucher-setting'),
  save: (data: {
    accounts?: Record<string, string>
    match_mode?: ScmAuxMatchMode
    source_map?: Record<string, ScmAuxSource>
    item_accounts?: Array<{ code: string; inv_account: string }>
    partner_accounts?: Array<{ code: string; ar_account?: string; ap_account?: string }>
    summary_templates?: { roles: SummaryRoleMap; accounts: SummaryAccountRule[] }
    /** 进销存生成凭证的默认凭证类型（'' = 自动：本期最近使用 / 编码最小） */
    default_voucher_type_id?: string
    /** 收发类别 → 对方科目（只存指定了科目的类别） */
    io_category_accounts?: Record<string, string>
  }) => request.put<{ items: number; partners: number }>('/scm/voucher-setting', data),
  summaryPreview: (templates: Array<{ key: string; doc_type: string; template: string; account_name?: string }>) =>
    request.post<Array<{ key: string; text: string }>>('/scm/voucher-setting/summary-preview', { templates }),
  preset: () => request.get<ScmPreset>('/scm/voucher-setting/preset'),
  preview: (params: { source_type: ScmAuxSourceType; status?: string; keyword?: string; page?: number; page_size?: number }) =>
    request.get<AuxPreviewResult>('/scm/voucher-setting/aux-preview', { params }),
  auxItems: (categoryId: string, keyword = '') =>
    request.get<Array<{ id: string; code: string; name: string }>>('/scm/voucher-setting/aux-items', { params: { category_id: categoryId, keyword } }),
  saveMap: (items: AuxMapInput[]) => request.put('/scm/voucher-setting/aux-map', { items }),
  deleteMap: (id: string) => request.delete(`/scm/voucher-setting/aux-map/${id}`),
  createAux: (rows: Array<{ source_type: string; source_code: string; category_id: string }>) =>
    request.post<{ results: AuxCreateResult[]; ok: number; failed: number }>('/scm/voucher-setting/aux-create', { rows }),
}
