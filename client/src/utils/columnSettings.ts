export interface ColumnSetting {
  key: string
  label: string
  visible: boolean
  required?: boolean
  group?: string
}

export type ColumnMoveDirection = 'top' | 'up' | 'down' | 'bottom'

type SavedColumn = { key?: string; prop?: string; visible?: boolean }
type SavedColumnSettings = string[] | SavedColumn[] | Record<string, boolean> | { version?: number; columns?: SavedColumn[] } | null | undefined

export function mergeHiddenColumnVisibility(
  currentHidden: Set<string>,
  columns: readonly Pick<ColumnSetting, 'key' | 'visible'>[],
  configurableKeys: ReadonlySet<string>,
): Set<string> {
  const nextHidden = new Set(currentHidden)
  for (const column of columns) {
    if (!configurableKeys.has(column.key)) continue
    if (column.visible) nextHidden.delete(column.key)
    else nextHidden.add(column.key)
  }
  const unchanged = nextHidden.size === currentHidden.size
    && [...nextHidden].every(key => currentHidden.has(key))
  return unchanged ? currentHidden : nextHidden
}

function savedColumns(saved: SavedColumnSettings): Array<{ key: string; visible: boolean }> {
  if (saved && !Array.isArray(saved) && !('columns' in saved)) {
    return Object.entries(saved).map(([key, visible]) => ({ key, visible: Boolean(visible) }))
  }
  const source = Array.isArray(saved) ? saved : saved?.columns
  if (!Array.isArray(source)) return []
  if (source.every(item => typeof item === 'string')) {
    return (source as string[]).map(key => ({ key, visible: true }))
  }
  return (source as SavedColumn[])
    .map(item => ({ key: item.key || item.prop || '', visible: item.visible !== false }))
    .filter(item => item.key)
}

export function mergeColumnSettings<T extends ColumnSetting>(defaults: readonly T[], saved: SavedColumnSettings): T[] {
  const parsed = savedColumns(saved)
  const byKey = new Map(defaults.map(column => [column.key, column]))
  const legacyVisibleKeys = Array.isArray(saved) && saved.every(item => typeof item === 'string')
    ? new Set(saved as string[])
    : null
  const result: T[] = []
  const used = new Set<string>()

  for (const item of parsed) {
    const column = byKey.get(item.key)
    if (!column || used.has(item.key)) continue
    result.push({ ...column, visible: column.required ? true : item.visible })
    used.add(item.key)
  }

  for (const column of defaults) {
    if (used.has(column.key)) continue
    result.push({
      ...column,
      visible: column.required ? true : legacyVisibleKeys ? legacyVisibleKeys.has(column.key) : column.visible,
    })
  }
  return result
}

export function moveColumnSetting<T>(columns: readonly T[], index: number, direction: ColumnMoveDirection): T[] | readonly T[] {
  if (index < 0 || index >= columns.length) return columns
  const target = direction === 'top'
    ? 0
    : direction === 'up'
      ? index - 1
      : direction === 'down'
        ? index + 1
        : columns.length - 1
  if (target < 0 || target >= columns.length || target === index) return columns
  const next = [...columns]
  const [item] = next.splice(index, 1)
  next.splice(target, 0, item)
  return next
}

export function serializeColumnSettings(columns: readonly ColumnSetting[]) {
  return {
    version: 2 as const,
    columns: columns.map(column => ({ key: column.key, visible: column.required ? true : column.visible })),
  }
}

export function loadColumnSettings<T extends ColumnSetting>(storageKey: string, defaults: readonly T[]): T[] {
  try {
    const raw = localStorage.getItem(storageKey)
    return mergeColumnSettings(defaults, raw ? JSON.parse(raw) : null)
  } catch {
    return defaults.map(column => ({ ...column }))
  }
}

export function saveColumnSettings(storageKey: string, columns: readonly ColumnSetting[]) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(serializeColumnSettings(columns)))
  } catch { /* localStorage 不可用时忽略 */ }
}
