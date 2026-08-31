import { useRoute, useRouter } from 'vue-router'
import { useNavigationReturnStore } from '@/stores/navigationReturn'

export function serializeRouteQuery(query: Record<string, unknown>): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(query)) {
    if (value == null || value === '') continue
    if (typeof value === 'string') {
      result[key] = value
    } else if (Array.isArray(value) && value[0]) {
      result[key] = String(value[0])
    }
  }
  return result
}

export function useDrillDownNavigate() {
  const route = useRoute()
  const router = useRouter()
  const navigationReturnStore = useNavigationReturnStore()

  function drillDown(
    targetPath: string,
    targetQuery: Record<string, string>,
    returnLabel: string,
    returnQuery?: Record<string, string>
  ) {
    navigationReturnStore.save({
      path: route.path,
      label: returnLabel,
      query: returnQuery ?? serializeRouteQuery(route.query as Record<string, unknown>),
    })
    router.push({
      path: targetPath,
      query: { ...targetQuery, from: 'drill' },
    })
  }

  return { drillDown }
}
