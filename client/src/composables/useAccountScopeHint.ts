import { computed, type Ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useUserStore } from '@/stores/user'

export type AccountScopeHintOptions = {
  /** 当前页已加载的授权科目数量（如下拉列表、期初列表） */
  accountsCount?: Ref<number | undefined>
}

/**
 * 科目授权受限时的前端提示文案与展示条件
 */
export function useAccountScopeHint(options?: AccountScopeHintOptions) {
  const userStore = useUserStore()
  const { accountScopeRestricted, allowedAccountIds } = storeToRefs(userStore)

  const hasNoAllowedAccounts = computed(
    () => accountScopeRestricted.value && allowedAccountIds.value.length === 0
  )

  const accountsListEmpty = computed(() => {
    const count = options?.accountsCount?.value
    if (count === undefined) return false
    return accountScopeRestricted.value && count === 0
  })

  const isBlocked = computed(() => hasNoAllowedAccounts.value || accountsListEmpty.value)

  const showAlert = computed(() => accountScopeRestricted.value)

  const alertType = computed(() => (isBlocked.value ? 'warning' : 'info'))

  const alertTitle = computed(() =>
    isBlocked.value ? '未配置可操作科目' : '科目数据权限已启用'
  )

  const alertDescription = computed(() => {
    if (hasNoAllowedAccounts.value) {
      return '当前账号已启用科目授权，但未分配任何会计科目。请联系管理员在【角色管理】或【用户管理 → 科目】中配置授权范围。'
    }
    if (accountsListEmpty.value) {
      return '当前账套下没有您可操作的会计科目。请确认角色/用户科目授权，或联系管理员调整授权范围。'
    }
    return '账簿、期初与报表仅统计已授权科目范围内的数据，合计数可能与全账套不一致。'
  })

  const emptyDescription = computed(
    () =>
      '暂无可用会计科目。请由管理员在【系统管理 → 角色管理】或【用户管理 → 科目】中为您配置科目授权。'
  )

  return {
    accountScopeRestricted,
    hasNoAllowedAccounts,
    accountsListEmpty,
    isBlocked,
    showAlert,
    alertType,
    alertTitle,
    alertDescription,
    emptyDescription,
  }
}
