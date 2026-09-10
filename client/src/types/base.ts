/** 凭证类型 */
export interface VoucherType {
  id: string
  code: string
  name: string
  description?: string
}

/** 会计科目 */
export interface Account {
  id: number | string
  code: string
  name: string
  level: number
  is_parent: boolean | number
  is_enabled: boolean | number
  parent_id?: number | string | null
  direction?: 'debit' | 'credit'
  account_type?: string
  is_aux?: number
  aux_types?: string | null
  is_cash?: number
  is_bank?: number
  /** 外币核算：1 = 该科目按外币记账 */
  is_foreign?: number
  /** 外币核算币种编码（is_foreign = 1 时必填） */
  currency_code?: string | null
  /** 数量核算：1 = 该科目按数量金额式记账 */
  is_quantity?: number
  /** 计量单位（is_quantity = 1 时必填，自由文本如「个 / 千克」） */
  quantity_unit?: string | null
  no_negative?: number
}

/** 辅助核算类别 */
export interface AuxCategory {
  id: string | number
  code: string
  name: string
  is_required?: boolean
}

/** 辅助核算项目 */
export interface AuxItem {
  id: string | number
  code: string
  name: string
  type: string
  status: 'active' | 'closed'
  remark?: string
}
