import request from '@/api/request'
import { chunkArray } from '@/utils/accountAuxLookup'
import { yieldToMain } from '@/utils/asyncChunk'
import { normalizeImportCell, normalizeImportCodeCell } from '@/utils/textNormalize'
import {
  categoryCodeColumn,
  categoryNameColumn,
  type AuxCategoryMetaLike,
  type AuxImportItemLike,
} from '@/utils/initBalanceAuxImport'

const CODE_CHUNK = 2000
const NAME_CHUNK = 1000

/** 从导入原始行中收集各类别需匹配的编码/名称 */
export function collectAuxImportLookupTokens(
  rawData: Record<string, unknown>[],
  categories: AuxCategoryMetaLike[]
): Record<string, { codes: Set<string>; names: Set<string> }> {
  const tokens: Record<string, { codes: Set<string>; names: Set<string> }> = {}
  for (const cat of categories) {
    tokens[cat.id] = { codes: new Set(), names: new Set() }
  }

  for (const row of rawData) {
    for (const cat of categories) {
      const code = normalizeImportCodeCell(row[categoryCodeColumn(cat)])
      const name = normalizeImportCell(row[categoryNameColumn(cat)])
      if (code) tokens[cat.id].codes.add(code)
      else if (name) tokens[cat.id].names.add(name)
    }
  }
  return tokens
}

/**
 * 单辅助类别且表头不是「{类别名}编码/名称」时，尝试将唯一的 *编码/*名称 列映射过来
 * （例如旧模板「案款编码」→ 当前类别「案件号编码」）
 */
export function remapAuxImportHeadersIfNeeded(
  rawData: Record<string, unknown>[],
  categories: AuxCategoryMetaLike[]
): Record<string, unknown>[] {
  if (rawData.length === 0 || categories.length !== 1) return rawData
  const cat = categories[0]
  const codeKey = categoryCodeColumn(cat)
  const nameKey = categoryNameColumn(cat)
  const first = rawData[0]
  if (codeKey in first || nameKey in first) return rawData

  const keys = Object.keys(first)
  const codeCols = keys.filter(k => k.endsWith('编码'))
  const nameCols = keys.filter(k => k.endsWith('名称'))
  if (codeCols.length !== 1 || nameCols.length !== 1) return rawData

  const fromCode = codeCols[0]
  const fromName = nameCols[0]
  return rawData.map(row => {
    const next = { ...row }
    if (!(codeKey in next) && fromCode in next) next[codeKey] = next[fromCode]
    if (!(nameKey in next) && fromName in next) next[nameKey] = next[fromName]
    return next
  })
}

async function fetchMatchChunk(
  categoryId: string,
  codes: string[],
  names: string[]
): Promise<AuxImportItemLike[]> {
  const res = await request.post<AuxImportItemLike[]>('/base/aux-items/import-match-index', {
    type: categoryId,
    codes,
    names,
  })
  return res.data || []
}

/** 按导入文件中的编码/名称从服务端批量拉取匹配项，合并页面已有列表 */
export async function buildItemsByCategoryForAuxImport(
  rawData: Record<string, unknown>[],
  categories: AuxCategoryMetaLike[],
  existingItems: Record<string, AuxImportItemLike[]>,
  options?: { onProgress?: (pct: number) => void }
): Promise<Record<string, AuxImportItemLike[]>> {
  const remapped = remapAuxImportHeadersIfNeeded(rawData, categories)
  const tokens = collectAuxImportLookupTokens(remapped, categories)
  const merged: Record<string, AuxImportItemLike[]> = {}

  const catCount = categories.length
  for (let ci = 0; ci < catCount; ci++) {
    const cat = categories[ci]
    const byId = new Map<string, AuxImportItemLike>()
    for (const item of existingItems[cat.id] || []) {
      byId.set(item.id, item)
    }

    const { codes, names } = tokens[cat.id]
    const codeList = [...codes]
    const nameList = [...names]
    const codeChunks = chunkArray(codeList, CODE_CHUNK)
    const nameChunks = chunkArray(nameList, NAME_CHUNK)
    const totalSteps = Math.max(1, codeChunks.length + nameChunks.length)
    let step = 0

    for (const chunk of codeChunks) {
      const items = await fetchMatchChunk(cat.id, chunk, [])
      for (const item of items) byId.set(item.id, item)
      step++
      options?.onProgress?.(Math.floor(((ci + step / totalSteps) / catCount) * 100))
      await yieldToMain()
    }
    for (const chunk of nameChunks) {
      const items = await fetchMatchChunk(cat.id, [], chunk)
      for (const item of items) byId.set(item.id, item)
      step++
      options?.onProgress?.(Math.floor(((ci + step / totalSteps) / catCount) * 100))
      await yieldToMain()
    }

    merged[cat.id] = [...byId.values()]
  }

  options?.onProgress?.(100)
  return merged
}

/** 将导入匹配到的核算项目合并进页面 lookup，避免仅保留 picker 预加载的约 200 条 */
export function mergeAuxItemsByCategory(
  target: Record<string, AuxImportItemLike[]>,
  source: Record<string, AuxImportItemLike[]>
): Record<string, AuxImportItemLike[]> {
  const merged: Record<string, AuxImportItemLike[]> = { ...target }
  for (const [catId, items] of Object.entries(source)) {
    const byId = new Map<string, AuxImportItemLike>()
    for (const item of merged[catId] || []) {
      byId.set(item.id, item)
    }
    for (const item of items) {
      byId.set(item.id, item)
    }
    merged[catId] = [...byId.values()]
  }
  return merged
}
