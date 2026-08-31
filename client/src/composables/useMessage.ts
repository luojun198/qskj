import { ElMessage, ElMessageBox } from 'element-plus'
import { useVoucherAuditReturnStore } from '@/stores/voucherAuditReturn'
import {
  buildNoNegativeBalanceAlertHtml,
  type NoNegativeBalanceViolation,
} from '@/utils/noNegativeBalanceAlert'

const MESSAGE_OPTS = { customClass: 'cw-wide-message', showClose: true } as const

/**
 * 成功提示
 */
export function showSuccess(message: string, duration = 2000) {
  ElMessage.success({
    message,
    duration,
    ...MESSAGE_OPTS,
  })
}

/**
 * 错误提示
 */
export function showError(message: string, duration = 3000) {
  ElMessage.error({
    message,
    duration,
    ...MESSAGE_OPTS,
  })
}

/**
 * 警告提示
 */
export function showWarning(message: string, duration = 2500) {
  ElMessage.warning({
    message,
    duration,
    ...MESSAGE_OPTS,
  })
}

/**
 * 信息提示
 */
export function showInfo(message: string, duration = 2000) {
  ElMessage.info({
    message,
    duration,
    ...MESSAGE_OPTS,
  })
}

/**
 * 操作成功提示（带详情）
 */
export function showOperationSuccess(operation: string, details?: string) {
  const message = details ? `${operation}成功：${details}` : `${operation}成功`
  showSuccess(message)
}

/**
 * 操作失败提示（带详情）
 */
export function showOperationError(operation: string, error: any) {
  const message = error?.response?.data?.message || error?.message || '操作失败'
  showError(`${operation}失败：${message}`)
}

/**
 * 从请求错误对象中提取可读消息
 */
export function extractErrorMessage(error: any, fallback = '操作失败'): string {
  return error?.response?.data?.message || error?.message || fallback
}

/** 是否为「余额不允许为负数 / 保存后余额试算」类校验错误 */
export function isNoNegativeBalanceMessage(message: string, codeType?: string): boolean {
  if (codeType === 'NO_NEGATIVE_BALANCE') return true
  return message.includes('余额不允许为负数') || message.includes('保存后余额将为')
}

function escapeHtml(raw: string): string {
  return String(raw)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export interface BatchOperationResultDetail {
  id: string
  voucher_no?: string
  success: boolean
  error?: string
}

/** @deprecated 使用 BatchOperationResultDetail */
export type BatchAuditResultDetail = BatchOperationResultDetail

export const INIT_BALANCE_UNBALANCED_HINT = '年初不平，不允许记账'

export function isInitBalanceUnbalancedError(message: string): boolean {
  return message.includes('年初不平') || message.includes('期初借贷不平衡')
}

export function isInitBalanceBlockedResponse(error: any): boolean {
  return Boolean(error?.response?.data?.data?.initBalanceBlocked)
}

/** 期初不平衡：弹窗警告（替代顶部信息条） */
export function showInitBalanceUnbalancedAlert(options?: { count?: number }) {
  const countHint =
    options?.count && options.count > 0
      ? `<p style="margin:8px 0 0;color:#909399;font-size:13px;">共 ${options.count} 张凭证未能记账</p>`
      : ''
  const html = `
    <div style="font-size:14px;line-height:1.8;color:#606266;">
      <p style="margin:0;color:#e6a23c;font-weight:600;">${INIT_BALANCE_UNBALANCED_HINT}</p>
      <p style="margin:8px 0 0;">请调整期初余额，使借贷配平后再记账。</p>
      ${countHint}
    </div>
  `
  return ElMessageBox.confirm(html, '记账提醒', {
    type: 'warning',
    confirmButtonText: '期初录入',
    cancelButtonText: '我知道了',
    distinguishCancelAndClose: true,
    closeOnClickModal: false,
    closeOnPressEscape: false,
    dangerouslyUseHTMLString: true,
    customClass: 'init-balance-unbalanced-messagebox',
  })
    .then(() => {
      const auditReturnStore = useVoucherAuditReturnStore()
      auditReturnStore.saveFromRegistered()
      const ctx = auditReturnStore.peek()
      void import('@/router').then(({ default: router }) => {
        router.push({
          name: 'InitBalance',
          query: {
            from: 'voucher-audit',
            ...(ctx?.targetYear ? { year: String(ctx.targetYear) } : {}),
          },
        })
      })
    })
    .catch(() => {
      // 用户点击「我知道了」或关闭
    })
}

/** 批量失败均为同一全局原因（如期初不平）时，只展示一条原因 */
function resolveGlobalFailureReason(failItems: BatchOperationResultDetail[]): string | null {
  if (failItems.length === 0) return null
  const first = failItems[0].error || ''
  if (!isInitBalanceUnbalancedError(first)) return null
  if (failItems.every(item => isInitBalanceUnbalancedError(item.error || ''))) {
    return INIT_BALANCE_UNBALANCED_HINT
  }
  return null
}

/** 批量凭证操作结果模态框：展示每张凭证的成功/失败及原因 */
export async function showBatchOperationResultDialog(options: {
  operation: string
  success: number
  fail: number
  details: BatchOperationResultDetail[]
  voucherNoMap?: Map<string, string>
}) {
  const { operation, success, fail, details, voucherNoMap } = options

  const resolveVoucherNo = (item: BatchOperationResultDetail) => {
    return item.voucher_no || voucherNoMap?.get(item.id) || item.id
  }

  const successItems = details.filter(d => d.success)
  const failItems = details.filter(d => !d.success)

  const globalReason = resolveGlobalFailureReason(failItems)
  if (globalReason && success === 0 && fail > 0) {
    return showInitBalanceUnbalancedAlert({ count: fail })
  }

  let summary: string
  let type: 'success' | 'warning' | 'error' = 'success'
  if (fail > 0 && success > 0) {
    summary = `批量${operation}完成：成功 ${success} 张，失败 ${fail} 张`
    type = 'warning'
  } else if (fail > 0) {
    summary = `批量${operation}失败：共 ${fail} 张全部未通过`
    type = 'error'
  } else {
    summary = `批量${operation}成功：共 ${success} 张凭证`
    type = 'success'
  }

  const sections: string[] = [
    `<p style="margin:0 0 12px;font-size:14px;color:#303133;">${escapeHtml(summary)}</p>`,
  ]

  if (successItems.length > 0) {
    const rows = successItems
      .map(item => `<div style="margin:4px 0;color:#67c23a;">✓ ${escapeHtml(resolveVoucherNo(item))}</div>`)
      .join('')
    sections.push(`
      <div style="margin-bottom:12px;">
        <div style="font-weight:600;margin-bottom:6px;color:#303133;">${escapeHtml(operation)}成功（${successItems.length}）</div>
        <div style="background:#f0f9eb;padding:10px 12px;border-radius:4px;max-height:160px;overflow-y:auto;">${rows}</div>
      </div>
    `)
  }

  if (failItems.length > 0) {
    const globalReason = resolveGlobalFailureReason(failItems)
    if (globalReason) {
      sections.push(`
        <div>
          <div style="font-weight:600;margin-bottom:6px;color:#303133;">失败原因</div>
          <div style="background:#fef0f0;padding:10px 12px;border-radius:4px;color:#f56c6c;">${escapeHtml(globalReason)}</div>
        </div>
      `)
    } else {
      const rows = failItems
        .map(
          item =>
            `<div style="margin:4px 0;color:#f56c6c;">✗ ${escapeHtml(resolveVoucherNo(item))}：${escapeHtml(item.error || `${operation}失败`)}</div>`
        )
        .join('')
      sections.push(`
        <div>
          <div style="font-weight:600;margin-bottom:6px;color:#303133;">${escapeHtml(operation)}失败（${failItems.length}）</div>
          <div style="background:#fef0f0;padding:10px 12px;border-radius:4px;max-height:200px;overflow-y:auto;">${rows}</div>
        </div>
      `)
    }
  }

  await ElMessageBox.alert(sections.join(''), `批量${operation}结果`, {
    type,
    confirmButtonText: '我知道了',
    dangerouslyUseHTMLString: true,
    customClass: 'batch-operation-result-messagebox',
  })
}

/** @deprecated 使用 showBatchOperationResultDialog */
export async function showBatchAuditResultDialog(options: {
  success: number
  fail: number
  details: BatchOperationResultDetail[]
  voucherNoMap?: Map<string, string>
}) {
  return showBatchOperationResultDialog({ operation: '审核', ...options })
}

/** 科目负数试算：弹框提醒，需用户手动关闭 */
export function showNoNegativeBalanceAlert(
  violations?: NoNegativeBalanceViolation[],
  fallbackMessage?: string
) {
  const html =
    violations && violations.length > 0
      ? buildNoNegativeBalanceAlertHtml(violations)
      : `<div style="font-size:13px;line-height:1.8;color:#606266;">${escapeAlertFallback(fallbackMessage || '余额不允许为负数，无法保存凭证。')}</div>`

  return ElMessageBox.alert(html, '科目余额负数试算提醒', {
    type: 'warning',
    confirmButtonText: '我知道了',
    closeOnClickModal: false,
    closeOnPressEscape: false,
    dangerouslyUseHTMLString: true,
    customClass: 'no-negative-balance-messagebox',
  })
}

function escapeAlertFallback(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/【([^】]+)】/g, '<span style="color:#409eff;font-weight:600;">【$1】</span>')
    .replace(
      /(-?\d+\.\d{2})/g,
      '<span style="color:#f56c6c;font-weight:700;">$1</span>'
    )
    .replace(/余额不允许为负数/g, '<span style="color:#e6a23c;font-weight:600;">余额不允许为负数</span>')
}
