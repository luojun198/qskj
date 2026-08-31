import { nextTick, type Ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useVoucherModalReturnStore } from '@/stores/voucherModalReturn'
import type VoucherEntryDialogHost from '@/components/voucher/VoucherEntryDialogHost.vue'

export type VoucherModalRestoreHandler = (
  voucherId: string,
  options?: { currentEntryKey?: string }
) => Promise<void>

export function useVoucherModalRestore(
  hostRef?: Ref<InstanceType<typeof VoucherEntryDialogHost> | null>,
  restoreHandler?: VoucherModalRestoreHandler
) {
  const route = useRoute()
  const router = useRouter()
  const voucherModalReturnStore = useVoucherModalReturnStore()
  let restoring = false

  async function tryRestoreVoucherModal() {
    if (restoring) return

    const fromQuery = route.query.openVoucherId as string | undefined
    const fromStore = voucherModalReturnStore.consumeRestore()
    const voucherId = fromQuery || fromStore?.voucherId
    if (!voucherId) return

    restoring = true
    try {
      if (fromQuery) {
        const query = { ...route.query } as Record<string, string>
        delete query.openVoucherId
        await router.replace({ path: route.path, query })
      }
      await nextTick()
      if (restoreHandler) {
        await restoreHandler(voucherId, { currentEntryKey: fromStore?.currentEntryKey })
      } else {
        await hostRef?.value?.restore(voucherId, {
          currentEntryKey: fromStore?.currentEntryKey,
        })
      }
    } finally {
      restoring = false
    }
  }

  return { tryRestoreVoucherModal }
}
