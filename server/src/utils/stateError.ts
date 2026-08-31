import type { Response } from 'express'

export type StateErrorKind = 'resource_missing' | 'state_changed' | 'workflow_replaced'

export type StateErrorOptions = {
  resourceType?: string
  resourceId?: string
  currentStatus?: string
  refresh?: boolean
  suggestedRoute?: { name?: string; path?: string; params?: Record<string, string> }
}

export function buildStateErrorPayload(kind: StateErrorKind, options: StateErrorOptions = {}) {
  return {
    kind,
    resource_type: options.resourceType,
    resource_id: options.resourceId,
    current_status: options.currentStatus,
    refresh: options.refresh ?? kind === 'state_changed',
    suggested_route: options.suggestedRoute,
  }
}

export function sendStateError(
  res: Response,
  kind: StateErrorKind,
  message: string,
  options: StateErrorOptions = {},
) {
  const status = kind === 'resource_missing' ? 404 : 409
  return res.status(status).json({
    code: kind === 'resource_missing' ? 40401 : 40902,
    message,
    data: { state_error: buildStateErrorPayload(kind, options) },
  })
}
