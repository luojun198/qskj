/** 分页参数归一：page ≥ 1、page_size 钳制到 [1, max]，非数字回落默认值（P2-4：`page=abc` 不再 500） */
export function normalizePaging(page: unknown, pageSize: unknown, defaultSize = 50, maxSize = 500) {
  const p = Number(page)
  const s = Number(pageSize)
  const safePage = Number.isFinite(p) && p >= 1 ? Math.trunc(p) : 1
  const safeSize = Number.isFinite(s) && s >= 1 ? Math.min(maxSize, Math.trunc(s)) : defaultSize
  return { page: safePage, pageSize: safeSize, offset: (safePage - 1) * safeSize }
}
