import request from '@/api/request'
import { normalizeDuplicateKey, normalizeImportCell, namesMatchForImport } from '@/utils/textNormalize'

export function collectReferencedAuxItemIds(
  accounts: Iterable<{ aux_types?: unknown }>
): string[] {
  const ids = new Set<string>()
  for (const row of accounts) {
    if (!row.aux_types) continue
    try {
      const parsed =
        typeof row.aux_types === 'string' ? JSON.parse(row.aux_types) : row.aux_types
      if (!parsed || typeof parsed !== 'object') continue
      for (const itemId of Object.values(parsed as Record<string, unknown>)) {
        if (typeof itemId === 'string' && itemId) ids.add(itemId)
      }
    } catch {
      /* ignore malformed aux_types */
    }
  }
  return [...ids]
}

export function chunkArray<T>(items: T[], size: number): T[][] {
  if (size <= 0) return [items]
  const chunks: T[][] = []
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size))
  }
  return chunks
}

export async function fetchAuxItemsByIds(ids: string[]): Promise<any[]> {
  if (ids.length === 0) return []
  const results: any[] = []
  for (const chunk of chunkArray(ids, 500)) {
    const res = await request.get<any[]>('/base/aux-items', {
      params: { ids: chunk.join(',') },
    })
    results.push(...(res.data || []))
  }
  return results
}

export async function fetchAuxItemsByCategory(categoryId: string): Promise<any[]> {
  if (!categoryId) return []
  const res = await request.get<any[]>('/base/aux-items', {
    params: { category_id: categoryId, limit: 80, status: 'active' },
  })
  return res.data || []
}

/** 按导入文件中出现的默认项目名称按需拉取（避免全量加载） */
export async function fetchAuxItemsForImportDefaults(
  rows: Record<string, unknown>[],
  categories: Array<{ id: string; name: string }>
): Promise<Map<string, Map<string, { id: string; name: string }>>> {
  const needed = new Map<string, Set<string>>()
  for (const row of rows) {
    for (const cat of categories) {
      const enabled = String(row[`辅助-${cat.name}`] ?? '').trim()
      if (enabled !== '是' && enabled !== '1' && enabled !== 'true') continue
      const defaultName = normalizeImportCell(row[`默认项目-${cat.name}`])
      if (!defaultName) continue
      if (!needed.has(cat.id)) needed.set(cat.id, new Set())
      needed.get(cat.id)!.add(defaultName)
    }
  }

  const result = new Map<string, Map<string, { id: string; name: string }>>()
  for (const [catId, names] of needed) {
    const nameMap = new Map<string, { id: string; name: string }>()
    for (const name of names) {
      const res = await request.get<any[]>('/base/aux-items', {
        params: { category_id: catId, keyword: name, limit: 20, status: 'active' },
      })
      const item = (res.data || []).find(i => namesMatchForImport(i.name, name))
      if (item) nameMap.set(normalizeDuplicateKey(name), { id: item.id, name: item.name })
    }
    result.set(catId, nameMap)
  }
  return result
}

export function findAuxItemByCategoryAndName(
  items: Array<{ id: string; name?: string }>,
  name: string
) {
  const target = normalizeImportCell(name)
  if (!target) return undefined
  return items.find(item => normalizeImportCell(item.name) === target)
}

export function collectImportAuxCategoryIds(
  rows: Record<string, unknown>[],
  categories: Array<{ id: string; name: string }>
): string[] {
  const categoryIds = new Set<string>()
  for (const row of rows) {
    for (const cat of categories) {
      const enabled = String(row[`辅助-${cat.name}`] ?? '').trim()
      if (enabled !== '是' && enabled !== '1' && enabled !== 'true') continue
      const defaultName = String(row[`默认项目-${cat.name}`] ?? '').trim()
      if (defaultName) categoryIds.add(cat.id)
    }
  }
  return [...categoryIds]
}
