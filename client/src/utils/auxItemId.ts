/** 与 server/src/utils/auxItemId.ts 保持一致 */

export function buildSingleCategoryAuxItemId(
  codeByCategoryId: Record<string, string>,
  categoryId: string,
  itemId: string
): string {
  const code = codeByCategoryId[categoryId]
  if (!code || !itemId) return ''
  return `${code}:${itemId}`
}

export function buildAuxItemIdFromSelection(
  codeByCategoryId: Record<string, string>,
  enabledCategoryIds: string[],
  selection: Record<string, string>
): string {
  const sortedIds = [...enabledCategoryIds].sort((a, b) => {
    const codeA = codeByCategoryId[a] || a
    const codeB = codeByCategoryId[b] || b
    return codeA.localeCompare(codeB)
  })
  const parts: string[] = []
  for (const catId of sortedIds) {
    const itemId = selection[catId]
    if (!itemId) continue
    const code = codeByCategoryId[catId]
    if (code) parts.push(`${code}:${itemId}`)
  }
  return parts.join('|')
}
