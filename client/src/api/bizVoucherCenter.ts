import request from './request'
import type { AssetVoucherKind, AssetVoucherRow } from './fixedAsset'
import type { ScmAuxProblem } from './scmVoucherSetting'

/** 业务凭证中心：待生成 / 已生成 / 全部 */
export type BizVoucherStatus = 'pending' | 'generated' | 'all'

export interface BizVoucherCount { pending: number; generated: number }

export interface BizVoucherSummary {
  /** 无权限或模块未启用时为 null（中心里不显示该来源） */
  scm: BizVoucherCount | null
  cashier: BizVoucherCount | null
  asset: BizVoucherCount | null
  /** 当前用户可处理的进销存单据类型 */
  scm_doc_types: string[]
}

export interface BizScmDocRow {
  id: string
  doc_type: string
  doc_type_name: string | null
  doc_no: string
  doc_date: string
  partner_code: string | null
  partner_name: string | null
  dept_code: string | null
  total_amount: number | null
  total_tax: number | null
  currency: string | null
  remark: string | null
  source_doc_id: string | null
  voucher_id: string | null
  voucher_no: string | null
  voucher_status: 'draft' | 'audited' | 'posted' | null
  voucher_year: number | null
  voucher_period: number | null
}

/** 进销存生成方式：每张一张 / 所选汇总一张 / 按日期汇总 / 按客商汇总（汇总均按期间再拆） */
export type BizScmGenMode = 'single' | 'all' | 'date' | 'partner'

export interface BizScmResult {
  id: string
  doc_no: string
  ok: boolean
  voucher_id?: string
  voucher_no?: string
  /** 合并制证：与本单在同一张凭证里的单据数 */
  merged_count?: number
  /** 删除合并凭证时一并恢复待生成的其它单据 */
  shared_ids?: string[]
  message?: string
  reason?: string
  data?: { doc_id: string; doc_no: string; items: ScmAuxProblem[] }
}

export interface BizRangeQuery { start_date?: string; end_date?: string }

export const bizVoucherCenterApi = {
  summary: (params: BizRangeQuery) => request.get<BizVoucherSummary>('/biz-voucher/summary', { params }),
  scmDocs: (params: BizRangeQuery & { status: BizVoucherStatus; doc_type?: string; keyword?: string; page?: number; page_size?: number }) =>
    request.get<{ list: BizScmDocRow[]; total: number; page: number; page_size: number }>('/biz-voucher/scm-docs', { params }),
  scmGenerate: (ids: string[], mode: BizScmGenMode = 'single', voucherTypeId = '') =>
    request.post<{ results: BizScmResult[]; ok: number; failed: number; voucher_count?: number }>('/biz-voucher/scm/generate', {
      ids, mode, ...(voucherTypeId ? { voucher_type_id: voucherTypeId } : {}),
    }),
  scmDelete: (ids: string[]) =>
    request.post<{
      results: BizScmResult[]
      ok: number
      failed: number
      affectedGroups: Array<{ year: number; period: number; voucher_type_id: string | null }>
    }>('/biz-voucher/scm/delete', { ids }),
  assetItems: (params: BizRangeQuery & { status: BizVoucherStatus; kind?: AssetVoucherKind; keyword?: string; page?: number; page_size?: number }) =>
    request.get<{ list: AssetVoucherRow[]; total: number; page: number; page_size: number }>('/biz-voucher/asset-items', { params }),
}
