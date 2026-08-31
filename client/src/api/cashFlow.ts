import request from './request'

export interface CashFlowItem {
  id: string
  account_set_id: string
  code: string
  name: string
  direction: 'inflow' | 'outflow' | 'neutral'
  parent_code: string | null
  level: number
  is_leaf: number
  sort_order: number
  is_active: number
  created_at: string
  updated_at: string
  children?: CashFlowItem[]
}

/**
 * 获取现金流量项目列表
 */
export function getCashFlowItems(accountSetId: string) {
  return request.get<CashFlowItem[]>('/base/cash-flow-items', {
    params: { account_set_id: accountSetId }
  })
}

/**
 * 获取现金流量项目树形结构
 */
export function getCashFlowTree(accountSetId: string) {
  return request.get<CashFlowItem[]>('/base/cash-flow-items/tree', {
    params: { account_set_id: accountSetId }
  })
}

/**
 * 根据编码获取现金流量项目
 */
export function getCashFlowItemByCode(accountSetId: string, code: string) {
  return request.get<CashFlowItem>(`/base/cash-flow-items/${code}`, {
    params: { account_set_id: accountSetId }
  })
}

/**
 * 创建现金流量项目
 */
export function createCashFlowItem(data: {
  account_set_id: string
  code: string
  name: string
  direction: 'inflow' | 'outflow' | 'neutral'
  parent_code?: string
  level?: number
  sort_order?: number
}) {
  return request.post<CashFlowItem>('/base/cash-flow-items', data)
}

/**
 * 更新现金流量项目
 */
export function updateCashFlowItem(id: string, data: Partial<CashFlowItem>) {
  return request.put(`/base/cash-flow-items/${id}`, data)
}

/**
 * 删除现金流量项目
 */
export function deleteCashFlowItem(id: string) {
  return request.delete(`/base/cash-flow-items/${id}`)
}

/**
 * 初始化默认现金流量项目
 */
export function initDefaultCashFlowItems(accountSetId: string) {
  return request.post<{ message: string; count: number }>('/base/cash-flow-items/init', {
    account_set_id: accountSetId
  })
}
