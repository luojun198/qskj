import { useRouter, type RouteLocationRaw } from 'vue-router'
import { readStateError } from '@/utils/stateRecovery'

type RecoveryOptions = {
  refresh?: () => Promise<void> | void
  fallbackRoute?: RouteLocationRaw
}

export function shouldRefreshStateError(
  stateError: { kind: string; refresh?: boolean },
  hasRefresh: boolean,
): boolean {
  return hasRefresh && (stateError.refresh === true || stateError.kind === 'resource_missing')
}

/** 写操作遇到状态冲突时只刷新或跳转，绝不自动重试。 */
export function useStateRecovery() {
  const router = useRouter()

  async function recoverStateError(error: unknown, options: RecoveryOptions = {}): Promise<boolean> {
    const stateError = readStateError(error)
    if (!stateError) return false
    if (stateError.suggested_route) {
      await router.replace(stateError.suggested_route as RouteLocationRaw)
      return true
    }
    if (shouldRefreshStateError(stateError, !!options.refresh) && options.refresh) {
      await options.refresh()
      return true
    }
    if (stateError.kind === 'resource_missing' && options.fallbackRoute) {
      await router.replace(options.fallbackRoute)
      return true
    }
    return true
  }

  return { recoverStateError }
}
