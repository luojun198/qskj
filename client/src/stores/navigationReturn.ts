import { defineStore } from 'pinia'
import { ref } from 'vue'

export interface NavigationReturnState {
  path: string
  label: string
  query?: Record<string, string>
}

export const useNavigationReturnStore = defineStore('navigationReturn', () => {
  const pending = ref<NavigationReturnState | null>(null)

  function save(payload: NavigationReturnState) {
    pending.value = {
      path: payload.path,
      label: payload.label,
      query: payload.query ? { ...payload.query } : undefined,
    }
  }

  function peek(): NavigationReturnState | null {
    return pending.value ? { ...pending.value, query: pending.value.query ? { ...pending.value.query } : undefined } : null
  }

  function clear() {
    pending.value = null
  }

  return { pending, save, peek, clear }
})
