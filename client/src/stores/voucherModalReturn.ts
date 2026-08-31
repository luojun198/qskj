import { defineStore } from 'pinia'
import { ref } from 'vue'

export interface VoucherModalReturnState {
  voucherId: string
  sourcePath: string
  mode: 'view' | 'edit'
  currentEntryKey?: string
}

export function buildEntryKey(entry: { id?: string; account_id?: string }, index?: number): string {
  if (entry.id) return `id:${entry.id}`
  if (entry.account_id != null && index != null) return `idx:${index}:${entry.account_id}`
  if (entry.account_id) return `acc:${entry.account_id}`
  return ''
}

export const useVoucherModalReturnStore = defineStore('voucherModalReturn', () => {
  const pending = ref<VoucherModalReturnState | null>(null)

  function saveBeforeDrillDown(payload: VoucherModalReturnState) {
    pending.value = { ...payload }
  }

  function hasPending(sourcePath: string): boolean {
    return pending.value?.sourcePath === sourcePath
  }

  function peek(): VoucherModalReturnState | null {
    return pending.value ? { ...pending.value } : null
  }

  function consumeRestore(): VoucherModalReturnState | null {
    const state = pending.value ? { ...pending.value } : null
    pending.value = null
    return state
  }

  function clear() {
    pending.value = null
  }

  return {
    pending,
    saveBeforeDrillDown,
    hasPending,
    peek,
    consumeRestore,
    clear,
  }
})
