import { ref, type Ref } from 'vue'
import request from '@/api/request'
import { useConfirm, useBatchConfirm } from './useConfirm'
import {
  showSuccess,
  showError,
  showBatchOperationResultDialog,
  showInitBalanceUnbalancedAlert,
  extractErrorMessage,
  isInitBalanceUnbalancedError,
  isInitBalanceBlockedResponse,
  type BatchOperationResultDetail,
} from './useMessage'
import { useOperationHistory } from './useOperationHistory'

function collectSelectedVoucherIds(selected: any[]) {
  const voucherNoMap = new Map<string, string>()
  const voucherIds: string[] = []
  for (const row of selected) {
    const id = row._voucherId || row.id
    if (!id || voucherNoMap.has(id)) continue
    voucherNoMap.set(id, row.voucher_no || id)
    voucherIds.push(id)
  }
  return { voucherIds, voucherNoMap }
}

export function useVoucherAuditActions(fetchData: () => Promise<void>) {
  const detail = ref<any>(null)
  const detailVisible = ref(false)
  const batchAuditing = ref(false)
  const batchPosting = ref(false)
  const batchUnposting = ref(false)
  const batchUnauditing = ref(false)
  const { addRecord } = useOperationHistory()

  async function viewDetail(row: any) {
    const voucherId = row._voucherId || row.id
    const res = await request.get(`/voucher/vouchers/${voucherId}`)
    detail.value = res.data
    detailVisible.value = true
  }

  async function audit(row: any) {
    const voucherId = row._voucherId || row.id
    await request.post(`/voucher/vouchers/${voucherId}/audit`)
    showSuccess('审核成功')
    addRecord('update', '凭证审核', `审核凭证 ${row.voucher_no || voucherId}`)
    await fetchData()
  }

  async function unAudit(row: any, options?: { silent?: boolean; skipConfirm?: boolean }) {
    const voucherId = row._voucherId || row.id
    if (!options?.skipConfirm) {
      const confirmed = await useConfirm({
        message: '确认反审核此凭证？',
        type: 'warning',
      })
      if (!confirmed) return
    }
    await request.post(`/voucher/vouchers/${voucherId}/unaudit`)
    if (!options?.silent) {
      showSuccess('反审核成功')
    }
    addRecord('update', '凭证审核', `反审核凭证 ${row.voucher_no || voucherId}`)
    await fetchData()
  }

  async function post(row: any, options?: { silent?: boolean; skipRefresh?: boolean }) {
    const voucherId = row._voucherId || row.id
    try {
      await request.post(`/voucher/vouchers/${voucherId}/post`, undefined, { skipErrorToast: true })
      if (!options?.silent) {
        showSuccess('记账成功')
      }
      addRecord('update', '凭证记账', `记账凭证 ${row.voucher_no || voucherId}`)
      if (!options?.skipRefresh) {
        await fetchData()
      }
    } catch (error: any) {
      const msg = extractErrorMessage(error, '记账失败')
      if (isInitBalanceBlockedResponse(error) || isInitBalanceUnbalancedError(msg)) {
        await showInitBalanceUnbalancedAlert()
      } else if (!options?.silent) {
        showError(msg)
      }
      throw error
    }
  }

  async function unPost(row: any, options?: { silent?: boolean; skipConfirm?: boolean }) {
    const voucherId = row._voucherId || row.id
    if (!options?.skipConfirm) {
      const confirmed = await useConfirm({
        message: '确认反记账此凭证？',
        type: 'warning',
      })
      if (!confirmed) return
    }
    await request.post(`/voucher/vouchers/${voucherId}/unpost`)
    if (!options?.silent) {
      showSuccess('反记账成功')
    }
    addRecord('update', '凭证记账', `反记账凭证 ${row.voucher_no || voucherId}`)
    await fetchData()
  }

  async function executeBatchVoucherOperation(options: {
    selected: any[]
    endpoint: string
    operation: string
    logModule: string
    loadingRef: Ref<boolean>
    emptyMessage: string
  }) {
    const { selected, endpoint, operation, logModule, loadingRef, emptyMessage } = options

    if (!selected.length) {
      showError(emptyMessage)
      return
    }

    const { voucherIds, voucherNoMap } = collectSelectedVoucherIds(selected)
    if (!voucherIds.length) {
      showError(emptyMessage)
      return
    }

    loadingRef.value = true
    try {
      const res = await request.post<{
        total?: number
        success?: number
        fail?: number
        details?: BatchOperationResultDetail[]
      }>(endpoint, { voucherIds }, { skipErrorToast: true })
      const data = res.data
      const successCount = data?.success ?? 0
      const failCount = data?.fail ?? 0
      const details = data?.details ?? []

      if (details.length > 0) {
        await showBatchOperationResultDialog({
          operation,
          success: successCount,
          fail: failCount,
          details,
          voucherNoMap,
        })
      }

      if (successCount > 0) {
        addRecord('update', logModule, `批量${operation}成功 ${successCount} 张凭证`)
      }
    } catch (error: any) {
      const data = error.response?.data?.data
      const details: BatchOperationResultDetail[] = data?.details ?? []
      const msg = extractErrorMessage(error, `批量${operation}失败`)
      if (isInitBalanceBlockedResponse(error) || isInitBalanceUnbalancedError(msg)) {
        await showInitBalanceUnbalancedAlert({ count: data?.fail ?? voucherIds.length })
      } else if (details.length > 0) {
        await showBatchOperationResultDialog({
          operation,
          success: data?.success ?? 0,
          fail: data?.fail ?? details.length,
          details,
          voucherNoMap,
        })
      } else {
        showError(msg)
      }
    } finally {
      loadingRef.value = false
      await fetchData()
    }
  }

  async function batchAudit(selected: any[]) {
    await executeBatchVoucherOperation({
      selected,
      endpoint: '/voucher/vouchers/batch-audit',
      operation: '审核',
      logModule: '凭证审核',
      loadingRef: batchAuditing,
      emptyMessage: '请先选择要审核的凭证',
    })
  }

  async function batchUnAudit(selected: any[]) {
    if (!selected.length) {
      showError('请先选择要反审核的凭证')
      return
    }

    const { voucherIds, voucherNoMap } = collectSelectedVoucherIds(selected)
    const voucherNos = voucherIds.map(id => voucherNoMap.get(id) || id)
    const confirmed = await useBatchConfirm('反审核', voucherNos, '此操作将取消凭证的审核状态')
    if (!confirmed) return

    await executeBatchVoucherOperation({
      selected,
      endpoint: '/voucher/vouchers/batch-unaudit',
      operation: '反审核',
      logModule: '凭证审核',
      loadingRef: batchUnauditing,
      emptyMessage: '请先选择要反审核的凭证',
    })
  }

  async function batchPost(selected: any[]) {
    await executeBatchVoucherOperation({
      selected,
      endpoint: '/voucher/vouchers/batch-post',
      operation: '记账',
      logModule: '凭证记账',
      loadingRef: batchPosting,
      emptyMessage: '请先选择要记账的凭证',
    })
  }

  async function batchUnpost(selected: any[]) {
    if (!selected.length) {
      showError('请先选择要反记账的凭证')
      return
    }

    const { voucherIds, voucherNoMap } = collectSelectedVoucherIds(selected)
    const voucherNos = voucherIds.map(id => voucherNoMap.get(id) || id)
    const confirmed = await useBatchConfirm('反记账', voucherNos, '此操作将取消凭证的记账状态')
    if (!confirmed) return

    await executeBatchVoucherOperation({
      selected,
      endpoint: '/voucher/vouchers/batch-unpost',
      operation: '反记账',
      logModule: '凭证记账',
      loadingRef: batchUnposting,
      emptyMessage: '请先选择要反记账的凭证',
    })
  }

  return {
    detail,
    detailVisible,
    batchAuditing,
    batchPosting,
    batchUnposting,
    batchUnauditing,
    addRecord,
    viewDetail,
    audit,
    unAudit,
    post,
    unPost,
    batchAudit,
    batchUnAudit,
    batchPost,
    batchUnpost,
  }
}
