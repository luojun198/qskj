import { ElMessage, ElMessageBox } from 'element-plus'
import { useRouter } from 'vue-router'
import request from '@/api/request'

export interface ReverseVoucherResult {
  id: string
  voucher_no: string
  voucher_type_id: string | null
  voucher_date: string
  year: number
  period: number
  reversal_of_voucher_id: string
}

/** 凭证是否可以冲红：仅已审核/已记账、且未被冲红、且本身不是红字凭证 */
export function canReverseVoucher(voucher: any): boolean {
  if (!voucher) return false
  if (voucher.status !== 'audited' && voucher.status !== 'posted') return false
  if (voucher.reversed_by_voucher_id) return false
  if (voucher.reversal_of_voucher_id) return false
  return true
}

/** 不可冲红时的原因说明，用于按钮 tooltip / 提示 */
export function reverseDisabledReason(voucher: any): string {
  if (!voucher) return '请先选择一张凭证'
  if (voucher.reversal_of_voucher_id) return '红字凭证本身不能再次冲红'
  if (voucher.reversed_by_voucher_id) return '该凭证已冲红，不能重复冲红'
  if (voucher.status !== 'audited' && voucher.status !== 'posted') {
    return '仅已审核或已记账的凭证可以冲红，草稿凭证请直接修改或删除'
  }
  return ''
}

/**
 * 凭证冲红：生成一张红字凭证（方向不变、金额取负），成功后跳转到录入页编辑新草稿。
 *
 * 界面口径：仅用一个简单确认弹窗（符合项目「少用弹窗」规则），实际编辑走录入全页面。
 */
export function useVoucherReverse(options: { onSuccess?: () => void | Promise<void> } = {}) {
  const router = useRouter()

  async function reverseVoucher(voucher: any): Promise<ReverseVoucherResult | null> {
    if (!voucher?.id) {
      ElMessage.warning('请先选择一张凭证')
      return null
    }
    const reason = reverseDisabledReason(voucher)
    if (reason) {
      ElMessage.warning(reason)
      return null
    }

    const label = `${voucher.voucher_type_name || ''}${voucher.voucher_no || ''} 号`
    try {
      await ElMessageBox.confirm(
        `将生成一张红字凭证冲销【${label}】：分录方向保持不变、金额取负。\n新凭证为草稿状态，可在录入页核对修改后再审核记账。是否继续？`,
        '凭证冲红',
        {
          type: 'warning',
          confirmButtonText: '生成红字凭证',
          cancelButtonText: '取消',
          // 保留提示中的换行
          customClass: 'voucher-reverse-confirm',
        }
      )
    } catch {
      return null
    }

    try {
      const res = await request.post<ReverseVoucherResult>(`/voucher/vouchers/${voucher.id}/reverse`, {})
      const data = res.data
      ElMessage.success(`已生成红字凭证 ${data.voucher_no} 号（草稿）`)
      await options.onSuccess?.()
      await router.push({
        path: '/voucher/entry',
        query: { editVoucherId: data.id },
      })
      return data
    } catch (error: any) {
      ElMessage.error(error?.response?.data?.message || error?.message || '冲红失败')
      return null
    }
  }

  return { reverseVoucher, canReverseVoucher, reverseDisabledReason }
}
