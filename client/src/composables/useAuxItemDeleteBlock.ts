import { ref, type Ref } from 'vue'
import { useRouter } from 'vue-router'
import request from '@/api/request'
import type { AuxItemDeleteBlockDetail } from '@/components/base/AuxItemDeleteBlockDialog.vue'
import type VoucherEntryDialogHost from '@/components/voucher/VoucherEntryDialogHost.vue'
import { showOperationError } from '@/composables/useMessage'

export function parseAuxItemDeleteBlockError(error: unknown): AuxItemDeleteBlockDetail | null {
  const detail = (error as any)?.response?.data?.data as AuxItemDeleteBlockDetail | undefined
  if (detail?.blocked && (detail.reason === 'voucher' || detail.reason === 'init_balance')) {
    return detail
  }
  return null
}

export function useAuxItemDeleteBlock(
  entryDialogHostRef?: Ref<InstanceType<typeof VoucherEntryDialogHost> | null>
) {
  const router = useRouter()
  const deleteBlockVisible = ref(false)
  const deleteBlockDetail = ref<AuxItemDeleteBlockDetail | null>(null)

  function showDeleteBlockDialog(detail: AuxItemDeleteBlockDetail) {
    deleteBlockDetail.value = detail
    deleteBlockVisible.value = true
  }

  function handleDeleteBlockError(error: unknown): boolean {
    const detail = parseAuxItemDeleteBlockError(error)
    if (!detail) return false
    showDeleteBlockDialog(detail)
    return true
  }

  async function deleteAuxItem(id: string): Promise<void> {
    await request.delete(`/base/aux-items/${id}`, { skipErrorToast: true })
  }

  async function deleteAuxItemWithDialog(
    id: string,
    operationLabel = '删除'
  ): Promise<'success' | 'blocked' | 'error'> {
    try {
      await deleteAuxItem(id)
      return 'success'
    } catch (error) {
      if (handleDeleteBlockError(error)) return 'blocked'
      showOperationError(operationLabel, error)
      return 'error'
    }
  }

  function openBlockedVoucher(row: NonNullable<AuxItemDeleteBlockDetail['vouchers']>[number]) {
    entryDialogHostRef?.value?.open({ id: row.id, status: row.status })
  }

  function goInitBalanceAux() {
    deleteBlockVisible.value = false
    router.push({ name: 'InitBalanceAux' })
  }

  return {
    deleteBlockVisible,
    deleteBlockDetail,
    showDeleteBlockDialog,
    handleDeleteBlockError,
    deleteAuxItem,
    deleteAuxItemWithDialog,
    openBlockedVoucher,
    goInitBalanceAux,
  }
}
