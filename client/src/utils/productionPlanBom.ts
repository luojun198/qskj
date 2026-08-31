export interface ProductBomLike {
  id: string
  item_code?: string
  code?: string
  version?: string | number
  status?: string
}

/** 成品编码归一化：去首尾空格并统一大小写，避免建档与录入的书写差异导致匹配不到 BOM。 */
function normalizeItemCode(value: unknown): string {
  return String(value ?? '').trim().toUpperCase()
}

export function matchProductBoms<T extends ProductBomLike>(boms: T[], itemCode: string): T[] {
  const code = normalizeItemCode(itemCode)
  return code ? boms.filter(bom => normalizeItemCode(bom.item_code) === code) : []
}

/** 从匹配到的多张 BOM 中挑默认：优先启用状态，其次版本号大者，最后编码小者。 */
export function pickDefaultProductBom<T extends ProductBomLike>(boms: T[]): T | null {
  if (!boms.length) return null
  const rank = (bom: any) => (bom.status === 'active' ? 0 : 1)
  const version = (bom: any) => String(bom.version ?? '')
  const code = (bom: any) => String(bom.code ?? '')
  return [...boms].sort((a, b) =>
    rank(a) - rank(b)
    || version(b).localeCompare(version(a), 'zh-CN', { numeric: true })
    || code(a).localeCompare(code(b), 'zh-CN', { numeric: true }),
  )[0]
}

export function shouldResetProductBom(previousItemCode: string, nextItemCode: string): boolean {
  return !!previousItemCode && previousItemCode !== nextItemCode
}

export function hasSelectedMaterialLines(lines: Array<{ item_code?: string }>): boolean {
  return lines.some(line => !!String(line.item_code || '').trim())
}
