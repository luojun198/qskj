import { ElMessage, ElMessageBox } from 'element-plus'
import request from '@/api/request'
import { showOperationError } from '@/composables/useMessage'

export interface RenumberGroup {
  year: number
  period: number
  voucher_type_id: string | null
}

/**
 * 删除凭证（反折旧 / 删除出纳凭证）后，提示是否对受影响期间重新排号。
 * 与系统编号一致，按 (year, period, voucher_type_id) 分组逐组调用重排接口。
 *
 * @param groups 受影响的去重分组
 * @param deletedCount 实际删除的凭证数（<=0 或无分组则不提示）
 */
export async function confirmRenumberAfterDelete(
  groups: RenumberGroup[] | undefined | null,
  deletedCount: number
): Promise<void> {
  const list = (groups || []).filter(g => g && g.year && g.period)
  if (deletedCount <= 0 || list.length === 0) return

  try {
    await ElMessageBox.confirm(
      `已删除 ${deletedCount} 张凭证，可能造成凭证断号。是否立即对相关期间重新排号？`,
      '重新排号',
      { confirmButtonText: '立即重排', cancelButtonText: '暂不', type: 'warning' }
    )
  } catch {
    // 用户取消，不处理
    return
  }

  try {
    let total = 0
    for (const g of list) {
      const res = await request.post<{ updated: number }>('/voucher/vouchers/renumber', {
        year: g.year,
        period: g.period,
        voucher_type_id: g.voucher_type_id ?? null,
        start_no: 1,
      })
      total += res.data?.updated || 0
    }
    ElMessage.success(`已重新排号 ${total} 张凭证`)
  } catch (error) {
    showOperationError('重新排号', error)
  }
}
