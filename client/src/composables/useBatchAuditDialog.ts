import { ref } from 'vue'
import request from '@/api/request'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  showInitBalanceUnbalancedAlert,
  extractErrorMessage,
  isInitBalanceUnbalancedError,
  isInitBalanceBlockedResponse,
} from '@/composables/useMessage'

export function useBatchAuditDialog(fetchData: () => Promise<void>) {
  const batchAuditVisible = ref(false)
  const batchAuditing = ref(false)
  const batchAuditPreviewing = ref(false)
  const batchAuditPreviewCount = ref<number | null>(null)
  const batchAuditPreviewFirstVoucherNo = ref<string | null>(null)
  const batchAuditPreviewLastVoucherNo = ref<string | null>(null)
  const batchAuditPreviewBlockedVoucherNo = ref<string | null>(null)
  const batchAuditForm = ref<any>({
    operation: 'audit',
    dateRange: [],
    voucher_type_ids: [],
    start_no: '',
    end_no: '',
  })

  function resetPreview() {
    batchAuditPreviewCount.value = null
    batchAuditPreviewFirstVoucherNo.value = null
    batchAuditPreviewLastVoucherNo.value = null
    batchAuditPreviewBlockedVoucherNo.value = null
  }

  async function handleBatchAuditPreview() {
    const [start_date, end_date] = batchAuditForm.value.dateRange || []
    if (!start_date || !end_date || !batchAuditForm.value.voucher_type_ids?.length) {
      ElMessage.error('请完整选择日期区间和凭证类型')
      return
    }

    // 处理"全部类型"选项
    let voucherTypeIds = batchAuditForm.value.voucher_type_ids
    if (voucherTypeIds.includes('all')) {
      voucherTypeIds = []
    }

    batchAuditPreviewing.value = true
    try {
      const operation = batchAuditForm.value.operation
      const endpoint = `/voucher/vouchers/batch-${operation}/preview`
      const res = await request.post<{
        count: number
        firstVoucherNo: string | null
        lastVoucherNo: string | null
        blockedVoucherNo: string | null
      }>(endpoint, {
        start_date,
        end_date,
        voucher_type_ids: voucherTypeIds,
        start_no: batchAuditForm.value.start_no,
        end_no: batchAuditForm.value.end_no,
      })
      batchAuditPreviewCount.value = res.data?.count ?? 0
      batchAuditPreviewFirstVoucherNo.value = res.data?.firstVoucherNo || null
      batchAuditPreviewLastVoucherNo.value = res.data?.lastVoucherNo || null
      batchAuditPreviewBlockedVoucherNo.value = res.data?.blockedVoucherNo || null
    } finally {
      batchAuditPreviewing.value = false
    }
  }

  async function handleBatchAudit() {
    const [start_date, end_date] = batchAuditForm.value.dateRange || []
    if (!start_date || !end_date || !batchAuditForm.value.voucher_type_ids?.length) {
      ElMessage.error('请完整选择日期区间和凭证类型')
      return
    }
    if (batchAuditPreviewCount.value === null) {
      await handleBatchAuditPreview()
    }
    if (batchAuditPreviewBlockedVoucherNo.value) {
      const operation = batchAuditForm.value.operation as 'audit' | 'unaudit' | 'post' | 'unpost'
      const operationLabel: Record<string, string> = { audit: '审核', unaudit: '反审核', post: '记账', unpost: '反记账' }
      ElMessage.error(`存在不符合条件的凭证，无法${operationLabel[operation] || '操作'}：${batchAuditPreviewBlockedVoucherNo.value}`)
      return
    }

    const operation = batchAuditForm.value.operation as 'audit' | 'unaudit' | 'post' | 'unpost'
    const operationLabel: Record<string, string> = { audit: '审核', unaudit: '反审核', post: '记账', unpost: '反记账' }

    await ElMessageBox.confirm(
      `当前条件预计${operationLabel[operation] || '操作'} ${batchAuditPreviewCount.value ?? 0} 张凭证，是否继续？`,
      '二次确认',
      { type: 'warning', confirmButtonText: `确认${operationLabel[operation] || '操作'}`, cancelButtonText: '取消' }
    )

    // 处理"全部类型"选项
    let voucherTypeIds = batchAuditForm.value.voucher_type_ids
    if (voucherTypeIds.includes('all')) {
      voucherTypeIds = []
    }

    batchAuditing.value = true
    try {
      const endpoint = `/voucher/vouchers/batch-${operation}`
      const res = await request.post(
        endpoint,
        {
          start_date,
          end_date,
          voucher_type_ids: voucherTypeIds,
          start_no: batchAuditForm.value.start_no,
          end_no: batchAuditForm.value.end_no,
        },
        { skipErrorToast: true }
      )
      ElMessage.success(res.message || `批量${operationLabel}成功`)
      batchAuditVisible.value = false
      batchAuditForm.value = { operation: 'audit', dateRange: [], voucher_type_ids: [], start_no: '', end_no: '' }
      resetPreview()
      await fetchData()
    } catch (error: any) {
      const msg = extractErrorMessage(error, `批量${operationLabel[operation] || '操作'}失败`)
      if (
        operation === 'post' &&
        (isInitBalanceBlockedResponse(error) || isInitBalanceUnbalancedError(msg))
      ) {
        await showInitBalanceUnbalancedAlert()
      } else {
        ElMessage.error(msg)
      }
    } finally {
      batchAuditing.value = false
    }
  }

  return {
    batchAuditVisible,
    batchAuditing,
    batchAuditPreviewing,
    batchAuditPreviewCount,
    batchAuditPreviewFirstVoucherNo,
    batchAuditPreviewLastVoucherNo,
    batchAuditPreviewBlockedVoucherNo,
    batchAuditForm,
    handleBatchAuditPreview,
    handleBatchAudit,
  }
}
