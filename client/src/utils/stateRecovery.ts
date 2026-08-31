export type StateErrorKind = 'resource_missing' | 'state_changed' | 'workflow_replaced'

export type StateError = {
  kind: StateErrorKind
  resource_type?: string
  resource_id?: string
  current_status?: string
  refresh?: boolean
  suggested_route?: { name?: string; path?: string; params?: Record<string, string> }
  legacy?: boolean
}

type ApiErrorLike = {
  response?: { status?: number; data?: { message?: string; data?: { state_error?: StateError } } }
}

const LEGACY_STATUS_PATTERN = /不存在|已删除|仅草稿|已审核|已反审核|已下推|不可(?:保存|删除|审核|反审核|下推|操作)|状态.*(?:变化|不允许)/

export function readStateError(error: unknown): StateError | null {
  const apiError = error as ApiErrorLike
  const structured = apiError?.response?.data?.data?.state_error
  if (structured && ['resource_missing', 'state_changed', 'workflow_replaced'].includes(structured.kind)) {
    return structured
  }

  const status = apiError?.response?.status
  const message = apiError?.response?.data?.message || ''
  if (status === 404 && LEGACY_STATUS_PATTERN.test(message)) {
    return { kind: 'resource_missing', legacy: true }
  }
  if ((status === 400 || status === 409) && LEGACY_STATUS_PATTERN.test(message)) {
    return { kind: 'state_changed', refresh: true, legacy: true }
  }
  return null
}

export function getStateErrorMessage(error: StateError): string {
  if (error.kind === 'resource_missing') return '当前数据已删除、无权限访问或不属于当前账套'
  if (error.kind === 'workflow_replaced') return '当前流程已升级，正在进入新的处理页面'
  return '数据状态已变化，已刷新，请确认后重试'
}
