import type { AuxGridItem, AuxGridRow } from '@/utils/initBalanceAuxGrid'
import {
  namesMatchForImport,
  normalizeDuplicateKey,
  normalizeImportCode,
  normalizeImportText,
} from '@/utils/textNormalize'

export type AuxItemLookupResult =
  | { status: 'found'; item: AuxGridItem }
  | { status: 'not_found' }
  | { status: 'ambiguous'; candidates: AuxGridItem[] }
  | { status: 'name_mismatch'; item: AuxGridItem }

export type AuxItemLookupIndex = {
  byId: Map<string, AuxGridItem>
  byCode: Map<string, AuxGridItem>
  byNumericCode: Map<number, AuxGridItem[]>
  byNameKey: Map<string, AuxGridItem[]>
}

/** 为大批量导入构建 O(1) 查找索引（十万级核算项目匹配） */
export function buildAuxItemLookupIndex(items: AuxGridItem[]): AuxItemLookupIndex {
  const byId = new Map<string, AuxGridItem>()
  const byCode = new Map<string, AuxGridItem>()
  const byNumericCode = new Map<number, AuxGridItem[]>()
  const byNameKey = new Map<string, AuxGridItem[]>()

  for (const item of items) {
    byId.set(item.id, item)
    const code = normalizeImportCode(String(item.code ?? ''))
    if (code && !byCode.has(code)) {
      byCode.set(code, item)
    }
    if (/^\d+$/.test(code)) {
      const num = Number(code)
      const numericList = byNumericCode.get(num) || []
      numericList.push(item)
      byNumericCode.set(num, numericList)
    }
    const nameKey = normalizeDuplicateKey(String(item.name ?? ''))
    if (nameKey) {
      const nameList = byNameKey.get(nameKey) || []
      nameList.push(item)
      byNameKey.set(nameKey, nameList)
    }
  }

  return { byId, byCode, byNumericCode, byNameKey }
}

function resolveNameCandidates(
  index: AuxItemLookupIndex,
  nameText: string
): AuxGridItem[] {
  const nameKey = normalizeDuplicateKey(nameText)
  if (!nameKey) return []
  return index.byNameKey.get(nameKey) || []
}

/** 使用预构建索引匹配辅助项目（语义与 lookupAuxItemInCategory 一致） */
export function lookupAuxItemIndexed(
  index: AuxItemLookupIndex,
  codeOrId: unknown,
  name?: unknown
): AuxItemLookupResult {
  const token = normalizeImportCode(String(codeOrId ?? ''))
  const nameText = normalizeImportText(String(name ?? ''))

  if (token) {
    const byId = index.byId.get(token)
    if (byId) {
      if (nameText && !namesMatchForImport(byId.name, nameText)) {
        return { status: 'name_mismatch', item: byId }
      }
      return { status: 'found', item: byId }
    }

    const byCode = index.byCode.get(token)
    if (byCode) {
      if (nameText && !namesMatchForImport(byCode.name, nameText)) {
        return { status: 'name_mismatch', item: byCode }
      }
      return { status: 'found', item: byCode }
    }

    if (/^\d+$/.test(token)) {
      const numericMatches = index.byNumericCode.get(Number(token)) || []
      if (numericMatches.length === 1) {
        const item = numericMatches[0]
        if (nameText && !namesMatchForImport(item.name, nameText)) {
          return { status: 'name_mismatch', item }
        }
        return { status: 'found', item }
      }
      if (numericMatches.length > 1) {
        return { status: 'ambiguous', candidates: numericMatches }
      }
    }
  }

  if (nameText) {
    const matched = resolveNameCandidates(index, nameText)
    if (matched.length === 1) return { status: 'found', item: matched[0] }
    if (matched.length > 1) return { status: 'ambiguous', candidates: matched }
  }

  return { status: 'not_found' }
}

function findItemsByName(items: AuxGridItem[], nameText: string): AuxGridItem[] {
  const exact = items.filter(i => namesMatchForImport(i.name, nameText))
  if (exact.length > 0) return exact
  const key = normalizeDuplicateKey(nameText)
  if (!key) return []
  return items.filter(i => normalizeDuplicateKey(i.name) === key)
}

/** 按 id / 编码 / 数值编码 / 名称 匹配辅助项目 */
export function lookupAuxItemInCategory(
  items: AuxGridItem[],
  codeOrId: unknown,
  name?: unknown
): AuxItemLookupResult {
  if (items.length >= 256) {
    return lookupAuxItemIndexed(buildAuxItemLookupIndex(items), codeOrId, name)
  }
  const token = normalizeImportCode(String(codeOrId ?? ''))
  const nameText = normalizeImportText(String(name ?? ''))

  if (token) {
    const byId = items.find(i => i.id === token)
    if (byId) {
      if (nameText && !namesMatchForImport(byId.name, nameText)) {
        return { status: 'name_mismatch', item: byId }
      }
      return { status: 'found', item: byId }
    }

    const byCode = items.find(i => normalizeImportCode(String(i.code)) === token)
    if (byCode) {
      if (nameText && !namesMatchForImport(byCode.name, nameText)) {
        return { status: 'name_mismatch', item: byCode }
      }
      return { status: 'found', item: byCode }
    }

    if (/^\d+$/.test(token)) {
      const numeric = Number(token)
      const numericMatches = items.filter(i => {
        const code = normalizeImportCode(String(i.code))
        return /^\d+$/.test(code) && Number(code) === numeric
      })
      if (numericMatches.length === 1) {
        const item = numericMatches[0]
        if (nameText && !namesMatchForImport(item.name, nameText)) {
          return { status: 'name_mismatch', item }
        }
        return { status: 'found', item }
      }
      if (numericMatches.length > 1) {
        return { status: 'ambiguous', candidates: numericMatches }
      }
    }
  }

  if (nameText) {
    const matched = findItemsByName(items, nameText)
    if (matched.length === 1) return { status: 'found', item: matched[0] }
    if (matched.length > 1) return { status: 'ambiguous', candidates: matched }
  }

  return { status: 'not_found' }
}

/** @deprecated 使用 lookupAuxItemInCategory */
export function findAuxItemInCategory(
  items: AuxGridItem[],
  codeOrId: unknown,
  name?: unknown
): AuxGridItem | undefined {
  const result = lookupAuxItemInCategory(items, codeOrId, name)
  if (result.status === 'found' || result.status === 'name_mismatch') {
    return result.item
  }
  return undefined
}

export function getAuxLineCategoryItemId(line: AuxGridRow): {
  categoryId: string
  itemId: string
} | null {
  const categoryId = Object.keys(line.selection).find(id => line.selection[id])
  if (!categoryId) return null
  const itemId = line.selection[categoryId]
  if (!itemId) return null
  return { categoryId, itemId }
}

/** 为大批量保存/校验构建类目 → 项目 id 集合（O(1) 查找） */
export function buildAuxItemIdSetByCategory(
  itemsByCategory: Record<string, AuxGridItem[]>
): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>()
  for (const [catId, items] of Object.entries(itemsByCategory)) {
    map.set(catId, new Set(items.map(i => i.id)))
  }
  return map
}

export function isAuxLineItemValid(
  line: AuxGridRow,
  itemsByCategory: Record<string, AuxGridItem[]>,
  validIdsByCategory?: Map<string, Set<string>>
): boolean {
  const picked = getAuxLineCategoryItemId(line)
  if (!picked) return false
  const set =
    validIdsByCategory?.get(picked.categoryId) ??
    new Set((itemsByCategory[picked.categoryId] || []).map(i => i.id))
  return set.has(picked.itemId)
}
