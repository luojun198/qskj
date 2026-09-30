import type { Ref } from 'vue'
import { loadAuxItemOptions } from '@/composables/useCashierHeaderFilters'
import {
  auxItemIdsOf,
  withAuxItemIds,
  type CashierReportFilterState,
} from '@/utils/cashierReportFilter'

interface Opt { value: string; label: string }

/** 筛选组件暴露给页面的数据（科目 / 结算方式字典 / 流水里出现过的对方科目等） */
interface FilterSource {
  accounts: Array<{ code: string; name: string }>
  settleTypes: Array<{ code: string; name: string }>
  meta: {
    settle_types: Array<{ code: string; name: string }>
    counter_accounts: Array<{ code: string; name: string }>
  }
}

/**
 * 汇总表「维度列」的表头筛选：把某个汇总维度的筛选映射到统一筛选状态，并给出选项来源。
 *  科目 → accountCodes；对方科目 → counterAccounts；结算方式 → settleTypes；辅助类别 → aux 项目。
 *  时间 / 币种维度不提供表头筛选（日期范围、币种在上方筛选条里设）。
 */
export function useCashierSummaryFilters(
  filter: Ref<CashierReportFilterState>,
  source: () => FilterSource | undefined
) {
  /** 该维度是否支持表头筛选，以及筛选控件类型 */
  function kindOf(dim: string): 'options' | 'remote' | null {
    if (dim === 'account' || dim === 'counter_account' || dim === 'settle_type') return 'options'
    if (dim.startsWith('aux:')) return 'remote'
    return null
  }

  function valuesOf(dim: string): string[] {
    const s = filter.value
    if (dim === 'account') return s.accountCodes
    if (dim === 'counter_account') return s.counterAccounts
    if (dim === 'settle_type') return s.settleTypes
    if (dim.startsWith('aux:')) return auxItemIdsOf(s, dim.slice(4))
    return []
  }

  function setValues(dim: string, values: string[]) {
    const s = filter.value
    if (dim === 'account') filter.value = { ...s, accountCodes: values }
    else if (dim === 'counter_account') filter.value = { ...s, counterAccounts: values }
    else if (dim === 'settle_type') filter.value = { ...s, settleTypes: values }
    else if (dim.startsWith('aux:')) filter.value = withAuxItemIds(s, dim.slice(4), values)
  }

  function optionsOf(dim: string): Opt[] {
    const src = source()
    if (!src) return []
    if (dim === 'account') return src.accounts.map(a => ({ value: a.code, label: `${a.code} ${a.name}` }))
    if (dim === 'counter_account') return src.meta.counter_accounts.map(a => ({ value: a.code, label: `${a.code} ${a.name}` }))
    if (dim === 'settle_type') {
      const known = new Set(src.settleTypes.map(t => t.code))
      const extra = src.meta.settle_types.filter(t => t.code && !known.has(t.code))
      return [...src.settleTypes, ...extra].map(t => ({ value: t.code, label: t.name }))
    }
    return []
  }

  function loaderOf(dim: string): (keyword: string) => Promise<Opt[]> {
    const categoryId = dim.slice(4)
    return (keyword: string) => loadAuxItemOptions(categoryId, keyword)
  }

  return { kindOf, valuesOf, setValues, optionsOf, loaderOf }
}
