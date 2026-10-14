import request from './request'

export type CashFlowAccountTab = 'asset' | 'liability' | 'common' | 'equity' | 'cost' | 'pl'

export interface CashFlowMapCodes {
  main_credit_code: string | null
  main_debit_code: string | null
  supp_credit_code: string | null
  supp_debit_code: string | null
}

export interface CashFlowMapRow extends CashFlowMapCodes {
  account_id: string
  code: string
  name: string
  level: number
  parent_id: string | null
  direction: 'debit' | 'credit'
  is_enabled: number
  category_label: string
  is_cash_equivalent: boolean
  has_children: boolean
  /** false = 继承上级 */
  own: boolean
}

export interface CashFlowMainOption {
  code: string
  name: string
  activity: 'operating' | 'investing' | 'financing' | null
  group: string
  flow: 'in' | 'out' | null
}

export interface CashFlowMapOptions {
  tabs: Array<{ key: CashFlowAccountTab; label: string }>
  main: CashFlowMainOption[]
  supplement: Array<{ code: string; name: string }>
  /** enterprise / small_business / government / npo / generic */
  standard?: string
  standardName?: string
  /** 只有企业会计准则编补充资料 */
  hasSupplement?: boolean
  activityLabels?: { operating: string; investing: string; financing: string }
}

export interface CashFlowCopyResult {
  accountSetId: string
  accountSetName: string
  copied: number
  skippedAccounts: number
  skippedItems: number
}

export const cashFlowAccountMapApi = {
  options: () => request.get<CashFlowMapOptions>('/base/cash-flow-account-map/options'),
  list: (tab: CashFlowAccountTab) =>
    request.get<{ tab: CashFlowAccountTab; rows: CashFlowMapRow[]; seeded: boolean }>('/base/cash-flow-account-map', {
      params: { tab },
    }),
  update: (accountId: string, data: Partial<CashFlowMapCodes> & { applyToChildren?: boolean }) =>
    request.put<{ updated: number }>(`/base/cash-flow-account-map/${accountId}`, data),
  restoreDefault: (tab?: CashFlowAccountTab) =>
    request.post<{ written: number }>('/base/cash-flow-account-map/restore-default', { tab }),
  copyTargets: () =>
    request.get<Array<{ id: string; name: string; code: string | null }>>('/base/cash-flow-account-map/copy-targets'),
  copy: (targetAccountSetIds: string[]) =>
    request.post<CashFlowCopyResult[]>('/base/cash-flow-account-map/copy', { targetAccountSetIds }),
}
