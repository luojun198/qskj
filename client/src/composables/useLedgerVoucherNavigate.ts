import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { hasPermission } from '@/utils/permission'
import { showWarning } from '@/composables/useMessage'
import { useNavigationReturnStore } from '@/stores/navigationReturn'
import { serializeRouteQuery } from '@/composables/useDrillDownNavigate'

export type LedgerVoucherRow = {
  voucher_id?: string
  voucher_status?: string
  is_opening_balance?: boolean
  is_carry_forward?: boolean
}

export function resolveLedgerVoucherId(row: LedgerVoucherRow): string | null {
  const id = row.voucher_id
  return id ? String(id) : null
}

/** 账簿行是否可双击跳转编辑凭证 */
export function canNavigateToEditVoucher(row: LedgerVoucherRow): boolean {
  if (!hasPermission('voucher:entry')) return false
  if (row.is_opening_balance || row.is_carry_forward) return false
  return Boolean(resolveLedgerVoucherId(row))
}

export interface LedgerVoucherNavigateOptions {
  returnLabel?: string
  getReturnQuery?: () => Record<string, string>
  /** 在当前页打开凭证模态框（草稿可编辑，已审核/已过账只读） */
  openVoucherModal?: (row: LedgerVoucherRow) => void
}

/** 账簿行是否可打开凭证（含只读查看） */
export function canOpenVoucherFromLedger(row: LedgerVoucherRow): boolean {
  if (row.is_opening_balance || row.is_carry_forward) return false
  return Boolean(resolveLedgerVoucherId(row))
}

/**
 * 日记账 / 明细账 / 序时账：双击凭证行打开凭证（模态框或跳转录入页）
 */
export function useLedgerVoucherNavigate(options: LedgerVoucherNavigateOptions = {}) {
  const router = useRouter()
  const route = useRoute()
  const navigationReturnStore = useNavigationReturnStore()
  const canEditVoucher = computed(() => hasPermission('voucher:entry'))

  function handleLedgerRowDblClick(row: LedgerVoucherRow) {
    if (!canOpenVoucherFromLedger(row)) return

    const voucherId = resolveLedgerVoucherId(row)!

    if (options.openVoucherModal) {
      options.openVoucherModal(row)
      return
    }

    if (!canNavigateToEditVoucher(row)) return

    if (row.voucher_status && row.voucher_status !== 'draft') {
      showWarning('仅草稿凭证可编辑')
      return
    }

    navigationReturnStore.save({
      path: route.path,
      label: options.returnLabel || '账簿',
      query: options.getReturnQuery?.() ?? serializeRouteQuery(route.query as Record<string, unknown>),
    })

    router.push({
      path: '/voucher/entry',
      query: { editVoucherId: voucherId, from: 'drill' },
    })
  }

  return { canEditVoucher, handleLedgerRowDblClick }
}
