import { ElMessageBox } from 'element-plus'

/**
 * 确认对话框配置
 */
interface ConfirmOptions {
  title?: string
  message: string
  type?: 'warning' | 'info' | 'success' | 'error'
  confirmButtonText?: string
  cancelButtonText?: string
  showCancelButton?: boolean
  showDetails?: boolean
  details?: string[]
}

function escapeHtml(raw: string): string {
  return String(raw)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * 统一的确认对话框
 */
export async function useConfirm(options: ConfirmOptions): Promise<boolean> {
  const {
    title = '提示',
    message,
    type = 'warning',
    confirmButtonText = '确定',
    cancelButtonText = '取消',
    showCancelButton = true,
    showDetails = false,
    details = [],
  } = options

  try {
    let content = message
    if (showDetails && details.length > 0) {
      const safeMessage = escapeHtml(message)
      const safeDetails = details.map(item => `<div style="margin: 4px 0;">• ${escapeHtml(item)}</div>`).join('')
      content = `
        <div>
          <p style="margin-bottom: 12px;">${safeMessage}</p>
          <div style="background: #f5f7fa; padding: 12px; border-radius: 4px; max-height: 200px; overflow-y: auto;">
            ${safeDetails}
          </div>
        </div>
      `
    }

    await ElMessageBox.confirm(content, title, {
      type,
      confirmButtonText,
      cancelButtonText,
      showCancelButton,
      dangerouslyUseHTMLString: showDetails && details.length > 0,
      distinguishCancelAndClose: true,
    })
    return true
  } catch (error) {
    return false
  }
}

/**
 * 删除确认对话框
 */
export async function useDeleteConfirm(
  itemName: string,
  itemCount?: number
): Promise<boolean> {
  const message = itemCount
    ? `确定要删除选中的 ${itemCount} 项吗？`
    : `确定要删除"${itemName}"吗？`

  return useConfirm({
    title: '删除确认',
    message: message + '\n此操作不可恢复！',
    type: 'warning',
    confirmButtonText: '删除',
    cancelButtonText: '取消',
  })
}

/**
 * 批量操作确认对话框
 */
export async function useBatchConfirm(
  action: string,
  items: string[],
  warning?: string
): Promise<boolean> {
  return useConfirm({
    title: `批量${action}确认`,
    message: `即将${action}以下 ${items.length} 项：${warning ? '\n' + warning : ''}`,
    type: 'warning',
    confirmButtonText: action,
    cancelButtonText: '取消',
    showDetails: true,
    details: items,
  })
}
