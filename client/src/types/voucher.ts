/** 凭证分录 */
export interface VoucherEntry {
  id?: string | number
  account_id: string | number
  account_code: string
  account_name: string
  direction: 'debit' | 'credit'
  amount: number
  summary: string
  aux_data?: Record<string, AuxItemRef>
  cash_flow_code?: string
  cash_flow_name?: string
  /** 外币核算：币种编码 */
  currency_code?: string | null
  /** 外币核算：记账汇率 */
  exchange_rate?: number | null
  /** 外币核算：原币金额 */
  foreign_amount?: number | null
  /** 数量核算：数量 */
  quantity?: number | null
  /** 数量核算：单价 */
  unit_price?: number | null
  /** 数量核算：计量单位 */
  unit?: string | null
}

/** 辅助项目引用（存储在 aux_data 中的结构） */
export interface AuxItemRef {
  id: string | number
  name: string
  field_values?: Record<string, string | number>
}

/** 凭证 */
export interface Voucher {
  id: string | number
  voucher_no: string
  voucher_type_id: string | number
  voucher_type_name: string
  voucher_date: string
  status: 'draft' | 'audited' | 'posted'
  entries: VoucherEntry[]
  remark?: string
  maker_name?: string
  auditor_name?: string
  poster_name?: string
  created_at?: string
  updated_at?: string
}

/** 凭证查询筛选参数 */
export interface VoucherQueryParams {
  page: number
  pageSize: number
  keyword?: string
  status?: string
  year?: number
  period?: number
  start_date?: string
  end_date?: string
  voucher_type_ids?: string
  sortField?: string
  sortOrder?: 'asc' | 'desc'
}
