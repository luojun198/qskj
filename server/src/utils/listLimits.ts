/** 列表 API 分页与上限常量 */

export const DEFAULT_LIST_LIMIT = 100
export const MAX_LIST_LIMIT = 500
export const MAX_LIST_ALL = 500_000
export const MAX_PAGE_SIZE = 1000
export const MAX_AUX_BALANCE_ITEMS = 500_000
export const AUX_BALANCE_ITEM_BATCH = 5000
export const MAX_SYNC_BATCH_ROWS = 500

export function parseLimitParam(
  raw: unknown,
  options?: { defaultLimit?: number; maxLimit?: number; allowUnlimited?: boolean }
): number | null {
  const defaultLimit = options?.defaultLimit ?? DEFAULT_LIST_LIMIT
  const maxLimit = options?.maxLimit ?? MAX_LIST_LIMIT
  if (options?.allowUnlimited) return null
  if (raw === undefined || raw === null || raw === '') return defaultLimit
  const n = Number.parseInt(String(raw), 10)
  if (!Number.isFinite(n) || n <= 0) return defaultLimit
  return Math.min(n, maxLimit)
}

export function parseOffsetParam(raw: unknown): number {
  if (raw === undefined || raw === null || raw === '') return 0
  const n = Number.parseInt(String(raw), 10)
  if (!Number.isFinite(n) || n < 0) return 0
  return n
}

export function parsePageSizeParam(raw: unknown, fallback = 50): number {
  if (raw === undefined || raw === null || raw === '') return fallback
  const n = Number.parseInt(String(raw), 10)
  if (!Number.isFinite(n)) return fallback
  if (n === -1) return MAX_PAGE_SIZE
  if (n <= 0) return fallback
  return Math.min(n, MAX_PAGE_SIZE)
}

export function isAllRequested(raw: unknown): boolean {
  return raw === '1' || raw === 'true' || raw === true
}
