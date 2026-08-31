import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { VoucherFilters } from '@/composables/useVoucherQuery'

export interface VoucherAuditReturnState {
  filters: VoucherFilters
  pagination: { page: number; pageSize: number }
  selectedVoucherIds: string[]
  selectAllMode: boolean
  targetYear: number | null
}

type CaptureFn = () => VoucherAuditReturnState

export const useVoucherAuditReturnStore = defineStore('voucherAuditReturn', () => {
  const pending = ref<VoucherAuditReturnState | null>(null)
  let captureFn: CaptureFn | null = null

  function registerCapture(fn: CaptureFn) {
    captureFn = fn
  }

  function unregisterCapture() {
    captureFn = null
  }

  function saveFromRegistered() {
    if (!captureFn) return
    pending.value = captureFn()
  }

  function save(payload: VoucherAuditReturnState) {
    pending.value = {
      filters: JSON.parse(JSON.stringify(payload.filters)),
      pagination: { ...payload.pagination },
      selectedVoucherIds: [...payload.selectedVoucherIds],
      selectAllMode: payload.selectAllMode,
      targetYear: payload.targetYear,
    }
  }

  function peek(): VoucherAuditReturnState | null {
    if (!pending.value) return null
    return {
      filters: JSON.parse(JSON.stringify(pending.value.filters)),
      pagination: { ...pending.value.pagination },
      selectedVoucherIds: [...pending.value.selectedVoucherIds],
      selectAllMode: pending.value.selectAllMode,
      targetYear: pending.value.targetYear,
    }
  }

  function consumeRestore(): VoucherAuditReturnState | null {
    const state = peek()
    pending.value = null
    return state
  }

  function clear() {
    pending.value = null
  }

  return {
    pending,
    registerCapture,
    unregisterCapture,
    saveFromRegistered,
    save,
    peek,
    consumeRestore,
    clear,
  }
})
