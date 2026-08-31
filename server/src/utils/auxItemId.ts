import { AUX_LEGACY_COLUMNS } from './auxLedgerQuery.js'

/**
 * 辅助核算复合标识（aux_item_id）构建工具
 * 与凭证过账 account_balances / init_balances 保持一致
 */

export interface VoucherEntryAuxLike {
  dept_id?: string | number | null
  project_id?: string | number | null
  supplier_id?: string | number | null
  person_id?: string | number | null
  func_class_id?: string | number | null
  aux_data?: string | Record<string, unknown> | null
}

/** 从凭证分录构建 aux_item_id */
export function buildAuxItemId(entry: VoucherEntryAuxLike): string {
  const parts: string[] = []
  if (entry.dept_id) parts.push(`dept:${entry.dept_id}`)
  if (entry.project_id) parts.push(`proj:${entry.project_id}`)
  if (entry.supplier_id) parts.push(`supp:${entry.supplier_id}`)
  if (entry.person_id) parts.push(`pers:${entry.person_id}`)
  if (entry.func_class_id) parts.push(`func:${entry.func_class_id}`)
  if (entry.aux_data) {
    try {
      const auxData =
        typeof entry.aux_data === 'string' ? JSON.parse(entry.aux_data) : entry.aux_data
      if (auxData && typeof auxData === 'object') {
        const keys = Object.keys(auxData as Record<string, unknown>).sort()
        for (const key of keys) {
          const item = (auxData as Record<string, { id?: string }>)[key]
          if (item?.id) parts.push(`${key}:${item.id}`)
        }
      }
    } catch {
      /* 跳过格式错误的 aux_data */
    }
  }
  return parts.join('|')
}

/** 解析科目 aux_types，返回启用的辅助类目 ID 列表 */
export function parseAccountAuxCategoryIds(auxTypes: unknown): string[] {
  if (!auxTypes) return []
  if (typeof auxTypes === 'string') {
    const trimmed = auxTypes.trim()
    if (!trimmed) return []
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
      return trimmed
        .split(',')
        .map(part => part.trim())
        .filter(Boolean)
    }
    try {
      return parseAccountAuxCategoryIds(JSON.parse(trimmed))
    } catch {
      return trimmed
        .split(',')
        .map(part => part.trim())
        .filter(Boolean)
    }
  }
  if (Array.isArray(auxTypes)) return auxTypes.filter(Boolean).map(String)
  if (auxTypes && typeof auxTypes === 'object') {
    return Object.keys(auxTypes as Record<string, unknown>)
  }
  return []
}

/** 科目是否启用辅助核算（末级录入用） */
export function accountHasAuxAccounting(account: {
  is_aux?: number | boolean
  aux_types?: unknown
}): boolean {
  if (!account.is_aux) return false
  return parseAccountAuxCategoryIds(account.aux_types).length > 0
}

/**
 * 从期初辅助录入的选择构建 aux_item_id
 * @param categoryCodeById 辅助类目 ID -> code
 * @param selection 类目 ID -> 项目 ID（须包含科目启用的全部类目）
 */
export function buildAuxItemIdFromSelection(
  categoryCodeById: Map<string, string>,
  enabledCategoryIds: string[],
  selection: Record<string, string>
): string {
  const parts: string[] = []
  const sortedIds = [...enabledCategoryIds].sort((a, b) => {
    const codeA = categoryCodeById.get(a) || a
    const codeB = categoryCodeById.get(b) || b
    return codeA.localeCompare(codeB)
  })
  for (const catId of sortedIds) {
    const itemId = selection[catId]
    if (!itemId) continue
    const code = categoryCodeById.get(catId)
    if (code) parts.push(`${code}:${itemId}`)
  }
  return parts.join('|')
}

/** 期初辅助：单行只能属于一个辅助类目 */
export function resolveSingleCategorySelection(
  selection: Record<string, string>,
  enabledCategoryIds: string[],
  activeCategoryId?: string
): { categoryId: string; itemId: string } {
  const filled = enabledCategoryIds.filter(id => selection[id])
  if (activeCategoryId && selection[activeCategoryId]) {
    return { categoryId: activeCategoryId, itemId: selection[activeCategoryId] }
  }
  if (filled.length === 0) {
    throw new Error('请选择辅助项目')
  }
  if (filled.length > 1) {
    throw new Error('期初辅助按类目分别录入，每行只能填写一个辅助类目的项目')
  }
  return { categoryId: filled[0], itemId: selection[filled[0]] }
}

export function buildSingleCategoryAuxItemId(
  categoryCodeById: Map<string, string>,
  categoryId: string,
  itemId: string
): string {
  const code = categoryCodeById.get(categoryId)
  if (!code || !itemId) return ''
  return `${code}:${itemId}`
}

function parseAuxDataValue(raw: unknown): Record<string, unknown> | null {
  if (!raw) return null
  if (typeof raw === 'object') return raw as Record<string, unknown>
  if (typeof raw !== 'string') return null
  try {
    return JSON.parse(raw) as Record<string, unknown>
  } catch {
    return null
  }
}

function auxValueHasItemId(value: unknown): boolean {
  if (value == null || value === '') return false
  if (typeof value === 'string' || typeof value === 'number') {
    return String(value).trim().length > 0
  }
  if (typeof value === 'object') {
    const id = (value as { id?: unknown }).id
    return id != null && String(id).trim() !== ''
  }
  return false
}

/** 将 aux_item_id 解析结果映射为标准凭证分录辅助字段（用于结转等场景） */
export function applyAuxItemIdToEntryFields(auxItemId: string): Record<string, unknown> {
  if (!auxItemId?.trim()) return {}

  const parts = parseAuxItemIdParts(auxItemId)
  const fields: Record<string, unknown> = {}
  const auxData: Record<string, { id: string; name: string }> = {}

  const codeToCanonical: Record<string, string> = {
    proj: 'project',
    project: 'project',
    supp: 'customer',
    customer: 'customer',
    supplier: 'customer',
    pers: 'person',
    person: 'person',
    func: 'func_class',
    func_class: 'func_class',
    dept: 'dept',
  }

  const seenCanonical = new Set<string>()
  for (const [rawCode, itemId] of Object.entries(parts)) {
    if (!itemId) continue
    const code = codeToCanonical[rawCode] || rawCode
    if (seenCanonical.has(code)) continue
    seenCanonical.add(code)

    fields[`_${code}_id`] = itemId
    auxData[code] = { id: itemId, name: '' }

    const legacy = AUX_LEGACY_COLUMNS[code]
    if (legacy) {
      fields[legacy.id] = itemId
    }
  }

  if (Object.keys(auxData).length > 0) {
    fields.aux_data = auxData
  }
  return fields
}

/**
 * 分录是否已填写指定辅助类目的项目（兼容固定列、aux_data[code]、aux_data[categoryId]）
 */
export function entryHasAuxSelection(
  entry: VoucherEntryAuxLike & Record<string, unknown>,
  categoryCode: string,
  categoryId?: string
): boolean {
  if (extractEntryAuxSelections(entry, [categoryCode]).length > 0) {
    return true
  }

  const auxData = parseAuxDataValue(entry.aux_data)
  if (!auxData) return false

  const keys = new Set<string>([categoryCode])
  if (categoryId) keys.add(categoryId)

  for (const key of keys) {
    if (auxValueHasItemId(auxData[key])) return true
  }

  // 兼容 aux_data 中使用了其它别名键（如 proj / supp）或仅写入类别 ID 的情况
  for (const [key, value] of Object.entries(auxData)) {
    if (keys.has(key)) continue
    if (!auxValueHasItemId(value)) continue
    if (key === categoryCode || key === categoryId) return true
    if (categoryCode === 'project' && key === 'proj') return true
    if (categoryCode === 'customer' && (key === 'supp' || key === 'supplier')) return true
  }
  return false
}

/** 从凭证分录提取各辅助类目已选项目（按类目 code，用于分项余额校验） */
export function extractEntryAuxSelections(
  entry: VoucherEntryAuxLike & Record<string, unknown>,
  categoryCodes: string[]
): { categoryCode: string; itemId: string }[] {
  const selections: { categoryCode: string; itemId: string }[] = []
  let auxData: Record<string, { id?: string }> | null = null
  if (entry.aux_data) {
    try {
      auxData =
        typeof entry.aux_data === 'string'
          ? (JSON.parse(entry.aux_data) as Record<string, { id?: string }>)
          : (entry.aux_data as Record<string, { id?: string }>)
    } catch {
      auxData = null
    }
  }

  for (const code of categoryCodes) {
    let itemId: string | undefined
    const legacy = AUX_LEGACY_COLUMNS[code]
    if (legacy) {
      const raw = entry[legacy.id]
      if (raw != null && raw !== '') itemId = String(raw)
    }
    if (!itemId && auxData?.[code]?.id) {
      itemId = String(auxData[code].id)
    }
    const dynamicKey = `_${code}_id`
    if (!itemId && entry[dynamicKey]) {
      itemId = String(entry[dynamicKey])
    }
    if (!itemId && code === 'cash_flow' && entry.cash_flow_code) {
      // 现金流量可能仅存于 cash_flow_code（编码），校验层需配合 lookupAuxItemCode
      itemId = String(entry.cash_flow_code)
    }
    if (itemId) selections.push({ categoryCode: code, itemId })
  }
  return selections
}

/** 将 aux_item_id 解析为 categoryCode -> itemId（用于展示） */
export function parseAuxItemIdParts(auxItemId: string): Record<string, string> {
  const result: Record<string, string> = {}
  if (!auxItemId) return result
  for (const part of auxItemId.split('|')) {
    const idx = part.indexOf(':')
    if (idx <= 0) continue
    result[part.slice(0, idx)] = part.slice(idx + 1)
  }
  return result
}
