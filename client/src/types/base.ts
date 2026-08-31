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
